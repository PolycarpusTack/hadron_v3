/**
 * Sentry Integration Service
 * Handles Sentry API communication and configuration management
 */

import { invoke } from "@tauri-apps/api/core";
import { getSetting, storeSetting, getApiKey } from "./secure-storage";
import logger from "./logger";
import type {
  SentryConfig,
  SentryProjectInfo,
  SentryTestResponse,
  SentryIssueList,
  SentryIssue,
  SentryEvent,
} from "../types";

// Default configuration
const DEFAULT_SENTRY_CONFIG: SentryConfig = {
  enabled: false,
  baseUrl: "https://sentry.io",
  organization: "",
  defaultProject: "",
};

// Config cache
let configCache: SentryConfig | null = null;

const PROJECTS_CACHE_KEY = "sentry_projects_cache";
const PROJECTS_CACHE_TS_KEY = "sentry_projects_cache_ts";

/**
 * Get Sentry configuration
 */
export async function getSentryConfig(): Promise<SentryConfig> {
  if (configCache) {
    return configCache;
  }

  try {
    const enabled = await getSetting<boolean>("sentry_enabled", false);
    const baseUrl = await getSetting<string>("sentry_base_url", "https://sentry.io");
    const organization = await getSetting<string>("sentry_organization", "");
    const defaultProject = await getSetting<string>("sentry_default_project", "");

    configCache = {
      enabled: enabled || false,
      baseUrl: baseUrl || "https://sentry.io",
      organization: organization || "",
      defaultProject: defaultProject || "",
    };

    return configCache;
  } catch (error) {
    logger.error("Failed to load Sentry config", { error });
    return DEFAULT_SENTRY_CONFIG;
  }
}

/**
 * Save Sentry configuration
 */
export async function saveSentryConfig(config: SentryConfig): Promise<void> {
  try {
    await storeSetting("sentry_enabled", config.enabled);
    await storeSetting("sentry_base_url", config.baseUrl);
    await storeSetting("sentry_organization", config.organization);
    await storeSetting("sentry_default_project", config.defaultProject);

    configCache = config;
    logger.info("Sentry config saved", { organization: config.organization });
  } catch (error) {
    logger.error("Failed to save Sentry config", { error });
    throw error;
  }
}

/**
 * Clear config cache (useful after settings change)
 */
export function clearSentryConfigCache(): void {
  configCache = null;
}

/**
 * Test Sentry connection
 */
export async function testSentryConnection(): Promise<SentryTestResponse> {
  try {
    const config = await getSentryConfig();
    const authToken = await getApiKey("sentry");

    if (!config.baseUrl || !authToken) {
      return {
        success: false,
        message: "Sentry configuration is incomplete",
        projects: null,
      };
    }

    const result = await invoke<SentryTestResponse>("test_sentry_connection", {
      baseUrl: config.baseUrl,
      authToken: authToken,
    });
    return result;
  } catch (error) {
    logger.error("Sentry connection test failed", { error });
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      projects: null,
    };
  }
}

/**
 * List available Sentry projects
 */
export async function listSentryProjects(): Promise<SentryProjectInfo[]> {
  try {
    const config = await getSentryConfig();
    const authToken = await getApiKey("sentry");

    if (!config.baseUrl || !authToken) {
      return [];
    }

    const result = await invoke<SentryProjectInfo[]>("list_sentry_projects", {
      baseUrl: config.baseUrl,
      authToken,
    });

    const projects = result || [];
    cacheSentryProjects(projects);
    return projects;
  } catch (error) {
    logger.error("Failed to list Sentry projects", { error });
    return [];
  }
}

/**
 * List issues for a Sentry project
 */
export async function listSentryIssues(
  org: string,
  project: string,
  query?: string,
  cursor?: string
): Promise<SentryIssueList> {
  const config = await getSentryConfig();
  const authToken = await getApiKey("sentry");

  if (!config.baseUrl || !authToken) {
    throw new Error("Sentry is not configured");
  }

  return invoke<SentryIssueList>("list_sentry_issues", {
    baseUrl: config.baseUrl,
    authToken,
    org,
    project,
    query: query || null,
    cursor: cursor || null,
  });
}

/**
 * Fetch a single Sentry issue by ID
 */
export async function fetchSentryIssue(issueId: string): Promise<SentryIssue> {
  const config = await getSentryConfig();
  const authToken = await getApiKey("sentry");

  if (!config.baseUrl || !authToken) {
    throw new Error("Sentry is not configured");
  }

  return invoke<SentryIssue>("fetch_sentry_issue", {
    baseUrl: config.baseUrl,
    authToken,
    issueId,
  });
}

/**
 * Fetch latest event for a Sentry issue
 */
export async function fetchSentryLatestEvent(issueId: string): Promise<SentryEvent> {
  const config = await getSentryConfig();
  const authToken = await getApiKey("sentry");

  if (!config.baseUrl || !authToken) {
    throw new Error("Sentry is not configured");
  }

  return invoke<SentryEvent>("fetch_sentry_latest_event", {
    baseUrl: config.baseUrl,
    authToken,
    issueId,
  });
}

/**
 * Cache project list locally for reuse
 */
export function cacheSentryProjects(projects: SentryProjectInfo[]): void {
  try {
    localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects));
    localStorage.setItem(PROJECTS_CACHE_TS_KEY, new Date().toISOString());
  } catch (error) {
    logger.warn("Failed to cache Sentry projects", { error });
  }
}

/**
 * Get cached project list
 */
export function getCachedSentryProjects(): {
  projects: SentryProjectInfo[];
  updatedAt: string | null;
} {
  try {
    const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
    const ts = localStorage.getItem(PROJECTS_CACHE_TS_KEY);
    if (!raw) {
      return { projects: [], updatedAt: ts };
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { projects: [], updatedAt: ts };
    }
    return { projects: parsed as SentryProjectInfo[], updatedAt: ts };
  } catch (error) {
    logger.warn("Failed to read cached Sentry projects", { error });
    return { projects: [], updatedAt: null };
  }
}

/**
 * Check if Sentry is configured and enabled
 */
export async function isSentryEnabled(): Promise<boolean> {
  const config = await getSentryConfig();
  const token = await getApiKey("sentry");
  return config.enabled && !!config.baseUrl && !!config.organization && !!token;
}

/**
 * Parse a Sentry issue URL to extract the issue ID
 * Supports formats:
 *   - https://sentry.io/organizations/org/issues/12345/
 *   - https://sentry.io/issues/12345/
 *   - PROJ-123 (short ID)
 *   - 12345 (numeric ID)
 */
export function parseSentryIssueUrl(input: string): string | null {
  const trimmed = input.trim();

  // Numeric ID
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // Short ID like PROJ-123
  if (/^[A-Z][\w-]*-\d+$/i.test(trimmed)) {
    return trimmed;
  }

  // URL format
  const urlMatch = trimmed.match(/\/issues\/(\d+)\/?/);
  if (urlMatch) {
    return urlMatch[1];
  }

  return null;
}
