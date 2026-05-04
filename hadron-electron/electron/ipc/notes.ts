import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerNotesHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('add_note_to_analysis', (_e, args: { analysis_id: number; content: string }) => {
    return getDb().prepare('INSERT INTO analysis_notes (analysis_id, content) VALUES (?, ?) RETURNING *')
      .get(args.analysis_id, args.content)
  })

  ipcMain.handle('update_note', (_e, args: { id: number; content: string }) => {
    getDb().prepare('UPDATE analysis_notes SET content = ?, updated_at = datetime("now") WHERE id = ?')
      .run(args.content, args.id)
  })

  ipcMain.handle('delete_note', (_e, args: { id: number }) => {
    getDb().prepare('DELETE FROM analysis_notes WHERE id = ?').run(args.id)
  })

  ipcMain.handle('get_notes_for_analysis', (_e, args: { analysis_id: number }) => {
    return getDb().prepare('SELECT * FROM analysis_notes WHERE analysis_id = ? ORDER BY created_at ASC').all(args.analysis_id)
  })

  ipcMain.handle('get_note_count', (_e, args: { analysis_id: number }) => {
    return (getDb().prepare('SELECT COUNT(*) AS c FROM analysis_notes WHERE analysis_id = ?').get(args.analysis_id) as { c: number }).c
  })

  ipcMain.handle('analysis_has_notes', (_e, args: { analysis_id: number }) => {
    return (getDb().prepare('SELECT COUNT(*) AS c FROM analysis_notes WHERE analysis_id = ?').get(args.analysis_id) as { c: number }).c > 0
  })
}
