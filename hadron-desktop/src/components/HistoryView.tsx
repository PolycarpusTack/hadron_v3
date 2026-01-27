import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { History, Search, AlertCircle, SlidersHorizontal, X, CheckSquare } from "lucide-react";
import {
  getAllAnalyses,
  deleteAnalysis,
  getAnalysisById,
  searchAnalyses,
  toggleFavorite,
  getAllTranslations,
  deleteTranslation,
  toggleTranslationFavorite,
  getDatabaseStatistics,
  getAllTags,
  getAnalysesFiltered,
  bulkDeleteAnalyses,
  bulkDeleteTranslations,
  bulkAddTagToAnalyses,
  bulkRemoveTagFromAnalyses,
  bulkSetFavoriteAnalyses,
  bulkSetFavoriteTranslations,
  autoTagAnalyses,
  countAnalysesWithoutTags,
  getGoldAnalyses,
} from "../services/api";
import { useDebounce } from "../hooks/useDebounce";
import logger from "../services/logger";
import type { Analysis, Translation, DatabaseStatistics } from "../services/api";
import type { HistoryFilters, Tag } from "../types";
import { DEFAULT_HISTORY_FILTERS, filtersToApiOptions } from "../types";
import AnalyticsDashboard from "./AnalyticsDashboard";
import { AnalysisListItem, TranslationListItem } from "./HistoryListItem";
import { SmartList } from "./VirtualizedList";
import { useToast } from "./Toast";
import { AdvancedFilterPanel } from "./AdvancedFilterPanel";
import { BulkActionBar, SelectionType } from "./BulkActionBar";

// localStorage key for filter persistence
const FILTER_STORAGE_KEY = "hadron_history_filters";

interface HistoryViewProps {
  onViewAnalysis: (analysis: Analysis) => void;
}

// Load saved filters from localStorage
const loadSavedFilters = (): HistoryFilters => {
  try {
    const saved = localStorage.getItem(FILTER_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Deep merge with defaults to ensure all fields are present
      return {
        ...DEFAULT_HISTORY_FILTERS,
        ...parsed,
        dateRange: { ...DEFAULT_HISTORY_FILTERS.dateRange, ...parsed.dateRange },
        tags: { ...DEFAULT_HISTORY_FILTERS.tags, ...parsed.tags },
        cost: { ...DEFAULT_HISTORY_FILTERS.cost, ...parsed.cost },
      };
    }
  } catch (e) {
    logger.warn("Failed to load saved filters", { error: e });
  }
  return DEFAULT_HISTORY_FILTERS;
};

