import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { path } from "virtual:drycms/config";

import { useOverlayScrollbars } from "../components/overlayscrollbars.js";
import { useDialogSync } from "../components/list-nav.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { diffContentType } from "../content-types/draft-diff.js";
import { drafts as draftsSignal } from "../content-types/draft-store.js";
import { fieldTypes } from "../content-types/field-registry.js";
import type {
  ContentTypeDefinition,
  ContentTypeKind,
} from "../content-types/types.js";
import {
  fieldTypeColors,
  fieldTypeIcons,
} from "../components/field-type-icons.js";
import { PlusIcon } from "../components/icons.js";
import { useFetch } from "../hooks/useFetch.js";
import { useParam } from "../hooks/useParam.js";
import ContentTypeEditor from "./ContentTypeEditor.js";
import { useDocumentTitle } from "./page-common.js";

function CollectionCard({
  definition,
  status,
  onOpen,
}: {
  definition: ContentTypeDefinition;
  status: { isNew: boolean; editedCount: number } | null;
  onOpen: (id: string) => void;
}) {
  const fields = definition.fields.filter(
    (field) => !(definition.deletedFieldIds ?? []).includes(field.id),
  );
  const featureCount = Object.values(definition.features ?? {}).filter(
    Boolean,
  ).length;

  return (
    <button
      type="button"
      class="builder-collection-card"
      onClick={() => onOpen(definition.id)}
    >
      <span class="builder-collection-card-header">
        <span class="builder-collection-card-title">
          <strong>
            {definition.label || definition.name || "Untitled collection"}
          </strong>
          {status?.isNew && <span class="badge sm info">New</span>}
          {!!status && !status.isNew && status.editedCount > 0 && (
            <span class="badge sm warning">Modified</span>
          )}
          <span class="hint">
            <span class="badge outline sm">
              {definition.name || "no-table-name"}
            </span>{" "}
            - {definition.description || "No description"}
          </span>
        </span>
        <span class="badge outline">{featureCount} features</span>
      </span>
      <span
        class="builder-collection-card-fields"
        aria-label="Collection fields"
      >
        {fields.length === 0 ? (
          <span class="hint">No custom fields yet</span>
        ) : (
          fields.map((field) => {
            const TypeIcon = fieldTypeIcons[field.type] ?? fieldTypeIcons.text!;
            const color = fieldTypeColors[field.type];
            return (
              <span
                class="builder-field-icon"
                style={color ? { "--field-type-color": color } : undefined}
                title={`${field.label || field.name} · ${fieldTypes[field.type]?.label ?? field.type}`}
                key={field.id}
              >
                <TypeIcon />
              </span>
            );
          })
        )}
      </span>
    </button>
  );
}

const KIND_LABELS: Record<ContentTypeKind, string> = {
  collection: "Collection",
  singleton: "Singleton",
  component: "Component",
};
const KIND_PLURAL_LABELS: Record<ContentTypeKind, string> = {
  collection: "Collections",
  singleton: "Singletons",
  component: "Components",
};

