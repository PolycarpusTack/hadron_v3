/**
 * Incremental List Component
 *
 * Provides progressive loading for large lists to improve initial render time.
 * Shows a subset initially and allows loading more on demand.
 */

import { useState, useMemo, useCallback, memo } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface IncrementalListProps<T> {
  /** Array of items to render */
  items: T[];
  /** Initial number of items to show */
  initialCount?: number;
  /** Number of items to load on each "Show More" click */
  incrementCount?: number;
  /** Render function for each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Key extractor function */
  keyExtractor: (item: T) => string | number;
  /** Empty state component */
  emptyState?: React.ReactNode;
  /** Optional class name for the container */
  className?: string;
}

// ============================================================================
// Incremental List Component
// ============================================================================

function IncrementalListInner<T>({
  items,
  initialCount = 20,
  incrementCount = 20,
  renderItem,
  keyExtractor,
  emptyState,
  className = "",
}: IncrementalListProps<T>) {
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const [isLoading, setIsLoading] = useState(false);

  // Slice items to visible count
  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount]
  );

  const hasMore = visibleCount < items.length;
  const remainingCount = items.length - visibleCount;

  // Handle "Show More" with simulated loading state for UX
  const handleShowMore = useCallback(() => {
    setIsLoading(true);
    // Small delay to show loading state and prevent UI freeze
    requestAnimationFrame(() => {
      setVisibleCount((prev) => Math.min(prev + incrementCount, items.length));
      setIsLoading(false);
    });
  }, [incrementCount, items.length]);

  // Handle empty state
  if (items.length === 0) {
    return emptyState ? <>{emptyState}</> : null;
  }

  return (
    <div className={className}>
      {/* Item list */}
      <div className="space-y-3">
        {visibleItems.map((item, index) => (
          <div key={keyExtractor(item)}>{renderItem(item, index)}</div>
        ))}
      </div>

      {/* Show More button */}
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={handleShowMore}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-6 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800/50 text-gray-300 rounded-lg transition text-sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                Show More ({remainingCount} remaining)
              </>
            )}
          </button>
        </div>
      )}

      {/* Item count indicator */}
      {items.length > initialCount && (
        <div className="mt-2 text-center text-xs text-gray-500">
          Showing {visibleCount} of {items.length} items
        </div>
      )}
    </div>
  );
}

// Export memoized version
export const IncrementalList = memo(IncrementalListInner) as typeof IncrementalListInner;

// ============================================================================
// Smart List (shows all for small lists, incremental for large)
// ============================================================================

const INCREMENTAL_THRESHOLD = 30;

export function SmartList<T>({
  items,
  initialCount = 20,
  incrementCount = 20,
  renderItem,
  keyExtractor,
  emptyState,
  className,
}: IncrementalListProps<T>) {
  // Use simple rendering for small datasets
  if (items.length <= INCREMENTAL_THRESHOLD) {
    if (items.length === 0) {
      return emptyState ? <>{emptyState}</> : null;
    }

    return (
      <div className={className}>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={keyExtractor(item)}>{renderItem(item, index)}</div>
          ))}
        </div>
      </div>
    );
  }

  // Use incremental loading for larger datasets
  return (
    <IncrementalList
      items={items}
      initialCount={initialCount}
      incrementCount={incrementCount}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      emptyState={emptyState}
      className={className}
    />
  );
}

export default SmartList;
