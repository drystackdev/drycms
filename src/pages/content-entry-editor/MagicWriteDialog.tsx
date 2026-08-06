import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useDialogSync } from "../../hooks/list-nav.js";
import { toast } from "../../components/Toast.js";
import { ArrowRightIcon, CloseIcon, MediaIcon } from "../../components/icons/index.js";
import { SparkleIcon } from "../../components/AiSparkleIcon.js";
import FileManager from "../../components/FileManager/FileManager.js";
import { optimizeUploadImage } from "../../components/FileManager/file-manager-image-optimize.js";
import type { FileManagerSource } from "../../storage/entry-types.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import type { EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { parsePartialMagicWriteYaml } from "../../content-types/ai-magic-write-protocol.js";
import type { MagicWriteChoice, MagicWriteRawValue } from "../../content-types/ai-magic-write-protocol.js";
import { applyMagicWriteFields, WRITABLE_COLUMN_TYPES, type MagicWriteScope } from "../../content-types/ai-magic-write-fields.js";

const { path } = window.__DRY_CONFIG__;

/** Only extensions `optimizeUploadImage` can actually resize (see
 * `file-manager-image-optimize.ts`'s `canOptimizeUploadImage`) - unlike
 * `ImageField`'s own picker, Magic Write's context images always need a real
 * resize (240px, for vision-token cost, see `status/magic-write.md`
 * decision #3), so gif/svg (never optimizable) are excluded from the picker
 * itself rather than handled as a fallback path. */
const MAGIC_WRITE_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

interface MagicWritePickedImage {
  path: string;
  name: string;
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
 * token cost scales with pixel count, not quality/file size). */
async function encodeContextImage(imagePath: string): Promise<MagicWritePickedImage> {
  const response = await fetch(resolveImageSrc(imagePath));
  if (!response.ok) throw new Error(`Could not load "${imagePath}".`);
  const blob = await response.blob();
  const name = imagePath.split("/").pop() || imagePath;
  const original = new File([blob], name, { type: blob.type });
  const optimized = await optimizeUploadImage(original, { maxWidth: 240 });
  const base64 = await fileToBase64(optimized);
  return { path: imagePath, name, mimeType: optimized.type, base64 };
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
  open: boolean;
  onClose: () => void;
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
  /** Where the context-image picker's `FileManager` reads its files from
   * (Phase 2, `status/magic-write.md` decision #3). */
  source: FileManagerSource;
}

