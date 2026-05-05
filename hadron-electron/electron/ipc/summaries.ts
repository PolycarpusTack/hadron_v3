import { IpcMain } from 'electron'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'
import { getSecret } from '../services/safe-storage'
import { SERVICE_NAME } from '../services/jira-client'
import { wrapField } from '../services/prompt-helpers'

const SUMMARY_SYSTEM_PROMPT = `You are a technical writer. Summarize the following support conversation into a structured document. Use this exact format:

## Topic
[One-line description]

## Context
- WON Version: [if mentioned]
- Customer: [if mentioned]

## Question
[The core question or problem]

## Answer
[Condensed key findings]

## Resolution
[Action taken or recommended]

Be concise. Only include sections that have content.`

export function registerSummaryHandlers(ipcMain: IpcMain): void {
  // Frontend wraps all write calls in { request: params } — unwrap before accessing fields.
  ipcMain.handle('generate_session_summary', async (_e, args: {
    request?: { sessionId: string; provider: string; model: string; apiKey?: string }
    sessionId?: string; provider?: string; model?: string; apiKey?: string
  }) => {
    const p = args.request ?? (args as { sessionId: string; provider: string; model: string; apiKey?: string })
    const db = getDb()
    const messages = db.prepare(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(p.sessionId) as Array<{ role: string; content: string }>

    if (messages.length === 0) throw new Error('No messages in session')

    const transcript = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `**${m.role === 'user' ? 'User' : 'Hadron'}:** ${wrapField('MESSAGE', m.content)}`)
      .join('\n\n')

    let apiKey = p.apiKey ?? ''
    if (!apiKey) apiKey = getSecret(SERVICE_NAME, p.provider ?? '') ?? ''
    if (!apiKey) throw new Error(`No API key for provider: ${p.provider}`)

    const result = await callAi({
      provider: p.provider ?? '',
      model: p.model ?? '',
      apiKey,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: transcript,
      maxTokens: 4000,
    })
    return result.content
  })

  ipcMain.handle('save_session_summary', (_e, args: {
    request?: { sessionId: string; summaryMarkdown: string; topic: string; wonVersion?: string; customer?: string }
    sessionId?: string; summaryMarkdown?: string; topic?: string; wonVersion?: string; customer?: string
  }) => {
    const p = args.request ?? (args as { sessionId: string; summaryMarkdown: string; topic: string; wonVersion?: string; customer?: string })
    const db = getDb()
    const now = new Date().toISOString()
    const existing = db.prepare(
      'SELECT id FROM session_summaries WHERE session_id = ?'
    ).get(p.sessionId) as { id: number } | undefined

    if (existing) {
      db.prepare(`UPDATE session_summaries
        SET summary_markdown = ?, topic = ?, won_version = ?, customer = ?, updated_at = ?
        WHERE id = ?`)
        .run(p.summaryMarkdown, p.topic, p.wonVersion ?? null, p.customer ?? null, now, existing.id)
      return existing.id
    }
    const row = db.prepare(`INSERT INTO session_summaries
      (session_id, summary_markdown, topic, won_version, customer, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(p.sessionId, p.summaryMarkdown, p.topic,
           p.wonVersion ?? null, p.customer ?? null, now, now)
    return row.lastInsertRowid
  })

  ipcMain.handle('get_session_summary', (_e, args: { sessionId: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get(args.sessionId) ?? null
  })

  ipcMain.handle('export_summaries_bundle', (_e, args: {
    request?: { dateFrom?: string; dateTo?: string; customer?: string; unexportedOnly?: boolean }
    dateFrom?: string; dateTo?: string; customer?: string; unexportedOnly?: boolean
  }) => {
    const p = args.request ?? args
    const db = getDb()
    let sql = 'SELECT * FROM session_summaries WHERE 1=1'
    const params: unknown[] = []
    if (p.dateFrom) { sql += ' AND created_at >= ?'; params.push(p.dateFrom) }
    if (p.dateTo)   { sql += ' AND created_at <= ?'; params.push(p.dateTo) }
    if (p.customer) { sql += ' AND customer = ?'; params.push(p.customer) }
    if (p.unexportedOnly) { sql += ' AND is_exported = 0' }
    const summaries = db.prepare(sql).all(...params) as Array<Record<string, unknown>>

    const bundle = summaries.map(s => {
      const datePart = (s.created_at as string).split(' ')[0] ?? 'unknown-date'
      const topicPart = (s.topic as string ?? 'untitled').toLowerCase().replace(/ /g, '-')
        .replace(/[^a-z0-9-]/g, '').substring(0, 50)
      return { filename: `${datePart}-${topicPart}.md`, content: s.summary_markdown }
    })
    return JSON.stringify(bundle)
  })
}
