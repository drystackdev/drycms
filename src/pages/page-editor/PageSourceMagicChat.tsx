import { useEffect, useRef, useState } from "preact/hooks";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import AiKeyPicker, { useAiKeySelection } from "../../components/AiKeyPicker.js";
import { SparkleIcon } from "../../components/AiSparkleIcon.js";
import { EraserIcon, LockIcon, XIcon } from "../../components/icons/index.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { toast } from "../../components/Toast.js";
import {
  discardPageSourceMagicChatSession,
  loadPageSourceMagicChatSession,
  savePageSourceMagicChatSession,
} from "./page-source-magic-chat-store.js";
import type { PageSourceChatBubble, PageSourceMagicChatHistoryMessage } from "./page-source-magic-chat-store.js";
import { parsePartialPageSourceYaml } from "../../page-components/ai-page-source-protocol.js";

const { path } = window.__DRY_CONFIG__;

/**
 * "Magic" for the Page Editor - a sibling of `content-entry-editor/
 * MagicChat.tsx` (same floating-bubble-expands-into-a-panel UI, same
 * `popover="manual"` top-layer mounting trick, same IndexedDB session
 * persistence shape), NOT a reuse of that component: this one edits raw
 * `.tsx`/`.css` source text, not typed content-entry fields, so its "apply"
 * step is fundamentally different (see `status/page-editor-magic-chat.md`).
 *
 * Per that plan, a `kind: code` reply is written DIRECTLY into the open
 * file's live editor buffer as it streams (`onCodeChange`, called on every
 * delta) - no diff/preview/confirm gate. The existing Save/Reset/diagnostics
 * flow already in `PageEditor.tsx` is the safety net: nothing here ever
 * touches real storage itself (see `ai-page-source-write.ts`'s own doc
 * comment), only the in-memory buffer the admin's own Save button already
 * writes from.
 */

const SUGGESTIONS = [
  "Explain what this file does",
  "Add a new section to this page",
  "Clean up the styling",
];

interface PageSourceCodeResult {
  kind: "code";
  summary: string;
  code: string;
}

interface PageSourceChatResult {
  kind: "chat";
  text: string;
}

type PageSourceTurnResult = PageSourceCodeResult | PageSourceChatResult;

interface PageSourceStreamEvent {
  delta?: string;
  retry?: boolean;
  reading?: string;
  turn?: PageSourceTurnResult;
  aiLabel?: string;
  error?: string;
}

/** Same drain-and-dispatch shape as `MagicChat.tsx`'s own `requestMagicTurn`,
 * against `/api/page-source-ai` instead of `/api/ai/magic-write` and the
 * `{reading}` event `ai-page-source-write.ts` sends for a `kind: read` hop
 * instead of `{fetching}`/`{creating}`. */
