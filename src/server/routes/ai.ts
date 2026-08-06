import { ai } from "../config.js";
import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { decryptSecret } from "../../lib/secret-crypto.js";
import { decodeEntryId } from "../../lib/id-hash.js";
import { jsonResponse } from "../route-helpers.js";
import { requireSuperAdmin } from "../admin-access.js";
import { getContentAdapters } from "../content-adapters.js";
import { validateOutboundUrlForRequest } from "../outbound-url.js";
import { RequestBodyLimitError } from "../request-limits.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import {
  WIZARD_FEATURE_KEYS,
  WIZARD_FIELD_TYPES,
  WIZARD_RELATION_CARDINALITIES,
  extractWizardJson,
  parseWizardTurn,
} from "../../content-types/ai-wizard-protocol.js";
import { RESERVED_NAMES } from "../../content-types/naming.js";
import { sanitizeAiRichTextHtml } from "../../content-types/ai-richtext-sanitize.js";
import { handleMagicWrite } from "./ai-magic-write.js";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Multimodal context images (Magic Write only, `status/magic-write.md`
   * decision #3) - base64-encoded, already client-resized. Absent/empty for
   * every other AI feature (chat, wizard), which stay text-only. */
  images?: { mimeType: string; base64: string }[];
}

interface ChatRequest {
  messages?: ChatMessage[];
  message?: string;
  conversationId?: string;
}

interface CheckKeyRequest {
  provider?: string;
  key?: string;
  model?: string;
  url?: string;
  entryId?: string;
  entryName?: string;
}

interface ModelsRequest {
  provider?: string;
  key?: string;
  url?: string;
  entryId?: string;
  entryName?: string;
}

interface ServerCredential {
  name: string;
  provider: "openai" | "anthropic" | "google";
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatStreamResult {
  stream: ReadableStream<Uint8Array>;
  aiLabel: string;
}

class AiProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AiProviderError";
  }
}

interface ConversationRecord {
  messages: ChatMessage[];
  expiresAt: number;
}

const conversations = new Map<string, ConversationRecord>();
const CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CONVERSATIONS = 1_000;
const MAX_ACTIVE_AI_STREAMS = 4;
let activeAiStreams = 0;

/** Shared concurrency gate for every AI-backed route (chat, wizard, magic
 * write) - one counter app-wide, so `ai-magic-write.ts` (which doesn't have
 * direct access to the module-private `activeAiStreams` above) competes for
 * the same slots rather than getting its own separate limit. Pair with
 * `trackAiStream`'s `release` callback (or a direct `releaseAiStreamSlot()`
 * call on a synchronous early failure) - never leave a slot acquired. */
export function acquireAiStreamSlot(): boolean {
  if (activeAiStreams >= MAX_ACTIVE_AI_STREAMS) return false;
  activeAiStreams += 1;
  return true;
}

export function releaseAiStreamSlot(): void {
  activeAiStreams = Math.max(0, activeAiStreams - 1);
}

function aiProviderLabel(provider: ServerCredential["provider"] | "codex" | "claude"): string {
  return {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google AI",
    codex: "Codex",
    claude: "Claude",
  }[provider];
}

function providerFromEntry(value: unknown): "openai" | "anthropic" | "google" | "custom" {
  const provider = String(value ?? "").trim().toLowerCase();
  if (provider === "chatgpt" || provider === "openai") return "openai";
  if (provider === "anthropic" || provider === "claude") return "anthropic";
  if (provider === "google" || provider === "gemini") return "google";
  if (provider === "custom") return "custom";
  throw new Error(`Unsupported AI Key provider "${String(value)}".`);
}

/** `model` used to be a single-value `text` field (a bare string in the DB) -
 * see `AiKeyEditor.tsx`'s own `readModelList` doc comment for why an older
 * row can still deserialize as a plain string instead of an array. */
function readModelList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((model): model is string => typeof model === "string" && model.trim().length > 0);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

async function readServerCredentials(context: DryRouteContext, preferredName?: string, preferredModel?: string): Promise<ServerCredential[]> {
  const serverAi = ai;
  if (serverAi.mode !== "server") throw new Error("Server AI mode is not configured.");
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.name === "aiKey");
  if (!type) throw new Error('The system collection "aiKey" is not available.');
  const page = await entries.listEntries(type, allTypes, { page: 0, pageSize: 10_000 });
  // An explicit per-request override (the wizard's AI Key combobox) restricts
  // to exactly that one key, with no fallback to the others - the admin
  // picked it on purpose. Absent an override, fall back to `ai.keyName`'s
  // preferred-first-then-fallback ordering, same as before.
  if (preferredName) {
    // Trimmed on both sides: `handleWizard`/`ai-magic-write.ts` already trim
    // the INCOMING override before it gets here, but a stored `aiKey.name`
    // itself can carry accidental leading/trailing whitespace (a typo when
    // the admin created the row) - comparing untrimmed-vs-trimmed would
    // silently never match that row again from its own combobox, which
    // sends back exactly the untrimmed stored name.
    const match = page.rows.find((row) => String(row.value.name ?? "").trim() === preferredName.trim());
    if (!match) throw new Error(`AI Key "${preferredName}" was not found.`);
    // `preferredModel` (the dialog's own model picker, shown once a specific
    // key is chosen) only ever makes sense paired with a `preferredName` - an
    // "Automatic" run can land on any configured key, so there is no single
    // model list to validate against. Checked here, against THIS key's own
    // `model` list, rather than left to fall through silently below.
    if (preferredModel) {
      const entryModels = readModelList(match.value.model);
      if (!entryModels.includes(preferredModel)) {
        throw new Error(`Model "${preferredModel}" is not configured for AI Key "${preferredName}".`);
      }
    }
    page.rows = [match];
  }
  const orderedRows = !preferredName && serverAi.keyName
    ? [...page.rows].sort((left, right) => {
        const leftPreferred = String(left.value.name ?? "") === serverAi.keyName;
        const rightPreferred = String(right.value.name ?? "") === serverAi.keyName;
        return Number(rightPreferred) - Number(leftPreferred);
      })
    : page.rows;
  if (!preferredName && serverAi.keyName && !orderedRows.some((row) => String(row.value.name ?? "") === serverAi.keyName)) {
    throw new Error(`AI Key "${serverAi.keyName}" was not found.`);
  }

  const credentials: ServerCredential[] = [];
  const skippedKeys: string[] = [];
  for (const row of orderedRows) {
    const name = String(row.value.name ?? "Unnamed AI Key");
    const raw = await entries.getRawEntry(type, row.id);
    if (!raw || typeof raw.key !== "string") {
      skippedKeys.push(`${name}: no stored secret`);
      continue;
    }
    try {
      const providerEntry = providerFromEntry(row.value.provider);
      const provider = providerEntry === "custom" ? serverAi.provider : providerEntry;
      const baseUrl = await validateOutboundUrlForRequest(typeof row.value.url === "string" && row.value.url.trim()
        ? row.value.url.trim()
        : provider === "google" ? "https://generativelanguage.googleapis.com" : serverAi.baseUrl, "AI provider URL");
      const entryModels = readModelList(row.value.model);
      const entryModel = preferredModel && entryModels.includes(preferredModel) ? preferredModel : entryModels[0];
      credentials.push({ name, provider, apiKey: await decryptSecret(raw.key), baseUrl, model: entryModel || serverAi.model });
    } catch (error) {
      // A malformed or undecryptable key must not prevent later configured keys from being tried.
      skippedKeys.push(`${name}: ${error instanceof Error ? error.message : "invalid configuration"}`);
    }
  }
  if (credentials.length === 0) {
    throw new Error(`No usable AI API keys are configured.${skippedKeys.length ? ` ${skippedKeys.join("; ")}` : ""}`);
  }
  return credentials;
}

