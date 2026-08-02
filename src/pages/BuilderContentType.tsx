import { useEffect, useRef, useState } from "preact/hooks";
import { path } from "virtual:drycms/config";

import { useOverlayScrollbars } from "../components/overlayscrollbars.js";
import { useDocumentTitle } from "./page-common.js";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
}

export default function BuilderContentType() {
  useDocumentTitle("Builder Content type");
  const { ref: messages, scrollToBottom } = useOverlayScrollbars<HTMLDivElement>();
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [activeTab, setActiveTab] = useState<"builder" | "chat">("builder");
  const [prompt, setPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
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

  async function sendToAi(history: ChatMessage[], assistantId: number) {
    setChatMessages((current) => [
      ...current,
      { id: assistantId, role: "assistant", text: "AI is thinking…" },
    ]);
    try {
      const response = await fetch(`${path}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ messages: history.map(({ role, text }) => ({ role, text })) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "AI request failed.");
      }
      if (!response.body) throw new Error("AI returned an empty stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedText = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const event of events) {
          const line = event.split(/\r?\n/).find((part) => part.startsWith("data:"));
          if (!line) continue;
          const payload = JSON.parse(line.slice(5).trim()) as { delta?: string; done?: boolean; error?: string };
          if (payload.error) throw new Error(payload.error);
          if (payload.delta) {
            receivedText = true;
            setChatMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: message.text === "AI is thinking…" ? payload.delta! : message.text + payload.delta } : message));
          }
        }
      }
      if (!receivedText) throw new Error("AI returned an empty response.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "AI request failed.";
      setChatMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: `Error: ${text}` } : message));
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

      <div class="builder-mobile-tabs" role="tablist" aria-label="Builder views">
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
        <section class={`card builder-panel${activeTab === "builder" ? " mobile-active" : ""}`}>
          <header>
            <h2>Builder</h2>
            <p>The content type builder will be available here.</p>
          </header>
          <div class="builder-panel-body">
            <span class="badge outline">Coming soon</span>
          </div>
        </section>

        <section class={`card ai-chat-panel${activeTab === "chat" ? " mobile-active" : ""}`} style={{ gap: 0}}>
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
                  <div class={`ai-chat-message ${message.role}`} key={message.id}>
                    {message.text || (message.role === "assistant" ? "AI is thinking…" : "")}
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
              const history = [...chatMessages, { id: messageId, role: "user" as const, text }];
              setPrompt("");
              if (promptInput.current) promptInput.current.style.height = "2.75rem";
              // Yield one frame so the optimistic user message paints first.
              window.setTimeout(() => void sendToAi(history, messageId + 1), 0);
            }}
          >
            <div class="ai-chat-input-wrap">
              <textarea
                aria-label="Message AI"
                ref={promptInput}
                rows={1}
                value={prompt}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
                  }
                }}
                onInput={(event) => {
                  resizePrompt(event.currentTarget);
                  setPrompt(event.currentTarget.value);
                }}
                placeholder="e.g. Create a product content type with a name and price"
              />
              <span class="ai-chat-input-shortcut" aria-hidden="true">{sendShortcut}</span>
              <button type="submit" disabled={!prompt.trim()}>
                Send
              </button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
