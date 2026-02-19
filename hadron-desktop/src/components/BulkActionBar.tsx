/**
 * BulkActionBar - Floating action bar for bulk operations on selected items
 */

import { memo, useState, useCallback } from "react";
import { Trash2, Star, Tag, X, Check, Download } from "lucide-react";
import Button from "./ui/Button";
import type { Tag as TagType } from "../types";
import { TagBadge } from "./TagBadge";

export type SelectionType = "analysis" | "translation" | "mixed";

interface BulkActionBarProps {
  selectedCount: number;
  selectionType: SelectionType;
  availableTags: TagType[];
  onDelete: () => void;
  onFavorite: (favorite: boolean) => void;
  onAddTag: (tagId: number) => void;
  onRemoveTag: (tagId: number) => void;
  onExport?: () => void;
  onClearSelection: () => void;
  isProcessing?: boolean;
}

export const BulkActionBar = memo(function BulkActionBar({
  selectedCount,
  selectionType,
  availableTags,
  onDelete,
  onFavorite,
  onAddTag,
  onRemoveTag,
  onExport,
  onClearSelection,
  isProcessing = false,
}: BulkActionBarProps) {
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [tagMenuMode, setTagMenuMode] = useState<"add" | "remove">("add");

  // Handle tag menu
  const openTagMenu = useCallback((mode: "add" | "remove") => {
    setTagMenuMode(mode);
    setShowTagMenu(true);
  }, []);

  const handleTagSelect = useCallback(
    (tagId: number) => {
      if (tagMenuMode === "add") {
        onAddTag(tagId);
      } else {
        onRemoveTag(tagId);
      }
      setShowTagMenu(false);
    },
    [tagMenuMode, onAddTag, onRemoveTag]
  );

  if (selectedCount === 0) {
    return null;
  }

  const canTag = selectionType === "analysis"; // Tags only work with analyses for now

  return (
    <>
      {/* Backdrop for tag menu */}
      {showTagMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowTagMenu(false)}
        />
      )}

      {/* Action Bar */}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                   bg-gray-800 border border-gray-700 rounded-xl shadow-2xl
                   flex items-center gap-2 px-4 py-3"
      >
        {/* Selection Count */}
        <div className="flex items-center gap-2 pr-4 border-r border-gray-700">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Check className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-medium text-white">
              {selectedCount} selected
            </div>
            <div className="text-xs text-gray-400">
              {selectionType === "mixed"
                ? "analyses & translations"
                : selectionType === "analysis"
                ? "analyses"
                : "translations"}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Favorite */}
          <Button
            variant="ghost"
            onClick={() => onFavorite(true)}
            disabled={isProcessing}
            icon={<Star />}
            className="hover:text-yellow-400"
            title="Add to favorites"
          >
            Favorite
          </Button>

          {/* Unfavorite */}
          <Button
            variant="ghost"
            onClick={() => onFavorite(false)}
            disabled={isProcessing}
            icon={<Star />}
            title="Remove from favorites"
          >
            Unfavorite
          </Button>

          {/* Add Tag (only for analyses) */}
          {canTag && (
            <div className="relative">
              <Button
                variant="ghost"
                onClick={() => openTagMenu("add")}
                disabled={isProcessing}
                icon={<Tag />}
                className="hover:text-green-400"
                title="Add tag"
              >
                Add Tag
              </Button>

              {/* Tag Menu */}
              {showTagMenu && tagMenuMode === "add" && (
                <div
                  className="absolute bottom-full left-0 mb-2 w-48 bg-gray-800
                             border border-gray-700 rounded-lg shadow-xl overflow-hidden"
                >
                  <div className="p-2 text-xs text-gray-400 uppercase border-b border-gray-700">
                    Select tag to add
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    {availableTags.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500 text-center">
                        No tags available
                      </div>
                    ) : (
                      availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => handleTagSelect(tag.id)}
                          className="w-full p-2 rounded hover:bg-gray-700 text-left"
                        >
                          <TagBadge tag={tag} size="sm" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Remove Tag (only for analyses) */}
          {canTag && (
            <div className="relative">
              <Button
                variant="ghost"
                onClick={() => openTagMenu("remove")}
                disabled={isProcessing}
                icon={<Tag />}
                title="Remove tag"
              >
                Remove Tag
              </Button>

              {/* Tag Menu */}
              {showTagMenu && tagMenuMode === "remove" && (
                <div
                  className="absolute bottom-full left-0 mb-2 w-48 bg-gray-800
                             border border-gray-700 rounded-lg shadow-xl overflow-hidden"
                >
                  <div className="p-2 text-xs text-gray-400 uppercase border-b border-gray-700">
                    Select tag to remove
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    {availableTags.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500 text-center">
                        No tags available
                      </div>
                    ) : (
                      availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => handleTagSelect(tag.id)}
                          className="w-full p-2 rounded hover:bg-gray-700 text-left"
                        >
                          <TagBadge tag={tag} size="sm" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Export */}
          {onExport && (
            <Button
              variant="ghost"
              onClick={onExport}
              disabled={isProcessing}
              icon={<Download />}
              className="hover:text-blue-400"
              title="Export to CSV (Ctrl+E)"
            >
              Export
            </Button>
          )}

          {/* Separator */}
          <div className="w-px h-8 bg-gray-700 mx-1" />

          {/* Delete */}
          <Button
            variant="ghost-danger"
            onClick={onDelete}
            disabled={isProcessing}
            icon={<Trash2 />}
            title="Delete selected (Delete key)"
          >
            Delete
          </Button>

          {/* Separator */}
          <div className="w-px h-8 bg-gray-700 mx-1" />

          {/* Clear Selection */}
          <Button
            variant="ghost"
            onClick={onClearSelection}
            disabled={isProcessing}
            icon={<X />}
            className="hover:text-white"
            title="Clear selection"
          >
            Cancel
          </Button>
        </div>

        {/* Processing indicator */}
        {isProcessing && (
          <div className="absolute inset-0 bg-gray-800/80 rounded-xl flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Processing...
            </div>
          </div>
        )}
      </div>
    </>
  );
});

export default BulkActionBar;
