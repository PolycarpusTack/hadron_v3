/**
 * ChatMessageBubble — Renders a single chat message (user or assistant).
 *
 * Displays markdown-formatted content, source badges, feedback controls,
 * copy/export actions, diagnostics panel, and gold-star bookmarking.
 */

import { useState } from "react";
import {
  Sparkles,
  BookOpen,
  Database,
  Copy,
  Check,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Star,
  RefreshCw,
  Pencil,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  submitChatFeedback,
  removeChatFeedback,
  getChatFeedback,
  FEEDBACK_REASONS,
  type ChatMessage,
  type ChatDiagnosticsEvent,
  type FeedbackReason,
} from "../services/chat";
import { open } from "@tauri-apps/plugin-shell";
import DiagnosticsPanel from "./DiagnosticsPanel";
import ExportMenu from "./ExportMenu";
import type { SourceItem } from "./SourcePanel";
import logger from "../services/logger";
import React from "react";

// ============================================================================
// Static markdown component overrides (hoisted to module level)
// ============================================================================

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm text-gray-200 mb-2 last:mb-0">{children}</p>
  ),
  code: ({
    className,
    children,
    ...props
  }: {
    className?: string;
    children?: React.ReactNode;
  }) => {
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
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="text-sm text-gray-200 list-disc pl-4 mb-2 space-y-1">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="text-sm text-gray-200 list-decimal pl-4 mb-2 space-y-1">
      {children}
    </ol>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-bold text-gray-100 mt-3 mb-2">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-bold text-gray-100 mt-3 mb-1.5">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold text-gray-200 mt-2 mb-1">
      {children}
    </h3>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-emerald-500/30 pl-3 italic text-gray-400 my-2">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="text-xs border-collapse border border-gray-700">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-gray-700 px-2 py-1 bg-gray-800 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-gray-700 px-2 py-1">{children}</td>
  ),
};

// ============================================================================
// Props
// ============================================================================

export interface ChatMessageBubbleProps {
  message: ChatMessage;
  sessionId: string | null;
  copiedId: string | null;
  copyFailed: boolean;
  onCopy: (id: string, content: string) => void;
  diagnostics?: ChatDiagnosticsEvent;
  onNavigateToAnalysis?: (id: number) => void;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
  onEdit?: (messageId: string) => void;
  isGold?: boolean;
  onGoldStar?: (messageId: string) => void;
  onOpenSources?: (sources: SourceItem[]) => void;
}

// ============================================================================
// Chat Message Bubble
// ============================================================================

