import { useState, useEffect, useMemo } from "react";
import {
  Search,
  Filter,
  Tag,
  ChevronDown,
  ChevronRight,
  Database,
  AlertTriangle,
  Cpu,
  Layers,
  Monitor,
  Clock,
  GitBranch,
  Loader2,
  X,
  RefreshCw,
} from "lucide-react";
import type { PatternSummary } from "../types";
import {
  listPatterns,
  getPatternsByCategory,
  getPatternsByTag,
  getPatternTags,
  getPatternCategories,
} from "../services/api";

interface PatternBrowserProps {
  onPatternSelect?: (pattern: PatternSummary) => void;
}

const CATEGORY_ICONS: Record<string, JSX.Element> = {
  CollectionError: <Layers className="w-4 h-4" />,
  NullReference: <AlertTriangle className="w-4 h-4" />,
  DatabaseError: <Database className="w-4 h-4" />,
  TypeError: <GitBranch className="w-4 h-4" />,
  MemoryError: <Cpu className="w-4 h-4" />,
  ConcurrencyError: <Clock className="w-4 h-4" />,
  BusinessLogic: <Monitor className="w-4 h-4" />,
  Configuration: <Layers className="w-4 h-4" />,
  WhatsOnSpecific: <Database className="w-4 h-4" />,
  Other: <Layers className="w-4 h-4" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  CollectionError: "text-purple-400 bg-purple-500/20",
  NullReference: "text-red-400 bg-red-500/20",
  DatabaseError: "text-blue-400 bg-blue-500/20",
  TypeError: "text-orange-400 bg-orange-500/20",
  MemoryError: "text-pink-400 bg-pink-500/20",
  ConcurrencyError: "text-yellow-400 bg-yellow-500/20",
  BusinessLogic: "text-green-400 bg-green-500/20",
  Configuration: "text-cyan-400 bg-cyan-500/20",
  WhatsOnSpecific: "text-emerald-400 bg-emerald-500/20",
  Other: "text-gray-400 bg-gray-500/20",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-red-500/20 text-red-400 border-red-500/30",
  2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  3: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  4: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  5: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export default function PatternBrowser({ onPatternSelect }: PatternBrowserProps) {
  const [patterns, setPatterns] = useState<PatternSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showEnabledOnly, setShowEnabledOnly] = useState(false);

  // UI State
  const [expandedPatterns, setExpandedPatterns] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Load initial data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [patternsData, categoriesData, tagsData] = await Promise.all([
        listPatterns(),
        getPatternCategories(),
        getPatternTags(),
      ]);

      setPatterns(patternsData);
      setCategories(categoriesData);
      setTags(tagsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load patterns");
    } finally {
      setLoading(false);
    }
  };

  // Filter by category
  const handleCategoryFilter = async (category: string | null) => {
    setSelectedCategory(category);
    setLoading(true);

    try {
      if (category) {
        const filtered = await getPatternsByCategory(category);
        setPatterns(filtered);
      } else {
        const all = await listPatterns();
        setPatterns(all);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to filter patterns");
    } finally {
      setLoading(false);
    }
  };

  // Filter by tag
  const handleTagFilter = async (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];

    setSelectedTags(newTags);

    if (newTags.length === 0 && !selectedCategory) {
      // Reset to all patterns
      setLoading(true);
      try {
        const all = await listPatterns();
        setPatterns(all);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load patterns");
      } finally {
        setLoading(false);
      }
    } else if (newTags.length === 1 && !selectedCategory) {
      // Single tag filter
      setLoading(true);
      try {
        const filtered = await getPatternsByTag(newTags[0]);
        setPatterns(filtered);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to filter patterns");
      } finally {
        setLoading(false);
      }
    }
    // For multiple tags, we filter locally from the current patterns
  };

  // Clear all filters
  const clearFilters = async () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setSelectedTags([]);
    setShowEnabledOnly(false);
    setLoading(true);

    try {
      const all = await listPatterns();
      setPatterns(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load patterns");
    } finally {
      setLoading(false);
    }
  };

  // Filtered patterns
  const filteredPatterns = useMemo(() => {
    let result = patterns;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query)
      );
    }

    // Filter by enabled status
    if (showEnabledOnly) {
      result = result.filter((p) => p.enabled);
    }

    // Sort by priority (highest first)
    result = [...result].sort((a, b) => b.priority - a.priority);

    return result;
  }, [patterns, searchQuery, showEnabledOnly]);

  // Toggle pattern expansion
  const togglePatternExpanded = (patternId: string) => {
    setExpandedPatterns((prev) => {
      const next = new Set(prev);
      if (next.has(patternId)) {
        next.delete(patternId);
      } else {
        next.add(patternId);
      }
      return next;
    });
  };

  const hasActiveFilters =
    searchQuery.trim() || selectedCategory || selectedTags.length > 0 || showEnabledOnly;

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search patterns..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
            >
              <X className="w-3 h-3 text-gray-400" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 rounded-lg border transition flex items-center gap-2 ${
            showFilters || hasActiveFilters
              ? "bg-blue-500/20 border-blue-500/50 text-blue-400"
              : "bg-gray-900 border-gray-700 hover:border-gray-600"
          }`}
        >
          <Filter className="w-4 h-4" />
          {hasActiveFilters && (
            <span className="text-xs bg-blue-500/30 px-1.5 py-0.5 rounded">
              {(selectedCategory ? 1 : 0) + selectedTags.length + (showEnabledOnly ? 1 : 0)}
            </span>
          )}
        </button>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg hover:border-gray-600 transition"
          title="Refresh patterns"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="p-4 bg-gray-900/50 border border-gray-700 rounded-lg space-y-4">
          {/* Categories */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">Categories</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() =>
                    handleCategoryFilter(selectedCategory === category ? null : category)
                  }
                  className={`px-3 py-1 text-xs rounded-full border transition flex items-center gap-1.5 ${
                    selectedCategory === category
                      ? CATEGORY_COLORS[category] || "bg-gray-500/20 text-gray-400"
                      : "bg-gray-800 border-gray-700 hover:border-gray-600"
                  } ${selectedCategory === category ? "border-transparent" : ""}`}
                >
                  {CATEGORY_ICONS[category] || <Layers className="w-3 h-3" />}
                  {category.replace("Error", "")}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2">Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {tags.slice(0, 12).map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleTagFilter(tag)}
                    className={`px-2 py-0.5 text-xs rounded-full border transition flex items-center gap-1 ${
                      selectedTags.includes(tag)
                        ? "bg-green-500/20 border-green-500/50 text-green-400"
                        : "bg-gray-800 border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    <Tag className="w-3 h-3" />
                    {tag}
                  </button>
                ))}
                {tags.length > 12 && (
                  <span className="text-xs text-gray-500 px-2 py-0.5">
                    +{tags.length - 12} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Options */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={showEnabledOnly}
                onChange={(e) => setShowEnabledOnly(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              Show enabled only
            </label>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-blue-400 hover:text-blue-300 transition"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Pattern List */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          </div>
        ) : filteredPatterns.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No patterns found</p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-blue-400 hover:text-blue-300 mt-2"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          filteredPatterns.map((pattern) => (
            <div
              key={pattern.id}
              className={`bg-gray-900/50 border rounded-lg overflow-hidden transition ${
                pattern.enabled ? "border-gray-700" : "border-gray-800 opacity-60"
              }`}
            >
              {/* Pattern Header */}
              <button
                onClick={() => togglePatternExpanded(pattern.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-gray-800/50 transition text-left"
              >
                {expandedPatterns.has(pattern.id) ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                )}

                <div
                  className={`p-1.5 rounded-lg flex-shrink-0 ${
                    CATEGORY_COLORS[pattern.category] || "bg-gray-500/20 text-gray-400"
                  }`}
                >
                  {CATEGORY_ICONS[pattern.category] || <Layers className="w-4 h-4" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{pattern.name}</p>
                  <p className="text-xs text-gray-500 truncate">{pattern.id}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`px-2 py-0.5 text-xs rounded border ${
                      PRIORITY_COLORS[pattern.priority] ||
                      "bg-gray-500/20 text-gray-400 border-gray-500/30"
                    }`}
                  >
                    P{pattern.priority}
                  </span>
                  {!pattern.enabled && (
                    <span className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-500">
                      Disabled
                    </span>
                  )}
                </div>
              </button>

              {/* Expanded Details */}
              {expandedPatterns.has(pattern.id) && (
                <div className="px-3 pb-3 pt-0 border-t border-gray-800">
                  <div className="pl-7 pt-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Category:</span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          CATEGORY_COLORS[pattern.category] || "bg-gray-500/20 text-gray-400"
                        }`}
                      >
                        {pattern.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Priority:</span>
                      <span>{pattern.priority} (higher = more important)</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Status:</span>
                      <span className={pattern.enabled ? "text-green-400" : "text-gray-500"}>
                        {pattern.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    {onPatternSelect && (
                      <button
                        onClick={() => onPatternSelect(pattern)}
                        className="mt-2 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                      >
                        View Details
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Summary */}
      {!loading && filteredPatterns.length > 0 && (
        <div className="text-xs text-gray-500 text-center">
          Showing {filteredPatterns.length} of {patterns.length} patterns
        </div>
      )}
    </div>
  );
}
