/**
 * OpenSearch / Knowledge Base Integration Service
 * Handles KB configuration management and Tauri command wrappers
 */

import { invoke } from "@tauri-apps/api/core";
import { getSetting, storeSetting, getApiKey, storeApiKey } from "./secure-storage";
import logger from "./logger";

// ============================================================================
// Types
// ============================================================================

export interface OpenSearchConfig {
  enabled: boolean;
  mode: "remote" | "local" | "both";
  host: string;
  port: number;
  useSsl: boolean;
  username: string;
  defaultVersion: string;
  defaultCustomer: string;
  localKbPath: string;
}

export interface KBTestResponse {
  success: boolean;
  message: string;
  available_indices: string[];
}

export interface KBStatsResponse {
  total_chunks: number;
  indexed_versions: string[];
  storage_path: string;
}

export interface KBImportResponse {
  indexed_chunks: number;
  won_version: string;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: OpenSearchConfig = {
  enabled: false,
  mode: "remote",
  host: "",
  port: 443,
  useSsl: true,
  username: "",
  defaultVersion: "",
  defaultCustomer: "",
  localKbPath: "",
};

let configCache: OpenSearchConfig | null = null;

// ============================================================================
// Config Management
// ============================================================================

export async function getOpenSearchConfig(): Promise<OpenSearchConfig> {
  if (configCache) return configCache;

  try {
    const enabled = await getSetting<boolean>("opensearch_enabled", false);
    const mode = await getSetting<string>("opensearch_mode", "remote");
    const host = await getSetting<string>("opensearch_host", "");
    const port = await getSetting<number>("opensearch_port", 443);
    const useSsl = await getSetting<boolean>("opensearch_use_ssl", true);
    const username = await getSetting<string>("opensearch_username", "");
    const defaultVersion = await getSetting<string>("opensearch_default_version", "");
    const defaultCustomer = await getSetting<string>("opensearch_default_customer", "");
    const localKbPath = await getSetting<string>("opensearch_local_kb_path", "");

    configCache = {
      enabled: enabled || false,
      mode: (mode as OpenSearchConfig["mode"]) || "remote",
      host: host || "",
      port: port || 443,
      useSsl: useSsl ?? true,
      username: username || "",
      defaultVersion: defaultVersion || "",
      defaultCustomer: defaultCustomer || "",
      localKbPath: localKbPath || "",
    };

    return configCache;
  } catch (error) {
    logger.error("Failed to load OpenSearch config", { error });
    return DEFAULT_CONFIG;
  }
}

export async function saveOpenSearchConfig(config: OpenSearchConfig): Promise<void> {
  try {
    await storeSetting("opensearch_enabled", config.enabled);
    await storeSetting("opensearch_mode", config.mode);
    await storeSetting("opensearch_host", config.host);
    await storeSetting("opensearch_port", config.port);
    await storeSetting("opensearch_use_ssl", config.useSsl);
    await storeSetting("opensearch_username", config.username);
    await storeSetting("opensearch_default_version", config.defaultVersion);
    await storeSetting("opensearch_default_customer", config.defaultCustomer);
    await storeSetting("opensearch_local_kb_path", config.localKbPath);

    configCache = config;
    logger.info("OpenSearch config saved");
  } catch (error) {
    logger.error("Failed to save OpenSearch config", { error });
    throw error;
  }
}

export function clearOpenSearchConfigCache(): void {
  configCache = null;
}

// ============================================================================
// OpenSearch Password (stored via secure-storage)
// ============================================================================

export async function storeOpenSearchPassword(password: string): Promise<void> {
  await storeApiKey("opensearch", password);
}

export async function getOpenSearchPassword(): Promise<string | null> {
  return getApiKey("opensearch");
}

// ============================================================================
// Tauri Command Wrappers
// ============================================================================

export async function testOpenSearchConnection(): Promise<KBTestResponse> {
  try {
    const config = await getOpenSearchConfig();
    const password = await getOpenSearchPassword();
    const apiKey = await getApiKey("openai"); // needed for embedding generation in test

    return invoke<KBTestResponse>("kb_test_connection", {
      config: {
        host: config.host,
        port: config.port,
        username: config.username,
        password: password || "",
        use_ssl: config.useSsl,
      },
      apiKey: apiKey || "",
    });
  } catch (error) {
    logger.error("OpenSearch connection test failed", { error });
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      available_indices: [],
    };
  }
}

export async function listOpenSearchIndices(): Promise<string[]> {
  try {
    const config = await getOpenSearchConfig();
    const password = await getOpenSearchPassword();
    const apiKey = await getApiKey("openai");

    return invoke<string[]>("kb_list_indices", {
      config: {
        host: config.host,
        port: config.port,
        username: config.username,
        password: password || "",
        use_ssl: config.useSsl,
      },
      apiKey: apiKey || "",
    });
  } catch (error) {
    logger.error("Failed to list OpenSearch indices", { error });
    return [];
  }
}

export async function importKBDocs(rootPath: string, wonVersion: string): Promise<KBImportResponse> {
  const apiKey = await getApiKey("openai");
  return invoke<KBImportResponse>("kb_import_docs", {
    request: {
      root_path: rootPath,
      won_version: wonVersion,
      api_key: apiKey || "",
    },
  });
}

export async function getKBStats(): Promise<KBStatsResponse> {
  return invoke<KBStatsResponse>("kb_get_stats");
}

// ============================================================================
// Convenience
// ============================================================================

export async function isKBEnabled(): Promise<boolean> {
  const config = await getOpenSearchConfig();
  if (!config.enabled) return false;

  if (config.mode === "local" || config.mode === "both") {
    // Local mode only needs to be enabled
    return true;
  }

  // Remote mode needs host configured
  return !!config.host;
}
