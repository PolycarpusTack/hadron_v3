import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerSearchHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('search_analyses', (_e, args: { query: string; limit?: number; offset?: number }) => {
    const db = getDb()
    if (!args.query.trim()) {
      return db.prepare('SELECT * FROM analyses WHERE deleted_at IS NULL ORDER BY analyzed_at DESC LIMIT ? OFFSET ?')
        .all(args.limit ?? 50, args.offset ?? 0)
    }
    return db.prepare(`
      SELECT a.* FROM analyses a
      JOIN analyses_fts f ON f.rowid = a.id
      WHERE analyses_fts MATCH ? AND a.deleted_at IS NULL
      ORDER BY rank LIMIT ? OFFSET ?
    `).all(args.query, args.limit ?? 50, args.offset ?? 0)
  })

  ipcMain.handle('get_analyses_filtered', (_e, args: {
    severity?: string
    analysis_type?: string
    is_favorite?: boolean
    tag_ids?: number[]
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
  }) => {
    const db = getDb()
    const conditions = ['a.deleted_at IS NULL']
    const params: unknown[] = []

    if (args.severity) { conditions.push('a.severity = ?'); params.push(args.severity) }
    if (args.analysis_type) { conditions.push('a.analysis_type = ?'); params.push(args.analysis_type) }
    if (args.is_favorite) { conditions.push('a.is_favorite = 1') }
    if (args.date_from) { conditions.push('a.analyzed_at >= ?'); params.push(args.date_from) }
    if (args.date_to) { conditions.push('a.analyzed_at <= ?'); params.push(args.date_to) }
    if (args.tag_ids?.length) {
      conditions.push(`a.id IN (SELECT analysis_id FROM analysis_tags WHERE tag_id IN (${args.tag_ids.map(() => '?').join(',')}))`)
      params.push(...args.tag_ids)
    }

    params.push(args.limit ?? 50, args.offset ?? 0)
    return db.prepare(`
      SELECT a.* FROM analyses a WHERE ${conditions.join(' AND ')}
      ORDER BY a.analyzed_at DESC LIMIT ? OFFSET ?
    `).all(...params)
  })
}