function isAiKeyFallbackError(error: unknown): boolean {
  if (!(error instanceof AiProviderError)) return false;
  if (error.status === 401 || error.status === 403 || error.status === 408 || error.status === 429) return true;
  return /quota|rate\s*limit|too many requests|insufficient[_ -]?quota|billing|credit|balance|exceeded/i.test(error.message);
}

function allAiKeysFailed(errors: Error[]): Error {
  const last = errors.at(-1);
  return new Error(
    `All configured AI API keys are exhausted or unavailable.${last ? ` Last provider error: ${last.message}` : ""}`,
  );
}

function errorResponse(error: unknown, status = 500): Response {
  if (error instanceof RequestBodyLimitError) return jsonResponse({ error: "request_too_large", message: "Request body is too large." }, 413);
  const message = error instanceof AiProviderError
    ? "AI provider request failed."
    : safeAiMessage(error);
  return jsonResponse(
    { error: "ai_error", message },
    status,
  );
}

export function safeAiMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "AI request failed.";
  return message
    .replace(/(?:Bearer\s+|x-api-key[=: ]+|key=)[^\s&]+/gi, "$1[redacted]")
    .replace(/(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})/g, "[redacted]");
}

function validateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) {
    throw new Error("AI chat expects between 1 and 40 messages.");
  }
  const messages = value.filter(
    (message): message is ChatMessage =>
      !!message &&
      typeof message === "object" &&
      (message as ChatMessage).role !== undefined &&
      ((message as ChatMessage).role === "user" || (message as ChatMessage).role === "assistant") &&
      typeof (message as ChatMessage).text === "string" &&
      (message as ChatMessage).text.trim().length > 0,
  );
  if (messages.length !== value.length || messages.some((message) => message.text.length > 20_000)) {
    throw new Error("AI chat contains an invalid message.");
  }
  return messages.map((message) => ({ role: message.role, text: message.text.trim() }));
}

function validateSingleMessage(value: unknown): ChatMessage {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("AI chat message cannot be empty.");
  }
  return { role: "user", text: value.trim() };
}

function conversationKey(context: DryRouteContext, id: string): string {
  return `${context.session?.id ?? "anonymous"}:${id}`;
}

function resolveChatConversation(context: DryRouteContext, body: ChatRequest): {
  id?: string;
  key?: string;
  messages: ChatMessage[];
} {
  const id = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
  for (const [key, record] of conversations) {
    if (record.expiresAt <= Date.now()) conversations.delete(key);
  }
  if (typeof body.message === "string") {
    const message = validateSingleMessage(body.message);
    if (!id) return { messages: [message] };
    if (id.length > 128) throw new Error("Conversation id is too long.");
    const key = conversationKey(context, id);
    const current = conversations.get(key);
    if (current && current.expiresAt <= Date.now()) conversations.delete(key);
    const history = conversations.get(key)?.messages ?? [];
    return { id, key, messages: [...history, message] };
  }
  if (!id) {
    return { messages: validateMessages(body.messages) };
  }
  return { messages: validateMessages(body.messages) };
}

function rememberConversation(key: string, messages: ChatMessage[]): void {
  if (!conversations.has(key) && conversations.size >= MAX_CONVERSATIONS) {
    const oldest = [...conversations.entries()].sort((left, right) => left[1].expiresAt - right[1].expiresAt)[0];
    if (oldest) conversations.delete(oldest[0]);
  }
  conversations.set(key, {
    messages: messages.slice(-40),
    expiresAt: Date.now() + CONVERSATION_TTL_MS,
  });
}

export function trackAiStream(stream: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let released = false;
  const timeout = setTimeout(releaseOnce, ai.timeoutMs + 5_000);
  function releaseOnce(): void {
    if (released) return;
    released = true;
    clearTimeout(timeout);
    release();
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        reader ??= stream.getReader();
        const result = await reader.read();
        if (result.done) {
          controller.close();
          releaseOnce();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
        releaseOnce();
      }
    },
    async cancel(reason) {
      try {
        await reader?.cancel(reason);
      } finally {
        releaseOnce();
      }
    },
  });
}

function promptForCli(messages: ChatMessage[]): string {
  return [
    "You are helping build a content type in drycms. Answer the user's latest request clearly and briefly.",
    ...messages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`),
    "Assistant:",
  ].join("\n\n");
}

/**
 * `ai.mode: "local"` spawns a CLI via `node:child_process`, which no
 * Workers runtime provides (not even under the `nodejs_compat`
 * compatibility flag - there is no OS process for an isolate to spawn).
 * Turns whatever cryptic module-resolution error that dynamic `import`
 * would otherwise throw into a clear, actionable one - see
 * `status/cloudflare-workers-adapter.md`'s Phase 3.
 */
async function loadNodeSpawn(): Promise<(typeof import("node:child_process"))["spawn"]> {
  try {
    const { spawn } = await import("node:child_process");
    return spawn;
  } catch {
    throw new Error('`ai.mode: "local"` requires Node (`node:child_process` is not available on this runtime) - use `ai.mode: "server"` instead.');
  }
}

async function runLocalCli(messages: ChatMessage[]): Promise<string> {
  const localAi = ai;
  if (localAi.mode !== "local") throw new Error("Local AI mode is not configured.");
  const spawn = await loadNodeSpawn();
  const prompt = promptForCli(messages);
  const hasPromptSlot = localAi.args.some((arg) => arg.includes("{prompt}"));
  const args = hasPromptSlot
    ? localAi.args.map((arg) => arg.replaceAll("{prompt}", prompt))
    : [...localAi.args, prompt];

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(localAi.command, args, {
      cwd: localAi.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`The ${ai.provider} CLI timed out.`));
    }, localAi.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Unable to start ${localAi.command}: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${localAi.command} exited with code ${code ?? "unknown"}.`));
        return;
      }
      const result = stdout.trim();
      if (!result) reject(new Error(`${localAi.command} returned an empty response.`));
      else resolve(result);
    });
  });
}

