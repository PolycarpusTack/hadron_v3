/**
 * DateRangePicker - Filter by date range presets or custom dates
 */

import { useState, useRef, useEffect, useCallback, memo } from "react";
import type { DateRangePreset, DateRangeFilter } from "../types";

interface DateRangePickerProps {
  value: DateRangeFilter;
  onChange: (value: DateRangeFilter) => void;
  className?: string;
}

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "allTime", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7days", label: "Last 7 Days" },
  { value: "last30days", label: "Last 30 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "custom", label: "Custom Range" },
];

// Format ISO date string for display (e.g., "Jan 19, 2026")
const formatDateForDisplay = (dateStr: string | undefined): string => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// Format date for HTML input (YYYY-MM-DD)
const formatDateForInput = (dateStr: string | undefined): string => {
  if (!dateStr) return "";
  return dateStr.split("T")[0];
};

// Get current date as ISO string
const getISODateString = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

export const DateRangePicker = memo(function DateRangePicker({
  value,
  onChange,
  className = "",
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get display label for current selection
  const getDisplayLabel = useCallback((): string => {
    const preset = PRESETS.find((p) => p.value === value.preset);
    if (value.preset === "custom" && value.customRange) {
      const start = formatDateForDisplay(value.customRange.start);
      const end = formatDateForDisplay(value.customRange.end);
      return `${start} - ${end}`;
    }
    return preset?.label || "All Time";
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle preset selection
  const handlePresetSelect = (preset: DateRangePreset) => {
    if (preset === "custom") {
      // Set default custom range to last 30 days
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      onChange({
        preset: "custom",
        customRange: {
          start: getISODateString(start),
          end: getISODateString(end),
        },
      });
    } else {
      onChange({ preset });
      setIsOpen(false);
    }
  };

  // Handle custom date changes
  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateValue = e.target.value;
    if (dateValue && value.customRange) {
      onChange({
        preset: "custom",
        customRange: { start: dateValue, end: value.customRange.end },
      });
    }
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateValue = e.target.value;
    if (dateValue && value.customRange) {
      onChange({
        preset: "custom",
        customRange: { start: value.customRange.start, end: dateValue },
      });
    }
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600
                   rounded-lg text-sm text-gray-200 transition-colors border border-gray-600"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span>{getDisplayLabel()}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          className="absolute z-50 mt-1 w-64 bg-gray-800 rounded-lg shadow-xl
                     border border-gray-700 overflow-hidden"
        >
          {/* Preset Options */}
          <div className="p-2">
            <div className="text-xs text-gray-400 uppercase tracking-wider px-2 py-1 mb-1">
              Date Range
            </div>
            {PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handlePresetSelect(preset.value)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors
                  ${
                    value.preset === preset.value
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom Date Inputs */}
          {value.preset === "custom" && (
            <div className="border-t border-gray-700 p-3 space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={formatDateForInput(value.customRange?.start)}
                  onChange={handleStartDateChange}
                  max={formatDateForInput(value.customRange?.end)}
                  className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-md
                           text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={formatDateForInput(value.customRange?.end)}
                  onChange={handleEndDateChange}
                  min={formatDateForInput(value.customRange?.start)}
                  max={getISODateString(new Date())}
                  className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-md
                           text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white
                         text-sm rounded-md transition-colors"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default DateRangePicker;
