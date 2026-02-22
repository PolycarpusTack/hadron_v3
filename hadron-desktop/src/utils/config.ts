/**
 * Configuration Utilities
 * Centralized helpers for reading/writing app configuration from localStorage
 */

// ============================================================================
// Storage Key Registry
// All localStorage keys should be defined here to prevent typo bugs
// and make it easy to audit what the app persists.
// ============================================================================

export const STORAGE_KEYS = {
  // AI configuration
  AI_PROVIDER: "ai_provider",
  AI_MODEL: "ai_model",
  AI_CUSTOM_MODEL: "ai_custom_model",
  AI_AUXILIARY_MODEL: "ai_auxiliary_model",
  PII_REDACTION_ENABLED: "pii_redaction_enabled",
  ACTIVE_PROVIDERS: "active_providers",

  // App preferences
  THEME: "theme",
  AUTO_CHECK_UPDATES: "auto_check_updates",
  ANALYSIS_DEFAULT_TYPE: "analysis_default_type",
  HISTORY_FILTERS: "hadron_history_filters",

  // JIRA integration
  JIRA_PROJECTS_CACHE: "jira_projects_cache",
  JIRA_PROJECTS_CACHE_TS: "jira_projects_cache_ts",
  JIRA_SYNC_CONFIG: "jira_sync_config",
  JIRA_LAST_SYNC: "jira_last_sync",
  JIRA_WATCHED_PROJECTS: "jira_watched_projects",
  JIRA_IMPORTED_ISSUES: "hadron_jira_imported_issues",
  JIRA_SYNC_STATE: "hadron_jira_sync_state",

  // Sentry integration
  SENTRY_PROJECTS_CACHE: "sentry_projects_cache",
  SENTRY_PROJECTS_CACHE_TS: "sentry_projects_cache_ts",

  // Feature flags
  FEATURE_CODE_ANALYZER: "feature_code_analyzer",
  FEATURE_PERFORMANCE_ANALYZER: "feature_performance_analyzer",
  FEATURE_ASK_HADRON: "feature_ask_hadron",
  FEATURE_HOVER_BUTTON: "feature_hover_button",

  // Chat
  CHAT_FEEDBACK: "hadron_chat_feedback",

  // Legacy (migrated to secure storage, kept for migration)
  LEGACY_API_KEY: "ai_api_key",
} as const;

/** Get a provider-specific model cache key */
export function providerModelKey(provider: string): string {
  return `ai_model:${provider}`;
}

/** Get a provider-specific model list cache key */
export function providerModelsCacheKey(provider: string): string {
  return `models_cache:${provider}`;
}

/**
 * Get a boolean setting from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Default value if key doesn't exist (default: false)
 * @returns The boolean value
 */
export function getBooleanSetting(key: string, defaultValue: boolean = false): boolean {
  const value = localStorage.getItem(key);
  if (value === null) {
    return defaultValue;
  }
  return value === "true";
}

/**
 * Set a boolean setting in localStorage
 * @param key - The localStorage key
 * @param value - The boolean value to store
 */
export function setBooleanSetting(key: string, value: boolean): void {
  localStorage.setItem(key, String(value));
}

/**
 * Get a string setting from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Default value if key doesn't exist
 * @returns The string value or default
 */
export function getStringSetting(key: string, defaultValue: string = ""): string {
  return localStorage.getItem(key) || defaultValue;
}

/**
 * Get a numeric setting from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Default value if key doesn't exist or invalid
 * @returns The numeric value or default
 */
export function getNumericSetting(key: string, defaultValue: number): number {
  const value = localStorage.getItem(key);
  if (value === null) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a JSON object from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Default value if key doesn't exist or invalid JSON
 * @returns The parsed object or default
 */
export function getJSONSetting<T>(key: string, defaultValue: T): T {
  const value = localStorage.getItem(key);
  if (value === null) {
    return defaultValue;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Set a JSON object in localStorage
 * @param key - The localStorage key
 * @param value - The object to serialize and store
 */
export function setJSONSetting<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}
