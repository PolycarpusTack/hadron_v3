/**
 * Sentry Analysis History
 * Shows past Sentry analyses with search and click-through to detail view
 */

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  RefreshCw,
  Clock,
  AlertCircle,
  ChevronRight,
  Zap,
} from "lucide-react";
import { getAnalysesFiltered } from "../../services/api";
import type { Analysis } from "../../services/api";
import { useDebounce } from "../../hooks/useDebounce";
import { formatRelativeTime } from "./sentryHelpers";
import { getSeverityBadgeClasses } from "../../utils/severity";

interface SentryAnalysisHistoryProps {
  onViewAnalysis: (analysis: Analysis) => void;
}

export default function SentryAnalysisHistory({
  onViewAnalysis,
}: SentryAnalysisHistoryProps) {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const debouncedSearch = useDebounce(searchQuery, 300);

  const loadAnalyses = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getAnalysesFiltered({
        analysisTypes: ["sentry"],
        search: debouncedSearch || undefined,
        sortBy: "date",
        sortOrder: "desc",
        limit: 50,
        offset: 0,
      });
      setAnalyses(result.items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    loadAnalyses();
  }, [loadAnalyses]);

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search past analyses..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
        <button
          onClick={loadAnalyses}
          disabled={loading}
          className="p-1.5 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && analyses.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 text-orange-400 animate-spin" />
          <span className="ml-2 text-gray-400">Loading analyses...</span>
        </div>
      )}

      {/* Empty */}
      {!loading && analyses.length === 0 && !error && (
        <div className="text-center py-12 text-gray-500">
          <Clock className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No Sentry analyses yet</p>
          <p className="text-xs mt-1">
            Analyze an issue from the Browse or Import tab to see it here
          </p>
        </div>
      )}

      {/* Analysis List */}
      {analyses.length > 0 && (
        <div className="space-y-1">
          {analyses.map((analysis) => (
            <button
              key={analysis.id}
              onClick={() => onViewAnalysis(analysis)}
              className="w-full bg-gray-800/50 rounded-lg border border-gray-700 hover:border-gray-600 transition px-4 py-3 flex items-center gap-3 text-left"
            >
              <Zap className="w-4 h-4 text-orange-400 flex-shrink-0" />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {analysis.filename}
                </p>
                {analysis.error_type && (
                  <p className="text-xs text-gray-500 truncate">
                    {analysis.error_type}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${getSeverityBadgeClasses(
                    analysis.severity
                  )}`}
                >
                  {analysis.severity}
                </span>

                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatRelativeTime(analysis.analyzed_at)}
                </span>

                {analysis.ai_model && (
                  <span className="text-gray-600">{analysis.ai_model}</span>
                )}

                <ChevronRight className="w-4 h-4 text-gray-600" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
