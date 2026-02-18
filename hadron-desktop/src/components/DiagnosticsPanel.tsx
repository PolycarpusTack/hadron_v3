/**
 * DiagnosticsPanel — Expanded tool trace view ("Why this answer")
 *
 * Shows retrieval pipeline diagnostics under each assistant message:
 * expandable tool call cards, evidence assessment, query rewrite, and
 * token/cost footer. Gracefully handles missing tool_traces data
 * (will be added in Phase 7).
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Zap,
  Search,
  Database,
  BookOpen,
  AlertTriangle,
  CheckCircle,
  Clock,
  Wrench,
} from "lucide-react";
import type { ChatDiagnosticsEvent } from "../services/chat";

// ============================================================================
// Types
// ============================================================================

/** Per-tool trace data (Phase 7 will populate this) */
export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  summary: string;
  results?: Array<{ title?: string; snippet?: string }>;
  durationMs?: number;
}

interface DiagnosticsPanelProps {
  diagnostics: ChatDiagnosticsEvent;
  /** Optional detailed tool traces — Phase 7 will supply these */
  toolTraces?: ToolTrace[];
  /** Optional token count */
  tokenCount?: number;
  /** Optional cost in USD */
  cost?: number;
}

// ============================================================================
// Tool Icon Mapping
// ============================================================================

const TOOL_ICONS: Record<string, typeof Search> = {
  search_analyses: Database,
  search_kb: BookOpen,
  search_gold_answers: BookOpen,
  get_analysis_detail: Database,
  find_similar_crashes: Search,
  search_jira: Search,
};

function getToolIcon(name: string) {
  return TOOL_ICONS[name] || Wrench;
}

// ============================================================================
// Component
// ============================================================================

export default function DiagnosticsPanel({
  diagnostics,
  toolTraces,
  tokenCount,
  cost,
}: DiagnosticsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const hasTraces = toolTraces && toolTraces.length > 0;

  return (
    <div className="mt-1.5">
      {/* Collapse toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-400 transition"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <Zap className="w-2.5 h-2.5" />
        <span>
          {diagnostics.total_tool_calls} tool call
          {diagnostics.total_tool_calls !== 1 ? "s" : ""}
          {" \u00b7 "}
          {diagnostics.retrieval_latency_ms}ms
          {!diagnostics.evidence_sufficient && " \u00b7 Low evidence"}
        </span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-3 space-y-2">
          {/* Evidence assessment banner */}
          {diagnostics.evidence_sufficient ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-emerald-900/20 border border-emerald-800/30 text-[11px] text-emerald-400">
              <CheckCircle className="w-3 h-3 flex-shrink-0" />
              <span>
                Evidence sufficient
                {" \u00b7 "}
                {Math.round(diagnostics.evidence_confidence * 100)}% confidence
              </span>
            </div>
          ) : (
            <div className="px-2.5 py-1.5 rounded bg-amber-900/20 border border-amber-800/30 text-[11px]">
              <div className="flex items-center gap-1.5 text-amber-400">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>
                  Insufficient evidence
                  {" \u00b7 "}
                  {Math.round(diagnostics.evidence_confidence * 100)}% confidence
                </span>
              </div>
              {diagnostics.evidence_reason && (
                <div className="mt-1 ml-[18px] text-amber-400/70">
                  {diagnostics.evidence_reason}
                </div>
              )}
            </div>
          )}

          {/* Query rewrite */}
          {diagnostics.rewritten_query && (
            <div className="px-2.5 py-1.5 rounded bg-gray-800/50 border border-gray-700/50 text-[11px]">
              <span className="text-gray-500 font-medium">Rewritten query:</span>{" "}
              <span className="text-blue-400/70 italic">
                &ldquo;{diagnostics.rewritten_query}&rdquo;
              </span>
            </div>
          )}

          {/* Tool trace cards (from Phase 7 data, if available) */}
          {hasTraces ? (
            <div className="space-y-1">
              {toolTraces.map((trace, idx) => (
                <ToolTraceCard key={idx} trace={trace} />
              ))}
            </div>
          ) : (
            /* Fallback: simple tools list from diagnostics */
            <div className="px-2.5 py-1.5 rounded bg-gray-800/50 border border-gray-700/50 text-[11px] text-gray-400">
              <span className="text-gray-500 font-medium">Tools:</span>{" "}
              {diagnostics.tools_used.length > 0
                ? diagnostics.tools_used.join(", ")
                : "none"}
            </div>
          )}

          {/* Token count + cost footer */}
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <Clock className="w-2.5 h-2.5" />
            <span>{diagnostics.retrieval_latency_ms}ms total</span>
            {tokenCount != null && (
              <>
                <span className="text-gray-600">{"\u00b7"}</span>
                <span>{tokenCount.toLocaleString()} tokens</span>
              </>
            )}
            {cost != null && (
              <>
                <span className="text-gray-600">{"\u00b7"}</span>
                <span>${cost.toFixed(4)}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ToolTraceCard sub-component
// ============================================================================

function ToolTraceCard({ trace }: { trace: ToolTrace }) {
  const [open, setOpen] = useState(false);
  const Icon = getToolIcon(trace.name);

  return (
    <div className="rounded bg-gray-800/50 border border-gray-700/50">
      {/* Card header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
        )}
        <Icon className="w-3 h-3 text-gray-400 flex-shrink-0" />
        <span className="text-[11px] text-gray-300 font-medium truncate">
          {trace.name}
        </span>
        <span className="text-[10px] text-gray-500 truncate">
          {trace.summary}
        </span>
        {trace.durationMs != null && (
          <span className="ml-auto text-[10px] text-gray-600 flex-shrink-0">
            {trace.durationMs}ms
          </span>
        )}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-2.5 pb-2 space-y-1.5">
          {/* Arguments JSON */}
          <div>
            <div className="text-[10px] text-gray-500 font-medium mb-0.5">
              Arguments
            </div>
            <pre className="text-[10px] text-gray-400 bg-gray-900/50 rounded px-2 py-1.5 overflow-x-auto max-h-24 font-mono leading-relaxed">
              {JSON.stringify(trace.args, null, 2)}
            </pre>
          </div>

          {/* Top results */}
          {trace.results && trace.results.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 font-medium mb-0.5">
                Results ({trace.results.length})
              </div>
              <div className="space-y-1">
                {trace.results.slice(0, 3).map((r, i) => (
                  <div
                    key={i}
                    className="px-2 py-1 rounded bg-gray-900/40 border border-gray-700/30"
                  >
                    {r.title && (
                      <div className="text-[10px] text-gray-300 font-medium truncate">
                        {r.title}
                      </div>
                    )}
                    {r.snippet && (
                      <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">
                        {r.snippet.length > 150
                          ? r.snippet.slice(0, 150) + "..."
                          : r.snippet}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
