/**
 * AdvancedFilterPanel - Expanded filter options dropdown
 */

import { useState, useRef, useEffect, memo } from "react";
import type { HistoryFilters, Tag } from "../types";
import { DateRangePicker } from "./DateRangePicker";
import { TagBadge } from "./TagBadge";

interface AdvancedFilterPanelProps {
  filters: HistoryFilters;
  availableTags: Tag[];
  onChange: (filters: Partial<HistoryFilters>) => void;
  onReset: () => void;
  isOpen: boolean;
  onClose: () => void;
}

// Analysis types for filtering
const ANALYSIS_TYPES = [
  { value: "whatson", label: "WHATS'ON" },
  { value: "comprehensive", label: "Comprehensive" },
  { value: "quick", label: "Quick" },
  { value: "complete", label: "Complete" },
  { value: "specialized", label: "Specialized" },
  { value: "performance", label: "Performance" },
  { value: "code", label: "Code" },
];

// Analysis modes
const ANALYSIS_MODES = [
  { value: "Quick", label: "Quick" },
  { value: "Quick (Extracted)", label: "Quick (Extracted)" },
  { value: "Deep Scan", label: "Deep Scan" },
];

// Severity levels
const SEVERITIES = [
  { value: "critical", label: "Critical", color: "bg-red-500" },
  { value: "high", label: "High", color: "bg-orange-500" },
  { value: "medium", label: "Medium", color: "bg-yellow-500" },
  { value: "low", label: "Low", color: "bg-blue-500" },
];

// Cost presets
const COST_PRESETS = [
  { value: "under1cent", label: "< 1¢", min: undefined, max: 0.01 },
  { value: "under10cents", label: "< 10¢", min: undefined, max: 0.1 },
  { value: "over10cents", label: "> 10¢", min: 0.1, max: undefined },
];

