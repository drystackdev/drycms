/**
 * "Magic" for the Page Editor - a sibling of `ai-magic-write.ts`, same
 * overall shape (validate request, prime the model with a system prompt,
 * loop over turns until a terminal reply, stream SSE events back), but
 * editing raw page-source text instead of content-entry fields. Kept as its
 * own route/module rather than folded into `ai-magic-write.ts` for the same
 * reason that file gives for staying separate from `ai.ts`'s wizard: the
 * setup phase is genuinely different (a file path + its current text, not a
 * `ContentTypeDefinition` + field tree), and this way neither feature's
 * already-tested code path is put at risk by the other's changes.
 *
 * Permission is NOT re-checked in this module - `handler.ts` gates the
 * whole `page-source-ai` segment on `PAGE_BUILDER_RESOURCE_ID` `"setting"`
 * before this handler ever runs, the same centralized-gate pattern
 * `pages-source.ts`'s own write methods rely on (no per-request `checkAccess`
 * call in that file either). Also note this route never itself writes to
 * `pagesSourceStorage` - each `kind: code` reply (one PER FILE, and not
 * limited to whatever's open in the editor - `ai-page-source-protocol.ts`'s
 * own doc comment) only streams a new full-file string back to the browser,
 * which lands in that path's own in-memory buffer; persisting any of it to
 * disk still goes through the SAME `PUT /api/pages-source/:path` route (and
 * its existing validation) the admin's own Save button already calls - see
 * `status/page-editor-magic-chat.md`.
 */
import { ai } from "../config.js";
import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse } from "../route-helpers.js";
import { extractPageSourceYaml, parsePageSourceYaml } from "../../page-components/ai-page-source-protocol.js";
import { buildPageSourceSystemPrompt } from "../../page-components/ai-page-source-prompt.js";
import { executePageSourceRead, readProjectReadme } from "./ai-page-source-read.js";
import {
  acquireAiStreamSlot,
  createChatStream,
  releaseAiStreamSlot,
  safeAiMessage,
  streamEvent,
  trackAiStream,
  type ChatMessage,
} from "./ai.js";

interface PageSourceWriteHttpRequest {
  path?: string;
  currentSource?: string;
  /** Every file path already in this project's source tree - see
   * `validateProjectFiles`. */
  projectFiles?: unknown;
  prompt?: string;
  /** Prior turns of this same conversation - TERSE summaries only (never a
   * full replaced file's text - see `PageSourceMagicChat.tsx`'s own history
   * bookkeeping), same "prior turns, not this one" shape
   * `MagicWriteHttpRequest.history` has. */
  history?: unknown;
  aiKeyName?: string;
  aiModel?: string;
  lang?: string;
}

interface PageSourceWriteValidatedRequest {
  /** `""` when no file is open in the editor - see `buildPageSourceSystemPrompt`'s
   * `path` doc comment. Magic is no longer scoped to one open file
   * (`PageSourceCodeTurn` carries its own target `path`), so this is
   * context only, not a requirement. */
  path: string;
  currentSource: string;
  projectFiles: string[];
  prompt: string;
  history: ChatMessage[];
  aiKeyName: string;
  aiModel: string | undefined;
  lang: string;
}

/** A source file can legitimately be large; this just keeps one request from
 * being unbounded - well past any real page/component/stylesheet in this
 * project, nowhere near a real cap on file size elsewhere in the app. */
const MAX_PAGE_SOURCE_CHARS = 150_000;

function validatePageSourceHistory(value: unknown): ChatMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Magic history must be an array of at most 20 messages.");
  }
  return value.map((message, index) => {
    if (
      !message ||
      typeof message !== "object" ||
      ((message as ChatMessage).role !== "user" && (message as ChatMessage).role !== "assistant") ||
      typeof (message as ChatMessage).text !== "string" ||
      !(message as ChatMessage).text.trim()
    ) {
      throw new Error(`Magic history entry ${index} is invalid.`);
    }
    const text = (message as ChatMessage).text;
    if (text.length > 20_000) throw new Error(`Magic history entry ${index} is too long.`);
    return { role: (message as ChatMessage).role, text };
  });
}

