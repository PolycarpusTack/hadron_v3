import { useState, useEffect, useCallback } from "react";
import { History, Search, AlertCircle } from "lucide-react";
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
import AnalyticsDashboard from "./AnalyticsDashboard";
import { AnalysisListItem, TranslationListItem } from "./HistoryListItem";

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

  // Memoized handlers to prevent unnecessary re-renders of list items
  const handleDelete = useCallback(async (id: number, filename: string) => {
    if (!confirm(`Delete analysis for "${filename}"?`)) return;

    try {
      await deleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      logger.error('Failed to delete analysis', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to delete analysis");
    }
  }, []);

  const handleView = useCallback(async (id: number) => {
    try {
      const analysis = await getAnalysisById(id);
      onViewAnalysis(analysis);
    } catch (err) {
      logger.error('Failed to load analysis', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to load analysis details");
    }
  }, [onViewAnalysis]);

  const handleToggleFavorite = useCallback(async (id: number) => {
    try {
      const newStatus = await toggleFavorite(id);
      setAnalyses((prev) =>
        prev.map((a) => (a.id === id ? { ...a, is_favorite: newStatus } : a))
      );
    } catch (err) {
      logger.error('Failed to toggle favorite', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to update favorite status");
    }
  }, []);

  const handleDeleteTranslation = useCallback(async (id: number) => {
    if (!confirm(`Delete this translation?`)) return;

    try {
      await deleteTranslation(id);
      setTranslations((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      logger.error('Failed to delete translation', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to delete translation");
    }
  }, []);

  const handleToggleTranslationFavorite = useCallback(async (id: number) => {
    try {
      const newStatus = await toggleTranslationFavorite(id);
      setTranslations((prev) =>
        prev.map((t) => (t.id === id ? { ...t, is_favorite: newStatus } : t))
      );
    } catch (err) {
      logger.error('Failed to toggle favorite', { id, error: err instanceof Error ? err.message : String(err) });
      alert("Failed to update favorite status");
    }
  }, []);

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
          {/* Crash Analyses - using memoized list items */}
          {(currentTab === "all" || currentTab === "analyses") &&
            analyses.map((analysis) => (
              <AnalysisListItem
                key={analysis.id}
                analysis={analysis}
                onView={handleView}
                onDelete={handleDelete}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}

          {/* Translations - using memoized list items */}
          {(currentTab === "all" || currentTab === "translations") &&
            translations.map((translation) => (
              <TranslationListItem
                key={translation.id}
                translation={translation}
                onDelete={handleDeleteTranslation}
                onToggleFavorite={handleToggleTranslationFavorite}
              />
            ))}
        </div>
      )}
    </div>
  );
}
