import { IpcMain } from 'electron'
import { getDb } from '../database'
import log from 'electron-log'
import { callAi } from '../services/ai-service'
import { getSecret } from '../services/safe-storage'
import { readJiraCreds, readJiraProjectKey, jiraFetch, SERVICE_NAME } from '../services/jira-client'
import { ftsPhrase } from '../services/db-helpers'
import { wrapField } from '../services/prompt-helpers'

// ──────────────────────────────────────────────────────────────────────────────
// System prompts
// ──────────────────────────────────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a JIRA ticket triage assistant for WHATS'ON broadcast software. Analyze the ticket and return JSON only:
{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "category": "string (e.g. Bug, Performance, UX, Data, Config)",
  "customer_impact": "string (1-2 sentences)",
  "tags": ["tag1", "tag2"],
  "priority_score": 0-100,
  "reasoning": "string"
}
Return only valid JSON with no markdown fences.`

const BRIEF_SYSTEM_PROMPT = `You are a technical analyst for WHATS'ON broadcast software. Analyze the JIRA ticket and return JSON only:
{
  "triage": {
    "severity": "CRITICAL|HIGH|MEDIUM|LOW",
    "category": "string",
    "customer_impact": "string",
    "tags": [],
    "priority_score": 0
  },
  "analysis": {
    "plain_summary": "string",
    "technical": {
      "error_type": "string",
      "severity_estimate": "string",
      "root_cause": "string",
      "confidence": "HIGH|MEDIUM|LOW"
    },
    "recommended_actions": [{"priority": "HIGH|MEDIUM|LOW", "action": "string"}]
  }
}
Return only valid JSON with no markdown fences.`

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function getApiKey(provider: string): string {
  const key = getSecret(SERVICE_NAME, provider)
  if (!key) throw new Error(`No API key configured for provider '${provider}'`)
  return key
}

function parseJsonResponse(content: string, fallback: unknown): unknown {
  try {
    return JSON.parse(content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim())
  } catch {
    return fallback
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Poller state (module-level, single instance per main process)
// ──────────────────────────────────────────────────────────────────────────────

interface PollerState {
  running: boolean
  lastPolledAt: string | null
  ticketsTriagedTotal: number
  intervalMins: number
  timer: ReturnType<typeof setInterval> | null
}

const pollerState: PollerState = {
  running: false,
  lastPolledAt: null,
  ticketsTriagedTotal: 0,
  intervalMins: 15,
  timer: null,
}

async function runPollerCycle(): Promise<void> {
  let creds: { baseUrl: string; email: string; apiToken: string }
  let projectKey: string
  try {
    creds = readJiraCreds()
    projectKey = readJiraProjectKey()
  } catch {
    log.debug('Poller: JIRA not configured, skipping cycle')
    return
  }
  if (!projectKey) {
    log.debug('Poller: no project key configured, skipping cycle')
    return
  }

  const db = getDb()
  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')

  const since = new Date(Date.now() - pollerState.intervalMins * 2 * 60 * 1000)
  const sinceStr = since.toISOString().replace('T', ' ').substring(0, 16)
  const jql = encodeURIComponent(
    `project = ${projectKey} AND updated >= "${sinceStr}" ORDER BY updated DESC`
  )
  const url = `${creds.baseUrl.replace(/\/$/, '')}/rest/api/3/search?jql=${jql}&fields=summary,description,status,priority,labels,components&maxResults=20`

  let issues: Array<{ key: string; fields: Record<string, unknown> }>
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
    if (!res.ok) { log.warn('Poller fetch failed:', res.status); return }
    const data = await res.json() as { issues: typeof issues }
    issues = data.issues ?? []
  } catch (err) {
    log.warn('Poller network error:', err)
    return
  }

  let triaged = 0
  for (const issue of issues) {
    const existing = db.prepare('SELECT jira_key FROM ticket_briefs WHERE jira_key = ?').get(issue.key)
    if (existing) continue

    try {
      const fields = issue.fields
      const summary = (fields.summary as string) ?? issue.key
      const description = fields.description
        ? (typeof fields.description === 'string' ? fields.description : JSON.stringify(fields.description)).substring(0, 2000)
        : ''

      const apiKey = getSecret(SERVICE_NAME, 'openai') || getSecret(SERVICE_NAME, 'anthropic') || ''
      if (!apiKey) continue

      const provider = getSecret(SERVICE_NAME, 'openai') ? 'openai' : 'anthropic'
      const model = provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001'

      const triageResult = await callAi({
        provider, model, apiKey,
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        userPrompt: `Ticket: ${issue.key}\nSummary: ${wrapField('SUMMARY', summary)}\nDescription: ${wrapField('DESCRIPTION', description)}`,
        maxTokens: 512,
      })

      let triage: Record<string, unknown> = {}
      try { triage = JSON.parse(triageResult.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()) } catch { /* use empty */ }

      const now = new Date().toISOString()
      db.prepare(`
        INSERT OR IGNORE INTO ticket_briefs
          (jira_key, title, severity, category, tags, triage_json, brief_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        issue.key, summary,
        (triage.severity as string) ?? null,
        (triage.category as string) ?? null,
        triage.tags ? JSON.stringify(triage.tags) : null,
        JSON.stringify(triage),
        JSON.stringify({ summary }),
        now, now,
      )
      triaged++
    } catch (err) {
      log.warn(`Poller: triage failed for ${issue.key}:`, err)
    }
  }

  pollerState.lastPolledAt = new Date().toISOString()
  pollerState.ticketsTriagedTotal += triaged
  log.info(`Poller cycle complete: checked ${issues.length} tickets, triaged ${triaged} new`)
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler registration
// ──────────────────────────────────────────────────────────────────────────────

