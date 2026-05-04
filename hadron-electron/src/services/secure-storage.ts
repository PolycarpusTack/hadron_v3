/**
 * Secure Storage Service (Electron adaptation)
 * API keys use keytar via IPC; general settings use localStorage.
 */

const SERVICE_NAME = 'hadron-electron'

// ─── API Key functions (keytar via IPC) ───────────────────────────────────────

export async function getApiKey(provider: string): Promise<string | null> {
  return window.hadron.invoke('keytar:get', { service: SERVICE_NAME, account: provider }) as Promise<string | null>
}

export async function storeApiKey(provider: string, key: string): Promise<void> {
  await window.hadron.invoke('keytar:set', { service: SERVICE_NAME, account: provider, password: key })
}

export async function deleteApiKey(provider: string): Promise<void> {
  await window.hadron.invoke('keytar:delete', { service: SERVICE_NAME, account: provider })
}

export async function hasApiKey(provider: string): Promise<boolean> {
  const key = await getApiKey(provider)
  return key !== null && key !== undefined && key !== ''
}

// ─── General settings (localStorage) ─────────────────────────────────────────

export async function storeSetting(key: string, value: string | number | boolean): Promise<void> {
  localStorage.setItem(`hadron:${key}`, JSON.stringify(value))
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
