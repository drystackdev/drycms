import { useEffect, useMemo, useState } from "preact/hooks";
const { path, aiMode } = window.__DRY_CONFIG__;

import Combobox from "../../components/Combobox.js";
import { toast } from "../../components/Toast.js";
import { ArrowRightIcon, XIcon } from "../../components/icons/index.js";
import { SparkleIcon } from "../../components/AiSparkleIcon.js";
import { createContentEntriesApi } from "../../content-types/entries-http-api.js";
import { normalizeFieldOrder } from "../../content-types/naming.js";
import { saveDraft, drafts, getDraft } from "../../content-types/draft-store.js";
import { mapWizardTables } from "../../content-types/ai-wizard-map.js";
import { parsePartialWizardTurn, type PartialWizardTurn } from "../../content-types/ai-wizard-protocol.js";
import type {
  WizardChoice,
  WizardProposalTurn,
  WizardQuestionTurn,
  WizardTurn,
} from "../../content-types/ai-wizard-protocol.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

interface WizardHistoryMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AiSchemaWizardPanelProps {
  open: boolean;
  /** Every content type (including hidden ones) currently known on the
   * client - used, merged with pending drafts, both to ground the model's
   * "existing types" context and to validate proposed names/relations. */
  allDefinitions: ContentTypeDefinition[];
  onClose: () => void;
  /** Called once at least one table is successfully staged as a draft. */
  onStaged?: () => void;
}

type Stage = "start" | "loading" | "turn" | "error";

const aiKeyApi = createContentEntriesApi(`${path}/api/content`, "aiKey");

function mergedAllTypes(allDefinitions: ContentTypeDefinition[]): ContentTypeDefinition[] {
  const merged = allDefinitions.map((type) => getDraft(type.id)?.definition ?? type);
  for (const entry of Object.values(drafts.value)) {
    if (!merged.some((type) => type.id === entry.definition.id)) merged.push(entry.definition);
  }
  return merged;
}

interface WizardStreamEvent {
  delta?: string;
  retry?: boolean;
  turn?: WizardTurn;
  aiLabel?: string;
  error?: string;
}

/**
 * Reads `/api/ai/wizard`'s SSE stream (raw `{delta}` chunks of the model's
 * real output as it's generated, a `{retry}` marker when a structurally
 * invalid attempt is being reattempted, then either a validated `{turn}` or
 * a final `{error}`) - the actual question/proposal isn't renderable until
 * it fully parses, but streaming the raw text gives real, live progress
 * instead of a silent wait.
 */
