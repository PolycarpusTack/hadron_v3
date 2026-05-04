import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerBulkHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('bulk_delete_analyses', (_e, args: { ids: number[] }) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id)))(args.ids)
  })

  ipcMain.handle('bulk_delete_translations', (_e, args: { ids: number[] }) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE translations SET deleted_at = datetime("now") WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id)))(args.ids)
  })

  ipcMain.handle('bulk_add_tag_to_analyses', (_e, args: { analysis_ids: number[]; tag_id: number }) => {
    const db = getDb()
    const stmt = db.prepare('INSERT OR IGNORE INTO analysis_tags (analysis_id, tag_id) VALUES (?, ?)')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id, args.tag_id)))(args.analysis_ids)
  })

  ipcMain.handle('bulk_remove_tag_from_analyses', (_e, args: { analysis_ids: number[]; tag_id: number }) => {
    const db = getDb()
    const stmt = db.prepare('DELETE FROM analysis_tags WHERE analysis_id = ? AND tag_id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id, args.tag_id)))(args.analysis_ids)
  })

  ipcMain.handle('bulk_set_favorite_analyses', (_e, args: { ids: number[]; is_favorite: boolean }) => {
    const db = getDb()
    const val = args.is_favorite ? 1 : 0
    const stmt = db.prepare('UPDATE analyses SET is_favorite = ? WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(val, id)))(args.ids)
  })

  ipcMain.handle('bulk_set_favorite_translations', (_e, args: { ids: number[]; is_favorite: boolean }) => {
    const db = getDb()
    const val = args.is_favorite ? 1 : 0
    const stmt = db.prepare('UPDATE translations SET is_favorite = ? WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(val, id)))(args.ids)
  })
}
