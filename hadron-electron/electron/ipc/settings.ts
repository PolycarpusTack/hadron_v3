import { IpcMain, app, clipboard } from 'electron'
import updaterPkg from 'electron-updater'
const { autoUpdater } = updaterPkg
import Store from 'electron-store'
import log from 'electron-log'
import { getSecret, setSecret, deleteSecret } from '../services/safe-storage'
import { getDb } from '../database'
import { shutdownMcpClient } from '../services/mcp-client'

const stores = new Map<string, InstanceType<typeof Store>>()

// Store names prefixed with '_' are reserved for main-process-only use.
// The renderer must never be allowed to write to them.
function isRendererWritable(name: string): boolean {
  return !name.startsWith('_')
}

function getStore(name: string): InstanceType<typeof Store> {
  if (!stores.has(name)) stores.set(name, new Store({ name }))
  return stores.get(name)!
}

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('store:get', (_e, { store, key }: { store: string; key: string }) => {
    return getStore(store).get(key) ?? null
  })

  ipcMain.handle('store:set', (_e, { store, key, value }: { store: string; key: string; value: unknown }) => {
    if (!isRendererWritable(store)) return
    getStore(store).set(key, value)
  })

  ipcMain.handle('store:delete', (_e, { store, key }: { store: string; key: string }) => {
    if (!isRendererWritable(store)) return
    getStore(store).delete(key)
  })

  ipcMain.handle('store:has', (_e, { store, key }: { store: string; key: string }) => {
    return getStore(store).has(key)
  })

  ipcMain.handle('store:entries', (_e, { store }: { store: string }) => {
    if (!isRendererWritable(store)) return []
    return Object.entries(getStore(store).store)
  })

  // Keytar handlers ignore the renderer-supplied service and always use the
  // app's own service name, preventing a compromised renderer from reading
  // credentials that belong to other applications.
  const KEYTAR_SERVICE = 'hadron-electron'

  ipcMain.handle('keytar:get', (_e, { account }: { service?: string; account: string }) => {
    try {
      return getSecret(KEYTAR_SERVICE, account)
    } catch (err) {
      log.warn('keytar:get failed', err)
      return null
    }
  })

  ipcMain.handle('keytar:set', (_e, { account, password }: { service?: string; account: string; password: string }) => {
    setSecret(KEYTAR_SERVICE, account, password)
  })

  ipcMain.handle('keytar:delete', (_e, { account }: { service?: string; account: string }) => {
    deleteSecret(KEYTAR_SERVICE, account)
  })

  // Only expose a vetted subset of app.getPath() names. This prevents the
  // renderer from probing locations the UI never legitimately needs (e.g.
  // 'crashDumps', 'sessionData') and stops typos/junk from throwing
  // unhelpful errors that could leak internals.
  const ALLOWED_GET_PATH = new Set<Parameters<typeof app.getPath>[0]>([
    'home', 'appData', 'userData', 'sessionData', 'temp', 'logs', 'documents', 'downloads', 'desktop',
  ])
  ipcMain.handle('app:getPath', (_e, name: string) => {
    const n = name as Parameters<typeof app.getPath>[0]
    if (!ALLOWED_GET_PATH.has(n)) throw new Error(`Disallowed path name: ${name}`)
    return app.getPath(n)
  })

  ipcMain.handle('app:exit', (_e, { code }: { code: number }) => {
    app.exit(code)
  })

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('export_diagnostics', () => {
    const db = getDb()
    const counts = {
      analyses: (db.prepare('SELECT COUNT(*) AS c FROM analyses').get() as { c: number }).c,
      translations: (db.prepare('SELECT COUNT(*) AS c FROM translations').get() as { c: number }).c,
      chatSessions: (db.prepare('SELECT COUNT(*) AS c FROM chat_sessions').get() as { c: number }).c,
    }
    return JSON.stringify({ platform: 'electron', ...counts }, null, 2)
  })

  ipcMain.handle('updater:check', async () => {
    try {
      autoUpdater.autoDownload = false
      const result = await autoUpdater.checkForUpdates()
      if (!result) return null
      const info = result.updateInfo
      const currentVersion = app.getVersion()
      const hasUpdate = info.version !== currentVersion
      if (!hasUpdate) return null
      return {
        available: true,
        currentVersion,
        version: info.version,
        date: info.releaseDate ?? null,
        body: Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n: { note?: string | null } | string) =>
              typeof n === 'string' ? n : (n.note ?? '')
            ).join('\n')
          : (info.releaseNotes as string | null ?? null),
      }
    } catch (err) {
      log.warn('updater:check failed:', err)
      return null
    }
  })

  ipcMain.handle('updater:download-and-install', async () => {
    try {
      await autoUpdater.downloadUpdate()
      autoUpdater.quitAndInstall()
    } catch (err) {
      log.warn('updater:download-and-install failed:', err)
      throw err
    }
  })

  ipcMain.handle('get_codexmgx_config', () => {
    const s = getStore('settings')
    return {
      scriptPath: s.get('codexmgx_script_path', '') as string,
      enabled: s.get('codexmgx_enabled', false) as boolean,
    }
  })

  ipcMain.handle('save_codexmgx_config', (_e, args: { scriptPath: string; enabled: boolean }) => {
    const s = getStore('settings')
    s.set('codexmgx_script_path', args.scriptPath)
    s.set('codexmgx_enabled', args.enabled)
    shutdownMcpClient()
    return { ok: true }
  })
}
