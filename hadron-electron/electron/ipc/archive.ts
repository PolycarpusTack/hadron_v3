import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerArchiveHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('archive_analysis', (_e, args: { id: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(args.id)
    if (!row) throw new Error('Analysis not found')
    db.prepare('INSERT INTO archived_analyses (original_id, data_json) VALUES (?, ?)').run(args.id, JSON.stringify(row))
    db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?').run(args.id)
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
    const db = getDb()
    const archiveStmt = db.prepare('INSERT OR IGNORE INTO archived_analyses (original_id, data_json) VALUES (?, ?)')
    const deleteStmt = db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?')
    db.transaction((ids: number[]) => {
      for (const id of ids) {
        const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(id)
        if (row) { archiveStmt.run(id, JSON.stringify(row)); deleteStmt.run(id) }
      }
    })(args.ids)
  })

  ipcMain.handle('archive_translation', (_e, args: { id: number }) => {
    getDb().prepare('UPDATE translations SET deleted_at = datetime("now") WHERE id = ?').run(args.id)
  })

  ipcMain.handle('restore_translation', (_e, args: { id: number }) => {
    getDb().prepare('UPDATE translations SET deleted_at = NULL WHERE id = ?').run(args.id)
  })
}
