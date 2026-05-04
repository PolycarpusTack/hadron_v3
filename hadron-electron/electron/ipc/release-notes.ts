import { IpcMain, BrowserWindow } from 'electron'
import log from 'electron-log'
import Store from 'electron-store'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'

const settingsStore = new Store({ name: 'settings' })

const RELEASE_NOTES_SYSTEM_PROMPT = `You are a technical writer creating release notes for WHATS'ON broadcast management software.
Format as structured markdown with these sections:
## New Features
## Bug Fixes
## Improvements
## Breaking Changes (only if any)

Each item: "- **[KEY]** Brief user-facing description."
Be concise. Omit empty sections.`

function readJiraCreds(): { baseUrl: string; email: string; apiToken: string } {
  const baseUrl = settingsStore.get('jira_base_url', '') as string
  const email = settingsStore.get('jira_email', '') as string
  const apiToken = settingsStore.get('jira_api_key', '') as string
  if (!baseUrl || !email || !apiToken) {
    throw new Error('JIRA not configured. Please set up JIRA credentials in Settings.')
  }
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:') {
      throw new Error('JIRA base URL must use https://')
    }
  } catch (e) {
    if ((e as Error).message.includes('Invalid URL')) {
      throw new Error('JIRA base URL is not a valid URL')
    }
    throw e
  }
  return { baseUrl, email, apiToken }
}

async function jiraFetch(
  baseUrl: string,
  email: string,
  apiToken: string,
  path: string,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  } as Parameters<typeof fetch>[1])
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`JIRA API error ${res.status}: ${body.substring(0, 200)}`)
  }
  return res.json()
}

interface JiraIssue {
  key: string
  fields: {
    summary?: string
    issuetype?: { name?: string }
    status?: { name?: string }
    priority?: { name?: string }
  }
}

interface JiraSearchResult {
  issues: JiraIssue[]
  total: number
}

interface JiraVersion {
  id: string
  name: string
  released: boolean
  releaseDate?: string
}

async function fetchJiraTickets(
  baseUrl: string,
  email: string,
  apiToken: string,
  jql: string,
  maxResults = 100
): Promise<JiraIssue[]> {
  const params = new URLSearchParams({
    jql,
    maxResults: String(Math.min(maxResults, 100)),
    fields: 'summary,issuetype,status,priority',
  })
  const data = await jiraFetch(
    baseUrl,
    email,
    apiToken,
    `/rest/api/3/issue/search?${params.toString()}`
  ) as JiraSearchResult
  return data.issues ?? []
}

function buildTicketPrompt(issues: JiraIssue[]): string {
  if (issues.length === 0) return 'No tickets found.'
  return issues.map(issue => {
    const type = issue.fields.issuetype?.name ?? 'Unknown'
    const summary = issue.fields.summary ?? '(no summary)'
    return `${issue.key} [${type}]: ${summary}`
  }).join('\n')
}

