import { useState, useEffect } from "react";
import { History, Search, Trash2, Eye, AlertCircle, Star, Languages } from "lucide-react";
import {
  getAllAnalyses,
  deleteAnalysis,
  getAnalysisById,
  searchAnalyses,
  toggleFavorite,
  getAllTranslations,
  deleteTranslation,
  toggleTranslationFavorite,
  getDatabaseStatistics
} from "../services/api";
import { useDebounce } from "../hooks/useDebounce";
import logger from "../services/logger";
import type { Analysis, Translation, DatabaseStatistics } from "../services/api";
import { format } from "date-fns";
import AnalyticsDashboard from "./AnalyticsDashboard";

interface HistoryViewProps {
  onViewAnalysis: (analysis: Analysis) => void;
}

export default function HistoryView({ onViewAnalysis }: HistoryViewProps) {
  const [currentTab, setCurrentTab] = useState<"analyses" | "translations" | "all">("all");
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<DatabaseStatistics | null>(null);

  // Debounce search term for better performance
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Load data based on current tab
  useEffect(() => {
    loadData();
  }, [currentTab, debouncedSearchTerm, severityFilter]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load database statistics
      const stats = await getDatabaseStatistics();
      setStatistics(stats);

      // Load analyses if needed
      if (currentTab === "analyses" || currentTab === "all") {
        const data = debouncedSearchTerm
          ? await searchAnalyses(
              debouncedSearchTerm,
              severityFilter !== "all" ? severityFilter.toUpperCase() : undefined
            )
          : await getAllAnalyses();

        const filtered =
          !debouncedSearchTerm && severityFilter !== "all"
            ? data.filter((a) => a.severity.toLowerCase() === severityFilter.toLowerCase())
            : data;

        setAnalyses(filtered);
      }

      // Load translations if needed
      if (currentTab === "translations" || currentTab === "all") {
        const data = await getAllTranslations();

        // Apply search filter on translations (client-side)
        const filtered = debouncedSearchTerm
          ? data.filter((t) =>
              t.input_content.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
              t.translation.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
            )
          : data;

        setTranslations(filtered);
      }
    } catch (err) {
      logger.error('Failed to load history', { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number, filename: string) => {
    if (!confirm(`Delete analysis for "${filename}"?`)) return;

    try {
      await deleteAnalysis(id);
      setAnalyses(analyses.filter((a) => a.id !== id));
    } catch (err) {
      logger.error('Failed to delete analysis', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to delete analysis");
    }
  };

  const handleView = async (id: number) => {
    try {
      const analysis = await getAnalysisById(id);
      onViewAnalysis(analysis);
    } catch (err) {
      logger.error('Failed to load analysis', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to load analysis details");
    }
  };

  const handleToggleFavorite = async (id: number) => {
    try {
      const newStatus = await toggleFavorite(id);
      // Update local state
      setAnalyses(
        analyses.map((a) => (a.id === id ? { ...a, is_favorite: newStatus } : a))
      );
    } catch (err) {
      logger.error('Failed to toggle favorite', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to update favorite status");
    }
  };

  const handleDeleteTranslation = async (id: number) => {
    if (!confirm(`Delete this translation?`)) return;

    try {
      await deleteTranslation(id);
      setTranslations(translations.filter((t) => t.id !== id));
    } catch (err) {
      logger.error('Failed to delete translation', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to delete translation");
    }
  };

  const handleToggleTranslationFavorite = async (id: number) => {
    try {
      const newStatus = await toggleTranslationFavorite(id);
      // Update local state
      setTranslations(
        translations.map((t) => (t.id === id ? { ...t, is_favorite: newStatus } : t))
      );
    } catch (err) {
      logger.error('Failed to toggle favorite', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to update favorite status");
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "high":
        return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      case "medium":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "low":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-gray-400">Loading history...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-lg">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-blue-400" />
          <h2 className="text-2xl font-bold">History</h2>
        </div>
      </div>

      {/* Analytics Dashboard */}
      {statistics && <AnalyticsDashboard statistics={statistics} />}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-700">
        <button
          onClick={() => setCurrentTab("all")}
          className={`px-4 py-2 border-b-2 transition ${
            currentTab === "all"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-gray-400 hover:text-gray-300"
          }`}
        >
          All ({analyses.length + translations.length})
        </button>
        <button
          onClick={() => setCurrentTab("analyses")}
          className={`px-4 py-2 border-b-2 transition ${
            currentTab === "analyses"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-gray-400 hover:text-gray-300"
          }`}
        >
          Crash Analyses ({analyses.length})
        </button>
        <button
          onClick={() => setCurrentTab("translations")}
          className={`px-4 py-2 border-b-2 transition ${
            currentTab === "translations"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-gray-400 hover:text-gray-300"
          }`}
        >
          Translations ({translations.length})
        </button>
      </div>

      {/* Search and Filters */}
      <div className="space-y-3">
        <div className="flex gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder={
                currentTab === "translations"
                  ? "Search translations..."
                  : currentTab === "analyses"
                  ? "Search by filename, error type, or cause..."
                  : "Search analyses and translations..."
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Severity Filter Dropdown - only show for analyses */}
          {currentTab !== "translations" && (
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          )}
        </div>

        {/* Quick Severity Filter Pills */}
        {currentTab !== "translations" && (
          <div className="flex gap-2 items-center">
            <span className="text-sm text-gray-400">Quick filters:</span>
            <button
              onClick={() => setSeverityFilter("all")}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                severityFilter === "all"
                  ? "bg-gray-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSeverityFilter("critical")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                severityFilter === "critical"
                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-red-500/30"
              }`}
            >
              Critical
            </button>
            <button
              onClick={() => setSeverityFilter("high")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                severityFilter === "high"
                  ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-orange-500/30"
              }`}
            >
              High
            </button>
            <button
              onClick={() => setSeverityFilter("medium")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                severityFilter === "medium"
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-yellow-500/30"
              }`}
            >
              Medium
            </button>
            <button
              onClick={() => setSeverityFilter("low")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                severityFilter === "low"
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-blue-500/30"
              }`}
            >
              Low
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      {analyses.length === 0 && translations.length === 0 ? (
        <div className="text-center p-12 bg-gray-800/50 rounded-lg border border-gray-700">
          <History className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">
            {searchTerm || severityFilter !== "all"
              ? "No items match your filters"
              : "No history yet. Start by analyzing a crash log or translating technical content!"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Crash Analyses */}
          {(currentTab === "all" || currentTab === "analyses") && analyses.map((analysis) => (
            <div
              key={analysis.id}
              className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: File info and severity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg truncate">{analysis.filename}</h3>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${getSeverityColor(
                        analysis.severity
                      )}`}
                    >
                      {analysis.severity.toUpperCase()}
                    </span>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        analysis.analysis_type === "specialized"
                          ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                          : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                      }`}
                    >
                      {analysis.analysis_type === "specialized" ? "SPECIALIZED" : "COMPLETE"}
                    </span>
                  </div>

                  <div className="space-y-1 text-sm text-gray-400">
                    <div>
                      <span className="font-semibold">Error:</span> {analysis.error_type}
                      {analysis.component && (
                        <span className="ml-2 text-blue-400 font-mono">({analysis.component})</span>
                      )}
                    </div>
                    <div className="line-clamp-2">
                      <span className="font-semibold">Cause:</span> {analysis.root_cause}
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                      <span>{format(new Date(analysis.analyzed_at), "MMM d, yyyy 'at' h:mm a")}</span>
                      <span>•</span>
                      <span>{analysis.file_size_kb.toFixed(1)} KB</span>
                      <span>•</span>
                      <span>${analysis.cost.toFixed(4)}</span>
                      {analysis.was_truncated && (
                        <>
                          <span>•</span>
                          <span className="text-yellow-400">Truncated</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleFavorite(analysis.id)}
                    className={`p-2 hover:bg-gray-700 rounded-lg transition ${
                      analysis.is_favorite ? "text-yellow-400" : "text-gray-400"
                    }`}
                    title={analysis.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
                  >
                    <Star
                      className="w-5 h-5"
                      fill={analysis.is_favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    onClick={() => handleView(analysis.id)}
                    className="p-2 hover:bg-gray-700 rounded-lg transition"
                    title="View Details"
                  >
                    <Eye className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(analysis.id, analysis.filename)}
                    className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Translations */}
          {(currentTab === "all" || currentTab === "translations") && translations.map((translation) => (
            <div
              key={translation.id}
              className="bg-gray-800/50 border border-blue-700/30 rounded-lg p-4 hover:border-blue-600/50 transition"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: Translation content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <Languages className="w-5 h-5 text-blue-400" />
                    <h3 className="font-semibold text-lg text-blue-400">Translation</h3>
                  </div>

                  <div className="space-y-3 text-sm text-gray-300">
                    <div className="bg-gray-900/50 p-3 rounded">
                      <span className="font-semibold text-gray-400">Input:</span>
                      <p className="mt-1 line-clamp-2 font-mono text-xs">
                        {translation.input_content}
                      </p>
                    </div>
                    <div className="bg-blue-900/10 p-3 rounded">
                      <span className="font-semibold text-blue-400">Translation:</span>
                      <p className="mt-1 line-clamp-3">
                        {translation.translation}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-gray-400 text-xs">
                      <span>{format(new Date(translation.translated_at), "MMM d, yyyy 'at' h:mm a")}</span>
                      <span>•</span>
                      <span>{translation.ai_provider}</span>
                      <span>•</span>
                      <span>{translation.ai_model}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleTranslationFavorite(translation.id)}
                    className={`p-2 hover:bg-gray-700 rounded-lg transition ${
                      translation.is_favorite ? "text-yellow-400" : "text-gray-400"
                    }`}
                    title={translation.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
                  >
                    <Star
                      className="w-5 h-5"
                      fill={translation.is_favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    onClick={() => handleDeleteTranslation(translation.id)}
                    className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