async function requestServerAiWithCredential(messages: ChatMessage[], credential: ServerCredential): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs);
  try {
    if (credential.provider === "openai") {
      const response = await fetch(`${credential.baseUrl}/v1/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: credential.model,
          input: messages.map((message) => ({ role: message.role, content: message.text })),
        }),
        signal: controller.signal,
        redirect: "error",
      });
      const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || `OpenAI returned HTTP ${response.status}.`);
      const text = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
      if (!text) throw new Error("OpenAI returned an empty response.");
      return text;
    }

    const response = await fetch(`${credential.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": credential.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: credential.model,
        max_tokens: 2048,
        messages: messages.map((message) => ({ role: message.role, content: message.text })),
      }),
      signal: controller.signal,
      redirect: "error",
    });
    const body = await response.json() as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || `Anthropic returned HTTP ${response.status}.`);
    const text = body.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
    if (!text) throw new Error("Anthropic returned an empty response.");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const streamEncoder = new TextEncoder();

export function streamEvent(payload: Record<string, unknown>): Uint8Array {
  return streamEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readSseStream(
  response: Response,
  onData: (data: string) => void,
): Promise<void> {
  if (!response.body) throw new Error("AI provider returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data:")) onData(line.slice(5).trim());
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith("data:")) onData(buffer.slice(5).trim());
}

function streamLocalCli(messages: ChatMessage[], onDelta: (delta: string) => void): ReadableStream<Uint8Array> {
  const localAi = ai;
  if (localAi.mode !== "local") throw new Error("Local AI mode is not configured.");
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const spawn = await loadNodeSpawn();
        const prompt = promptForCli(messages);
        const hasPromptSlot = localAi.args.some((arg) => arg.includes("{prompt}"));
        const baseArgs = hasPromptSlot
          ? localAi.args.map((arg) => arg.replaceAll("{prompt}", prompt))
          : [...localAi.args, prompt];
        // Codex's normal exec output is line-buffered and only emits the final
        // answer. JSONL gives us a stable final-message event; we progressively
        // release that text below so the UI still renders it incrementally.
        const args = localAi.provider === "codex" && !baseArgs.includes("--json")
          ? [...baseArgs, "--json"]
          : baseArgs;
        const child = spawn(localAi.command, args, {
          cwd: localAi.cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        let stdout = "";
        let settled = false;
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          if (!settled) {
            settled = true;
            controller.enqueue(streamEvent({ error: `The ${ai.provider} CLI timed out.` }));
            controller.close();
          }
        }, localAi.timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => {
          if (!settled && localAi.provider === "codex") {
            stdout += chunk.toString();
          } else if (!settled) {
            const delta = chunk.toString();
            onDelta(delta);
            controller.enqueue(streamEvent({ delta }));
          }
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          controller.enqueue(streamEvent({ error: safeAiMessage(new Error(`Unable to start ${localAi.command}: ${error.message}`)) }));
          controller.close();
        });
        child.on("close", (code) => {
          void (async () => {
            clearTimeout(timer);
            if (settled) return;
            if (code !== 0) {
              settled = true;
              controller.enqueue(streamEvent({ error: safeAiMessage(new Error(stderr.trim() || `${localAi.command} exited with code ${code ?? "unknown"}.`)) }));
              controller.enqueue(streamEvent({ done: true }));
              controller.close();
              return;
            }
            if (localAi.provider === "codex") {
              let finalText = "";
              for (const line of stdout.split(/\r?\n/)) {
                try {
                  const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
                  if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
                    finalText = event.item.text;
                  }
                } catch {
                  // Ignore non-JSON diagnostic lines from the CLI.
                }
              }
              if (!finalText) finalText = stdout.trim();
              const chars = Array.from(finalText);
              for (let index = 0; index < chars.length && !settled; index += 12) {
                const delta = chars.slice(index, index + 12).join("");
                onDelta(delta);
                controller.enqueue(streamEvent({ delta }));
                await new Promise((resolve) => setTimeout(resolve, 15));
              }
            }
            if (settled) return;
            settled = true;
            controller.enqueue(streamEvent({ done: true }));
            controller.close();
          })();
        });
      })().catch((error) => {
        controller.enqueue(streamEvent({ error: safeAiMessage(error) }));
        controller.close();
      });
    },
  });
}

/** OpenAI Responses API `input[].content` - a plain string for a text-only
 * message (unchanged from before Magic Write), or an array of typed parts
 * once `message.images` is non-empty. */
