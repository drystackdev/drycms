import { ai, content } from "../config.js";
import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { decryptSecret } from "../../lib/secret-crypto.js";
import { decodeEntryId } from "../../lib/id-hash.js";
import { resolveAccess } from "../../content-types/access.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../../content-types/engine/index.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import type { ContentEngineAdapter } from "../../content-types/engine/types.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { forbiddenResponse, jsonResponse, unauthenticatedResponse } from "../route-helpers.js";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
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

const moduleSchemaAdapter: ContentEngineAdapter | undefined = content.engine !== "D1" ? createContentEngineAdapter(content) : undefined;
const moduleEntryAdapter: ContentEntryEngineAdapter | undefined = content.engine !== "D1" ? createContentEntryEngineAdapter(content) : undefined;

function getSchemaAdapter(context: DryRouteContext): ContentEngineAdapter {
  return moduleSchemaAdapter ?? createContentEngineAdapter(content, context.env);
}

function getEntryAdapter(context: DryRouteContext): ContentEntryEngineAdapter {
  return moduleEntryAdapter ?? createContentEntryEngineAdapter(content, context.env);
}

async function requireSuperAdmin(context: DryRouteContext): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const schema = getSchemaAdapter(context);
  const entries = getEntryAdapter(context);
  const allTypes = await schema.listContentTypes();
  const access = await resolveAccess(entries, allTypes, context.session);
  return access?.isSuperAdmin ? null : forbiddenResponse("Only Super Admin can use AI chat.");
}

function providerFromEntry(value: unknown): "openai" | "anthropic" | "google" | "custom" {
  const provider = String(value ?? "").trim().toLowerCase();
  if (provider === "chatgpt" || provider === "openai") return "openai";
  if (provider === "anthropic" || provider === "claude") return "anthropic";
  if (provider === "google" || provider === "gemini") return "google";
  if (provider === "custom") return "custom";
  throw new Error(`Unsupported AI Key provider "${String(value)}".`);
}

