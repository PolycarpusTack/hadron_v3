import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Search, AlertCircle, SlidersHorizontal, X, CheckSquare, Download, Columns, Tag, Trash2 } from "lucide-react";
import { format } from "date-fns";
import {
  getAllAnalyses,
  deleteAnalysis,
  getAnalysisById,
  searchAnalyses,
  toggleFavorite,
  getAllTranslations,
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
import { useConfirm } from "./ui/ConfirmDialog";
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

const MONO = "'JetBrains Mono','Fira Code',monospace";
const SEV_COL: Record<string, string> = {
  critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#10b981",
};
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
function getTypeInfo(kind: string, analysisType?: string): { icon: string; color: string } {
  if (kind === "jira") return { icon: "◉", color: "#8b5cf6" };
  if (analysisType === "comprehensive" || analysisType === "whatson") return { icon: "◈", color: "#10b981" };
  if (analysisType === "quick") return { icon: "◎", color: "#22d3ee" };
  if (analysisType === "sentry") return { icon: "⊕", color: "#f59e0b" };
  return { icon: "▣", color: "var(--hd-text-muted)" };
}

export default function HistoryView({ onViewAnalysis, onViewJiraTicket }: HistoryViewProps) {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();

  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [totalAnalysesCount, setTotalAnalysesCount] = useState(0);
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

  // loadData reads current filters/state via closure. Forwarding through a ref
  // lets the effect trigger only on debounced inputs without a stale-closure loop.
  const loadDataRef = useRef<() => Promise<void>>();
  useEffect(() => { loadDataRef.current = loadData; });
  useEffect(() => {
    loadDataRef.current?.();
  }, [debouncedSearchTerm, debouncedFilterKey]);

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

      // Load analyses
      {
        const goldOnly = filters.analysisTypes.includes("gold");
        const analysisTypesForApi = filters.analysisTypes.filter((t) => t !== "gold");
        const filtersForApi = {
          ...filters,
          analysisTypes: analysisTypesForApi,
          search: debouncedSearchTerm,
          favoritesOnly: filters.favoritesOnly,
        };
        const apiOptions = filtersToApiOptions(filtersForApi);

        try {
          const result = await getAnalysesFiltered(apiOptions);
          const filteredItems = goldOnly
            ? result.items.filter((a) => goldStatusMap[a.id])
            : result.items;
          setAnalyses(filteredItems);
          setTotalAnalysesCount(result.totalCount);
        } catch (filterErr) {
          // Fallback to basic search if advanced filter fails
          logger.warn("Advanced filter failed, falling back to basic search", { error: filterErr });
          const data = debouncedSearchTerm
            ? await searchAnalyses(
                debouncedSearchTerm,
                filters.severities.length === 1 ? filters.severities[0].toUpperCase() : undefined
              )
            : await getAllAnalyses();

          let filtered = data;
          if (goldOnly) {
            filtered = filtered.filter((a) => goldStatusMap[a.id]);
          }
          if (filters.severities.length > 0) {
            filtered = filtered.filter((a) =>
              filters.severities.includes(a.severity.toLowerCase())
            );
          }
          if (filters.favoritesOnly) {
            filtered = filtered.filter((a) => a.is_favorite);
          }
          setAnalyses(filtered);
        }
      }

      // Load translations
      {
        const data = await getAllTranslations();
        let filtered = data;
        if (debouncedSearchTerm) {
          filtered = filtered.filter((t) =>
            t.input_content.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
            t.translation.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
          );
        }
        if (filters.favoritesOnly) {
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


  // Memoized handlers to prevent unnecessary re-renders of list items
  const handleDelete = useCallback(async (id: number, filename: string) => {
    if (!await confirmDialog(`Delete analysis for "${filename}"?`, { confirmLabel: 'Delete', destructive: true })) return;

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


  const handleDeleteJiraBrief = useCallback(async (jiraKey: string, title: string) => {
    if (!await confirmDialog(`Delete JIRA brief for ${jiraKey} "${title}"?`, { confirmLabel: 'Delete', destructive: true })) return;
    try {
      await deleteTicketBrief(jiraKey);
      setJiraBriefs((prev) => prev.filter((b) => b.jira_key !== jiraKey));
      setPreviewJiraBrief((prev) => (prev?.jira_key === jiraKey ? null : prev));
      toast.success("JIRA brief deleted");
    } catch (e) {
      toast.error(`Failed to delete: ${e}`);
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

    if (!await confirmDialog(`Delete ${total} selected item${total > 1 ? "s" : ""}?`, { confirmLabel: 'Delete', destructive: true })) return;

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
        setSelectedAnalysisIds(new Set(analyses.map((a) => a.id)));
        setSelectedTranslationIds(new Set(translations.map((t) => t.id)));
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
  }, [advancedFiltersOpen, columnsOpen, selectionMode, selectedCount, analyses, translations, clearSelection, handleBulkDelete, handleBulkExport]);

  // =========================================================================
  // Triage Sort and Group Logic
  // =========================================================================

  // Unified history item: analysis or JIRA brief
  type HistoryItem =
    | { kind: "analysis"; data: Analysis; date: string; sortSeverity: number; sortCost: number }
    | { kind: "jira"; data: TicketBrief; date: string; sortSeverity: number; sortCost: number };

  const unifiedItems = useMemo((): HistoryItem[] => {
    // Exclude jira_deep analyses — those tickets are already shown via ticket_briefs
    const items: HistoryItem[] = analyses
      .filter((a) => a.analysis_type !== "jira_deep")
      .map((a) => ({
        kind: "analysis" as const,
        data: a,
        date: a.analyzed_at,
        sortSeverity: SEVERITY_RANK[a.severity.toLowerCase()] ?? 4,
        sortCost: a.cost,
      }));

    for (const b of jiraBriefs) {
      items.push({
        kind: "jira" as const,
        data: b,
        date: b.updated_at,
        sortSeverity: SEVERITY_RANK[(b.severity || "").toLowerCase()] ?? 4,
        sortCost: 0,
      });
    }

    // Apply quick filters
    let filtered = items;
    if (quickFilter === "jira") {
      filtered = items.filter((i) => i.kind === "jira");
    } else if (quickFilter === "analyses") {
      filtered = items.filter((i) => i.kind === "analysis");
    } else if (quickFilter === "today") {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      filtered = items.filter((i) => new Date(i.date) >= startOfToday);
    } else if (quickFilter === "7days") {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      filtered = items.filter((i) => new Date(i.date) >= sevenDaysAgo);
    } else if (quickFilter === "gold") {
      filtered = items.filter((i) => i.kind === "analysis" && goldStatusByAnalysisId[(i.data as Analysis).id]);
    }

    // Sort via filters.sortBy/sortOrder — single source of truth
    const asc = filters.sortOrder === "asc";
    const sorted = [...filtered];
    switch (filters.sortBy) {
      case "severity":
        sorted.sort((a, b) => asc ? a.sortSeverity - b.sortSeverity : b.sortSeverity - a.sortSeverity);
        break;
      case "cost":
        sorted.sort((a, b) => asc ? a.sortCost - b.sortCost : b.sortCost - a.sortCost);
        break;
      case "date":
      default:
        sorted.sort((a, b) => {
          const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
          return asc ? -diff : diff;
        });
        break;
    }
    return sorted;
  }, [analyses, jiraBriefs, quickFilter, goldStatusByAnalysisId, filters.sortBy, filters.sortOrder]);

  // Group unified items
  const groupedUnifiedItems = useMemo(() => {
    if (groupBy === "none") return { "": unifiedItems };
    const groups: Record<string, HistoryItem[]> = {};
    for (const item of unifiedItems) {
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
  }, [unifiedItems, groupBy]);

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48, color: "rgba(255,255,255,0.3)", fontFamily: MONO, fontSize: "var(--hd-font-sm)" }}>
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, margin: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#ef4444", fontSize: "var(--hd-font-sm)" }}>
          <AlertCircle style={{ width: 16, height: 16 }} />
          {error}
        </div>
      </div>
    );
  }

  const displayedItems = useMemo(() => Object.values(groupedUnifiedItems).flat(), [groupedUnifiedItems]);
  const analysisTotalCount = useMemo(() => analyses.filter(a => a.analysis_type !== "jira_deep").length, [analyses]);
  const compTotal = useMemo(() => analyses.filter(a => a.analysis_type === "comprehensive" || a.analysis_type === "whatson").length, [analyses]);
  const quickTotal = useMemo(() => analyses.filter(a => a.analysis_type === "quick").length, [analyses]);
  const jiraTotal = jiraBriefs.length;

  return (
    <div style={{ background: "var(--hd-bg-base)", color: "var(--hd-text)", display: "flex", flexDirection: "column", fontFamily: "var(--hd-font-sans)", borderRadius: 8, overflow: "hidden" }}>
      {confirmDialogEl}

      {/* \u2500\u2500 Header: title + stats + search \u2500\u2500 */}
      <div style={{ borderBottom: "1px solid var(--hd-border-subtle)", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--hd-bg-base)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#22d3ee", fontSize: "var(--hd-font-sm)", fontWeight: 700, fontFamily: MONO }}>HISTORY</span>
          <span style={{ color: "var(--hd-text-dim)" }}>\u2502</span>
          <span style={{ fontSize: "var(--hd-font-xs)", color: "var(--hd-text-dim)" }}>
            <strong style={{ color: "var(--hd-text)" }}>{displayedItems.length}</strong> items
            {totalAnalysesCount > 0 && analyses.length < totalAnalysesCount && (
              <> &nbsp;\u00b7&nbsp; <span style={{ color: "#f59e0b" }}>showing {analyses.length} of {totalAnalysesCount}</span></>
            )}
            {jiraTotal > 0 && <> &nbsp;\u00b7&nbsp; <span style={{ color: "#8b5cf6" }}>{jiraTotal} JIRA</span></>}
            {compTotal > 0 && <> &nbsp;\u00b7&nbsp; <span style={{ color: "#10b981" }}>{compTotal} comprehensive</span></>}
            {quickTotal > 0 && <> &nbsp;\u00b7&nbsp; <span style={{ color: "#22d3ee" }}>{quickTotal} quick</span></>}
          </span>
        </div>
        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "var(--hd-text-dim)" }} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search analyses\u2026"
            value={filters.search}
            onChange={e => updateFilters({ search: e.target.value })}
            style={{ background: "var(--hd-bg-surface)", border: "1px solid var(--hd-border)", borderRadius: 6, padding: "6px 30px 6px 30px", color: "var(--hd-text)", fontSize: "var(--hd-font-xs)", outline: "none", width: 240 }}
          />
          {!filters.search && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--hd-text-dim)", fontSize: "9px", fontFamily: MONO, background: "var(--hd-bg-surface)", padding: "1px 4px", borderRadius: 3 }}>/</span>}
          {filters.search && <button aria-label="Clear search" onClick={() => updateFilters({ search: "" })} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--hd-text-dim)", fontSize: "var(--hd-font-xs)", cursor: "pointer", padding: 2 }}>\u00d7</button>}
        </div>
      </div>

      {/* \u2500\u2500 Toolbar: filters + controls \u2500\u2500 */}
      <div style={{ borderBottom: "1px solid var(--hd-border-subtle)", padding: "8px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {/* Left: severity + quick filter pills */}
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {(["critical", "high", "medium", "low"] as const).map(sev => {
            const active = filters.severities.includes(sev);
            return (
              <button key={sev} onClick={() => toggleSeverity(sev)} style={{ background: active ? `${SEV_COL[sev]}18` : "var(--hd-bg-surface)", border: `1px solid ${active ? `${SEV_COL[sev]}40` : "var(--hd-border)"}`, color: active ? SEV_COL[sev] : "var(--hd-text-muted)", padding: "5px 10px", borderRadius: 5, fontSize: "var(--hd-font-2xs)", cursor: "pointer", fontFamily: MONO }}>
                {sev.charAt(0).toUpperCase() + sev.slice(1)}
              </button>
            );
          })}
          <span style={{ color: "var(--hd-text-dim)", margin: "0 3px" }}>\u2502</span>
          {(["analyses", "jira", "today", "7days", "gold"] as const).map(chip => {
            const labels: Record<string, string> = { analyses: "Analyses", jira: "JIRA", today: "Today", "7days": "7 days", gold: "Gold" };
            const active = quickFilter === chip;
            return (
              <button key={chip} onClick={() => setQuickFilter(active ? "all" : chip)} style={{ background: active ? "rgba(6,182,212,0.1)" : "var(--hd-bg-surface)", border: `1px solid ${active ? "rgba(6,182,212,0.25)" : "var(--hd-border)"}`, color: active ? "#67e8f9" : "var(--hd-text-muted)", padding: "5px 10px", borderRadius: 5, fontSize: "var(--hd-font-2xs)", cursor: "pointer", fontFamily: MONO }}>
                {labels[chip]}
              </button>
            );
          })}
          {(activeFilterCount > 0 || quickFilter !== "all" || filters.severities.length > 0 || filters.search) && (
            <button onClick={() => { resetFilters(); setQuickFilter("all"); }} style={{ background: "none", border: "none", color: "var(--hd-text-dim)", fontSize: "var(--hd-font-2xs)", cursor: "pointer", fontFamily: MONO, textDecoration: "underline" }}>Clear all</button>
          )}
        </div>

        {/* Right: sort + group + action buttons */}
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <select value={filters.sortBy} onChange={e => updateFilters({ sortBy: e.target.value as HistoryFilters["sortBy"] })} style={{ background: "var(--hd-bg-surface)", border: "1px solid var(--hd-border)", borderRadius: 5, padding: "5px 8px", color: "var(--hd-text-muted)", fontSize: "var(--hd-font-2xs)", fontFamily: MONO, cursor: "pointer", outline: "none" }}>
            <option value="date" style={{ background: "var(--hd-bg-raised)" }}>Newest first</option>
            <option value="severity" style={{ background: "var(--hd-bg-raised)" }}>By severity</option>
            <option value="cost" style={{ background: "var(--hd-bg-raised)" }}>By cost</option>
          </select>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as typeof groupBy)} style={{ background: "var(--hd-bg-surface)", border: "1px solid var(--hd-border)", borderRadius: 5, padding: "5px 8px", color: "var(--hd-text-muted)", fontSize: "var(--hd-font-2xs)", fontFamily: MONO, cursor: "pointer", outline: "none" }}>
            <option value="none" style={{ background: "var(--hd-bg-raised)" }}>No grouping</option>
            <option value="component" style={{ background: "var(--hd-bg-raised)" }}>By component</option>
            <option value="severity" style={{ background: "var(--hd-bg-raised)" }}>By severity</option>
            <option value="status" style={{ background: "var(--hd-bg-raised)" }}>By status</option>
          </select>
          <span style={{ color: "var(--hd-text-dim)" }}>\u2502</span>
          <Button onClick={toggleSelectionMode} variant={selectionMode ? "primary" : "secondary"} size="sm" icon={<CheckSquare />}>
            {selectionMode ? "Cancel" : "Select"}
          </Button>
          <Button onClick={() => setAdvancedFiltersOpen(!advancedFiltersOpen)} variant={advancedFiltersOpen || activeFilterCount > 0 ? "accent" : "secondary"} size="sm" icon={<SlidersHorizontal />}>
            Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
          </Button>
          <Button onClick={() => setColumnsOpen(!columnsOpen)} variant={columnsOpen ? "accent" : "secondary"} size="sm" icon={<Columns />}>
            Columns
          </Button>
          {selectedCount > 0 && <Button onClick={handleBulkExport} variant="secondary" size="sm" icon={<Download />}>Export CSV</Button>}
          {autoTagCount !== null && autoTagCount > 0 && (
            <Button onClick={handleAutoTag} loading={autoTagging} variant="secondary" size="sm" icon={<Tag />}>
              {autoTagging ? "Tagging\u2026" : `Auto-tag (${autoTagCount})`}
            </Button>
          )}
        </div>
      </div>

      {/* \u2500\u2500 Selection banner \u2500\u2500 */}
      {selectionMode && selectedCount > 0 && (
        <div style={{ padding: "6px 18px", background: "rgba(6,182,212,0.06)", borderBottom: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: "#67e8f9", fontSize: "var(--hd-font-2xs)", fontFamily: MONO }}>{selectedCount} selected</span>
          <button onClick={() => setSelectedAnalysisIds(new Set(analyses.map(a => a.id)))} style={{ background: "none", border: "none", color: "#67e8f9", fontSize: "var(--hd-font-2xs)", cursor: "pointer", fontFamily: MONO, textDecoration: "underline" }}>Select all ({unifiedItems.length})</button>
          <button onClick={clearSelection} style={{ background: "none", border: "none", color: "var(--hd-text-dim)", fontSize: "var(--hd-font-2xs)", cursor: "pointer", fontFamily: MONO, textDecoration: "underline" }}>Clear</button>
          <span style={{ color: "var(--hd-text-dim)" }}>\u2502</span>
          <button onClick={() => handleBulkDelete()} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", padding: "3px 10px", borderRadius: 4, fontSize: "var(--hd-font-3xs)", cursor: "pointer", fontFamily: MONO }}>Delete</button>
          <button onClick={() => handleBulkFavorite(true)} style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24", padding: "3px 10px", borderRadius: 4, fontSize: "var(--hd-font-3xs)", cursor: "pointer", fontFamily: MONO }}>\u2605 Favorite</button>
          <button onClick={handleBulkExport} style={{ background: "var(--hd-bg-surface)", border: "1px solid var(--hd-border)", color: "var(--hd-text)", padding: "3px 10px", borderRadius: 4, fontSize: "var(--hd-font-3xs)", cursor: "pointer", fontFamily: MONO }}>\u2197 Export CSV</button>
        </div>
      )}

      {/* \u2500\u2500 Advanced Filters Drawer \u2500\u2500 */}
      <div className={`hd-filter-drawer ${advancedFiltersOpen ? "hd-filter-drawer-open" : ""}`}>
        <AdvancedFilterPanel filters={filters} availableTags={availableTags} onChange={updateFilters} onReset={resetFilters} isOpen={advancedFiltersOpen} onClose={() => setAdvancedFiltersOpen(false)} />
      </div>

      {/* \u2500\u2500 Column Customization Drawer \u2500\u2500 */}
      <div className={`hd-filter-drawer ${columnsOpen ? "hd-filter-drawer-open" : ""}`} style={{ padding: columnsOpen ? "10px 18px" : undefined }}>
        {columnsOpen && (
          <>
            <div style={{ fontSize: "var(--hd-font-2xs)", fontWeight: 600, marginBottom: 8, color: "var(--hd-text)", fontFamily: MONO }}>Visible Columns</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {ALL_COLUMNS.map(col => (
                <label key={col.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--hd-font-2xs)", color: "var(--hd-text-muted)", cursor: "pointer", fontFamily: MONO }}>
                  <input type="checkbox" checked={visibleColumns.has(col.key)} onChange={() => toggleColumn(col.key)} style={{ accentColor: "#22d3ee", width: 13, height: 13 }} />
                  {col.label}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {/* \u2500\u2500 Main content \u2500\u2500 */}
      {displayedItems.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ color: "var(--hd-text-dim)", fontSize: "var(--hd-font-sm)" }}>
            {filters.search || activeFilterCount > 0 || quickFilter !== "all"
              ? "No items match your filters"
              : "No history yet. Start by analyzing a crash log!"}
          </div>
          {(activeFilterCount > 0 || quickFilter !== "all") && (
            <button onClick={() => { resetFilters(); setQuickFilter("all"); }} style={{ background: "var(--hd-bg-surface)", border: "1px solid var(--hd-border)", color: "var(--hd-text-muted)", padding: "6px 14px", borderRadius: 6, fontSize: "var(--hd-font-xs)", cursor: "pointer", fontFamily: MONO, marginTop: 12 }}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", minHeight: 500 }}>
          {/* \u2500\u2500 List panel \u2500\u2500 */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minWidth: 0 }}>
            {/* Column headers */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderBottom: "1px solid var(--hd-border-subtle)", fontSize: "var(--hd-font-3xs)", color: "var(--hd-text-dim)", fontFamily: MONO, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", flexShrink: 0 }}>
              {selectionMode && <span style={{ width: 16, flexShrink: 0 }} />}
              <span style={{ width: 14, flexShrink: 0 }} />
              {visibleColumns.has("file") && <span style={{ flex: 2 }}>File / ID</span>}
              {visibleColumns.has("rootCause") && <span style={{ flex: 3 }}>Root Cause / Summary</span>}
              {visibleColumns.has("severity") && <span style={{ width: 68, flexShrink: 0 }}>Severity</span>}
              {visibleColumns.has("status") && <span style={{ width: 90, flexShrink: 0 }}>Type</span>}
              {visibleColumns.has("component") && <span style={{ flex: 1 }}>Component</span>}
              {visibleColumns.has("cost") && <span style={{ width: 52, flexShrink: 0, textAlign: "right" }}>Cost</span>}
              <span style={{ width: 56, flexShrink: 0, textAlign: "right" }}>Actions</span>
            </div>

            {/* Scrollable list */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              {Object.entries(groupedUnifiedItems).map(([groupLabel, groupItems]) => (
                <div key={groupLabel || "__default"}>
                  {groupBy !== "none" && groupLabel && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 14px", marginTop: 4 }}>
                      <div style={{ width: 3, height: 13, borderRadius: 2, background: "var(--hd-text-dim)", flexShrink: 0 }} />
                      <span style={{ color: "var(--hd-text)", fontSize: "var(--hd-font-2xs)", fontWeight: 600, fontFamily: MONO }}>{groupLabel}</span>
                      <span style={{ color: "var(--hd-text-dim)", fontSize: "var(--hd-font-3xs)", fontFamily: MONO }}>({groupItems.length})</span>
                      <div style={{ flex: 1, height: 1, background: "var(--hd-border-subtle)" }} />
                    </div>
                  )}
                  {groupItems.map(item => {
                    const isActive = item.kind === "analysis"
                      ? previewAnalysis?.id === (item.data as Analysis).id
                      : previewJiraBrief?.jira_key === (item.data as TicketBrief).jira_key;

                    const handleRowClick = () => {
                      if (selectionMode && item.kind === "analysis") {
                        handleSelectAnalysis((item.data as Analysis).id, false);
                        return;
                      }
                      if (item.kind === "analysis") { setPreviewAnalysis(item.data as Analysis); setPreviewJiraBrief(null); }
                      else { setPreviewJiraBrief(item.data as TicketBrief); setPreviewAnalysis(null); }
                    };

                    const ti = getTypeInfo(item.kind, item.kind === "analysis" ? (item.data as Analysis).analysis_type : undefined);
                    const sev = item.kind === "analysis" ? (item.data as Analysis).severity : ((item.data as TicketBrief).severity || "medium");
                    const sc = SEV_COL[sev.toLowerCase()] || "var(--hd-text-muted)";

                    return (
                      <div
                        key={item.kind === "analysis" ? `a-${(item.data as Analysis).id}` : `j-${(item.data as TicketBrief).jira_key}`}
                        onClick={handleRowClick}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", cursor: "pointer", background: isActive ? "rgba(6,182,212,0.06)" : "transparent", borderLeft: `2px solid ${isActive ? "rgba(6,182,212,0.4)" : "transparent"}`, borderBottom: "1px solid var(--hd-bg-raised)", transition: "background .1s" }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--hd-bg-surface)"; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                      >
                        {selectionMode && item.kind === "analysis" && (
                          <input type="checkbox" checked={selectedAnalysisIds.has((item.data as Analysis).id)} onClick={e => { e.stopPropagation(); handleSelectAnalysis((item.data as Analysis).id, e.shiftKey); }} onChange={() => {}} style={{ accentColor: "#22d3ee", width: 13, height: 13, cursor: "pointer", flexShrink: 0 }} />
                        )}
                        <span style={{ color: ti.color, fontSize: "var(--hd-font-2xs)", flexShrink: 0, width: 14, textAlign: "center" }}>{ti.icon}</span>

                        {visibleColumns.has("file") && (
                          <div style={{ flex: 2, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
                              <span style={{ color: "var(--hd-text)", fontSize: "var(--hd-font-xs)", fontFamily: MONO, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.kind === "analysis" ? (item.data as Analysis).filename : (item.data as TicketBrief).jira_key}
                              </span>
                              {item.kind === "analysis" && (item.data as Analysis).is_favorite && <span style={{ color: "#fbbf24", fontSize: "var(--hd-font-3xs)", flexShrink: 0 }}>\u2605</span>}
                              {item.kind === "analysis" && goldStatusByAnalysisId[(item.data as Analysis).id] && <span style={{ fontSize: "9px", color: "#fbbf24", flexShrink: 0 }}>\u2b50</span>}
                              {item.kind === "jira" && <span style={{ fontSize: "8px", fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(139,92,246,0.15)", color: "#a78bfa", flexShrink: 0 }}>JIRA</span>}
                            </div>
                            <div style={{ color: "var(--hd-text-dim)", fontSize: "var(--hd-font-3xs)", fontFamily: MONO, marginTop: 1 }}>
                              {item.kind === "analysis" ? format(new Date((item.data as Analysis).analyzed_at), "MMM d, yyyy") : format(new Date((item.data as TicketBrief).updated_at), "MMM d, yyyy")}
                            </div>
                          </div>
                        )}

                        {visibleColumns.has("rootCause") && (
                          <div style={{ flex: 3, color: "var(--hd-text-muted)", fontSize: "var(--hd-font-2xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                            {item.kind === "analysis" ? (item.data as Analysis).root_cause : (item.data as TicketBrief).title}
                          </div>
                        )}

                        {visibleColumns.has("severity") && (
                          <div style={{ width: 68, flexShrink: 0 }}>
                            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".05em", fontFamily: MONO, color: sc, background: `${sc}18`, padding: "2px 6px", borderRadius: 3, whiteSpace: "nowrap" }}>{sev.toUpperCase()}</span>
                          </div>
                        )}

                        {visibleColumns.has("status") && (
                          <div style={{ width: 90, flexShrink: 0 }}>
                            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".04em", fontFamily: MONO, color: ti.color, background: `${ti.color}15`, padding: "2px 6px", borderRadius: 3, whiteSpace: "nowrap" }}>
                              {item.kind === "jira" ? "JIRA" : ((item.data as Analysis).analysis_type || "").toUpperCase().slice(0, 12)}
                            </span>
                          </div>
                        )}

                        {visibleColumns.has("component") && (
                          <div style={{ flex: 1, color: "var(--hd-text-dim)", fontSize: "var(--hd-font-3xs)", fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                            {item.kind === "analysis" ? ((item.data as Analysis).component || "\u2014") : ((item.data as TicketBrief).category || "\u2014")}
                          </div>
                        )}

                        {visibleColumns.has("cost") && (
                          <div style={{ width: 52, flexShrink: 0, textAlign: "right", color: "var(--hd-text-dim)", fontSize: "var(--hd-font-3xs)", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                            {item.kind === "analysis" ? `$${(item.data as Analysis).cost.toFixed(3)}` : "\u2014"}
                          </div>
                        )}

                        <div style={{ width: 56, flexShrink: 0, display: "flex", gap: 3, alignItems: "center", justifyContent: "flex-end" }}>
                          {item.kind === "analysis" && (
                            <button aria-label={(item.data as Analysis).is_favorite ? "Remove from favorites" : "Add to favorites"} title={(item.data as Analysis).is_favorite ? "Remove from favorites" : "Add to favorites"} onClick={e => { e.stopPropagation(); handleToggleFavorite((item.data as Analysis).id); }} style={{ background: "none", border: "none", cursor: "pointer", color: (item.data as Analysis).is_favorite ? "#fbbf24" : "var(--hd-text-dim)", fontSize: "var(--hd-font-sm)", padding: 2, lineHeight: 1 }}>\u2605</button>
                          )}
                          <button
                            aria-label="Delete"
                            onClick={e => { e.stopPropagation(); if (item.kind === "analysis") handleDelete((item.data as Analysis).id, (item.data as Analysis).filename); else handleDeleteJiraBrief((item.data as TicketBrief).jira_key, (item.data as TicketBrief).title); }}
                            style={{ background: "rgba(239,68,68,0.1)", border: "none", color: "#ef4444", borderRadius: 3, padding: "3px", display: "flex", alignItems: "center", cursor: "pointer" }}
                          ><Trash2 style={{ width: 11, height: 11 }} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* \u2500\u2500 Preview panel \u2500\u2500 */}
          {(previewAnalysis || previewJiraBrief) && (
            <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderLeft: "1px solid var(--hd-border-subtle)", background: "var(--hd-bg-base)" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--hd-border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <span style={{ fontSize: "var(--hd-font-3xs)", fontWeight: 700, color: "var(--hd-text)", fontFamily: MONO, letterSpacing: ".1em" }}>PREVIEW</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: "var(--hd-font-3xs)", color: "var(--hd-text-dim)", fontFamily: MONO }}>{previewAnalysis ? `#${previewAnalysis.id}` : previewJiraBrief?.jira_key}</span>
                  <button aria-label="Close preview" onClick={() => { setPreviewAnalysis(null); setPreviewJiraBrief(null); }} style={{ background: "none", border: "none", color: "var(--hd-text-dim)", cursor: "pointer", fontSize: "var(--hd-font-sm)", padding: 2 }}>\u00d7</button>
                </div>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px" }}>
                {previewAnalysis ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: SEV_COL[previewAnalysis.severity.toLowerCase()] || "var(--hd-text-muted)", background: `${SEV_COL[previewAnalysis.severity.toLowerCase()] || "var(--hd-text-muted)"}18`, padding: "2px 7px", borderRadius: 3 }}>{previewAnalysis.severity.toUpperCase()}</span>
                      <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: "#22d3ee", background: "rgba(34,211,238,0.1)", padding: "2px 7px", borderRadius: 3 }}>{previewAnalysis.analysis_type.toUpperCase()}</span>
                      {previewAnalysis.is_favorite && <span style={{ color: "#fbbf24", fontSize: "var(--hd-font-xs)" }}>\u2605</span>}
                      {goldStatusByAnalysisId[previewAnalysis.id] && <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: "#fbbf24", background: "rgba(251,191,36,0.1)", padding: "2px 7px", borderRadius: 3 }}>GOLD</span>}
                    </div>
                    <div>
                      <div style={{ fontSize: "9px", color: "var(--hd-text-dim)", fontFamily: MONO, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>Error</div>
                      <div style={{ fontSize: "var(--hd-font-2xs)", color: "var(--hd-text)", fontFamily: MONO }}>{previewAnalysis.error_type}</div>
                      {previewAnalysis.component && <div style={{ fontSize: "var(--hd-font-3xs)", color: "var(--hd-text-dim)", fontFamily: MONO, marginTop: 2 }}>in {previewAnalysis.component}</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: "9px", color: "var(--hd-text-dim)", fontFamily: MONO, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>Root Cause</div>
                      <div style={{ fontSize: "var(--hd-font-2xs)", color: "var(--hd-text-muted)", lineHeight: 1.6 }}>{previewAnalysis.root_cause}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "9px", color: "var(--hd-text-dim)", fontFamily: MONO, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>Suggested Fix</div>
                      <div style={{ fontSize: "var(--hd-font-2xs)", color: "var(--hd-text-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{String(previewAnalysis.suggested_fixes)}</div>
                    </div>
                    <div style={{ borderTop: "1px solid var(--hd-border-subtle)", paddingTop: 10, fontSize: "var(--hd-font-3xs)", color: "var(--hd-text-dim)", fontFamily: MONO, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div>{format(new Date(previewAnalysis.analyzed_at), "MMM d, yyyy 'at' h:mm a")}</div>
                      <div>{previewAnalysis.file_size_kb.toFixed(1)} KB &nbsp;\u00b7&nbsp; ${previewAnalysis.cost.toFixed(4)}</div>
                      {previewAnalysis.was_truncated && <div style={{ color: "#f59e0b" }}>\u26a0 Truncated</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Button variant="primary" size="sm" onClick={() => handleView(previewAnalysis.id)}>Open Full Detail</Button>
                      <Button variant="ghost-danger" size="sm" onClick={() => handleDelete(previewAnalysis.id, previewAnalysis.filename)}>Delete</Button>
                    </div>
                  </div>
                ) : previewJiraBrief ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: "var(--hd-font-base)", fontWeight: 700, color: "var(--hd-text)", fontFamily: MONO }}>{previewJiraBrief.jira_key}</div>
                      <div style={{ fontSize: "var(--hd-font-2xs)", color: "var(--hd-text-muted)", marginTop: 4, lineHeight: 1.5 }}>{previewJiraBrief.title}</div>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {previewJiraBrief.severity && <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: SEV_COL[previewJiraBrief.severity.toLowerCase()] || "var(--hd-text-muted)", background: `${SEV_COL[previewJiraBrief.severity.toLowerCase()] || "var(--hd-text-muted)"}18`, padding: "2px 7px", borderRadius: 3 }}>{previewJiraBrief.severity.toUpperCase()}</span>}
                      {previewJiraBrief.category && <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: "#8b5cf6", background: "rgba(139,92,246,0.12)", padding: "2px 7px", borderRadius: 3 }}>{previewJiraBrief.category}</span>}
                    </div>
                    {previewJiraBrief.brief_json && (() => {
                      try {
                        const brief = JSON.parse(previewJiraBrief.brief_json);
                        const summary = brief?.analysis?.executive_summary || brief?.analysis?.plain_summary;
                        if (!summary) return null;
                        return (
                          <div>
                            <div style={{ fontSize: "9px", color: "var(--hd-text-dim)", fontFamily: MONO, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>Brief Summary</div>
                            <div style={{ fontSize: "var(--hd-font-2xs)", color: "var(--hd-text-muted)", lineHeight: 1.6 }}>{summary}</div>
                          </div>
                        );
                      } catch { return null; }
                    })()}
                    <div style={{ borderTop: "1px solid var(--hd-border-subtle)", paddingTop: 10, fontSize: "var(--hd-font-3xs)", color: "var(--hd-text-dim)", fontFamily: MONO, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div>Updated: {format(new Date(previewJiraBrief.updated_at), "MMM d, yyyy")}</div>
                      <div>Status: {previewJiraBrief.posted_to_jira ? "Posted to JIRA" : previewJiraBrief.brief_json ? "Brief generated" : "Triaged"}</div>
                      {previewJiraBrief.engineer_rating && <div>Rating: {"\u2605".repeat(previewJiraBrief.engineer_rating)}{"\u2606".repeat(5 - previewJiraBrief.engineer_rating)}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Button variant="primary" size="sm" onClick={() => onViewJiraTicket(previewJiraBrief.jira_key)}>Open in JIRA Analyzer</Button>
                      <Button variant="ghost-danger" size="sm" onClick={() => handleDeleteJiraBrief(previewJiraBrief.jira_key, previewJiraBrief.title)}>Delete</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {/* \u2500\u2500 Bulk Action Bar \u2500\u2500 */}
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