function openaiContentFor(message: ChatMessage): string | Record<string, unknown>[] {
  if (!message.images?.length) return message.text;
  return [
    { type: "input_text", text: message.text },
    ...message.images.map((image) => ({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.base64}` })),
  ];
}

/** Anthropic Messages API `messages[].content` - same string-vs-array split
 * as `openaiContentFor`. */
function anthropicContentFor(message: ChatMessage): string | Record<string, unknown>[] {
  if (!message.images?.length) return message.text;
  return [
    { type: "text", text: message.text },
    ...message.images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } })),
  ];
}

async function streamServerAiWithCredential(
  messages: ChatMessage[],
  credential: ServerCredential,
  onDelta: (delta: string) => void,
  /** Overrides Anthropic's own `max_tokens` (OpenAI's Responses API takes no
   * such field here, so this only affects the Anthropic branch below) -
   * Magic Write's replies (a whole entry's worth of fields) can run well
   * past the 2048-token default chat/wizard replies fit comfortably under. */
  maxOutputTokens?: number,
  /** Passed straight through to the Google branch - see that function's own
   * doc comment. OpenAI/Anthropic already use the full `ai.timeoutMs` below
   * (never the Google-only 30s default), so nothing to override for them. */
  timeoutMs?: number,
): Promise<ReadableStream<Uint8Array>> {
  if (credential.provider === "google") {
    return streamGoogleAiWithCredential(messages, credential, onDelta, timeoutMs);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs);
  const response = await fetch(
    credential.provider === "openai"
      ? `${credential.baseUrl}/v1/responses`
      : `${credential.baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: credential.provider === "openai"
        ? { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" }
        : credential.provider === "anthropic"
          ? { "x-api-key": credential.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
          : { "x-goog-api-key": credential.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(credential.provider === "openai"
        ? {
            model: credential.model,
            stream: true,
            input: messages.map((message) => ({ role: message.role, content: openaiContentFor(message) })),
          }
        : {
            model: credential.model,
            stream: true,
            max_tokens: maxOutputTokens ?? 2048,
            messages: messages.map((message) => ({ role: message.role, content: anthropicContentFor(message) })),
          }),
      signal: controller.signal,
      redirect: "error",
    },
  );
  if (!response.ok) {
    clearTimeout(timer);
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new AiProviderError(body.error?.message || `AI provider returned HTTP ${response.status}.`, response.status);
  }

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      void readSseStream(response, (data) => {
        if (data === "[DONE]") return;
        const event = JSON.parse(data) as {
          type?: string;
          delta?: string | { type?: string; text?: string };
          error?: { message?: string };
        };
        const delta = typeof event.delta === "string"
          ? event.delta
          : event.delta?.type === "text_delta" ? event.delta.text : undefined;
        if (delta) {
          onDelta(delta);
          streamController.enqueue(streamEvent({ delta }));
        }
        if (event.type === "response.failed" || event.type === "error") {
        streamController.enqueue(streamEvent({ error: safeAiMessage(new Error(event.error?.message || "AI provider failed.")) }));
        }
      }).then(() => {
        clearTimeout(timer);
        streamController.enqueue(streamEvent({ done: true }));
        streamController.close();
      }).catch((error) => {
        clearTimeout(timer);
        streamController.enqueue(streamEvent({ error: safeAiMessage(error) }));
        streamController.close();
      });
    },
    cancel() {
      clearTimeout(timer);
      controller.abort();
    },
  });
}

/** Google's own wording for "this is a capacity spike, not a real failure" -
 * distinct from `isAiKeyFallbackError`'s quota/billing/rate-limit patterns
 * (those mean "this credential is bad/exhausted, try another"; this means
 * "this credential is fine, the model is momentarily overloaded, retry the
 * SAME request shortly" - see `streamGoogleAiWithCredential`'s own retry
 * loop below). */
function isTransientProviderErrorMessage(message: string): boolean {
  return /overloaded|high demand|temporarily unavailable|service unavailable|try again/i.test(message);
}

const GOOGLE_TRANSIENT_RETRY_DELAYS_MS = [1_000, 2_000];

async function readGoogleErrorMessage(response: Response): Promise<{ message: string; status: number }> {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  return { message: body.error?.message || `Google returned HTTP ${response.status}.`, status: response.status };
}

async function streamGoogleAiWithCredential(
  messages: ChatMessage[],
  credential: ServerCredential,
  onDelta: (delta: string) => void,
  /** Overrides the 30s default below - Magic Write's requests (images +
   * a whole entry's worth of fields) routinely take longer than 30s for
   * Google to even start streaming back, which was otherwise surfacing as
   * a misleading "This operation was aborted" / "all AI keys exhausted"
   * error (the abort turns into an `AiProviderError` with status 408,
   * which `isAiKeyFallbackError` treats as a real per-key failure). */
  timeoutMs?: number,
): Promise<ReadableStream<Uint8Array>> {
  const model = credential.model.replace(/^models\//, "");
  const modelUrl = `${credential.baseUrl}/v1beta/models/${encodeURIComponent(model)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? Math.min(ai.timeoutMs, 30_000));
  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      { text: message.text },
      ...(message.images ?? []).map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
    ],
  }));
  try {
    const request = (endpoint: string) => {
      return fetch(`${modelUrl}:${endpoint}`, {
        method: "POST",
        headers: { "x-goog-api-key": credential.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
        signal: controller.signal,
        redirect: "error",
      });
    };

    let response = await request("streamGenerateContent?alt=sse");
    let streaming = true;
    // A "this model is currently experiencing high demand, try again
    // later"-style response is Google's own signal that this exact request
    // is worth retrying as-is (not a reason to give up on this credential -
    // see `isTransientProviderErrorMessage`'s own doc comment) - short,
    // capped retries here before falling through to the existing
    // streaming-unsupported fallback/error handling below.
    for (let attempt = 0; !response.ok && attempt < GOOGLE_TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
      const { message, status } = await readGoogleErrorMessage(response.clone());
      if (status !== 503 && !isTransientProviderErrorMessage(message)) break;
      await new Promise((resolve) => setTimeout(resolve, GOOGLE_TRANSIENT_RETRY_DELAYS_MS[attempt]));
      response = await request("streamGenerateContent?alt=sse");
    }
    if (!response.ok) {
      const { message, status } = await readGoogleErrorMessage(response);
      const streamUnsupported = status === 404 || /stream(?:ing)?|not supported|not found/i.test(message);
      if (!streamUnsupported) throw new AiProviderError(message, status);
      response = await request("generateContent");
      streaming = false;
      if (!response.ok) {
        const fallback = await readGoogleErrorMessage(response);
        throw new AiProviderError(fallback.message, fallback.status);
      }
    }

    if (!streaming) {
      const body = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? "").join("");
      if (!text) throw new Error("Google returned an empty response.");
      clearTimeout(timer);
      return new ReadableStream<Uint8Array>({
        start(streamController) {
          onDelta(text);
          streamController.enqueue(streamEvent({ delta: text }));
          streamController.enqueue(streamEvent({ done: true }));
          streamController.close();
        },
        cancel() {
          controller.abort();
        },
      });
    }

    return new ReadableStream<Uint8Array>({
      start(streamController) {
        void readSseStream(response, (data) => {
          if (data === "[DONE]") return;
          const event = JSON.parse(data) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const delta = event.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
            .map((part) => part.text ?? "").join("");
          if (delta) {
            onDelta(delta);
            streamController.enqueue(streamEvent({ delta }));
          }
        }).then(() => {
          clearTimeout(timer);
          streamController.enqueue(streamEvent({ done: true }));
          streamController.close();
        }).catch((error) => {
          clearTimeout(timer);
          streamController.enqueue(streamEvent({ error: safeAiMessage(error) }));
          streamController.close();
        });
      },
      cancel() {
        clearTimeout(timer);
        controller.abort();
      },
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(error instanceof Error ? error.message : "Google generation timed out.", 408);
  }
}

export async function createChatStream(
  context: DryRouteContext,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  preferredKeyName?: string,
  preferredModel?: string,
  maxOutputTokens?: number,
  timeoutMs?: number,
): Promise<ChatStreamResult> {
  if (ai.mode === "local") {
    return {
      stream: streamLocalCli(messages, onDelta),
      aiLabel: `${aiProviderLabel(ai.provider)} (local)`,
    };
  }
  const credentials = await readServerCredentials(context, preferredKeyName, preferredModel);
  const errors: Error[] = [];
  for (const credential of credentials) {
    try {
      return {
        stream: await streamServerAiWithCredential(messages, credential, onDelta, maxOutputTokens, timeoutMs),
        aiLabel: `${aiProviderLabel(credential.provider)} · ${credential.model}`,
      };
    } catch (error) {
      if (!isAiKeyFallbackError(error)) throw error;
      errors.push(error instanceof Error ? error : new Error("AI provider request failed."));
    }
  }
  throw allAiKeysFailed(errors);
}

async function readStoredAiKey(context: DryRouteContext, entryIdValue?: string, entryName?: string): Promise<string> {
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.name === "aiKey");
  if (!type) throw new Error('The system collection "aiKey" is not available.');
  let raw: Record<string, unknown> | null = null;
  if (entryIdValue) {
    const entryId = decodeEntryId(entryIdValue);
    if (entryId !== null) raw = await entries.getRawEntry(type, entryId);
  }
  if (!raw && entryName?.trim()) {
  const page = await entries.listEntries(type, allTypes, { page: 0, pageSize: 100 });
    const selected = page.rows.find((row) => String(row.value.name ?? "") === entryName.trim());
    if (selected) raw = await entries.getRawEntry(type, selected.id);
  }
  if (!raw || typeof raw.key !== "string") throw new Error("The stored AI Key has no secret key.");
  try {
    return await decryptSecret(raw.key);
  } catch {
    throw new Error("The stored AI Key cannot be decrypted with the current DRYCMS_SECRET_KEY. Enter the key again and save this entry.");
  }
}

async function checkAiKey(context: DryRouteContext, body: CheckKeyRequest): Promise<void> {
  const rawProvider = String(body.provider ?? "").trim();
  let apiKey = String(body.key ?? "").trim();
  const model = String(body.model ?? "").trim();
  if (!apiKey && (body.entryId || body.entryName)) apiKey = await readStoredAiKey(context, body.entryId, body.entryName);
  if (!apiKey) throw new Error("No API key is available. Enter an API key and save this entry first.");
  if (!model) throw new Error("A model is required before checking the API key.");
  if (rawProvider.toLowerCase() === "google") {
    const baseUrl = await validateOutboundUrlForRequest(String(body.url ?? "").trim() || "https://generativelanguage.googleapis.com", "AI provider URL");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ai.timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}`, {
        headers: { "x-goog-api-key": apiKey },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) throw new Error(`Google returned HTTP ${response.status}.`);
      return;
    } finally {
      clearTimeout(timer);
    }
  }
  const selectedProvider = providerFromEntry(rawProvider);
  const provider = selectedProvider === "custom" ? ai.provider : selectedProvider;
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error(`Provider "${rawProvider}" is not supported by the AI key checker.`);
  }
  const configuredBaseUrl = ai.mode === "server"
    ? ai.baseUrl
    : provider === "anthropic"
      ? "https://api.anthropic.com"
      : "https://api.openai.com";
  const baseUrl = await validateOutboundUrlForRequest(String(body.url ?? "").trim() || configuredBaseUrl, "AI provider URL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs);
  try {
    if (provider === "openai") {
      const response = await fetch(`${baseUrl}/v1/models/${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message || `OpenAI returned HTTP ${response.status}.`);
      }
      return;
    }

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "Reply with OK." }] }),
      signal: controller.signal,
      redirect: "error",
    });
    const responseBody = await response.json().catch(() => ({})) as { error?: { message?: string } };
    if (!response.ok) throw new Error(responseBody.error?.message || `Anthropic returned HTTP ${response.status}.`);
  } finally {
    clearTimeout(timer);
  }
}

async function listAiModels(context: DryRouteContext, body: ModelsRequest): Promise<string[]> {
  const providerValue = String(body.provider ?? "").trim().toLowerCase();
  let apiKey = String(body.key ?? "").trim();
  if (!apiKey && (body.entryId || body.entryName)) apiKey = await readStoredAiKey(context, body.entryId, body.entryName);
  if (providerValue === "custom") {
    const url = await validateOutboundUrlForRequest(String(body.url ?? "").trim(), "AI provider URL");
    if (!url) throw new Error("URL is required for Custom provider.");
    if (!apiKey) throw new Error("API key is required to load models.");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(ai.timeoutMs),
      redirect: "error",
    });
    const responseBody = await response.json().catch(() => ({})) as {
      data?: Array<{ id?: unknown; name?: unknown }>;
      models?: Array<{ id?: unknown; name?: unknown } | string>;
    };
    if (!response.ok) throw new Error(`Custom provider returned HTTP ${response.status}.`);
    const items = [...(responseBody.data ?? []), ...(responseBody.models ?? [])];
    return [...new Set(items.map((item) => typeof item === "string" ? item : item.id ?? item.name).filter((item): item is string => typeof item === "string" && item.length > 0))];
  }
  const provider = providerValue === "chatgpt" ? "openai" : providerValue === "claude" ? "anthropic" : providerValue;
  const key = apiKey;
  if (!key) throw new Error("API key is required to load models.");
  const url = await validateOutboundUrlForRequest(String(body.url ?? "").trim() || (
    provider === "google"
      ? "https://generativelanguage.googleapis.com"
      : provider === "anthropic"
        ? "https://api.anthropic.com"
        : provider === "openai"
          ? "https://api.openai.com"
          : ""
  ), "AI provider URL");
  if (!url) throw new Error(`Unsupported AI Key provider "${String(body.provider)}".`);

  if (provider === "google") {
    const response = await fetch(`${url}/v1beta/models`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(ai.timeoutMs),
      redirect: "error",
    });
    const responseBody = await response.json().catch(() => ({})) as {
      models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(responseBody.error?.message || `Google returned HTTP ${response.status}.`);
    return [...new Set((responseBody.models ?? [])
      .filter((model) => !Array.isArray(model.supportedGenerationMethods) || model.supportedGenerationMethods.includes("generateContent"))
      .map((model) => typeof model.name === "string" ? model.name.replace(/^models\//, "") : "")
      .filter(Boolean))];
  }

  const response = await fetch(`${url}/v1/models`, {
    headers: provider === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(ai.timeoutMs),
    redirect: "error",
  });
  const responseBody = await response.json().catch(() => ({})) as {
    data?: Array<{ id?: unknown; name?: unknown }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(responseBody.error?.message || `${provider === "anthropic" ? "Anthropic" : "OpenAI"} returned HTTP ${response.status}.`);
  return [...new Set((responseBody.data ?? [])
    .map((model) => typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : "")
    .filter(Boolean))];
}

interface WizardHttpRequest {
  history?: ChatMessage[];
  /** Overrides `ai.keyName`'s fallback order for this one wizard run - the
   * Content Types "Ask AI" dialog's AI Key combobox (server mode only). */
  aiKeyName?: string;
  /** Which of `aiKeyName`'s own configured models to use for this run - only
   * meaningful (and only ever sent) alongside a real `aiKeyName`, once the
   * dialog's second "Model" combobox has something to list. */
  aiModel?: string;
  /** The admin's own one-time starting description, collected by the
   * dialog's initial screen before any AI call happens - only meaningful
   * (and only ever sent) on the very first turn, `history: []`. Folded into
   * the priming message rather than sent as a separate history entry so the
   * conversation still opens with exactly one "user" turn (some server
   * providers reject two consecutive same-role messages). */
  goal?: string;
}

const WIZARD_MAX_ATTEMPTS = 3;

function summarizeExistingType(type: ContentTypeDefinition): string {
  const fieldNames = type.fields
    .filter((field) => !(type.deletedFieldIds ?? []).includes(field.id))
    .map((field) => `${field.name}:${field.type}`)
    .join(", ");
  const labelPart = type.label && type.label !== type.name ? `, label "${type.label}"` : "";
  return `- "${type.name}" (${type.kind}${labelPart})${fieldNames ? ` - fields: ${fieldNames}` : " - no custom fields yet"}`;
}

function buildWizardSystemPrompt(lang: string, existingTypes: ContentTypeDefinition[]): string {
  const existingList = existingTypes.length ? existingTypes.map(summarizeExistingType).join("\n") : "(none yet)";
  return [
    "You are the schema-design assistant for drycms, a headless content management system. You help an administrator design or extend its content types (database tables) through a strictly structured, choice-driven interview - never free-form chat.",
    "",
    "drycms content-type model:",
    '- A content type is "collection" (many rows), "singleton" (exactly one row), or "component" (an embeddable sub-shape - not offered in this wizard).',
    "- A field has: name (machine identifier, letters/digits only, no spaces/underscores/hyphens), label (display name), type, optional description, optional required.",
    `- Table and field "name"s can never be one of these reserved words (case-insensitive): ${[...RESERVED_NAMES].join(", ")}. Use a synonym instead (e.g. "heading" instead of "title", "slugValue" instead of "slug") when the natural word is reserved.`,
    `- Allowed field types: ${WIZARD_FIELD_TYPES.join(", ")}, relation.`,
    '  - A "select" field must include "options": a non-empty array of plain strings.',
    `  - A "relation" field must include "relationTarget" (another table's "name" - either an existing one listed below, or another table's "name" in this same proposal) and may include "relationCardinality" (one of ${WIZARD_RELATION_CARDINALITIES.join(", ")}; default manyToOne).`,
    "- A table may also enable these optional built-in features (booleans, only enable what's genuinely useful - most tables need none of these):",
    `  - "${WIZARD_FEATURE_KEYS[0]}" (collection or singleton): adds a URL-friendly Slug field alongside a Title field.`,
    `  - "${WIZARD_FEATURE_KEYS[1]}" (collection only): lets an entry be saved as a private draft before publishing.`,
    `  - "${WIZARD_FEATURE_KEYS[2]}" (collection only): lets an entry be set to go live automatically at a future date/time.`,
    `  - "${WIZARD_FEATURE_KEYS[3]}" (collection only): records when each entry was created/last updated.`,
    `  - "${WIZARD_FEATURE_KEYS[4]}" (collection or singleton): adds Title/Description/Image fields for search engines and social previews.`,
    `  - "${WIZARD_FEATURE_KEYS[5]}" (collection only): lets entries be manually drag-reordered.`,
    "  Features can only be enabled here, never disabled - never propose turning one off.",
    "",
    "Existing content types already in this project (propose adding/removing fields on one of these instead of a new table when that fits better, and use their names as relation targets):",
    existingList,
    "",
    "Interview protocol - reply with EXACTLY ONE JSON object per turn, nothing else (no prose, no markdown fences, no trailing commentary):",
    '1. `{"kind":"question","topic":"...","question":"...","choices":[{"id":"...","label":"..."}],"multi":true|false,"allowOther":true|false}` - ask ONE clarifying, multiple-choice question at a time (1 to 8 choices). Set "allowOther": true only when the option space is inherently open-ended (e.g. naming a table), so the interface can accept one short typed value alongside your choices.',
    "   Ask AT MOST 3 questions total, and only if genuinely necessary to avoid a bad guess - prefer inferring sensible defaults (common field names/types for the kind of table requested) over asking. Most requests should need 0-1 questions before you have enough to propose something concrete; never ask a question just to confirm something you can reasonably infer yourself.",
    '2. As soon as you have enough information (which is often immediately), send `{"kind":"proposal","question":"...","tables":[...]}` - the exact tables/fields/features you intend to create or change. This is the FINAL turn: the admin reviews, keeps/drops, and reorders your suggested tables directly in the interface and stages them from exactly what you send - you will not be asked again and there is no further turn, so make it complete and correct the first time. Use "question" for a short one-line intro/summary of what you propose (e.g. "Here is what I would build:"), not a question expecting a reply.',
    "",
    'Each entry in "tables" is `{"name":"...","label":"...","kind":"collection"|"singleton","description":"...","isNew":true|false,"fields":[...],"removeFields":["..."],"features":{...}}`. Set "isNew": false and "name" to an exact existing type\'s name above when you are only adding or removing fields/features on it - "removeFields" (existing field names to stage for removal) is only valid then. A brand-new table needs "isNew": true, a fresh unique "name", and at least one field. "features" is optional on any table.',
    "",
    `Language: the person you're talking to reads "${lang}". Write every "question" and every "label"/"description" (on choices, tables, and fields) in "${lang}". Never translate "name" (machine identifiers), "type", "kind", "topic", choice "id"s, "relationTarget", "relationCardinality", or feature keys - those always stay the exact English/ASCII token specified above.`,
  ].join("\n");
}

function validateWizardHistory(value: unknown): ChatMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 60) {
    throw new Error("AI wizard history must be an array of at most 60 messages.");
  }
  return value.map((message, index) => {
    if (
      !message ||
      typeof message !== "object" ||
      ((message as ChatMessage).role !== "user" && (message as ChatMessage).role !== "assistant") ||
      typeof (message as ChatMessage).text !== "string" ||
      !(message as ChatMessage).text.trim()
    ) {
      throw new Error(`AI wizard history entry ${index} is invalid.`);
    }
    const text = (message as ChatMessage).text;
    if (text.length > 20_000) throw new Error(`AI wizard history entry ${index} is too long.`);
    return { role: (message as ChatMessage).role, text };
  });
}

async function runWizardTurn(
  context: DryRouteContext,
  messages: ChatMessage[],
  aiKeyName: string | undefined,
  aiModel: string | undefined,
  onDelta?: (delta: string) => void,
): Promise<{ text: string; aiLabel: string }> {
  let text = "";
  const { stream, aiLabel } = await createChatStream(context, messages, (delta) => {
    text += delta;
    onDelta?.(delta);
  }, aiKeyName, aiModel);
  // The stream is SSE-encoded `data: {...}` events (same shape `/api/ai/chat`
  // forwards to the browser) - draining it without decoding those payloads
  // would silently swallow a real `{error}` event (CLI not found, timed out,
  // provider failure) and only ever surface a generic "empty response",
  // regardless of what actually went wrong.
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const event = JSON.parse(line.slice(5).trim()) as { error?: string };
        if (event.error) streamError = event.error;
      } catch {
        // Ignore a malformed/partial line - real payloads are always one JSON object per `data:` line.
      }
    }
  }
  if (streamError) throw new Error(streamError);
  if (!text.trim()) throw new Error("AI returned an empty response.");
  return { text, aiLabel };
}

