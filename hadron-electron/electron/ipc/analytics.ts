import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerAnalyticsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_dashboard_stats', () => {
    const db = getDb()
    const total = (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL').get() as { c: number }).c
    const thisWeek = (db.prepare(`SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= datetime('now', '-7 days')`).get() as { c: number }).c
    const bySeverity = db.prepare('SELECT severity, COUNT(*) AS count FROM analyses WHERE deleted_at IS NULL GROUP BY severity').all()
    return { total, thisWeek, bySeverity }
  })

  ipcMain.handle('get_trend_data', (_e, args?: { days?: number }) => {
    const days = args?.days ?? 30
    return getDb().prepare(`
      SELECT date(analyzed_at) AS day, COUNT(*) AS count
      FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= datetime('now', '-' || ? || ' days')
      GROUP BY day ORDER BY day ASC
    `).all(days)
  })

  ipcMain.handle('get_top_error_patterns', (_e, args?: { limit?: number }) => {
    return getDb().prepare(`
      SELECT error_type, COUNT(*) AS count FROM analyses
      WHERE deleted_at IS NULL AND error_type IS NOT NULL
      GROUP BY error_type ORDER BY count DESC LIMIT ?
    `).all(args?.limit ?? 10)
  })

  ipcMain.handle('get_similar_analyses', (_e, args: { id: number; limit?: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT error_type, component FROM analyses WHERE id = ?').get(args.id) as { error_type: string; component: string } | undefined
    if (!row) return []
    return db.prepare(`
      SELECT * FROM analyses WHERE id != ? AND deleted_at IS NULL
        AND (error_type = ? OR component = ?)
      ORDER BY analyzed_at DESC LIMIT ?
    `).all(args.id, row.error_type, row.component, args.limit ?? 5)
  })

  ipcMain.handle('count_similar_analyses', (_e, args: { id: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT error_type FROM analyses WHERE id = ?').get(args.id) as { error_type: string } | undefined
    if (!row) return 0
    return (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE id != ? AND error_type = ? AND deleted_at IS NULL').get(args.id, row.error_type) as { c: number }).c
  })
}
