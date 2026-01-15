/**
 * Keeper Secrets Manager Service
 * Handles communication with Keeper via Tauri backend
 *
 * Security: API keys are never sent to the frontend - only metadata
 * about available secrets is exposed.
 */

import { invoke } from "@tauri-apps/api/core";
import { getSetting, storeSetting } from "./secure-storage";
import logger from "./logger";

const KEEPER_CONFIG_KEY = "keeper_config";

// ============================================================================
// Types
// ============================================================================

export interface KeeperSecretInfo {
  uid: string;
  title: string;
  record_type: string;
}

export interface KeeperStatus {
  configured: boolean;
  connected: boolean;
  secrets_count: number;
  message: string;
}

export interface KeeperInitResult {
  success: boolean;
  message: string;
  secrets_count?: number;
}

export interface KeeperSecretsListResult {
  success: boolean;
  secrets: KeeperSecretInfo[];
  message: string;
}

export interface KeeperConfig {
  enabled: boolean;
  secretMappings: {
    openai?: string;
    anthropic?: string;
    zai?: string;
  };
}

// ============================================================================
// Backend Communication
// ============================================================================

/**
 * Initialize Keeper with a one-time access token
 * This binds the token to this device - can only be done once
 */
export async function initializeKeeper(token: string): Promise<KeeperInitResult> {
  logger.info("Initializing Keeper connection");
  return await invoke<KeeperInitResult>("initialize_keeper", { token });
}

/**
 * Get current Keeper connection status
 */
export async function getKeeperStatus(): Promise<KeeperStatus> {
  return await invoke<KeeperStatus>("get_keeper_status");
}

/**
 * List available secrets from Keeper (titles only, not values)
 * Safe to display in UI - no actual secret values are returned
 */
export async function listKeeperSecrets(): Promise<KeeperSecretsListResult> {
  return await invoke<KeeperSecretsListResult>("list_keeper_secrets");
}

/**
 * Test Keeper connection by attempting to list secrets
 */
export async function testKeeperConnection(): Promise<KeeperSecretsListResult> {
  return await invoke<KeeperSecretsListResult>("test_keeper_connection");
}

/**
 * Clear Keeper configuration and disconnect
 * User will need a new one-time token to reconnect
 */
export async function disconnectKeeper(): Promise<void> {
  await invoke<void>("clear_keeper_config");
  await storeSetting(
    KEEPER_CONFIG_KEY,
    JSON.stringify({
      enabled: false,
      secretMappings: {},
    })
  );
  logger.info("Keeper disconnected");
}

// ============================================================================
// Local Configuration Management
// ============================================================================

/**
 * Get stored Keeper configuration
 */
export async function getKeeperConfig(): Promise<KeeperConfig> {
  const stored = await getSetting<string>(KEEPER_CONFIG_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      logger.warn("Failed to parse Keeper config, using defaults");
    }
  }
  return {
    enabled: false,
    secretMappings: {},
  };
}

/**
 * Save Keeper configuration
 */
export async function saveKeeperConfig(config: KeeperConfig): Promise<void> {
  await storeSetting(KEEPER_CONFIG_KEY, JSON.stringify(config));
  logger.debug("Keeper config saved", { enabled: config.enabled });
}

/**
 * Map a provider to a Keeper secret
 * @param provider - The AI provider (openai, anthropic, zai)
 * @param secretUid - The Keeper secret UID, or null to remove mapping
 */
export async function mapProviderToSecret(
  provider: "openai" | "anthropic" | "zai",
  secretUid: string | null
): Promise<void> {
  const config = await getKeeperConfig();

  if (secretUid) {
    config.secretMappings[provider] = secretUid;
  } else {
    delete config.secretMappings[provider];
  }

  await saveKeeperConfig(config);
  logger.debug(`Mapped ${provider} to Keeper secret`, { secretUid });
}

/**
 * Get the Keeper secret UID for a provider (if configured)
 * Returns null if Keeper is not enabled or provider is not mapped
 */
export async function getKeeperSecretForProvider(
  provider: string
): Promise<string | null> {
  const config = await getKeeperConfig();

  if (!config.enabled) {
    return null;
  }

  return (
    config.secretMappings[provider as keyof typeof config.secretMappings] ||
    null
  );
}

/**
 * Check if Keeper is enabled and configured for a provider
 */
export async function isKeeperEnabledForProvider(
  provider: string
): Promise<boolean> {
  const config = await getKeeperConfig();
  return (
    config.enabled &&
    !!config.secretMappings[provider as keyof typeof config.secretMappings]
  );
}

/**
 * Get API key source info for a provider
 * Useful for showing users where their API key is coming from
 */
export async function getApiKeySource(provider: string): Promise<{
  source: "keeper" | "direct" | "none";
  keeperSecretUid?: string;
  keeperSecretTitle?: string;
}> {
  const config = await getKeeperConfig();

  if (config.enabled) {
    const secretUid =
      config.secretMappings[provider as keyof typeof config.secretMappings];
    if (secretUid) {
      // Try to get the secret title for display
      try {
        const secrets = await listKeeperSecrets();
        const secret = secrets.secrets.find((s) => s.uid === secretUid);
        return {
          source: "keeper",
          keeperSecretUid: secretUid,
          keeperSecretTitle: secret?.title,
        };
      } catch {
        return { source: "keeper", keeperSecretUid: secretUid };
      }
    }
  }

  // Check if direct key exists (would need to import from secure-storage)
  // For now, just return "none" if no Keeper config
  return { source: "none" };
}
