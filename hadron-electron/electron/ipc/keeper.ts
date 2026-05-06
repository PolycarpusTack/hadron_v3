import { IpcMain, app } from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import {
  initializeStorage,
  getSecrets,
  localConfigStorage,
  type KeeperRecord,
} from '@keeper-security/secrets-manager-core'

const keeperSettingsStore = new Store({ name: 'settings' })

const CACHE_TTL_MS = 5 * 60 * 1000

interface CachedSecret {
  uid: string
  title: string
  recordType: string
  password: string | null
}

interface SecretsCache {
  secrets: CachedSecret[]
  cachedAt: number
}

let secretsCache: SecretsCache | null = null

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'keeper-config.json')
}

function isConfigured(): boolean {
  return fs.existsSync(getConfigPath())
}

function isCacheExpired(): boolean {
  return !secretsCache || Date.now() - secretsCache.cachedAt > CACHE_TTL_MS
}

// Multi-stage secret extraction — mirrors Tauri keeper_service.rs extract_secret_value()
function extractSecretValue(record: KeeperRecord): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = record.data
  const fields: Array<{ type?: string; label?: string; value?: unknown[] }> = data?.fields ?? []
  const custom: Array<{ type?: string; label?: string; value?: unknown[] }> = data?.custom ?? []

  const firstString = (arr: unknown[] | undefined): string | null => {
    if (!arr) return null
    for (const v of arr) {
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return null
  }

  const findByType = (
    arr: Array<{ type?: string; label?: string; value?: unknown[] }>,
    type: string,
  ): string | null => {
    const f = arr.find(f => f.type === type)
    return f ? firstString(f.value) : null
  }

  // Stages 1–2: standard then custom fields, priority order
  const priorityTypes = ['password', 'secret', 'hiddenField', 'note', 'oneTimeCode', 'text', 'pinCode']
  for (const t of priorityTypes) {
    const val = findByType(fields, t) ?? findByType(custom, t)
    if (val) return val
  }

  // Common custom field label names (SDK label match is case-sensitive at this stage)
  for (const label of ['API Key', 'api_key', 'apiKey']) {
    const f = custom.find(f => f.label === label)
    if (f) {
      const val = firstString(f.value)
      if (val) return val
    }
  }

  // Stage 3: top-level notes field
  const notes = data?.notes
  if (typeof notes === 'string' && notes.trim()) return notes.trim()

  // Stage 4: case-insensitive label scan on both custom and standard fields
  const keyLabels = [
    'api key', 'api_key', 'apikey', 'secret', 'secret key', 'token',
    'access token', 'api token', 'auth token', 'password', 'key',
  ]
  for (const arr of [custom, fields]) {
    for (const f of arr) {
      const label = (f.label ?? '').toLowerCase()
      if (keyLabels.some(k => label.includes(k))) {
        const val = firstString(f.value)
        if (val) return val
      }
    }
  }

  // Stage 5: brute-force — first non-empty string in any non-identity field
  const skipTypes = new Set(['url', 'fileRef', 'addressRef', 'name', 'email', 'phone', 'date', 'host', 'cardRef', 'login'])
  for (const arr of [custom, fields]) {
    for (const f of arr) {
      if (skipTypes.has(f.type ?? '')) continue
      const val = firstString(f.value)
      if (val) return val
    }
  }

  return null
}

function buildCache(records: KeeperRecord[]): SecretsCache {
  return {
    secrets: records.map(r => ({
      uid: r.recordUid,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      title: (r.data as any)?.title ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recordType: (r.data as any)?.type ?? '',
      password: extractSecretValue(r),
    })),
    cachedAt: Date.now(),
  }
}

/**
 * Read the Keeper secret UID mapped to a provider from the main-process settings store.
 * Used by background workers (poller, perf trace) that have no frontend-provided UID.
 * Returns null if Keeper is not enabled or the provider has no mapping.
 */
export function getKeeperUidForProvider(provider: string): string | null {
  const raw = keeperSettingsStore.get('keeper_config') as string | { enabled?: boolean; secretMappings?: Record<string, string> } | undefined
  if (!raw) return null
  try {
    const cfg = typeof raw === 'string'
      ? JSON.parse(raw) as { enabled?: boolean; secretMappings?: Record<string, string> }
      : raw
    if (!cfg.enabled) return null
    return cfg.secretMappings?.[provider] ?? null
  } catch {
    return null
  }
}

/**
 * Retrieve an API key from Keeper by secret UID.
 * Called internally by chat.ts — the raw key value never reaches the frontend.
 */
