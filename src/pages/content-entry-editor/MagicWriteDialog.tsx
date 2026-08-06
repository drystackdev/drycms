import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useDialogSync } from "../../hooks/list-nav.js";
import { toast } from "../../components/Toast.js";
import Combobox from "../../components/Combobox.js";
import { ArrowRightIcon } from "../../components/icons/index.js";
import { SparkleIcon } from "../../components/AiSparkleIcon.js";
import TextField from "../../components/fields/TextField.js";
import ImageField from "../../components/fields/ImageField.js";
import { optimizeUploadImage } from "../../components/FileManager/file-manager-image-optimize.js";
import type { FileManagerSource } from "../../storage/entry-types.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import { createContentEntriesApi } from "../../content-types/entries-http-api.js";
import type { EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { parsePartialMagicWriteYaml } from "../../content-types/ai-magic-write-protocol.js";
import type { MagicWriteChoice, MagicWriteRawValue } from "../../content-types/ai-magic-write-protocol.js";
import { applyMagicWriteFields, WRITABLE_COLUMN_TYPES, type MagicWriteScope } from "../../content-types/ai-magic-write-fields.js";
import { sanitizeAiRichTextHtml } from "../../content-types/ai-richtext-sanitize.js";

const { path, aiMode } = window.__DRY_CONFIG__;

/** Same "aiKey" system collection the schema wizard's own AI Key combobox
 * (`AiSchemaWizardPanel.tsx`) already reads - lets the admin pick a
 * SPECIFIC configured provider/model/key for this Magic Write run instead
 * of the server's default fallback order (`ai.ts`'s `readServerCredentials`
 * always resolves against this same collection either way; this is only
 * about letting the admin override which row wins, e.g. to route around a
 * provider that's temporarily overloaded). */
const aiKeyApi = createContentEntriesApi(`${path}/api/content`, "aiKey");

interface MagicWriteEncodedImage {
  path: string;
  mimeType: string;
  base64: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

/** Fetches an already-uploaded storage image's bytes, resizes it down to a
 * small (240px) context-only copy, and base64-encodes it - see
 * `status/magic-write.md` decision #3 for why 240px specifically (vision API
 * token cost scales with pixel count, not quality/file size). Run once per
 * `run()` call, right before the request goes out - `selectedImagePaths`
 * itself is driven by the reused `ImageField` picker below, same as any
 * other image field in this app. */
async function encodeContextImage(imagePath: string): Promise<MagicWriteEncodedImage> {
  const response = await fetch(resolveImageSrc(imagePath));
  if (!response.ok) throw new Error(`Could not load "${imagePath}".`);
  const blob = await response.blob();
  const original = new File([blob], imagePath.split("/").pop() || imagePath, { type: blob.type });
  const optimized = await optimizeUploadImage(original, { maxWidth: 240 });
  const base64 = await fileToBase64(optimized);
  return { path: imagePath, mimeType: optimized.type, base64 };
}

interface MagicWriteFieldsResult {
  kind: "fields";
  summary: string;
  fields: EntryValue;
  writtenFieldNames: string[];
}

interface MagicWriteQuestionResult {
  kind: "question";
  topic: string;
  question: string;
  choices: MagicWriteChoice[];
  multi: boolean;
  allowOther?: boolean;
}

type MagicWriteTurnResult = MagicWriteFieldsResult | MagicWriteQuestionResult;

interface MagicWriteHistoryMessage {
  role: "user" | "assistant";
  text: string;
}

interface MagicWriteStreamEvent {
  delta?: string;
  retry?: boolean;
  turn?: MagicWriteTurnResult;
  aiLabel?: string;
  error?: string;
}

/** Mirrors `AiSchemaWizardPanel.tsx`'s own `requestWizardTurn` - reads the
 * `/api/ai/magic-write` SSE stream, forwarding raw `{delta}` text as it
 * arrives (for `onDelta`'s live incremental commits below) and resolving
 * once a `{turn}` (or `{error}`) event closes the stream. */
async function requestMagicWriteTurn(
  payload: Record<string, unknown>,
  onDelta: (delta: string) => void,
  onRetry: () => void,
  signal: AbortSignal,
): Promise<{ turn: MagicWriteTurnResult; aiLabel: string }> {
  const response = await fetch(`${path}/api/ai/magic-write`, {
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
      let event: MagicWriteStreamEvent;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.turn) return { turn: event.turn, aiLabel: event.aiLabel ?? "AI" };
      if (event.retry) onRetry();
      else if (event.delta) onDelta(event.delta);
    }
  }
  throw new Error("AI connection closed unexpectedly.");
}

/** A top-level field Magic Write can offer to write - relation/relation-
 * mirror/password/secretkey are never candidates (see
 * `status/magic-write.md` decision #2). */
function isMagicWriteCandidate(node: EntryFieldNode): boolean {
  if (node.kind === "column") return WRITABLE_COLUMN_TYPES.has(node.fieldType);
  if (node.kind === "flatten") return node.children.some(isMagicWriteCandidate);
  if (node.kind === "component-repeat") return node.itemFields.some(isMagicWriteCandidate);
  return false;
}

type Stage = "start" | "loading" | "question" | "error";

export interface MagicWriteDialogProps {
  /** Bumped by `ContentEntryEditor.tsx` on every "Magic Write" button click
   * - the trigger for a fresh session, NOT a plain visibility flag (unlike
   * most dialogs here). Visibility itself is fully internal: the native
   * `<dialog>` hides the moment a request starts streaming (the admin
   * watches it happen directly in the real, disabled form fields instead -
   * see `status/magic-write.md` decision #4) and re-shows itself the moment
   * the model asks a clarifying question, or the run errors out. Clicking
   * the button again while a run is already active just reveals whatever's
   * currently going on instead of starting over - see `activeRef` below.
   * `0` is a reserved "never opened yet" sentinel the initial mount skips. */
  openToken: number;
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
  /** Where the context-image `ImageField`'s picker reads its files from
   * (Phase 2, `status/magic-write.md` decision #3). */
  source: FileManagerSource;
}

export default function MagicWriteDialog({
  openToken,
  typeSlug,
  entryId,
  nodes,
  value,
  updateFieldValue,
  onStreamingFieldChange,
  source,
}: MagicWriteDialogProps) {
  const writableNodes = useMemo(() => nodes.filter(isMagicWriteCandidate), [nodes]);

  const [dialogVisible, setDialogVisible] = useState(false);
  const [stage, setStage] = useState<Stage>("start");
  // Only actually rendered when the dialog is re-opened WHILE still
  // "loading" (the admin clicked the button again mid-stream - see the
  // `openToken` effect's "reveal, don't reset" branch below); the dialog
  // is hidden for the common case, so this never shows on its own.
  const [rawText, setRawText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"empty" | "selected">("empty");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<MagicWriteQuestionResult | null>(null);
  const [questionChoice, setQuestionChoice] = useState<Set<string>>(new Set());
  const [questionOther, setQuestionOther] = useState("");
  const [selectedImagePaths, setSelectedImagePaths] = useState<string[]>([]);
  const [aiKeyName, setAiKeyName] = useState<string | undefined>(undefined);
  const [aiKeyOptions, setAiKeyOptions] = useState<{ value: string; label: string }[]>([]);

  const ref = useDialogSync(dialogVisible, () => handleCancel());

  const rawTextRef = useRef("");
  const committedRef = useRef<Set<string>>(new Set());
  const streamingNameRef = useRef<string | null>(null);
  const requestValueRef = useRef<EntryValue>({});
  const scopeRef = useRef<MagicWriteScope>({ mode: "empty" });
  const historyRef = useRef<MagicWriteHistoryMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /** True from the moment a session starts (the dialog first opens for this
   * `openToken`) until it fully finishes (success) or is explicitly
   * cancelled - independent of `dialogVisible`, which toggles freely within
   * an active session (hidden while streaming, shown for start/question/
   * error). Gates what a repeat button click does: reveal the active
   * session, or start a brand new one. */
  const activeRef = useRef(false);

  useEffect(() => {
    if (openToken === 0) return; // Initial mount value - the button was never actually clicked yet.
    if (activeRef.current) {
      // A session is already running (possibly hidden mid-stream) - just
      // bring it back on screen, don't discard any in-progress state.
      setDialogVisible(true);
      return;
    }
    activeRef.current = true;
    setStage("start");
    setPrompt("");
    setMode("empty");
    setSelectedFields(new Set());
    setError(null);
    setQuestion(null);
    setQuestionChoice(new Set());
    setQuestionOther("");
    setSelectedImagePaths([]);
    setAiKeyName(undefined);
    setRawText("");
    rawTextRef.current = "";
    committedRef.current = new Set();
    streamingNameRef.current = null;
    historyRef.current = [];
    setDialogVisible(true);
    if (aiMode === "server") {
      void aiKeyApi
        .list({ page: 0, pageSize: 100 })
        .then((result) => {
          setAiKeyOptions(
            result.rows
              .map((row) => ({
                value: String(row.value.name ?? ""),
                label: `${String(row.value.name ?? "Unnamed")} (${String(row.value.provider ?? "")})`,
              }))
              .filter((option) => option.value),
          );
        })
        .catch(() => setAiKeyOptions([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only on a real button click (openToken change), never on the reveal-only branch above
  }, [openToken]);

  function setStreaming(name: string | null) {
    if (streamingNameRef.current === name) return;
    streamingNameRef.current = name;
    onStreamingFieldChange(name);
  }

  function commitField(name: string, raw: MagicWriteRawValue) {
    if (committedRef.current.has(name)) return;
    committedRef.current.add(name);
    const node = writableNodes.find((candidate) => candidate.fieldName === name);
    if (!node) return;
    const applied = applyMagicWriteFields([node], { [name]: raw }, requestValueRef.current, scopeRef.current);
    if (applied.writtenFieldNames.includes(name)) updateFieldValue(name, applied.value[name]);
  }

  function handleDelta(delta: string) {
    rawTextRef.current += delta;
    setRawText(rawTextRef.current);
    const partial = parsePartialMagicWriteYaml(rawTextRef.current);
    if (partial.kind !== "fields") return;
    for (const [name, raw] of Object.entries(partial.closedFields)) commitField(name, raw);
    const streaming = partial.streamingField;
    if (!streaming || committedRef.current.has(streaming.name)) return;
    setStreaming(streaming.name);
    // A plain "text" field is fed its still-growing raw string directly.
    // "richtext" is fed too, but through `sanitizeAiRichTextHtml` first on
    // every tick - that sanitizer is pure regex/string work (no DOMParser),
    // so it never fails on a still-open tag the way `importCleanHtml` would;
    // any transient mis-render self-heals on the next tick since this
    // always re-derives from the FULL accumulated text, never patches
    // incrementally, and the field's own `commitField` close-out re-applies
    // the final validated value regardless. number/boolean/date/select/
    // flatten stay disabled-but-inert until they fully close (still no safe
    // partial value to coerce mid-stream).
    const node = writableNodes.find((candidate) => candidate.fieldName === streaming.name);
    if (node?.kind === "column" && typeof streaming.value === "string") {
      if (node.fieldType === "text") {
        updateFieldValue(streaming.name, streaming.value);
      } else if (node.fieldType === "richtext") {
        updateFieldValue(streaming.name, sanitizeAiRichTextHtml(streaming.value, new Set(selectedImagePaths)));
      }
    }
  }

  async function run(historyForThisTurn: MagicWriteHistoryMessage[], promptForThisTurn: string) {
    setStage("loading");
    setDialogVisible(false); // The admin watches it happen in the real form fields instead - see this component's own doc comment.
    setError(null);
    setRawText("");
    rawTextRef.current = "";
    committedRef.current = new Set();
    requestValueRef.current = value;
    scopeRef.current = mode === "selected" ? { mode: "selected", targetFields: [...selectedFields] } : { mode: "empty" };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const images = await Promise.all(selectedImagePaths.map(encodeContextImage));
      if (controller.signal.aborted) return;
      const result = await requestMagicWriteTurn(
        {
          typeSlug,
          entryId: entryId ?? undefined,
          currentValue: requestValueRef.current,
          prompt: promptForThisTurn,
          mode: scopeRef.current.mode,
          targetFields: scopeRef.current.mode === "selected" ? scopeRef.current.targetFields : undefined,
          history: historyForThisTurn,
          images,
          aiKeyName,
        },
        handleDelta,
        () => {
          rawTextRef.current = "";
          setRawText("");
        },
        controller.signal,
      );
      if (result.turn.kind === "question") {
        setStreaming(null);
        setQuestion(result.turn);
        setQuestionChoice(new Set());
        setQuestionOther("");
        historyRef.current = [...historyForThisTurn, { role: "assistant", text: rawTextRef.current }];
        setStage("question");
        setDialogVisible(true); // Needs the admin's input - pop back up automatically.
        return;
      }
      for (const name of result.turn.writtenFieldNames) updateFieldValue(name, result.turn.fields[name]);
      setStreaming(null);
      toast.add({
        type: "success",
        title: result.turn.writtenFieldNames.length > 0
          ? `Magic Write wrote ${result.turn.writtenFieldNames.length} field${result.turn.writtenFieldNames.length === 1 ? "" : "s"}.`
          : "Magic Write finished - nothing needed writing.",
        description: result.turn.summary,
      });
      activeRef.current = false; // Done - a later button click starts a brand new session, not a reveal.
    } catch (err) {
      if (controller.signal.aborted) return;
      setStreaming(null);
      setError(err instanceof Error ? err.message : "AI request failed.");
      setStage("error");
      setDialogVisible(true); // Needs the admin to see what went wrong / retry / cancel.
    }
  }

  function handleStart() {
    if (!prompt.trim()) return;
    if (mode === "selected" && selectedFields.size === 0) return;
    void run([], prompt.trim());
  }

  function handleAnswerQuestion() {
    if (!question) return;
    const labels = question.choices.filter((choice) => questionChoice.has(choice.id)).map((choice) => `"${choice.label}"`);
    const parts: string[] = [];
    if (labels.length) parts.push(`Selected: ${labels.join(", ")}`);
    if (question.allowOther && questionOther.trim()) parts.push(`Other: "${questionOther.trim()}"`);
    void run([...historyRef.current, { role: "user", text: parts.join(". ") || "No selection." }], "");
  }

  function handleCancel() {
    abortRef.current?.abort();
    setStreaming(null);
    activeRef.current = false;
    setDialogVisible(false);
  }

  function toggleField(name: string) {
    setSelectedFields((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Only meaningful in the rare "re-opened while still loading" case (see
  // `dialogVisible`'s own doc comment) - a compact "title ✓ · body…" status,
  // same idea as `ai-rewrite-button.tsx`'s own footer status next to its
  // Cancel button.
  const progress = stage === "loading" ? parsePartialMagicWriteYaml(rawText) : null;
  const statusLine = progress?.kind === "fields"
    ? [
        ...Object.keys(progress.closedFields).map((name) => `${writableNodes.find((n) => n.fieldName === name)?.label ?? name} ✓`),
        progress.streamingField
          ? `${writableNodes.find((n) => n.fieldName === progress.streamingField!.name)?.label ?? progress.streamingField.name}…`
          : null,
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <dialog ref={ref} class="md" aria-label="Magic Write">
      {dialogVisible && (
        <>
          <header class="row justify-between align-center">
            {stage === "loading" ? (
              <div class="row align-center" style={{ gap: "0.5rem", minWidth: 0 }}>
                <span class="spinner" />
                <small class="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {statusLine || "Writing…"}
                </small>
              </div>
            ) : (
              <h3>
                <SparkleIcon /> Magic Write
              </h3>
            )}
          </header>

          <div class="stack">
            {stage === "start" && (
              <div class="stack">
                {aiMode === "server" && aiKeyOptions.length > 1 && (
                  <div class="row align-center" style={{ gap: "0.5rem" }}>
                    <small class="hint">AI Key</small>
                    <Combobox
                      options={[{ value: "", label: "Automatic" }, ...aiKeyOptions]}
                      value={aiKeyName ?? ""}
                      onChange={(value) => setAiKeyName(value || undefined)}
                      placeholder="Automatic"
                    />
                  </div>
                )}
                <TextField
                  label="What should Magic Write do?"
                  multiline
                  value={prompt}
                  onChange={setPrompt}
                  placeholder="VD: Viết một bài giới thiệu ngắn về cà phê Việt Nam"
                />
                <div class="stack" role="radiogroup" aria-label="Which fields to write">
                  <label class="row align-center" style={{ gap: "0.5rem" }}>
                    <input type="radio" name="magic-write-mode" checked={mode === "empty"} onChange={() => setMode("empty")} />
                    Only fill in empty fields
                  </label>
                  <label class="row align-center" style={{ gap: "0.5rem" }}>
                    <input type="radio" name="magic-write-mode" checked={mode === "selected"} onChange={() => setMode("selected")} />
                    Choose fields to overwrite
                  </label>
                </div>
                {mode === "selected" && (
                  <div class="stack">
                    {writableNodes.map((node) => (
                      <label key={node.fieldName} class="row align-center" style={{ gap: "0.5rem" }}>
                        <input
                          type="checkbox"
                          checked={selectedFields.has(node.fieldName)}
                          onChange={() => toggleField(node.fieldName)}
                        />
                        {node.label}
                      </label>
                    ))}
                  </div>
                )}
                <ImageField
                  label="Images (optional)"
                  description="Shown to Magic Write as context, not written to any field unless you ask."
                  source={source}
                  value={selectedImagePaths}
                  onChange={(next) => setSelectedImagePaths(Array.isArray(next) ? next : [next])}
                  multiple
                />
              </div>
            )}

            {stage === "question" && question && (
              <div class="stack ai-wizard-question">
                <p class="ai-wizard-question-text">{question.question}</p>
                <div class="row ai-wizard-choices" role="group" aria-label={question.question}>
                  {question.choices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      class="sm outline ai-wizard-choice"
                      aria-pressed={questionChoice.has(choice.id)}
                      onClick={() =>
                        setQuestionChoice((current) => {
                          if (question.multi) {
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
                {question.allowOther && (
                  <input
                    type="text"
                    placeholder="Type your own answer…"
                    value={questionOther}
                    onInput={(event) => setQuestionOther((event.currentTarget as HTMLInputElement).value)}
                  />
                )}
              </div>
            )}

            {stage === "error" && <div class="alert destructive">{error}</div>}
          </div>

          <footer>
            <button type="button" class="outline" onClick={handleCancel}>
              Cancel
            </button>
            <span class="spacer" />
            {stage === "start" && (
              <button type="button" disabled={!prompt.trim() || (mode === "selected" && selectedFields.size === 0)} onClick={handleStart}>
                Write <ArrowRightIcon />
              </button>
            )}
            {stage === "question" && (
              <button
                type="button"
                disabled={questionChoice.size === 0 && !(question?.allowOther && questionOther.trim())}
                onClick={handleAnswerQuestion}
              >
                Continue <ArrowRightIcon />
              </button>
            )}
            {stage === "error" && (
              <button type="button" onClick={() => setStage("start")}>
                Try again
              </button>
            )}
          </footer>
        </>
      )}
    </dialog>
  );
}
