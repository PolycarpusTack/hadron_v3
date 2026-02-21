/**
 * API Response Cache with TTL and Request Deduplication
 *
 * Provides two key optimizations:
 * 1. TTL Cache - Caches responses for a configurable duration
 * 2. Request Deduplication - Prevents concurrent duplicate requests
 */

import logger from "./logger";

// ============================================================================
// Types
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

type CacheKey = string;

// ============================================================================
// TTL Cache
// ============================================================================

/**
 * Simple TTL-based cache for API responses
 */
class TTLCache {
  private cache = new Map<CacheKey, CacheEntry<unknown>>();
  private defaultTTL: number;

  constructor(defaultTTLMs: number = 30000) {
    this.defaultTTL = defaultTTLMs;
  }

  /**
   * Get a cached value if it exists and hasn't expired
   */
  get<T>(key: CacheKey): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set a value in the cache with optional custom TTL
   */
  set<T>(key: CacheKey, data: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTTL;
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: CacheKey): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries matching a prefix
   */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size for debugging
   */
  get size(): number {
    return this.cache.size;
  }
}

// ============================================================================
// Request Deduplication
// ============================================================================

/**
 * Prevents concurrent duplicate requests by returning the same promise
 * for identical in-flight requests
 */
class RequestDeduplicator {
  private pending = new Map<CacheKey, Promise<unknown>>();

  /**
   * Execute a function, deduplicating concurrent calls with the same key
   */
  async dedupe<T>(key: CacheKey, fn: () => Promise<T>): Promise<T> {
    // If there's already a pending request for this key, return it
    const existing = this.pending.get(key);
    if (existing) {
      logger.debug("Request deduplicated", { key });
      return existing as Promise<T>;
    }

    // Create the promise and store it
    const promise = fn()
      .then((result) => {
        this.pending.delete(key);
        return result;
      })
      .catch((error) => {
        this.pending.delete(key);
        throw error;
      });

    this.pending.set(key, promise);
    return promise;
  }

  /**
   * Get count of pending requests for debugging
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}

// ============================================================================
// Cached API Wrapper
// ============================================================================

/**
 * Combines TTL cache with request deduplication for optimal API performance
 */
export class CachedAPI {
  private cache: TTLCache;
  private deduplicator: RequestDeduplicator;

  constructor(defaultTTLMs: number = 30000) {
    this.cache = new TTLCache(defaultTTLMs);
    this.deduplicator = new RequestDeduplicator();
  }

  /**
   * Fetch data with caching and deduplication
   *
   * @param key - Unique cache key for this request
   * @param fn - Function that fetches the data
   * @param options - Cache options
   */
  async fetch<T>(
    key: CacheKey,
    fn: () => Promise<T>,
    options?: {
      ttlMs?: number;
      forceRefresh?: boolean;
    }
  ): Promise<T> {
    // Check cache first (unless force refresh)
    if (!options?.forceRefresh) {
      const cached = this.cache.get<T>(key);
      if (cached !== null) {
        logger.debug("Cache hit", { key });
        return cached;
      }
    }

    // Deduplicate concurrent requests and fetch
    const result = await this.deduplicator.dedupe(key, fn);

    // Cache the result
    this.cache.set(key, result, options?.ttlMs);
    logger.debug("Cache miss, fetched and cached", { key });

    return result;
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: CacheKey): void {
    this.cache.invalidate(key);
    logger.debug("Cache invalidated", { key });
  }

  /**
   * Invalidate all entries matching a prefix
   */
  invalidateByPrefix(prefix: string): void {
    this.cache.invalidateByPrefix(prefix);
    logger.debug("Cache invalidated by prefix", { prefix });
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    logger.debug("Cache cleared");
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { cacheSize: number; pendingRequests: number } {
    return {
      cacheSize: this.cache.size,
      pendingRequests: this.deduplicator.pendingCount,
    };
  }
}

// ============================================================================
// Cache Keys
// ============================================================================

/**
 * Centralized cache key definitions for consistency
 */
export const CacheKeys = {
  // Analysis-related keys
  ALL_ANALYSES: "analyses:all",
  ANALYSES_PAGINATED: (limit: number, offset: number) =>
    `analyses:paginated:${limit}:${offset}`,
  ANALYSES_COUNT: "analyses:count",
  ANALYSIS_BY_ID: (id: number) => `analyses:id:${id}`,
  ANALYSIS_SEARCH: (query: string, severity?: string) =>
    `analyses:search:${query}:${severity || "all"}`,

  // Statistics
  DATABASE_STATS: "stats:database",

  // Translation-related keys
  ALL_TRANSLATIONS: "translations:all",
  TRANSLATION_BY_ID: (id: number) => `translations:id:${id}`,

  // Tag-related keys
  ALL_TAGS: "tags:all",
  TAGS_FOR_ANALYSIS: (id: number) => `tags:analysis:${id}`,
  TAGS_FOR_TRANSLATION: (id: number) => `tags:translation:${id}`,

  // Prefixes for bulk invalidation
  PREFIX_ANALYSES: "analyses:",
  PREFIX_TRANSLATIONS: "translations:",
  PREFIX_STATS: "stats:",
  PREFIX_TAGS: "tags:",
} as const;

// ============================================================================
// Cache TTL Constants (in milliseconds)
// ============================================================================

export const CacheTTL = {
  /** Default TTL for most queries */
  DEFAULT: 30_000, // 30 seconds

  /** Statistics can be cached longer */
  STATISTICS: 30_000, // 30 seconds
} as const;

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global cache instance for API responses
 */
export const apiCache = new CachedAPI(CacheTTL.DEFAULT);

export default apiCache;
