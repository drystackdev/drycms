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
import { describeFieldsForPrompt, buildMagicWriteSystemPrompt, buildRewriteTurnMessage } from "../../content-types/ai-magic-write-prompt.js";
import { applyMagicWriteFields } from "../../content-types/ai-magic-write-fields.js";
import { sanitizeAiRichTextHtml } from "../../content-types/ai-richtext-sanitize.js";
import { executeMagicFetch } from "./ai-magic-write-fetch.js";
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
  /** Prior turns of this same Magic (chat) conversation - every follow-up
   * request after the first carries the whole conversation so far. Same
   * shape/role as `ai-wizard-protocol.ts`'s wizard history; validated the
   * same way. */
  history?: unknown;
  /** Context images attached to THIS turn only (`status/magic-chat.md`
   * decision C) - base64, already client-resized. Unlike the original Magic
   * Write (`status/magic-write.md` decision #3), these are NOT resent on
   * every subsequent request of the session; only this turn's own message
   * carries their pixels to the model. See `sessionImagePaths` below for how
   * an EARLIER turn's image stays usable as a write target later on. */
  images?: unknown;
  /** Every image path attached anywhere in this session so far (including
   * this turn's own `images`, by path) - text only, no base64. Verified the
   * same way as `images` (`storage.stat()`) and unioned into
   * `allowedImageSrcs`, so the model can still set an `image` field or a
   * RichText `<img src>` to a photo it saw several turns ago even though it
   * can no longer "see" that turn's pixels again (`status/magic-chat.md`
   * decision C - the model describes an image in its own reply when it
   * first sees it, and that description is what carries the reference
   * forward across turns, not a resent image). */
  sessionImagePaths?: unknown;
  aiKeyName?: string;
  /** Which of `aiKeyName`'s own configured models to use for this run - see
   * `ai.ts`'s `WizardHttpRequest.aiModel` doc comment, same shape/pairing. */
  aiModel?: string;
  /** `status/richtext-rewrite-shared-chat.md` - present only when this turn
   * is a RichText "Rewrite selection" request (`AiRewriteButton`'s own call,
   * relayed through `MagicChat.tsx`'s shared conversation): the exact current
   * HTML of the selected passage. When set, `prompt` stays the short display
   * text shown as the admin's chat bubble, and this field's contents are
   * appended server-side (`buildRewriteTurnMessage`) to what the model
   * actually sees, so the bubble/history stay readable while the model still
   * gets the real passage to rewrite. */
  rewritePassage?: string;
  /** Whether `rewritePassage` sits entirely inside ONE existing textblock -
   * see `ai-rewrite-button.tsx`'s `isInlineSelection` and
   * `buildRewriteTurnMessage`'s own doc comment. Meaningless without
   * `rewritePassage`. */
  rewriteInline?: boolean;
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
 * images `MagicChat.tsx` actually sends (typically a few KB each). */
const MAX_MAGIC_WRITE_IMAGE_BASE64_CHARS = 2_000_000;

function validateMagicWriteImages(value: unknown): MagicWriteImageInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MAGIC_WRITE_IMAGES) {
    throw new Error(`Magic accepts at most ${MAX_MAGIC_WRITE_IMAGES} context images per turn.`);
  }
  return value.map((raw, index) => {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
    const base64 = typeof record.base64 === "string" ? record.base64 : "";
    if (!path || !ALLOWED_MAGIC_WRITE_IMAGE_MIME_TYPES.has(mimeType) || !base64 || base64.length > MAX_MAGIC_WRITE_IMAGE_BASE64_CHARS) {
      throw new Error(`Magic image ${index} is invalid.`);
    }
    return { path, mimeType, base64 };
  });
}

const MAX_MAGIC_WRITE_SESSION_IMAGE_PATHS = 40;

/** Text-only companion to `validateMagicWriteImages` - every image path ever
 * attached in this session, not just this turn's (`status/magic-chat.md`
 * decision C). No mimeType/base64 to check, just plain strings; the higher
 * cap (vs. `MAX_MAGIC_WRITE_IMAGES`' per-turn 6) reflects that a long chat
 * can accumulate attachments across many turns without resending any of
 * their bytes. */
function validateMagicWriteSessionImagePaths(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MAGIC_WRITE_SESSION_IMAGE_PATHS) {
    throw new Error(`Magic accepts at most ${MAX_MAGIC_WRITE_SESSION_IMAGE_PATHS} attached images per session.`);
  }
  return value.map((raw, index) => {
    if (typeof raw !== "string" || !raw.trim()) throw new Error(`Magic session image path ${index} is invalid.`);
    return raw.trim();
  });
}

interface MagicWriteValidatedRequest {
  typeSlug: string;
  currentValue: EntryValue;
  prompt: string;
  history: ChatMessage[];
  images: MagicWriteImageInput[];
  sessionImagePaths: string[];
  aiKeyName: string | undefined;
  aiModel: string | undefined;
  rewritePassage: string | undefined;
  rewriteInline: boolean;
}