export default function HistoryView({ onViewAnalysis }: HistoryViewProps) {
  const [currentTab, setCurrentTab] = useState<"analyses" | "translations" | "all" | "favorites">("all");
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [filters, setFilters] = useState<HistoryFilters>(loadSavedFilters);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<DatabaseStatistics | null>(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const toast = useToast();
  const [autoTagCount, setAutoTagCount] = useState<number | null>(null);
  const [autoTagging, setAutoTagging] = useState(false);
  const [tagRefreshKey, setTagRefreshKey] = useState(0);
  const [goldStatusByAnalysisId, setGoldStatusByAnalysisId] = useState<Record<number, string>>({});

  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<Set<number>>(new Set());
  const [selectedTranslationIds, setSelectedTranslationIds] = useState<Set<number>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const lastSelectedAnalysisId = useRef<number | null>(null);
  const lastSelectedTranslationId = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search term for better performance
  const debouncedSearchTerm = useDebounce(filters.search, 300);

  // Debounce filter changes to prevent excessive API calls
  // Create a stable string representation for comparison
  const filterKey = useMemo(() => JSON.stringify({
    severities: filters.severities,
    analysisTypes: filters.analysisTypes,
    analysisModes: filters.analysisModes,
    tags: filters.tags,
    dateRange: filters.dateRange,
    cost: filters.cost,
    showArchived: filters.showArchived,
    favoritesOnly: filters.favoritesOnly,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  }), [filters.severities, filters.analysisTypes, filters.analysisModes,
      filters.tags, filters.dateRange, filters.cost, filters.showArchived,
      filters.favoritesOnly, filters.sortBy, filters.sortOrder]);

  const debouncedFilterKey = useDebounce(filterKey, 300);

  // Persist filters to localStorage (excluding search)
  useEffect(() => {
    const toSave = { ...filters, search: "" };
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(toSave));
  }, [filters]);

  // Load tags on mount
  useEffect(() => {
    getAllTags()
      .then(setAvailableTags)
      .catch((err) => logger.warn("Failed to load tags", { error: err }));
  }, []);

  // Count active filters for badge display
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.severities.length > 0) count++;
    if (filters.analysisTypes.length > 0) count++;
    if (filters.analysisModes.length > 0) count++;
    if (filters.tags.tagIds.length > 0) count++;
    if (filters.dateRange.preset !== "allTime") count++;
    if (filters.cost.min !== undefined || filters.cost.max !== undefined) count++;
    if (filters.showArchived) count++;
    if (filters.favoritesOnly) count++;
    return count;
  }, [filters]);

  // Load data based on current tab and filters
  // Uses debounced filter key to prevent excessive API calls when rapidly changing filters
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab, debouncedSearchTerm, debouncedFilterKey]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load database statistics
      const stats = await getDatabaseStatistics();
      setStatistics(stats);

      // Load auto-tag preview count
      try {
        const count = await countAnalysesWithoutTags();
        setAutoTagCount(count);
      } catch (countErr) {
        logger.warn("Failed to load auto-tag count", { error: countErr });
        setAutoTagCount(null);
      }

      // Load gold statuses
      let goldStatusMap = goldStatusByAnalysisId;
      try {
        const goldAnalyses = await getGoldAnalyses();
        const statusMap: Record<number, string> = {};
        for (const gold of goldAnalyses) {
          if (gold.sourceAnalysisId) {
            statusMap[gold.sourceAnalysisId] = gold.validationStatus;
          }
        }
        goldStatusMap = statusMap;
        setGoldStatusByAnalysisId(statusMap);
      } catch (goldErr) {
        logger.warn("Failed to load gold statuses", { error: goldErr });
      }

      // Load analyses if needed
      if (currentTab === "analyses" || currentTab === "all" || currentTab === "favorites") {
        // Use advanced filtering API
        const goldOnly = filters.analysisTypes.includes("gold");
        const analysisTypesForApi = filters.analysisTypes.filter((t) => t !== "gold");
        const filtersForApi = {
          ...filters,
          analysisTypes: analysisTypesForApi,
          search: debouncedSearchTerm,
          favoritesOnly: currentTab === "favorites" ? true : filters.favoritesOnly,
        };
        const apiOptions = filtersToApiOptions(filtersForApi);

        try {
          const result = await getAnalysesFiltered(apiOptions);
          const filteredItems = goldOnly
            ? result.items.filter((a) => goldStatusMap[a.id])
            : result.items;
          setAnalyses(filteredItems);
        } catch (filterErr) {
          // Fallback to basic search if advanced filter fails
          logger.warn("Advanced filter failed, falling back to basic search", { error: filterErr });
          const data = debouncedSearchTerm
            ? await searchAnalyses(
                debouncedSearchTerm,
                filters.severities.length === 1 ? filters.severities[0].toUpperCase() : undefined
              )
            : await getAllAnalyses();

          // Apply basic client-side filtering as fallback
          let filtered = data;
          if (goldOnly) {
            filtered = filtered.filter((a) => goldStatusMap[a.id]);
          }
          if (filters.severities.length > 0) {
            filtered = filtered.filter((a) =>
              filters.severities.includes(a.severity.toLowerCase())
            );
          }
          if (currentTab === "favorites" || filters.favoritesOnly) {
            filtered = filtered.filter((a) => a.is_favorite);
          }
          setAnalyses(filtered);
        }
      }

      // Load translations if needed (also in favorites tab)
      if (currentTab === "translations" || currentTab === "all" || currentTab === "favorites") {
        const data = await getAllTranslations();

        // Apply search filter on translations (client-side)
        let filtered = data;
        if (debouncedSearchTerm) {
          filtered = filtered.filter((t) =>
            t.input_content.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
            t.translation.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
          );
        }
        if (currentTab === "favorites" || filters.favoritesOnly) {
          filtered = filtered.filter((t) => t.is_favorite);
        }

        setTranslations(filtered);
      }
    } catch (err) {
      logger.error('Failed to load history', { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  // Update filters helper
  const updateFilters = useCallback((updates: Partial<HistoryFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  // Reset all filters
  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_HISTORY_FILTERS);
  }, []);

  // Toggle severity filter
  const toggleSeverity = useCallback((severity: string) => {
    setFilters((prev) => {
      const severities = prev.severities.includes(severity)
        ? prev.severities.filter((s) => s !== severity)
        : [...prev.severities, severity];
      return { ...prev, severities };
    });
  }, []);

  // Toggle analysis type filter
  const toggleAnalysisType = useCallback((type: string) => {
    setFilters((prev) => {
      const analysisTypes = prev.analysisTypes.includes(type)
        ? prev.analysisTypes.filter((t) => t !== type)
        : [...prev.analysisTypes, type];
      return { ...prev, analysisTypes };
    });
  }, []);

  // Memoized handlers to prevent unnecessary re-renders of list items
  const handleDelete = useCallback(async (id: number, filename: string) => {
    if (!confirm(`Delete analysis for "${filename}"?`)) return;

    try {
      await deleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      toast.success("Analysis deleted");
    } catch (err) {
      logger.error('Failed to delete analysis', { id, error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to delete analysis");
    }
  }, [toast]);

  const handleView = useCallback(async (id: number) => {
    try {
      const analysis = await getAnalysisById(id);
      onViewAnalysis(analysis);
    } catch (err) {
      logger.error('Failed to load analysis', { id, error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to load analysis details");
    }
  }, [onViewAnalysis, toast]);

  const handleToggleFavorite = useCallback(async (id: number) => {
    try {
      const newStatus = await toggleFavorite(id);
      setAnalyses((prev) =>
        prev.map((a) => (a.id === id ? { ...a, is_favorite: newStatus } : a))
      );
      toast.success(newStatus ? "Added to favorites" : "Removed from favorites");
    } catch (err) {
      logger.error('Failed to toggle favorite', { id, error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to update favorite status");
    }
  }, [toast]);

  const handleDeleteTranslation = useCallback(async (id: number) => {
    if (!confirm(`Delete this translation?`)) return;

    try {
      await deleteTranslation(id);
      setTranslations((prev) => prev.filter((t) => t.id !== id));
      toast.success("Translation deleted");
    } catch (err) {
      logger.error('Failed to delete translation', { id, error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to delete translation");
    }
  }, [toast]);

  const handleToggleTranslationFavorite = useCallback(async (id: number) => {
    try {
      const newStatus = await toggleTranslationFavorite(id);
      setTranslations((prev) =>
        prev.map((t) => (t.id === id ? { ...t, is_favorite: newStatus } : t))
      );
      toast.success(newStatus ? "Added to favorites" : "Removed from favorites");
    } catch (err) {
      logger.error('Failed to toggle favorite', { id, error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to update favorite status");
    }
  }, [toast]);

  // =========================================================================
  // Selection Mode Handlers
  // =========================================================================

  // Toggle selection mode
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode - clear selections
        setSelectedAnalysisIds(new Set());
        setSelectedTranslationIds(new Set());
        lastSelectedAnalysisId.current = null;
        lastSelectedTranslationId.current = null;
      }
      return !prev;
    });
  }, []);

  // Handle analysis selection with shift+click range support
  const handleSelectAnalysis = useCallback((id: number, shiftKey: boolean) => {
    setSelectedAnalysisIds((prev) => {
      const newSet = new Set(prev);

      if (shiftKey && lastSelectedAnalysisId.current !== null) {
        // Range selection
        const lastIdx = analyses.findIndex((a) => a.id === lastSelectedAnalysisId.current);
        const currentIdx = analyses.findIndex((a) => a.id === id);
        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          for (let i = start; i <= end; i++) {
            newSet.add(analyses[i].id);
          }
        }
      } else {
        // Toggle single selection
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
      }

      lastSelectedAnalysisId.current = id;
      return newSet;
    });
  }, [analyses]);

  // Handle translation selection with shift+click range support
  const handleSelectTranslation = useCallback((id: number, shiftKey: boolean) => {
    setSelectedTranslationIds((prev) => {
      const newSet = new Set(prev);

      if (shiftKey && lastSelectedTranslationId.current !== null) {
        // Range selection
        const lastIdx = translations.findIndex((t) => t.id === lastSelectedTranslationId.current);
        const currentIdx = translations.findIndex((t) => t.id === id);
        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          for (let i = start; i <= end; i++) {
            newSet.add(translations[i].id);
          }
        }
      } else {
        // Toggle single selection
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
      }

      lastSelectedTranslationId.current = id;
      return newSet;
    });
  }, [translations]);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedAnalysisIds(new Set());
    setSelectedTranslationIds(new Set());
    lastSelectedAnalysisId.current = null;
    lastSelectedTranslationId.current = null;
  }, []);

  // Compute selection type
  const selectionType: SelectionType = useMemo(() => {
    const hasAnalyses = selectedAnalysisIds.size > 0;
    const hasTranslations = selectedTranslationIds.size > 0;
    if (hasAnalyses && hasTranslations) return "mixed";
    if (hasTranslations) return "translation";
    return "analysis";
  }, [selectedAnalysisIds.size, selectedTranslationIds.size]);

  // Total selected count
  const selectedCount = selectedAnalysisIds.size + selectedTranslationIds.size;

  // =========================================================================
  // Bulk Operation Handlers
  // =========================================================================

  const handleBulkDelete = useCallback(async () => {
    const analysisCount = selectedAnalysisIds.size;
    const translationCount = selectedTranslationIds.size;
    const total = analysisCount + translationCount;

    if (!confirm(`Delete ${total} selected item${total > 1 ? "s" : ""}?`)) return;

    setBulkProcessing(true);
    try {
      let deletedCount = 0;

      if (analysisCount > 0) {
        const result = await bulkDeleteAnalyses(Array.from(selectedAnalysisIds));
        deletedCount += result.successCount;
        setAnalyses((prev) => prev.filter((a) => !selectedAnalysisIds.has(a.id)));
      }

      if (translationCount > 0) {
        const result = await bulkDeleteTranslations(Array.from(selectedTranslationIds));
        deletedCount += result.successCount;
        setTranslations((prev) => prev.filter((t) => !selectedTranslationIds.has(t.id)));
      }

      toast.success(`Deleted ${deletedCount} item${deletedCount > 1 ? "s" : ""}`);
      clearSelection();
      setSelectionMode(false);
    } catch (err) {
      logger.error("Bulk delete failed", { error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to delete some items");
    } finally {
      setBulkProcessing(false);
    }
  }, [selectedAnalysisIds, selectedTranslationIds, toast, clearSelection]);

  const handleBulkFavorite = useCallback(async (favorite: boolean) => {
    setBulkProcessing(true);
    try {
      let updatedCount = 0;

      if (selectedAnalysisIds.size > 0) {
        const result = await bulkSetFavoriteAnalyses(Array.from(selectedAnalysisIds), favorite);
        updatedCount += result.successCount;
        setAnalyses((prev) =>
          prev.map((a) =>
            selectedAnalysisIds.has(a.id) ? { ...a, is_favorite: favorite } : a
          )
        );
      }

      if (selectedTranslationIds.size > 0) {
        const result = await bulkSetFavoriteTranslations(Array.from(selectedTranslationIds), favorite);
        updatedCount += result.successCount;
        setTranslations((prev) =>
          prev.map((t) =>
            selectedTranslationIds.has(t.id) ? { ...t, is_favorite: favorite } : t
          )
        );
      }

      toast.success(
        favorite
          ? `Added ${updatedCount} item${updatedCount > 1 ? "s" : ""} to favorites`
          : `Removed ${updatedCount} item${updatedCount > 1 ? "s" : ""} from favorites`
      );
      clearSelection();
      setSelectionMode(false);
    } catch (err) {
      logger.error("Bulk favorite failed", { error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to update some items");
    } finally {
      setBulkProcessing(false);
    }
  }, [selectedAnalysisIds, selectedTranslationIds, toast, clearSelection]);

  const handleBulkAddTag = useCallback(async (tagId: number) => {
    if (selectedAnalysisIds.size === 0) {
      toast.error("Tags can only be added to analyses");
      return;
    }

    setBulkProcessing(true);
    try {
      const result = await bulkAddTagToAnalyses(Array.from(selectedAnalysisIds), tagId);
      toast.success(`Added tag to ${result.successCount} analysis(es)`);
      // Note: tags are managed by TagPicker, so we don't update local state
    } catch (err) {
      logger.error("Bulk add tag failed", { error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to add tag to some items");
    } finally {
      setBulkProcessing(false);
    }
  }, [selectedAnalysisIds, toast]);

  const handleBulkRemoveTag = useCallback(async (tagId: number) => {
    if (selectedAnalysisIds.size === 0) {
      toast.error("Tags can only be removed from analyses");
      return;
    }

    setBulkProcessing(true);
    try {
      const result = await bulkRemoveTagFromAnalyses(Array.from(selectedAnalysisIds), tagId);
      toast.success(`Removed tag from ${result.successCount} analysis(es)`);
      // Note: tags are managed by TagPicker, so we don't update local state
    } catch (err) {
      logger.error("Bulk remove tag failed", { error: err instanceof Error ? err.message : String(err) });
      toast.error("Failed to remove tag from some items");
    } finally {
      setBulkProcessing(false);
    }
  }, [selectedAnalysisIds, toast]);

  // Bulk export selected analyses to CSV
  const handleBulkExport = useCallback(() => {
    const selectedAnalysesList = analyses.filter((a) => selectedAnalysisIds.has(a.id));
    const selectedTranslationsList = translations.filter((t) => selectedTranslationIds.has(t.id));

    if (selectedAnalysesList.length === 0 && selectedTranslationsList.length === 0) {
      toast.error("No items selected for export");
      return;
    }

    // Build CSV content
    const csvRows: string[] = [];

    // Add analyses
    if (selectedAnalysesList.length > 0) {
      csvRows.push("Type,ID,Filename,Error Type,Severity,Component,Root Cause,Date,Cost");
      for (const a of selectedAnalysesList) {
        const escapedRootCause = (a.root_cause || "").replace(/"/g, '""').replace(/\n/g, " ");
        csvRows.push([
          "Analysis",
          a.id,
          `"${a.filename}"`,
          `"${a.error_type}"`,
          a.severity,
          `"${a.component || ""}"`,
          `"${escapedRootCause}"`,
          a.analyzed_at,
          a.cost?.toFixed(4) || "0",
        ].join(","));
      }
    }

    // Add translations if any selected
    if (selectedTranslationsList.length > 0) {
      if (csvRows.length > 0) csvRows.push(""); // Empty line separator
      csvRows.push("Type,ID,Input Preview,Translation Preview,Date");
      for (const t of selectedTranslationsList) {
        const inputPreview = t.input_content.substring(0, 100).replace(/"/g, '""').replace(/\n/g, " ");
        const translationPreview = t.translation.substring(0, 100).replace(/"/g, '""').replace(/\n/g, " ");
        csvRows.push([
          "Translation",
          t.id,
          `"${inputPreview}..."`,
          `"${translationPreview}..."`,
          t.translated_at,
        ].join(","));
      }
    }

    // Download CSV
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hadron-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${selectedAnalysesList.length + selectedTranslationsList.length} item(s) to CSV`);
  }, [analyses, translations, selectedAnalysisIds, selectedTranslationIds, toast]);

  const handleAutoTag = useCallback(async () => {
    setAutoTagging(true);
    try {
      const result = await autoTagAnalyses(null);
      toast.success(
        `Auto-tagging complete: ${result.tagged} tagged, ${result.skipped} skipped, ${result.failed} failed`
      );
      setAutoTagCount(0);
      setTagRefreshKey((prev) => prev + 1);
      // Refresh tags list for filter UI
      getAllTags().then(setAvailableTags).catch(() => undefined);
    } catch (err) {
      logger.error("Auto-tagging failed", { error: err instanceof Error ? err.message : String(err) });
      toast.error("Auto-tagging failed");
    } finally {
      setAutoTagging(false);
    }
  }, [toast]);

  const handleShowTaggedOnly = useCallback(() => {
    if (availableTags.length === 0) return;
    const tagIds = availableTags.map((t) => t.id);
    setFilters((prev) => ({
      ...prev,
      tags: { ...prev.tags, tagIds, mode: "any" },
    }));
  }, [availableTags]);

  // Keyboard shortcuts for history view
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;
      const target = event.target as HTMLElement;
      const isInputFocused = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // "/" - Focus search (only when not in an input)
      if (event.key === "/" && !isInputFocused) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }

      // Ctrl+Shift+F - Toggle advanced filters
      if (isCtrl && isShift && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setAdvancedFiltersOpen((prev) => !prev);
      }

      // Escape - Clear selection or close panel
      if (event.key === "Escape") {
        if (advancedFiltersOpen) {
          setAdvancedFiltersOpen(false);
        } else if (selectionMode) {
          clearSelection();
          setSelectionMode(false);
        }
      }

      // Delete - Delete selected items (when not in an input)
      if (event.key === "Delete" && !isInputFocused && selectionMode && selectedCount > 0) {
        event.preventDefault();
        handleBulkDelete();
      }

      // Ctrl+A - Select all visible (when in selection mode and not in an input)
      if (isCtrl && event.key.toLowerCase() === "a" && selectionMode && !isInputFocused) {
        event.preventDefault();
        // Select all visible analyses and translations
        if (currentTab === "analyses" || currentTab === "all" || currentTab === "favorites") {
          setSelectedAnalysisIds(new Set(analyses.map((a) => a.id)));
        }
        if (currentTab === "translations" || currentTab === "all" || currentTab === "favorites") {
          setSelectedTranslationIds(new Set(translations.map((t) => t.id)));
        }
      }

      // Ctrl+E - Export (when items are selected)
      if (isCtrl && event.key.toLowerCase() === "e" && !isInputFocused) {
        event.preventDefault();
        if (selectedCount > 0) {
          handleBulkExport();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [advancedFiltersOpen, selectionMode, selectedCount, currentTab, analyses, translations, clearSelection, handleBulkDelete, handleBulkExport]);

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
          <span className="p-2 bg-amber-500/20 rounded-lg">
            <History className="w-6 h-6 text-amber-400" />
          </span>
          <div>
            <h2 className="text-2xl font-bold">History</h2>
            <p className="text-sm text-gray-400">Browse and manage your analysis history</p>
          </div>
        </div>
        <button
          onClick={toggleSelectionMode}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition ${
            selectionMode
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
          }`}
          title={selectionMode ? "Exit selection mode" : "Enter selection mode"}
        >
          <CheckSquare className="w-4 h-4" />
          <span className="text-sm">{selectionMode ? "Cancel Selection" : "Select"}</span>
        </button>
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
        <button
          onClick={() => setCurrentTab("favorites")}
          className={`px-4 py-2 border-b-2 transition flex items-center gap-1.5 ${
            currentTab === "favorites"
              ? "border-yellow-500 text-yellow-400"
              : "border-transparent text-gray-400 hover:text-gray-300"
          }`}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          Favorites ({statistics?.favorite_count || 0})
        </button>
      </div>

      {/* Search and Filters */}
      <div className="space-y-3">
        {autoTagCount !== null && autoTagCount > 0 && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-200">
                {autoTagCount} analysis{autoTagCount === 1 ? "" : "es"} without tags
              </p>
              <p className="text-sm text-gray-400">
                Auto-tag your history with severity, type, and pattern-based tags.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAutoTag}
                disabled={autoTagging}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition text-sm"
              >
                {autoTagging ? "Tagging..." : "Auto-tag History"}
              </button>
              {availableTags.length > 0 && (
                <button
                  onClick={handleShowTaggedOnly}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition text-sm"
                >
                  Show Tagged Only
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={
                currentTab === "translations"
                  ? "Search translations... (Press / to focus)"
                  : currentTab === "analyses"
                  ? "Search by filename, error type, or cause... (Press / to focus)"
                  : "Search analyses and translations... (Press / to focus)"
              }
              value={filters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Advanced Filters Button */}
          {currentTab !== "translations" && (
            <div className="relative">
              <button
                onClick={() => setAdvancedFiltersOpen(!advancedFiltersOpen)}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg transition border ${
                  advancedFiltersOpen || activeFilterCount > 0
                    ? "bg-blue-600/20 border-blue-500 text-blue-400"
                    : "bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700"
                }`}
              >
                <SlidersHorizontal className="w-5 h-5" />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {/* Advanced Filter Panel */}
              <AdvancedFilterPanel
                filters={filters}
                availableTags={availableTags}
                onChange={updateFilters}
                onReset={resetFilters}
                isOpen={advancedFiltersOpen}
                onClose={() => setAdvancedFiltersOpen(false)}
              />
            </div>
          )}
        </div>

        {/* Quick Severity Filter Pills */}
        {currentTab !== "translations" && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-400">Severity:</span>
            <button
              onClick={() => updateFilters({ severities: [] })}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                filters.severities.length === 0
                  ? "bg-gray-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              All
            </button>
            <button
              onClick={() => toggleSeverity("critical")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.severities.includes("critical")
                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-red-500/30"
              }`}
            >
              Critical
            </button>
            <button
              onClick={() => toggleSeverity("high")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.severities.includes("high")
                  ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-orange-500/30"
              }`}
            >
              High
            </button>
            <button
              onClick={() => toggleSeverity("medium")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.severities.includes("medium")
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-yellow-500/30"
              }`}
            >
              Medium
            </button>
            <button
              onClick={() => toggleSeverity("low")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.severities.includes("low")
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-blue-500/30"
              }`}
            >
              Low
            </button>

            {/* Separator */}
            <span className="w-px h-5 bg-gray-600 mx-1" />

            {/* Type Filter Pills */}
            <span className="text-sm text-gray-400">Type:</span>
            <button
              onClick={() => {
                // Toggle both comprehensive and whatson (legacy) for backward compatibility
                toggleAnalysisType("comprehensive");
                if (!filters.analysisTypes.includes("comprehensive")) {
                  // Adding - also add whatson
                  if (!filters.analysisTypes.includes("whatson")) {
                    toggleAnalysisType("whatson");
                  }
                }
              }}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.analysisTypes.includes("comprehensive") || filters.analysisTypes.includes("whatson")
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-emerald-500/30"
              }`}
            >
              Comprehensive
            </button>
            <button
              onClick={() => toggleAnalysisType("quick")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.analysisTypes.includes("quick")
                  ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-cyan-500/30"
              }`}
            >
              Quick
            </button>
            <button
              onClick={() => toggleAnalysisType("gold")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.analysisTypes.includes("gold")
                  ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-yellow-500/30"
              }`}
            >
              Gold Only
            </button>
            <button
              onClick={() => toggleAnalysisType("performance")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.analysisTypes.includes("performance")
                  ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-orange-500/30"
              }`}
            >
              Performance
            </button>
            <button
              onClick={() => toggleAnalysisType("code")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.analysisTypes.includes("code")
                  ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-indigo-500/30"
              }`}
            >
              Code
            </button>
            <button
              onClick={() => {
                // Toggle legacy types (complete/specialized)
                toggleAnalysisType("complete");
                if (!filters.analysisTypes.includes("complete")) {
                  // Adding - also add specialized
                  if (!filters.analysisTypes.includes("specialized")) {
                    toggleAnalysisType("specialized");
                  }
                }
              }}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                filters.analysisTypes.includes("complete") || filters.analysisTypes.includes("specialized")
                  ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-600 hover:border-purple-500/30"
              }`}
            >
              Legacy
            </button>

            {/* Clear All Filters */}
            {activeFilterCount > 0 && (
              <>
                <span className="w-px h-5 bg-gray-600 mx-1" />
                <button
                  onClick={resetFilters}
                  className="px-3 py-1 rounded-full text-xs font-semibold text-gray-400
                           hover:text-white hover:bg-gray-700 transition flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear Filters
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      {analyses.length === 0 && translations.length === 0 ? (
        <div className="text-center p-12 bg-gray-800/50 rounded-lg border border-gray-700">
          <History className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">
            {filters.search || activeFilterCount > 0
              ? "No items match your filters"
              : currentTab === "favorites"
              ? "No favorites yet. Star items to add them to your favorites!"
              : "No history yet. Start by analyzing a crash log or translating technical content!"}
          </p>
          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="mt-4 px-4 py-2 text-sm text-blue-400 hover:text-blue-300 transition"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Crash Analyses - using SmartList for incremental loading */}
          {(currentTab === "all" || currentTab === "analyses" || currentTab === "favorites") && analyses.length > 0 && (
            <SmartList
              items={analyses}
              initialCount={20}
              incrementCount={20}
              keyExtractor={(analysis) => `${analysis.id}-${tagRefreshKey}`}
              renderItem={(analysis) => (
                <AnalysisListItem
                  analysis={analysis}
                  onView={handleView}
                  onDelete={handleDelete}
                  onToggleFavorite={handleToggleFavorite}
                  selectionMode={selectionMode}
                  isSelected={selectedAnalysisIds.has(analysis.id)}
                  onSelect={handleSelectAnalysis}
                  goldStatus={goldStatusByAnalysisId[analysis.id]}
                />
              )}
            />
          )}

          {/* Translations - using SmartList for incremental loading */}
          {(currentTab === "all" || currentTab === "translations" || currentTab === "favorites") && translations.length > 0 && (
            <SmartList
              items={translations}
              initialCount={20}
              incrementCount={20}
              keyExtractor={(translation) => translation.id}
              renderItem={(translation) => (
                <TranslationListItem
                  translation={translation}
                  onDelete={handleDeleteTranslation}
                  onToggleFavorite={handleToggleTranslationFavorite}
                  selectionMode={selectionMode}
                  isSelected={selectedTranslationIds.has(translation.id)}
                  onSelect={handleSelectTranslation}
                />
              )}
            />
          )}
        </div>
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedCount}
        selectionType={selectionType}
        availableTags={availableTags}
        onDelete={handleBulkDelete}
        onFavorite={handleBulkFavorite}
        onAddTag={handleBulkAddTag}
        onRemoveTag={handleBulkRemoveTag}
        onExport={handleBulkExport}
        onClearSelection={clearSelection}
        isProcessing={bulkProcessing}
      />
    </div>
  );
}