/**
 * Unlike the old prose chat, a wizard turn's actual PAYLOAD (the structured
 * `question`/`proposal`/`done` object) still only ever appears once fully
 * formed and validated - a half-parsed JSON object isn't renderable as
 * choice chips. What streams incrementally here is the model's raw output
 * as it's generated (`{delta}` events, same shape `/api/ai/chat` uses) so
 * the dialog can show real progress instead of a silent wait; the client
 * only swaps to the parsed UI once a `{turn}` event (or `{error}`) arrives.
 * A `{retry: true}` event marks the raw preview restarting because the
 * previous attempt didn't validate.
 */
function streamWizard(
  context: DryRouteContext,
  history: ChatMessage[],
  aiKeyName: string | undefined,
  aiModel: string | undefined,
  goal: string | undefined,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const { schema } = getContentAdapters(context);
          const existingTypes = (await schema.listContentTypes()).filter((type) => !type.hidden);
          const kickoff = goal
            ? `\n\nThe admin's own starting description of what they want: "${goal}"\n\nUse it as real context. Ask a clarifying question only if genuinely necessary to avoid a bad guess; otherwise move straight to a "proposal" built from this description.`
            : history.length === 0
              ? "\n\nBegin: ask your first clarifying question."
              : "";
          const priming: ChatMessage = {
            role: "user",
            text: `${buildWizardSystemPrompt(ai.lang, existingTypes)}${kickoff}`,
          };
          let messages: ChatMessage[] = [priming, ...history];
          let lastError = "";
          for (let attempt = 0; attempt < WIZARD_MAX_ATTEMPTS; attempt++) {
            if (attempt > 0) controller.enqueue(streamEvent({ retry: true }));
            const result = await runWizardTurn(context, messages, aiKeyName, aiModel, (delta) => {
              controller.enqueue(streamEvent({ delta }));
            });
            const parsed = extractWizardJson(result.text);
            const validation = parseWizardTurn(parsed);
            if (validation.ok) {
              controller.enqueue(streamEvent({ turn: validation.turn, aiLabel: result.aiLabel }));
              controller.close();
              return;
            }
            lastError = validation.error;
            messages = [
              ...messages,
              { role: "assistant", text: result.text },
              {
                role: "user",
                text: `Your last reply did not match the required JSON structure: ${validation.error} Resend a single corrected JSON object only - no prose, no markdown fences.`,
              },
            ];
          }
          controller.enqueue(streamEvent({ error: `AI could not produce a valid structured reply after ${WIZARD_MAX_ATTEMPTS} attempts. Last issue: ${lastError}` }));
          controller.close();
        } catch (error) {
          controller.enqueue(streamEvent({ error: safeAiMessage(error) }));
          controller.close();
        }
      })();
    },
  });
}