async function readServerCredentials(context: DryRouteContext): Promise<ServerCredential[]> {
  const serverAi = ai;
  if (serverAi.mode !== "server") throw new Error("Server AI mode is not configured.");
  const schema = getSchemaAdapter(context);
  const entries = getEntryAdapter(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.name === "aiKey");
  if (!type) throw new Error('The system collection "aiKey" is not available.');
  const page = await entries.listEntries(type, allTypes, { page: 0, pageSize: 10_000 });
  const orderedRows = serverAi.keyName
    ? [...page.rows].sort((left, right) => {
        const leftPreferred = String(left.value.name ?? "") === serverAi.keyName;
        const rightPreferred = String(right.value.name ?? "") === serverAi.keyName;
        return Number(rightPreferred) - Number(leftPreferred);
      })
    : page.rows;
  if (serverAi.keyName && !orderedRows.some((row) => String(row.value.name ?? "") === serverAi.keyName)) {
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
      const baseUrl = typeof row.value.url === "string" && row.value.url.trim()
        ? row.value.url.trim().replace(/\/+$/, "")
        : provider === "google" ? "https://generativelanguage.googleapis.com" : serverAi.baseUrl;
      const entryModel = typeof row.value.model === "string" ? row.value.model.trim() : "";
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
  return jsonResponse(
    { error: "ai_error", message: error instanceof Error ? error.message : "AI request failed." },
    status,
  );
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
  conversations.set(key, {
    messages: messages.slice(-40),
    expiresAt: Date.now() + CONVERSATION_TTL_MS,
  });
}

function promptForCli(messages: ChatMessage[]): string {
  return [
    "You are helping build a content type in drycms. Answer the user's latest request clearly and briefly.",
    ...messages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`),
    "Assistant:",
  ].join("\n\n");
}

async function runLocalCli(messages: ChatMessage[]): Promise<string> {
  const localAi = ai;
  if (localAi.mode !== "local") throw new Error("Local AI mode is not configured.");
  const { spawn } = await import("node:child_process");
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

function streamEvent(payload: { delta?: string; done?: boolean; error?: string }): Uint8Array {
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
        const { spawn } = await import("node:child_process");
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
          controller.enqueue(streamEvent({ error: `Unable to start ${localAi.command}: ${error.message}` }));
          controller.close();
        });
        child.on("close", (code) => {
          void (async () => {
            clearTimeout(timer);
            if (settled) return;
            if (code !== 0) {
              settled = true;
              controller.enqueue(streamEvent({ error: stderr.trim() || `${localAi.command} exited with code ${code ?? "unknown"}.` }));
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
        controller.enqueue(streamEvent({ error: error instanceof Error ? error.message : "AI request failed." }));
        controller.close();
      });
    },
  });
}

async function streamServerAiWithCredential(
  messages: ChatMessage[],
  credential: ServerCredential,
  onDelta: (delta: string) => void,
): Promise<ReadableStream<Uint8Array>> {
  if (credential.provider === "google") {
    return streamGoogleAiWithCredential(messages, credential, onDelta);
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
            input: messages.map((message) => ({ role: message.role, content: message.text })),
          }
        : {
            model: credential.model,
            stream: true,
            max_tokens: 2048,
            messages: messages.map((message) => ({ role: message.role, content: message.text })),
          }),
      signal: controller.signal,
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
          streamController.enqueue(streamEvent({ error: event.error?.message || "AI provider failed." }));
        }
      }).then(() => {
        clearTimeout(timer);
        streamController.enqueue(streamEvent({ done: true }));
        streamController.close();
      }).catch((error) => {
        clearTimeout(timer);
        streamController.enqueue(streamEvent({ error: error instanceof Error ? error.message : "AI stream failed." }));
        streamController.close();
      });
    },
    cancel() {
      clearTimeout(timer);
      controller.abort();
    },
  });
}

async function streamGoogleAiWithCredential(
  messages: ChatMessage[],
  credential: ServerCredential,
  onDelta: (delta: string) => void,
): Promise<ReadableStream<Uint8Array>> {
  const model = credential.model.replace(/^models\//, "");
  const modelUrl = `${credential.baseUrl}/v1beta/models/${encodeURIComponent(model)}`;
  let modelResponse: Response;
  try {
    modelResponse = await fetch(`${modelUrl}?key=${encodeURIComponent(credential.apiKey)}`, {
      signal: AbortSignal.timeout(Math.min(ai.timeoutMs, 15_000)),
    });
  } catch (error) {
    throw new AiProviderError(error instanceof Error ? error.message : "Google model lookup timed out.", 408);
  }
  const modelBody = await modelResponse.json().catch(() => ({})) as {
    supportedGenerationMethods?: unknown;
    error?: { message?: string };
  };
  if (!modelResponse.ok) {
    throw new AiProviderError(modelBody.error?.message || `Google returned HTTP ${modelResponse.status}.`, modelResponse.status);
  }

  const supportsStreaming = Array.isArray(modelBody.supportedGenerationMethods)
    && modelBody.supportedGenerationMethods.includes("streamGenerateContent");
  const controller = new AbortController();
  // Non-streaming Gemini models can otherwise hold the request until the
  // global 120s timeout. Keep the Builder responsive and let the key
  // fallback loop try another credential on a provider timeout.
  const timer = setTimeout(() => controller.abort(), Math.min(ai.timeoutMs, 30_000));
  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.text }],
  }));
  try {
    const response = await fetch(
      `${modelUrl}:${supportsStreaming
        ? `streamGenerateContent?alt=sse&key=${encodeURIComponent(credential.apiKey)}`
        : `generateContent?key=${encodeURIComponent(credential.apiKey)}`}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new AiProviderError(body.error?.message || `Google returned HTTP ${response.status}.`, response.status);
    }

    if (!supportsStreaming) {
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
          streamController.enqueue(streamEvent({ error: error instanceof Error ? error.message : "AI stream failed." }));
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

async function createChatStream(
  context: DryRouteContext,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
): Promise<ReadableStream<Uint8Array>> {
  if (ai.mode === "local") return streamLocalCli(messages, onDelta);
  const credentials = await readServerCredentials(context);
  const errors: Error[] = [];
  for (const credential of credentials) {
    try {
      return await streamServerAiWithCredential(messages, credential, onDelta);
    } catch (error) {
      if (!isAiKeyFallbackError(error)) throw error;
      errors.push(error instanceof Error ? error : new Error("AI provider request failed."));
    }
  }
  throw allAiKeysFailed(errors);
}

async function readStoredAiKey(context: DryRouteContext, entryIdValue?: string, entryName?: string): Promise<string> {
  const schema = getSchemaAdapter(context);
  const entries = getEntryAdapter(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.name === "aiKey");
  if (!type) throw new Error('The system collection "aiKey" is not available.');
  let raw: Record<string, unknown> | null = null;
  if (entryIdValue) {
    const entryId = decodeEntryId(entryIdValue);
    if (entryId !== null) raw = await entries.getRawEntry(type, entryId);
  }
  if (!raw && entryName?.trim()) {
    const page = await entries.listEntries(type, allTypes, { page: 0, pageSize: 10_000 });
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
    const baseUrl = (String(body.url ?? "").trim() || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ai.timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`, {
        signal: controller.signal,
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
  const baseUrl = (String(body.url ?? "").trim() || configuredBaseUrl).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs);
  try {
    if (provider === "openai") {
      const response = await fetch(`${baseUrl}/v1/models/${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
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
    const url = String(body.url ?? "").trim();
    if (!url) throw new Error("URL is required for Custom provider.");
    if (!apiKey) throw new Error("API key is required to load models.");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(ai.timeoutMs),
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
  const url = (String(body.url ?? "").trim() || (
    provider === "google"
      ? "https://generativelanguage.googleapis.com"
      : provider === "anthropic"
        ? "https://api.anthropic.com"
        : provider === "openai"
          ? "https://api.openai.com"
          : ""
  )).replace(/\/+$/, "");
  if (!url) throw new Error(`Unsupported AI Key provider "${String(body.provider)}".`);

  if (provider === "google") {
    const response = await fetch(`${url}/v1beta/models?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(ai.timeoutMs),
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

export const POST: DryRouteHandler = async (context: DryRouteContext) => {
  try {
    const denied = await requireSuperAdmin(context);
    if (denied) return denied;
    if (context.params.slug === "check") {
      await checkAiKey(context, await context.request.json() as CheckKeyRequest);
      return jsonResponse({ ok: true, message: "AI key is valid for this model." });
    }
    if (context.params.slug === "models") {
      const models = await listAiModels(context, await context.request.json() as ModelsRequest);
      return jsonResponse({ models });
    }
    const body = await context.request.json() as ChatRequest;
    const conversation = resolveChatConversation(context, body);
    const assistant = { text: "" };
    const stream = await createChatStream(context, conversation.messages, (delta) => {
      assistant.text += delta;
    });
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
    return new Response(trackedStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error, error instanceof SyntaxError ? 400 : 502);
  }
};
