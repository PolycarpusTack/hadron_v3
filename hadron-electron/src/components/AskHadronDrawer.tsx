import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Plus } from "lucide-react";
import {
  sendChatMessage,
  getChatSessionMessages,
  saveChatSession,
  generateSessionTitle,
  createSessionId,
  createMessageId,
  createRequestId,
  type ChatMessage,
  type ChatStreamEvent,
  type ChatToolUseEvent,
} from "../services/chat";

interface AskHadronDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullView: (sessionId?: string) => void;
}

const DRAWER_SESSION_KEY = "hadron-drawer-session-id";

export default function AskHadronDrawer({ isOpen, onClose, onOpenFullView }: AskHadronDrawerProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const streamingContentRef = useRef("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Load last session on mount
  useEffect(() => {
    const storedId = localStorage.getItem(DRAWER_SESSION_KEY);
    if (storedId) {
      getChatSessionMessages(storedId)
        .then((msgs) => {
          setSessionId(storedId);
          setMessages(msgs);
        })
        .catch(() => localStorage.removeItem(DRAWER_SESSION_KEY));
    }
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    localStorage.removeItem(DRAWER_SESSION_KEY);
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");

    const userMsg: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // Create session on first message
    let sid = sessionId;
    if (!sid) {
      sid = createSessionId();
      setSessionId(sid);
      localStorage.setItem(DRAWER_SESSION_KEY, sid);
    }
    const currentSid = sid;

    const assistantId = createMessageId();
    streamingContentRef.current = "";
    setMessages([
      ...newMessages,
      { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true },
    ]);
    setIsLoading(true);

    const requestId = createRequestId();

    try {
      await sendChatMessage(newMessages, {
        useRag: true,
        requestId,
        callbacks: {
          onStream: (event: ChatStreamEvent) => {
            if (event.error || event.done) return;
            streamingContentRef.current += event.token;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: streamingContentRef.current } : m
              )
            );
          },
          onFinalContent: (event) => {
            streamingContentRef.current = event.content;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: event.content, isStreaming: false }
                  : m
              )
            );
          },
          onToolUse: (event: ChatToolUseEvent) => {
            setToolActivity(event.tool_name.replace(/_/g, " "));
          },
        },
      });

      // Persist session to SQLite
      const finalContent = streamingContentRef.current;
      const allMessages: ChatMessage[] = [
        ...newMessages,
        {
          id: assistantId,
          role: "assistant" as const,
          content: finalContent,
          timestamp: Date.now(),
        },
      ];
      await saveChatSession({
        id: currentSid,
        title: generateSessionTitle(trimmed),
        messages: allMessages,
        createdAt: newMessages[0]?.timestamp ?? Date.now(),
        updatedAt: Date.now(),
      });
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      setToolActivity(null);
      // Guarantee isStreaming is cleared even if onFinalContent never fired
      setMessages((prev) =>
        prev.some((m) => m.isStreaming)
          ? prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
          : prev
      );
    }
  }, [input, isLoading, messages, sessionId]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="hd-drawer-backdrop"
        style={{ opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none" }}
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className={`hd-drawer ${isOpen ? "hd-drawer-open" : ""}`}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 16,
            borderBottom: "1px solid var(--hd-border-subtle)",
          }}
        >
          <h3
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <MessageCircle
              className="w-[18px] h-[18px]"
              style={{ color: "var(--hd-accent)" }}
            />
            Ask Hadron
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewChat}
              title="New Chat"
              aria-label="New Chat"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--hd-text-muted)",
                padding: "4px 6px",
                borderRadius: 4,
              }}
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              aria-label="Close drawer"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--hd-text-muted)",
                padding: "4px 6px",
                borderRadius: 4,
              }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Chat Body */}
        <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {messages.length === 0 && !isLoading && (
            <div
              className="hd-text-sm"
              style={{
                textAlign: "center",
                padding: "32px 16px",
                color: "var(--hd-text-dim)",
              }}
            >
              Ask anything about your analyses…
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 16 }}>
              <div
                className="hd-text-2xs"
                style={{
                  fontWeight: 600,
                  color: msg.role === "user" ? "var(--hd-text-muted)" : "var(--hd-accent)",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {msg.role === "user" ? "You" : "Hadron"}
              </div>
              <div
                className="hd-text-sm"
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--hd-radius-sm)",
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  background:
                    msg.role === "user"
                      ? "var(--hd-bg-surface)"
                      : "rgba(16, 185, 129, 0.04)",
                  border: `1px solid ${
                    msg.role === "user"
                      ? "var(--hd-border-subtle)"
                      : "rgba(16, 185, 129, 0.15)"
                  }`,
                  color: "var(--hd-text)",
                }}
              >
                {msg.isStreaming && !msg.content ? (
                  <Loader2
                    className="w-3 h-3 animate-spin"
                    style={{ color: "var(--hd-accent)" }}
                  />
                ) : (
                  <>
                    {msg.content}
                    {msg.isStreaming && msg.content && (
                      <span
                        className="inline-block w-1 h-3.5 bg-emerald-400 animate-pulse ml-0.5 align-middle"
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Open in Full View link */}
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button
              onClick={() => onOpenFullView(sessionId ?? undefined)}
              className="hd-text-xs"
              style={{
                background: "none",
                border: "none",
                color: "var(--hd-accent)",
                cursor: "pointer",
              }}
            >
              Open in Full View &rarr;
            </button>
          </div>
        </div>

        {/* Footer with input */}
        <div style={{ padding: "0 16px 12px", borderTop: "1px solid var(--hd-border-subtle)" }}>
          {toolActivity && (
            <div
              className="hd-text-2xs"
              style={{
                padding: "6px 0 4px",
                color: "var(--hd-text-dim)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Loader2
                className="w-3 h-3 animate-spin"
                style={{ color: "var(--hd-accent)" }}
              />
              {toolActivity}…
            </div>
          )}
          <div style={{ display: "flex", gap: 8, paddingTop: 12 }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about your analyses..."
              className="hd-input hd-text-sm"
              style={{ flex: 1, padding: "9px 12px" }}
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              style={{
                background: "linear-gradient(135deg, #10b981, #34d399)",
                border: "none",
                borderRadius: "var(--hd-radius-sm)",
                padding: "8px 12px",
                cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: isLoading || !input.trim() ? 0.5 : 1,
              }}
            >
              <Send className="w-4 h-4" style={{ color: "#052e24" }} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
