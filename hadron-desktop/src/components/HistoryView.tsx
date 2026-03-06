import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Search, AlertCircle, SlidersHorizontal, X, CheckSquare, Download, Columns, Tag } from "lucide-react";
import { format } from "date-fns";
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
import { getAllTicketBriefs, deleteTicketBrief } from "../services/jira-assist";
import type { TicketBrief } from "../services/jira-assist";
import { useDebounce } from "../hooks/useDebounce";
import logger from "../services/logger";
import type { Analysis, Translation, DatabaseStatistics } from "../services/api";
import type { HistoryFilters, Tag as TagType } from "../types";
import { DEFAULT_HISTORY_FILTERS, filtersToApiOptions } from "../types";
import { AdvancedFilterPanel } from "./AdvancedFilterPanel";
import { BulkActionBar, SelectionType } from "./BulkActionBar";
import { useToast } from "./Toast";
import Button from "./ui/Button";
import { getSeverityBadgeClasses } from "../utils/severity";

// localStorage key for filter persistence
const FILTER_STORAGE_KEY = "hadron_history_filters";

interface HistoryViewProps {
  onViewAnalysis: (analysis: Analysis) => void;
  onViewJiraTicket: (jiraKey: string) => void;
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

// Visible column configuration
const ALL_COLUMNS = [
  { key: "file", label: "File" },
  { key: "rootCause", label: "Root Cause" },
  { key: "severity", label: "Severity" },
  { key: "status", label: "Status" },
  { key: "component", label: "Component" },
  { key: "cost", label: "Cost" },
] as const;

type ColumnKey = (typeof ALL_COLUMNS)[number]["key"];

const DEFAULT_VISIBLE_COLUMNS: Set<ColumnKey> = new Set([
  "file", "rootCause", "severity", "status", "component", "cost",
]);

export default function HistoryView({ onViewAnalysis, onViewJiraTicket }: HistoryViewProps) {
  // currentTab is always "all" in triage mode -- kept for loadData() compatibility
  const [currentTab, setCurrentTab] = useState<"analyses" | "translations" | "all" | "favorites">("all");
  void setCurrentTab; // Tab switching removed in triage layout
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [filters, setFilters] = useState<HistoryFilters>(loadSavedFilters);
  const [availableTags, setAvailableTags] = useState<TagType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<DatabaseStatistics | null>(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const toast = useToast();
  const [autoTagCount, setAutoTagCount] = useState<number | null>(null);
  const [autoTagging, setAutoTagging] = useState(false);
  const [tagRefreshKey, setTagRefreshKey] = useState(0);
  void tagRefreshKey; // Used internally by setTagRefreshKey for cache-busting
  const [goldStatusByAnalysisId, setGoldStatusByAnalysisId] = useState<Record<number, string>>({});
  const [jiraBriefs, setJiraBriefs] = useState<TicketBrief[]>([]);

  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<Set<number>>(new Set());
  const [selectedTranslationIds, setSelectedTranslationIds] = useState<Set<number>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const lastSelectedAnalysisId = useRef<number | null>(null);
  const lastSelectedTranslationId = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // New triage workspace state
  const [previewAnalysis, setPreviewAnalysis] = useState<Analysis | null>(null);
  const [previewJiraBrief, setPreviewJiraBrief] = useState<TicketBrief | null>(null);
  const [sortBy, setSortBy] = useState<"recent" | "severity" | "recurrence" | "cost">("recent");
  const [groupBy, setGroupBy] = useState<"none" | "component" | "status" | "severity">("none");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<string>("all");
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(new Set(DEFAULT_VISIBLE_COLUMNS));

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
      // Load statistics, tag count, and gold statuses in parallel
      const [statsResult, tagCountResult, goldResult] = await Promise.allSettled([
        getDatabaseStatistics(),
        countAnalysesWithoutTags(),
        getGoldAnalyses(),
      ]);

      if (statsResult.status === "fulfilled") setStatistics(statsResult.value);
      else logger.warn("Failed to load stats", { error: statsResult.reason });

      if (tagCountResult.status === "fulfilled") setAutoTagCount(tagCountResult.value);
      else { logger.warn("Failed to load auto-tag count", { error: tagCountResult.reason }); setAutoTagCount(null); }

      let goldStatusMap = goldStatusByAnalysisId;
      if (goldResult.status === "fulfilled") {
        const statusMap: Record<number, string> = {};
        for (const gold of goldResult.value) {
          if (gold.sourceAnalysisId) {
            statusMap[gold.sourceAnalysisId] = gold.validationStatus;
          }
        }
        goldStatusMap = statusMap;
        setGoldStatusByAnalysisId(statusMap);
      } else {
        logger.warn("Failed to load gold statuses", { error: goldResult.reason });
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

      // Load JIRA briefs
      try {
        const briefs = await getAllTicketBriefs();
        setJiraBriefs(briefs);
      } catch (e) {
        logger.warn("Failed to load JIRA briefs", { error: e });
        // Non-fatal — history still works without JIRA items
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
      setPreviewAnalysis((prev) => (prev?.id === id ? null : prev));
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
      setPreviewAnalysis((prev) =>
        prev?.id === id ? { ...prev, is_favorite: newStatus } : prev
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

  const handleDeleteJiraBrief = useCallback(async (jiraKey: string, title: string) => {
    if (!window.confirm(`Delete JIRA brief for ${jiraKey} "${title}"?`)) return;
    try {
      await deleteTicketBrief(jiraKey);
      setJiraBriefs((prev) => prev.filter((b) => b.jira_key !== jiraKey));
      setPreviewJiraBrief((prev) => (prev?.jira_key === jiraKey ? null : prev));
      toast.success("JIRA brief deleted");
    } catch (e) {
      toast.error(`Failed to delete: ${e}`);
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

  // Preserve handler references for future use (translations view, type filters, etc.)
  // These are not rendered in the triage grid but remain part of the component's API surface.
  void toggleAnalysisType;
  void handleDeleteTranslation;
  void handleToggleTranslationFavorite;
  void handleSelectTranslation;
  void handleShowTaggedOnly;

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
        if (columnsOpen) {
          setColumnsOpen(false);
        } else if (advancedFiltersOpen) {
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
  }, [advancedFiltersOpen, columnsOpen, selectionMode, selectedCount, currentTab, analyses, translations, clearSelection, handleBulkDelete, handleBulkExport]);

  // =========================================================================
  // Triage Sort and Group Logic
  // =========================================================================

  // Unified history item: analysis or JIRA brief
  type HistoryItem =
    | { kind: "analysis"; data: Analysis; date: string; sortSeverity: number; sortCost: number }
    | { kind: "jira"; data: TicketBrief; date: string; sortSeverity: number; sortCost: number };

  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const unifiedItems = useMemo((): HistoryItem[] => {
    const items: HistoryItem[] = analyses.map((a) => ({
      kind: "analysis" as const,
      data: a,
      date: a.analyzed_at,
      sortSeverity: severityRank[a.severity.toLowerCase()] ?? 4,
      sortCost: a.cost,
    }));

    for (const b of jiraBriefs) {
      items.push({
        kind: "jira" as const,
        data: b,
        date: b.updated_at,
        sortSeverity: severityRank[(b.severity || "").toLowerCase()] ?? 4,
        sortCost: 0,
      });
    }

    // Apply quick filters
    if (quickFilter === "jira") {
      return items.filter((i) => i.kind === "jira");
    }
    if (quickFilter === "analyses") {
      return items.filter((i) => i.kind === "analysis");
    }
    if (quickFilter === "today") {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return items.filter((i) => new Date(i.date) >= startOfToday);
    }
    if (quickFilter === "7days") {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return items.filter((i) => new Date(i.date) >= sevenDaysAgo);
    }
    if (quickFilter === "gold") {
      return items.filter((i) => i.kind === "analysis" && goldStatusByAnalysisId[i.data.id]);
    }
    if (quickFilter === "noTags") {
      return items; // Placeholder — no tag data filtering yet
    }

    return items;
  }, [analyses, jiraBriefs, quickFilter, goldStatusByAnalysisId]);

  // Sort unified items
  const sortedUnifiedItems = useMemo(() => {
    const sorted = [...unifiedItems];
    switch (sortBy) {
      case "severity":
        sorted.sort((a, b) => a.sortSeverity - b.sortSeverity);
        break;
      case "cost":
        sorted.sort((a, b) => b.sortCost - a.sortCost);
        break;
      case "recent":
      default:
        sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
    }
    return sorted;
  }, [unifiedItems, sortBy]);

  // Group unified items
  const groupedUnifiedItems = useMemo(() => {
    if (groupBy === "none") return { "": sortedUnifiedItems };
    const groups: Record<string, HistoryItem[]> = {};
    for (const item of sortedUnifiedItems) {
      let key: string;
      if (groupBy === "component") {
        key = item.kind === "analysis" ? (item.data.component || "Unknown") : (item.data.category || "JIRA");
      } else if (groupBy === "severity") {
        key = item.kind === "analysis" ? item.data.severity : (item.data.severity || "Unknown");
      } else {
        key = item.kind === "analysis" ? "analyzed" : "jira";
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [sortedUnifiedItems, groupBy]);

  // Severity stats from statistics (severity_breakdown is [string, number][])
  const severityStats = useMemo(() => {
    const result = { critical: 0, high: 0, medium: 0, low: 0 };
    if (!statistics?.severity_breakdown) return result;
    for (const [severity, count] of statistics.severity_breakdown) {
      const key = severity.toLowerCase() as keyof typeof result;
      if (key in result) {
        result[key] = count;
      }
    }
    return result;
  }, [statistics]);

  // Toggle column visibility
  const toggleColumn = useCallback((col: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }, []);

  // =========================================================================
  // Rendering
  // =========================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div style={{ color: "var(--hd-text-dim)" }}>Loading history...</div>
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

  // Flat list of all items after quick filter for total count
  const displayedItems = Object.values(groupedUnifiedItems).flat();

  return (
    <div className="space-y-2.5">
      {/* Toolbar Panel */}
      <div className="hd-panel" style={{ padding: 14 }}>
        {/* Header row: title + stat badges */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--hd-text)" }}>
              History: Triage Workspace
            </h2>
            <p className="text-xs mt-1" style={{ color: "var(--hd-text-dim)" }}>
              Sortable columns, grouping, bulk actions, and side preview
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                background: "var(--hd-bg-surface)",
                border: "1px solid var(--hd-border-subtle)",
                color: "var(--hd-text-muted)",
              }}
            >
              {displayedItems.length} shown
            </span>
            {severityStats.critical > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                {severityStats.critical} critical
              </span>
            )}
            {severityStats.high > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
                {severityStats.high} high
              </span>
            )}
            {severityStats.medium > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                {severityStats.medium} medium
              </span>
            )}
            {severityStats.low > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                {severityStats.low} low
              </span>
            )}
          </div>
        </div>

        {/* Toolbar Row 1: Search + Sort + Group */}
        <div className="flex gap-2 flex-wrap" style={{ marginBottom: 8 }}>
          <div className="flex-1 relative" style={{ minWidth: 200 }}>
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: "var(--hd-text-dim)" }}
            />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search by file, signature, component..."
              value={filters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              className="hd-input w-full"
              style={{ paddingLeft: 34, paddingRight: 32, fontSize: "0.82rem" }}
            />
            <span
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: "0.68rem",
                color: "var(--hd-text-dim)",
                background: "var(--hd-bg-surface)",
                border: "1px solid var(--hd-border-subtle)",
                borderRadius: 4,
                padding: "1px 5px",
                pointerEvents: "none",
              }}
            >
              /
            </span>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="hd-input"
            style={{ fontSize: "0.78rem", padding: "6px 10px", minWidth: 140 }}
          >
            <option value="recent">Sort: Most recent</option>
            <option value="severity">Sort: Severity</option>
            <option value="cost">Sort: Highest cost</option>
          </select>

          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
            className="hd-input"
            style={{ fontSize: "0.78rem", padding: "6px 10px", minWidth: 130 }}
          >
            <option value="none">Group: None</option>
            <option value="component">Group: Component</option>
            <option value="status">Group: Status</option>
            <option value="severity">Group: Severity</option>
          </select>
        </div>

        {/* Toolbar Row 2: Action buttons */}
        <div className="flex gap-2 flex-wrap items-center" style={{ marginBottom: 8 }}>
          <Button
            onClick={toggleSelectionMode}
            variant={selectionMode ? "primary" : "secondary"}
            size="sm"
            icon={<CheckSquare />}
          >
            {selectionMode ? "Cancel" : "Select"}
          </Button>

          <Button
            onClick={() => setAdvancedFiltersOpen(!advancedFiltersOpen)}
            variant={advancedFiltersOpen || activeFilterCount > 0 ? "accent" : "secondary"}
            size="sm"
            icon={<SlidersHorizontal />}
          >
            Filters
            {activeFilterCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-full text-xs"
                style={{
                  background: "var(--hd-accent)",
                  color: "#052e24",
                  fontWeight: 700,
                  marginLeft: 2,
                }}
              >
                {activeFilterCount}
              </span>
            )}
          </Button>

          <Button
            onClick={() => setColumnsOpen(!columnsOpen)}
            variant={columnsOpen ? "accent" : "secondary"}
            size="sm"
            icon={<Columns />}
          >
            Columns
          </Button>

          {selectedCount > 0 && (
            <Button
              onClick={handleBulkExport}
              variant="secondary"
              size="sm"
              icon={<Download />}
            >
              Export CSV
            </Button>
          )}

          <div className="flex-1" />

          {autoTagCount !== null && autoTagCount > 0 && (
            <Button
              onClick={handleAutoTag}
              loading={autoTagging}
              variant="secondary"
              size="sm"
              icon={<Tag />}
            >
              {autoTagging ? "Tagging..." : `Auto-tag (${autoTagCount})`}
            </Button>
          )}
        </div>

        {/* Quick Filter Chips */}
        <div className="flex flex-wrap gap-1.5 items-center" style={{ marginBottom: 8 }}>
          {(["all", "analyses", "jira", "today", "7days", "gold", "noTags"] as const).map((chip) => {
            const labels: Record<string, string> = {
              all: "All",
              analyses: "Analyses",
              jira: "JIRA",
              today: "Today",
              "7days": "Last 7 days",
              gold: "Gold only",
              noTags: "No tags",
            };
            return (
              <button
                key={chip}
                onClick={() => setQuickFilter(chip)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 9999,
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  border: "1px solid var(--hd-border-subtle)",
                  background: quickFilter === chip ? "var(--hd-accent)" : "transparent",
                  color: quickFilter === chip ? "#052e24" : "var(--hd-text-dim)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {labels[chip]}
              </button>
            );
          })}

          <span style={{ width: 1, height: 16, background: "var(--hd-border)", margin: "0 4px" }} />

          <span style={{ fontSize: "0.72rem", color: "var(--hd-text-dim)", marginRight: 2 }}>Severity:</span>
          <button
            onClick={() => updateFilters({ severities: [] })}
            style={{
              padding: "4px 10px",
              borderRadius: 9999,
              fontSize: "0.72rem",
              fontWeight: 500,
              border: "1px solid var(--hd-border-subtle)",
              background: filters.severities.length === 0 ? "var(--hd-accent)" : "transparent",
              color: filters.severities.length === 0 ? "#052e24" : "var(--hd-text-dim)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            All
          </button>
          {(["critical", "high", "medium", "low"] as const).map((sev) => (
            <button
              key={sev}
              onClick={() => toggleSeverity(sev)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border transition ${
                filters.severities.includes(sev)
                  ? getSeverityBadgeClasses(sev)
                  : ""
              }`}
              style={{
                fontSize: "0.72rem",
                cursor: "pointer",
                ...(filters.severities.includes(sev) ? {} : {
                  background: "transparent",
                  border: "1px solid var(--hd-border-subtle)",
                  color: "var(--hd-text-dim)",
                }),
              }}
            >
              {sev.charAt(0).toUpperCase() + sev.slice(1)}
            </button>
          ))}

          {activeFilterCount > 0 && (
            <>
              <span style={{ width: 1, height: 16, background: "var(--hd-border)", margin: "0 4px" }} />
              <button
                onClick={resetFilters}
                className="flex items-center gap-1"
                style={{
                  padding: "4px 10px",
                  borderRadius: 9999,
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  border: "1px solid var(--hd-border-subtle)",
                  background: "transparent",
                  color: "var(--hd-text-dim)",
                  cursor: "pointer",
                }}
              >
                <X className="w-3 h-3" />
                Clear Filters
              </button>
            </>
          )}
        </div>

        {/* Advanced Filters Drawer (collapsible) */}
        <div className={`hd-filter-drawer ${advancedFiltersOpen ? "hd-filter-drawer-open" : ""}`}>
          <AdvancedFilterPanel
            filters={filters}
            availableTags={availableTags}
            onChange={updateFilters}
            onReset={resetFilters}
            isOpen={advancedFiltersOpen}
            onClose={() => setAdvancedFiltersOpen(false)}
          />
        </div>

        {/* Column Customization Drawer (collapsible) */}
        <div className={`hd-filter-drawer ${columnsOpen ? "hd-filter-drawer-open" : ""}`}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 8, color: "var(--hd-text)" }}>
            Visible Columns
          </div>
          <div className="flex flex-wrap gap-3">
            {ALL_COLUMNS.map((col) => (
              <label
                key={col.key}
                className="flex items-center gap-1.5 cursor-pointer"
                style={{ fontSize: "0.78rem", color: "var(--hd-text-muted)" }}
              >
                <input
                  type="checkbox"
                  checked={visibleColumns.has(col.key)}
                  onChange={() => toggleColumn(col.key)}
                  style={{ accentColor: "var(--hd-accent)", width: 14, height: 14 }}
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Two-Panel Layout: List + Preview */}
      {displayedItems.length === 0 ? (
        <div className="hd-panel" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "var(--hd-text-dim)", fontSize: "0.88rem" }}>
            {filters.search || activeFilterCount > 0 || quickFilter !== "all"
              ? "No items match your filters"
              : "No history yet. Start by analyzing a crash log!"}
          </p>
          {(activeFilterCount > 0 || quickFilter !== "all") && (
            <Button
              onClick={() => { resetFilters(); setQuickFilter("all"); }}
              variant="ghost"
              size="sm"
              className="mt-4"
            >
              Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.7fr", gap: 10, minHeight: 480 }}>
          {/* Left: List Panel */}
          <div className="hd-panel" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Column Headers */}
            <div
              className="hd-triage-row"
              style={{
                borderBottom: "1px solid var(--hd-border-subtle)",
                fontSize: "0.72rem",
                color: "var(--hd-text-dim)",
                fontWeight: 600,
                cursor: "default",
              }}
            >
              {visibleColumns.has("file") && <span>File</span>}
              {visibleColumns.has("rootCause") && <span>Root Cause</span>}
              {visibleColumns.has("severity") && <span>Severity</span>}
              {visibleColumns.has("status") && <span>Status</span>}
              {visibleColumns.has("component") && <span>Component</span>}
              {visibleColumns.has("cost") && <span>Cost</span>}
              <span>Actions</span>
            </div>

            {/* Scrollable List */}
            <div style={{ overflowY: "auto", flex: 1, padding: "6px 8px" }}>
              {Object.entries(groupedUnifiedItems).map(([groupLabel, groupItems]) => (
                <div key={groupLabel || "__default"}>
                  {/* Group header when grouping is active */}
                  {groupBy !== "none" && groupLabel && (
                    <div
                      style={{
                        padding: "6px 8px",
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        color: "var(--hd-accent)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: "1px solid var(--hd-border-subtle)",
                        marginTop: 6,
                        marginBottom: 2,
                      }}
                    >
                      {groupLabel} ({groupItems.length})
                    </div>
                  )}

                  {groupItems.map((item) => {
                    const isActive = item.kind === "analysis"
                      ? previewAnalysis?.id === item.data.id
                      : previewJiraBrief?.jira_key === item.data.jira_key;

                    const handleClick = () => {
                      if (item.kind === "analysis") {
                        setPreviewAnalysis(item.data);
                        setPreviewJiraBrief(null);
                      } else {
                        setPreviewJiraBrief(item.data);
                        setPreviewAnalysis(null);
                      }
                    };

                    const jiraStatus = item.kind === "jira"
                      ? (item.data.posted_to_jira ? "posted" : item.data.brief_json ? "briefed" : "triaged")
                      : null;

                    return (
                      <div
                        key={item.kind === "analysis" ? `a-${item.data.id}` : `j-${item.data.jira_key}`}
                        className={`hd-triage-row ${isActive ? "hd-triage-row-active" : ""}`}
                        onClick={handleClick}
                      >
                        {visibleColumns.has("file") && (
                          <div
                            style={{
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            {item.kind === "analysis" && selectionMode && (
                              <input
                                type="checkbox"
                                checked={selectedAnalysisIds.has(item.data.id)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectAnalysis(item.data.id, e.shiftKey);
                                }}
                                onChange={() => {}}
                                style={{
                                  accentColor: "var(--hd-accent)",
                                  width: 14,
                                  height: 14,
                                  cursor: "pointer",
                                  marginRight: 4,
                                }}
                              />
                            )}
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                              {item.kind === "analysis" ? item.data.filename : item.data.jira_key}
                            </span>
                            {item.kind === "analysis" && item.data.is_favorite && (
                              <span style={{ color: "#fbbf24" }}>&#9733;</span>
                            )}
                            {item.kind === "analysis" && goldStatusByAnalysisId[item.data.id] && (
                              <span style={{ fontSize: "0.7rem", color: "#fbbf24" }}>&#11088;</span>
                            )}
                            {item.kind === "jira" && (
                              <span style={{
                                fontSize: "0.6rem",
                                fontWeight: 700,
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: "rgba(99,102,241,0.15)",
                                color: "rgb(129,140,248)",
                              }}>
                                JIRA
                              </span>
                            )}
                          </div>
                        )}

                        {visibleColumns.has("rootCause") && (
                          <div
                            style={{
                              color: "var(--hd-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: "0.78rem",
                            }}
                          >
                            {item.kind === "analysis" ? item.data.root_cause : item.data.title}
                          </div>
                        )}

                        {visibleColumns.has("severity") && (
                          <div>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getSeverityBadgeClasses(
                                item.kind === "analysis" ? item.data.severity : (item.data.severity || "medium")
                              )}`}
                            >
                              {item.kind === "analysis" ? item.data.severity : (item.data.severity || "\u2014")}
                            </span>
                          </div>
                        )}

                        {visibleColumns.has("status") && (
                          <div style={{ fontSize: "0.72rem", color: "var(--hd-text-muted)" }}>
                            {item.kind === "analysis" ? "analyzed" : jiraStatus}
                          </div>
                        )}

                        {visibleColumns.has("component") && (
                          <div style={{ fontSize: "0.72rem", color: "var(--hd-text-dim)" }}>
                            {item.kind === "analysis" ? (item.data.component || "\u2014") : (item.data.category || "\u2014")}
                          </div>
                        )}

                        {visibleColumns.has("cost") && (
                          <div style={{ fontSize: "0.72rem", color: "var(--hd-text-dim)", fontVariantNumeric: "tabular-nums" }}>
                            {item.kind === "analysis" ? `$${item.data.cost.toFixed(3)}` : "\u2014"}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {item.kind === "analysis" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFavorite(item.data.id);
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: item.data.is_favorite ? "#fbbf24" : "var(--hd-text-dim)",
                                fontSize: "0.9rem",
                                padding: 2,
                              }}
                            >
                              &#9733;
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.kind === "analysis") {
                                handleDelete(item.data.id, item.data.filename);
                              } else {
                                handleDeleteJiraBrief(item.data.jira_key, item.data.title);
                              }
                            }}
                            style={{
                              background: "var(--hd-danger-dim, rgba(239,68,68,0.12))",
                              border: "none",
                              color: "var(--hd-danger, #ef4444)",
                              borderRadius: 4,
                              padding: "3px 6px",
                              fontSize: "0.68rem",
                              cursor: "pointer",
                            }}
                          >
                            Del
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Selection summary footer */}
            {selectionMode && selectedCount > 0 && (
              <div
                style={{
                  padding: "8px 12px",
                  borderTop: "1px solid var(--hd-border-subtle)",
                  fontSize: "0.75rem",
                  color: "var(--hd-text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>{selectedCount} selected</span>
                <button
                  onClick={clearSelection}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--hd-text-dim)",
                    cursor: "pointer",
                    fontSize: "0.72rem",
                    textDecoration: "underline",
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Right: Preview Panel */}
          <div className="hd-panel" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div
              style={{ padding: "10px 14px", borderBottom: "1px solid var(--hd-border-subtle)" }}
              className="flex items-center justify-between"
            >
              <strong style={{ fontSize: "0.88rem", color: "var(--hd-text)" }}>Preview</strong>
              <span className="text-xs" style={{ color: "var(--hd-text-dim)" }}>
                {previewAnalysis ? `#${previewAnalysis.id}` : previewJiraBrief ? previewJiraBrief.jira_key : "\u2014"}
              </span>
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: "10px 14px" }}>
              {previewAnalysis ? (
                <>
                  {/* Root Cause section */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                      Root Cause
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "var(--hd-text-muted)" }}>
                      {previewAnalysis.root_cause}
                    </div>
                  </div>

                  {/* Suggested Fix */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                      Suggested Fix
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "var(--hd-text-muted)", whiteSpace: "pre-wrap" }}>
                      {previewAnalysis.suggested_fixes}
                    </div>
                  </div>

                  {/* Timeline / Details section */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                      Details
                    </div>
                    <div
                      style={{
                        borderLeft: "2px solid rgba(16,185,129,0.3)",
                        paddingLeft: 10,
                        fontSize: "0.78rem",
                        color: "var(--hd-text-muted)",
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>
                        Analyzed: {format(new Date(previewAnalysis.analyzed_at), "MMM d, yyyy 'at' h:mm a")}
                      </div>
                      <div style={{ marginBottom: 4 }}>Error: {previewAnalysis.error_type}</div>
                      <div style={{ marginBottom: 4 }}>
                        Component: {previewAnalysis.component || "\u2014"}
                      </div>
                      <div>Cost: ${previewAnalysis.cost.toFixed(4)}</div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleView(previewAnalysis.id)}
                    >
                      Open Full Detail
                    </Button>
                    <Button
                      variant="ghost-danger"
                      size="sm"
                      onClick={() => handleDelete(previewAnalysis.id, previewAnalysis.filename)}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              ) : previewJiraBrief ? (
                <>
                  {/* JIRA Ticket Header */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--hd-text)", marginBottom: 4 }}>
                      {previewJiraBrief.jira_key}
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "var(--hd-text-muted)" }}>
                      {previewJiraBrief.title}
                    </div>
                  </div>

                  {/* Triage Info */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 6, color: "var(--hd-text)" }}>
                      Triage
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                      {previewJiraBrief.severity && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getSeverityBadgeClasses(previewJiraBrief.severity)}`}>
                          {previewJiraBrief.severity}
                        </span>
                      )}
                      {previewJiraBrief.category && (
                        <span style={{
                          fontSize: "0.72rem",
                          padding: "2px 8px",
                          borderRadius: 9999,
                          background: "rgba(99,102,241,0.12)",
                          color: "rgb(129,140,248)",
                          fontWeight: 600,
                        }}>
                          {previewJiraBrief.category}
                        </span>
                      )}
                    </div>
                    {previewJiraBrief.customer && (
                      <div style={{ fontSize: "0.78rem", color: "var(--hd-text-dim)" }}>
                        Customer: {previewJiraBrief.customer}
                      </div>
                    )}
                  </div>

                  {/* Brief Summary (if available) */}
                  {previewJiraBrief.brief_json && (() => {
                    try {
                      const brief = JSON.parse(previewJiraBrief.brief_json);
                      const summary = brief?.analysis?.executive_summary || brief?.analysis?.plain_summary;
                      if (!summary) return null;
                      return (
                        <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                            Brief Summary
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--hd-text-muted)" }}>
                            {summary}
                          </div>
                        </div>
                      );
                    } catch { return null; }
                  })()}

                  {/* Details */}
                  <div className="hd-analysis-section" style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4, color: "var(--hd-text)" }}>
                      Details
                    </div>
                    <div
                      style={{
                        borderLeft: "2px solid rgba(99,102,241,0.3)",
                        paddingLeft: 10,
                        fontSize: "0.78rem",
                        color: "var(--hd-text-muted)",
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>
                        Updated: {format(new Date(previewJiraBrief.updated_at), "MMM d, yyyy 'at' h:mm a")}
                      </div>
                      <div style={{ marginBottom: 4 }}>
                        Status: {previewJiraBrief.posted_to_jira ? "Posted to JIRA" : previewJiraBrief.brief_json ? "Brief generated" : "Triaged"}
                      </div>
                      {previewJiraBrief.engineer_rating && (
                        <div style={{ marginBottom: 4 }}>
                          Rating: {"\u2605".repeat(previewJiraBrief.engineer_rating)}{"\u2606".repeat(5 - previewJiraBrief.engineer_rating)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onViewJiraTicket(previewJiraBrief.jira_key)}
                    >
                      Open in JIRA Analyzer
                    </Button>
                    <Button
                      variant="ghost-danger"
                      size="sm"
                      onClick={() => handleDeleteJiraBrief(previewJiraBrief.jira_key, previewJiraBrief.title)}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "var(--hd-text-dim)",
                    fontSize: "0.85rem",
                  }}
                >
                  Select an item to preview
                </div>
              )}
            </div>
          </div>
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
