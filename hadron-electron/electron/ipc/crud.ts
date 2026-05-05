import { IpcMain } from 'electron'
import { getDb } from '../database'

// SQLite returns 0/1 for booleans and stores suggested_fixes as a JSON
// array string. Normalise every raw DB row before sending to the renderer.
function normalizeAnalysis(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    is_favorite: Boolean(row.is_favorite),
    was_truncated: Boolean(row.was_truncated),
    // Keep as the original JSON string — AnalysisDetailView handles JSON.parse
    suggested_fixes: row.suggested_fixes ?? '[]',
  }
}

export function registerCrudHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_all_analyses', (_e, args?: { limit?: number; offset?: number }) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM analyses WHERE deleted_at IS NULL ORDER BY analyzed_at DESC LIMIT ? OFFSET ?
    `).all(args?.limit ?? 100, args?.offset ?? 0) as Record<string, unknown>[]
    return rows.map(normalizeAnalysis)
  })

  ipcMain.handle('get_analyses_paginated', (_e, args: { page: number; page_size: number }) => {
    const db = getDb()
    const offset = (args.page - 1) * args.page_size
    const rows = db.prepare(`
      SELECT * FROM analyses WHERE deleted_at IS NULL ORDER BY analyzed_at DESC LIMIT ? OFFSET ?
    `).all(args.page_size, offset) as Record<string, unknown>[]
    const total = (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL').get() as { c: number }).c
    return { items: rows.map(normalizeAnalysis), total, page: args.page, page_size: args.page_size }
  })

  ipcMain.handle('get_analyses_count', () => {
    return (getDb().prepare('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL').get() as { c: number }).c
  })

  ipcMain.handle('get_analysis_by_id', (_e, args: { id: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(args.id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`Analysis ${args.id} not found`)
    db.prepare(`UPDATE analyses SET view_count = view_count + 1, last_viewed_at = datetime('now') WHERE id = ?`).run(args.id)
    return normalizeAnalysis(row)
  })

  ipcMain.handle('delete_analysis', (_e, args: { id: number }) => {
    getDb().prepare(`UPDATE analyses SET deleted_at = datetime('now') WHERE id = ?`).run(args.id)
  })

  ipcMain.handle('export_analysis', (_e, args: { id: number }) => {
    const row = getDb().prepare('SELECT * FROM analyses WHERE id = ?').get(args.id) as Record<string, unknown> | undefined
    return row ? normalizeAnalysis(row) : undefined
  })

  ipcMain.handle('toggle_favorite', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('UPDATE analyses SET is_favorite = NOT is_favorite WHERE id = ?').run(args.id)
    const row = db.prepare('SELECT is_favorite FROM analyses WHERE id = ?').get(args.id) as { is_favorite: number } | undefined
    return { is_favorite: !!row?.is_favorite }
  })

  ipcMain.handle('get_favorites', () => {
    const rows = getDb().prepare('SELECT * FROM analyses WHERE is_favorite=1 AND deleted_at IS NULL ORDER BY analyzed_at DESC').all() as Record<string, unknown>[]
    return rows.map(normalizeAnalysis)
  })

  ipcMain.handle('get_recent', (_e, args?: { limit?: number }) => {
    const rows = getDb().prepare(`
      SELECT * FROM analyses WHERE deleted_at IS NULL AND last_viewed_at IS NOT NULL
      ORDER BY last_viewed_at DESC LIMIT ?
    `).all(args?.limit ?? 20) as Record<string, unknown>[]
    return rows.map(normalizeAnalysis)
  })

  ipcMain.handle('get_database_statistics', () => {
    const db = getDb()
    const total_count = (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL').get() as { c: number }).c
    const favorite_count = (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE is_favorite=1 AND deleted_at IS NULL').get() as { c: number }).c
    const severity_breakdown = (db.prepare(
      "SELECT severity, COUNT(*) AS count FROM analyses WHERE deleted_at IS NULL AND severity IS NOT NULL GROUP BY severity"
    ).all() as Array<{ severity: string; count: number }>).map(r => [r.severity, r.count] as [string, number])
    return { total_count, favorite_count, severity_breakdown }
  })

  ipcMain.handle('get_all_translations', () => {
    return getDb().prepare('SELECT * FROM translations WHERE deleted_at IS NULL ORDER BY translated_at DESC').all()
  })

  ipcMain.handle('get_translation_by_id', (_e, args: { id: number }) => {
    return getDb().prepare('SELECT * FROM translations WHERE id = ?').get(args.id)
  })

  ipcMain.handle('delete_translation', (_e, args: { id: number }) => {
    getDb().prepare(`UPDATE translations SET deleted_at = datetime('now') WHERE id = ?`).run(args.id)
  })

  ipcMain.handle('toggle_translation_favorite', (_e, args: { id: number }) => {
    getDb().prepare('UPDATE translations SET is_favorite = NOT is_favorite WHERE id = ?').run(args.id)
  })

  ipcMain.handle('optimize_fts_index', () => {
    getDb().exec("INSERT INTO analyses_fts(analyses_fts) VALUES('optimize')")
  })

  ipcMain.handle('check_database_integrity', () => {
    const result = getDb().pragma('integrity_check') as Array<{ integrity_check: string }>
    return { ok: result[0]?.integrity_check === 'ok', details: result.map(r => r.integrity_check) }
  })

  ipcMain.handle('compact_database', () => {
    getDb().exec('VACUUM')
  })

  ipcMain.handle('checkpoint_wal', () => {
    getDb().pragma('wal_checkpoint(FULL)')
  })

  ipcMain.handle('count_analyses_without_tags', () => {
    return (getDb().prepare(`
      SELECT COUNT(*) AS c FROM analyses a
      WHERE a.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM analysis_tags at2 WHERE at2.analysis_id = a.id)
    `).get() as { c: number }).c
  })

  ipcMain.handle('auto_tag_analyses', (_e, args?: { limit?: number }) => {
    // Auto-tagging is handled client-side in the desktop app
    return { scanned: 0, tagged: 0, skipped: 0, failed: 0, limit: args?.limit ?? 100 }
  })
}
