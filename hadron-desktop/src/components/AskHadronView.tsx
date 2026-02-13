/**
 * Ask Hadron — Conversational AI Chat View
 *
 * Provides a multi-turn chat interface that combines KB docs, RAG historical
 * analyses, gold matches, and FTS search into contextual AI responses.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle,
  Send,
  Plus,
  Trash2,
  Database,
  BookOpen,
  Copy,
  Check,
  Loader2,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Search,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  sendChatMessage,
  subscribeToChatStream,
  subscribeToChatContext,
  subscribeToChatToolUse,
  getChatSessions,
  getChatSessionMessages,
  saveChatSession,
  deleteChatSession,
  generateSessionTitle,
  createSessionId,
  createMessageId,
  submitChatFeedback,
  getChatFeedback,
  type ChatMessage,
  type ChatSession,
  type ChatSources,
  type ChatStreamEvent,
  type ChatToolUseEvent,
} from "../services/chat";
import { isKBEnabled } from "../services/opensearch";
import logger from "../services/logger";

// ============================================================================
// Suggested Starter Prompts
// ============================================================================

const STARTER_PROMPTS = [
  "What changed in the latest release?",
  "How does the scheduling engine handle conflicts?",
  "Summarize recent critical crashes",
  "What are common PSI namespace errors?",
];

const CONTEXTUAL_STARTERS = [
  "Explain this crash in simple terms",
  "Find similar crashes to this one",
  "What JIRA tickets relate to this crash?",
  "Suggest a fix for this issue",
];

// ============================================================================
// Tool Activity Labels
// ============================================================================

const TOOL_LABELS: Record<string, string> = {
  search_analyses: "Searching analyses",
  search_kb: "Querying knowledge base",
  get_analysis_detail: "Loading analysis details",
  find_similar_crashes: "Finding similar crashes",
  get_crash_signature: "Looking up crash signature",
  get_top_signatures: "Fetching top signatures",
  get_trend_data: "Loading trend data",
  get_error_patterns: "Analyzing error patterns",
  get_statistics: "Getting statistics",
  correlate_crash_to_jira: "Correlating crash to JIRA",
  get_crash_timeline: "Building crash timeline",
  compare_crashes: "Comparing crashes",
  get_component_health: "Checking component health",
  search_jira: "Searching JIRA issues",
  create_jira_ticket: "Creating JIRA ticket",
};

// ============================================================================
// Main Component
// ============================================================================

interface AskHadronViewProps {
  selectedAnalysisId?: number | null;
}

export default function AskHadronView({ selectedAnalysisId }: AskHadronViewProps) {
  // Session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Input state
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [useRag, setUseRag] = useState(true);
  const [useKb, setUseKb] = useState(false);
  const [kbAvailable, setKbAvailable] = useState(false);

  // UI state
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [toolActivity, setToolActivity] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingContentRef = useRef("");

  // Load sessions and check KB on mount
  useEffect(() => {
    getChatSessions().then(setSessions).catch(() => setSessions([]));
    isKBEnabled().then(setKbAvailable).catch(() => setKbAvailable(false));
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on session change
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSessionId]);

  // ============================================================================
  // Session Management
  // ============================================================================

  const startNewSession = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }, []);

  const selectSession = useCallback(async (session: ChatSession) => {
    setActiveSessionId(session.id);
    setInput("");
    const msgs = await getChatSessionMessages(session.id);
    setMessages(msgs);
  }, []);

  const handleDeleteSession = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await deleteChatSession(sessionId);
      const updated = await getChatSessions();
      setSessions(updated);
      if (activeSessionId === sessionId) {
        startNewSession();
      }
    },
    [activeSessionId, startNewSession]
  );

  // ============================================================================
  // Send Message
  // ============================================================================

  const handleSend = useCallback(
    async (overrideInput?: string) => {
      const text = (overrideInput || input).trim();
      if (!text || isLoading) return;

      // Create user message
      const userMsg: ChatMessage = {
        id: createMessageId(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      // Create or get session
      let sessionId = activeSessionId;
      if (!sessionId) {
        sessionId = createSessionId();
        setActiveSessionId(sessionId);
      }

      // Create assistant placeholder
      const assistantMsg: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
      };

      const newMessages = [...messages, userMsg, assistantMsg];
      setMessages(newMessages);
      setInput("");
      setIsLoading(true);
      streamingContentRef.current = "";

      // Subscribe to stream events
      let unlistenStream: (() => void) | null = null;
      let unlistenContext: (() => void) | null = null;
      let unlistenToolUse: (() => void) | null = null;
      let sources: ChatSources | undefined;

      try {
        unlistenToolUse = await subscribeToChatToolUse((event: ChatToolUseEvent) => {
          const label = TOOL_LABELS[event.tool_name] || `Using ${event.tool_name}`;
          setToolActivity(label);
        });

        unlistenContext = await subscribeToChatContext((ctx) => {
          // Tauri serializes with snake_case, cast to handle both conventions
          const raw = ctx as unknown as Record<string, number>;
          sources = {
            ragResults: raw.ragResults ?? raw.rag_results ?? 0,
            kbResults: raw.kbResults ?? raw.kb_results ?? 0,
            goldMatches: raw.goldMatches ?? raw.gold_matches ?? 0,
            ftsResults: raw.ftsResults ?? raw.fts_results ?? 0,
          };
        });

        unlistenStream = await subscribeToChatStream((event: ChatStreamEvent) => {
          if (event.error) {
            logger.error("Chat stream error", { error: event.error });
            return;
          }

          if (!event.done) {
            streamingContentRef.current += event.token;
            // Update the assistant message with accumulated content
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: streamingContentRef.current,
                };
              }
              return updated;
            });
          }
        });

        // Send the message (this blocks until streaming is complete)
        const messagesForBackend = [...messages, userMsg];
        await sendChatMessage(messagesForBackend, {
          useRag,
          useKb: useKb && kbAvailable,
          analysisId: selectedAnalysisId,
        });

        // Finalize the assistant message
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: streamingContentRef.current,
              isStreaming: false,
              sources,
              timestamp: Date.now(),
            };
          }
          return updated;
        });
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : String(err);
        logger.error("Chat send failed", { error: errorMsg });

        // Update assistant message with error
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: `Error: ${errorMsg}`,
              isStreaming: false,
            };
          }
          return updated;
        });
      } finally {
        if (unlistenStream) unlistenStream();
        if (unlistenContext) unlistenContext();
        if (unlistenToolUse) unlistenToolUse();
        setIsLoading(false);
        setToolActivity(null);

        // Save session to SQLite
        setMessages((prev) => {
          const title =
            messages.length === 0
              ? generateSessionTitle(text)
              : sessions.find((s) => s.id === sessionId)?.title ||
                generateSessionTitle(text);

          const session: ChatSession = {
            id: sessionId!,
            title,
            messages: prev,
            createdAt:
              sessions.find((s) => s.id === sessionId)?.createdAt ||
              Date.now(),
            updatedAt: Date.now(),
          };
          saveChatSession(session).then(() =>
            getChatSessions().then(setSessions)
          );
          return prev;
        });
      }
    },
    [input, isLoading, activeSessionId, messages, sessions, useRag, useKb, kbAvailable]
  );

  // ============================================================================
  // Keyboard handling
  // ============================================================================

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ============================================================================
  // Copy message
  // ============================================================================

  const handleCopy = (msgId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(msgId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ============================================================================
  // Render
  // ============================================================================

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[500px] gap-4">
      {/* Sessions Sidebar */}
      {showSidebar && (
        <div className="w-64 flex-shrink-0 bg-gray-800/50 border border-gray-700 rounded-lg flex flex-col">
          {/* New Chat Button */}
          <button
            onClick={startNewSession}
            className="flex items-center gap-2 px-4 py-3 m-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>

          {/* Session List */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {sessions.length === 0 && (
              <p className="text-gray-500 text-xs text-center py-4">
                No conversations yet
              </p>
            )}
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => selectSession(session)}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm transition ${
                  activeSessionId === session.id
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                    : "text-gray-400 hover:bg-gray-700/50 hover:text-gray-200"
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                <span className="flex-1 truncate">{session.title}</span>
                <button
                  onClick={(e) => handleDeleteSession(session.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition"
                  title="Delete session"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-gray-800/30 border border-gray-700 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar((s) => !s)}
              className="p-1.5 rounded-md hover:bg-gray-700/50 transition text-gray-400"
              title={showSidebar ? "Hide sidebar" : "Show sidebar"}
            >
              <MessageCircle className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-semibold text-emerald-400">
              Ask Hadron
            </h2>
            <span className="text-xs text-gray-500">AI Assistant</span>
          </div>
          {activeSessionId && (
            <button
              onClick={startNewSession}
              className="text-xs text-gray-400 hover:text-gray-200 transition"
            >
              New Chat
            </button>
          )}
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!hasMessages && (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <Sparkles className="w-8 h-8 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-200 mb-1">
                  Ask Hadron
                </h3>
                <p className="text-sm text-gray-400 max-w-md">
                  Ask questions about WHATS'ON, search knowledge base docs,
                  explore historical analyses, or get help debugging issues.
                </p>
              </div>

              {/* Starter Prompts */}
              {selectedAnalysisId && (
                <p className="text-xs text-emerald-400/70 -mb-2">
                  Analysis #{selectedAnalysisId} selected — ask about it:
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                {(selectedAnalysisId ? CONTEXTUAL_STARTERS : STARTER_PROMPTS).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    className="px-3 py-2.5 text-left text-sm text-gray-300 bg-gray-800/50 border border-gray-700 rounded-lg hover:bg-gray-700/50 hover:border-emerald-500/30 hover:text-emerald-300 transition"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              sessionId={activeSessionId}
              copiedId={copiedId}
              onCopy={handleCopy}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-700 px-4 py-3">
          {/* Source Toggles */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setUseRag((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                useRag
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
              }`}
              title="Search historical analyses via RAG"
            >
              <Database className="w-3 h-3" />
              RAG
            </button>
            {kbAvailable && (
              <button
                onClick={() => setUseKb((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  useKb
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
                }`}
                title="Search Knowledge Base docs & release notes"
              >
                <BookOpen className="w-3 h-3" />
                KB
              </button>
            )}
            {isLoading && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400/70">
                {toolActivity ? (
                  <>
                    <Search className="w-3 h-3 animate-pulse" />
                    {toolActivity}...
                  </>
                ) : (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Thinking...
                  </>
                )}
              </span>
            )}
          </div>

          {/* Input Field */}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Hadron anything..."
              rows={1}
              className="flex-1 resize-none bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition max-h-32"
              style={{ minHeight: "42px" }}
              disabled={isLoading}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className="p-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition"
              title="Send message (Enter)"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Chat Message Bubble
// ============================================================================

function ChatMessageBubble({
  message,
  sessionId,
  copiedId,
  onCopy,
}: {
  message: ChatMessage;
  sessionId: string | null;
  copiedId: string | null;
  onCopy: (id: string, content: string) => void;
}) {
  const isUser = message.role === "user";
  const [rating, setRating] = useState<"positive" | "negative" | null>(() =>
    !isUser ? getChatFeedback(message.id)?.rating ?? null : null
  );

  const handleRate = (newRating: "positive" | "negative") => {
    const value = rating === newRating ? null : newRating;
    setRating(value);
    if (value && sessionId) {
      submitChatFeedback(sessionId, message.id, value);
    }
  };

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-md bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mt-1">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
        </div>
      )}

      <div
        className={`max-w-[80%] ${
          isUser
            ? "bg-blue-600/20 border border-blue-500/20 rounded-2xl rounded-br-md"
            : "bg-gray-800/50 border border-gray-700 rounded-2xl rounded-bl-md"
        } px-4 py-3`}
      >
        {isUser ? (
          <p className="text-sm text-gray-200 whitespace-pre-wrap">
            {message.content}
          </p>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => (
                    <p className="text-sm text-gray-200 mb-2 last:mb-0">
                      {children}
                    </p>
                  ),
                  code: ({ className, children, ...props }) => {
                    const isInline = !className;
                    return isInline ? (
                      <code className="text-emerald-300 bg-gray-700/50 px-1 py-0.5 rounded text-xs">
                        {children}
                      </code>
                    ) : (
                      <code
                        className={`block bg-gray-900/50 border border-gray-700 rounded-md p-3 text-xs overflow-x-auto my-2 ${className || ""}`}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  ul: ({ children }) => (
                    <ul className="text-sm text-gray-200 list-disc pl-4 mb-2 space-y-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="text-sm text-gray-200 list-decimal pl-4 mb-2 space-y-1">
                      {children}
                    </ol>
                  ),
                  h1: ({ children }) => (
                    <h1 className="text-base font-bold text-gray-100 mt-3 mb-2">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-sm font-bold text-gray-100 mt-3 mb-1.5">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-semibold text-gray-200 mt-2 mb-1">
                      {children}
                    </h3>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      className="text-emerald-400 hover:text-emerald-300 underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-emerald-500/30 pl-3 italic text-gray-400 my-2">
                      {children}
                    </blockquote>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-2">
                      <table className="text-xs border-collapse border border-gray-700">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-gray-700 px-2 py-1 bg-gray-800 text-left font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-gray-700 px-2 py-1">
                      {children}
                    </td>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
                <Loader2 className="w-3 h-3 animate-spin" />
              </span>
            )}

            {/* Streaming cursor */}
            {message.isStreaming && message.content && (
              <span className="inline-block w-1.5 h-4 bg-emerald-400 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        )}

        {/* Source badges + copy button (assistant only, when not streaming) */}
        {!isUser && !message.isStreaming && message.content && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/50">
            <div className="flex items-center gap-1.5 flex-wrap">
              {message.sources && (
                <>
                  {message.sources.kbResults > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded text-[10px]">
                      <BookOpen className="w-2.5 h-2.5" />
                      {message.sources.kbResults} KB
                    </span>
                  )}
                  {message.sources.ragResults > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 text-blue-400/70 rounded text-[10px]">
                      <Database className="w-2.5 h-2.5" />
                      {message.sources.ragResults} analyses
                    </span>
                  )}
                  {message.sources.goldMatches > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 text-amber-400/70 rounded text-[10px]">
                      <Sparkles className="w-2.5 h-2.5" />
                      {message.sources.goldMatches} gold
                    </span>
                  )}
                  {message.sources.ftsResults > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-500/10 text-gray-400/70 rounded text-[10px]">
                      {message.sources.ftsResults} FTS
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => handleRate("positive")}
                className={`p-1 rounded transition ${
                  rating === "positive"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-gray-500 hover:bg-gray-700/50 hover:text-gray-300"
                }`}
                title="Good response"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleRate("negative")}
                className={`p-1 rounded transition ${
                  rating === "negative"
                    ? "bg-red-500/20 text-red-400"
                    : "text-gray-500 hover:bg-gray-700/50 hover:text-gray-300"
                }`}
                title="Poor response"
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onCopy(message.id, message.content)}
                className="p-1 rounded hover:bg-gray-700/50 transition text-gray-500 hover:text-gray-300"
                title="Copy to clipboard"
              >
                {copiedId === message.id ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-md bg-blue-500/15 border border-blue-500/20 flex items-center justify-center mt-1">
          <span className="text-xs font-bold text-blue-400">U</span>
        </div>
      )}
    </div>
  );
}
