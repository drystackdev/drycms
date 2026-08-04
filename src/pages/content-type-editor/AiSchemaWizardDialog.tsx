import { useEffect, useMemo, useState } from "preact/hooks";
const { path, aiMode } = window.__DRY_CONFIG__;

import { useDialogSync } from "../../components/list-nav.js";
import Combobox from "../../components/Combobox.js";
import { toast } from "../../components/Toast.js";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  SparkleIcon,
  XCircleIcon,
  XIcon,
} from "../../components/icons.js";
import { createContentEntriesApi } from "../../content-types/entries-http-api.js";
import { normalizeFieldOrder } from "../../content-types/naming.js";
import { saveDraft, drafts, getDraft } from "../../content-types/draft-store.js";
import { mapWizardTables, type WizardMapResult } from "../../content-types/ai-wizard-map.js";
import type {
  WizardChoice,
  WizardDoneTurn,
  WizardProposalTurn,
  WizardProposedTable,
  WizardQuestionTurn,
  WizardTurn,
} from "../../content-types/ai-wizard-protocol.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

interface WizardHistoryMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AiSchemaWizardDialogProps {
  open: boolean;
  /** Every content type (including hidden ones) currently known on the
   * client - used, merged with pending drafts, both to ground the model's
   * "existing types" context and to validate proposed names/relations. */
  allDefinitions: ContentTypeDefinition[];
  onClose: () => void;
  /** Called once at least one table is successfully staged as a draft. */
  onStaged?: () => void;
}

type Stage = "loading" | "turn" | "error";

const aiKeyApi = createContentEntriesApi(`${path}/api/content`, "aiKey");

function mergedAllTypes(allDefinitions: ContentTypeDefinition[]): ContentTypeDefinition[] {
  const merged = allDefinitions.map((type) => getDraft(type.id)?.definition ?? type);
  for (const entry of Object.values(drafts.value)) {
    if (!merged.some((type) => type.id === entry.definition.id)) merged.push(entry.definition);
  }
  return merged;
}

