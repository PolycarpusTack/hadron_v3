/**
 * JIRA Sync Service
 * Phase 3: Polls JIRA for updates to linked tickets
 *
 * Since webhooks can't reach desktop apps, this service:
 * - Periodically syncs linked ticket metadata (status, priority, summary)
 * - Provides manual refresh capability
 * - Emits events when tickets are updated
 * - Respects rate limits via the rate limiter
 */

import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import logger from "./logger";
import { getJiraConfig, isJiraEnabled } from "./jira";
import { getApiKey } from "./secure-storage";
import { executeWithResilience, isJiraApiAvailable } from "./jira-rate-limiter";
import { updateJiraLinkMetadata, type JiraLink } from "./jira-linking";

// ============================================================================
// Types
// ============================================================================

export interface SyncConfig {
  /** Sync interval in milliseconds (default: 5 minutes) */
  intervalMs: number;
  /** Whether auto-sync is enabled */
  enabled: boolean;
  /** Only sync tickets updated in the last N days */
  maxAgeDays: number;
}

export interface SyncResult {
  success: boolean;
  ticketsChecked: number;
  ticketsUpdated: number;
  errors: string[];
  duration: number;
  timestamp: string;
}

export interface TicketUpdate {
  jiraKey: string;
  field: "status" | "priority" | "summary";
  oldValue: string | undefined;
  newValue: string;
}

interface JiraIssueResponse {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority?: { name: string };
    updated: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: SyncConfig = {
  intervalMs: 5 * 60 * 1000, // 5 minutes
  enabled: true,
  maxAgeDays: 30,
};

const STORAGE_KEY = "jira_sync_config";
const LAST_SYNC_KEY = "jira_last_sync";

// ============================================================================
// Sync State
// ============================================================================

let syncInterval: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;
let lastSyncResult: SyncResult | null = null;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get sync configuration from localStorage
 */
export function getSyncConfig(): SyncConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    }
  } catch (e) {
    logger.warn("Failed to load sync config", { error: e });
  }
  return DEFAULT_CONFIG;
}

/**
 * Save sync configuration
 */
export function setSyncConfig(config: Partial<SyncConfig>): void {
  const current = getSyncConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

  // Restart sync if interval changed
  if (config.intervalMs || config.enabled !== undefined) {
    stopAutoSync();
    if (updated.enabled) {
      startAutoSync();
    }
  }

  logger.info("Sync config updated", { config: updated });
}

/**
 * Get last sync timestamp
 */
