import { IpcMain } from 'electron'
import { getDb } from '../database'
import log from 'electron-log'
import { readJiraCreds, jiraFetch } from '../services/jira-client'

export function registerJiraHandlers(ipcMain: IpcMain): void {
  // ──────────────────────────────────────────────────────────────────────────
  // HTTP API handlers
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle('test_jira_connection', async () => {
    try {
      const { baseUrl, email, apiToken } = readJiraCreds()
      const data = await jiraFetch(baseUrl, email, apiToken, '/rest/api/3/myself') as { displayName?: string; emailAddress?: string }
      return {
        success: true,
        message: `Connected as ${data.displayName ?? data.emailAddress ?? 'unknown user'}`,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('test_jira_connection failed:', message)
      return { success: false, message }
    }
  })

  ipcMain.handle('list_jira_projects', async () => {
    try {
      const { baseUrl, email, apiToken } = readJiraCreds()
      const data = await jiraFetch(baseUrl, email, apiToken, '/rest/api/3/project') as Array<{ id: string; key: string; name: string }>
      return data.map(p => ({ id: p.id, key: p.key, name: p.name }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_jira_projects failed:', message)
      throw new Error(message)
    }
  })

  ipcMain.handle('create_jira_ticket', async (_e, args: {
    projectKey: string
    summary: string
    description?: string
    issueType?: string
    priority?: string
    labels?: string[]
    [key: string]: unknown
  }) => {
    try {
      const { baseUrl, email, apiToken } = readJiraCreds()
      const body = {
        fields: {
          project: { key: args.projectKey },
          summary: args.summary,
          description: args.description
            ? {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: args.description }] }],
              }
            : undefined,
          issuetype: { name: args.issueType ?? 'Bug' },
          ...(args.priority ? { priority: { name: args.priority } } : {}),
          ...(args.labels ? { labels: args.labels } : {}),
        },
      }
      const data = await jiraFetch(baseUrl, email, apiToken, '/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as { key: string; id: string }
      return {
        key: data.key,
        id: data.id,
        url: `${baseUrl.replace(/\/$/, '')}/browse/${data.key}`,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('create_jira_ticket failed:', message)
      throw new Error(message)
    }
  })

  ipcMain.handle('search_jira_issues', async (_e, args: {
    jql: string
    maxResults?: number
    fields?: string[]
  }) => {
    try {
      const { baseUrl, email, apiToken } = readJiraCreds()
      const params = new URLSearchParams({
        jql: args.jql,
        maxResults: String(Math.min(args.maxResults ?? 50, 100)),
      })
      if (args.fields && args.fields.length > 0) {
        params.set('fields', args.fields.join(','))
      }
      return jiraFetch(baseUrl, email, apiToken, `/rest/api/3/issue/search?${params.toString()}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('search_jira_issues failed:', message)
      throw new Error(message)
    }
  })

  ipcMain.handle('search_jira_issues_next_page', async (_e, args: {
    jql: string
    startAt: number
    maxResults?: number
    fields?: string[]
  }) => {
    try {
      const { baseUrl, email, apiToken } = readJiraCreds()
      const params = new URLSearchParams({
        jql: args.jql,
        startAt: String(args.startAt),
        maxResults: String(Math.min(args.maxResults ?? 50, 100)),
      })
      if (args.fields && args.fields.length > 0) {
        params.set('fields', args.fields.join(','))
      }
      return jiraFetch(baseUrl, email, apiToken, `/rest/api/3/issue/search?${params.toString()}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('search_jira_issues_next_page failed:', message)
      throw new Error(message)
    }
  })

  ipcMain.handle('post_jira_comment', async (_e, args: {
    issueKey: string
    body: string
  }) => {
    try {
      const { baseUrl, email, apiToken } = readJiraCreds()
      const commentBody = {
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: args.body }] }],
        },
      }
      return jiraFetch(baseUrl, email, apiToken, `/rest/api/3/issue/${encodeURIComponent(args.issueKey)}/comment`, {
        method: 'POST',
        body: JSON.stringify(commentBody),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('post_jira_comment failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // DB linking handlers  (table: analysis_jira_links)
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle('link_jira_to_analysis', (_e, args: {
    analysisId: number
    jiraKey: string
    jiraUrl?: string
    jiraSummary?: string
    jiraStatus?: string
    jiraPriority?: string
    linkType?: string
    linkedBy?: string
    notes?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT OR REPLACE INTO analysis_jira_links
        (analysis_id, jira_key, jira_url, jira_summary, jira_status, jira_priority,
         link_type, linked_at, linked_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      args.analysisId,
      args.jiraKey,
      args.jiraUrl ?? null,
      args.jiraSummary ?? null,
      args.jiraStatus ?? null,
      args.jiraPriority ?? null,
      args.linkType ?? 'related',
      now,
      args.linkedBy ?? null,
      args.notes ?? null,
    )
    return db.prepare(
      'SELECT * FROM analysis_jira_links WHERE analysis_id = ? AND jira_key = ?'
    ).get(args.analysisId, args.jiraKey)
  })

  ipcMain.handle('unlink_jira_from_analysis', (_e, args: {
    analysisId: number
    jiraKey: string
  }) => {
    const db = getDb()
    const result = db.prepare(
      'DELETE FROM analysis_jira_links WHERE analysis_id = ? AND jira_key = ?'
    ).run(args.analysisId, args.jiraKey)
    return result.changes > 0
  })

  ipcMain.handle('get_jira_links_for_analysis', (_e, args: { analysisId: number }) => {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM analysis_jira_links WHERE analysis_id = ? ORDER BY linked_at DESC'
    ).all(args.analysisId)
  })

  ipcMain.handle('get_analyses_for_jira_ticket', (_e, args: { jiraKey: string }) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT a.*, l.id AS link_id, l.link_type, l.linked_at, l.linked_by, l.notes,
             l.jira_url, l.jira_summary, l.jira_status, l.jira_priority
      FROM analysis_jira_links l
      INNER JOIN analyses a ON a.id = l.analysis_id
      WHERE l.jira_key = ?
      ORDER BY l.linked_at DESC
    `).all(args.jiraKey) as Record<string, unknown>[]
    return rows.map(row => {
      const link = {
        id: row.link_id,
        analysis_id: row.id,
        jira_key: args.jiraKey,
        jira_url: row.jira_url,
        jira_summary: row.jira_summary,
        jira_status: row.jira_status,
        jira_priority: row.jira_priority,
        link_type: row.link_type,
        linked_at: row.linked_at,
        linked_by: row.linked_by,
        notes: row.notes,
      }
      const analysis = { ...row }
      delete analysis.link_id
      delete analysis.link_type
      delete analysis.linked_at
      delete analysis.linked_by
      delete analysis.notes
      delete analysis.jira_url
      delete analysis.jira_summary
      delete analysis.jira_status
      delete analysis.jira_priority
      return [analysis, link]
    })
  })

  ipcMain.handle('update_jira_link_metadata', (_e, args: {
    jiraKey: string
    jiraSummary?: string
    jiraStatus?: string
    jiraPriority?: string
  }) => {
    const db = getDb()
    const updates: string[] = []
    const params: unknown[] = []
    if (args.jiraSummary !== undefined) { updates.push('jira_summary = ?'); params.push(args.jiraSummary) }
    if (args.jiraStatus !== undefined) { updates.push('jira_status = ?'); params.push(args.jiraStatus) }
    if (args.jiraPriority !== undefined) { updates.push('jira_priority = ?'); params.push(args.jiraPriority) }
    if (updates.length === 0) return 0
    params.push(args.jiraKey)
    const result = db.prepare(
      `UPDATE analysis_jira_links SET ${updates.join(', ')} WHERE jira_key = ?`
    ).run(...params)
    return result.changes
  })

  ipcMain.handle('count_jira_links_for_analysis', (_e, args: { analysisId: number }) => {
    const db = getDb()
    const row = db.prepare(
      'SELECT COUNT(*) AS count FROM analysis_jira_links WHERE analysis_id = ?'
    ).get(args.analysisId) as { count: number }
    return row.count
  })

  ipcMain.handle('get_all_jira_links', () => {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM analysis_jira_links ORDER BY linked_at DESC'
    ).all()
  })
}
