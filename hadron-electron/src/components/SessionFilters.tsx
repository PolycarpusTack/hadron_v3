/**
 * SessionFilters — Filter bar for the chat session sidebar
 *
 * Provides search, metadata filters, and date range quick buttons.
 * All filtering is client-side via the exported pure `filterSessions()` function.
 */

import { useState, useEffect, useRef } from "react";
import { Search, X, Filter } from "lucide-react";
import type { ChatSession } from "../services/chat";

// ============================================================================
// Types
// ============================================================================

export interface FilterState {
  search: string;
  customer: string;
  wonVersion: string;
  status: "all" | "starred" | "has_summary" | "has_gold";
  dateRange: "7d" | "30d" | "90d" | "all";
}

export const DEFAULT_FILTERS: FilterState = {
  search: "",
  customer: "",
  wonVersion: "",
  status: "all",
  dateRange: "all",
};

// ============================================================================
// Pure Filter Function
// ============================================================================

export function filterSessions(
  sessions: ChatSession[],
  filters: FilterState
): ChatSession[] {
  const now = Date.now();
  const dayMs = 86_400_000;

  return sessions.filter((s) => {
    // Search: matches title or session ID
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const matchesTitle = s.title.toLowerCase().includes(q);
      const matchesId = s.id.toLowerCase().includes(q);
      if (!matchesTitle && !matchesId) return false;
    }

    // Customer filter
    if (filters.customer) {
      const c = filters.customer.toLowerCase();
      if (!s.customer || !s.customer.toLowerCase().includes(c)) return false;
    }

    // WON Version filter
    if (filters.wonVersion) {
      const v = filters.wonVersion.toLowerCase();
      if (!s.wonVersion || !s.wonVersion.toLowerCase().includes(v))
        return false;
    }

    // Status filter
    if (filters.status === "starred" && !s.isStarred) return false;
    if (filters.status === "has_summary" && !s.hasSummary) return false;
    if (filters.status === "has_gold" && !s.hasGoldAnswers) return false;

    // Date range filter
    if (filters.dateRange !== "all") {
      const days =
        filters.dateRange === "7d"
          ? 7
          : filters.dateRange === "30d"
            ? 30
            : 90;
      const cutoff = now - days * dayMs;
      if (s.updatedAt < cutoff) return false;
    }

    return true;
  });
}

// ============================================================================
// Component
// ============================================================================

interface SessionFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export default function SessionFilters({
  filters,
  onFiltersChange,
}: SessionFiltersProps) {
  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  function handleSearchChange(value: string) {
    // Update immediately for display
    const newFilters = { ...filters, search: value };
    // Debounce the actual filter callback
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onFiltersChange(newFilters);
    }, 200);
  }

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function updateFilter<K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) {
    onFiltersChange({ ...filters, [key]: value });
  }

  const hasActiveFilters =
    filters.customer ||
    filters.wonVersion ||
    filters.status !== "all" ||
    filters.dateRange !== "all";

  return (
    <div className="space-y-2">
      {/* Search bar */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            defaultValue={filters.search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search sessions..."
            className="w-full pl-8 pr-3 py-1.5 rounded bg-gray-900 border border-gray-700 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-1.5 rounded transition ${
            showFilters || hasActiveFilters
              ? "bg-emerald-900/30 text-emerald-400 border border-emerald-800/30"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-700"
          }`}
          title="Filters"
        >
          <Filter className="w-3.5 h-3.5" />
        </button>
        {hasActiveFilters && (
          <button
            onClick={() => onFiltersChange(DEFAULT_FILTERS)}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition"
            title="Clear filters"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="space-y-2 px-1">
          {/* Customer + WON version */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 mb-0.5">
                Customer
              </label>
              <input
                type="text"
                value={filters.customer}
                onChange={(e) => updateFilter("customer", e.target.value)}
                placeholder="Filter..."
                className="w-full px-2 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 mb-0.5">
                WON Version
              </label>
              <input
                type="text"
                value={filters.wonVersion}
                onChange={(e) => updateFilter("wonVersion", e.target.value)}
                placeholder="Filter..."
                className="w-full px-2 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>

          {/* Status filter */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">
              Status
            </label>
            <div className="flex gap-1">
              {(
                [
                  ["all", "All"],
                  ["starred", "Starred"],
                  ["has_summary", "Has Summary"],
                  ["has_gold", "Has Gold"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => updateFilter("status", value)}
                  className={`px-2 py-0.5 rounded text-[10px] transition ${
                    filters.status === value
                      ? "bg-emerald-900/40 text-emerald-400 border border-emerald-800/30"
                      : "text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">
              Date Range
            </label>
            <div className="flex gap-1">
              {(
                [
                  ["7d", "7d"],
                  ["30d", "30d"],
                  ["90d", "90d"],
                  ["all", "All"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => updateFilter("dateRange", value)}
                  className={`px-2 py-0.5 rounded text-[10px] transition ${
                    filters.dateRange === value
                      ? "bg-emerald-900/40 text-emerald-400 border border-emerald-800/30"
                      : "text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