export function registerReleaseNotesHandlers(ipcMain: IpcMain): void {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. generate_release_notes
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('generate_release_notes', async (event, args: {
    config: { fixVersion: string; jql?: string; title?: string }
    requestId?: string
    provider: string
    model: string
    apiKey: string
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const requestId = args.requestId ?? null

    const sendProgress = (progress: number, message: string) => {
      win?.webContents.send('release-notes:progress', { progress, message, request_id: requestId })
    }

    try {
      sendProgress(10, 'Fetching JIRA tickets...')

      const { baseUrl, email, apiToken } = readJiraCreds()
      const escapedVersion = args.config.fixVersion.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const defaultJql = `fixVersion = "${escapedVersion}" ORDER BY created DESC`
      const jql = args.config.jql ?? defaultJql

      const issues = await fetchJiraTickets(baseUrl, email, apiToken, jql)

      sendProgress(40, `Generating release notes for ${issues.length} ticket(s)...`)

      const ticketKeys = issues.map(i => i.key)
      const ticketPrompt = buildTicketPrompt(issues)
      const title = args.config.title ?? `Release Notes — ${args.config.fixVersion}`

      const userPrompt = `Fix Version: ${args.config.fixVersion}\n\nTickets:\n${ticketPrompt}`

      const aiResult = await callAi({
        provider: args.provider,
        model: args.model,
        apiKey: args.apiKey,
        systemPrompt: RELEASE_NOTES_SYSTEM_PROMPT,
        userPrompt,
        maxTokens: 4096,
      })

      const now = new Date().toISOString()
      const db = getDb()

      const row = db.prepare(`
        INSERT INTO release_notes (
          fix_version, title, markdown_content, original_ai_content,
          ticket_keys, ticket_count, jql_filter,
          ai_model, ai_provider,
          tokens_used, cost, status,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?, 'draft',
          ?, ?
        )
      `).run(
        args.config.fixVersion,
        title,
        aiResult.content,
        aiResult.content,
        JSON.stringify(ticketKeys),
        ticketKeys.length,
        jql,
        args.model,
        args.provider,
        (aiResult.inputTokens ?? 0) + (aiResult.outputTokens ?? 0),
        aiResult.cost,
        now,
        now,
      )

      sendProgress(100, 'Release notes generated.')

      return {
        id: row.lastInsertRowid,
        title,
        markdown_content: aiResult.content,
        ticket_count: ticketKeys.length,
        ticket_keys: ticketKeys,
        tokens_used: (aiResult.inputTokens ?? 0) + (aiResult.outputTokens ?? 0),
        cost: aiResult.cost,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('generate_release_notes failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. list_release_notes
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('list_release_notes', (_e, args: {
    status?: string
    limit?: number
    offset?: number
  }) => {
    try {
      const db = getDb()
      const limit = args.limit ?? 50
      const offset = args.offset ?? 0
      const params: unknown[] = []
      let where = 'WHERE deleted_at IS NULL'
      if (args.status) {
        where += ' AND status = ?'
        params.push(args.status)
      }
      params.push(limit, offset)
      return db.prepare(`
        SELECT id, title, fix_version, ticket_count, status, created_at, updated_at
        FROM release_notes
        ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_release_notes failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. get_release_notes
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('get_release_notes', (_e, args: { id: number }) => {
    try {
      const db = getDb()
      const row = db.prepare(
        'SELECT * FROM release_notes WHERE id = ? AND deleted_at IS NULL'
      ).get(args.id)
      if (!row) throw new Error(`Release notes not found: ${args.id}`)
      return row
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('get_release_notes failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. update_release_notes_content
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('update_release_notes_content', (_e, args: {
    id: number
    content: string
  }) => {
    try {
      const db = getDb()
      const now = new Date().toISOString()
      const result = db.prepare(`
        UPDATE release_notes
        SET markdown_content = ?, updated_at = ?, is_manual_edit = 1
        WHERE id = ? AND deleted_at IS NULL
      `).run(args.content, now, args.id)
      if (result.changes === 0) throw new Error(`Release notes not found: ${args.id}`)
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('update_release_notes_content failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. update_release_notes_status
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('update_release_notes_status', (_e, args: {
    id: number
    status: string
    reviewedBy?: string
  }) => {
    try {
      const VALID_STATUSES = ['draft', 'in_review', 'approved', 'published', 'archived']
      if (!VALID_STATUSES.includes(args.status)) {
        throw new Error(`Invalid status: ${args.status}. Must be one of: ${VALID_STATUSES.join(', ')}`)
      }
      const db = getDb()
      const now = new Date().toISOString()
      const updates: string[] = ['status = ?', 'updated_at = ?']
      const params: unknown[] = [args.status, now]

      if (args.reviewedBy) {
        updates.push('reviewed_by = ?', 'reviewed_at = ?')
        params.push(args.reviewedBy, now)
      }

      if (args.status === 'published') {
        updates.push('published_at = ?')
        params.push(now)
      }

      params.push(args.id)

      const result = db.prepare(`
        UPDATE release_notes SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL
      `).run(...params)

      if (result.changes === 0) throw new Error(`Release notes not found: ${args.id}`)
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('update_release_notes_status failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. update_release_notes_checklist
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('update_release_notes_checklist', (_e, args: {
    id: number
    checklistState: string
  }) => {
    try {
      const db = getDb()
      const now = new Date().toISOString()
      const result = db.prepare(`
        UPDATE release_notes
        SET checklist_state = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(args.checklistState, now, args.id)
      if (result.changes === 0) throw new Error(`Release notes not found: ${args.id}`)
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('update_release_notes_checklist failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 7. delete_release_notes (soft delete)
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('delete_release_notes', (_e, args: { id: number }) => {
    try {
      const db = getDb()
      const now = new Date().toISOString()
      const result = db.prepare(`
        UPDATE release_notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
      `).run(now, args.id)
      if (result.changes === 0) throw new Error(`Release notes not found: ${args.id}`)
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('delete_release_notes failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 8. append_to_release_notes
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('append_to_release_notes', async (_e, args: {
    id: number
    additionalJql: string
    provider: string
    model: string
    apiKey: string
  }) => {
    try {
      const db = getDb()
      const existing = db.prepare(
        'SELECT * FROM release_notes WHERE id = ? AND deleted_at IS NULL'
      ).get(args.id) as Record<string, unknown> | undefined

      if (!existing) throw new Error(`Release notes not found: ${args.id}`)

      const { baseUrl, email, apiToken } = readJiraCreds()
      const newIssues = await fetchJiraTickets(baseUrl, email, apiToken, args.additionalJql)

      const existingKeys: string[] = JSON.parse((existing.ticket_keys as string) ?? '[]')
      const newKeys = newIssues.map(i => i.key).filter(k => !existingKeys.includes(k))

      if (newKeys.length === 0) {
        return { success: true, appended: 0 }
      }

      const ticketPrompt = buildTicketPrompt(newIssues.filter(i => newKeys.includes(i.key)))

      const aiResult = await callAi({
        provider: args.provider,
        model: args.model,
        apiKey: args.apiKey,
        systemPrompt: RELEASE_NOTES_SYSTEM_PROMPT,
        userPrompt: `Additional tickets to append to existing release notes:\n\n${ticketPrompt}`,
        maxTokens: 2048,
      })

      const appendedContent = `${existing.markdown_content as string}\n\n---\n\n${aiResult.content}`
      const mergedKeys = [...existingKeys, ...newKeys]
      const now = new Date().toISOString()
      const prevTokens = (existing.tokens_used as number) ?? 0
      const prevCost = (existing.cost as number) ?? 0

      db.prepare(`
        UPDATE release_notes
        SET markdown_content = ?, ticket_keys = ?, ticket_count = ?,
            tokens_used = ?, cost = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(
        appendedContent,
        JSON.stringify(mergedKeys),
        mergedKeys.length,
        prevTokens + (aiResult.inputTokens ?? 0) + (aiResult.outputTokens ?? 0),
        prevCost + aiResult.cost,
        now,
        args.id,
      )

      return { success: true, appended: newKeys.length }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('append_to_release_notes failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 9. list_jira_fix_versions
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('list_jira_fix_versions', async (_e, args: { projectKey: string }) => {
    try {
      const { baseUrl, email, apiToken } = readJiraCreds()
      const path = `/rest/api/3/project/${encodeURIComponent(args.projectKey)}/versions?orderBy=-releaseDate`
      const data = await jiraFetch(baseUrl, email, apiToken, path) as JiraVersion[]
      return data.map(v => ({
        id: v.id,
        name: v.name,
        released: v.released ?? false,
        release_date: v.releaseDate ?? null,
      }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_jira_fix_versions failed:', message)
      throw new Error(message)
    }
  })
}
