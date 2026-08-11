import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { MutableRef } from "preact/hooks";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import AiKeyPicker from "../../components/AiKeyPicker.js";
import type { AiKeySelection } from "../../components/AiKeyPicker.js";
import type { RichTextRewriteFn } from "../../components/RichTextField/ai-rewrite-context.js";
import { SparkleIcon } from "../../components/AiSparkleIcon.js";
import {
  CloseIcon,
  EraserIcon,
  PlusIcon,
  XIcon,
} from "../../components/icons/index.js";
import EntryScopedPicker from "../../components/FileManager/EntryScopedPicker.js";
import { optimizeUploadImage } from "../../components/FileManager/file-manager-image-optimize.js";
import type { FileManagerSource } from "../../storage/entry-types.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import {
  discardMagicChatSession,
  loadMagicChatSession,
  saveMagicChatSession,
} from "./magic-chat-store.js";
import type {
  ChatBubble,
  MagicChatEncodedImage,
  MagicChatHistoryMessage,
} from "./magic-chat-store.js";
import type { EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { parsePartialMagicWriteYaml } from "../../content-types/ai-magic-write-protocol.js";
import type {
  MagicWriteChoice,
  MagicWriteRawValue,
} from "../../content-types/ai-magic-write-protocol.js";
import {
  applyMagicWriteFields,
  WRITABLE_COLUMN_TYPES,
} from "../../content-types/ai-magic-write-fields.js";
import { sanitizeAiRichTextHtml } from "../../content-types/ai-richtext-sanitize.js";
import { scrollToField } from "./field-events.js";
import { useEntryMediaSource } from "./entry-media-context.js";

const { path } = window.__DRY_CONFIG__;

/**
 * "Magic" - the chat upgrade of what was Magic Write (`status/magic-write.md`
 * -> `status/magic-chat.md`). This file REPLACES `MagicWriteDialog.tsx`
 * outright (not alongside it): the one-shot "prompt + up to 2 multiple-choice
 * questions" dialog is gone, replaced by an ongoing chat the admin can attach
 * images to, get asked follow-up questions in, and keep refining after a
 * `fields` turn writes something - see `status/magic-chat.md` for the full
 * design trail (3 rounds of back-and-forth) this component implements.
 *
 * Biggest structural change from the old dialog: this is NOT a modal. A
 * small floating bubble (bottom-right, `popover="manual"` - same top-layer
 * trick `Toast.tsx` uses to float above an open `<dialog>` without a z-index
 * scale) expands into a chat panel that sits ALONGSIDE the entry form - the
 * admin can type in a real field while Magic is open, unlike the old dialog
 * which had to hide itself the moment a `fields` turn started streaming.
 */

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

/** Fetches an already-uploaded storage image's bytes, resizes it down to a
 * small (240px) context-only copy, and base64-encodes it - see
 * `status/magic-write.md` decision #3 for why 240px specifically (vision API
 * token cost scales with pixel count, not quality/file size). Run once per
 * turn, right before that turn's request goes out. */
async function encodeContextImage(
  imagePath: string,
): Promise<MagicChatEncodedImage> {
  const response = await fetch(resolveImageSrc(imagePath));
  if (!response.ok) throw new Error(`Could not load "${imagePath}".`);
  const blob = await response.blob();
  const original = new File([blob], imagePath.split("/").pop() || imagePath, {
    type: blob.type,
  });
  const optimized = await optimizeUploadImage(original, { maxWidth: 240 });
  const base64 = await fileToBase64(optimized);
  return { path: imagePath, mimeType: optimized.type, base64 };
}

interface MagicChatFieldsResult {
  kind: "fields";
  summary: string;
  fields: EntryValue;
  writtenFieldNames: string[];
}

interface MagicChatQuestionResult {
  kind: "question";
  topic: string;
  question: string;
  choices: MagicWriteChoice[];
  multi: boolean;
  allowOther?: boolean;
}

interface MagicChatChatResult {
  kind: "chat";
  text: string;
}

/** `status/richtext-rewrite-shared-chat.md` - the terminal result of a
 * RichText "Rewrite selection" turn (`requestRewrite` below). `html` is
 * already server-sanitized (`ai-magic-write.ts`); `AiRewriteButton` still
 * runs it through `sanitizeAiRichTextHtml` again before splicing it into the
 * document, same defense-in-depth every other AI-written HTML path uses. */
interface MagicChatRewriteResult {
  kind: "rewrite";
  html: string;
}

type MagicChatTurnResult =
  | MagicChatFieldsResult
  | MagicChatQuestionResult
  | MagicChatChatResult
  | MagicChatRewriteResult;

interface MagicChatStreamEvent {
  delta?: string;
  retry?: boolean;
  /** A `kind: fetch` hop just ran server-side (`status/magic-chat.md`
   * decision #5, Phase B) - never a terminal reply, just a status label
   * (e.g. `Looking up 5 "Blog Post" entries…`); another `{delta}`/`{turn}`
   * follows on the SAME connection once the model's next reply streams in. */
  fetching?: string;
  /** A `kind: create` hop just ran server-side
   * (`status/relation-quick-create.md`) - same "never terminal, just a
   * status label" shape as `fetching` above, but for a WRITE (a new related
   * entry) rather than a read, so it gets its own distinct status text
   * (e.g. `Created a new "Category" entry…`) instead of reusing `fetching`'s
   * wording. */
  creating?: string;
  turn?: MagicChatTurnResult;
  aiLabel?: string;
  error?: string;
}

/** Reads the `/api/ai/magic-write` SSE stream, forwarding raw `{delta}` text
 * as it arrives (for `onDelta`'s live incremental rendering) and resolving
 * once a `{turn}` (or `{error}`) event closes the stream. Same shape as the
 * old `MagicWriteDialog.tsx`'s own version of this function - unchanged by
 * the chat upgrade, the wire protocol underneath is the same SSE stream. */
async function requestMagicTurn(
  payload: Record<string, unknown>,
  onDelta: (delta: string) => void,
  onRetry: () => void,
  onFetching: (label: string) => void,
  onCreating: (label: string) => void,
  signal: AbortSignal,
): Promise<{ turn: MagicChatTurnResult; aiLabel: string }> {
  const response = await fetch(`${path}/api/ai/magic-write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.message === "string" ? body.message : "AI request failed.",
    );
  }
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
      if (!line.startsWith("data:")) continue;
      let event: MagicChatStreamEvent;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.turn)
        return { turn: event.turn, aiLabel: event.aiLabel ?? "AI" };
      if (event.retry) onRetry();
      else if (event.fetching) onFetching(event.fetching);
      else if (event.creating) onCreating(event.creating);
      else if (event.delta) onDelta(event.delta);
    }
  }
  throw new Error("AI connection closed unexpectedly.");
}

/** A top-level field Magic can offer to write - `relation-mirror`/password/
 * secretkey are never candidates (see `status/magic-write.md` decision #2).
 * Plain `relation` fields became candidates in `status/magic-chat.md`'s
 * Phase B - never live-previewed while streaming (`handleDelta` below only
 * live-injects a `column` node's value), but committed once closed, same as
 * every other non-text/richtext field. */
function isMagicChatCandidate(node: EntryFieldNode): boolean {
  if (node.kind === "column") return WRITABLE_COLUMN_TYPES.has(node.fieldType);
  if (node.kind === "flatten") return node.children.some(isMagicChatCandidate);
  if (node.kind === "component-repeat")
    return node.itemFields.some(isMagicChatCandidate);
  if (node.kind === "relation") return true;
  return false;
}

const SUGGESTIONS = [
  "Viết một bài giới thiệu ngắn",
  "Rút gọn nội dung hiện có",
  "Đặt lại tiêu đề cho chuẩn SEO",
];

export interface MagicChatProps {
  typeSlug: string;
  entryId: string | null;
  /** The entry's top-level editable `EntryFieldNode[]` (same list
   * `ContentEntryEditor.tsx` renders fields from). */
  nodes: EntryFieldNode[];
  value: EntryValue;
  updateFieldValue: (fieldName: string, fieldValue: unknown) => void;
  /** Mirrors the field currently being streamed into up to
   * `ContentEntryEditor.tsx`, which disables that field's `<fieldset>` while
   * it's set (see `status/magic-write.md` decision #4). `null` when nothing
   * is streaming. */
  onStreamingFieldChange: (fieldName: string | null) => void;
  /** Where the context-image picker's `FileManager` reads its files from. */
  source: FileManagerSource;
  /** Magic's own gate - stricter than the entry form's general edit
   * permission for a collection (needs create AND update, not just
   * whichever action the current new-vs-existing mode calls for). See
   * `ContentEntryEditor.tsx`'s `canUseMagic`. */
  canUse: boolean;
  /** The Visual Editing Interface's dialog iframe skips `DryLayout` (see
   * `VeiFrame.tsx`) and shifts `Toaster` to `bottom-start` to avoid its own
   * dock - the bubble/panel mirror that same shift so they don't collide. */
  veiFrame?: boolean;
  /** Lifted up to `ContentEntryEditor.tsx` (`status/richtext-rewrite-shared-chat.md`)
   * so it loads as soon as the entry editor mounts, not just after the
   * bubble is first opened - `RichTextRewriteContext`'s `ready` flag (read
   * by `AiRewriteButton` before it ever opens this panel) needs a live
   * answer immediately, not only once the admin has clicked the bubble. */
  aiKey: AiKeySelection;
  /** Published a fresh `requestRewrite` closure into this ref on every
   * render (see the `useEffect` below) - `ContentEntryEditor.tsx`'s
   * `RichTextRewriteContext` value calls through it imperatively, since the
   * actual turn-running state (`historyRef`, `runAssistant`, session
   * persistence) all lives inside this component, not the context itself. */
  rewriteFnRef: MutableRef<RichTextRewriteFn | null>;
}

export default function MagicChat({
  typeSlug,
  entryId,
  nodes,
  value,
  updateFieldValue,
  onStreamingFieldChange,
  source,
  canUse,
  veiFrame = false,
  aiKey,
  rewriteFnRef,
}: MagicChatProps) {
  const writableNodes = useMemo(
    () => nodes.filter(isMagicChatCandidate),
    [nodes],
  );
  const fieldLabel = (name: string) =>
    writableNodes.find((candidate) => candidate.fieldName === name)?.label ??
    name;

  // The same entry-scoped view of Media the entry's own image/file fields
  // get (`ScalarField.tsx`) - both the attach picker's "Entry" tab and the
  // folder the model is told about below come from it.
  const entrySource = useEntryMediaSource(source);

  const widgetRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [prompt, setPrompt] = useState("");
  const [attachedPaths, setAttachedPaths] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamingFieldName, setStreamingFieldName] = useState<string | null>(
    null,
  );
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showNewMessagesChip, setShowNewMessagesChip] = useState(false);

  const historyRef = useRef<MagicChatHistoryMessage[]>([]);
  const sessionImagePathsRef = useRef<string[]>([]);
  const rawTextRef = useRef("");
  const committedRef = useRef<Set<string>>(new Set());
  const streamingNameRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopReasonRef = useRef<"stop" | null>(null);
  const idRef = useRef(0);
  const mountedRef = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(
    () => () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    },
    [],
  );

  // Floats the whole widget in the browser's top layer, same mechanism
  // `Toast.tsx` uses - see this file's own doc comment above.
  useEffect(() => {
    const el = widgetRef.current;
    if (!el) return;
    el.setAttribute("popover", "manual");
    el.showPopover?.();
  }, []);

  // Restores a persisted conversation (IndexedDB, see `magic-chat-store.ts`)
  // so a reload/navigate-away-and-back doesn't lose it - reset first, THEN
  // load, so switching to a different entry (same mounted instance, `id`
  // just changed) clears the previous entry's messages before the new one's
  // arrive rather than showing them briefly. Stays closed either way (`open`
  // untouched) - the bubble's existing "has messages" dot is signal enough,
  // popping the panel open on every reload would be pushy. A bubble still
  // `streaming: true` belongs to a request that died with the old page - no
  // controller survives a reload to ever resolve it. If it has any text,
  // freeze it (spinner off, partial text kept); if it never got as far as a
  // first delta, `MagicChatBubbleView` shows the typing indicator for ANY
  // empty-text assistant bubble regardless of `streaming` - freezing it
  // as-is would leave a permanently "typing" ghost, so it becomes an
  // "Interrupted." status line instead, same convention `handleStop` already
  // uses for a live abort ("Stopped.").
  useEffect(() => {
    setMessages([]);
    historyRef.current = [];
    sessionImagePathsRef.current = [];
    idRef.current = 0;
    let cancelled = false;
    void (async () => {
      const saved = await loadMagicChatSession(typeSlug, entryId);
      if (cancelled || !saved) return;
      setMessages(
        saved.messages.map((bubble) => {
          if (bubble.role !== "assistant" || !bubble.streaming) return bubble;
          return bubble.text
            ? { ...bubble, streaming: false }
            : { id: bubble.id, role: "status", text: "Interrupted." };
        }),
      );
      historyRef.current = saved.history;
      sessionImagePathsRef.current = saved.sessionImagePaths;
      idRef.current = saved.nextId;
    })();
    return () => {
      cancelled = true;
    };
  }, [typeSlug, entryId]);

  // Persists on every message-list change (debounced inside
  // `saveMagicChatSession`) - guarded on non-empty so the reset at the top of
  // the effect above never overwrites a real session with a blank one before
  // its own load resolves; `clearAllNow` below discards explicitly instead.
  useEffect(() => {
    if (messages.length === 0) return;
    saveMagicChatSession(typeSlug, entryId, {
      messages,
      history: historyRef.current,
      sessionImagePaths: sessionImagePathsRef.current,
      nextId: idRef.current,
    });
  }, [messages, typeSlug, entryId]);

  // `useOverlayScrollbars` via its opt-in `viewportRef`: `.magic-chat-messages`
  // (host, ref) stays a plain non-scrolling wrapper, while
  // `.magic-chat-messages-viewport` (viewportRef) is the real `display: flex;
  // flex-direction: column` list of rows AND the element OverlayScrollbars is
  // told to manage scroll on directly (`elements: { viewport, content: false
  // }`, see the hook's doc comment) - it stays a real DOM node the library
  // doesn't relocate our children out of, unlike the default (fully
  // library-generated) viewport that broke this exact layout before.
  // `[open]` re-runs the mount effect once the panel's conditionally-rendered
  // DOM exists (both refs are null before first open).
  const {
    ref: messagesRef,
    viewportRef: messagesViewportRef,
    scrollToBottom,
    isNearBottom,
  } = useOverlayScrollbars<HTMLDivElement>([open]);
  const wasNearBottomRef = useRef(true);

  // Notices the reader scrolling away from the bottom themselves, so a new
  // message doesn't yank them back down mid-read (`status/magic-chat.md`'s
  // "auto-scroll dính đáy").
  useEffect(() => {
    const el = messagesViewportRef.current;
    if (!el) return;
    const handleScroll = () => {
      wasNearBottomRef.current = isNearBottom();
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [open]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (wasNearBottomRef.current) {
      scrollToBottom();
      setShowNewMessagesChip(false);
    } else {
      setShowNewMessagesChip(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const prevStreamingRef = useRef<string | null>(null);
  useEffect(() => {
    if (streamingFieldName && streamingFieldName !== prevStreamingRef.current)
      scrollToField(streamingFieldName);
    prevStreamingRef.current = streamingFieldName;
  }, [streamingFieldName]);

  function setStreaming(name: string | null) {
    if (streamingNameRef.current === name) return;
    streamingNameRef.current = name;
    setStreamingFieldName(name);
    onStreamingFieldChange(name);
  }

  function newId(): string {
    idRef.current += 1;
    return `magic-${idRef.current}`;
  }

  function updateBubble(
    id: string,
    updater: (bubble: ChatBubble) => ChatBubble,
  ) {
    setMessages((current) =>
      current.map((bubble) => (bubble.id === id ? updater(bubble) : bubble)),
    );
  }

  function commitField(name: string, raw: MagicWriteRawValue) {
    if (committedRef.current.has(name)) return;
    committedRef.current.add(name);
    const node = writableNodes.find(
      (candidate) => candidate.fieldName === name,
    );
    if (!node) return;
    const applied = applyMagicWriteFields([node], { [name]: raw });
    if (applied.writtenFieldNames.includes(name))
      updateFieldValue(name, applied.value[name]);
  }

  function statusLine(
    closedNames: string[],
    streamingName: string | undefined,
  ): string {
    const parts = [
      ...closedNames.map((name) => `${fieldLabel(name)} ✓`),
      streamingName ? `${fieldLabel(streamingName)}…` : null,
    ].filter((part): part is string => !!part);
    return parts.length > 0 ? parts.join(" · ") : "Writing…";
  }

  function handleDelta(assistantBubbleId: string, delta: string) {
    rawTextRef.current += delta;
    const partial = parsePartialMagicWriteYaml(rawTextRef.current);

    if (partial.kind === "fields") {
      for (const [name, raw] of Object.entries(partial.closedFields))
        commitField(name, raw);
      const streaming = partial.streamingField;
      if (streaming && !committedRef.current.has(streaming.name)) {
        setStreaming(streaming.name);
        const node = writableNodes.find(
          (candidate) => candidate.fieldName === streaming.name,
        );
        // "text"/"richtext" get their still-growing value fed live into the
        // real form field, same as the old dialog - everything else stays
        // disabled-but-inert until it fully closes (no safe partial value to
        // coerce mid-stream). `richtext` goes through the pure-regex
        // sanitizer on every tick (no DOMParser, so it never fails on a
        // still-open tag), so any transient mis-render self-heals on the
        // next tick.
        if (node?.kind === "column" && typeof streaming.value === "string") {
          if (node.fieldType === "text")
            updateFieldValue(streaming.name, streaming.value);
          else if (node.fieldType === "richtext")
            updateFieldValue(
              streaming.name,
              sanitizeAiRichTextHtml(
                streaming.value,
                new Set(sessionImagePathsRef.current),
              ),
            );
        }
      }
      updateBubble(
        assistantBubbleId,
        (bubble) =>
          ({
            ...bubble,
            role: "status",
            text: statusLine(
              Object.keys(partial.closedFields),
              streaming?.name,
            ),
          }) as ChatBubble,
      );
      return;
    }

    if (partial.kind === "question") {
      updateBubble(assistantBubbleId, (bubble) =>
        bubble.role === "assistant"
          ? { ...bubble, text: partial.question ?? "" }
          : bubble,
      );
      return;
    }

    if (partial.kind === "rewrite") {
      // The growing `html:` block itself is deliberately not shown here (raw,
      // unsanitized, mid-tag HTML reads as garbled text) - `AiRewriteButton`
      // gets its own live preview via `rewriteRequest.onDelta` below instead.
      updateBubble(assistantBubbleId, (bubble) =>
        bubble.role === "assistant"
          ? { ...bubble, text: "Rewriting the passage…" }
          : bubble,
      );
      return;
    }

    // "chat", or not yet known (still nothing but a growing `kind:` line) -
    // both render as a plain growing assistant bubble; an unrecognized/
    // missing `kind` resolves as chat too (see `parseMagicWriteYaml`'s own
    // doc comment), so there's no separate branch needed for that case.
    updateBubble(assistantBubbleId, (bubble) =>
      bubble.role === "assistant"
        ? { ...bubble, text: partial.text ?? "" }
        : bubble,
    );
  }

  /** Distinguishes a `requestRewrite` (below) call from every other
   * `runAssistant` caller (`sendTurn`/`handleAnswerQuestion`/`handleRetry`,
   * none of which pass this) - see `status/richtext-rewrite-shared-chat.md`. */
  interface RewriteRequest {
    passage: string;
    inline: boolean;
    onDelta: (delta: string) => void;
    resolve: (html: string) => void;
    reject: (error: Error) => void;
  }

  async function runAssistant(
    userText: string,
    images: MagicChatEncodedImage[],
    assistantBubbleId: string,
    rewriteRequest?: RewriteRequest,
  ) {
    setSending(true);
    stopReasonRef.current = null;
    rawTextRef.current = "";
    committedRef.current = new Set();
    const controller = new AbortController();
    abortRef.current = controller;
    const historyForThisTurn = historyRef.current;
    // Shared by `onFetching`/`onCreating` below - a `kind: fetch`/`kind:
    // create` hop just ran, so the CURRENT assistant placeholder is about to
    // keep growing with the model's NEXT reply (a fresh stream, same as
    // after a dialect `{retry}`), and its own status bubble ("Looking up 5
    // blog posts…" / "Created a new \"Category\" entry…") shows the admin
    // Magic is actively doing something, not just slow.
    function pushHopStatus(label: string) {
      rawTextRef.current = "";
      setMessages((current) => [
        ...current,
        { id: newId(), role: "status", text: label },
      ]);
    }
    try {
      const result = await requestMagicTurn(
        {
          typeSlug,
          entryId: entryId ?? undefined,
          currentValue: valueRef.current,
          prompt: userText,
          history: historyForThisTurn,
          images,
          sessionImagePaths: sessionImagePathsRef.current,
          aiKeyName: aiKey.keyName,
          aiModel: aiKey.model,
          ...(rewriteRequest
            ? {
                rewritePassage: rewriteRequest.passage,
                rewriteInline: rewriteRequest.inline,
              }
            : {}),
        },
        (delta) => {
          handleDelta(assistantBubbleId, delta);
          rewriteRequest?.onDelta(delta);
        },
        () => {
          rawTextRef.current = "";
        },
        pushHopStatus,
        pushHopStatus,
        controller.signal,
      );
      if (!mountedRef.current) return;

      let assistantHistoryText: string;
      if (result.turn.kind === "chat") {
        const turn = result.turn;
        updateBubble(assistantBubbleId, () => ({
          id: assistantBubbleId,
          role: "assistant",
          text: turn.text,
          streaming: false,
        }));
        assistantHistoryText = turn.text;
        rewriteRequest?.reject(
          new Error(
            "Magic replied without a rewrite - see its message in the chat panel.",
          ),
        );
      } else if (result.turn.kind === "question") {
        const turn = result.turn;
        updateBubble(assistantBubbleId, () => ({
          id: assistantBubbleId,
          role: "question",
          question: turn.question,
          choices: turn.choices,
          multi: turn.multi,
          allowOther: turn.allowOther,
        }));
        assistantHistoryText = turn.question;
        rewriteRequest?.reject(
          new Error(
            "Magic asked a question instead of rewriting - answer it in the chat panel, then try Rewrite again.",
          ),
        );
      } else if (result.turn.kind === "rewrite") {
        const turn = result.turn;
        assistantHistoryText = "Rewrote the passage.";
        updateBubble(assistantBubbleId, () => ({
          id: assistantBubbleId,
          role: "status",
          text: assistantHistoryText,
        }));
        rewriteRequest?.resolve(turn.html);
      } else {
        const turn = result.turn;
        for (const name of turn.writtenFieldNames)
          updateFieldValue(name, turn.fields[name]);
        const names = turn.writtenFieldNames.map(fieldLabel);
        assistantHistoryText =
          names.length > 0
            ? `Wrote: ${names.join(", ")}${turn.summary ? ` - ${turn.summary}` : ""}`
            : `Nothing needed writing.${turn.summary ? ` - ${turn.summary}` : ""}`;
        updateBubble(assistantBubbleId, () => ({
          id: assistantBubbleId,
          role: "status",
          text: assistantHistoryText,
        }));
        rewriteRequest?.reject(
          new Error(
            "Magic wrote fields instead of a rewrite - see the chat panel.",
          ),
        );
      }
      historyRef.current = [
        ...historyForThisTurn,
        { role: "user", text: userText },
        { role: "assistant", text: assistantHistoryText },
      ];
      sessionImagePathsRef.current = [
        ...new Set([
          ...sessionImagePathsRef.current,
          ...images.map((image) => image.path),
        ]),
      ];
      setStreaming(null);
      setSending(false);
    } catch (error) {
      if (!mountedRef.current) return;
      if (controller.signal.aborted) {
        setStreaming(null);
        setSending(false);
        if (stopReasonRef.current === "stop") {
          updateBubble(assistantBubbleId, () => ({
            id: assistantBubbleId,
            role: "status",
            text: "Stopped.",
          }));
          // The partial reply is discarded (not worth confusing a later turn
          // with) - only the admin's own message stays in history, per
          // `status/magic-chat.md` decision B.
          historyRef.current = [
            ...historyForThisTurn,
            { role: "user", text: userText },
          ];
        }
        rewriteRequest?.reject(new Error("Stopped."));
        return;
      }
      setStreaming(null);
      setSending(false);
      const message =
        error instanceof Error ? error.message : "AI request failed.";
      updateBubble(assistantBubbleId, () => ({
        id: assistantBubbleId,
        role: "error",
        text: message,
        retryText: userText,
        retryImages: images,
      }));
      rewriteRequest?.reject(new Error(message));
    }
  }

  function pushAssistantPlaceholder(): string {
    const id = newId();
    setMessages((current) => [
      ...current,
      { id, role: "assistant", text: "", streaming: true },
    ]);
    return id;
  }

  function sendTurn(userText: string, images: MagicChatEncodedImage[]) {
    const userBubbleId = newId();
    setMessages((current) => [
      ...current,
      {
        id: userBubbleId,
        role: "user",
        text: userText,
        imagePaths: images.map((image) => image.path),
      },
    ]);
    wasNearBottomRef.current = true;
    const assistantBubbleId = pushAssistantPlaceholder();
    void runAssistant(userText, images, assistantBubbleId);
  }

  /** `RichTextRewriteContext`'s implementation (`status/richtext-rewrite-shared-chat.md`)
   * - published into `rewriteFnRef` below, called by `AiRewriteButton`
   * anywhere in this entry's form. Runs the rewrite as one more turn of THIS
   * conversation (opens the panel, shares `historyRef`/`aiKey`) rather than
   * an isolated request, so the model has the whole entry's context. Only
   * one turn (composer OR rewrite) can run at a time - `abortRef`/`sending`
   * are shared singleton state, same as every other entry point into
   * `runAssistant`. */
  function requestRewrite(
    passage: string,
    instruction: string,
    inline: boolean,
    onDelta: (delta: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    if (sending)
      return Promise.reject(
        new Error("Magic is busy with another request - try again shortly."),
      );
    setOpen(true);
    const displayText = `Rewrite selection: "${instruction}"`;
    return new Promise<string>((resolve, reject) => {
      const userBubbleId = newId();
      setMessages((current) => [
        ...current,
        { id: userBubbleId, role: "user", text: displayText, imagePaths: [] },
      ]);
      wasNearBottomRef.current = true;
      const assistantBubbleId = pushAssistantPlaceholder();
      void runAssistant(displayText, [], assistantBubbleId, {
        passage,
        inline,
        onDelta,
        resolve,
        reject,
      });
      // `runAssistant` sets `abortRef.current` synchronously before its first
      // `await`, so it's already populated by the time this listener is
      // attached right after the (fire-and-forget) call above returns.
      signal.addEventListener("abort", () => abortRef.current?.abort(), {
        once: true,
      });
    });
  }

  // Re-published every render (not just once) so the closure `AiRewriteButton`
  // eventually calls always sees the CURRENT `aiKey`/`typeSlug`/`entryId` -
  // safe with no dependency array since a click can only ever happen after
  // mount, by which point this has already run at least once.
  useEffect(() => {
    rewriteFnRef.current = requestRewrite;
  });

  async function handleComposerSubmit() {
    const text = prompt.trim();
    if (!text || sending) return;
    setPrompt("");
    const paths = attachedPaths;
    setAttachedPaths([]);
    setOpen(true);
    let images: MagicChatEncodedImage[] = [];
    try {
      images = await Promise.all(paths.map(encodeContextImage));
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "error",
          text:
            error instanceof Error
              ? error.message
              : "Could not attach an image.",
          retryText: text,
          retryImages: [],
        },
      ]);
      return;
    }
    sendTurn(text, images);
  }

  function handleSuggestion(text: string) {
    setPrompt(text);
  }

  function handleAnswerQuestion(
    bubbleId: string,
    choices: MagicWriteChoice[],
    chosenIds: Set<string>,
    other: string,
  ) {
    const labels = choices
      .filter((choice) => chosenIds.has(choice.id))
      .map((choice) => `"${choice.label}"`);
    const parts: string[] = [];
    if (labels.length) parts.push(`Selected: ${labels.join(", ")}`);
    if (other.trim()) parts.push(`Other: "${other.trim()}"`);
    const answerText = parts.join(". ") || "No selection.";
    updateBubble(bubbleId, (bubble) =>
      bubble.role === "question" ? { ...bubble, answer: answerText } : bubble,
    );
    const assistantBubbleId = pushAssistantPlaceholder();
    void runAssistant(answerText, [], assistantBubbleId);
  }

  function handleRetry(
    bubbleId: string,
    text: string,
    images: MagicChatEncodedImage[],
  ) {
    setMessages((current) =>
      current.filter((bubble) => bubble.id !== bubbleId),
    );
    const assistantBubbleId = pushAssistantPlaceholder();
    void runAssistant(text, images, assistantBubbleId);
  }

  function handleStop() {
    stopReasonRef.current = "stop";
    abortRef.current?.abort();
  }

  /** Resets the conversation back to empty - stays open (unlike the old
   * bare "✕", this is the ONLY reset control now, per user feedback: no
   * separate close/end action, "Clear all" doubles as it). */
  function clearAllNow() {
    abortRef.current?.abort();
    historyRef.current = [];
    sessionImagePathsRef.current = [];
    setMessages([]);
    setPrompt("");
    setAttachedPaths([]);
    setSending(false);
    setStreaming(null);
    setShowEndConfirm(false);
    void discardMagicChatSession(typeSlug, entryId);
  }

  function handleClearAll() {
    if (sending) {
      setShowEndConfirm(true);
      return;
    }
    clearAllNow();
  }

  function handleComposerKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleComposerSubmit();
    }
  }

  if (!canUse) return null;

  const badgeSpinning = sending;
  const bubbleTooltip = streamingFieldName
    ? `Writing "${fieldLabel(streamingFieldName)}"…`
    : sending
      ? "Magic is replying…"
      : messages.length > 0
        ? "Magic - conversation open"
        : "Magic";

  return (
    <div ref={widgetRef} class={`magic-chat-widget${veiFrame ? " vei" : ""}`}>
      {open && (
        <div class="magic-chat-panel">
          <header class="row justify-between align-center">
            <h3>
              <SparkleIcon /> Magic
            </h3>
            <div class="row align-center" style={{ gap: "0.25rem" }}>
              <button
                type="button"
                class="ghost sm"
                onClick={handleClearAll}
                disabled={messages.length === 0}
              >
                <EraserIcon /> Clear all
              </button>
              <button
                type="button"
                class="ghost icon sm"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <XIcon />
              </button>
            </div>
          </header>

          <div class="magic-chat-messages" ref={messagesRef}>
            <div class="magic-chat-messages-viewport" ref={messagesViewportRef}>
              {messages.length === 0 && (
                <div class="magic-chat-empty">
                  <p class="hint">
                    Ask Magic to write, revise, or discuss this entry's content.
                  </p>
                  <div class="row magic-chat-suggestions">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        class="sm outline"
                        onClick={() => handleSuggestion(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  <AiKeyPicker selection={aiKey} />
                </div>
              )}
              {messages.map((bubble) => (
                <MagicChatBubbleView
                  key={bubble.id}
                  bubble={bubble}
                  onAnswerQuestion={(chosenIds, other) => {
                    if (bubble.role !== "question") return;
                    handleAnswerQuestion(
                      bubble.id,
                      bubble.choices,
                      chosenIds,
                      other,
                    );
                  }}
                  onRetry={() => {
                    if (bubble.role !== "error") return;
                    handleRetry(
                      bubble.id,
                      bubble.retryText,
                      bubble.retryImages,
                    );
                  }}
                />
              ))}
            </div>
          </div>

          {showNewMessagesChip && (
            <button
              type="button"
              class="sm outline magic-chat-jump"
              onClick={() => {
                wasNearBottomRef.current = true;
                scrollToBottom({ behavior: "smooth" });
                setShowNewMessagesChip(false);
              }}
            >
              ↓ New messages
            </button>
          )}

          {attachedPaths.length > 0 && (
            <div class="row magic-chat-attach-strip">
              {attachedPaths.map((imagePath) => (
                <div key={imagePath} class="magic-chat-attach-thumb">
                  <img src={resolveImageSrc(imagePath)} alt="" />
                  <button
                    type="button"
                    class="ghost icon sm"
                    aria-label="Remove"
                    onClick={() =>
                      setAttachedPaths((current) =>
                        current.filter((p) => p !== imagePath),
                      )
                    }
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}

          <footer class="magic-chat-composer">
            <button
              type="button"
              class="ghost icon"
              aria-label="Attach images"
              onClick={() => setPickerOpen(true)}
              disabled={sending}
            >
              <PlusIcon />
            </button>
            <textarea
              class="magic-chat-input"
              placeholder="Message Magic…"
              value={prompt}
              onInput={(event) =>
                setPrompt((event.target as HTMLTextAreaElement).value)
              }
              onKeyDown={handleComposerKeyDown}
              rows={1}
            />
            {sending ? (
              <button
                type="button"
                class="icon magic-chat-stop"
                aria-label="Stop"
                onClick={handleStop}
              >
                <span class="magic-chat-stop-square" />
              </button>
            ) : (
              <button
                type="button"
                class="icon"
                aria-label="Send"
                disabled={!prompt.trim()}
                onClick={() => void handleComposerSubmit()}
              >
                <SparkleIcon />
              </button>
            )}
          </footer>
        </div>
      )}

      {/* Hidden while the panel itself is open - the panel already IS the
       * "chat is here" surface (its own "-" gets back to bubble-only), so
       * showing both at once just duplicated the same affordance. */}
      {!open && (
        <button
          type="button"
          class={`magic-chat-bubble${badgeSpinning ? " busy" : ""}`}
          data-tooltip={bubbleTooltip}
          aria-label="Magic"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <SparkleIcon />
          {badgeSpinning && <span class="magic-chat-bubble-spinner" />}
          {!badgeSpinning && messages.length > 0 && (
            <span class="magic-chat-bubble-dot" />
          )}
        </button>
      )}

      <MagicChatImagePicker
        source={source}
        entrySource={entrySource}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAttach={(picked) =>
          setAttachedPaths((current) => [...new Set([...current, ...picked])])
        }
      />

      <ConfirmDialog
        open={showEndConfirm}
        title="Clear this conversation?"
        message={
          <p>
            Magic is still replying. Clearing now stops it and erases the
            conversation.
          </p>
        }
        confirmLabel="Clear all"
        destructive
        onConfirm={clearAllNow}
        onCancel={() => setShowEndConfirm(false)}
      />
    </div>
  );
}

function MagicChatBubbleView({
  bubble,
  onAnswerQuestion,
  onRetry,
}: {
  bubble: ChatBubble;
  onAnswerQuestion: (chosenIds: Set<string>, other: string) => void;
  onRetry: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [other, setOther] = useState("");

  if (bubble.role === "user") {
    return (
      <div class="magic-chat-row user">
        <div class="magic-chat-bubble-msg user">
          {bubble.imagePaths.length > 0 && (
            <div class="row magic-chat-bubble-images">
              {bubble.imagePaths.map((imagePath) => (
                <img key={imagePath} src={resolveImageSrc(imagePath)} alt="" />
              ))}
            </div>
          )}
          <p>{bubble.text}</p>
        </div>
      </div>
    );
  }

  if (bubble.role === "assistant") {
    return (
      <div class="magic-chat-row assistant">
        <div class="magic-chat-bubble-msg assistant">
          {bubble.text ? (
            <p>{bubble.text}</p>
          ) : (
            <span class="magic-chat-typing" aria-label="Magic is typing" />
          )}
        </div>
      </div>
    );
  }

  if (bubble.role === "status") {
    return (
      <div class="magic-chat-row status">
        <span class="magic-chat-status-line hint">{bubble.text}</span>
      </div>
    );
  }

  if (bubble.role === "error") {
    return (
      <div class="magic-chat-row status">
        <div class="alert destructive magic-chat-error">
          <span>{bubble.text}</span>
          <button type="button" class="sm outline" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // "question"
  return (
    <div class="magic-chat-row assistant">
      <div class="magic-chat-bubble-msg assistant ai-wizard-question">
        <p class="ai-wizard-question-text">{bubble.question}</p>
        <div
          class="row ai-wizard-choices"
          role="group"
          aria-label={bubble.question}
        >
          {bubble.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              class="sm outline ai-wizard-choice"
              disabled={!!bubble.answer}
              aria-pressed={chosen.has(choice.id)}
              onClick={() =>
                setChosen((current) => {
                  if (bubble.multi) {
                    const next = new Set(current);
                    if (next.has(choice.id)) next.delete(choice.id);
                    else next.add(choice.id);
                    return next;
                  }
                  return new Set([choice.id]);
                })
              }
            >
              {choice.label}
            </button>
          ))}
        </div>
        {bubble.allowOther && !bubble.answer && (
          <input
            type="text"
            placeholder="Type your own answer…"
            value={other}
            onInput={(event) =>
              setOther((event.currentTarget as HTMLInputElement).value)
            }
          />
        )}
        {!bubble.answer && (
          <button
            type="button"
            class="sm"
            disabled={chosen.size === 0 && !(bubble.allowOther && other.trim())}
            onClick={() => onAnswerQuestion(chosen, other)}
          >
            Continue
          </button>
        )}
        {bubble.answer && (
          <p class="hint magic-chat-question-answer">{bubble.answer}</p>
        )}
      </div>
    </div>
  );
}

/** A trimmed picker for attaching images to one chat turn - the Entry/File
 * tabs of `ImageField.tsx`'s own picker dialog (via the shared
 * `EntryScopedPicker`, minus its Link tab: an external URL is a path the
 * server can't `storage.stat()`, so it could never be attached anyway),
 * reusing the same `.image-picker-dialog` CSS and `FileManager` it's built
 * on rather than the full field (which also renders a persistent 4:3 frame/
 * reorderable list that doesn't fit an ephemeral chat attachment). */
function MagicChatImagePicker({
  source,
  entrySource,
  open,
  onClose,
  onAttach,
}: {
  source: FileManagerSource;
  entrySource?: FileManagerSource;
  open: boolean;
  onClose: () => void;
  onAttach: (paths: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const dialogRef = useDialogSync(open, onClose);
  const { ref: bodyRef } = useOverlayScrollbars<HTMLDivElement>([open]);

  useEffect(() => {
    if (open) setPicked([]);
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      class="file-dialog image-picker-dialog"
      aria-label="Attach images"
    >
      {open && (
        <>
          <header>
            <h3>Attach images</h3>
          </header>
          <div class="image-picker-body" ref={bodyRef}>
            <EntryScopedPicker
              fullSource={source}
              entrySource={entrySource}
              value={picked}
              onChange={(next) =>
                setPicked(Array.isArray(next) ? next : [next])
              }
              multiple
              accept={IMAGE_EXTENSIONS}
              syncUrl={false}
            />
          </div>
          <footer>
            <button type="button" class="outline" onClick={onClose}>
              Cancel
            </button>
            <span class="spacer" />
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => {
                onAttach(picked);
                onClose();
              }}
            >
              Attach{picked.length > 0 ? ` (${picked.length})` : ""}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
