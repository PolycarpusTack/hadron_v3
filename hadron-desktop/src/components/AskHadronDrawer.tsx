import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send } from "lucide-react";

interface AskHadronDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullView: () => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function AskHadronDrawer({ isOpen, onClose, onOpenFullView }: AskHadronDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "user",
      content: "What caused the scheduler crash on Feb 19?",
    },
    {
      role: "assistant",
      content:
        'Based on my analysis of scheduler-crash-0219.log, the crash was caused by a deadlock in the PSI namespace lock acquisition path.\n\nThe JIRA sync callback was holding the scheduler mutex while attempting to acquire the worker pool lock, but a worker thread was doing the reverse — classic ABBA deadlock.\n\nSuggested fix: Enforce a consistent lock ordering (scheduler mutex → worker pool) or use try_lock with backoff.',
    },
  ]);
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

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

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    // Placeholder AI response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I'm analyzing your question. For full conversation capabilities, open the full Ask Hadron view.",
        },
      ]);
    }, 600);
  };

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
          <h3 style={{ fontSize: "1rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <MessageCircle className="w-[18px] h-[18px]" style={{ color: "var(--hd-accent)" }} />
            Ask Hadron
          </h3>
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                background: "rgba(16, 185, 129, 0.15)",
                color: "var(--hd-accent)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
              }}
            >
              RAG ON
            </span>
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                background: "var(--hd-bg-surface)",
                color: "var(--hd-text-dim)",
                border: "1px solid var(--hd-border-subtle)",
              }}
            >
              KB OFF
            </span>
            <button
              onClick={onClose}
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
          {messages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: "0.7rem",
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
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--hd-radius-sm)",
                  fontSize: "0.85rem",
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
                {msg.content}
              </div>
            </div>
          ))}

          {/* Open in Full View link */}
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button
              onClick={onOpenFullView}
              style={{
                background: "none",
                border: "none",
                color: "var(--hd-accent)",
                fontSize: "0.78rem",
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              Open in Full View &rarr;
            </button>
          </div>
        </div>

        {/* Footer with input */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--hd-border-subtle)" }}>
          <div style={{ display: "flex", gap: 8 }}>
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
              className="hd-input"
              style={{ flex: 1, fontSize: "0.85rem", padding: "9px 12px" }}
            />
            <button
              onClick={handleSend}
              style={{
                background: "linear-gradient(135deg, #10b981, #34d399)",
                border: "none",
                borderRadius: "var(--hd-radius-sm)",
                padding: "8px 12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
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
