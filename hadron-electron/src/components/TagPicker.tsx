/**
 * TagPicker Component
 * Dropdown component for selecting and managing tags on items
 * Supports creating new tags inline
 */

import { useState, useEffect, useRef } from 'react';
import { Tag, TAG_COLORS, TagColorKey } from '../types';
import { TagBadge } from './TagBadge';
import logger from '../services/logger';
import {
  getAllTags,
  createTag,
  addTagToAnalysis,
  removeTagFromAnalysis,
  addTagToTranslation,
  removeTagFromTranslation,
  getTagsForAnalysis,
  getTagsForTranslation,
} from '../services/api';

interface TagPickerProps {
  itemId: number;
  itemType: 'analysis' | 'translation';
  onTagsChange?: (tags: Tag[]) => void;
}

export function TagPicker({ itemId, itemType, onTagsChange }: TagPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [itemTags, setItemTags] = useState<Tag[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTagColor, setNewTagColor] = useState<TagColorKey>('blue');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load tags on mount
  useEffect(() => {
    loadTags();
  }, [itemId, itemType]);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setIsCreating(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const loadTags = async () => {
    try {
      setLoading(true);
      setError(null);
      const [tags, currentTags] = await Promise.all([
        getAllTags(),
        itemType === 'analysis'
          ? getTagsForAnalysis(itemId)
          : getTagsForTranslation(itemId),
      ]);
      setAllTags(tags);
      setItemTags(currentTags);
      onTagsChange?.(currentTags);
    } catch (err) {
      setError('Failed to load tags');
      logger.error('Error loading tags', { error: err });
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = async (tag: Tag) => {
    try {
      setError(null);
      if (itemType === 'analysis') {
        await addTagToAnalysis(itemId, tag.id);
      } else {
        await addTagToTranslation(itemId, tag.id);
      }
      const newItemTags = [...itemTags, tag];
      setItemTags(newItemTags);
      onTagsChange?.(newItemTags);
      // Refresh all tags to update usage counts
      const refreshedTags = await getAllTags();
      setAllTags(refreshedTags);
    } catch (err) {
      setError('Failed to add tag');
      logger.error('Error adding tag', { error: err });
    }
  };

  const handleRemoveTag = async (tag: Tag) => {
    try {
      setError(null);
      if (itemType === 'analysis') {
        await removeTagFromAnalysis(itemId, tag.id);
      } else {
        await removeTagFromTranslation(itemId, tag.id);
      }
      const newItemTags = itemTags.filter(t => t.id !== tag.id);
      setItemTags(newItemTags);
      onTagsChange?.(newItemTags);
      // Refresh all tags to update usage counts
      const refreshedTags = await getAllTags();
      setAllTags(refreshedTags);
    } catch (err) {
      setError('Failed to remove tag');
      logger.error('Error removing tag', { error: err });
    }
  };

  const handleCreateTag = async () => {
    if (!searchQuery.trim()) return;

    try {
      setError(null);
      const color = TAG_COLORS[newTagColor].hex;
      const newTag = await createTag(searchQuery.trim(), color);

      // Add the new tag to this item
      if (itemType === 'analysis') {
        await addTagToAnalysis(itemId, newTag.id);
      } else {
        await addTagToTranslation(itemId, newTag.id);
      }

      const newItemTags = [...itemTags, newTag];
      setItemTags(newItemTags);
      onTagsChange?.(newItemTags);

      // Refresh all tags
      const refreshedTags = await getAllTags();
      setAllTags(refreshedTags);

      setSearchQuery('');
      setIsCreating(false);
    } catch (err) {
      setError('Failed to create tag');
      logger.error('Error creating tag', { error: err });
    }
  };

  // Filter available tags (not already assigned to this item)
  const availableTags = allTags.filter(
    tag => !itemTags.some(t => t.id === tag.id)
  );

  // Filter by search query
  const filteredTags = searchQuery
    ? availableTags.filter(tag =>
        tag.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : availableTags;

  // Check if search query matches an existing tag
  const exactMatch = allTags.find(
    tag => tag.name.toLowerCase() === searchQuery.toLowerCase()
  );

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Tag icon button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors"
        title="Manage tags"
        aria-label="Manage tags"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        {itemTags.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
            {itemTags.length}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl right-0">
          {/* Current tags */}
          {itemTags.length > 0 && (
            <div className="p-2 border-b border-gray-700">
              <div className="text-xs text-gray-500 mb-1">Current tags</div>
              <div className="flex flex-wrap gap-1">
                {itemTags.map(tag => (
                  <TagBadge
                    key={tag.id}
                    tag={tag}
                    onRemove={() => handleRemoveTag(tag)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Search input */}
          <div className="p-2">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search or create tag..."
              className="w-full px-2 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 text-gray-200"
              onKeyDown={e => {
                if (e.key === 'Enter' && searchQuery && !exactMatch) {
                  setIsCreating(true);
                }
              }}
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="px-2 pb-2">
              <div className="text-xs text-red-400">{error}</div>
            </div>
          )}

          {/* Create new tag UI */}
          {isCreating && searchQuery && !exactMatch && (
            <div className="px-2 pb-2 border-b border-gray-700">
              <div className="text-xs text-gray-500 mb-1">Create new tag</div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {(Object.keys(TAG_COLORS) as TagColorKey[]).slice(0, 9).map(colorKey => (
                    <button
                      key={colorKey}
                      onClick={() => setNewTagColor(colorKey)}
                      className={`w-4 h-4 rounded-full border-2 ${
                        newTagColor === colorKey ? 'border-white' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: TAG_COLORS[colorKey].hex }}
                      title={colorKey}
                    />
                  ))}
                </div>
                <button
                  onClick={handleCreateTag}
                  className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {/* Available tags list */}
          <div className="max-h-48 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
            ) : filteredTags.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                {searchQuery && !exactMatch ? (
                  <button
                    onClick={() => setIsCreating(true)}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    + Create "{searchQuery}"
                  </button>
                ) : availableTags.length === 0 ? (
                  'All tags assigned'
                ) : (
                  'No matching tags'
                )}
              </div>
            ) : (
              <div className="p-1">
                {filteredTags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => handleAddTag(tag)}
                    className="w-full px-2 py-1.5 text-left hover:bg-gray-700/50 rounded flex items-center justify-between group"
                  >
                    <TagBadge tag={tag} />
                    <span className="text-xs text-gray-500 group-hover:text-gray-400">
                      {tag.usageCount} uses
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TagPicker;
