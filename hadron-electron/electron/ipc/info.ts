import { IpcMain, app } from 'electron'
import { getDb } from '../database'
import fs from 'fs/promises'
import path from 'path'

export function registerInfoHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_database_info', async () => {
    const db = getDb()
    const dbPath = path.join(app.getPath('userData'), 'hadron.db')
    let sizeKb = 0
    try {
      const stat = await fs.stat(dbPath)
      sizeKb = stat.size / 1024
    } catch { /* ignore */ }
    const version = (db.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v: number }).v
    return { path: dbPath, size_kb: sizeKb, schema_version: version }
  })

  ipcMain.handle('get_file_stats', async (_e, args: { file_path: string }) => {
    try {
      const stat = await fs.stat(args.file_path)
      return { size_bytes: stat.size, size_kb: stat.size / 1024, exists: true }
    } catch {
      return { size_bytes: 0, size_kb: 0, exists: false }
    }
  })

  ipcMain.handle('get_crash_log_dir', () => app.getPath('userData'))
  ipcMain.handle('set_crash_log_dir', () => {})
  ipcMain.handle('get_stability_mode', () => 'normal')
  ipcMain.handle('set_stability_mode', () => {})
}