function ChatMessageBubble({
  message,
  sessionId,
  copiedId,
  copyFailed,
  onCopy,
  diagnostics,
  onNavigateToAnalysis,
  isLastAssistant,
  onRegenerate,
  onEdit,
  isGold,
  onGoldStar,
  onOpenSources,
}: ChatMessageBubbleProps) {
  const isUser = message.role === "user";
  const existingFeedback = !isUser ? getChatFeedback(message.id) : null;
  const [rating, setRating] = useState<"positive" | "negative" | null>(
    existingFeedback?.rating ?? null
  );
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason | null>(
    (existingFeedback?.reason as FeedbackReason) ?? null
  );
  const [showReasonPicker, setShowReasonPicker] = useState(false);

  const handleRate = (newRating: "positive" | "negative") => {
    const value = rating === newRating ? null : newRating;
    setRating(value);
    if (value === "negative") {
      setShowReasonPicker(true);
    } else {
      setShowReasonPicker(false);
      setFeedbackReason(null);
    }
    if (value && sessionId) {
      submitChatFeedback(sessionId, message.id, value);
    } else if (!value && sessionId) {
      removeChatFeedback(sessionId, message.id);
    }
  };

  const handleReasonSelect = (reason: FeedbackReason) => {
    setFeedbackReason(reason);
    setShowReasonPicker(false);
    if (sessionId) {
      submitChatFeedback(sessionId, message.id, "negative", undefined, reason);
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
          <div>
            <p className="text-sm text-gray-200 whitespace-pre-wrap">
              {message.content}
            </p>
            {/* Edit & Re-ask button (Task 20) */}
            {onEdit && (
              <div className="flex justify-end mt-1.5 pt-1.5 border-t border-blue-500/10">
                <button
                  onClick={() => onEdit(message.id)}
                  className="p-1 rounded text-gray-500 hover:bg-gray-700/50 hover:text-gray-300 transition"
                  title="Edit & re-ask"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  ...markdownComponents,
                  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
                    const hadronMatch = href?.match(/^hadron:\/\/analysis\/(\d+)$/);
                    if (hadronMatch && onNavigateToAnalysis) {
                      return (
                        <button
                          onClick={() => onNavigateToAnalysis(Number(hadronMatch[1]))}
                          className="text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                        >
                          {children}
                        </button>
                      );
                    }
                    return (
                      <button
                        onClick={() => {
                          if (href) {
                            open(href).catch((e) =>
                              logger.error("Failed to open URL", { error: String(e), url: href })
                            );
                          }
                        }}
                        className="text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                      >
                        {children}
                      </button>
                    );
                  },
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

        {/* Source badges + action buttons (assistant only, when not streaming) */}
        {!isUser && !message.isStreaming && message.content && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/50">
            {/* Source badges — clickable to open SourcePanel (Task 23) */}
            <button
              onClick={() => {
                if (onOpenSources) {
                  // Build SourceItem[] from message.sources counts (placeholder - full data is Phase 7)
                  const sources: SourceItem[] = [];
                  if (message.sources?.kbResults) {
                    for (let i = 0; i < message.sources.kbResults; i++) {
                      sources.push({ title: `KB result ${i + 1}`, type: "kb" });
                    }
                  }
                  if (message.sources?.ragResults) {
                    for (let i = 0; i < message.sources.ragResults; i++) {
                      sources.push({ title: `Analysis ${i + 1}`, type: "analysis" });
                    }
                  }
                  if (message.sources?.goldMatches) {
                    for (let i = 0; i < message.sources.goldMatches; i++) {
                      sources.push({ title: `Gold match ${i + 1}`, type: "gold" });
                    }
                  }
                  if (message.sources?.ftsResults) {
                    for (let i = 0; i < message.sources.ftsResults; i++) {
                      sources.push({ title: `FTS result ${i + 1}`, type: "fts" });
                    }
                  }
                  onOpenSources(sources);
                }
              }}
              className="flex items-center gap-1.5 flex-wrap hover:opacity-80 transition"
              title="View sources"
            >
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
            </button>
            <div className="flex items-center gap-0.5">
              {/* Thumbs up */}
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
              {/* Thumbs down */}
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
              {/* Copy */}
              <button
                onClick={() => onCopy(message.id, message.content)}
                className="p-1 rounded hover:bg-gray-700/50 transition text-gray-500 hover:text-gray-300"
                title="Copy to clipboard"
              >
                {copiedId === message.id ? (
                  copyFailed ? (
                    <span className="text-[10px] text-red-400 px-0.5">Failed</span>
                  ) : (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  )
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              {/* Gold star (Task 21) */}
              {onGoldStar && (
                <button
                  onClick={() => onGoldStar(message.id)}
                  className={`p-1 rounded transition ${
                    isGold
                      ? "text-amber-400"
                      : "text-gray-500 hover:bg-gray-700/50 hover:text-gray-300"
                  }`}
                  title={isGold ? "Saved as gold answer" : "Save as gold answer"}
                >
                  <Star className={`w-3.5 h-3.5 ${isGold ? "fill-amber-400" : ""}`} />
                </button>
              )}
              {/* Per-message export (Task 23) */}
              <ExportMenu mode="message" content={message.content} timestamp={message.timestamp} />
              {/* Regenerate (Task 20) — only on last assistant message */}
              {isLastAssistant && onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="p-1 rounded hover:bg-gray-700/50 transition text-gray-500 hover:text-gray-300"
                  title="Regenerate response"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Feedback reason picker (shown after thumbs-down) */}
        {showReasonPicker && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FEEDBACK_REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => handleReasonSelect(r.value)}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                  feedbackReason === r.value
                    ? "bg-red-500/20 border-red-500/30 text-red-300"
                    : "bg-gray-800/50 border-gray-700/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        {!showReasonPicker && feedbackReason && (
          <div className="mt-1 text-[10px] text-red-400/60">
            Feedback: {FEEDBACK_REASONS.find((r) => r.value === feedbackReason)?.label}
          </div>
        )}

        {/* Diagnostics panel (collapsed by default) */}
        {!isUser && !message.isStreaming && diagnostics && (
          <DiagnosticsPanel diagnostics={diagnostics} />
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

export default React.memo(ChatMessageBubble);