/** A very large project's file list is still just an orientation aid, not
 * something worth failing the request over if it's oversized - malformed/
 * excess entries are silently dropped rather than rejected (this is the
 * client's own `Object.keys(sourceByPath)`, not user-typed content, so a bad
 * entry here is a client bug, not something to bubble as a user-facing
 * error - unlike `validatePageSourceHistory`'s strict throw). Capped well
 * past any real project's file count; `buildPageSourceSystemPrompt`'s own
 * `MAX_LISTED_FILES` applies the tighter, prompt-budget-driven cap. */
const MAX_PROJECT_FILES = 2_000;
const MAX_PROJECT_FILE_PATH_CHARS = 300;

function validateProjectFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= MAX_PROJECT_FILE_PATH_CHARS)
    .slice(0, MAX_PROJECT_FILES);
}

function validatePageSourceWriteRequest(body: PageSourceWriteHttpRequest): PageSourceWriteValidatedRequest {
  const path = typeof body.path === "string" ? body.path.trim() : "";

  const currentSource = typeof body.currentSource === "string" ? body.currentSource : "";
  if (currentSource.length > MAX_PAGE_SOURCE_CHARS) {
    throw new Error(`This file is too large for Magic - it supports files up to ${MAX_PAGE_SOURCE_CHARS.toLocaleString()} characters.`);
  }

  const projectFiles = validateProjectFiles(body.projectFiles);

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new Error("Say something to Magic first.");
  if (prompt.length > 4_000) throw new Error("That message is too long.");

  const history = validatePageSourceHistory(body.history);

  const aiKeyName = typeof body.aiKeyName === "string" && body.aiKeyName.trim() ? body.aiKeyName.trim() : undefined;
  if (!aiKeyName) throw new Error("Choose an AI Key before running Magic.");
  const aiModel = typeof body.aiModel === "string" && body.aiModel.trim() ? body.aiModel.trim() : undefined;
  const lang = typeof body.lang === "string" && body.lang.trim() ? body.lang.trim() : ai.lang;

  return { path, currentSource, projectFiles, prompt, history, aiKeyName, aiModel, lang };
}

/** Same drain-and-collect shape as `ai-magic-write.ts`'s own
 * `runMagicWriteTurn` - a small parallel copy, not a shared helper, for the
 * same "keep the other feature's tested path untouched" reasoning that file
 * documents. */
async function runPageSourceTurn(
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
  }, aiKeyName, aiModel, PAGE_SOURCE_MAX_OUTPUT_TOKENS, PAGE_SOURCE_TIMEOUT_MS);
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

const PAGE_SOURCE_MAX_ATTEMPTS = 3;
const PAGE_SOURCE_READ_MAX_HOPS = 3;
/** How many files one admin message may write in a row before Magic is
 * forced to wrap up with `kind: chat` - `kind: code` is no longer terminal
 * (`PageSourceCodeTurn`'s own doc comment), so without a cap a single
 * request could in principle rewrite the whole project. Generous enough for
 * a real multi-file change (e.g. a new component plus the page that uses
 * it) without being unbounded. */
const PAGE_SOURCE_CODE_MAX_HOPS = 8;
/** A whole file's replacement text can easily run past the 2048-token
 * default `ai.ts`'s Anthropic branch otherwise applies - same override
 * `ai-magic-write.ts` makes for a whole entry's worth of fields, reused
 * as-is (only affects Anthropic; OpenAI/Google have no such cap here). */
const PAGE_SOURCE_MAX_OUTPUT_TOKENS = 8_192;
const PAGE_SOURCE_TIMEOUT_MS = 90_000;

interface PageSourceCodeTurnEvent {
  kind: "code";
  path: string;
  summary: string;
  code: string;
}

interface PageSourceChatTurnEvent {
  kind: "chat";
  text: string;
}