export function registerJiraAssistHandlers(ipcMain: IpcMain): void {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. get_ticket_brief
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('get_ticket_brief', (_e, args: { jiraKey: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM ticket_briefs WHERE jira_key = ?').get(args.jiraKey) ?? null
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. get_ticket_briefs_batch
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('get_ticket_briefs_batch', (_e, args: { jiraKeys: string[] }) => {
    if (!args.jiraKeys || args.jiraKeys.length === 0) return []
    const db = getDb()
    const placeholders = args.jiraKeys.map(() => '?').join(', ')
    return db.prepare(
      `SELECT * FROM ticket_briefs WHERE jira_key IN (${placeholders})`
    ).all(...args.jiraKeys)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. get_all_ticket_briefs
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('get_all_ticket_briefs', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM ticket_briefs ORDER BY updated_at DESC').all()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. delete_ticket_brief
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('delete_ticket_brief', (_e, args: { jiraKey: string }) => {
    const db = getDb()
    db.prepare('DELETE FROM ticket_briefs WHERE jira_key = ?').run(args.jiraKey)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. triage_jira_ticket
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('triage_jira_ticket', async (_e, args: {
    request?: { jira_key?: string; jiraKey?: string; title: string; description: string; provider: string; model: string }
    jira_key?: string; jiraKey?: string; title?: string; description?: string; provider?: string; model?: string
  }) => {
    try {
      // Accept both direct args and Tauri-style { request } wrapper; accept jira_key or jiraKey
      const p = args.request ?? (args as { jira_key?: string; jiraKey?: string; title: string; description: string; provider: string; model: string })
      const jiraKey = p.jira_key ?? p.jiraKey ?? ''
      const apiKey = getApiKey(p.provider)
      const userPrompt = `JIRA Key: ${jiraKey}\nTitle: ${wrapField('TITLE', p.title)}\n\nDescription:\n${wrapField('DESCRIPTION', p.description)}`

      const aiResult = await callAi({
        provider: p.provider,
        model: p.model,
        apiKey,
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        userPrompt,
        maxTokens: 1000,
      })

      const triage = parseJsonResponse(aiResult.content, {}) as Record<string, unknown>
      const db = getDb()
      const now = new Date().toISOString()

      db.prepare(`
        INSERT OR REPLACE INTO ticket_briefs
          (jira_key, title, severity, category, tags, triage_json, brief_json,
           posted_to_jira, posted_at, engineer_rating, engineer_notes,
           created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?,
            COALESCE((SELECT brief_json FROM ticket_briefs WHERE jira_key=?), NULL),
            COALESCE((SELECT posted_to_jira FROM ticket_briefs WHERE jira_key=?), 0),
            COALESCE((SELECT posted_at FROM ticket_briefs WHERE jira_key=?), NULL),
            COALESCE((SELECT engineer_rating FROM ticket_briefs WHERE jira_key=?), NULL),
            COALESCE((SELECT engineer_notes FROM ticket_briefs WHERE jira_key=?), NULL),
            COALESCE((SELECT created_at FROM ticket_briefs WHERE jira_key=?), ?), ?)
      `).run(
        jiraKey, p.title,
        (triage.severity as string) ?? null,
        (triage.category as string) ?? null,
        triage.tags ? JSON.stringify(triage.tags) : null,
        JSON.stringify(triage),
        jiraKey, jiraKey, jiraKey, jiraKey, jiraKey, jiraKey, now, now,
      )

      return triage
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('triage_jira_ticket failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. generate_ticket_brief
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('generate_ticket_brief', async (_e, args: {
    request?: { jira_key?: string; jiraKey?: string; title: string; description: string; provider: string; model: string }
    jira_key?: string; jiraKey?: string; title?: string; description?: string; provider?: string; model?: string
  }) => {
    try {
      // Accept both direct args and Tauri-style { request } wrapper; accept jira_key or jiraKey
      const p = args.request ?? (args as { jira_key?: string; jiraKey?: string; title: string; description: string; provider: string; model: string })
      const jiraKey = p.jira_key ?? p.jiraKey ?? ''
      const apiKey = getApiKey(p.provider)
      const userPrompt = `JIRA Key: ${jiraKey}\nTitle: ${wrapField('TITLE', p.title)}\n\nDescription:\n${wrapField('DESCRIPTION', p.description)}`

      const aiResult = await callAi({
        provider: p.provider,
        model: p.model,
        apiKey,
        systemPrompt: BRIEF_SYSTEM_PROMPT,
        userPrompt,
        maxTokens: 2000,
      })

      const brief = parseJsonResponse(aiResult.content, {}) as Record<string, unknown>
      const triage = (brief.triage as Record<string, unknown>) ?? {}
      const db = getDb()
      const now = new Date().toISOString()

      db.prepare(`
        INSERT OR REPLACE INTO ticket_briefs
          (jira_key, title, severity, category, tags, triage_json, brief_json,
           posted_to_jira, posted_at, engineer_rating, engineer_notes,
           created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?,
            COALESCE((SELECT posted_to_jira FROM ticket_briefs WHERE jira_key=?), 0),
            COALESCE((SELECT posted_at FROM ticket_briefs WHERE jira_key=?), NULL),
            COALESCE((SELECT engineer_rating FROM ticket_briefs WHERE jira_key=?), NULL),
            COALESCE((SELECT engineer_notes FROM ticket_briefs WHERE jira_key=?), NULL),
            COALESCE((SELECT created_at FROM ticket_briefs WHERE jira_key=?), ?), ?)
      `).run(
        jiraKey, p.title,
        (triage.severity as string) ?? null,
        (triage.category as string) ?? null,
        triage.tags ? JSON.stringify(triage.tags) : null,
        triage ? JSON.stringify(triage) : null,
        JSON.stringify(brief),
        jiraKey, jiraKey, jiraKey, jiraKey, jiraKey, now, now,
      )

      return brief
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('generate_ticket_brief failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 7. start_jira_poller + alias start_poller
  // ──────────────────────────────────────────────────────────────────────────
  const startPollerHandler = async () => {
    if (pollerState.timer) clearInterval(pollerState.timer)
    pollerState.running = true
    pollerState.timer = setInterval(() => {
      runPollerCycle().catch(err => log.warn('Poller cycle error:', err))
    }, pollerState.intervalMins * 60 * 1000)
    runPollerCycle().catch(err => log.warn('Poller initial cycle error:', err))
    return { status: 'started', message: `Polling every ${pollerState.intervalMins} minutes` }
  }
  ipcMain.handle('start_jira_poller', startPollerHandler)
  ipcMain.handle('start_poller', startPollerHandler)

  // ──────────────────────────────────────────────────────────────────────────
  // 8. stop_jira_poller + alias stop_poller
  // ──────────────────────────────────────────────────────────────────────────
  const stopPollerHandler = () => {
    if (pollerState.timer) { clearInterval(pollerState.timer); pollerState.timer = null }
    pollerState.running = false
  }
  ipcMain.handle('stop_jira_poller', stopPollerHandler)
  ipcMain.handle('stop_poller', stopPollerHandler)

  // ──────────────────────────────────────────────────────────────────────────
  // 9. get_poller_status
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('get_poller_status', () => ({
    running: pollerState.running,
    last_polled_at: pollerState.lastPolledAt,
    tickets_triaged_total: pollerState.ticketsTriagedTotal,
    interval_mins: pollerState.intervalMins,
  }))

  // ──────────────────────────────────────────────────────────────────────────
  // 10. find_similar_tickets via FTS5 on ticket_briefs_fts
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('find_similar_tickets', (_e, args: {
    jiraKey: string
    title: string
    description?: string
    apiKey?: string
    threshold?: number
    limit?: number
  }) => {
    const db = getDb()
    const limit = args.limit ?? 5
    const queryText = `${args.title} ${args.description ?? ''}`.replace(/[^\w\s]/g, ' ').trim()
    if (!queryText) return []

    try {
      db.exec("INSERT INTO ticket_briefs_fts(ticket_briefs_fts) VALUES('rebuild')")
    } catch { /* index may not exist yet */ }

    try {
      const rows = db.prepare(`
        SELECT tb.jira_key, tb.title, tb.severity, tb.category,
               (1.0 / (1.0 - ticket_briefs_fts.rank)) AS similarity
        FROM ticket_briefs_fts
        JOIN ticket_briefs tb ON ticket_briefs_fts.rowid = tb.rowid
        WHERE ticket_briefs_fts MATCH ?
          AND tb.jira_key != ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsPhrase(queryText), args.jiraKey, limit) as Array<{
        jira_key: string; title: string; similarity: number; severity: string | null; category: string | null
      }>
      return rows.map(r => ({
        jira_key: r.jira_key,
        title: r.title,
        similarity: Math.min(r.similarity, 0.99),
        severity: r.severity,
        category: r.category,
      }))
    } catch (err) {
      log.warn('find_similar_tickets FTS error:', err)
      return []
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 11. post_brief_to_jira — post investigation brief as JIRA comment.
  // SECURITY: baseUrl/email/apiToken are read from main-process credential
  // storage — NEVER trusted from the renderer. A malicious renderer cannot
  // redirect this POST to an attacker-controlled URL or smuggle out the
  // stored apiToken. jiraFetch() enforces https:// on the configured baseUrl.
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('post_brief_to_jira', async (_e, args: {
    jiraKey: string
    briefJson: string
  }) => {
    const { baseUrl, email, apiToken } = readJiraCreds()

    let briefText = args.briefJson
    try {
      const parsed = JSON.parse(args.briefJson)
      briefText = JSON.stringify(parsed, null, 2)
    } catch { /* use raw string */ }

    const body = {
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Hadron Investigation Brief:\n\n${briefText}` }] }],
      },
    }

    await jiraFetch(
      baseUrl, email, apiToken,
      `/rest/api/3/issue/${encodeURIComponent(args.jiraKey)}/comment`,
      { method: 'POST', body: JSON.stringify(body) },
    )

    const db = getDb()
    db.prepare('UPDATE ticket_briefs SET posted_to_jira = 1, posted_at = ? WHERE jira_key = ?')
      .run(new Date().toISOString(), args.jiraKey)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 12. submit_engineer_feedback — store rating + notes in ticket_briefs
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('submit_engineer_feedback', (_e, args: {
    jiraKey: string
    rating: number | null
    notes: string | null
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const existing = db.prepare('SELECT jira_key FROM ticket_briefs WHERE jira_key = ?').get(args.jiraKey)
    if (existing) {
      db.prepare('UPDATE ticket_briefs SET engineer_rating = ?, engineer_notes = ?, updated_at = ? WHERE jira_key = ?')
        .run(args.rating, args.notes, now, args.jiraKey)
    } else {
      log.warn('submit_engineer_feedback: ticket_brief not found for', args.jiraKey)
    }
  })
}
