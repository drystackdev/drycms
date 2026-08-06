import { ai, storage } from "../config.js";
import type { DryRouteContext } from "../context.js";
import { jsonResponse } from "../route-helpers.js";
import { getContentAdapters } from "../content-adapters.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { checkAccess } from "./content-entries.js";
import { buildEntryFieldTree } from "../../content-types/engine/entry-tree.js";
import { loadRelationContext } from "../../content-types/engine/entry-relation-context.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import {
  extractMagicWriteYaml,
  parseMagicWriteYaml,
  type MagicWriteChoice,
} from "../../content-types/ai-magic-write-protocol.js";
import { describeFieldsForPrompt, buildMagicWriteSystemPrompt } from "../../content-types/ai-magic-write-prompt.js";
import { applyMagicWriteFields } from "../../content-types/ai-magic-write-fields.js";
import {
  acquireAiStreamSlot,
  createChatStream,
  releaseAiStreamSlot,
  safeAiMessage,
  streamEvent,
  trackAiStream,
  type ChatMessage,
} from "./ai.js";

interface MagicWriteHttpRequest {
  typeSlug?: string;
  entryId?: string;
  currentValue?: unknown;
  prompt?: string;
  /** Prior turns of this same Magic Write conversation - only non-empty when
   * this is a follow-up request after the model asked a clarifying question
   * (`kind: question`) and the admin answered it. Same shape/role as
   * `ai-wizard-protocol.ts`'s wizard history; validated the same way. */
  history?: unknown;
  /** Context images (status/magic-write.md decision #3) - the client resends
   * the SAME picked set on every request of one Magic Write session
   * (initial and any follow-up after a clarifying question), since each
   * server call rebuilds its own provider request from scratch. */
  images?: unknown;
  aiKeyName?: string;
}

interface MagicWriteImageInput {
  /** The original storage path (unresized) - re-verified via `storage.stat()`
   * before being trusted for anything (the prompt's context list, an
   * `image`-field write, a RichText `<img src>`). */
  path: string;
  mimeType: string;
  base64: string;
}

const ALLOWED_MAGIC_WRITE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_MAGIC_WRITE_IMAGES = 6;
/** ~1.5 MiB decoded per image - generous headroom over the ~240px-resized
 * images `MagicWriteDialog.tsx` actually sends (typically a few KB each). */
const MAX_MAGIC_WRITE_IMAGE_BASE64_CHARS = 2_000_000;

function validateMagicWriteImages(value: unknown): MagicWriteImageInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MAGIC_WRITE_IMAGES) {
    throw new Error(`Magic Write accepts at most ${MAX_MAGIC_WRITE_IMAGES} context images.`);
  }
  return value.map((raw, index) => {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
    const base64 = typeof record.base64 === "string" ? record.base64 : "";
    if (!path || !ALLOWED_MAGIC_WRITE_IMAGE_MIME_TYPES.has(mimeType) || !base64 || base64.length > MAX_MAGIC_WRITE_IMAGE_BASE64_CHARS) {
      throw new Error(`Magic Write image ${index} is invalid.`);
    }
    return { path, mimeType, base64 };
  });
}

interface MagicWriteValidatedRequest {
  typeSlug: string;
  currentValue: EntryValue;
  prompt: string;
  history: ChatMessage[];
  images: MagicWriteImageInput[];
  aiKeyName?: string;
}

function validateMagicWriteHistory(value: unknown): ChatMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Magic Write history must be an array of at most 20 messages.");
  }
  return value.map((message, index) => {
    if (
      !message ||
      typeof message !== "object" ||
      ((message as ChatMessage).role !== "user" && (message as ChatMessage).role !== "assistant") ||
      typeof (message as ChatMessage).text !== "string" ||
      !(message as ChatMessage).text.trim()
    ) {
      throw new Error(`Magic Write history entry ${index} is invalid.`);
    }
    const text = (message as ChatMessage).text;
    if (text.length > 100_000) throw new Error(`Magic Write history entry ${index} is too long.`);
    return { role: (message as ChatMessage).role, text };
  });
}

