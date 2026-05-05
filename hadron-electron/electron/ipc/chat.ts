import { IpcMain } from 'electron'
import log from 'electron-log'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'
import { getSecret } from '../services/safe-storage'
import { SERVICE_NAME } from '../services/jira-client'
import { getApiKeyFromKeeper } from './keeper'

// Timestamp format: INTEGER columns (chat_sessions.created_at/updated_at, chat_messages.timestamp)
// use Date.now() (Unix milliseconds); TEXT columns (chat_feedback.created_at) use ISO strings
// to match SQLite DEFAULT (datetime('now')). This is intentional and schema-dependent.

interface StreamState {
  pendingText: string
  done: boolean
  error: string | null
  events: Array<{ kind: string; [k: string]: unknown }>
}

const streamState: StreamState = { pendingText: '', done: false, error: null, events: [] }
let streamActive = false

function streamReset(): void {
  streamState.pendingText = ''
  streamState.done = false
  streamState.error = null
  streamState.events = []
}

function sanitizeFtsQuery(q: string): string {
  // Wrap in double-quoted phrase to prevent FTS5 operator injection
  const truncated = q.substring(0, 200)
  return '"' + truncated.replace(/"/g, '""') + '"'
}

export function registerChatHandlers(ipcMain: IpcMain): void {
  // Save (upsert) a chat session.
  // created_at / updated_at are stored as Unix ms integers.
  ipcMain.handle('chat_save_session', (_e, args: {
    request?: {
      id?: string; title?: string; won_version?: string; wonVersion?: string; customer?: string
      messages?: Array<{ id: string; role: string; content: string; sources_json?: string | null; timestamp?: number }>
    }
    id?: string; title?: string; won_version?: string; wonVersion?: string; customer?: string
    messages?: Array<{ id: string; role: string; content: string; sources_json?: string | null; timestamp?: number }>
  }) => {
    // Accept both direct args and Tauri-style { request } wrapper
    const p = (args.request ?? args) as {
      id?: string; title?: string; won_version?: string; wonVersion?: string; customer?: string
      messages?: Array<{ id: string; role: string; content: string; sources_json?: string | null; timestamp?: number }>
    }
    const id = (p.id ?? (p as Record<string, unknown>).sessionId) as string
    const wonVersion = p.won_version ?? p.wonVersion ?? null
    const db = getDb()
    const now = Date.now()
    db.prepare(`
      INSERT INTO chat_sessions (id, title, won_version, customer, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title      = excluded.title,
        won_version = excluded.won_version,
        customer   = excluded.customer,
        updated_at = excluded.updated_at
    `).run(id, p.title ?? '', wonVersion, p.customer ?? null, now, now)

    // Persist messages sent alongside the session (used by frontend saveChatSession)
    if (p.messages?.length) {
      const insertMsg = db.prepare(`
        INSERT OR REPLACE INTO chat_messages
          (id, session_id, role, content, sources_json, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const m of p.messages) {
        insertMsg.run(m.id, id, m.role, m.content, m.sources_json ?? null, m.timestamp ?? now)
      }
    }
    return { id }
  })

  // List non-archived sessions ordered by recency.
  // chat_sessions has no `archived` column — we return all rows.
  const loadSessions = (_e: unknown, args?: { limit?: number; offset?: number }) => {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).all(args?.limit ?? 50, args?.offset ?? 0)
  }
  ipcMain.handle('chat_load_sessions', loadSessions)
  ipcMain.handle('chat_list_sessions', loadSessions) // alias used by some frontend callers

  // Load a single session by id.
  ipcMain.handle('chat_load_session', (_e, args: { id: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(args.id) ?? null
  })

  // Load all messages for a session in chronological order.
  // Messages use `timestamp` (INTEGER ms) instead of `created_at`.
  // Accepts session_id (snake_case) or sessionId (camelCase).
  const loadMessages = (_e: unknown, args: { session_id?: string; sessionId?: string }) => {
    const db = getDb()
    const sessionId = args.session_id ?? args.sessionId ?? ''
    return db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId)
  }
  ipcMain.handle('chat_load_messages', loadMessages)
  ipcMain.handle('chat_get_messages', loadMessages) // alias used by some frontend callers

  // Save (upsert) a chat message.
  // The schema stores `sources_json` and `timestamp`; there are no
  // tool_calls_json / tool_results_json columns in the actual migration.
  ipcMain.handle('chat_save_message', (_e, args: {
    id: string
    session_id: string
    role: string
    content: string
    sources_json?: string
    timestamp?: number
  }) => {
    const db = getDb()
    const now = Date.now()
    const ts = args.timestamp ?? now
    db.prepare(`
      INSERT OR REPLACE INTO chat_messages
        (id, session_id, role, content, sources_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      args.id,
      args.session_id,
      args.role,
      args.content,
      args.sources_json ?? null,
      ts,
    )
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, args.session_id)
    return { id: args.id }
  })

  // Delete a session and its messages (messages cascade via FK).
  ipcMain.handle('chat_delete_session', (_e, args: { id?: string; sessionId?: string }) => {
    const db = getDb()
    const id = args.sessionId ?? args.id ?? ''
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
  })

  // Toggle the starred flag on a session.
  // Column added by m012: `is_starred INTEGER NOT NULL DEFAULT 0`
  ipcMain.handle('chat_star_session', (_e, args: { id?: string; sessionId?: string; starred: boolean }) => {
    const db = getDb()
    const id = args.sessionId ?? args.id ?? ''
    db.prepare('UPDATE chat_sessions SET is_starred = ? WHERE id = ?')
      .run(args.starred ? 1 : 0, id)
  })

  // Replace the tags array on a session.
  // Column added by m012: `tags TEXT` (stored as JSON string).
  ipcMain.handle('chat_tag_session', (_e, args: { id?: string; sessionId?: string; tags: string[] }) => {
    const db = getDb()
    const id = args.sessionId ?? args.id ?? ''
    db.prepare('UPDATE chat_sessions SET tags = ? WHERE id = ?')
      .run(JSON.stringify(args.tags), id)
  })

  // Partial update of session metadata fields.
  // Accepts both snake_case (won_version) and camelCase (wonVersion) keys.
  ipcMain.handle('chat_update_session_metadata', (_e, args: {
    id?: string
    sessionId?: string
    title?: string
    won_version?: string
    wonVersion?: string
    customer?: string
  }) => {
    const db = getDb()
    const now = Date.now()
    const id = args.sessionId ?? args.id ?? ''
    const wonVersion = args.won_version ?? args.wonVersion
    const updates: string[] = []
    const params: unknown[] = []
    if (args.title !== undefined)   { updates.push('title = ?');       params.push(args.title) }
    if (wonVersion !== undefined)   { updates.push('won_version = ?'); params.push(wonVersion) }
    if (args.customer !== undefined){ updates.push('customer = ?');    params.push(args.customer) }
    if (updates.length === 0) return
    updates.push('updated_at = ?')
    params.push(now)
    params.push(id)
    db.prepare(`UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  })

  // Submit (upsert) feedback for a message.
  // Actual schema: rating TEXT, no feedback_type column.
  // UNIQUE constraint on (session_id, message_id) — one feedback record per message.
  ipcMain.handle('chat_submit_feedback', (_e, args: {
    session_id: string
    message_id: string
    rating: string
    comment?: string
    tools_used?: string
    sources_cited?: string
    query?: string
    reason?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString() // TEXT column — ISO string matches DEFAULT datetime('now')
    db.prepare(`
      INSERT INTO chat_feedback
        (session_id, message_id, rating, comment, tools_used, sources_cited, query, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, message_id) DO UPDATE SET
        rating       = excluded.rating,
        comment      = excluded.comment,
        tools_used   = excluded.tools_used,
        sources_cited = excluded.sources_cited,
        query        = excluded.query,
        reason       = excluded.reason
    `).run(
      args.session_id,
      args.message_id,
      args.rating,
      args.comment ?? null,
      args.tools_used ?? null,
      args.sources_cited ?? null,
      args.query ?? null,
      args.reason ?? null,
      now,
    )
    const saved = db.prepare('SELECT id FROM chat_feedback WHERE session_id = ? AND message_id = ?')
      .get(args.session_id, args.message_id) as { id: number }
    return { id: saved.id }
  })

  // Delete a feedback record by its integer primary key.
  ipcMain.handle('chat_delete_feedback', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('DELETE FROM chat_feedback WHERE id = ?').run(args.id)
  })

  // Poll the current streaming response chunk buffer.
  // Drains pendingText and events each call; done/error persist until next chat_send.
  ipcMain.handle('poll_chat_stream', () => {
    const text = streamState.pendingText
    const done = streamState.done
    const error = streamState.error ?? undefined
    const events = [...streamState.events]
    streamState.pendingText = ''
    streamState.events = []
    return { text, done, error, events }
  })

  // Send a chat message (full messages array) to the configured AI provider.
  // Streams tokens into streamState; caller polls via poll_chat_stream.
  // Frontend wraps args in { request: { ... } } (Tauri-style invoke convention).
  ipcMain.handle('chat_send', async (_e, rawArgs: {
    request?: {
      messages: Array<{ role: string; content: string }>
      api_key?: string
      model: string
      provider: string
      use_rag?: boolean
      use_kb?: boolean
      won_version?: string
      customer?: string
      analysis_id?: number
      request_id?: string
      keeper_secret_uid?: string
      auxiliary_model?: string
      verbosity?: string
    }
    // also accept flat (non-wrapped) calls for backwards compat
    messages?: Array<{ role: string; content: string }>
    api_key?: string
    model?: string
    provider?: string
    use_rag?: boolean
    use_kb?: boolean
    keeper_secret_uid?: string
  }) => {
    const args = rawArgs.request ?? rawArgs as {
      messages: Array<{ role: string; content: string }>
      api_key?: string; model: string; provider: string
      use_rag?: boolean; use_kb?: boolean
      won_version?: string; customer?: string
      analysis_id?: number; request_id?: string
      keeper_secret_uid?: string; auxiliary_model?: string; verbosity?: string
    }

    streamReset()
    if (streamActive) {
      log.warn('chat_send called while stream already active — previous stream cancelled')
    }
    streamActive = true

    let apiKey = args.api_key ?? ''
    if (!apiKey) {
      const stored = getSecret(SERVICE_NAME, args.provider)
      if (stored) apiKey = stored
    }
    if (!apiKey && args.keeper_secret_uid) {
      try {
        apiKey = await getApiKeyFromKeeper(args.keeper_secret_uid)
      } catch (err: unknown) {
        log.warn('Keeper lookup failed:', err instanceof Error ? err.message : err)
      }
    }
    if (!apiKey) {
      streamState.error = `No API key configured for provider: ${args.provider}`
      streamState.done = true
      streamActive = false
      return { content: '', inputTokens: 0, outputTokens: 0, cost: 0 }
    }

    // FTS context: search analyses_fts for the last user message
    const query = [...(args.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? ''
    let ftsContext = ''
    if (query && args.use_rag) {
      try {
        const db = getDb()
        const rows = db.prepare(`
          SELECT a.id, a.filename, a.severity, a.root_cause, a.error_message, a.error_type
          FROM analyses_fts
          JOIN analyses a ON analyses_fts.rowid = a.id
          WHERE analyses_fts MATCH ?
          LIMIT 5
        `).all(sanitizeFtsQuery(query)) as Array<{
          id: number; filename: string; severity: string | null; root_cause: string | null;
          error_message: string | null; error_type: string | null
        }>
        if (rows.length > 0) {
          ftsContext = rows.map(r =>
            `<analysis id="${r.id}" filename="${r.filename}" severity="${r.severity ?? 'UNKNOWN'}">\n` +
            (r.error_type ? `Error Type: ${r.error_type}\n` : '') +
            (r.root_cause ? `Root Cause: ${r.root_cause}\n` : '') +
            (r.error_message ? `Error: ${r.error_message}\n` : '') +
            `</analysis>`
          ).join('\n\n')
        }
      } catch (err) {
        log.warn('FTS context retrieval failed:', err)
      }
    }

    const systemPrompt = `You are Ask Hadron, an expert regarding the Mediagenix WHATS'ON broadcast management software. You help users understand crashes, debug issues, and navigate historical analyses.${ftsContext ? `\n\n## Related Analyses\n${ftsContext}` : ''}`

    try {
      const result = await callAi({
        provider: args.provider,
        model: args.model,
        apiKey,
        systemPrompt,
        userPrompt: '',
        maxTokens: 4096,
        stream: true,
        messages: args.messages,
        onChunk: (chunk) => {
          streamState.pendingText += chunk
        },
      })
      streamState.done = true
      streamActive = false
      return { content: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost: result.cost }
    } catch (err) {
      streamState.error = (err as Error).message
      streamState.done = true
      streamActive = false
      return { content: '', inputTokens: 0, outputTokens: 0, cost: 0 }
    }
  })
}