async function requestWizardTurn(
  history: WizardHistoryMessage[],
  aiKeyName: string | undefined,
  goal: string | undefined,
  onDelta: (delta: string) => void,
  onRetry: () => void,
): Promise<{ turn: WizardTurn }> {
  const response = await fetch(`${path}/api/ai/wizard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, aiKeyName, goal }),
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
      let event: WizardStreamEvent;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.turn) return { turn: event.turn };
      if (event.retry) onRetry();
      else if (event.delta) onDelta(event.delta);
    }
  }
  throw new Error("AI connection closed unexpectedly.");
}

function StartStep({ onStart }: { onStart: (goal: string) => void }) {
  const [goal, setGoal] = useState("");

  return (
    <div class="stack ai-wizard-start">
      <p class="ai-wizard-question-text">What do you want to build?</p>
      <textarea
        rows={3}
        placeholder="VD: Quản lý bài viết blog, có tiêu đề, nội dung, ảnh đại diện, tác giả và danh mục"
        value={goal}
        onInput={(event) => setGoal((event.currentTarget as HTMLTextAreaElement).value)}
      />
      <footer class="row justify-between">
        <button type="button" class="ghost" onClick={() => onStart("")}>
          Skip, let AI ask
        </button>
        <button type="button" onClick={() => onStart(goal)}>
          Start <ArrowRightIcon />
        </button>
      </footer>
    </div>
  );
}

function QuestionStep({
  turn,
  busy,
  onAnswer,
}: {
  turn: WizardQuestionTurn;
  busy: boolean;
  onAnswer: (text: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [other, setOther] = useState("");

  useEffect(() => {
    setSelected(new Set());
    setOther("");
  }, [turn]);

  function toggle(choice: WizardChoice) {
    setSelected((prev) => {
      if (turn.multi) {
        const next = new Set(prev);
        if (next.has(choice.id)) next.delete(choice.id);
        else next.add(choice.id);
        return next;
      }
      return new Set([choice.id]);
    });
  }

  function submit() {
    const labels = turn.choices.filter((choice) => selected.has(choice.id)).map((choice) => `"${choice.label}"`);
    const parts: string[] = [];
    if (labels.length) parts.push(`Selected: ${labels.join(", ")}`);
    if (turn.allowOther && other.trim()) parts.push(`Other: "${other.trim()}"`);
    onAnswer(parts.join(". ") || "No selection.");
  }

  const canSubmit = selected.size > 0 || (turn.allowOther && other.trim().length > 0);

  return (
    <div class="stack ai-wizard-question">
      <p class="ai-wizard-question-text">{turn.question}</p>
      <div class="row ai-wizard-choices" role="group" aria-label={turn.question}>
        {turn.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            class="sm outline ai-wizard-choice"
            aria-pressed={selected.has(choice.id)}
            disabled={busy}
            onClick={() => toggle(choice)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {turn.allowOther && (
        <input
          type="text"
          placeholder="Type your own answer…"
          value={other}
          disabled={busy}
          onInput={(event) => setOther((event.currentTarget as HTMLInputElement).value)}
        />
      )}
      <footer>
        <button type="button" aria-busy={busy} disabled={busy || !canSubmit} onClick={submit}>
          Continue <ArrowRightIcon />
        </button>
      </footer>
    </div>
  );
}

/**
 * Live preview while a turn is still streaming in - a loose, best-effort
 * read of `parsePartialWizardTurn` (never the validated `parseWizardTurn`),
 * so fields appear as they complete instead of an all-or-nothing reveal
 * once the whole JSON object closes. Every piece here is inert (`<span>`/
 * `<li>`, not `<button>`) - nothing is clickable, and a `proposal` never
 * even reaches this preview's "tables" branch for long: it's applied and
 * the panel closes the moment it validates (see `applyProposal` below).
 */
function PartialPreview({ partial }: { partial: PartialWizardTurn | undefined }) {
  if (!partial) return null;
  const text = partial.question;
  const hasChoices = !!partial.choices?.length;
  const hasTables = !!partial.tables?.length;
  if (!text && !hasChoices && !hasTables) return null;

  return (
    <div class="stack ai-wizard-partial-preview">
      {text && <p class="ai-wizard-question-text">{text}</p>}
      {hasChoices && (
        <div class="row ai-wizard-choices">
          {partial.choices!.map((choice, index) => (
            <span key={choice.id ?? index} class="sm outline ai-wizard-choice ai-wizard-preview-pulse">
              {choice.label}
            </span>
          ))}
        </div>
      )}
      {hasTables && (
        <ul class="content-type-list">
          {partial.tables!.map((table, index) => (
            <li key={table.name ?? index} class="content-type-list-item row justify-between ai-wizard-preview-pulse">
              <span class="row align-center" style={{ gap: "0.375rem" }}>
                {table.label ?? table.name}
                {table.isNew !== undefined && (
                  <span class="badge sm outline">{table.isNew ? "New" : "Extend"}</span>
                )}
              </span>
              <small class="hint">{table.fieldCount} field{table.fieldCount === 1 ? "" : "s"}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Content Types "Ask AI" panel (see `status/ai-schema-wizard.md`) - a
 * choice-driven interview, never a free-text chat box. Rendered by
 * `BuilderContentType` as a second grid column beside the content-types
 * list (`>= 64rem`) or as a second tab replacing it (`< 64rem`), rather
 * than a modal dialog, specifically so the list stays visible and usable
 * alongside it wherever screen width allows: the list itself, updating
 * live as drafts land, IS the review step. A `proposal` turn is therefore
 * terminal AND non-interactive - the moment one validates, every table in
 * it is staged as a draft (`applyProposal`) and the panel closes, no
 * confirm click. Content Types already reviews every draft again before it
 * touches the database ("Apply Builder"); an admin who wants to drop or
 * adjust something the AI proposed does it there, or in the normal schema
 * editor - not through a second confirm layer in this panel.
 */
export default function AiSchemaWizardPanel({
  open,
  allDefinitions,
  onClose,
}: AiSchemaWizardPanelProps) {
  const [stage, setStage] = useState<Stage>("start");
  const [turn, setTurn] = useState<WizardQuestionTurn | null>(null);
  const [history, setHistory] = useState<WizardHistoryMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [aiKeyOptions, setAiKeyOptions] = useState<{ value: string; label: string }[]>([]);
  const [aiKeyName, setAiKeyName] = useState<string | undefined>(undefined);
  const [lastGoal, setLastGoal] = useState<string | undefined>(undefined);
  const partialTurn = useMemo(() => parsePartialWizardTurn(streamingText), [streamingText]);

  useEffect(() => {
    if (!open) return;
    setStage("start");
    setTurn(null);
    setHistory([]);
    setError(null);
    setAiKeyName(undefined);
    setLastGoal(undefined);
    if (aiMode === "server") {
      void aiKeyApi
        .list({ page: 0, pageSize: 100 })
        .then((result) => {
          setAiKeyOptions(
            result.rows.map((row) => ({
              value: String(row.value.name ?? ""),
              label: `${String(row.value.name ?? "Unnamed")} (${String(row.value.provider ?? "")})`,
            })).filter((option) => option.value),
          );
        })
        .catch(() => setAiKeyOptions([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-runs on open/close, deliberately not on aiKeyName (that's read at request time, not at reset time).
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  /** Stages every proposed table as a draft directly - client-side, no AI
   * round-trip. Never closes the panel itself: now that it's a persistent
   * column/tab rather than an overlay, closing it after every successful
   * proposal would just force the admin to reopen it to ask for the next
   * table. Instead it resets back to the start step (same shape `open`'s
   * effect above resets to on a fresh open) so another goal can be typed
   * right away, while the newly staged draft(s) show up live in the list
   * beside/under it. */
  function applyProposal(proposal: WizardProposalTurn) {
    const mapped = mapWizardTables(proposal.tables, mergedAllTypes(allDefinitions));
    const succeeded = mapped.filter((result) => result.ok);
    const failed = mapped.filter((result) => !result.ok);
    for (const result of succeeded) {
      if (result.ok) saveDraft(normalizeFieldOrder(result.definition), result.isNew);
    }
    if (succeeded.length === 0) {
      setError(failed.map((result) => `${result.name}: ${!result.ok ? result.error : ""}`).join("; "));
      setStage("error");
      return;
    }
    toast.add({
      type: failed.length ? "warning" : "success",
      title: failed.length
        ? `Staged ${succeeded.length} of ${mapped.length} - "${failed.map((result) => result.name).join(", ")}" needs manual review.`
        : `Staged ${succeeded.length} content type${succeeded.length === 1 ? "" : "s"} as drafts - review in Apply Builder.`,
    });
    setStage("start");
    setTurn(null);
    setHistory([]);
    setError(null);
    setLastGoal(undefined);
  }

  async function advance(nextHistory: WizardHistoryMessage[], keyName: string | undefined, goal?: string) {
    setStage("loading");
    setError(null);
    setStreamingText("");
    try {
      const result = await requestWizardTurn(
        nextHistory,
        keyName,
        goal,
        (delta) => setStreamingText((current) => current + delta),
        () => setStreamingText(""),
      );
      if (result.turn.kind === "proposal") {
        applyProposal(result.turn);
        return;
      }
      setHistory(nextHistory);
      setTurn(result.turn);
      setStage("turn");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
      setStage("error");
    }
  }

  function start(goal: string) {
    setLastGoal(goal || undefined);
    void advance([], aiKeyName, goal || undefined);
  }

  function answer(text: string) {
    if (!turn) return;
    const nextHistory: WizardHistoryMessage[] = [
      ...history,
      { role: "assistant", text: JSON.stringify(turn) },
      { role: "user", text },
    ];
    void advance(nextHistory, aiKeyName);
  }

  return (
    <div id="ai-wizard-panel" class={`ai-wizard-panel${open ? " open" : ""}`} aria-hidden={!open}>
      {open && (
        <>
          <header class="row justify-between" style={{ flexWrap: "nowrap" }}>
            <div class="spacer" style={{ minWidth: 0 }}>
              <h3 class="row align-center" style={{ gap: "0.375rem" }}><SparkleIcon /> Ask AI</h3>
              <p>A guided, choice-only interview - no free typing needed except an occasional short value.</p>
            </div>
            <button type="button" class="icon ghost" aria-label="Close" onClick={onClose}>
              <XIcon />
            </button>
          </header>
          {aiMode === "server" && aiKeyOptions.length > 1 && (
            <div class="row align-center ai-wizard-key-picker" style={{ gap: "0.5rem" }}>
              <small class="hint">AI Key</small>
              <Combobox
                options={[{ value: "", label: "Automatic" }, ...aiKeyOptions]}
                value={aiKeyName ?? ""}
                onChange={(value) => setAiKeyName(value || undefined)}
                placeholder="Automatic"
              />
            </div>
          )}
          <div class="ai-wizard-body">
            {stage === "start" && <StartStep onStart={start} />}
            {stage === "loading" && (
              <div class="stack ai-wizard-loading">
                <div class="row align-center" style={{ gap: "0.5rem" }}>
                  <span class="spinner" /> Thinking…
                </div>
                <PartialPreview partial={partialTurn} />
              </div>
            )}
            {stage === "error" && (
              <div class="stack">
                <div class="alert destructive">{error}</div>
                <footer>
                  <button type="button" onClick={() => void advance(history, aiKeyName, history.length === 0 ? lastGoal : undefined)}>Try again</button>
                </footer>
              </div>
            )}
            {stage === "turn" && turn && (
              <QuestionStep turn={turn} busy={false} onAnswer={answer} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
