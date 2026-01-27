/**
 * Citation Panel Component
 * Displays similar historical cases from RAG retrieval
 * Phase 2.3 - Citation UI
 */

import { useState, useEffect } from "react";
import {
  Library,
  Award,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Percent,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { ragBuildContext, type RAGContext, type SimilarCase } from "../services/rag";

interface CitationPanelProps {
  /** Query to search for similar cases (typically error signature + stack trace) */
  query: string;
  /** Optional component filter */
  component?: string;
  /** Optional severity filter */
  severity?: string;
  /** Callback when a citation is clicked */
  onCitationClick?: (analysisId: number) => void;
  /** Collapse by default */
  defaultCollapsed?: boolean;
}

export function CitationPanel({
  query,
  component,
  severity,
  onCitationClick,
  defaultCollapsed = true,
}: CitationPanelProps) {
  const [context, setContext] = useState<RAGContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    if (!query || query.length < 10) return;

    const fetchContext = async () => {
      setLoading(true);
      setError(null);

      try {
        const ctx = await ragBuildContext(query, { component, severity }, 5);
        setContext(ctx);
        // Auto-expand if we found good matches
        if (ctx.gold_matches.length > 0 || ctx.similar_analyses.length > 0) {
          setCollapsed(false);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to retrieve similar cases");
      } finally {
        setLoading(false);
      }
    };

    fetchContext();
  }, [query, component, severity]);

  const hasResults =
    context && (context.similar_analyses.length > 0 || context.gold_matches.length > 0);

  if (!hasResults && !loading && !error) {
    return null;
  }

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition"
      >
        <div className="flex items-center gap-3">
          <Library className="w-5 h-5 text-blue-400" />
          <span className="font-medium">Similar Historical Cases</span>
          {context && (
            <span className="text-xs text-gray-400">
              {context.gold_matches.length + context.similar_analyses.length} found
            </span>
          )}
          {context?.confidence_boost && context.confidence_boost > 0 && (
            <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
              +{Math.round(context.confidence_boost * 100)}% confidence
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
          {collapsed ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="border-t border-gray-700">
          {loading && !context && (
            <div className="p-4 flex items-center justify-center gap-2 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Searching for similar cases...</span>
            </div>
          )}

          {error && (
            <div className="p-4 flex items-start gap-3 text-red-400">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Failed to retrieve similar cases</p>
                <p className="text-sm text-gray-500 mt-1">{error}</p>
              </div>
            </div>
          )}

          {context && (
            <div className="divide-y divide-gray-700/50">
              {/* Gold Matches - Higher priority */}
              {context.gold_matches.map((match) => (
                <CaseCard
                  key={match.citation_id}
                  case={match}
                  onClick={() => onCitationClick?.(match.analysis_id)}
                />
              ))}

              {/* Similar Analyses */}
              {context.similar_analyses.map((match) => (
                <CaseCard
                  key={match.citation_id}
                  case={match}
                  onClick={() => onCitationClick?.(match.analysis_id)}
                />
              ))}

              {/* Retrieval time */}
              {context.retrieval_time_ms && (
                <div className="px-4 py-2 text-xs text-gray-500 text-right">
                  Retrieved in {context.retrieval_time_ms}ms
                </div>
              )}
            </div>
          )}

          {context && !hasResults && !loading && (
            <div className="p-4 text-center text-gray-500">
              No similar historical cases found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CaseCardProps {
  case: SimilarCase;
  onClick?: () => void;
}

function CaseCard({ case: c, onClick }: CaseCardProps) {
  const scorePercent = Math.round(c.similarity_score * 100);
  const scoreColor =
    scorePercent >= 80
      ? "text-green-400 bg-green-500/10"
      : scorePercent >= 60
      ? "text-yellow-400 bg-yellow-500/10"
      : "text-gray-400 bg-gray-500/10";

  return (
    <div
      className={`p-4 hover:bg-gray-800/30 transition ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Citation ID and badges */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-mono text-gray-400">#{c.citation_id}</span>
            {c.is_gold && (
              <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded">
                <Award className="w-3 h-3" />
                Verified
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded ${scoreColor}`}>
              <Percent className="w-3 h-3 inline mr-1" />
              {scorePercent}% match
            </span>
            {c.component && (
              <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded">
                {c.component}
              </span>
            )}
            {c.severity && (
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  c.severity === "critical"
                    ? "text-red-400 bg-red-500/10"
                    : c.severity === "high"
                    ? "text-orange-400 bg-orange-500/10"
                    : c.severity === "medium"
                    ? "text-yellow-400 bg-yellow-500/10"
                    : "text-blue-400 bg-blue-500/10"
                }`}
              >
                {c.severity}
              </span>
            )}
          </div>

          {/* Root cause */}
          <p className="text-sm text-gray-300 line-clamp-2">{c.root_cause}</p>

          {/* Suggested fixes preview */}
          {c.suggested_fixes.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Resolution:</p>
              <p className="text-sm text-gray-400 line-clamp-1">{c.suggested_fixes[0]}</p>
            </div>
          )}
        </div>

        {/* View button */}
        {onClick && (
          <button className="p-2 hover:bg-gray-700 rounded transition">
            <ExternalLink className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>
    </div>
  );
}

export default CitationPanel;
