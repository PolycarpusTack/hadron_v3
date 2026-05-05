import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerBulkHandlers(ipcMain: IpcMain): void {
  // Frontend sends { ids } for delete operations
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

  // Frontend sends { analysisIds, tagId } (camelCase)
  ipcMain.handle('bulk_add_tag_to_analyses', (_e, args: { analysisIds?: number[]; analysis_ids?: number[]; tagId?: number; tag_id?: number }) => {
    const ids = args.analysis_ids ?? args.analysisIds ?? []
    const tag_id = args.tag_id ?? args.tagId
    const db = getDb()
    const stmt = db.prepare('INSERT OR IGNORE INTO analysis_tags (analysis_id, tag_id) VALUES (?, ?)')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id, tag_id)))(ids)
  })

  ipcMain.handle('bulk_remove_tag_from_analyses', (_e, args: { analysisIds?: number[]; analysis_ids?: number[]; tagId?: number; tag_id?: number }) => {
    const ids = args.analysis_ids ?? args.analysisIds ?? []
    const tag_id = args.tag_id ?? args.tagId
    const db = getDb()
    const stmt = db.prepare('DELETE FROM analysis_tags WHERE analysis_id = ? AND tag_id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id, tag_id)))(ids)
  })

  // Frontend sends { analysisIds, favorite } (camelCase, boolean)
  ipcMain.handle('bulk_set_favorite_analyses', (_e, args: { analysisIds?: number[]; ids?: number[]; favorite?: boolean; is_favorite?: boolean }) => {
    const ids = args.ids ?? args.analysisIds ?? []
    const val = (args.is_favorite ?? args.favorite) ? 1 : 0
    const db = getDb()
    const stmt = db.prepare('UPDATE analyses SET is_favorite = ? WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(val, id)))(ids)
  })

  // Frontend sends { translationIds, favorite }
  ipcMain.handle('bulk_set_favorite_translations', (_e, args: { translationIds?: number[]; ids?: number[]; favorite?: boolean; is_favorite?: boolean }) => {
    const ids = args.ids ?? args.translationIds ?? []
    const val = (args.is_favorite ?? args.favorite) ? 1 : 0
    const db = getDb()
    const stmt = db.prepare('UPDATE translations SET is_favorite = ? WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(val, id)))(ids)
  })
}
