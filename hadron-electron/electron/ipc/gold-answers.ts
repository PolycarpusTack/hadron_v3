import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerGoldAnswerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('save_gold_answer', (_e, args: {
    question: string; answer: string; sessionId: string; messageId: string;
    wonVersion?: string; customer?: string; tags?: string;
    verifiedBy?: string; toolResultsJson?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    // Note: gold_answers has no updated_at column (migration m012)
    const row = db.prepare(`INSERT INTO gold_answers
      (question, answer, session_id, message_id, won_version, customer, tags,
       verified_by, tool_results_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(args.question, args.answer, args.sessionId, args.messageId,
           args.wonVersion ?? null, args.customer ?? null, args.tags ?? null,
           args.verifiedBy ?? null, args.toolResultsJson ?? null, now)
    return row.lastInsertRowid
  })

  ipcMain.handle('list_gold_answers', (_e, args?: {
    limit?: number; offset?: number; customer?: string; tag?: string
  }) => {
    const db = getDb()
    const limit = args?.limit ?? 50
    const offset = args?.offset ?? 0
    let sql = 'SELECT * FROM gold_answers WHERE 1=1'
    const params: unknown[] = []
    if (args?.customer) { sql += ' AND customer = ?'; params.push(args.customer) }
    if (args?.tag) { sql += ' AND tags LIKE ?'; params.push(`%${args.tag}%`) }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('search_gold_answers_cmd', (_e, args: { query: string; limit?: number }) => {
    const db = getDb()
    const limit = args.limit ?? 10
    return db.prepare(`SELECT * FROM gold_answers
      WHERE question LIKE ? OR answer LIKE ?
      ORDER BY created_at DESC LIMIT ?`
    ).all(`%${args.query}%`, `%${args.query}%`, limit)
  })

  ipcMain.handle('delete_gold_answer_cmd', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('DELETE FROM gold_answers WHERE id = ?').run(args.id)
  })

  ipcMain.handle('export_gold_answers_jsonl', (_e, args: {
    dateFrom?: string; dateTo?: string; customer?: string; tags?: string
  }) => {
    const db = getDb()
    let sql = 'SELECT * FROM gold_answers WHERE 1=1'
    const params: unknown[] = []
    if (args.dateFrom) { sql += ' AND created_at >= ?'; params.push(args.dateFrom) }
    if (args.dateTo)   { sql += ' AND created_at <= ?'; params.push(args.dateTo) }
    if (args.customer) { sql += ' AND customer = ?'; params.push(args.customer) }
    if (args.tags)     { sql += ' AND tags LIKE ?'; params.push(`%${args.tags}%`) }
    const answers = db.prepare(sql).all(...params) as any[]

    return answers.map(a => JSON.stringify({
      messages: [
        { role: 'system', content: 'You are Ask Hadron, an expert regarding the Mediagenix WHATS\'ON broadcast management software.' },
        { role: 'user', content: a.question },
        { role: 'assistant', content: a.answer },
      ],
      _metadata: {
        gold_answer_id: a.id,
        won_version: a.won_version,
        customer: a.customer,
        tags: a.tags,
        created_at: a.created_at,
      }
    })).join('\n')
  })
}
