import { IpcMain, app } from 'electron'
import { getDb } from '../database'
import fs from 'fs/promises'
import path from 'path'
import Store from 'electron-store'
import { isWriteAllowed } from './dialogAllowlist'
import { isSystemPath } from '../services/path-security'

const settingsStore = new Store({ name: 'settings' })

export function registerInfoHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_database_info', async () => {
    const db = getDb()
    const dbPath = path.join(app.getPath('userData'), 'hadron.db')
    let sizeBytes = 0
    try {
      const stat = await fs.stat(dbPath)
      sizeBytes = stat.size
    } catch { /* ignore */ }

    let schemaVersion = 0
    try {
      schemaVersion = (db.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v: number }).v
    } catch { /* table may not exist on fresh DB */ }

    const count = (sql: string) => {
      try { return (db.prepare(sql).get() as { c: number }).c } catch { return 0 }
    }

    const lastAnalysis = (() => {
      try {
        const r = db.prepare('SELECT MAX(analyzed_at) AS t FROM analyses WHERE deleted_at IS NULL').get() as { t: string | null }
        return r.t ?? undefined
      } catch { return undefined }
    })()

    return {
      path: dbPath,
      size_kb: sizeBytes / 1024,
      schema_version: schemaVersion,
      needs_migration: false,
      analyses_count: count('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL'),
      translations_count: count('SELECT COUNT(*) AS c FROM translations WHERE deleted_at IS NULL'),
      favorites_count: count('SELECT COUNT(*) AS c FROM analyses WHERE is_favorite=1 AND deleted_at IS NULL'),
      database_size_bytes: sizeBytes,
      last_analysis_at: lastAnalysis,
    }
  })

  ipcMain.handle('get_file_stats', async (_e, args: { file_path: string }) => {
    if (!args || typeof args.file_path !== 'string') {
      return { size_bytes: 0, size_kb: 0, exists: false }
    }
    if (isSystemPath(args.file_path)) {
      return { size_bytes: 0, size_kb: 0, exists: false }
    }
    try {
      const stat = await fs.stat(args.file_path)
      return { size_bytes: stat.size, size_kb: stat.size / 1024, exists: true }
    } catch {
      return { size_bytes: 0, size_kb: 0, exists: false }
    }
  })

  ipcMain.handle('get_crash_log_dir', () => {
    return (settingsStore.get('crash_log_dir', '') as string) || app.getPath('userData')
  })

  ipcMain.handle('set_crash_log_dir', (_e, args: { dir: string } | string) => {
    const dir = typeof args === 'string' ? args : (args as { dir: string })?.dir
    // Clearing the override is always allowed — falls back to userData.
    if (!dir) {
      settingsStore.delete('crash_log_dir')
      return app.getPath('userData')
    }
    // SECURITY: the renderer must have authorised this directory through an
    // open-directory dialog (or it must be the app's own userData root).
    // Without this, a compromised renderer could persist `/etc` or
    // `~/.ssh` as the crash-log directory and trick later code paths
    // into reading from it.
    const resolved = path.resolve(dir)
    const userData = path.resolve(app.getPath('userData'))
    const isUserData = resolved === userData || resolved.startsWith(userData + path.sep)
    if (isSystemPath(resolved) || (!isUserData && !isWriteAllowed(resolved))) {
      throw new Error('Access denied: directory was not authorised by an open-directory dialog')
    }
    settingsStore.set('crash_log_dir', resolved)
    return resolved
  })

  ipcMain.handle('get_stability_mode', () => {
    return settingsStore.get('stability_mode', false) as boolean
  })

  ipcMain.handle('set_stability_mode', (_e, args: { enabled: boolean } | boolean) => {
    const enabled = typeof args === 'boolean' ? args : (args as { enabled: boolean }).enabled
    settingsStore.set('stability_mode', enabled)
    return enabled
  })
}
