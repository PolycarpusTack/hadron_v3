import { IpcMain } from 'electron'
import { getDb } from '../database'

function ftsPhrase(q: string): string {
  return '"' + q.substring(0, 200).replace(/"/g, '""') + '"'
}

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
    `).all(ftsPhrase(args.query), args.limit ?? 50, args.offset ?? 0)
  })

  // Accepts both direct args and Tauri-style { options: { ... } } wrapper.
  // Returns FilteredResults<Analysis>: { items, totalCount, page, pageSize, hasMore }
  ipcMain.handle('get_analyses_filtered', (_e, args: {
    options?: {
      search?: string
      severities?: string[]
      analysisTypes?: string[]
      tagIds?: number[]
      tagMode?: string
      dateFrom?: string
      dateTo?: string
      costMin?: number
      costMax?: number
      favoritesOnly?: boolean
      includeArchived?: boolean
      sortBy?: string
      sortOrder?: string
      limit?: number
      offset?: number
    }
    // legacy direct fields
    severity?: string
    analysis_type?: string
    is_favorite?: boolean
    tag_ids?: number[]
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
  }) => {
    const opts = (args.options ?? args) as {
      search?: string; severities?: string[]; analysisTypes?: string[]
      tagIds?: number[]; tagMode?: string; dateFrom?: string; dateTo?: string
      costMin?: number; costMax?: number; favoritesOnly?: boolean
      includeArchived?: boolean; sortBy?: string; sortOrder?: string
      limit?: number; offset?: number
      // legacy
      severity?: string; analysis_type?: string; is_favorite?: boolean
      tag_ids?: number[]; date_from?: string; date_to?: string
    }

    const db = getDb()
    const conditions: string[] = ['a.deleted_at IS NULL']
    const filterParams: unknown[] = []

    // Electron archives by setting deleted_at; archived_at column doesn't exist here.
    // The base condition 'a.deleted_at IS NULL' already excludes archived rows.
    if (opts.favoritesOnly || opts.is_favorite) conditions.push('a.is_favorite = 1')

    // Severity: plural array (new) or singular (legacy)
    const severities = opts.severities ?? (opts.severity ? [opts.severity] : [])
    if (severities.length) {
      conditions.push(`UPPER(a.severity) IN (${severities.map(() => '?').join(',')})`)
      filterParams.push(...severities.map(s => s.toUpperCase()))
    }

    // Analysis type: plural array (new) or singular (legacy)
    const types = opts.analysisTypes ?? (opts.analysis_type ? [opts.analysis_type] : [])
    if (types.length) {
      conditions.push(`a.analysis_type IN (${types.map(() => '?').join(',')})`)
      filterParams.push(...types)
    }

    const dateFrom = opts.dateFrom ?? opts.date_from
    const dateTo = opts.dateTo ?? opts.date_to
    if (dateFrom) { conditions.push('a.analyzed_at >= ?'); filterParams.push(dateFrom) }
    if (dateTo)   { conditions.push('a.analyzed_at <= ?'); filterParams.push(dateTo) }
    if (opts.costMin !== undefined) { conditions.push('a.cost >= ?'); filterParams.push(opts.costMin) }
    if (opts.costMax !== undefined) { conditions.push('a.cost <= ?'); filterParams.push(opts.costMax) }

    const tagIds = opts.tagIds ?? opts.tag_ids ?? []
    if (tagIds.length) {
      if (opts.tagMode === 'all') {
        for (const tagId of tagIds) {
          conditions.push('EXISTS (SELECT 1 FROM analysis_tags at2 WHERE at2.analysis_id = a.id AND at2.tag_id = ?)')
          filterParams.push(tagId)
        }
      } else {
        conditions.push(`a.id IN (SELECT analysis_id FROM analysis_tags WHERE tag_id IN (${tagIds.map(() => '?').join(',')}))`)
        filterParams.push(...tagIds)
      }
    }

    const limit  = opts.limit  ?? 50
    const offset = opts.offset ?? 0
    const sortDir = (opts.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
    const sortCol = opts.sortBy === 'severity' ? 'a.severity'
      : opts.sortBy === 'cost' ? 'a.cost'
      : 'a.analyzed_at'

    const where = conditions.join(' AND ')
    let items: unknown[]
    let total: number

    if (opts.search?.trim()) {
      const phrase = ftsPhrase(opts.search)
      items = db.prepare(`
        SELECT a.* FROM analyses a
        JOIN analyses_fts f ON f.rowid = a.id
        WHERE ${where} AND analyses_fts MATCH ?
        ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?
      `).all(...filterParams, phrase, limit, offset)
      total = (db.prepare(`
        SELECT COUNT(*) AS c FROM analyses a
        JOIN analyses_fts f ON f.rowid = a.id
        WHERE ${where} AND analyses_fts MATCH ?
      `).get(...filterParams, phrase) as { c: number }).c
    } else {
      items = db.prepare(`
        SELECT a.* FROM analyses a WHERE ${where}
        ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?
      `).all(...filterParams, limit, offset)
      total = (db.prepare(`
        SELECT COUNT(*) AS c FROM analyses a WHERE ${where}
      `).get(...filterParams) as { c: number }).c
    }

    return {
      items,
      totalCount: total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: (offset + limit) < total,
    }
  })
}