async function requestPageSourceTurn(
  payload: Record<string, unknown>,
  onDelta: (delta: string) => void,
  onRetry: () => void,
  onReading: (label: string) => void,
  signal: AbortSignal,
): Promise<{ turn: PageSourceTurnResult; aiLabel: string }> {
  const response = await fetch(`${path}/api/page-source-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.message === "string" ? body.message : "AI request failed.");
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
      let event: PageSourceStreamEvent;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.turn) return { turn: event.turn, aiLabel: event.aiLabel ?? "AI" };
      if (event.retry) onRetry();
      else if (event.reading) onReading(event.reading);
      else if (event.delta) onDelta(event.delta);
    }
  }
  throw new Error("AI connection closed unexpectedly.");
}

export interface PageSourceMagicChatProps {
  /** The file currently open in the editor. */
  path: string;
  /** That file's current buffer content (`sourceByPath[path]`). */
  code: string;
  /** Writes new content into `path`'s buffer - `PageEditor.tsx`'s
   * `setSourceByPath`-based setter, the exact same seam `handleChange`/
   * `handleReset` already use, so an AI edit is indistinguishable from a
   * hand-typed one to the rest of the page (dirty tracking, diagnostics,
   * Save, Reset). Always called with the ORIGINAL target path, even if
   * `path` (this component's own prop) has since changed - see
   * `runAssistant`'s own doc comment. */
  onCodeChange: (path: string, code: string) => void;
  /** `PageEditor.tsx`'s own `canEdit` (`canAccess(PAGE_BUILDER_RESOURCE_ID,
   * "setting")`) - the same single toggle already gating the whole page,
   * reused as-is rather than adding a separate "magic" grant (see
   * `status/page-editor-magic-chat.md`: the System fieldset's toggles are
   * deliberately flat, all-or-nothing). */
  canUse: boolean;
}

export default function PageSourceMagicChat({ path: filePath, code, onCodeChange, canUse }: PageSourceMagicChatProps) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<PageSourceChatBubble[]>([]);
  const [sessionLang, setSessionLang] = useState<"vi" | "en">("vi");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showNewMessagesChip, setShowNewMessagesChip] = useState(false);

  const aiKey = useAiKeySelection(open);

  const historyRef = useRef<PageSourceMagicChatHistoryMessage[]>([]);
  const rawTextRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const stopReasonRef = useRef<"stop" | null>(null);
  const idRef = useRef(0);
  const mountedRef = useRef(true);
  /** `Editer`'s `value` prop is fully controlled - EVERY external write (not
   * just the terminal one) resets the caret to the start and collapses its
   * undo stack to one entry (`prism-code-editor`'s own `setOptions({value})`
   * behavior, confirmed against `Editer.tsx`'s value-sync effect). Applying
   * every single streamed delta directly would do that on nearly every
   * token; trailing-debounced here (mirrors `Editer`'s own 300ms worker
   * debounce) so the buffer still updates live, just not on literally every
   * tick - purely a smoothness/perf mitigation, not a correctness one:
   * `handleReset`'s safety net reads `savedByPath`, never the editor's own
   * undo history, so this doesn't change what's recoverable. */
  const pendingCodeRef = useRef<string | null>(null);
  const codeFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest `path` prop, kept for a completed turn to notice (after the
   * fact) whether the admin switched files while it was running - see
   * `runAssistant`. Not used to decide WHERE a turn writes (that's always
   * the `targetPath` it captured at its own start), only whether to show
   * the "updated in the background" toast. */
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  useEffect(
    () => () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (codeFlushTimerRef.current !== null) clearTimeout(codeFlushTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const el = widgetRef.current;
    if (!el) return;
    el.setAttribute("popover", "manual");
    el.showPopover?.();
  }, []);

  // Restores a persisted conversation for THIS file, resetting when the
  // admin opens a different one - same shape `MagicChat.tsx` uses for
  // `[typeSlug, entryId]`. A turn already in flight for the file this
  // widget was PREVIOUSLY showing keeps running in the background (its own
  // `runAssistant` call captured that file's path/content before this reset
  // ever ran) - it still lands in that file's buffer via `onCodeChange`,
  // just no longer reflected in this now-reset message list. Reopening that
  // file later replays whatever was persisted before the switch, not the
  // reply that arrived after - an accepted v1 rough edge, see
  // `status/page-editor-magic-chat.md`.
  useEffect(() => {
    setMessages([]);
    setSessionLang("vi");
    historyRef.current = [];
    idRef.current = 0;
    let cancelled = false;
    void (async () => {
      const saved = await loadPageSourceMagicChatSession(filePath);
      if (cancelled || !saved) return;
      setMessages(
        saved.messages.map((bubble) => {
          if (bubble.role !== "assistant" || !bubble.streaming) return bubble;
          return bubble.text ? { ...bubble, streaming: false } : { id: bubble.id, role: "status", text: "Interrupted." };
        }),
      );
      setSessionLang(saved.lang);
      historyRef.current = saved.history;
      idRef.current = saved.nextId;
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    if (messages.length === 0) return;
    savePageSourceMagicChatSession(filePath, { messages, history: historyRef.current, nextId: idRef.current, lang: sessionLang });
  }, [messages, filePath, sessionLang]);

  const {
    ref: messagesRef,
    viewportRef: messagesViewportRef,
    scrollToBottom,
    isNearBottom,
  } = useOverlayScrollbars<HTMLDivElement>([open]);
  const wasNearBottomRef = useRef(true);

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

  function newId(): string {
    idRef.current += 1;
    return `page-source-magic-${idRef.current}`;
  }

  function updateBubble(id: string, updater: (bubble: PageSourceChatBubble) => PageSourceChatBubble) {
    setMessages((current) => current.map((bubble) => (bubble.id === id ? updater(bubble) : bubble)));
  }

  function cancelCodeFlush() {
    if (codeFlushTimerRef.current !== null) {
      clearTimeout(codeFlushTimerRef.current);
      codeFlushTimerRef.current = null;
    }
    pendingCodeRef.current = null;
  }

  function scheduleCodeFlush(targetPath: string, nextCode: string) {
    pendingCodeRef.current = nextCode;
    if (codeFlushTimerRef.current !== null) return;
    codeFlushTimerRef.current = setTimeout(() => {
      codeFlushTimerRef.current = null;
      if (pendingCodeRef.current !== null) onCodeChange(targetPath, pendingCodeRef.current);
      pendingCodeRef.current = null;
    }, 150);
  }

  function pushAssistantPlaceholder(): string {
    const id = newId();
    setMessages((current) => [...current, { id, role: "assistant", text: "", streaming: true }]);
    return id;
  }

  /** `targetPath`/`targetSource` are captured by the caller (`sendTurn`)
   * from THIS render's own `filePath`/`code` props, synchronously - the
   * exact same "freshest at click time" guarantee `MagicChat.tsx`'s
   * `valueRef.current` read gives, just via a plain closure instead of a
   * ref (no `await` happens between the click and this capture, so there's
   * nothing for a prop change to race). Every `onCodeChange` call below
   * uses `targetPath`, never the live `filePath` prop - a mid-stream file
   * switch in the editor can't redirect where this turn's output lands. */
  async function runAssistant(userText: string, assistantBubbleId: string, targetPath: string, targetSource: string) {
    setSending(true);
    stopReasonRef.current = null;
    rawTextRef.current = "";
    const controller = new AbortController();
    abortRef.current = controller;
    const historyForThisTurn = historyRef.current;

    function handleDelta(delta: string) {
      rawTextRef.current += delta;
      const partial = parsePartialPageSourceYaml(rawTextRef.current);
      if (partial.kind === "code") {
        if (typeof partial.code === "string") scheduleCodeFlush(targetPath, partial.code);
        updateBubble(assistantBubbleId, (bubble) => ({ ...bubble, role: "status", text: partial.summary || "Writing code…" }) as PageSourceChatBubble);
        return;
      }
      updateBubble(assistantBubbleId, (bubble) => (bubble.role === "assistant" ? { ...bubble, text: partial.text ?? "" } : bubble));
    }

    function pushReadingStatus(label: string) {
      rawTextRef.current = "";
      setMessages((current) => [...current, { id: newId(), role: "status", text: label }]);
    }

    try {
      const result = await requestPageSourceTurn(
        {
          path: targetPath,
          currentSource: targetSource,
          prompt: userText,
          history: historyForThisTurn,
          lang: sessionLang,
          aiKeyName: aiKey.keyName,
          aiModel: aiKey.model,
        },
        handleDelta,
        () => {
          rawTextRef.current = "";
        },
        pushReadingStatus,
        controller.signal,
      );
      if (!mountedRef.current) return;

      cancelCodeFlush();
      let assistantHistoryText: string;
      if (result.turn.kind === "chat") {
        updateBubble(assistantBubbleId, () => ({ id: assistantBubbleId, role: "assistant", text: result.turn.kind === "chat" ? result.turn.text : "", streaming: false }));
        assistantHistoryText = result.turn.text;
      } else {
        onCodeChange(targetPath, result.turn.code);
        // Terse summary only in history - never the full file text, same
        // "don't resend a whole passage every future turn" reasoning
        // `MagicChat.tsx`'s own `rewrite`-turn history entry uses.
        updateBubble(assistantBubbleId, () => ({ id: assistantBubbleId, role: "status", text: `Wrote: ${result.turn.kind === "code" ? result.turn.summary : ""}` }));
        assistantHistoryText = result.turn.summary;
        if (targetPath !== filePathRef.current) {
          toast.add({ type: "info", title: `Magic updated "${targetPath}"`, description: "Open that file to see the change." });
        }
      }
      historyRef.current = [...historyForThisTurn, { role: "user", text: userText }, { role: "assistant", text: assistantHistoryText }];
      setSending(false);
    } catch (error) {
      cancelCodeFlush();
      if (!mountedRef.current) return;
      if (controller.signal.aborted) {
        setSending(false);
        if (stopReasonRef.current === "stop") {
          updateBubble(assistantBubbleId, () => ({ id: assistantBubbleId, role: "status", text: "Stopped." }));
          historyRef.current = [...historyForThisTurn, { role: "user", text: userText }];
        }
        return;
      }
      setSending(false);
      const message = error instanceof Error ? error.message : "AI request failed.";
      updateBubble(assistantBubbleId, () => ({ id: assistantBubbleId, role: "error", text: message, retryText: userText }));
    }
  }

  function sendTurn(userText: string) {
    const userBubbleId = newId();
    setMessages((current) => [...current, { id: userBubbleId, role: "user", text: userText }]);
    wasNearBottomRef.current = true;
    const assistantBubbleId = pushAssistantPlaceholder();
    void runAssistant(userText, assistantBubbleId, filePath, code);
  }

  async function handleComposerSubmit() {
    const text = prompt.trim();
    if (!text || sending) return;
    setPrompt("");
    setOpen(true);
    sendTurn(text);
  }

  function handleSuggestion(text: string) {
    setPrompt(text);
  }

  function handleRetry(bubbleId: string, text: string) {
    setMessages((current) => current.filter((bubble) => bubble.id !== bubbleId));
    const assistantBubbleId = pushAssistantPlaceholder();
    void runAssistant(text, assistantBubbleId, filePath, code);
  }

  function handleStop() {
    stopReasonRef.current = "stop";
    abortRef.current?.abort();
  }

  function clearAllNow() {
    abortRef.current?.abort();
    historyRef.current = [];
    setMessages([]);
    setPrompt("");
    setSending(false);
    setShowEndConfirm(false);
    void discardPageSourceMagicChatSession(filePath);
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
  const bubbleTooltip = sending ? "Magic is replying…" : messages.length > 0 ? "Magic - conversation open" : "Magic";

  return (
    <div ref={widgetRef} class="magic-chat-widget">
      {open && (
        <div class="magic-chat-panel">
          <header class="row justify-between align-center">
            <h3>
              <SparkleIcon /> Magic
            </h3>
            <div class="row align-center" style={{ gap: "0.25rem" }}>
              <button type="button" class="ghost sm" onClick={handleClearAll} disabled={messages.length === 0}>
                <EraserIcon /> Clear all
              </button>
              <a href={`${path}/mcp`} target="_blank" rel="noopener" class="ghost icon sm" aria-label="Connect an MCP client" data-tooltip="Connect an MCP client (API Token)">
                <LockIcon />
              </a>
              <button type="button" class="ghost icon sm" aria-label="Close" onClick={() => setOpen(false)}>
                <XIcon />
              </button>
            </div>
          </header>

          <div class="magic-chat-messages" ref={messagesRef}>
            <div class="magic-chat-messages-viewport" ref={messagesViewportRef}>
              {messages.length === 0 && (
                <div class="magic-chat-empty">
                  <p class="hint">Ask Magic to explain, write, or revise "{filePath}".</p>
                  <div class="row magic-chat-suggestions">
                    {SUGGESTIONS.map((suggestion) => (
                      <button key={suggestion} type="button" class="sm outline" onClick={() => handleSuggestion(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  <div class="field">
                    <label>Output language</label>
                    <div class="file-view-toggle" role="group" aria-label="Output language">
                      <button type="button" class="ghost sm" aria-pressed={sessionLang === "vi"} onClick={() => setSessionLang("vi")}>
                        Tiếng Việt
                      </button>
                      <button type="button" class="ghost sm" aria-pressed={sessionLang === "en"} onClick={() => setSessionLang("en")}>
                        English
                      </button>
                    </div>
                  </div>
                  <AiKeyPicker selection={aiKey} />
                </div>
              )}
              {messages.map((bubble) => (
                <PageSourceMagicChatBubbleView key={bubble.id} bubble={bubble} onRetry={() => handleRetry(bubble.id, bubble.role === "error" ? bubble.retryText : "")} />
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

          <footer class="magic-chat-composer">
            <textarea
              class="magic-chat-input"
              placeholder="Message Magic…"
              value={prompt}
              onInput={(event) => setPrompt((event.target as HTMLTextAreaElement).value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
            />
            {sending ? (
              <button type="button" class="icon magic-chat-stop" aria-label="Stop" onClick={handleStop}>
                <span class="magic-chat-stop-square" />
              </button>
            ) : (
              <button type="button" class="icon" aria-label="Send" disabled={!prompt.trim()} onClick={() => void handleComposerSubmit()}>
                <SparkleIcon />
              </button>
            )}
          </footer>
        </div>
      )}

      {!open && (
        <button type="button" class={`magic-chat-bubble${badgeSpinning ? " busy" : ""}`} data-tooltip={bubbleTooltip} aria-label="Magic" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <SparkleIcon />
          {badgeSpinning && <span class="magic-chat-bubble-spinner" />}
          {!badgeSpinning && messages.length > 0 && <span class="magic-chat-bubble-dot" />}
        </button>
      )}

      <ConfirmDialog
        open={showEndConfirm}
        title="Clear this conversation?"
        message={<p>Magic is still replying. Clearing now stops it and erases the conversation.</p>}
        confirmLabel="Clear all"
        destructive
        onConfirm={clearAllNow}
        onCancel={() => setShowEndConfirm(false)}
      />
    </div>
  );
}

function PageSourceMagicChatBubbleView({ bubble, onRetry }: { bubble: PageSourceChatBubble; onRetry: () => void }) {
  if (bubble.role === "user") {
    return (
      <div class="magic-chat-row user">
        <div class="magic-chat-bubble-msg user">
          <p>{bubble.text}</p>
        </div>
      </div>
    );
  }

  if (bubble.role === "assistant") {
    return (
      <div class="magic-chat-row assistant">
        <div class="magic-chat-bubble-msg assistant">{bubble.text ? <p>{bubble.text}</p> : <span class="magic-chat-typing" aria-label="Magic is typing" />}</div>
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
