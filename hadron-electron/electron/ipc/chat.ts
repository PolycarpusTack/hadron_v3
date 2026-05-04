import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerChatHandlers(ipcMain: IpcMain): void {
  // Save (upsert) a chat session.
  // created_at / updated_at are stored as Unix ms integers.
  ipcMain.handle('chat_save_session', (_e, args: {
    id: string
    title: string
    provider?: string
    model?: string
    won_version?: string
    customer?: string
    analysis_id?: number
  }) => {
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
    `).run(
      args.id,
      args.title,
      args.won_version ?? null,
      args.customer ?? null,
      now,
      now,
    )
    return { id: args.id }
  })

  // List non-archived sessions ordered by recency.
  // chat_sessions has no `archived` column — we return all rows.
  ipcMain.handle('chat_load_sessions', (_e, args?: { limit?: number; offset?: number }) => {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).all(args?.limit ?? 50, args?.offset ?? 0)
  })

  // Load a single session by id.
  ipcMain.handle('chat_load_session', (_e, args: { id: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(args.id) ?? null
  })

  // Load all messages for a session in chronological order.
  // Messages use `timestamp` (INTEGER ms) instead of `created_at`.
  ipcMain.handle('chat_load_messages', (_e, args: { session_id: string }) => {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(args.session_id)
  })

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
  ipcMain.handle('chat_delete_session', (_e, args: { id: string }) => {
    const db = getDb()
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(args.id)
  })

  // Toggle the starred flag on a session.
  // Column added by m012: `is_starred INTEGER NOT NULL DEFAULT 0`
  ipcMain.handle('chat_star_session', (_e, args: { id: string; starred: boolean }) => {
    const db = getDb()
    db.prepare('UPDATE chat_sessions SET is_starred = ? WHERE id = ?')
      .run(args.starred ? 1 : 0, args.id)
  })

  // Replace the tags array on a session.
  // Column added by m012: `tags TEXT` (stored as JSON string).
  ipcMain.handle('chat_tag_session', (_e, args: { id: string; tags: string[] }) => {
    const db = getDb()
    db.prepare('UPDATE chat_sessions SET tags = ? WHERE id = ?')
      .run(JSON.stringify(args.tags), args.id)
  })

  // Partial update of session metadata fields.
  ipcMain.handle('chat_update_session_metadata', (_e, args: {
    id: string
    title?: string
    won_version?: string
    customer?: string
  }) => {
    const db = getDb()
    const now = Date.now()
    const updates: string[] = []
    const params: unknown[] = []
    if (args.title !== undefined)       { updates.push('title = ?');       params.push(args.title) }
    if (args.won_version !== undefined) { updates.push('won_version = ?'); params.push(args.won_version) }
    if (args.customer !== undefined)    { updates.push('customer = ?');    params.push(args.customer) }
    if (updates.length === 0) return
    updates.push('updated_at = ?')
    params.push(now)
    params.push(args.id)
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
    const now = new Date().toISOString()
    const row = db.prepare(`
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
    return { id: row.lastInsertRowid }
  })

  // Delete a feedback record by its integer primary key.
  ipcMain.handle('chat_delete_feedback', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('DELETE FROM chat_feedback WHERE id = ?').run(args.id)
  })
}
