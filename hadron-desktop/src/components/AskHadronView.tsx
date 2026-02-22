/**
 * Ask Hadron — Conversational AI Chat View
 *
 * Provides a multi-turn chat interface that combines KB docs, RAG historical
 * analyses, gold matches, and FTS search into contextual AI responses.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  MessageCircle,
  Send,
  Plus,
  Trash2,
  Database,
  BookOpen,
  Loader2,
  Sparkles,
  Search,
  SlidersHorizontal,
  StopCircle,
  Star,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import {
  sendChatMessage,
  cancelChat,
  subscribeToChatStream,
  subscribeToChatContext,
  subscribeToChatToolUse,
  subscribeToChatDiagnostics,
  subscribeToChatFinalContent,
  getChatSessions,
  getChatSessionMessages,
  saveChatSession,
  deleteChatSession,
  generateSessionTitle,
  createSessionId,
  createMessageId,
  createRequestId,
  starChatSession,
  type ChatMessage,
  type ChatSession,
  type ChatSources,
  type ChatStreamEvent,
  type ChatToolUseEvent,
  type ChatDiagnosticsEvent,
} from "../services/chat";
import { isKBEnabled, getOpenSearchConfig } from "../services/opensearch";
import ChatMessageBubble from "./ChatMessageBubble";
import GoldAnswerDialog from "./GoldAnswerDialog";
import SummaryPanel from "./SummaryPanel";
import SessionFilters, { filterSessions, DEFAULT_FILTERS, type FilterState } from "./SessionFilters";
import SourcePanel, { type SourceItem } from "./SourcePanel";
import ExportMenu from "./ExportMenu";
import { listGoldAnswers } from "../services/gold-answers";
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
  search_gold_answers: "Checking verified answers",
};

// ============================================================================
// Main Component
// ============================================================================

interface AskHadronViewProps {
  selectedAnalysisId?: number | null;
  onNavigateToAnalysis?: (id: number) => void;
}

export default function AskHadronView({ selectedAnalysisId, onNavigateToAnalysis }: AskHadronViewProps) {
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
  const [wonVersion, setWonVersion] = useState("");
  const [customer, setCustomer] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Diagnostics state (PR8): maps message ID -> diagnostics event
  const [messageDiagnostics, setMessageDiagnostics] = useState<Record<string, ChatDiagnosticsEvent>>({});

  // Verbosity toggle (Task 20)
  const [verbosity, setVerbosity] = useState<"concise" | "detailed" | null>(null);

  // Gold answers state (Task 21)
  const [goldMessageIds, setGoldMessageIds] = useState<Set<string>>(new Set());
  const [goldDialogState, setGoldDialogState] = useState<{
    isOpen: boolean;
    question: string;
    answer: string;
    messageId: string;
  }>({ isOpen: false, question: "", answer: "", messageId: "" });

  // Session filters state (Task 22)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [contextMenuSessionId, setContextMenuSessionId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Summary & Source panel state (Task 23)
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [showSourcePanel, setShowSourcePanel] = useState(false);
  const [sourcePanelSources, setSourcePanelSources] = useState<SourceItem[]>([]);

  // UI state
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingContentRef = useRef("");
  const sessionsRef = useRef<ChatSession[]>([]);
  const activeRequestIdRef = useRef<string | null>(null);

  // Keep sessionsRef in sync
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Load sessions and check KB on mount
  useEffect(() => {
    getChatSessions().then(setSessions).catch(() => setSessions([]));
    isKBEnabled().then(setKbAvailable).catch(() => setKbAvailable(false));
    getOpenSearchConfig().then((cfg) => {
      setWonVersion(cfg.defaultVersion);
      setCustomer(cfg.defaultCustomer);
    }).catch(() => {});
  }, []);

  // Auto-scroll on new messages (scroll container only, not the page)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Focus input on session change (without scrolling the page)
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [activeSessionId]);

  // ============================================================================
  // Session Management
  // ============================================================================

  const startNewSession = useCallback(() => {
    if (isLoading) return;
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    inputRef.current?.focus({ preventScroll: true });
  }, [isLoading]);

  const selectSession = useCallback(async (session: ChatSession) => {
    if (isLoading) return;
    try {
      setErrorMsg(null);
      setActiveSessionId(session.id);
      setInput("");
      const msgs = await getChatSessionMessages(session.id);
      setMessages(msgs);
    } catch (err) {
      setErrorMsg(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
      setMessages([]);
    }
  }, [isLoading]);

  const handleDeleteSession = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        setErrorMsg(null);
        await deleteChatSession(sessionId);
        const updated = await getChatSessions();
        setSessions(updated);
        if (activeSessionId === sessionId) {
          startNewSession();
        }
      } catch (err) {
        setErrorMsg(`Failed to delete session: ${err instanceof Error ? err.message : String(err)}`);
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

      setErrorMsg(null);

      // Pre-flight: hard block if KB enabled but not configured
      if (useKb && !kbAvailable) {
        setErrorMsg("KB is enabled but not configured. Disable KB or configure it in Settings.");
        return;
      }

      // Pre-flight: soft warning if no retrieval sources (send still proceeds)
      if (!useRag && !useKb) {
        setErrorMsg("No retrieval sources enabled. Responses will lack contextual data.");
      }

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
      const requestId = createRequestId();
      activeRequestIdRef.current = requestId;
      let unlistenStream: (() => void) | null = null;
      let unlistenContext: (() => void) | null = null;
      let unlistenToolUse: (() => void) | null = null;
      let unlistenDiagnostics: (() => void) | null = null;
      let unlistenFinalContent: (() => void) | null = null;
      let sources: ChatSources | undefined;

      try {
        unlistenToolUse = await subscribeToChatToolUse((event: ChatToolUseEvent) => {
          const label = TOOL_LABELS[event.tool_name] || `Using ${event.tool_name}`;
          setToolActivity(label);
        }, requestId);

        unlistenDiagnostics = await subscribeToChatDiagnostics((diag) => {
          // Attach diagnostics to the assistant message being streamed
          setMessageDiagnostics((prev) => ({
            ...prev,
            [assistantMsg.id]: diag,
          }));
        }, requestId);

        unlistenFinalContent = await subscribeToChatFinalContent((event) => {
          streamingContentRef.current = event.content;
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
              // Also clear isStreaming to prevent flash of unprocessed content
              updated[lastIdx] = { ...updated[lastIdx], content: event.content, isStreaming: false };
            }
            return updated;
          });
        }, requestId);

        unlistenContext = await subscribeToChatContext((ctx) => {
          // Tauri serializes with snake_case, cast to handle both conventions
          const raw = ctx as unknown as Record<string, number>;
          sources = {
            ragResults: raw.ragResults ?? raw.rag_results ?? 0,
            kbResults: raw.kbResults ?? raw.kb_results ?? 0,
            goldMatches: raw.goldMatches ?? raw.gold_matches ?? 0,
            ftsResults: raw.ftsResults ?? raw.fts_results ?? 0,
          };
        }, requestId);

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
        }, requestId);

        // Send the message (this blocks until streaming is complete)
        const messagesForBackend = [...messages, userMsg];
        await sendChatMessage(messagesForBackend, {
          useRag,
          useKb: useKb && kbAvailable,
          analysisId: selectedAnalysisId,
          requestId,
          wonVersion: wonVersion || undefined,
          customer: customer || undefined,
          verbosity: verbosity || undefined,
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
        if (unlistenDiagnostics) unlistenDiagnostics();
        if (unlistenFinalContent) unlistenFinalContent();
        activeRequestIdRef.current = null;
        setIsLoading(false);
        setToolActivity(null);

        // Save session to SQLite
        setMessages((prev) => {
          // Derive isNewSession from prev: if there's exactly 1 user message, it's new
          const isNewSession = prev.filter((m) => m.role === "user").length === 1;
          const existingSession = sessionsRef.current.find((s) => s.id === sessionId);

          const title = isNewSession
            ? generateSessionTitle(text)
            : existingSession?.title || generateSessionTitle(text);

          const session: ChatSession = {
            id: sessionId!,
            title,
            messages: prev,
            createdAt: existingSession?.createdAt || Date.now(),
            updatedAt: Date.now(),
          };
          saveChatSession(session)
            .then(() => getChatSessions().then(setSessions))
            .catch((e) => {
              logger.error("Failed to save chat session", { error: String(e) });
              setErrorMsg("Warning: session could not be saved. Your conversation may be lost on restart.");
            });
          return prev;
        });
      }
    },
    [input, isLoading, activeSessionId, messages, useRag, useKb, kbAvailable, wonVersion, customer, verbosity]
  );

  // ============================================================================
  // Cancel Handler
  // ============================================================================

  const handleCancel = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    if (requestId) {
      cancelChat(requestId);
    }
  }, []);

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

  const handleCopy = async (msgId: string, content: string) => {
    try {
      setCopyFailed(false);
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for non-secure contexts (e.g. HTTP, Tauri on some platforms)
      try {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopiedId(msgId);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        setCopyFailed(true);
        setCopiedId(msgId);
        setTimeout(() => {
          setCopiedId(null);
          setCopyFailed(false);
        }, 2000);
      }
    }
  };

  // ============================================================================
  // Regenerate last response (Task 20)
  // ============================================================================

  // We use a ref to track a pending regeneration so the next render's handleSend picks it up
  const pendingRegenerateRef = useRef<string | null>(null);

  const handleRegenerate = useCallback(() => {
    if (isLoading || messages.length < 2) return;
    // Find the last user message
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    const userText = messages[lastUserIdx].content;
    // Remove the user message AND the assistant response after it
    // handleSend will re-add both (new user msg + assistant placeholder)
    setMessages(messages.slice(0, lastUserIdx));
    pendingRegenerateRef.current = userText;
  }, [isLoading, messages]);

  // Effect to trigger regeneration after messages state has updated
  useEffect(() => {
    const text = pendingRegenerateRef.current;
    if (text && !isLoading) {
      pendingRegenerateRef.current = null;
      handleSend(text);
    }
  }, [messages, isLoading, handleSend]);

  // ============================================================================
  // Edit & Re-ask (Task 20)
  // ============================================================================

  const handleEditMessage = useCallback((messageId: string) => {
    if (isLoading) return;
    const msgIdx = messages.findIndex((m) => m.id === messageId);
    if (msgIdx < 0 || messages[msgIdx].role !== "user") return;
    // Load content into input
    setInput(messages[msgIdx].content);
    // Remove this message and all after it
    setMessages((prev) => prev.slice(0, msgIdx));
    inputRef.current?.focus({ preventScroll: true });
  }, [isLoading, messages]);

  // ============================================================================
  // Gold answer dialog (Task 21)
  // ============================================================================

  const handleOpenGoldDialog = useCallback((messageId: string) => {
    // Find this assistant message and the preceding user message
    const msgIdx = messages.findIndex((m) => m.id === messageId);
    if (msgIdx < 0) return;
    const assistantMsg = messages[msgIdx];
    // Walk backwards to find the user message
    let question = "";
    for (let i = msgIdx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        question = messages[i].content;
        break;
      }
    }
    setGoldDialogState({
      isOpen: true,
      question,
      answer: assistantMsg.content,
      messageId,
    });
  }, [messages]);

  const handleGoldDialogClose = useCallback(() => {
    setGoldDialogState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleGoldSaved = useCallback((messageId: string) => {
    setGoldMessageIds((prev) => new Set(prev).add(messageId));
    setGoldDialogState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // ============================================================================
  // Session star toggle (Task 22)
  // ============================================================================

  const handleStarSession = useCallback(async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const newStarred = !session.isStarred;
    try {
      await starChatSession(sessionId, newStarred);
      setSessions((prev) =>
        prev.map((s) => s.id === sessionId ? { ...s, isStarred: newStarred } : s)
      );
    } catch (err) {
      setErrorMsg(`Failed to star session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [sessions]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenuSessionId) return;
    const handleClick = () => {
      setContextMenuSessionId(null);
      setContextMenuPos(null);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenuSessionId]);

  // Load gold answer IDs for current session (Task 21)
  useEffect(() => {
    if (!activeSessionId) {
      setGoldMessageIds(new Set());
      return;
    }
    listGoldAnswers(1000, 0).then((golds) => {
      const ids = new Set<string>();
      for (const g of golds) {
        if (g.sessionId === activeSessionId) {
          ids.add(g.messageId);
        }
      }
      setGoldMessageIds(ids);
    }).catch(() => setGoldMessageIds(new Set()));
  }, [activeSessionId]);

  // ============================================================================
  // Source panel handler (Task 23)
  // ============================================================================

  const handleOpenSourcePanel = useCallback((_sources: SourceItem[]) => {
    setSourcePanelSources(_sources);
    setShowSourcePanel(true);
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  // Apply session filters (Task 22)
  const filteredSessions = useMemo(() =>
    filterSessions(sessions, filters).sort((a, b) => {
      // Starred sessions first, then by updatedAt desc
      if (a.isStarred && !b.isStarred) return -1;
      if (!a.isStarred && b.isStarred) return 1;
      return b.updatedAt - a.updatedAt;
    }),
    [sessions, filters]
  );

  const hasMessages = messages.length > 0;

  // Determine last assistant message ID for regenerate button
  const lastAssistantId = messages.length > 0 && messages[messages.length - 1].role === "assistant"
    ? messages[messages.length - 1].id
    : null;

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[24rem] gap-4">
      {/* Sessions Sidebar */}
      {showSidebar && (
        <div className="hd-panel-soft flex w-64 flex-shrink-0 flex-col bg-gray-900/45">
          {/* New Chat Button */}
          <button
            onClick={startNewSession}
            disabled={isLoading}
            className={`flex items-center gap-2 px-4 py-3 m-2 rounded-lg transition text-sm font-medium ${
              isLoading
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>

          {/* Session Filters (Task 22) */}
          <div className="px-2">
            <SessionFilters filters={filters} onFiltersChange={setFilters} />
          </div>

          {/* Session List */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {filteredSessions.length === 0 && (
              <p className="text-gray-500 text-xs text-center py-4">
                {sessions.length === 0 ? "No conversations yet" : "No sessions match filters"}
              </p>
            )}
            {filteredSessions.map((session) => (
              <div
                key={session.id}
                onClick={() => !isLoading && selectSession(session)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenuSessionId(session.id);
                  setContextMenuPos({ x: e.clientX, y: e.clientY });
                }}
                className={`group flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm transition ${
                  isLoading
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer"
                } ${
                  activeSessionId === session.id
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                    : `text-gray-400 ${!isLoading ? "hover:bg-gray-700/50 hover:text-gray-200" : ""}`
                }`}
              >
                {session.isStarred ? (
                  <Star className="w-3 h-3 flex-shrink-0 text-amber-400 fill-amber-400" />
                ) : (
                  <MessageCircle className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                )}
                <span className="flex-1 truncate">{session.title}</span>
                {/* Metadata badges */}
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  {session.hasSummary && (
                    <span title="Has summary"><FileText className="w-2.5 h-2.5 text-blue-400/60" /></span>
                  )}
                  {session.hasGoldAnswers && (
                    <span title="Has gold answers"><Star className="w-2.5 h-2.5 text-amber-400/60" /></span>
                  )}
                </span>
                {!isLoading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setContextMenuSessionId(session.id);
                      setContextMenuPos({ x: e.clientX, y: e.clientY });
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-gray-300 transition"
                    title="More actions"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Context Menu (Task 22) */}
          {contextMenuSessionId && contextMenuPos && (
            <div
              className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
              style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleStarSession(contextMenuSessionId);
                  setContextMenuSessionId(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition flex items-center gap-2"
              >
                <Star className="w-3 h-3" />
                {sessions.find((s) => s.id === contextMenuSessionId)?.isStarred ? "Unstar" : "Star"}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSummaryPanel(true);
                  if (contextMenuSessionId !== activeSessionId) {
                    const session = sessions.find((s) => s.id === contextMenuSessionId);
                    if (session) selectSession(session);
                  }
                  setContextMenuSessionId(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition flex items-center gap-2"
              >
                <FileText className="w-3 h-3" />
                Summarize
              </button>
              <button
                onClick={(e) => handleDeleteSession(contextMenuSessionId, e)}
                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700 transition flex items-center gap-2"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Chat Area */}
      <div className="hd-panel-chat flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-gray-700 px-6 py-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="hd-chip hd-chip-chat hd-chip-emerald">Context-aware answers</span>
            <span className="hd-chip hd-chip-chat hd-chip-blue">Session memory</span>
          </div>
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowSidebar((s) => !s)}
              className="p-1.5 rounded-md hover:bg-gray-700/50 transition text-gray-400"
              title={showSidebar ? "Hide sidebar" : "Show sidebar"}
            >
              <MessageCircle className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-2xl font-bold">Ask Hadron</h2>
              <p className="text-sm text-gray-400">AI Assistant</p>
            </div>
          </div>
          {activeSessionId && (
            <div className="flex items-center gap-2">
              {/* Summarize button (Task 23) */}
              <button
                onClick={() => setShowSummaryPanel(true)}
                disabled={isLoading || !hasMessages}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                  isLoading || !hasMessages
                    ? "text-gray-600 cursor-not-allowed"
                    : "text-gray-400 hover:bg-gray-700/50 hover:text-gray-200"
                }`}
                title="Summarize session"
              >
                <FileText className="w-3.5 h-3.5" />
                Summarize
              </button>
              {/* Session-level export (Task 23) */}
              <ExportMenu
                mode="session"
                messages={messages}
                sessionTitle={sessions.find((s) => s.id === activeSessionId)?.title || "Chat Session"}
              />
              <button
                onClick={startNewSession}
                disabled={isLoading}
                className={`text-xs transition ${
                  isLoading
                    ? "text-gray-600 cursor-not-allowed"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                New Chat
              </button>
            </div>
          )}
          </div>
        </div>

        {/* Error Banner */}
        {errorMsg && (
          <div className="mx-4 mt-2 flex items-center justify-between px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            <span>{errorMsg}</span>
            <button
              onClick={() => setErrorMsg(null)}
              className="ml-3 text-red-400 hover:text-red-300 font-bold"
            >
              &times;
            </button>
          </div>
        )}

        {/* Messages Area */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
              copyFailed={copyFailed}
              onCopy={handleCopy}
              diagnostics={messageDiagnostics[msg.id]}
              onNavigateToAnalysis={onNavigateToAnalysis}
              isLastAssistant={msg.id === lastAssistantId}
              onRegenerate={handleRegenerate}
              onEdit={handleEditMessage}
              isGold={goldMessageIds.has(msg.id)}
              onGoldStar={handleOpenGoldDialog}
              onOpenSources={handleOpenSourcePanel}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-700 px-4 py-3">
          {/* Source Toggles */}
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => setUseRag((v) => !v)}
              aria-pressed={useRag}
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
                aria-pressed={useKb}
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
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              aria-pressed={showAdvanced}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                showAdvanced
                  ? "bg-gray-600/50 text-gray-300 border border-gray-500"
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
              }`}
              title="Retrieval filters"
            >
              <SlidersHorizontal className="w-3 h-3" />
            </button>

            {/* Verbosity toggle (Task 20) */}
            <span className="w-px h-4 bg-gray-700 mx-0.5" />
            <button
              onClick={() => setVerbosity((v) => v === "concise" ? null : "concise")}
              aria-pressed={verbosity === "concise"}
              className={`px-2 py-1 rounded-md text-xs font-medium transition ${
                verbosity === "concise"
                  ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
              }`}
              title="Shorter, focused responses"
            >
              Concise
            </button>
            <button
              onClick={() => setVerbosity((v) => v === "detailed" ? null : "detailed")}
              aria-pressed={verbosity === "detailed"}
              className={`px-2 py-1 rounded-md text-xs font-medium transition ${
                verbosity === "detailed"
                  ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                  : "bg-gray-700/50 text-gray-500 border border-gray-600 hover:text-gray-300"
              }`}
              title="Longer, more thorough responses"
            >
              Detailed
            </button>

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

          {/* Advanced Retrieval Filters */}
          <div className={`mb-2 flex items-center gap-2 ${showAdvanced ? "" : "hidden"}`}>
            <label className="text-xs text-gray-500">WON Version</label>
            <input
              type="text"
              value={wonVersion}
              onChange={(e) => setWonVersion(e.target.value)}
              placeholder="e.g. 6.7"
              className="text-xs bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-24"
            />
            <label className="text-xs text-gray-500">Customer</label>
            <input
              type="text"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="e.g. VRT"
              className="text-xs bg-gray-800 border border-gray-600 rounded-md px-2 py-1 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-24"
            />
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
            {isLoading ? (
              <button
                onClick={handleCancel}
                className="p-2.5 bg-red-600 hover:bg-red-700 rounded-lg transition"
                title="Cancel request"
              >
                <StopCircle className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="p-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition"
                title="Send message (Enter)"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Panel overlay (Task 23) */}
      {activeSessionId && (
        <SummaryPanel
          sessionId={activeSessionId}
          isOpen={showSummaryPanel}
          onClose={() => setShowSummaryPanel(false)}
        />
      )}

      {/* Source Panel overlay (Task 23) */}
      <SourcePanel
        isOpen={showSourcePanel}
        onClose={() => setShowSourcePanel(false)}
        sources={sourcePanelSources}
      />

      {/* Gold Answer Dialog (Task 21) */}
      {activeSessionId && (
        <GoldAnswerDialog
          isOpen={goldDialogState.isOpen}
          onClose={handleGoldDialogClose}
          onSaved={() => handleGoldSaved(goldDialogState.messageId)}
          question={goldDialogState.question}
          answer={goldDialogState.answer}
          sessionId={activeSessionId}
          messageId={goldDialogState.messageId}
          wonVersion={wonVersion || undefined}
          customer={customer || undefined}
        />
      )}
    </div>
  );
}