function handleWizard(context: DryRouteContext, body: WizardHttpRequest): Response {
  const history = validateWizardHistory(body.history);
  const aiKeyName = typeof body.aiKeyName === "string" && body.aiKeyName.trim() ? body.aiKeyName.trim() : undefined;
  const aiModel = typeof body.aiModel === "string" && body.aiModel.trim() ? body.aiModel.trim() : undefined;
  const goal = history.length === 0 && typeof body.goal === "string" && body.goal.trim()
    ? body.goal.trim().slice(0, 2000)
    : undefined;

  if (activeAiStreams >= MAX_ACTIVE_AI_STREAMS) {
    return jsonResponse({ error: "rate_limited", message: "Too many AI requests are active. Try again shortly." }, 429);
  }
  activeAiStreams += 1;
  const stream = streamWizard(context, history, aiKeyName, aiModel, goal);
  return new Response(trackAiStream(stream, () => {
    activeAiStreams = Math.max(0, activeAiStreams - 1);
  }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

interface RewriteSelectionRequest {
  passage?: string;
  instruction?: string;
  aiKeyName?: string;
  /** Whether the client's own selection sat entirely inside ONE existing
   * textblock (`ai-rewrite-button.tsx`'s `isInlineSelection` - mid-heading,
   * mid-paragraph, mid-list-item), as opposed to spanning whole blocks. The
   * reply format has to match: wrapping an inline-scoped reply in its own
   * `<h2>`/`<p>` would corrupt the surrounding tag the moment the client
   * splices it back in (see `replaceSelectionWithHtml`'s own `inline` flag
   * and `html.ts`'s `exportFragmentHtml` doc comment for the full story). */
  inline?: boolean;
}

function buildRewriteSelectionSystemPrompt(lang: string, inline: boolean): string {
  return [
    "You rewrite a passage of RichText content inside drycms exactly as instructed. Reply with ONLY the rewritten text - no prose, no markdown fences, no explanation of what you changed.",
    inline
      ? 'The passage is an inline run of text INSIDE a single existing block (e.g. mid-heading, mid-paragraph, mid-list-item) - it is NOT a whole block on its own. Reply with ONLY inline markup at most: plain text plus, only where the passage itself already used them, <strong>, <em>, <u>, <a href="...">, <br>. Do NOT wrap the reply in <p>, <h2>-<h6>, <blockquote>, <ul>, <ol>, or <li> - the surrounding block tag already exists in the document and stays exactly as it is; adding one here would corrupt it.'
      : 'Use ONLY these HTML tags: <p>, <h2>-<h6>, <blockquote>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href="...">, <br>. No classes, no style attributes, no <div>/<span>, no images, no tables.',
    `Write in "${lang}" unless the instruction explicitly asks for a different language.`,
  ].join("\n");
}

function extractHtmlFragment(raw: string): string {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(raw);
  return (fenced ? fenced[1]! : raw).trim();
}

/**
 * `status/magic-write.md` Phase 4 - unlike Magic Write's own structured YAML
 * turns, this reply IS the rewritten HTML fragment directly (see that file's
 * "RichText chọn đoạn để AI viết lại" section: "không cần đổi protocol").
 * Reuses `runWizardTurn` as-is (a generic "collect one AI reply, surface a
 * mid-stream provider error" helper, nothing wizard-specific about its
 * mechanics) rather than writing a third near-identical copy.
 */
function streamRewriteSelection(context: DryRouteContext, passage: string, instruction: string, inline: boolean, aiKeyName: string | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const messages: ChatMessage[] = [
            {
              role: "user",
              text: `${buildRewriteSelectionSystemPrompt(ai.lang, inline)}\n\nCurrent passage:\n${passage}\n\nInstruction: ${instruction}`,
            },
          ];
          const result = await runWizardTurn(context, messages, aiKeyName, undefined, (delta) => {
            controller.enqueue(streamEvent({ delta }));
          });
          const html = sanitizeAiRichTextHtml(extractHtmlFragment(result.text));
          controller.enqueue(streamEvent({ html }));
          controller.close();
        } catch (error) {
          controller.enqueue(streamEvent({ error: safeAiMessage(error) }));
          controller.close();
        }
      })();
    },
  });
}

