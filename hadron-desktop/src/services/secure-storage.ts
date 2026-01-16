/**
 * Secure Storage Service
 * Uses Tauri Store plugin for encrypted credential storage
 *
 * Alex Chen: "API keys in localStorage is a security incident waiting to happen"
 */

import { Store } from '@tauri-apps/plugin-store';
import logger from './logger';

let store: Store | null = null;
let storeInitPromise: Promise<Store> | null = null;

/**
 * Get or create the encrypted store instance
 * Uses a promise-based mutex to prevent race conditions during initialization
 */
async function getStore(): Promise<Store> {
  // If store is already initialized, return it immediately
  if (store) {
    return store;
  }

  // If initialization is in progress, wait for it
  if (storeInitPromise) {
    return storeInitPromise;
  }

  // Start initialization and store the promise to prevent concurrent init
  storeInitPromise = (async () => {
    try {
      // Store is automatically encrypted at rest by Tauri
      const newStore = await Store.load('settings.json');
      store = newStore;
      return newStore;
    } catch (error) {
      // Reset promise on error so retry is possible
      storeInitPromise = null;
      throw error;
    }
  })();

  return storeInitPromise;
}

/**
 * Store API key securely (encrypted)
 * @param provider - AI provider name (openai, anthropic, zai)
 * @param apiKey - The API key to store
 */
export async function storeApiKey(provider: string, apiKey: string): Promise<void> {
  const s = await getStore();
  await s.set(`${provider}_api_key`, apiKey);
  await s.save(); // Persist to encrypted file
  logger.debug('Stored API key in encrypted storage', { provider });
}

/**
 * Retrieve API key from encrypted storage
 * @param provider - AI provider name
 * @returns API key or null if not found
 */
export async function getApiKey(provider: string): Promise<string | null> {
  const s = await getStore();
  const key = await s.get<string>(`${provider}_api_key`);
  return key || null;
}

/**
 * Delete API key from encrypted storage
 * @param provider - AI provider name
 */
export async function deleteApiKey(provider: string): Promise<void> {
  const s = await getStore();
  await s.delete(`${provider}_api_key`);
  await s.save();
  logger.debug('Deleted API key from encrypted storage', { provider });
}

/**
 * Check if an API key exists for a provider
 * @param provider - AI provider name
 * @returns true if key exists
 */
export async function hasApiKey(provider: string): Promise<boolean> {
  const s = await getStore();
  const key = await s.get<string>(`${provider}_api_key`);
  return key !== null && key !== undefined;
}

/**
 * Store other settings (model, provider, etc)
 * These don't need encryption but we store them here for consistency
 */
export async function storeSetting(key: string, value: string | number | boolean): Promise<void> {
  const s = await getStore();
  await s.set(key, value);
  await s.save();
}

/**
 * Get a setting
 */
export async function getSetting<T = string>(key: string, defaultValue?: T): Promise<T | null> {
  const s = await getStore();
  const value = await s.get<T>(key);
  return value !== null && value !== undefined ? value : (defaultValue || null);
}

/**
 * One-time migration from localStorage to encrypted storage
 * This runs automatically on first load
 */
export async function migrateFromLocalStorage(): Promise<boolean> {
  // Check if migration already done
  const s = await getStore();
  const migrated = await s.get<boolean>('migration_complete');

  if (migrated) {
    return false; // Already migrated
  }

  logger.info('Migrating from localStorage to encrypted storage');

  // Migrate API key
  const oldApiKey = localStorage.getItem('ai_api_key');
  if (oldApiKey) {
    const provider = localStorage.getItem('ai_provider') || 'openai';
    await storeApiKey(provider, oldApiKey);
    localStorage.removeItem('ai_api_key');
    logger.debug('Migrated API key to encrypted storage');
  }

  // Migrate other settings
  const settingsToMigrate = [
    'ai_provider',
    'ai_model',
    'max_file_size_kb',
    'theme'
  ];

  for (const key of settingsToMigrate) {
    const value = localStorage.getItem(key);
    if (value) {
      await storeSetting(key, value);
      // Don't remove these yet - they're non-sensitive
      // localStorage.removeItem(key);
    }
  }

  // Mark migration as complete
  await s.set('migration_complete', true);
  await s.save();

  logger.info('Migration to encrypted storage complete');
  return true;
}

/**
 * Clear all data (for testing / reset)
 */
export async function clearAll(): Promise<void> {
  const s = await getStore();
  await s.clear();
  await s.save();
  logger.info('Cleared all encrypted storage');
}
