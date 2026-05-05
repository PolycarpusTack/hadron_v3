import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerAnalyticsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_dashboard_stats', () => {
    const db = getDb()
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 86400000).toISOString()
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
    const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString()

    const count = (sql: string, ...p: unknown[]) =>
      (db.prepare(sql).get(...p) as { c: number }).c

    return {
      scanDay:    count('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= ?', dayAgo),
      scanWeek:   count('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= ?', weekAgo),
      scanMonth:  count('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= ?', monthAgo),
      scanTotal:  count('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL'),
      severityCritical: count("SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND severity='CRITICAL'"),
      severityHigh:     count("SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND severity='HIGH'"),
      severityMedium:   count("SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND severity='MEDIUM'"),
      severityLow:      count("SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND severity='LOW'"),
      goldPending:  count("SELECT COUNT(*) AS c FROM gold_analyses WHERE validation_status='pending'"),
      goldVerified: count("SELECT COUNT(*) AS c FROM gold_analyses WHERE validation_status='verified'"),
      goldRejected: count("SELECT COUNT(*) AS c FROM gold_analyses WHERE validation_status='rejected'"),
      goldTotal:    count('SELECT COUNT(*) AS c FROM gold_analyses'),
    }
  })

  // Frontend sends { period, rangeDays } — accept both rangeDays and legacy days
  ipcMain.handle('get_trend_data', (_e, args?: { days?: number; rangeDays?: number; period?: string }) => {
    const days = args?.rangeDays ?? args?.days ?? 30
    const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30
    const rows = getDb().prepare(`
      SELECT date(analyzed_at) AS day, COUNT(*) AS count,
        SUM(CASE WHEN severity='CRITICAL' THEN 1 ELSE 0 END) AS criticalCount,
        SUM(CASE WHEN severity='HIGH' THEN 1 ELSE 0 END) AS highCount,
        SUM(CASE WHEN severity='MEDIUM' THEN 1 ELSE 0 END) AS mediumCount,
        SUM(CASE WHEN severity='LOW' THEN 1 ELSE 0 END) AS lowCount
      FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= datetime('now', '-' || ? || ' days')
      GROUP BY day ORDER BY day ASC
    `).all(safeDays) as Array<Record<string, unknown>>

    return rows.map(r => ({
      period: r.day,
      total: r.count,
      criticalCount: r.criticalCount ?? 0,
      highCount: r.highCount ?? 0,
      mediumCount: r.mediumCount ?? 0,
      lowCount: r.lowCount ?? 0,
      whatsonCount: 0,
      completeCount: 0,
      specializedCount: 0,
      totalCost: 0,
    }))
  })

  // Frontend expects { errorType, component, signature, count }
  ipcMain.handle('get_top_error_patterns', (_e, args?: { limit?: number }) => {
    const rows = getDb().prepare(`
      SELECT error_type, component, COUNT(*) AS count FROM analyses
      WHERE deleted_at IS NULL AND error_type IS NOT NULL
      GROUP BY error_type ORDER BY count DESC LIMIT ?
    `).all(args?.limit ?? 10) as Array<Record<string, unknown>>

    return rows.map(r => ({
      errorType: r.error_type,
      component: r.component ?? null,
      signature: r.error_type,
      count: r.count,
    }))
  })

  // Frontend sends { analysisId, limit } — normalize from camelCase
  ipcMain.handle('get_similar_analyses', (_e, args: { id?: number; analysisId?: number; limit?: number }) => {
    const id = args.id ?? args.analysisId
    if (!id) return []
    const db = getDb()
    const row = db.prepare('SELECT error_type, component FROM analyses WHERE id = ?').get(id) as { error_type: string; component: string } | undefined
    if (!row) return []
    return db.prepare(`
      SELECT * FROM analyses WHERE id != ? AND deleted_at IS NULL
        AND (error_type = ? OR component = ?)
      ORDER BY analyzed_at DESC LIMIT ?
    `).all(id, row.error_type, row.component, args.limit ?? 5)
  })

  ipcMain.handle('count_similar_analyses', (_e, args: { id?: number; analysisId?: number }) => {
    const id = args.id ?? args.analysisId
    if (!id) return 0
    const db = getDb()
    const row = db.prepare('SELECT error_type FROM analyses WHERE id = ?').get(id) as { error_type: string } | undefined
    if (!row) return 0
    return (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE id != ? AND error_type = ? AND deleted_at IS NULL').get(id, row.error_type) as { c: number }).c
  })
}