function handleRewriteSelection(context: DryRouteContext, body: RewriteSelectionRequest): Response {
  const passage = typeof body.passage === "string" ? body.passage.trim() : "";
  if (!passage) return jsonResponse({ error: "invalid_request", message: "Select some text to rewrite first." }, 400);
  if (passage.length > 20_000) return jsonResponse({ error: "invalid_request", message: "That selection is too long." }, 400);
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) return jsonResponse({ error: "invalid_request", message: "Describe how to rewrite this passage first." }, 400);
  if (instruction.length > 2_000) return jsonResponse({ error: "invalid_request", message: "That instruction is too long." }, 400);
  const aiKeyName = typeof body.aiKeyName === "string" && body.aiKeyName.trim() ? body.aiKeyName.trim() : undefined;
  const inline = body.inline === true;

  if (!acquireAiStreamSlot()) {
    return jsonResponse({ error: "rate_limited", message: "Too many AI requests are active. Try again shortly." }, 429);
  }
  const stream = streamRewriteSelection(context, passage, instruction, inline, aiKeyName);
  return new Response(trackAiStream(stream, releaseAiStreamSlot), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export const POST: DryRouteHandler = async (context: DryRouteContext) => {
  try {
    // Magic Write is scoped by the entry's own edit/setting permission (see
    // `ai-magic-write.ts`'s own `checkAccess` call), not the Super-Admin-only
    // gate every other AI route below uses - dispatched before that gate so
    // a non-Super-Admin editor with real content-entry permissions isn't
    // rejected before ever reaching it.
    if (context.params.slug === "magic-write") {
      return handleMagicWrite(context, await context.request.json());
    }
    // "Rewrite selection" (status/magic-write.md Phase 4) has no
    // content-type/entry context to check a resource permission against -
    // it only rewrites text the admin already has this RichText field open
    // to edit, whatever page that is. Any authenticated session is enough
    // (handler.ts's own central gate already rejects an anonymous request
    // to this whole segment before dispatch ever reaches here).
    if (context.params.slug === "rewrite-selection") {
      return handleRewriteSelection(context, await context.request.json());
    }
    const denied = await requireSuperAdmin(context, "Only Super Admin can use AI chat.");
    if (denied) return denied;
    if (context.params.slug === "check") {
      await checkAiKey(context, await context.request.json() as CheckKeyRequest);
      return jsonResponse({ ok: true, message: "AI key is valid for this model." });
    }
    if (context.params.slug === "models") {
      const models = await listAiModels(context, await context.request.json() as ModelsRequest);
      return jsonResponse({ models });
    }
    if (context.params.slug === "wizard") {
      return handleWizard(context, await context.request.json() as WizardHttpRequest);
    }
    if (activeAiStreams >= MAX_ACTIVE_AI_STREAMS) {
      return jsonResponse({ error: "rate_limited", message: "Too many AI requests are active. Try again shortly." }, 429);
    }
    const body = await context.request.json() as ChatRequest;
    const conversation = resolveChatConversation(context, body);
    const assistant = { text: "" };
    activeAiStreams += 1;
    let stream: ReadableStream<Uint8Array>;
    let aiLabel = "AI";
    try {
      const result = await createChatStream(context, conversation.messages, (delta) => {
        assistant.text += delta;
      });
      stream = result.stream;
      aiLabel = result.aiLabel;
    } catch (error) {
      activeAiStreams -= 1;
      throw error;
    }
    const trackedStream = conversation.key
      ? stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, transformController) {
            transformController.enqueue(chunk);
          },
          flush() {
            if (assistant.text.trim()) rememberConversation(conversation.key!, [
              ...conversation.messages,
              { role: "assistant", text: assistant.text },
            ]);
          },
        }))
      : stream;
    return new Response(trackAiStream(trackedStream, () => {
      activeAiStreams = Math.max(0, activeAiStreams - 1);
    }), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-DryCMS-AI": aiLabel,
      },
    });
  } catch (error) {
    return errorResponse(error, error instanceof SyntaxError ? 400 : 502);
  }
};
