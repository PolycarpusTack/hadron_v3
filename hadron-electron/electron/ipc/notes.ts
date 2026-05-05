import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerNotesHandlers(ipcMain: IpcMain): void {
  // Frontend sends { analysisId, content } (camelCase)
  ipcMain.handle('add_note_to_analysis', (_e, args: { analysisId?: number; analysis_id?: number; content: string }) => {
    const analysis_id = args.analysis_id ?? args.analysisId
    return getDb().prepare('INSERT INTO analysis_notes (analysis_id, content) VALUES (?, ?) RETURNING *')
      .get(analysis_id, args.content)
  })

  ipcMain.handle('update_note', (_e, args: { id: number; content: string }) => {
    getDb().prepare(`UPDATE analysis_notes SET content = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(args.content, args.id)
  })

  ipcMain.handle('delete_note', (_e, args: { id: number }) => {
    getDb().prepare('DELETE FROM analysis_notes WHERE id = ?').run(args.id)
  })

  ipcMain.handle('get_notes_for_analysis', (_e, args: { analysisId?: number; analysis_id?: number }) => {
    const analysis_id = args.analysis_id ?? args.analysisId
    return getDb().prepare('SELECT * FROM analysis_notes WHERE analysis_id = ? ORDER BY created_at ASC').all(analysis_id)
  })

  ipcMain.handle('get_note_count', (_e, args: { analysisId?: number; analysis_id?: number }) => {
    const analysis_id = args.analysis_id ?? args.analysisId
    return (getDb().prepare('SELECT COUNT(*) AS c FROM analysis_notes WHERE analysis_id = ?').get(analysis_id) as { c: number }).c
  })

  ipcMain.handle('analysis_has_notes', (_e, args: { analysisId?: number; analysis_id?: number }) => {
    const analysis_id = args.analysis_id ?? args.analysisId
    return (getDb().prepare('SELECT COUNT(*) AS c FROM analysis_notes WHERE analysis_id = ?').get(analysis_id) as { c: number }).c > 0
  })
}
