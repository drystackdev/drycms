import { ai, content } from "../config.js";
import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { decryptSecret } from "../../lib/secret-crypto.js";
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
}

interface CheckKeyRequest {
  provider?: string;
  key?: string;
  model?: string;
  url?: string;
}

interface ServerCredential {
  provider: "openai" | "anthropic";
  apiKey: string;
  baseUrl: string;
  model: string;
}

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

function providerFromEntry(value: unknown): "openai" | "anthropic" | "custom" {
  const provider = String(value ?? "").trim().toLowerCase();
  if (provider === "chatgpt" || provider === "openai") return "openai";
  if (provider === "anthropic" || provider === "claude") return "anthropic";
  if (provider === "custom") return "custom";
  throw new Error(`Unsupported AI Key provider "${String(value)}".`);
}

async function readServerCredential(context: DryRouteContext): Promise<ServerCredential> {
  const serverAi = ai;
  if (serverAi.mode !== "server") throw new Error("Server AI mode is not configured.");
  const schema = getSchemaAdapter(context);
  const entries = getEntryAdapter(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.name === "aiKey");
  if (!type) throw new Error('The system collection "aiKey" is not available.');
  const page = await entries.listEntries(type, allTypes, { page: 0, pageSize: 10_000 });
  const selected = serverAi.keyName
    ? page.rows.find((row) => String(row.value.name ?? "") === serverAi.keyName)
    : page.rows[0];
  if (!selected) throw new Error(serverAi.keyName ? `AI Key "${serverAi.keyName}" was not found.` : "No AI Key is configured.");
  const raw = await entries.getRawEntry(type, selected.id);
  if (!raw || typeof raw.key !== "string") throw new Error(`AI Key "${String(selected.value.name ?? "")}" has no secret key.`);
  const providerEntry = providerFromEntry(selected.value.provider);
  const provider = providerEntry === "custom" ? serverAi.provider : providerEntry;
  const baseUrl = typeof selected.value.url === "string" && selected.value.url.trim() ? selected.value.url.trim().replace(/\/+$/, "") : serverAi.baseUrl;
  const entryModel = typeof selected.value.model === "string" ? selected.value.model.trim() : "";
  return { provider, apiKey: await decryptSecret(raw.key), baseUrl, model: entryModel || serverAi.model };
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

async function checkAiKey(body: CheckKeyRequest): Promise<void> {
  const rawProvider = String(body.provider ?? "").trim();
  const apiKey = String(body.key ?? "").trim();
  const model = String(body.model ?? "").trim();
  if (!apiKey || !model) throw new Error("A key and model are required.");
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

export const POST: DryRouteHandler = async (context: DryRouteContext) => {
  try {
    const denied = await requireSuperAdmin(context);
    if (denied) return denied;
    if (context.params.slug === "check") {
      await checkAiKey(await context.request.json() as CheckKeyRequest);
      return jsonResponse({ ok: true, message: "AI key is valid for this model." });
    }
    const body = await context.request.json() as ChatRequest;
    const messages = validateMessages(body.messages);
    const text = ai.mode === "local"
      ? await runLocalCli(messages)
      : await requestServerAiWithCredential(messages, await readServerCredential(context));
    return jsonResponse({ message: { role: "assistant", text }, provider: ai.mode === "local" ? ai.provider : "server" });
  } catch (error) {
    return errorResponse(error, error instanceof SyntaxError ? 400 : 502);
  }
};