function BuilderCollectionList({
  kind,
  onOpen,
}: {
  kind: ContentTypeKind;
  onOpen: (id: string) => void;
}) {
  const api = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );
  const listFetcher = useCallback(
    (ifVersion: number | undefined, signal: AbortSignal) =>
      api.listVersioned(ifVersion, signal),
    [api],
  );
  const { data: definitions, error } = useFetch<ContentTypeDefinition[]>(
    "builder:content-types",
    listFetcher,
  );
  const pendingDrafts = draftsSignal.value;
  const liveDefinitions = (definitions ?? []).filter(
    (definition) => definition.kind === kind && !definition.hidden,
  );
  const collections = [
    ...liveDefinitions.map((definition) => {
      const draft = pendingDrafts[definition.id];
      return {
        definition: draft?.definition ?? definition,
        status: draft ? diffContentType(definition, draft.definition) : null,
      };
    }),
    ...Object.values(pendingDrafts)
      .filter(
        (draft) =>
          draft.isNew &&
          draft.definition.kind === kind &&
          !liveDefinitions.some(
            (definition) => definition.id === draft.definition.id,
          ),
      )
      .map((draft) => ({
        definition: draft.definition,
        status: diffContentType(undefined, draft.definition),
      })),
  ];

  if (error)
    return (
      <span class="error">
        {error instanceof Error ? error.message : "Failed to load collections."}
      </span>
    );
  if (!definitions)
    return (
      <div class="builder-collection-list-loading" aria-busy="true">
        Loading collections…
      </div>
    );
  if (collections.length === 0)
    return (
      <div class="builder-collection-list-empty">
        <strong>No {KIND_LABELS[kind].toLowerCase()}s yet</strong>
        <span class="hint">
          Create a {KIND_LABELS[kind].toLowerCase()} from Content Types to start
          building.
        </span>
      </div>
    );

  return (
    <div class="builder-collection-list">
      {collections.map((definition) => (
        <CollectionCard
          key={definition.definition.id}
          definition={definition.definition}
          status={definition.status}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function CollectionEditorDialog({
  id,
  addingKind,
  onClose,
}: {
  id: string | null;
  addingKind: ContentTypeKind | null;
  onClose: () => void;
}) {
  const open = id !== null || addingKind !== null;
  const dialogRef = useDialogSync(open, onClose);

  return (
    <dialog
      ref={dialogRef}
      class="xl builder-editor-dialog"
      aria-label={
        addingKind ? `Add ${KIND_LABELS[addingKind].toLowerCase()}` : "Edit collection"
      }
    >
      {open && (
        <ContentTypeEditor
          id={id ?? undefined}
          kind={addingKind ?? undefined}
          embedded
          onClose={onClose}
        />
      )}
    </dialog>
  );
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
}

function renderAssistantMessage(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }));
}

export default function BuilderContentType() {
  useDocumentTitle("Builder Content type");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingKind, setAddingKind] = useState<ContentTypeKind | null>(null);
  const [selectedKind, setSelectedKind] = useParam<ContentTypeKind>(
    "selectedKind",
    "collection",
  );
  const { ref: messages, scrollToBottom } =
    useOverlayScrollbars<HTMLDivElement>();
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [activeTab, setActiveTab] = useState<"builder" | "chat">("builder");
  const [prompt, setPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `conversation-${Date.now()}`,
  );
  const [sendShortcut, setSendShortcut] = useState("Ctrl + Enter");

  useEffect(() => {
    const platform = navigator.platform || navigator.userAgent;
    if (/Mac|iPhone|iPad|iPod/i.test(platform)) setSendShortcut("⌘ + Enter");
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(frame);
  }, [chatMessages.length]);

  function resizePrompt(input: HTMLTextAreaElement) {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }

  async function sendToAi(
    history: ChatMessage[],
    assistantId: number,
    latestMessage: string,
  ) {
    setChatMessages((current) => [
      ...current,
      { id: assistantId, role: "assistant", text: "AI is thinking…" },
    ]);
    try {
      const response = await fetch(`${path}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ conversationId, message: latestMessage }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? "AI request failed.");
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        // Backward-compatible fallback while a dev server is HMR-reloading:
        // older handlers returned one JSON response instead of SSE.
        const body = (await response.json().catch(() => ({}))) as {
          message?: { text?: string } | string;
        };
        const text =
          typeof body.message === "string" ? body.message : body.message?.text;
        if (!text?.trim()) throw new Error("AI returned an empty response.");
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, text: text.trim() }
              : message,
          ),
        );
        return;
      }
      if (!response.body) throw new Error("AI returned an empty stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedText = false;
      const applyEvent = (event: string) => {
        const line = event
          .split(/\r?\n/)
          .find((part) => part.startsWith("data:"));
        if (!line) return;
        const payload = JSON.parse(line.slice(5).trim()) as {
          delta?: string;
          done?: boolean;
          error?: string;
        };
        if (payload.error) throw new Error(payload.error);
        if (payload.delta) {
          receivedText = true;
          setChatMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    text:
                      message.text === "AI is thinking…"
                        ? payload.delta!
                        : message.text + payload.delta,
                  }
                : message,
            ),
          );
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const event of events) applyEvent(event);
      }
      if (buffer.trim()) applyEvent(buffer);
      if (!receivedText) throw new Error("AI returned an empty response.");
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "AI request failed.";
      setChatMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, text: `Error: ${text}` }
            : message,
        ),
      );
    }
  }

  return (
    <>
      <div class="page-header">
        <div>
          <h1>Builder Content type</h1>
          <p>Build a content type with help from AI.</p>
        </div>
      </div>

      <div
        class="builder-mobile-tabs"
        role="tablist"
        aria-label="Builder views"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "builder"}
          onClick={() => setActiveTab("builder")}
        >
          Builder
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        >
          AI chat
        </button>
      </div>

      <div class="builder-content-type-layout">
        <section
          class={`card builder-panel${activeTab === "builder" ? " mobile-active" : ""}`}
        >
          <header class="row justify-between" style={{ flexWrap: "nowrap" }}>
            <div class="spacer">
              <h2>{KIND_PLURAL_LABELS[selectedKind]}</h2>
              <p>Choose a {KIND_LABELS[selectedKind].toLowerCase()} to edit.</p>
            </div>
            <div class="row" style={{ flexWrap: "nowrap" }}>
              <div
                class="file-view-toggle"
                role="group"
                aria-label="Content type kind"
              >
                {(Object.keys(KIND_LABELS) as ContentTypeKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    class="sm ghost"
                    aria-pressed={selectedKind === kind}
                    onClick={() => setSelectedKind(kind)}
                  >
                    {KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAddingKind(selectedKind)}
              >
                <PlusIcon /> Add
              </button>
            </div>
          </header>
          <div class="builder-panel-body builder-collections-body">
            <BuilderCollectionList kind={selectedKind} onOpen={setEditingId} />
          </div>
        </section>

        <section
          class={`card ai-chat-panel${activeTab === "chat" ? " mobile-active" : ""}`}
          style={{ gap: 0 }}
        >
          <header>
            <h2>AI chat</h2>
            <p>Describe the content type you want to create.</p>
          </header>
          <div class="ai-chat-messages scroll under" ref={messages}>
            {chatMessages.length === 0 ? (
              <div class="ai-chat-empty">
                <strong>Start with an idea</strong>
                <span>For example: “Create a blog post content type.”</span>
              </div>
            ) : (
              <div class="ai-chat-message-list">
                {chatMessages.map((message) => (
                  <div
                    class={`ai-chat-message ${message.role}`}
                    key={message.id}
                  >
                    {message.role === "assistant" &&
                    message.text &&
                    message.text !== "AI is thinking…" ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: renderAssistantMessage(message.text),
                        }}
                      />
                    ) : (
                      message.text ||
                      (message.role === "assistant" ? "AI is thinking…" : "")
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <form
            class="ai-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              const text = prompt.trim();
              if (!text) return;
              const messageId = Date.now();
              setChatMessages((current) => [
                ...current,
                { id: messageId, role: "user", text },
              ]);
              const history = [
                ...chatMessages,
                { id: messageId, role: "user" as const, text },
              ];
              setPrompt("");
              if (promptInput.current)
                promptInput.current.style.height = "2.75rem";
              // Yield one frame so the optimistic user message paints first.
              window.setTimeout(
                () => void sendToAi(history, messageId + 1, text),
                0,
              );
            }}
          >
            <div class="ai-chat-input-wrap">
              <textarea
                aria-label="Message AI"
                ref={promptInput}
                rows={1}
                value={prompt}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    (
                      event.currentTarget as HTMLTextAreaElement
                    ).form?.requestSubmit();
                  }
                }}
                onInput={(event) => {
                  resizePrompt(event.currentTarget);
                  setPrompt(event.currentTarget.value);
                }}
              />
              <span class="ai-chat-input-shortcut" aria-hidden="true">
                {sendShortcut}
              </span>
              <button type="submit" disabled={!prompt.trim()}>
                Send
              </button>
            </div>
          </form>
        </section>
      </div>
      <CollectionEditorDialog
        id={editingId}
        addingKind={addingKind}
        onClose={() => {
          setEditingId(null);
          setAddingKind(null);
        }}
      />
    </>
  );
}
