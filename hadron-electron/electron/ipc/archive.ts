import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerArchiveHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('archive_analysis', (_e, args: { id: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(args.id)
    if (!row) throw new Error('Analysis not found')
    db.prepare('INSERT INTO archived_analyses (original_id, data_json) VALUES (?, ?)').run(args.id, JSON.stringify(row))
    db.prepare('UPDATE analyses SET deleted_at = datetime('now') WHERE id = ?').run(args.id)
  })

  ipcMain.handle('restore_analysis', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('UPDATE analyses SET deleted_at = NULL WHERE id = ?').run(args.id)
    db.prepare('DELETE FROM archived_analyses WHERE original_id = ?').run(args.id)
  })

  ipcMain.handle('get_archived_analyses', () => {
    return getDb().prepare('SELECT * FROM analyses WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all()
  })

  ipcMain.handle('permanently_delete_analysis', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('DELETE FROM archived_analyses WHERE original_id = ?').run(args.id)
    db.prepare('DELETE FROM analyses WHERE id = ?').run(args.id)
  })

  ipcMain.handle('bulk_archive_analyses', (_e, args: { ids: number[] }) => {
    // SECURITY: cap renderer-supplied id arrays and reject non-integer ids
    // so a single malicious IPC call cannot pin the main process.
    const MAX_BULK_IDS = 10_000
    const safeIds: number[] = []
    if (Array.isArray(args?.ids)) {
      for (const v of args.ids) {
        const n = Number(v)
        if (Number.isInteger(n) && n > 0) safeIds.push(n)
        if (safeIds.length >= MAX_BULK_IDS) break
      }
    }
    const db = getDb()
    const archiveStmt = db.prepare('INSERT OR IGNORE INTO archived_analyses (original_id, data_json) VALUES (?, ?)')
    const deleteStmt = db.prepare('UPDATE analyses SET deleted_at = datetime('now') WHERE id = ?')
    db.transaction((ids: number[]) => {
      for (const id of ids) {
        const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(id)
        if (row) { archiveStmt.run(id, JSON.stringify(row)); deleteStmt.run(id) }
      }
    })(safeIds)
  })

  ipcMain.handle('archive_translation', (_e, args: { id: number }) => {
    getDb().prepare('UPDATE translations SET deleted_at = datetime('now') WHERE id = ?').run(args.id)
  })

  ipcMain.handle('restore_translation', (_e, args: { id: number }) => {
    getDb().prepare('UPDATE translations SET deleted_at = NULL WHERE id = ?').run(args.id)
  })
}