async function requestWizardTurn(
  history: WizardHistoryMessage[],
  aiKeyName: string | undefined,
): Promise<{ turn: WizardTurn }> {
  const response = await fetch(`${path}/api/ai/wizard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, aiKeyName }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.message === "string" ? body.message : "AI request failed.");
  }
  return body;
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

function ProposalStep({
  turn,
  busy,
  onAnswer,
}: {
  turn: WizardProposalTurn;
  busy: boolean;
  onAnswer: (text: string) => void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [kept, setKept] = useState<Set<string>>(new Set());

  useEffect(() => {
    setOrder(turn.tables.map((table) => table.name));
    setKept(new Set(turn.tables.map((table) => table.name)));
  }, [turn]);

  function move(name: string, direction: -1 | 1) {
    setOrder((prev) => {
      const index = prev.indexOf(name);
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function toggleKeep(name: string) {
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function submit() {
    const keptOrdered = order.filter((name) => kept.has(name));
    const dropped = order.filter((name) => !kept.has(name));
    const parts = [
      `Kept tables in this exact order: ${keptOrdered.length ? keptOrdered.map((name) => `"${name}"`).join(", ") : "(none)"}`,
    ];
    if (dropped.length) parts.push(`Dropped tables: ${dropped.map((name) => `"${name}"`).join(", ")}`);
    parts.push('Finalize with a "done" turn containing exactly this selection, unchanged otherwise.');
    onAnswer(parts.join(". "));
  }

  const byName = useMemo(() => new Map(turn.tables.map((table) => [table.name, table])), [turn]);
  const canSubmit = order.some((name) => kept.has(name));

  return (
    <div class="stack ai-wizard-proposal">
      <p class="ai-wizard-question-text">{turn.question}</p>
      <ul class="content-type-list">
        {order.map((name, index) => {
          const table = byName.get(name);
          if (!table) return null;
          return (
            <li key={name} class="content-type-list-item row justify-between">
              <label class="row align-center" style={{ gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={kept.has(name)}
                  disabled={busy}
                  onChange={() => toggleKeep(name)}
                />
                <span class="stack" style={{ gap: "0.125rem" }}>
                  <span class="row align-center" style={{ gap: "0.375rem" }}>
                    {table.label || table.name}
                    <span class="badge sm outline">{table.isNew ? "New" : "Extend"}</span>
                  </span>
                  <small class="hint">
                    {table.fields.length} field{table.fields.length === 1 ? "" : "s"}
                    {table.removeFields?.length ? `, removing ${table.removeFields.length}` : ""}
                  </small>
                </span>
              </label>
              <div class="row">
                <button
                  type="button"
                  class="icon ghost sm"
                  aria-label={`Move ${table.label || table.name} up`}
                  disabled={busy || index === 0}
                  onClick={() => move(name, -1)}
                >
                  <ArrowUpIcon />
                </button>
                <button
                  type="button"
                  class="icon ghost sm"
                  aria-label={`Move ${table.label || table.name} down`}
                  disabled={busy || index === order.length - 1}
                  onClick={() => move(name, 1)}
                >
                  <ArrowDownIcon />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <footer>
        <button type="button" aria-busy={busy} disabled={busy || !canSubmit} onClick={submit}>
          Confirm selection <ArrowRightIcon />
        </button>
      </footer>
    </div>
  );
}

function DoneStep({
  turn,
  allDefinitions,
  onStaged,
  onClose,
}: {
  turn: WizardDoneTurn;
  allDefinitions: ContentTypeDefinition[];
  onStaged?: () => void;
  onClose: () => void;
}) {
  const [results, setResults] = useState<WizardMapResult[] | null>(null);

  function stage() {
    const mapped = mapWizardTables(turn.tables, mergedAllTypes(allDefinitions));
    for (const result of mapped) {
      if (result.ok) saveDraft(normalizeFieldOrder(result.definition), result.isNew);
    }
    setResults(mapped);
    if (mapped.some((result) => result.ok)) {
      toast.add({ type: "success", title: "Staged as drafts - review them in Apply Builder." });
      onStaged?.();
    }
  }

  if (results) {
    return (
      <div class="stack ai-wizard-results">
        <ul class="content-type-list">
          {results.map((result) => (
            <li key={result.name} class="content-type-list-item row justify-between">
              <span>{result.name}</span>
              {result.ok ? (
                <span class="row align-center badge sm secondary"><CheckCircleIcon /> Staged</span>
              ) : (
                <span class="row align-center hint" style={{ color: "var(--dry-destructive)" }}>
                  <XCircleIcon /> {result.error}
                </span>
              )}
            </li>
          ))}
        </ul>
        <footer>
          <button type="button" onClick={onClose}>Done</button>
        </footer>
      </div>
    );
  }

  return (
    <div class="stack ai-wizard-proposal">
      <p class="ai-wizard-question-text">{turn.summary}</p>
      <ul class="content-type-list">
        {turn.tables.map((table: WizardProposedTable) => (
          <li key={table.name} class="content-type-list-item row justify-between">
            <span class="stack" style={{ gap: "0.125rem" }}>
              <span class="row align-center" style={{ gap: "0.375rem" }}>
                {table.label || table.name}
                <span class="badge sm outline">{table.isNew ? "New" : "Extend"}</span>
              </span>
              <small class="hint">
                {table.fields.map((field) => field.label || field.name).join(", ") || "(no new fields)"}
              </small>
            </span>
          </li>
        ))}
      </ul>
      <footer>
        <button type="button" onClick={stage}>Save as drafts</button>
      </footer>
    </div>
  );
}

/**
 * Content Types "Ask AI" wizard (see `status/ai-schema-wizard.md`) - a
 * choice-driven interview, never a free-text chat box. Every turn from
 * `/api/ai/wizard` is one of `question`/`proposal`/`done`
 * (`ai-wizard-protocol.ts`); this component only ever renders those three
 * shapes and never lets the admin type prose back to the model (only a
 * short "other" value on questions that declare `allowOther`, or picking
 * which proposed tables to keep/drop/reorder).
 *
 * Nothing here writes to the server - `done` only stages
 * `ContentTypeDefinition` drafts via the existing `draft-store.ts`, so the
 * result always lands in the same manual review/"Apply Builder" flow as any
 * hand-edited schema change.
 */
export default function AiSchemaWizardDialog({
  open,
  allDefinitions,
  onClose,
  onStaged,
}: AiSchemaWizardDialogProps) {
  const ref = useDialogSync(open, onClose);
  const [stage, setStage] = useState<Stage>("loading");
  const [turn, setTurn] = useState<WizardTurn | null>(null);
  const [history, setHistory] = useState<WizardHistoryMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aiKeyOptions, setAiKeyOptions] = useState<{ value: string; label: string }[]>([]);
  const [aiKeyName, setAiKeyName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setStage("loading");
    setTurn(null);
    setHistory([]);
    setError(null);
    setAiKeyName(undefined);
    void advance([], undefined);
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

  async function advance(nextHistory: WizardHistoryMessage[], keyName: string | undefined) {
    setStage("loading");
    setError(null);
    try {
      const result = await requestWizardTurn(nextHistory, keyName);
      setHistory(nextHistory);
      setTurn(result.turn);
      setStage("turn");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
      setStage("error");
    }
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
    <dialog ref={ref} class="md ai-wizard-dialog" aria-label="Ask AI">
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
            {stage === "loading" && (
              <div class="row align-center ai-wizard-loading" style={{ gap: "0.5rem" }}>
                <span class="spinner" /> Thinking…
              </div>
            )}
            {stage === "error" && (
              <div class="stack">
                <div class="alert destructive">{error}</div>
                <footer>
                  <button type="button" onClick={() => void advance(history, aiKeyName)}>Try again</button>
                </footer>
              </div>
            )}
            {stage === "turn" && turn?.kind === "question" && (
              <QuestionStep turn={turn} busy={false} onAnswer={answer} />
            )}
            {stage === "turn" && turn?.kind === "proposal" && (
              <ProposalStep turn={turn} busy={false} onAnswer={answer} />
            )}
            {stage === "turn" && turn?.kind === "done" && (
              <DoneStep turn={turn} allDefinitions={allDefinitions} onStaged={onStaged} onClose={onClose} />
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
