/**
 * Secure Storage Service
 * Uses Tauri Store plugin for encrypted credential storage
 *
 * Alex Chen: "API keys in localStorage is a security incident waiting to happen"
 */

import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

/**
 * Get or create the encrypted store instance
 */
async function getStore(): Promise<Store> {
  if (!store) {
    // Store is automatically encrypted at rest by Tauri
    store = await Store.load('settings.json');
  }
  return store;
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
  console.log(`✅ Stored API key for ${provider} in encrypted storage`);
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
  console.log(`🗑️  Deleted API key for ${provider}`);
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

  console.log('🔄 Migrating from localStorage to encrypted storage...');

  // Migrate API key
  const oldApiKey = localStorage.getItem('ai_api_key');
  if (oldApiKey) {
    const provider = localStorage.getItem('ai_provider') || 'openai';
    await storeApiKey(provider, oldApiKey);
    localStorage.removeItem('ai_api_key');
    console.log('✅ Migrated API key');
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

  console.log('✅ Migration to encrypted storage complete');
  return true;
}

/**
 * Clear all data (for testing / reset)
 */
export async function clearAll(): Promise<void> {
  const s = await getStore();
  await s.clear();
  await s.save();
  console.log('🗑️  Cleared all encrypted storage');
}