function validateMagicWriteRequest(body: MagicWriteHttpRequest): MagicWriteValidatedRequest {
  const typeSlug = typeof body.typeSlug === "string" ? body.typeSlug.trim() : "";
  if (!typeSlug) throw new Error("Magic Write requires a content type.");

  const history = validateMagicWriteHistory(body.history);

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (history.length === 0 && !prompt) throw new Error("Describe what you want Magic Write to do first.");
  if (prompt.length > 4_000) throw new Error("That prompt is too long.");

  const currentValue: EntryValue = body.currentValue && typeof body.currentValue === "object" && !Array.isArray(body.currentValue)
    ? (body.currentValue as EntryValue)
    : {};

  const images = validateMagicWriteImages(body.images);

  const aiKeyName = typeof body.aiKeyName === "string" && body.aiKeyName.trim() ? body.aiKeyName.trim() : undefined;

  return {
    typeSlug,
    currentValue,
    prompt,
    history,
    images,
    aiKeyName,
  };
}

/** Same drain-and-collect shape as `ai.ts`'s own `runWizardTurn` - kept as a
 * separate, small copy rather than extracting a shared helper, so the
 * schema wizard's already-tested code path stays completely untouched (see
 * `status/magic-write.md`). */
async function runMagicWriteTurn(
  context: DryRouteContext,
  messages: ChatMessage[],
  aiKeyName: string | undefined,
  onDelta: (delta: string) => void,
): Promise<{ text: string; aiLabel: string }> {
  let text = "";
  const { stream, aiLabel } = await createChatStream(context, messages, (delta) => {
    text += delta;
    onDelta(delta);
  }, aiKeyName, MAGIC_WRITE_MAX_OUTPUT_TOKENS, MAGIC_WRITE_TIMEOUT_MS);
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
        // Ignore a malformed/partial line - real payloads are one JSON object per `data:` line.
      }
    }
  }
  if (streamError) throw new Error(streamError);
  if (!text.trim()) throw new Error("AI returned an empty response.");
  return { text, aiLabel };
}

const MAGIC_WRITE_MAX_ATTEMPTS = 3;
/** A whole entry's worth of fields (title/body/excerpt/SEO/...) easily runs
 * past the 2048-token default `ai.ts`'s Anthropic branch otherwise applies -
 * see that function's own doc comment. Only affects Anthropic (OpenAI/Google
 * already have no such cap in this codebase). */
const MAGIC_WRITE_MAX_OUTPUT_TOKENS = 8192;
/** Google's own branch otherwise caps every request at 30s regardless of
 * `ai.timeoutMs` - Magic Write's requests (images + a full entry's worth of
 * fields) routinely need longer than that just to start streaming back, and
 * the resulting client-side abort was surfacing as a misleading "all AI
 * keys exhausted" error. Anthropic/OpenAI already use the full
 * `ai.timeoutMs` (120s default) with no separate cap, so this only changes
 * Google's behavior. */
const MAGIC_WRITE_TIMEOUT_MS = 90_000;

interface MagicWriteFieldsTurnEvent {
  kind: "fields";
  summary: string;
  fields: EntryValue;
  writtenFieldNames: string[];
}

interface MagicWriteQuestionTurnEvent {
  kind: "question";
  topic: string;
  question: string;
  choices: MagicWriteChoice[];
  multi: boolean;
  allowOther?: boolean;
}