export default function MagicWriteDialog({
  open,
  onClose,
  typeSlug,
  entryId,
  nodes,
  value,
  updateFieldValue,
  onStreamingFieldChange,
  source,
}: MagicWriteDialogProps) {
  const ref = useDialogSync(open, () => handleCancel());
  const writableNodes = useMemo(() => nodes.filter(isMagicWriteCandidate), [nodes]);

  const [stage, setStage] = useState<Stage>("start");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"empty" | "selected">("empty");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [question, setQuestion] = useState<MagicWriteQuestionResult | null>(null);
  const [questionChoice, setQuestionChoice] = useState<Set<string>>(new Set());
  const [questionOther, setQuestionOther] = useState("");
  const [pickedImages, setPickedImages] = useState<MagicWritePickedImage[]>([]);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imagePickerSelection, setImagePickerSelection] = useState<string[]>([]);
  const [encodingImages, setEncodingImages] = useState(false);
  const imagePickerRef = useDialogSync(imagePickerOpen, () => setImagePickerOpen(false));

  const rawTextRef = useRef("");
  const committedRef = useRef<Set<string>>(new Set());
  const streamingNameRef = useRef<string | null>(null);
  const requestValueRef = useRef<EntryValue>({});
  const scopeRef = useRef<MagicWriteScope>({ mode: "empty" });
  const historyRef = useRef<MagicWriteHistoryMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage("start");
    setPrompt("");
    setMode("empty");
    setSelectedFields(new Set());
    setError(null);
    setRawText("");
    setQuestion(null);
    setQuestionChoice(new Set());
    setQuestionOther("");
    setPickedImages([]);
    setImagePickerOpen(false);
    setImagePickerSelection([]);
    setEncodingImages(false);
    rawTextRef.current = "";
    committedRef.current = new Set();
    streamingNameRef.current = null;
    historyRef.current = [];
  }, [open]);

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
    // Only a plain "text" field is safe to live-feed a still-growing raw
    // string into - everything else (richtext needs sanitizing, number/
    // boolean/date/select need real coercion, flatten is a nested object)
    // stays disabled-but-inert until it fully closes (see
    // `status/magic-write.md` decision #4, update 2).
    const node = writableNodes.find((candidate) => candidate.fieldName === streaming.name);
    if (node?.kind === "column" && node.fieldType === "text" && typeof streaming.value === "string") {
      updateFieldValue(streaming.name, streaming.value);
    }
  }

  async function run(historyForThisTurn: MagicWriteHistoryMessage[], promptForThisTurn: string) {
    setStage("loading");
    setError(null);
    setRawText("");
    rawTextRef.current = "";
    committedRef.current = new Set();
    requestValueRef.current = value;
    scopeRef.current = mode === "selected" ? { mode: "selected", targetFields: [...selectedFields] } : { mode: "empty" };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await requestMagicWriteTurn(
        {
          typeSlug,
          entryId: entryId ?? undefined,
          currentValue: requestValueRef.current,
          prompt: promptForThisTurn,
          mode: scopeRef.current.mode,
          targetFields: scopeRef.current.mode === "selected" ? scopeRef.current.targetFields : undefined,
          history: historyForThisTurn,
          images: pickedImages.map(({ path: imagePath, mimeType, base64 }) => ({ path: imagePath, mimeType, base64 })),
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
      onClose();
    } catch (err) {
      if (controller.signal.aborted) return;
      setStreaming(null);
      setError(err instanceof Error ? err.message : "AI request failed.");
      setStage("error");
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
    onClose();
  }

  function toggleField(name: string) {
    setSelectedFields((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function openImagePicker() {
    setImagePickerSelection(pickedImages.map((image) => image.path));
    setImagePickerOpen(true);
  }

  async function confirmImagePicker() {
    setImagePickerOpen(false);
    const alreadyEncoded = new Map(pickedImages.map((image) => [image.path, image]));
    const newPaths = imagePickerSelection.filter((imagePath) => !alreadyEncoded.has(imagePath));
    if (newPaths.length === 0) {
      setPickedImages(imagePickerSelection.map((imagePath) => alreadyEncoded.get(imagePath)!));
      return;
    }
    setEncodingImages(true);
    try {
      const encoded = await Promise.all(newPaths.map(encodeContextImage));
      const byPath = new Map([...alreadyEncoded, ...encoded.map((image): [string, MagicWritePickedImage] => [image.path, image])]);
      setPickedImages(imagePickerSelection.map((imagePath) => byPath.get(imagePath)!).filter(Boolean));
    } catch (err) {
      toast.add({ type: "error", title: "Could not load an image", description: err instanceof Error ? err.message : undefined });
    } finally {
      setEncodingImages(false);
    }
  }

  function removeImage(imagePath: string) {
    setPickedImages((current) => current.filter((image) => image.path !== imagePath));
  }

  const progress = stage === "loading" ? parsePartialMagicWriteYaml(rawText) : null;

  return (
    <dialog ref={ref} class="md" aria-label="Magic Write">
      {open && (
        <>
          <header>
            <h3>
              <SparkleIcon /> Magic Write
            </h3>
          </header>

          <div class="stack">
            {stage === "start" && (
              <div class="stack">
                <label>
                  What should Magic Write do?
                  <textarea
                    rows={3}
                    placeholder="VD: Viết một bài giới thiệu ngắn về cà phê Việt Nam"
                    value={prompt}
                    onInput={(event) => setPrompt((event.currentTarget as HTMLTextAreaElement).value)}
                  />
                </label>
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
                <div class="stack">
                  <small class="hint">
                    Images (optional) - shown to Magic Write as context, not written to any field unless you ask.
                  </small>
                  <div class="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
                    {pickedImages.map((image) => (
                      <span key={image.path} class="row align-center" style={{ gap: "0.25rem" }}>
                        <img src={resolveImageSrc(image.path)} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: "var(--dry-radius-md)" }} />
                        <button type="button" class="ghost icon sm" aria-label={`Remove ${image.name}`} onClick={() => removeImage(image.path)}>
                          <CloseIcon />
                        </button>
                      </span>
                    ))}
                    <button type="button" class="outline sm" aria-busy={encodingImages} disabled={encodingImages} onClick={openImagePicker}>
                      <MediaIcon /> Add images
                    </button>
                  </div>
                </div>
              </div>
            )}

            {stage === "loading" && (
              <div class="stack ai-wizard-loading">
                <div class="row align-center" style={{ gap: "0.5rem" }}>
                  <span class="spinner" /> Writing…
                </div>
                {progress?.kind === "fields" && (
                  <div class="stack" style={{ gap: "0.25rem" }}>
                    {Object.keys(progress.closedFields).map((name) => (
                      <div key={name} class="row align-center" style={{ gap: "0.375rem" }}>
                        ✓ {writableNodes.find((n) => n.fieldName === name)?.label ?? name}
                      </div>
                    ))}
                    {progress.streamingField && (
                      <div class="row align-center" style={{ gap: "0.375rem" }}>
                        <span class="spinner" />
                        {writableNodes.find((n) => n.fieldName === progress.streamingField!.name)?.label ?? progress.streamingField.name}…
                      </div>
                    )}
                  </div>
                )}
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

      <dialog ref={imagePickerRef} class="lg" aria-label="Choose images">
        {imagePickerOpen && (
          <>
            <header>
              <h3>Choose images</h3>
            </header>
            <div class="under">
              <FileManager
                source={source}
                value={imagePickerSelection}
                onChange={(next) => setImagePickerSelection(Array.isArray(next) ? next : [next])}
                multiple
                accept={MAGIC_WRITE_IMAGE_EXTENSIONS}
                syncUrl={false}
              />
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setImagePickerOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={() => void confirmImagePicker()}>
                Select
              </button>
            </footer>
          </>
        )}
      </dialog>
    </dialog>
  );
}
