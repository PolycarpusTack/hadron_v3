/**
 * Memoized list item components for HistoryView
 *
 * These components are wrapped with React.memo to prevent unnecessary re-renders
 * when the parent list updates but the individual item hasn't changed.
 */

import { memo, useCallback, useState } from "react";
import { Eye, Trash2, Star, Languages, Check } from "lucide-react";
import { format } from "date-fns";
import type { Analysis, Translation } from "../services/api";
import type { Tag } from "../types";
import { TagPicker } from "./TagPicker";
import { TagBadge } from "./TagBadge";

// ============================================================================
// Analysis List Item
// ============================================================================

interface AnalysisListItemProps {
  analysis: Analysis;
  onView: (id: number) => void;
  onDelete: (id: number, filename: string) => void;
  onToggleFavorite: (id: number) => void;
  // Selection mode props
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: number, shiftKey: boolean) => void;
}

function getSeverityColor(severity: string): string {
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
}

export const AnalysisListItem = memo(function AnalysisListItem({
  analysis,
  onView,
  onDelete,
  onToggleFavorite,
  selectionMode = false,
  isSelected = false,
  onSelect,
}: AnalysisListItemProps) {
  // Track tags locally for display
  const [tags, setTags] = useState<Tag[]>([]);

  // Memoize handlers to prevent new function references on each render
  const handleView = useCallback(() => onView(analysis.id), [analysis.id, onView]);
  const handleDelete = useCallback(
    () => onDelete(analysis.id, analysis.filename),
    [analysis.id, analysis.filename, onDelete]
  );
  const handleToggleFavorite = useCallback(
    () => onToggleFavorite(analysis.id),
    [analysis.id, onToggleFavorite]
  );
  const handleSelect = useCallback(
    (e: React.MouseEvent) => {
      if (onSelect) {
        onSelect(analysis.id, e.shiftKey);
      }
    },
    [analysis.id, onSelect]
  );

  return (
    <div
      className={`bg-gray-800/50 border rounded-lg p-4 hover:border-gray-600 transition ${
        isSelected
          ? "border-blue-500 bg-blue-500/10"
          : "border-gray-700"
      } ${selectionMode ? "cursor-pointer" : ""}`}
      onClick={selectionMode ? handleSelect : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Selection checkbox */}
        {selectionMode && (
          <div
            className={`flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition ${
              isSelected
                ? "bg-blue-500 border-blue-500"
                : "border-gray-500 hover:border-blue-400"
            }`}
          >
            {isSelected && <Check className="w-4 h-4 text-white" />}
          </div>
        )}
        {/* Left: File info and severity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
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
                analysis.analysis_type === "whatson"
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                  : analysis.analysis_type === "specialized"
                    ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                    : "bg-blue-500/20 text-blue-400 border-blue-500/30"
              }`}
            >
              {analysis.analysis_type === "whatson"
                ? "WHATS'ON"
                : analysis.analysis_type === "specialized"
                  ? "SPECIALIZED"
                  : "COMPLETE"}
            </span>
            {/* Token-safe analysis mode badge */}
            {analysis.analysis_mode && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                analysis.analysis_mode === "Deep Scan"
                  ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                  : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
              }`}>
                {analysis.analysis_mode}
              </span>
            )}
            {/* Tags display */}
            {tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {tags.map(tag => (
                  <TagBadge key={tag.id} tag={tag} size="sm" />
                ))}
              </div>
            )}
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
              <span>-</span>
              <span>{analysis.file_size_kb.toFixed(1)} KB</span>
              <span>-</span>
              <span>${analysis.cost.toFixed(4)}</span>
              {analysis.was_truncated && (
                <>
                  <span>-</span>
                  <span className="text-yellow-400">Truncated</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        {!selectionMode && (
          <div className="flex items-center gap-2">
            <TagPicker
              itemId={analysis.id}
              itemType="analysis"
              onTagsChange={setTags}
            />
            <button
              onClick={handleToggleFavorite}
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
              onClick={handleView}
              className="p-2 hover:bg-gray-700 rounded-lg transition"
              title="View Details"
            >
              <Eye className="w-5 h-5" />
            </button>
            <button
              onClick={handleDelete}
              className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition"
              title="Delete"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// Translation List Item
// ============================================================================

interface TranslationListItemProps {
  translation: Translation;
  onDelete: (id: number) => void;
  onToggleFavorite: (id: number) => void;
  // Selection mode props
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: number, shiftKey: boolean) => void;
}

export const TranslationListItem = memo(function TranslationListItem({
  translation,
  onDelete,
  onToggleFavorite,
  selectionMode = false,
  isSelected = false,
  onSelect,
}: TranslationListItemProps) {
  // Track tags locally for display
  const [tags, setTags] = useState<Tag[]>([]);

  // Memoize handlers
  const handleDelete = useCallback(() => onDelete(translation.id), [translation.id, onDelete]);
  const handleToggleFavorite = useCallback(
    () => onToggleFavorite(translation.id),
    [translation.id, onToggleFavorite]
  );
  const handleSelect = useCallback(
    (e: React.MouseEvent) => {
      if (onSelect) {
        onSelect(translation.id, e.shiftKey);
      }
    },
    [translation.id, onSelect]
  );

  return (
    <div
      className={`bg-gray-800/50 border rounded-lg p-4 hover:border-blue-600/50 transition ${
        isSelected
          ? "border-blue-500 bg-blue-500/10"
          : "border-blue-700/30"
      } ${selectionMode ? "cursor-pointer" : ""}`}
      onClick={selectionMode ? handleSelect : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Selection checkbox */}
        {selectionMode && (
          <div
            className={`flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition ${
              isSelected
                ? "bg-blue-500 border-blue-500"
                : "border-gray-500 hover:border-blue-400"
            }`}
          >
            {isSelected && <Check className="w-4 h-4 text-white" />}
          </div>
        )}
        {/* Left: Translation content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <Languages className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold text-lg text-blue-400">Translation</h3>
            {/* Tags display */}
            {tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {tags.map(tag => (
                  <TagBadge key={tag.id} tag={tag} size="sm" />
                ))}
              </div>
            )}
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
              <p className="mt-1 line-clamp-3">{translation.translation}</p>
            </div>
            <div className="flex items-center gap-4 text-gray-400 text-xs">
              <span>
                {format(new Date(translation.translated_at), "MMM d, yyyy 'at' h:mm a")}
              </span>
              <span>-</span>
              <span>{translation.ai_provider}</span>
              <span>-</span>
              <span>{translation.ai_model}</span>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        {!selectionMode && (
          <div className="flex items-center gap-2">
            <TagPicker
              itemId={translation.id}
              itemType="translation"
              onTagsChange={setTags}
            />
            <button
              onClick={handleToggleFavorite}
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
              onClick={handleDelete}
              className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition"
              title="Delete"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
