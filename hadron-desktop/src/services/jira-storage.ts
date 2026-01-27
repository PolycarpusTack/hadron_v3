/**
 * JIRA Storage Adapter
 * Provides IndexedDB-based storage for JIRA issues with atomic transactions
 *
 * Addresses:
 * - TDR-001: LocalStorage 5MB limit and UI blocking
 * - TDR-003: Transaction boundaries for sync operations
 */

import logger from "./logger";
import type { NormalizedIssue } from "./jira-import";

// ============================================================================
// Configuration Constants (TDR: Extract magic numbers)
// ============================================================================

export const JIRA_CONFIG = {
  /** Maximum signatures to extract per issue */
  maxSignatures: 20,
  /** Default page size for JIRA API calls */
  defaultPageSize: 100,
  /** Maximum issues to cache in storage */
  maxCachedIssues: 500,
  /** Number of comments to show in preview */
  previewComments: 5,
  /** API timeout in milliseconds */
  apiTimeoutMs: 30000,
  /** Rate limit: max requests per second */
  rateLimitPerSecond: 10,
  /** Rate limit: retry delay base (ms) for exponential backoff */
  retryDelayBaseMs: 1000,
  /** Rate limit: max retries */
  maxRetries: 3,
  /** Circuit breaker: failure threshold to open circuit */
  circuitBreakerThreshold: 5,
  /** Circuit breaker: reset timeout (ms) */
  circuitBreakerResetMs: 60000,
  /** Maximum ADF document size in bytes (1MB) */
  maxAdfSizeBytes: 1024 * 1024,
} as const;

// ============================================================================
// Storage Adapter Interface
// ============================================================================

export interface SyncState {
  lastSyncAt: string;
  lastSyncedKey?: string;
  totalImported: number;
  version?: number;
}

export interface IssueStorageAdapter {
  /** Initialize the storage (create DB, tables, etc.) */
  initialize(): Promise<void>;

  /** Get all cached issues */
  getIssues(): Promise<NormalizedIssue[]>;

  /** Get a single issue by key */
  getIssue(key: string): Promise<NormalizedIssue | null>;

  /** Save issues (merge with existing) */
  saveIssues(issues: NormalizedIssue[]): Promise<void>;

  /** Delete an issue by key */
  deleteIssue(key: string): Promise<void>;

  /** Clear all issues */
  clearIssues(): Promise<void>;

  /** Get sync state */
  getSyncState(): Promise<SyncState | null>;

  /** Save sync state */
  saveSyncState(state: SyncState): Promise<void>;

  /** Atomic transaction: save issues and sync state together */
  saveWithSyncState(issues: NormalizedIssue[], state: SyncState): Promise<void>;

  /** Get storage statistics */
  getStats(): Promise<{ issueCount: number; estimatedSizeBytes: number }>;
}

// ============================================================================
// IndexedDB Storage Adapter
// ============================================================================

const DB_NAME = "hadron_jira_db";
const DB_VERSION = 1;
const ISSUES_STORE = "issues";
const SYNC_STATE_STORE = "sync_state";
const SYNC_STATE_KEY = "current";

