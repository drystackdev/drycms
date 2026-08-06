import { useRef, useState } from "preact/hooks";
import { useDialogSync } from "../../hooks/list-nav.js";
import { SparkleIcon } from "../AiSparkleIcon.js";
import { exportFragmentHtml } from "./html.js";
import { replaceSelectionWithHtml, runCommand } from "./commands.js";
import { sanitizeAiRichTextHtml } from "../../content-types/ai-richtext-sanitize.js";
import type { ToolbarCustomProps } from "./types.js";

const { path, aiMode } = window.__DRY_CONFIG__;

type Stage = "prompt" | "loading" | "preview" | "error";

interface RewriteStreamEvent {
  delta?: string;
  html?: string;
  error?: string;
}

/**
 * Reads `/api/ai/rewrite-selection`'s SSE stream (see `ai.ts`) - unlike
 * Magic Write's structured YAML turns, this endpoint's reply IS the
 * rewritten HTML fragment directly: `{delta}` chunks of raw model output
 * while it streams (shown as a plain-text preview, not injected into the
 * document mid-stream - see this component's own doc comment), then one
 * final `{html}` event once the server has sanitized the complete text.
 */
async function requestRewrite(
  passage: string,
  instruction: string,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${path}/api/ai/rewrite-selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passage, instruction }),
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
      let event: RewriteStreamEvent;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.html !== undefined) return event.html;
      if (event.delta) onDelta(event.delta);
    }
  }
  throw new Error("AI connection closed unexpectedly.");
}

/**
 * Toolbar button for `RichTextFieldConfig.aiRewrite` (`status/magic-write.md`
 * Phase 4) - rewrites the CURRENT text selection via a short instruction.
 * Deliberately never injects a still-growing/unsanitized reply straight into
 * the document mid-stream (unlike Magic Write's own per-field live commit for
 * a plain "text" field) - a RichText passage always needs
 * `sanitizeAiRichTextHtml` first, and a partial HTML string mid-tag would
 * DOMParser-misparse the same way `parseMagicWriteYaml`'s own decision #4
 * update warns against. The raw stream is shown as a live plain-text
 * preview instead; the document itself is only ever touched once, when the
 * admin confirms "Replace".
 */
export default function AiRewriteButton({ viewRef, state, disabled = false, iconSize, shortcut }: ToolbarCustomProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("prompt");
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState("");
  const [finalHtml, setFinalHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogSync(open, () => handleCancel());
  const abortRef = useRef<AbortController | null>(null);
  const passageRef = useRef("");

  if (aiMode !== "server") return <></>;

  const preserveSelection = (event: MouseEvent) => event.preventDefault();

  function openDialog() {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection;
    passageRef.current = exportFragmentHtml(view.state.doc.slice(from, to).content);
    setInstruction("");
    setStage("prompt");
    setPreview("");
    setFinalHtml("");
    setError(null);
    setOpen(true);
  }

  async function generate() {
    setStage("loading");
    setPreview("");
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const html = await requestRewrite(passageRef.current, instruction.trim(), (delta) => {
        setPreview((current) => current + delta);
      }, controller.signal);
      setFinalHtml(html);
      setStage("preview");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "AI request failed.");
      setStage("error");
    }
  }

  function apply() {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, replaceSelectionWithHtml(sanitizeAiRichTextHtml(finalHtml), false));
    setOpen(false);
  }

  function handleCancel() {
    abortRef.current?.abort();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        class={`ghost icon ${iconSize}`}
        aria-label="Rewrite selection with AI"
        data-tooltip={`Rewrite selection with AI${shortcut ? ` (${shortcut})` : ""}`}
        aria-haspopup="dialog"
        disabled={disabled || !state.hasSelection}
        onMouseDown={preserveSelection}
        onClick={openDialog}
      >
        <SparkleIcon />
      </button>
      <dialog ref={dialogRef} aria-label="Rewrite selection with AI">
        {open && (
          <>
            <header>
              <h3>
                <SparkleIcon /> Rewrite selection
              </h3>
            </header>
            <div class="stack">
              {stage === "prompt" && (
                <label>
                  Instruction
                  <textarea
                    rows={3}
                    placeholder="VD: Viết lại ngắn gọn hơn, giọng văn thân thiện"
                    value={instruction}
                    onInput={(event) => setInstruction((event.currentTarget as HTMLTextAreaElement).value)}
                  />
                </label>
              )}
              {stage === "loading" && (
                <div class="stack">
                  <div class="row align-center" style={{ gap: "0.5rem" }}>
                    <span class="spinner" /> Writing…
                  </div>
                  <div class="hint" style={{ whiteSpace: "pre-wrap" }}>{preview}</div>
                </div>
              )}
              {stage === "preview" && (
                // Plain preview - `.richtext-content`'s real styling only
                // applies inside the field's own shadow root
                // (`content-shadow-styles.ts`, see
                // `project_drycms_richtext_shadow_dom` memory), which this
                // popover dialog isn't part of.
                <div dangerouslySetInnerHTML={{ __html: sanitizeAiRichTextHtml(finalHtml) }} />
              )}
              {stage === "error" && <div class="alert destructive">{error}</div>}
            </div>
            <footer>
              <button type="button" class="outline" onClick={handleCancel}>
                Cancel
              </button>
              {stage === "prompt" && (
                <button type="button" disabled={!instruction.trim()} onClick={() => void generate()}>
                  Generate
                </button>
              )}
              {stage === "preview" && (
                <>
                  <button type="button" class="outline" onClick={() => void generate()}>
                    Regenerate
                  </button>
                  <button type="button" onClick={apply}>
                    Replace
                  </button>
                </>
              )}
              {stage === "error" && (
                <button type="button" onClick={() => void generate()}>
                  Try again
                </button>
              )}
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