function streamMagicWrite(context: DryRouteContext, request: MagicWriteValidatedRequest): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const { schema, entries } = getContentAdapters(context);
          const allTypes = await schema.listContentTypes();
          const type = allTypes.find((candidate) => candidate.name === request.typeSlug && candidate.kind !== "component");
          if (!type) throw new Error(`Content type "${request.typeSlug}" was not found.`);

          const denied = await checkAccess(context, entries, allTypes, type, type.kind === "singleton" ? "setting" : "update");
          if (denied) {
            const body = await denied.json().catch(() => ({})) as { message?: string };
            throw new Error(body.message || "You don't have permission to use Magic Write on this content type.");
          }

          // Never trust a client-claimed path outright - re-verify each one is
          // a real, existing FILE via `storage.stat()` before it becomes part
          // of the prompt, the model's own vision input, or an accepted
          // `image`-field/RichText-`<img>` value (see
          // `status/magic-write.md` decision #3). A stale/deleted/renamed
          // path is silently dropped rather than failing the whole request.
          const storageAdapter = getStorageAdapter(storage, context);
          const verifiedImages = (
            await Promise.all(
              request.images.map(async (image) => {
                const stat = await storageAdapter.stat(image.path).catch(() => null);
                return stat && stat.kind === "file" ? image : null;
              }),
            )
          ).filter((image): image is MagicWriteImageInput => image !== null);
          const allowedImageSrcs = new Set(verifiedImages.map((image) => image.path));
          const chatImages = verifiedImages.map(({ mimeType, base64 }) => ({ mimeType, base64 }));

          const nodes = buildEntryFieldTree(type, allTypes);
          const fieldsDescription = describeFieldsForPrompt(nodes, request.currentValue);
          const relationContext = await loadRelationContext(entries, allTypes, nodes, request.currentValue);
          const systemPrompt = buildMagicWriteSystemPrompt({
            lang: ai.lang,
            typeLabel: type.label,
            fieldsDescription,
            imagePaths: [...allowedImageSrcs],
            relationContext,
          });

          // The admin's own prompt is folded into the priming message only on
          // the very first turn (`history` empty) - a follow-up request (the
          // model asked a clarifying question, the admin answered) carries
          // that exchange forward in `history` instead, same pattern as
          // `ai.ts`'s `streamWizard`/`goal`. The context images are attached
          // to this SAME message on every call regardless (each server call
          // rebuilds its own independent provider request, so the model needs
          // to see them again on a follow-up turn too).
          const kickoff = request.history.length === 0 ? `\n\nWhat the admin wants: "${request.prompt}"` : "";
          const priming: ChatMessage = { role: "user", text: `${systemPrompt}${kickoff}`, images: chatImages };
          let messages: ChatMessage[] = [priming, ...request.history];
          let lastError = "";
          for (let attempt = 0; attempt < MAGIC_WRITE_MAX_ATTEMPTS; attempt++) {
            if (attempt > 0) controller.enqueue(streamEvent({ retry: true }));
            const result = await runMagicWriteTurn(context, messages, request.aiKeyName, (delta) => {
              controller.enqueue(streamEvent({ delta }));
            });
            const validation = parseMagicWriteYaml(extractMagicWriteYaml(result.text));
            if (validation.ok) {
              const turn = validation.turn;
              let event: MagicWriteFieldsTurnEvent | MagicWriteQuestionTurnEvent;
              if (turn.kind === "question") {
                event = turn;
              } else {
                const applied = applyMagicWriteFields(nodes, turn.fields, allowedImageSrcs);
                event = { kind: "fields", summary: turn.summary, fields: applied.value, writtenFieldNames: applied.writtenFieldNames };
              }
              controller.enqueue(streamEvent({ turn: event, aiLabel: result.aiLabel }));
              controller.close();
              return;
            }
            lastError = validation.error;
            messages = [
              ...messages,
              { role: "assistant", text: result.text },
              {
                role: "user",
                text: `Your last reply did not match the required format: ${validation.error} Resend a single corrected reply only, in the exact dialect described above - no prose, no markdown fences.`,
              },
            ];
          }
          controller.enqueue(streamEvent({ error: `AI could not produce a valid reply after ${MAGIC_WRITE_MAX_ATTEMPTS} attempts. Last issue: ${lastError}` }));
          controller.close();
        } catch (error) {
          controller.enqueue(streamEvent({ error: safeAiMessage(error) }));
          controller.close();
        }
      })();
    },
  });
}

export function handleMagicWrite(context: DryRouteContext, body: MagicWriteHttpRequest): Response {
  let request: MagicWriteValidatedRequest;
  try {
    request = validateMagicWriteRequest(body);
  } catch (error) {
    return jsonResponse({ error: "invalid_request", message: error instanceof Error ? error.message : "Invalid request." }, 400);
  }

  if (!acquireAiStreamSlot()) {
    return jsonResponse({ error: "rate_limited", message: "Too many AI requests are active. Try again shortly." }, 429);
  }
  const stream = streamMagicWrite(context, request);
  return new Response(trackAiStream(stream, releaseAiStreamSlot), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
