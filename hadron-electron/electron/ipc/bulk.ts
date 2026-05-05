import { IpcMain } from 'electron'
import { getDb } from '../database'

// SECURITY: cap renderer-supplied id arrays so a single malicious IPC call
// cannot tie up the main process with a 10M-element transaction, and reject
// non-array / non-integer values rather than silently iterating string chars.
const MAX_BULK_IDS = 10_000

function sanitiseIds(input: unknown): number[] {
  if (!Array.isArray(input)) return []
  const out: number[] = []
  for (const v of input) {
    const n = Number(v)
    if (Number.isInteger(n) && n > 0) out.push(n)
    if (out.length >= MAX_BULK_IDS) break
  }
  return out
}

function sanitiseId(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function registerBulkHandlers(ipcMain: IpcMain): void {
  // Frontend sends { ids } for delete operations
  ipcMain.handle('bulk_delete_analyses', (_e, args: { ids: number[] }) => {
    const ids = sanitiseIds(args?.ids)
    const db = getDb()
    const stmt = db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?')
    db.transaction((xs: number[]) => xs.forEach(id => stmt.run(id)))(ids)
  })

  ipcMain.handle('bulk_delete_translations', (_e, args: { ids: number[] }) => {
    const ids = sanitiseIds(args?.ids)
    const db = getDb()
    const stmt = db.prepare('UPDATE translations SET deleted_at = datetime("now") WHERE id = ?')
    db.transaction((xs: number[]) => xs.forEach(id => stmt.run(id)))(ids)
  })

  // Frontend sends { analysisIds, tagId } (camelCase)
  ipcMain.handle('bulk_add_tag_to_analyses', (_e, args: { analysisIds?: number[]; analysis_ids?: number[]; tagId?: number; tag_id?: number }) => {
    const ids = sanitiseIds(args?.analysis_ids ?? args?.analysisIds ?? [])
    const tag_id = sanitiseId(args?.tag_id ?? args?.tagId)
    if (tag_id === null) return
    const db = getDb()
    const stmt = db.prepare('INSERT OR IGNORE INTO analysis_tags (analysis_id, tag_id) VALUES (?, ?)')
    db.transaction((xs: number[]) => xs.forEach(id => stmt.run(id, tag_id)))(ids)
  })

  ipcMain.handle('bulk_remove_tag_from_analyses', (_e, args: { analysisIds?: number[]; analysis_ids?: number[]; tagId?: number; tag_id?: number }) => {
    const ids = sanitiseIds(args?.analysis_ids ?? args?.analysisIds ?? [])
    const tag_id = sanitiseId(args?.tag_id ?? args?.tagId)
    if (tag_id === null) return
    const db = getDb()
    const stmt = db.prepare('DELETE FROM analysis_tags WHERE analysis_id = ? AND tag_id = ?')
    db.transaction((xs: number[]) => xs.forEach(id => stmt.run(id, tag_id)))(ids)
  })

  // Frontend sends { analysisIds, favorite } (camelCase, boolean)
  ipcMain.handle('bulk_set_favorite_analyses', (_e, args: { analysisIds?: number[]; ids?: number[]; favorite?: boolean; is_favorite?: boolean }) => {
    const ids = sanitiseIds(args?.ids ?? args?.analysisIds ?? [])
    const val = (args?.is_favorite ?? args?.favorite) ? 1 : 0
    const db = getDb()
    const stmt = db.prepare('UPDATE analyses SET is_favorite = ? WHERE id = ?')
    db.transaction((xs: number[]) => xs.forEach(id => stmt.run(val, id)))(ids)
  })

  // Frontend sends { translationIds, favorite }
  ipcMain.handle('bulk_set_favorite_translations', (_e, args: { translationIds?: number[]; ids?: number[]; favorite?: boolean; is_favorite?: boolean }) => {
    const ids = sanitiseIds(args?.ids ?? args?.translationIds ?? [])
    const val = (args?.is_favorite ?? args?.favorite) ? 1 : 0
    const db = getDb()
    const stmt = db.prepare('UPDATE translations SET is_favorite = ? WHERE id = ?')
    db.transaction((xs: number[]) => xs.forEach(id => stmt.run(val, id)))(ids)
  })
}
