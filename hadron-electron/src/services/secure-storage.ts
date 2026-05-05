/**
 * Secure Storage Service (Electron adaptation)
 * API keys use keytar via IPC; general settings use localStorage.
 */

const SERVICE_NAME = 'hadron-electron'

// ─── API Key functions (keytar via IPC) ───────────────────────────────────────

export async function getApiKey(provider: string): Promise<string | null> {
  return window.hadron.secret.get(SERVICE_NAME, provider)
}

export async function storeApiKey(provider: string, key: string): Promise<void> {
  await window.hadron.secret.set(SERVICE_NAME, provider, key)
}

export async function deleteApiKey(provider: string): Promise<void> {
  await window.hadron.secret.delete(SERVICE_NAME, provider)
}

export async function hasApiKey(provider: string): Promise<boolean> {
  const key = await getApiKey(provider)
  return key !== null && key !== undefined && key !== ''
}

// ─── General settings (localStorage + electron-store bridge) ─────────────────
// localStorage is readable by the renderer; electron-store is readable by the
// main process IPC handlers (JIRA, release-notes, investigation). Both must
// stay in sync so that credentials saved in Settings reach the IPC handlers.

export async function storeSetting(key: string, value: string | number | boolean): Promise<void> {
  localStorage.setItem(`hadron:${key}`, JSON.stringify(value))
  // Mirror to electron-store so main-process IPC handlers can read it
  await window.hadron.invoke('store:set', { store: 'settings', key, value })
}

export async function getSetting<T = string>(key: string, defaultValue?: T): Promise<T | null> {
  const raw = localStorage.getItem(`hadron:${key}`)
  if (raw !== null) {
    try {
      return JSON.parse(raw) as T
    } catch {
      return raw as unknown as T
    }
  }
  return defaultValue !== undefined ? defaultValue : null
}

// ─── Sync localStorage → electron-store on startup ───────────────────────────
// Runs once on app init to backfill any settings saved before this bridge existed.

export async function syncSettingsToElectronStore(): Promise<void> {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('hadron:')) {
      const key = k.slice('hadron:'.length)
      const raw = localStorage.getItem(k)
      if (raw !== null) {
        try {
          const value = JSON.parse(raw)
          await window.hadron.invoke('store:set', { store: 'settings', key, value })
        } catch { /* skip malformed entries */ }
      }
    }
  }
}

// ─── Migration (no-op in Electron — never ran Tauri store here) ───────────────

export async function migrateFromLocalStorage(): Promise<boolean> {
  return false
}

export async function clearAll(): Promise<void> {
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('hadron:')) {
      keysToRemove.push(k)
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k))
}