export async function getApiKeyFromKeeper(secretUid: string): Promise<string> {
  if (!isCacheExpired()) {
    const hit = secretsCache!.secrets.find(s => s.uid === secretUid)
    if (hit?.password) return hit.password
  }

  if (!isConfigured()) throw new Error('Keeper not configured')

  const storage = localConfigStorage(getConfigPath())
  const { records } = await getSecrets({ storage }, [secretUid])
  const record = records[0]
  if (!record) throw new Error(`Secret not found: ${secretUid}`)

  const value = extractSecretValue(record)
  if (!value) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const title = (record.data as any)?.title ?? secretUid
    throw new Error(`No API key found in Keeper secret '${title}'`)
  }
  return value
}

export function registerKeeperHandlers(ipcMain: IpcMain): void {
  // Fast filesystem check — no network call, safe to call on app startup
  ipcMain.handle('is_keeper_configured', () => ({ configured: isConfigured() }))

  ipcMain.handle(
    'initialize_keeper',
    async (_e, args: { token?: string; one_time_token?: string; hostname?: string | null }) => {
      const token = (args.token ?? args.one_time_token ?? '').trim()
      if (!token) return { success: false, message: 'No token provided', secrets_count: 0 }

      // SECURITY: hostname is forwarded to the Keeper SDK and used as the
      // initial enrolment endpoint. A malicious renderer must not be able
      // to redirect the one-time token to an attacker-controlled host, so
      // restrict to Keeper's documented region hostnames.
      const KEEPER_HOSTS = new Set([
        'keepersecurity.com', 'keepersecurity.eu', 'keepersecurity.com.au',
        'keepersecurity.jp', 'keepersecurity.ca', 'govcloud.keepersecurity.us',
      ])
      const rawHost = typeof args.hostname === 'string' ? args.hostname.trim() : ''
      if (rawHost && !KEEPER_HOSTS.has(rawHost.toLowerCase())) {
        return { success: false, message: `Unsupported Keeper hostname: ${rawHost}`, secrets_count: 0 }
      }
      const hostname = rawHost ? rawHost.toLowerCase() : undefined

      const configPath = getConfigPath()
      try {
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath)

        const storage = localConfigStorage(configPath)
        await initializeStorage(storage, token, hostname)
        const { records } = await getSecrets({ storage })

        secretsCache = buildCache(records)

        return {
          success: true,
          message: `Connected to Keeper. Found ${records.length} secrets available.`,
          secrets_count: records.length,
        }
      } catch (err: unknown) {
        return {
          success: false,
          message: err instanceof Error ? err.message : String(err),
          secrets_count: 0,
        }
      }
    },
  )

  ipcMain.handle('list_keeper_secrets', async () => {
    if (!isConfigured()) {
      return {
        success: false,
        secrets: [],
        message: 'Keeper not configured. Please enter a one-time token first.',
      }
    }

    try {
      const storage = localConfigStorage(getConfigPath())
      const { records } = await getSecrets({ storage })
      secretsCache = buildCache(records)

      return {
        success: true,
        secrets: secretsCache.secrets.map(s => ({
          uid: s.uid,
          title: s.title,
          record_type: s.recordType,
          has_api_key: s.password !== null,
        })),
        message: `Found ${records.length} secrets`,
      }
    } catch (err: unknown) {
      return {
        success: false,
        secrets: [],
        message: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('get_keeper_status', async () => {
    if (!isConfigured()) {
      return { configured: false, connected: false, secrets_count: 0, message: 'Keeper not configured' }
    }

    try {
      const storage = localConfigStorage(getConfigPath())
      const { records } = await getSecrets({ storage })
      secretsCache = buildCache(records)

      return { configured: true, connected: true, secrets_count: records.length, message: `Found ${records.length} secrets` }
    } catch (err: unknown) {
      return {
        configured: true,
        connected: false,
        secrets_count: 0,
        message: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  ipcMain.handle('clear_keeper_config', () => {
    const configPath = getConfigPath()
    try {
      if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
      secretsCache = null
      return { success: true, message: 'Keeper configuration cleared' }
    } catch (err: unknown) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('test_keeper_connection', async () => {
    if (!isConfigured()) {
      return {
        success: false,
        secrets: [],
        message: 'Keeper not configured. Please enter a one-time token first.',
      }
    }

    try {
      const storage = localConfigStorage(getConfigPath())
      const { records } = await getSecrets({ storage })
      secretsCache = buildCache(records)

      return {
        success: true,
        secrets: secretsCache.secrets.map(s => ({
          uid: s.uid,
          title: s.title,
          record_type: s.recordType,
          has_api_key: s.password !== null,
        })),
        message: `Found ${records.length} secrets`,
      }
    } catch (err: unknown) {
      return {
        success: false,
        secrets: [],
        message: err instanceof Error ? err.message : String(err),
      }
    }
  })
}