function streamPageSourceWrite(context: DryRouteContext, request: PageSourceWriteValidatedRequest): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const projectContext = await readProjectReadme(context);
          const systemPrompt = buildPageSourceSystemPrompt({
            lang: request.lang,
            path: request.path,
            currentSource: request.currentSource,
            projectFiles: request.projectFiles,
            projectContext,
          });
          const priming: ChatMessage = { role: "user", text: systemPrompt };
          const currentTurn: ChatMessage = { role: "user", text: request.prompt };
          let messages: ChatMessage[] = [priming, ...request.history, currentTurn];
          let lastError = "Magic used too many internal lookups without producing a final reply.";
          let dialectAttempt = 0;
          let readHops = 0;
          let codeHops = 0;

          const maxIterations = PAGE_SOURCE_MAX_ATTEMPTS + PAGE_SOURCE_READ_MAX_HOPS + PAGE_SOURCE_CODE_MAX_HOPS;
          for (let iteration = 0; iteration < maxIterations; iteration++) {
            if (dialectAttempt > 0) controller.enqueue(streamEvent({ retry: true }));
            const result = await runPageSourceTurn(context, messages, request.aiKeyName, request.aiModel, (delta) => {
              controller.enqueue(streamEvent({ delta }));
            });
            const validation = parsePageSourceYaml(extractPageSourceYaml(result.text));

            if (!validation.ok) {
              lastError = validation.error;
              dialectAttempt++;
              if (dialectAttempt >= PAGE_SOURCE_MAX_ATTEMPTS) break;
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

            if (turn.kind === "read") {
              readHops++;
              if (readHops > PAGE_SOURCE_READ_MAX_HOPS) {
                messages = [
                  ...messages,
                  { role: "assistant", text: result.text },
                  { role: "user", text: "You've used up this turn's lookups - reply now with what you already have (kind: chat or code), no more kind: read." },
                ];
                continue;
              }
              const readResult = await executePageSourceRead(context, turn);
              // Transient status only, same treatment `{fetching}` gets in
              // `ai-magic-write.ts` - never a terminal `turn` event.
              controller.enqueue(streamEvent({ reading: readResult.label }));
              messages = [...messages, { role: "assistant", text: result.text }, { role: "user", text: readResult.resultText }];
              continue;
            }

            if (turn.kind === "code") {
              codeHops++;
              if (codeHops > PAGE_SOURCE_CODE_MAX_HOPS) {
                messages = [
                  ...messages,
                  { role: "assistant", text: result.text },
                  { role: "user", text: "You've written the maximum number of files for this turn - reply now with kind: chat summarizing what you've done, no more kind: code." },
                ];
                continue;
              }
              // Applied by the CLIENT (writes `turn.path`'s in-editor buffer -
              // see this module's own doc comment on why nothing here
              // touches real storage), never terminal: the model gets
              // another turn right after, so one request can write several
              // files in sequence before a final `kind: chat` wraps up.
              const event: PageSourceCodeTurnEvent = { kind: "code", path: turn.path, summary: turn.summary, code: turn.code };
              controller.enqueue(streamEvent({ turn: event, aiLabel: result.aiLabel }));
              messages = [
                ...messages,
                { role: "assistant", text: result.text },
                {
                  role: "user",
                  text: `Wrote "${turn.path}" (${turn.summary}). Continue with another kind: code for a different file if this request needs one, or reply with kind: chat to summarize and finish.`,
                },
              ];
              continue;
            }

            const event: PageSourceChatTurnEvent = { kind: "chat", text: turn.text };
            controller.enqueue(streamEvent({ turn: event, aiLabel: result.aiLabel }));
            controller.close();
            return;
          }
          controller.enqueue(streamEvent({ error: `AI could not produce a valid reply after ${PAGE_SOURCE_MAX_ATTEMPTS} attempts. Last issue: ${lastError}` }));
          controller.close();
        } catch (error) {
          controller.enqueue(streamEvent({ error: safeAiMessage(error) }));
          controller.close();
        }
      })();
    },
  });
}

export const POST: DryRouteHandler = async (context: DryRouteContext) => {
  let request: PageSourceWriteValidatedRequest;
  try {
    request = validatePageSourceWriteRequest(await context.request.json());
  } catch (error) {
    return jsonResponse({ error: "invalid_request", message: error instanceof Error ? error.message : "Invalid request." }, 400);
  }

  if (!acquireAiStreamSlot()) {
    return jsonResponse({ error: "rate_limited", message: "Too many AI requests are active. Try again shortly." }, 429);
  }
  const stream = streamPageSourceWrite(context, request);
  return new Response(trackAiStream(stream, releaseAiStreamSlot), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
};