export const AdvancedFilterPanel = memo(function AdvancedFilterPanel({
  filters,
  availableTags,
  onChange,
  onReset,
  isOpen,
  onClose,
}: AdvancedFilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [costPreset, setCostPreset] = useState<string | null>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Toggle array value
  const toggleArrayValue = (
    field: "severities" | "analysisTypes" | "analysisModes",
    value: string
  ) => {
    const current = filters[field];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ [field]: updated });
  };

  // Toggle tag
  const toggleTag = (tagId: number) => {
    const current = filters.tags.tagIds;
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onChange({
      tags: { ...filters.tags, tagIds: updated },
    });
  };

  // Set cost preset
  const handleCostPreset = (preset: (typeof COST_PRESETS)[0]) => {
    setCostPreset(preset.value);
    onChange({
      cost: { min: preset.min, max: preset.max },
    });
  };

  // Set custom cost
  const handleCostChange = (field: "min" | "max", value: string) => {
    setCostPreset(null);
    const numValue = value === "" ? undefined : parseFloat(value);
    onChange({
      cost: { ...filters.cost, [field]: numValue },
    });
  };

  // Count active filters
  const activeFilterCount =
    filters.severities.length +
    filters.analysisTypes.length +
    filters.analysisModes.length +
    filters.tags.tagIds.length +
    (filters.dateRange.preset !== "allTime" ? 1 : 0) +
    (filters.cost.min !== undefined || filters.cost.max !== undefined ? 1 : 0) +
    (filters.showArchived ? 1 : 0) +
    (filters.favoritesOnly ? 1 : 0);

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-1 z-50 w-80 bg-gray-800 rounded-lg
                 shadow-xl border border-gray-700 max-h-[80vh] overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-200">
          Advanced Filters
          {activeFilterCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-blue-600 text-xs rounded-full">
              {activeFilterCount}
            </span>
          )}
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Date Range */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">
            Date Range
          </label>
          <DateRangePicker
            value={filters.dateRange}
            onChange={(dateRange) => onChange({ dateRange })}
            className="w-full"
          />
        </div>

        {/* Severity */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">
            Severity
          </label>
          <div className="flex flex-wrap gap-2">
            {SEVERITIES.map((sev) => (
              <button
                key={sev.value}
                onClick={() => toggleArrayValue("severities", sev.value)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                           transition-colors border
                  ${
                    filters.severities.includes(sev.value)
                      ? "bg-gray-600 border-gray-500 text-white"
                      : "bg-gray-700/50 border-gray-700 text-gray-400 hover:bg-gray-700"
                  }`}
              >
                <span className={`w-2 h-2 rounded-full ${sev.color}`} />
                {sev.label}
              </button>
            ))}
          </div>
        </div>

        {/* Analysis Type */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">
            Analysis Type
          </label>
          <div className="flex flex-wrap gap-2">
            {ANALYSIS_TYPES.map((type) => (
              <button
                key={type.value}
                onClick={() => toggleArrayValue("analysisTypes", type.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border
                  ${
                    filters.analysisTypes.includes(type.value)
                      ? "bg-blue-600/30 border-blue-500 text-blue-300"
                      : "bg-gray-700/50 border-gray-700 text-gray-400 hover:bg-gray-700"
                  }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Analysis Mode */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">
            Analysis Mode
          </label>
          <div className="space-y-1">
            {ANALYSIS_MODES.map((mode) => (
              <label
                key={mode.value}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={filters.analysisModes.includes(mode.value)}
                  onChange={() => toggleArrayValue("analysisModes", mode.value)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600
                           focus:ring-blue-500 focus:ring-offset-gray-800"
                />
                <span className="text-sm text-gray-300">{mode.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Cost Range */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">
            Cost Range
          </label>
          <div className="flex gap-2 mb-2">
            {COST_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handleCostPreset(preset)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border
                  ${
                    costPreset === preset.value
                      ? "bg-green-600/30 border-green-500 text-green-300"
                      : "bg-gray-700/50 border-gray-700 text-gray-400 hover:bg-gray-700"
                  }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Min $"
                value={filters.cost.min ?? ""}
                onChange={(e) => handleCostChange("min", e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded
                         text-sm text-gray-200 placeholder-gray-500
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <span className="text-gray-500">to</span>
            <div className="flex-1">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Max $"
                value={filters.cost.max ?? ""}
                onChange={(e) => handleCostChange("max", e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded
                         text-sm text-gray-200 placeholder-gray-500
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Tags */}
        {availableTags.length > 0 && (
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">
              Tags
              <span className="ml-2 text-gray-500 normal-case">
                ({filters.tags.mode === "any" ? "match any" : "match all"})
              </span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {availableTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`transition-opacity ${
                    filters.tags.tagIds.includes(tag.id)
                      ? "opacity-100"
                      : "opacity-50 hover:opacity-75"
                  }`}
                >
                  <TagBadge tag={tag} size="sm" />
                </button>
              ))}
            </div>
            {/* Tag mode toggle */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-400">Match:</span>
              <button
                onClick={() =>
                  onChange({ tags: { ...filters.tags, mode: "any" } })
                }
                className={`px-2 py-0.5 rounded text-xs transition-colors
                  ${
                    filters.tags.mode === "any"
                      ? "bg-gray-600 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
              >
                Any
              </button>
              <button
                onClick={() =>
                  onChange({ tags: { ...filters.tags, mode: "all" } })
                }
                className={`px-2 py-0.5 rounded text-xs transition-colors
                  ${
                    filters.tags.mode === "all"
                      ? "bg-gray-600 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
              >
                All
              </button>
            </div>
          </div>
        )}

        {/* Options */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">
            Options
          </label>
          <div className="space-y-1">
            <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700/50 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showArchived}
                onChange={(e) => onChange({ showArchived: e.target.checked })}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600
                         focus:ring-blue-500 focus:ring-offset-gray-800"
              />
              <span className="text-sm text-gray-300">Show archived items</span>
            </label>
            <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700/50 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.favoritesOnly}
                onChange={(e) => onChange({ favoritesOnly: e.target.checked })}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600
                         focus:ring-blue-500 focus:ring-offset-gray-800"
              />
              <span className="text-sm text-gray-300">Favorites only</span>
            </label>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 bg-gray-800/80">
        <button
          onClick={onReset}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          Reset All
        </button>
        <button
          onClick={onClose}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm
                   font-medium rounded-lg transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
});

export default AdvancedFilterPanel;