function validateRewritePassage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("Magic rewrite passage must be a non-empty string.");
  if (value.length > 20_000) throw new Error("That selection is too long.");
  return value.trim();
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
  if (!typeSlug) throw new Error("Magic requires a content type.");

  const history = validateMagicWriteHistory(body.history);

  // `status/magic-chat.md` (the "Magic" chat upgrade) - unlike the original
  // one-shot Magic Write, `prompt` is THIS turn's own message on every call,
  // not just the first (a follow-up used to fold its text into `history`
  // and send an empty `prompt` instead - see this file's git history for
  // that shape). `history` is now strictly PRIOR turns.
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new Error("Say something to Magic first.");
  if (prompt.length > 4_000) throw new Error("That message is too long.");

  const currentValue: EntryValue = body.currentValue && typeof body.currentValue === "object" && !Array.isArray(body.currentValue)
    ? (body.currentValue as EntryValue)
    : {};

  const images = validateMagicWriteImages(body.images);
  const sessionImagePaths = validateMagicWriteSessionImagePaths(body.sessionImagePaths);

  const aiKeyName = typeof body.aiKeyName === "string" && body.aiKeyName.trim() ? body.aiKeyName.trim() : undefined;
  const aiModel = typeof body.aiModel === "string" && body.aiModel.trim() ? body.aiModel.trim() : undefined;
  if (ai.mode === "server" && !aiKeyName) throw new Error("Choose an AI Key before running Magic.");

  const rewritePassage = validateRewritePassage(body.rewritePassage);
  const rewriteInline = body.rewriteInline === true;

  return {
    typeSlug,
    currentValue,
    prompt,
    history,
    images,
    sessionImagePaths,
    aiKeyName,
    aiModel,
    rewritePassage,
    rewriteInline,
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
  aiModel: string | undefined,
  onDelta: (delta: string) => void,
): Promise<{ text: string; aiLabel: string }> {
  let text = "";
  const { stream, aiLabel } = await createChatStream(context, messages, (delta) => {
    text += delta;
    onDelta(delta);
  }, aiKeyName, aiModel, MAGIC_WRITE_MAX_OUTPUT_TOKENS, MAGIC_WRITE_TIMEOUT_MS);
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
/** `status/magic-chat.md` decision #5 - a separate budget from
 * `MAGIC_WRITE_MAX_ATTEMPTS` above (dialect-repair retries): a turn that
 * fetches cleanly every time but never gets around to actually answering
 * shouldn't burn through the SAME 3 attempts a malformed reply would. */
const MAGIC_FETCH_MAX_HOPS = 3;
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

interface MagicWriteChatTurnEvent {
  kind: "chat";
  text: string;
}

interface MagicWriteRewriteTurnEvent {
  kind: "rewrite";
  html: string;
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

          // The explicit, stored `magic` grant is the authoritative check -
          // not derived from create/update/setting here (the Role editor
          // only lets `magic` be turned on once one of those is already
          // granted, but this route trusts the grant itself, same as every
          // other `checkAccess` call in this codebase). See
          // `content-types/permissions.ts` and `status/role-system-permissions.md`.
          const denied = await checkAccess(context, entries, allTypes, type, "magic");
          if (denied) {
            const body = await denied.json().catch(() => ({})) as { message?: string };
            throw new Error(body.message || "You don't have permission to use Magic on this content type.");
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
          const chatImages = verifiedImages.map(({ mimeType, base64 }) => ({ mimeType, base64 }));

          // `status/magic-chat.md` decision C - `allowedImageSrcs` (which
          // paths the model may reference as an `image` field value or a
          // RichText `<img src>`) is the union of THIS turn's images and
          // every earlier turn's, verified the same way. This turn's own
          // pixels (`chatImages` above) are only ever attached to this
          // turn's own message below - an earlier turn's path stays a valid
          // write target without its bytes ever being resent.
          const verifiedSessionPaths = (
            await Promise.all(
              request.sessionImagePaths.map(async (path) => {
                const stat = await storageAdapter.stat(path).catch(() => null);
                return stat && stat.kind === "file" ? path : null;
              }),
            )
          ).filter((path): path is string => path !== null);
          const allowedImageSrcs = new Set([...verifiedImages.map((image) => image.path), ...verifiedSessionPaths]);

          const nodes = buildEntryFieldTree(type, allTypes);
          const fieldsDescription = describeFieldsForPrompt(nodes, request.currentValue, allTypes);
          const relationContext = await loadRelationContext(entries, allTypes, nodes, request.currentValue);
          const systemPrompt = buildMagicWriteSystemPrompt({
            lang: ai.lang,
            typeLabel: type.label,
            fieldsDescription,
            imagePaths: [...allowedImageSrcs],
            relationContext,
          });

          // `status/magic-chat.md` decision C - the system prompt is its own
          // leading message, never carrying images. `history` is strictly
          // PRIOR turns (text only, see `validateMagicWriteHistory`); this
          // turn's own admin message is appended last, with THIS turn's
          // images attached to it alone - the only place in the whole
          // rebuilt request their bytes appear (each server call still
          // rebuilds its own independent provider request from scratch,
          // same as before, but an earlier turn's images are deliberately
          // NOT resent - see `sessionImagePaths` above for how the model
          // keeps a usable reference to them anyway).
          const priming: ChatMessage = { role: "user", text: systemPrompt };
          // `status/richtext-rewrite-shared-chat.md` - a "Rewrite selection"
          // turn's displayed bubble (`request.prompt`) stays short; the model
          // itself gets that PLUS the passage/dialect instructions appended
          // here, never resent on later turns (only the short display text
          // becomes part of `history` client-side).
          const currentTurnText = request.rewritePassage
            ? buildRewriteTurnMessage(request.prompt, request.rewritePassage, request.rewriteInline)
            : request.prompt;
          const currentTurn: ChatMessage = { role: "user", text: currentTurnText, images: chatImages };
          let messages: ChatMessage[] = [priming, ...request.history, currentTurn];
          let lastError = "Magic used too many internal lookups without producing a final reply.";
          let dialectAttempt = 0;
          let fetchHops = 0;
          // `EntryRelationNode.targetTypeId` -> every id `kind: fetch` actually
          // surfaced THIS turn (`ai-magic-write-fields.ts`'s
          // `AllowedRelationIds`) - a relation field write may only reference
          // one of these, never accumulated across the session the way
          // `allowedImageSrcs` is (see that type's own doc comment for why).
          const allowedRelationIds = new Map<string, Set<number>>();

          // One iteration is one full model call, whether it ends up being a
          // dialect retry OR a fetch hop - bounding the total regardless of
          // which budget below is being spent is the real backstop against a
          // runaway loop (each budget's own check only stops THAT kind of
          // iteration from recurring past its own limit).
          const maxIterations = MAGIC_WRITE_MAX_ATTEMPTS + MAGIC_FETCH_MAX_HOPS;
          for (let iteration = 0; iteration < maxIterations; iteration++) {
            if (dialectAttempt > 0) controller.enqueue(streamEvent({ retry: true }));
            const result = await runMagicWriteTurn(context, messages, request.aiKeyName, request.aiModel, (delta) => {
              controller.enqueue(streamEvent({ delta }));
            });
            const validation = parseMagicWriteYaml(extractMagicWriteYaml(result.text));

            if (!validation.ok) {
              lastError = validation.error;
              dialectAttempt++;
              if (dialectAttempt >= MAGIC_WRITE_MAX_ATTEMPTS) break;
              messages = [
                ...messages,
                { role: "assistant", text: result.text },
                {
                  role: "user",
                  text: `Your last reply did not match the required format: ${validation.error} Resend a single corrected reply only, in the exact dialect described above - no prose, no markdown fences.`,
                },
              ];
              continue;
            }

            const turn = validation.turn;

            if (turn.kind === "fetch") {
              fetchHops++;
              if (fetchHops > MAGIC_FETCH_MAX_HOPS) {
                messages = [
                  ...messages,
                  { role: "assistant", text: result.text },
                  { role: "user", text: "You've used up this turn's lookups - reply now with what you already have (kind: chat, fields, or question), no more kind: fetch." },
                ];
                continue;
              }
              const fetchResult = await executeMagicFetch(context, entries, allTypes, storage, turn);
              if (fetchResult.seenEntryIds) {
                const { targetTypeId, ids } = fetchResult.seenEntryIds;
                const existing = allowedRelationIds.get(targetTypeId) ?? new Set<number>();
                for (const id of ids) existing.add(id);
                allowedRelationIds.set(targetTypeId, existing);
              }
              // Transient status only - never a terminal `turn` event, the
              // admin never sees the raw query/result, just this label
              // (`MagicChat.tsx` renders it as a status bubble and resets its
              // streaming buffer, same as it already does for `{retry}`).
              controller.enqueue(streamEvent({ fetching: fetchResult.label }));
              messages = [...messages, { role: "assistant", text: result.text }, { role: "user", text: fetchResult.resultText }];
              continue;
            }

            let event: MagicWriteFieldsTurnEvent | MagicWriteQuestionTurnEvent | MagicWriteChatTurnEvent | MagicWriteRewriteTurnEvent;
            if (turn.kind === "question") {
              event = turn;
            } else if (turn.kind === "chat") {
              event = turn;
            } else if (turn.kind === "rewrite") {
              // No image-src allowlist here (unlike `fields`' richtext
              // values) - the rewrite dialect forbids `<img>` entirely
              // (`buildRewriteTurnMessage`), so the default empty set is
              // just defense-in-depth against a stray one slipping through.
              event = { kind: "rewrite", html: sanitizeAiRichTextHtml(turn.html) };
            } else {
              const applied = applyMagicWriteFields(nodes, turn.fields, allowedImageSrcs, allowedRelationIds);
              event = { kind: "fields", summary: turn.summary, fields: applied.value, writtenFieldNames: applied.writtenFieldNames };
            }
            controller.enqueue(streamEvent({ turn: event, aiLabel: result.aiLabel }));
            controller.close();
            return;
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
