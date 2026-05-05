import { IpcMain, BrowserWindow } from 'electron'
import log from 'electron-log'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'
import { readJiraCreds, jiraFetch } from '../services/jira-client'

const RELEASE_NOTES_SYSTEM_PROMPT = `You are a technical writer creating release notes for WHATS'ON broadcast management software.
Format as structured markdown with these sections:
## New Features
## Bug Fixes
## Improvements
## Breaking Changes (only if any)

Each item: "- **[KEY]** Brief user-facing description."
Be concise. Omit empty sections.`

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
    checklistJson: string
  }) => {
    try {
      const db = getDb()
      const now = new Date().toISOString()
      const result = db.prepare(`
        UPDATE release_notes
        SET checklist_state = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(args.checklistJson, now, args.id)
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

  // ──────────────────────────────────────────────────────────────────────────
  // 10. export_release_notes
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('export_release_notes', (_e, args: { id: number; format: string }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM release_notes WHERE id = ?').get(args.id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`Release notes ${args.id} not found`)
    const content = (row.markdown_content as string) ?? ''
    if (args.format === 'json') {
      return JSON.stringify(row, null, 2)
    }
    // markdown or plain text — return content directly
    return content
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 11. check_release_notes_compliance
  // Frontend sends { content, apiKey, model, provider } — mirrors Tauri contract.
  // Uses AI to produce a ComplianceReport with terminologyViolations, structureViolations,
  // screenshotSuggestions, score, tokensUsed, cost.
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('check_release_notes_compliance', async (_e, args: {
    content: string; apiKey: string; model: string; provider: string
  }) => {
    const systemPrompt = `You are a WHATS'ON release notes style auditor. You enforce the company's release notes style guide with precision.

Given a draft, analyze it and return a JSON object with exactly these fields:

1. "terminologyViolations" — array of objects with: lineContext, violation, suggestedFix, ruleReference. Check wrong UI terms, abbreviations, "customers" vs "users", incorrect capitalization, passive voice, quotes around UI text instead of bold, etc.

2. "structureViolations" — array of objects with: section, violation, suggestedFix, ruleReference. Check: features missing proper structure, fixes not starting with "Previously,...", missing ticket references in brackets, titles with colons or quotes, fixes not ending with "This issue has been fixed in this version.", etc.

3. "screenshotSuggestions" — array of objects with: ticketKey, description, placementHint, inlinePlaceholder. Identify places where a screenshot would help. The inlinePlaceholder should be formatted as [SCREENSHOT: brief description].

4. "score" — number 0-100 reflecting overall style guide compliance. 100 = perfect. Deduct: terminology -3, structure -5. Screenshots don't affect score.

Return ONLY valid JSON. No markdown fences.`

    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey: args.apiKey,
      systemPrompt,
      userPrompt: `Review this release notes draft for style compliance:\n\n${args.content}`,
      maxTokens: 4096,
    })

    let parsed: Record<string, unknown>
    try {
      const jsonStr = result.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      parsed = {}
    }

    return {
      terminologyViolations: (parsed.terminologyViolations as unknown[]) ?? [],
      structureViolations: (parsed.structureViolations as unknown[]) ?? [],
      screenshotSuggestions: (parsed.screenshotSuggestions as unknown[]) ?? [],
      score: typeof parsed.score === 'number' ? parsed.score : 100,
      tokensUsed: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      cost: result.cost ?? 0,
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 12. preview_release_notes_tickets — fetch JIRA tickets for a fix version
  // Returns ReleaseNoteTicketPreview[] for the UI to display before generation.
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('preview_release_notes_tickets', async (_e, args: {
    config: { fixVersion: string; contentType?: string; projectKey?: string; jqlFilter?: string }
    baseUrl?: string
    email?: string
    apiToken?: string
  }) => {
    try {
      let baseUrl: string
      let email: string
      let apiToken: string

      if (args.baseUrl && args.email && args.apiToken) {
        baseUrl = args.baseUrl
        email = args.email
        apiToken = args.apiToken
      } else {
        const creds = readJiraCreds()
        baseUrl = creds.baseUrl
        email = creds.email
        apiToken = creds.apiToken
      }

      const fixVersion = args.config.fixVersion
      const projectKey = args.config.projectKey
      const jqlFilter = args.config.jqlFilter

      // Escape JQL string values to prevent injection (same as generate_release_notes)
      const escJql = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      let jql = jqlFilter || `fixVersion = "${escJql(fixVersion)}"`
      if (projectKey && !jqlFilter) jql = `project = "${escJql(projectKey)}" AND fixVersion = "${escJql(fixVersion)}"`

      const issues = await fetchJiraTickets(baseUrl, email, apiToken, jql, 100)
      return issues.map(issue => ({
        key: issue.key,
        summary: issue.fields.summary ?? '(no summary)',
        issueType: issue.fields.issuetype?.name ?? 'Unknown',
        priority: issue.fields.priority?.name ?? 'Unknown',
        status: issue.fields.status?.name ?? 'Unknown',
        components: [],
        labels: [],
      }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('preview_release_notes_tickets failed:', message)
      throw new Error(message)
    }
  })
}