export class IndexedDBStorageAdapter implements IssueStorageAdapter {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error("Failed to open IndexedDB", { error: request.error });
        reject(new Error(`Failed to open IndexedDB: ${request.error}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        logger.info("IndexedDB initialized", { name: DB_NAME, version: DB_VERSION });
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create issues store with key index
        if (!db.objectStoreNames.contains(ISSUES_STORE)) {
          const issuesStore = db.createObjectStore(ISSUES_STORE, { keyPath: "key" });
          issuesStore.createIndex("updatedAt", "updatedAt", { unique: false });
          issuesStore.createIndex("crashRelevanceScore", "crashRelevanceScore", { unique: false });
          issuesStore.createIndex("platform", "platform", { unique: false });
        }

        // Create sync state store
        if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
          db.createObjectStore(SYNC_STATE_STORE, { keyPath: "id" });
        }

        logger.info("IndexedDB schema created/upgraded");
      };
    });

    return this.initPromise;
  }

  private ensureDB(): IDBDatabase {
    if (!this.db) {
      throw new Error("IndexedDB not initialized. Call initialize() first.");
    }
    return this.db;
  }

  async getIssues(): Promise<NormalizedIssue[]> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ISSUES_STORE, "readonly");
      const store = transaction.objectStore(ISSUES_STORE);
      const index = store.index("updatedAt");
      const request = index.openCursor(null, "prev"); // Sort by updatedAt descending

      const issues: NormalizedIssue[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && issues.length < JIRA_CONFIG.maxCachedIssues) {
          issues.push(cursor.value);
          cursor.continue();
        } else {
          resolve(issues);
        }
      };

      request.onerror = () => {
        logger.error("Failed to get issues from IndexedDB", { error: request.error });
        reject(new Error(`Failed to get issues: ${request.error}`));
      };
    });
  }

  async getIssue(key: string): Promise<NormalizedIssue | null> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ISSUES_STORE, "readonly");
      const store = transaction.objectStore(ISSUES_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        logger.error("Failed to get issue from IndexedDB", { key, error: request.error });
        reject(new Error(`Failed to get issue: ${request.error}`));
      };
    });
  }

  async saveIssues(issues: NormalizedIssue[]): Promise<void> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ISSUES_STORE, "readwrite");
      const store = transaction.objectStore(ISSUES_STORE);

      transaction.oncomplete = () => {
        logger.info("Issues saved to IndexedDB", { count: issues.length });
        resolve();
      };

      transaction.onerror = () => {
        logger.error("Failed to save issues to IndexedDB", { error: transaction.error });
        reject(new Error(`Failed to save issues: ${transaction.error}`));
      };

      for (const issue of issues) {
        store.put(issue);
      }
    });
  }

  async deleteIssue(key: string): Promise<void> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ISSUES_STORE, "readwrite");
      const store = transaction.objectStore(ISSUES_STORE);
      const request = store.delete(key);

      request.onsuccess = () => {
        logger.info("Issue deleted from IndexedDB", { key });
        resolve();
      };

      request.onerror = () => {
        logger.error("Failed to delete issue from IndexedDB", { key, error: request.error });
        reject(new Error(`Failed to delete issue: ${request.error}`));
      };
    });
  }

  async clearIssues(): Promise<void> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ISSUES_STORE, "readwrite");
      const store = transaction.objectStore(ISSUES_STORE);
      const request = store.clear();

      request.onsuccess = () => {
        logger.info("All issues cleared from IndexedDB");
        resolve();
      };

      request.onerror = () => {
        logger.error("Failed to clear issues from IndexedDB", { error: request.error });
        reject(new Error(`Failed to clear issues: ${request.error}`));
      };
    });
  }

  async getSyncState(): Promise<SyncState | null> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STATE_STORE, "readonly");
      const store = transaction.objectStore(SYNC_STATE_STORE);
      const request = store.get(SYNC_STATE_KEY);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          // Remove the internal 'id' field before returning
          const { id: _, ...state } = result;
          resolve(state as SyncState);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        logger.error("Failed to get sync state from IndexedDB", { error: request.error });
        reject(new Error(`Failed to get sync state: ${request.error}`));
      };
    });
  }

  async saveSyncState(state: SyncState): Promise<void> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STATE_STORE, "readwrite");
      const store = transaction.objectStore(SYNC_STATE_STORE);
      const request = store.put({ id: SYNC_STATE_KEY, ...state });

      request.onsuccess = () => {
        logger.info("Sync state saved to IndexedDB", { state });
        resolve();
      };

      request.onerror = () => {
        logger.error("Failed to save sync state to IndexedDB", { error: request.error });
        reject(new Error(`Failed to save sync state: ${request.error}`));
      };
    });
  }

  /**
   * Atomic transaction: save issues and sync state together (TDR-003)
   * If either operation fails, the entire transaction is rolled back.
   */
  async saveWithSyncState(issues: NormalizedIssue[], state: SyncState): Promise<void> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      // Use a single transaction for both stores - this ensures atomicity
      const transaction = db.transaction([ISSUES_STORE, SYNC_STATE_STORE], "readwrite");

      transaction.oncomplete = () => {
        logger.info("Atomic save completed", { issueCount: issues.length });
        resolve();
      };

      transaction.onerror = () => {
        logger.error("Atomic save failed - transaction rolled back", { error: transaction.error });
        reject(new Error(`Atomic save failed: ${transaction.error}`));
      };

      transaction.onabort = () => {
        logger.error("Atomic save aborted - transaction rolled back", { error: transaction.error });
        reject(new Error(`Atomic save aborted: ${transaction.error}`));
      };

      // Save issues
      const issuesStore = transaction.objectStore(ISSUES_STORE);
      for (const issue of issues) {
        issuesStore.put(issue);
      }

      // Save sync state
      const syncStore = transaction.objectStore(SYNC_STATE_STORE);
      syncStore.put({ id: SYNC_STATE_KEY, ...state });
    });
  }

  async getStats(): Promise<{ issueCount: number; estimatedSizeBytes: number }> {
    await this.initialize();
    const db = this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ISSUES_STORE, "readonly");
      const store = transaction.objectStore(ISSUES_STORE);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        const issueCount = countRequest.result;
        // Estimate ~5KB per issue on average
        const estimatedSizeBytes = issueCount * 5 * 1024;
        resolve({ issueCount, estimatedSizeBytes });
      };

      countRequest.onerror = () => {
        logger.error("Failed to get IndexedDB stats", { error: countRequest.error });
        reject(new Error(`Failed to get stats: ${countRequest.error}`));
      };
    });
  }
}

// ============================================================================
// LocalStorage Fallback Adapter (for legacy/migration)
// ============================================================================

const LEGACY_STORAGE_KEY = "hadron_jira_imported_issues";
const LEGACY_SYNC_STATE_KEY = "hadron_jira_sync_state";

export class LocalStorageFallbackAdapter implements IssueStorageAdapter {
  async initialize(): Promise<void> {
    // No initialization needed for localStorage
  }

  async getIssues(): Promise<NormalizedIssue[]> {
    try {
      const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  async getIssue(key: string): Promise<NormalizedIssue | null> {
    const issues = await this.getIssues();
    return issues.find(i => i.key === key) || null;
  }

  async saveIssues(issues: NormalizedIssue[]): Promise<void> {
    const trimmed = issues.slice(0, JIRA_CONFIG.maxCachedIssues);
    try {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      // Handle quota exceeded
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        logger.warn("LocalStorage quota exceeded, trimming issues", {
          attempted: trimmed.length
        });
        // Try with fewer issues
        const reduced = trimmed.slice(0, Math.floor(trimmed.length / 2));
        localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(reduced));
      } else {
        throw e;
      }
    }
  }

  async deleteIssue(key: string): Promise<void> {
    const issues = await this.getIssues();
    const filtered = issues.filter(i => i.key !== key);
    await this.saveIssues(filtered);
  }

  async clearIssues(): Promise<void> {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  async getSyncState(): Promise<SyncState | null> {
    try {
      const stored = localStorage.getItem(LEGACY_SYNC_STATE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  async saveSyncState(state: SyncState): Promise<void> {
    localStorage.setItem(LEGACY_SYNC_STATE_KEY, JSON.stringify(state));
  }

  async saveWithSyncState(issues: NormalizedIssue[], state: SyncState): Promise<void> {
    // LocalStorage doesn't support true transactions, but we do our best
    await this.saveIssues(issues);
    await this.saveSyncState(state);
  }

  async getStats(): Promise<{ issueCount: number; estimatedSizeBytes: number }> {
    const issues = await this.getIssues();
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY) || "";
    return {
      issueCount: issues.length,
      estimatedSizeBytes: stored.length * 2, // UTF-16 encoding
    };
  }
}

// ============================================================================
// Storage Factory
// ============================================================================

let storageInstance: IssueStorageAdapter | null = null;

/**
 * Get the storage adapter instance.
 * Uses IndexedDB by default, falls back to localStorage if IndexedDB is unavailable.
 */
export async function getStorageAdapter(): Promise<IssueStorageAdapter> {
  if (storageInstance) {
    return storageInstance;
  }

  // Check if IndexedDB is available
  if (typeof indexedDB !== "undefined") {
    try {
      const adapter = new IndexedDBStorageAdapter();
      await adapter.initialize();

      // Migrate from localStorage if needed
      await migrateFromLocalStorage(adapter);

      storageInstance = adapter;
      logger.info("Using IndexedDB storage adapter");
      return adapter;
    } catch (e) {
      logger.warn("IndexedDB unavailable, falling back to localStorage", { error: e });
    }
  }

  // Fallback to localStorage
  storageInstance = new LocalStorageFallbackAdapter();
  logger.info("Using localStorage fallback adapter");
  return storageInstance;
}

/**
 * Migrate data from localStorage to IndexedDB
 */
async function migrateFromLocalStorage(indexedAdapter: IndexedDBStorageAdapter): Promise<void> {
  const legacyIssues = localStorage.getItem(LEGACY_STORAGE_KEY);
  const legacySyncState = localStorage.getItem(LEGACY_SYNC_STATE_KEY);

  if (!legacyIssues && !legacySyncState) {
    return; // Nothing to migrate
  }

  logger.info("Migrating JIRA data from localStorage to IndexedDB");

  try {
    // Check if IndexedDB already has data
    const existingStats = await indexedAdapter.getStats();
    if (existingStats.issueCount > 0) {
      logger.info("IndexedDB already has data, skipping migration");
      return;
    }

    // Migrate issues
    if (legacyIssues) {
      const issues: NormalizedIssue[] = JSON.parse(legacyIssues);
      if (issues.length > 0) {
        await indexedAdapter.saveIssues(issues);
        logger.info("Migrated issues to IndexedDB", { count: issues.length });
      }
    }

    // Migrate sync state
    if (legacySyncState) {
      const syncState: SyncState = JSON.parse(legacySyncState);
      await indexedAdapter.saveSyncState({ ...syncState, version: 1 });
      logger.info("Migrated sync state to IndexedDB");
    }

    // Clear localStorage after successful migration
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SYNC_STATE_KEY);
    logger.info("LocalStorage migration complete, legacy data cleared");
  } catch (e) {
    logger.error("Failed to migrate from localStorage", { error: e });
    // Don't clear localStorage on failed migration
  }
}

/**
 * Reset storage instance (for testing)
 */
export function resetStorageInstance(): void {
  storageInstance = null;
}