export function getLastSyncTime(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

/**
 * Get last sync result
 */
export function getLastSyncResult(): SyncResult | null {
  return lastSyncResult;
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Fetch current ticket data from JIRA
 */
async function fetchTicketFromJira(
  jiraKey: string,
  _config: { baseUrl: string; email: string; apiToken: string }
): Promise<JiraIssueResponse | null> {
  try {
    const response = await executeWithResilience(async () => {
      return invoke<{ issues: JiraIssueResponse[] }>("search_jira_issues", {
        jql: `key = ${jiraKey}`,
        maxResults: 1,
        includeComments: false,
      });
    });

    return response.issues[0] || null;
  } catch (e) {
    logger.error("Failed to fetch ticket from JIRA", { jiraKey, error: e });
    return null;
  }
}

/**
 * Sync a single ticket and detect changes
 */
async function syncTicket(
  jiraKey: string,
  currentLink: JiraLink,
  jiraConfig: { baseUrl: string; email: string; apiToken: string }
): Promise<TicketUpdate[]> {
  const updates: TicketUpdate[] = [];

  const ticket = await fetchTicketFromJira(jiraKey, jiraConfig);
  if (!ticket) return updates;

  const newStatus = ticket.fields.status.name;
  const newPriority = ticket.fields.priority?.name;
  const newSummary = ticket.fields.summary;

  // Detect changes
  if (currentLink.jiraStatus !== newStatus) {
    updates.push({
      jiraKey,
      field: "status",
      oldValue: currentLink.jiraStatus,
      newValue: newStatus,
    });
  }

  if (currentLink.jiraPriority !== newPriority && newPriority) {
    updates.push({
      jiraKey,
      field: "priority",
      oldValue: currentLink.jiraPriority,
      newValue: newPriority,
    });
  }

  if (currentLink.jiraSummary !== newSummary) {
    updates.push({
      jiraKey,
      field: "summary",
      oldValue: currentLink.jiraSummary,
      newValue: newSummary,
    });
  }

  // Update database if changes detected
  if (updates.length > 0) {
    await updateJiraLinkMetadata(jiraKey, {
      jiraStatus: newStatus,
      jiraPriority: newPriority,
      jiraSummary: newSummary,
    });
  }

  return updates;
}

/**
 * Perform a full sync of all linked tickets
 */
export async function syncAllLinkedTickets(): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    success: false,
    ticketsChecked: 0,
    ticketsUpdated: 0,
    errors: [],
    duration: 0,
    timestamp: new Date().toISOString(),
  };

  if (isSyncing) {
    result.errors.push("Sync already in progress");
    return result;
  }

  isSyncing = true;

  try {
    // Check if JIRA is enabled and available
    const enabled = await isJiraEnabled();
    if (!enabled) {
      result.errors.push("JIRA is not configured");
      return result;
    }

    if (!isJiraApiAvailable()) {
      result.errors.push("JIRA API is unavailable (circuit breaker open)");
      return result;
    }

    // Get JIRA config
    const jiraConfig = await getJiraConfig();
    if (!jiraConfig) {
      result.errors.push("JIRA configuration not found");
      return result;
    }

    const apiToken = await getApiKey("jira");
    if (!apiToken) {
      result.errors.push("JIRA API token not found");
      return result;
    }

    const config = {
      baseUrl: jiraConfig.baseUrl,
      email: jiraConfig.email,
      apiToken,
    };

    // Get all linked tickets
    let links: JiraLink[] = [];
    try {
      links = await invoke<JiraLink[]>("get_all_jira_links");
    } catch {
      // Command might not exist yet, skip sync
      result.errors.push("Sync command not available");
      return result;
    }

    if (links.length === 0) {
      result.success = true;
      return result;
    }

    // Group links by JIRA key (avoid duplicate fetches)
    const linksByKey = new Map<string, JiraLink>();
    for (const link of links) {
      if (!linksByKey.has(link.jiraKey)) {
        linksByKey.set(link.jiraKey, link);
      }
    }

    // Sync each unique ticket
    const allUpdates: TicketUpdate[] = [];
    for (const [jiraKey, link] of linksByKey) {
      result.ticketsChecked++;

      try {
        const updates = await syncTicket(jiraKey, link, config);
        if (updates.length > 0) {
          result.ticketsUpdated++;
          allUpdates.push(...updates);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result.errors.push(`${jiraKey}: ${message}`);
      }

      // Small delay between requests to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Emit update events
    if (allUpdates.length > 0) {
      await emit("jira:tickets-updated", { updates: allUpdates });
      logger.info("JIRA sync found updates", {
        ticketsUpdated: result.ticketsUpdated,
        totalUpdates: allUpdates.length,
      });
    }

    result.success = true;
    localStorage.setItem(LAST_SYNC_KEY, result.timestamp);

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.errors.push(message);
    logger.error("JIRA sync failed", { error: e });
  } finally {
    isSyncing = false;
    result.duration = Date.now() - startTime;
    lastSyncResult = result;

    // Emit sync complete event
    await emit("jira:sync-complete", { result });
  }

  return result;
}

/**
 * Check if sync is currently running
 */
export function isSyncInProgress(): boolean {
  return isSyncing;
}

// ============================================================================
// Auto Sync Management
// ============================================================================

/**
 * Start automatic background sync
 */
export function startAutoSync(): void {
  const config = getSyncConfig();

  if (!config.enabled) {
    logger.info("Auto-sync is disabled");
    return;
  }

  if (syncInterval) {
    clearInterval(syncInterval);
  }

  syncInterval = setInterval(async () => {
    const enabled = await isJiraEnabled();
    if (enabled && !isSyncing) {
      logger.debug("Running scheduled JIRA sync");
      await syncAllLinkedTickets();
    }
  }, config.intervalMs);

  logger.info("JIRA auto-sync started", { intervalMs: config.intervalMs });
}

/**
 * Stop automatic background sync
 */
export function stopAutoSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    logger.info("JIRA auto-sync stopped");
  }
}

/**
 * Initialize sync service (call on app start)
 */
export async function initSyncService(): Promise<void> {
  const config = getSyncConfig();

  if (config.enabled) {
    const enabled = await isJiraEnabled();
    if (enabled) {
      startAutoSync();

      // Run initial sync after a short delay
      setTimeout(() => {
        syncAllLinkedTickets().catch(e => {
          logger.error("Initial sync failed", { error: e });
        });
      }, 5000);
    }
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Subscribe to ticket update events
 */
export function onTicketsUpdated(
  callback: (updates: TicketUpdate[]) => void
): Promise<UnlistenFn> {
  return listen<{ updates: TicketUpdate[] }>("jira:tickets-updated", (event) => {
    callback(event.payload.updates);
  });
}

/**
 * Subscribe to sync complete events
 */
export function onSyncComplete(
  callback: (result: SyncResult) => void
): Promise<UnlistenFn> {
  return listen<{ result: SyncResult }>("jira:sync-complete", (event) => {
    callback(event.payload.result);
  });
}

// ============================================================================
// Sync Status for UI
// ============================================================================

export interface SyncStatus {
  enabled: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  lastSyncResult: SyncResult | null;
  intervalMs: number;
}

/**
 * Get current sync status for UI display
 */
export function getSyncStatus(): SyncStatus {
  const config = getSyncConfig();
  return {
    enabled: config.enabled,
    isSyncing,
    lastSyncTime: getLastSyncTime(),
    lastSyncResult,
    intervalMs: config.intervalMs,
  };
}
