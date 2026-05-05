import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerTagHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_all_tags', () => {
    return getDb().prepare('SELECT * FROM tags ORDER BY usage_count DESC').all()
  })

  ipcMain.handle('create_tag', (_e, args: { name: string; color: string }) => {
    const db = getDb()
    return db.prepare('INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *').get(args.name, args.color)
  })

  ipcMain.handle('update_tag', (_e, args: { id: number; name?: string; color?: string }) => {
    const db = getDb()
    if (args.name !== undefined) db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(args.name, args.id)
    if (args.color !== undefined) db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(args.color, args.id)
  })

  ipcMain.handle('delete_tag', (_e, args: { id: number }) => {
    getDb().prepare('DELETE FROM tags WHERE id = ?').run(args.id)
  })

  // Frontend sends { analysisId, tagId } (camelCase)
  ipcMain.handle('add_tag_to_analysis', (_e, args: { analysisId?: number; analysis_id?: number; tagId?: number; tag_id?: number }) => {
    const analysis_id = args.analysis_id ?? args.analysisId
    const tag_id = args.tag_id ?? args.tagId
    const db = getDb()
    db.prepare('INSERT OR IGNORE INTO analysis_tags (analysis_id, tag_id) VALUES (?, ?)').run(analysis_id, tag_id)
    db.prepare('UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?').run(tag_id)
  })

  ipcMain.handle('remove_tag_from_analysis', (_e, args: { analysisId?: number; analysis_id?: number; tagId?: number; tag_id?: number }) => {
    const analysis_id = args.analysis_id ?? args.analysisId
    const tag_id = args.tag_id ?? args.tagId
    const db = getDb()
    db.prepare('DELETE FROM analysis_tags WHERE analysis_id = ? AND tag_id = ?').run(analysis_id, tag_id)
    db.prepare('UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?').run(tag_id)
  })

  ipcMain.handle('get_tags_for_analysis', (_e, args: { analysisId?: number; analysis_id?: number }) => {
    const analysis_id = args.analysis_id ?? args.analysisId
    return getDb().prepare(`
      SELECT t.* FROM tags t
      JOIN analysis_tags at2 ON at2.tag_id = t.id
      WHERE at2.analysis_id = ?
    `).all(analysis_id)
  })

  // Frontend sends { translationId, tagId } (camelCase)
  ipcMain.handle('add_tag_to_translation', (_e, args: { translationId?: number; translation_id?: number; tagId?: number; tag_id?: number }) => {
    const translation_id = args.translation_id ?? args.translationId
    const tag_id = args.tag_id ?? args.tagId
    getDb().prepare('INSERT OR IGNORE INTO translation_tags (translation_id, tag_id) VALUES (?, ?)').run(translation_id, tag_id)
  })

  ipcMain.handle('remove_tag_from_translation', (_e, args: { translationId?: number; translation_id?: number; tagId?: number; tag_id?: number }) => {
    const translation_id = args.translation_id ?? args.translationId
    const tag_id = args.tag_id ?? args.tagId
    getDb().prepare('DELETE FROM translation_tags WHERE translation_id = ? AND tag_id = ?').run(translation_id, tag_id)
  })

  ipcMain.handle('get_tags_for_translation', (_e, args: { translationId?: number; translation_id?: number }) => {
    const translation_id = args.translation_id ?? args.translationId
    return getDb().prepare(`
      SELECT t.* FROM tags t
      JOIN translation_tags tt ON tt.tag_id = t.id
      WHERE tt.translation_id = ?
    `).all(translation_id)
  })
}
