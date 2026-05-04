import { IpcMain } from 'electron'
import { getDb } from '../database'
import Store from 'electron-store'
import log from 'electron-log'
import { callAi } from '../services/ai-service'

const settingsStore = new Store({ name: 'settings' })

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
  const key = settingsStore.get(`${provider.toLowerCase()}_api_key`, '') as string
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
    jiraKey: string
    title: string
    description: string
    provider: string
    model: string
  }) => {
    try {
      const apiKey = getApiKey(args.provider)
      const userPrompt = `JIRA Key: ${args.jiraKey}\nTitle: ${args.title}\n\nDescription:\n${args.description}`

      const aiResult = await callAi({
        provider: args.provider,
        model: args.model,
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
          (jira_key, title, severity, category, tags, triage_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?,
            COALESCE((SELECT created_at FROM ticket_briefs WHERE jira_key=?), ?), ?)
      `).run(
        args.jiraKey,
        args.title,
        (triage.severity as string) ?? null,
        (triage.category as string) ?? null,
        triage.tags ? JSON.stringify(triage.tags) : null,
        JSON.stringify(triage),
        args.jiraKey,
        now,
        now,
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
    jiraKey: string
    title: string
    description: string
    provider: string
    model: string
  }) => {
    try {
      const apiKey = getApiKey(args.provider)
      const userPrompt = `JIRA Key: ${args.jiraKey}\nTitle: ${args.title}\n\nDescription:\n${args.description}`

      const aiResult = await callAi({
        provider: args.provider,
        model: args.model,
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
          (jira_key, title, severity, category, tags, triage_json, brief_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?,
            COALESCE((SELECT created_at FROM ticket_briefs WHERE jira_key=?), ?), ?)
      `).run(
        args.jiraKey,
        args.title,
        (triage.severity as string) ?? null,
        (triage.category as string) ?? null,
        triage.tags ? JSON.stringify(triage.tags) : null,
        triage ? JSON.stringify(triage) : null,
        JSON.stringify(brief),
        args.jiraKey,
        now,
        now,
      )

      return brief
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('generate_ticket_brief failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 7. start_jira_poller (stub)
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('start_jira_poller', () => {
    return { status: 'not_available', message: 'Background poller not implemented in Electron' }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 8. stop_jira_poller (stub)
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('stop_jira_poller', () => {
    // no-op
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 9. get_poller_status (stub)
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('get_poller_status', () => {
    return { running: false, status: 'stopped' }
  })
}
