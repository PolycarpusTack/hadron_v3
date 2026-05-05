import { IpcMain } from 'electron'
import { getDb } from '../database'
import log from 'electron-log'

export function registerGoldAnswerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('save_gold_answer', (_e, args: {
    request?: { question: string; answer: string; sessionId: string; messageId: string; wonVersion?: string; customer?: string; tags?: string; verifiedBy?: string; toolResultsJson?: string }
    question?: string; answer?: string; sessionId?: string; messageId?: string;
    wonVersion?: string; customer?: string; tags?: string;
    verifiedBy?: string; toolResultsJson?: string
  }) => {
    // Accept both direct args and Tauri-style { request } wrapper
    const p = args.request ?? (args as { question: string; answer: string; sessionId: string; messageId: string; wonVersion?: string; customer?: string; tags?: string; verifiedBy?: string; toolResultsJson?: string })
    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`INSERT INTO gold_answers
      (question, answer, session_id, message_id, won_version, customer, tags,
       verified_by, tool_results_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.question, p.answer, p.sessionId, p.messageId,
           p.wonVersion ?? null, p.customer ?? null, p.tags ?? null,
           p.verifiedBy ?? null, p.toolResultsJson ?? null, now)
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
    request?: { dateFrom?: string; dateTo?: string; customer?: string; tags?: string }
    dateFrom?: string; dateTo?: string; customer?: string; tags?: string
  }) => {
    // Accept both direct args and Tauri-style { request } wrapper
    const p = args.request ?? args
    const db = getDb()
    let sql = 'SELECT * FROM gold_answers WHERE 1=1'
    const params: unknown[] = []
    if (p.dateFrom) { sql += ' AND created_at >= ?'; params.push(p.dateFrom) }
    if (p.dateTo)   { sql += ' AND created_at <= ?'; params.push(p.dateTo) }
    if (p.customer) { sql += ' AND customer = ?'; params.push(p.customer) }
    if (p.tags)     { sql += ' AND tags LIKE ?'; params.push(`%${p.tags}%`) }
    const answers = db.prepare(sql).all(...params) as Array<Record<string, unknown>>

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

  // Read from gold_analyses table (created in migrations).
  // Maps snake_case DB columns to camelCase to match the GoldAnalysis frontend type.
  ipcMain.handle('get_gold_analyses', () => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM gold_analyses ORDER BY created_at DESC').all() as Array<Record<string, unknown>>
    return rows.map(mapGoldAnalysis)
  })

  ipcMain.handle('get_pending_gold_analyses', () => {
    const db = getDb()
    const rows = db.prepare("SELECT * FROM gold_analyses WHERE validation_status = 'pending' ORDER BY created_at DESC").all() as Array<Record<string, unknown>>
    return rows.map(mapGoldAnalysis)
  })

  ipcMain.handle('get_rejected_gold_analyses', () => {
    const db = getDb()
    const rows = db.prepare("SELECT * FROM gold_analyses WHERE validation_status = 'rejected' ORDER BY created_at DESC").all() as Array<Record<string, unknown>>
    return rows.map(mapGoldAnalysis)
  })

  ipcMain.handle('is_gold_analysis', (_e, args: { analysisId: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT id FROM gold_analyses WHERE source_analysis_id = ? LIMIT 1').get(args.analysisId)
    return row !== undefined
  })

  // Export verified gold analyses as JSONL for fine-tuning.
  // Returns { totalExported, jsonlContent, format } to match FineTuneExportResult.
  ipcMain.handle('export_gold_jsonl', () => {
    const db = getDb()
    const rows = db.prepare("SELECT * FROM gold_analyses WHERE validation_status = 'verified' ORDER BY created_at DESC").all() as Array<Record<string, unknown>>
    const lines = rows.map(r => JSON.stringify({
      messages: [
        { role: 'system', content: 'You are an expert crash analyst for the Mediagenix WHATS\'ON broadcast management software.' },
        { role: 'user', content: `Analyze this crash: ${r.error_signature}` },
        { role: 'assistant', content: JSON.stringify({ root_cause: r.root_cause, suggested_fixes: JSON.parse(r.suggested_fixes as string || '[]') }) },
      ],
      _metadata: {
        gold_id: r.id,
        source_analysis_id: r.source_analysis_id,
        component: r.component,
        severity: r.severity,
        validation_status: r.validation_status,
        verified_by: r.verified_by,
        created_at: r.created_at,
      },
    }))
    return {
      totalExported: lines.length,
      jsonlContent: lines.join('\n'),
      format: 'jsonl',
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Gold analysis mutations — missing from initial port
  // ──────────────────────────────────────────────────────────────────────────

  // promote_to_gold — creates a gold_analyses record from an existing analysis
  ipcMain.handle('promote_to_gold', (_e, args: { analysisId: number }) => {
    const db = getDb()
    const analysis = db.prepare('SELECT * FROM analyses WHERE id = ?').get(args.analysisId) as Record<string, unknown> | undefined
    if (!analysis) throw new Error(`Analysis ${args.analysisId} not found`)

    const now = new Date().toISOString()
    const existing = db.prepare('SELECT id FROM gold_analyses WHERE source_analysis_id = ?').get(args.analysisId)
    if (existing) return existing

    const signature = [analysis.error_type, analysis.component, analysis.severity].filter(Boolean).join('|')
    const row = db.prepare(`
      INSERT INTO gold_analyses
        (source_analysis_id, source_type, error_signature, root_cause, suggested_fixes,
         component, severity, validation_status, created_at)
      VALUES (?, 'crash', ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      args.analysisId,
      signature || String(analysis.error_type ?? 'Unknown'),
      analysis.root_cause ?? '',
      analysis.suggested_fixes ?? '[]',
      analysis.component ?? null,
      analysis.severity ?? null,
      now,
    )
    log.info(`Promoted analysis ${args.analysisId} to gold as id ${row.lastInsertRowid}`)
    return { id: row.lastInsertRowid }
  })

  // verify_gold_analysis — sets validation_status to 'verified'
  ipcMain.handle('verify_gold_analysis', (_e, args: { goldAnalysisId: number; verifiedBy?: string }) => {
    const db = getDb()
    const result = db.prepare(`
      UPDATE gold_analyses SET validation_status = 'verified', verified_by = ? WHERE id = ?
    `).run(args.verifiedBy ?? 'manual', args.goldAnalysisId)
    if (result.changes === 0) throw new Error(`Gold analysis ${args.goldAnalysisId} not found`)
  })

  // reject_gold_analysis — sets validation_status to 'rejected'
  ipcMain.handle('reject_gold_analysis', (_e, args: { goldAnalysisId: number; verifiedBy?: string; reason?: string }) => {
    const db = getDb()
    const result = db.prepare(`
      UPDATE gold_analyses SET validation_status = 'rejected', verified_by = ? WHERE id = ?
    `).run(args.verifiedBy ?? 'manual', args.goldAnalysisId)
    if (result.changes === 0) throw new Error(`Gold analysis ${args.goldAnalysisId} not found`)
  })

  // reopen_gold_analysis — resets validation_status to 'pending'
  ipcMain.handle('reopen_gold_analysis', (_e, args: { goldAnalysisId: number }) => {
    const db = getDb()
    const result = db.prepare(`
      UPDATE gold_analyses SET validation_status = 'pending', verified_by = NULL WHERE id = ?
    `).run(args.goldAnalysisId)
    if (result.changes === 0) throw new Error(`Gold analysis ${args.goldAnalysisId} not found`)
  })

  // submit_analysis_feedback — persists field-level feedback to analysis_feedback table
  ipcMain.handle('submit_analysis_feedback', (_e, args: {
    feedback: {
      analysisId: number
      feedbackType: 'accept' | 'reject' | 'edit' | 'rating'
      fieldName?: string
      originalValue?: string
      newValue?: string
      rating?: number
    }
  }) => {
    const db = getDb()
    const f = args.feedback
    db.prepare(`
      INSERT INTO analysis_feedback
        (analysis_id, feedback_type, field_name, original_value, new_value, rating, feedback_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      f.analysisId,
      f.feedbackType,
      f.fieldName ?? null,
      f.originalValue ?? null,
      f.newValue ?? null,
      f.rating ?? null,
      new Date().toISOString(),
    )
  })
}

function mapGoldAnalysis(r: Record<string, unknown>) {
  return {
    id: r.id,
    sourceAnalysisId: r.source_analysis_id ?? null,
    sourceType: r.source_type,
    errorSignature: r.error_signature,
    crashContentHash: r.crash_content_hash ?? null,
    rootCause: r.root_cause,
    suggestedFixes: r.suggested_fixes,
    component: r.component ?? null,
    severity: r.severity ?? null,
    validationStatus: r.validation_status ?? 'pending',
    createdAt: r.created_at,
    verifiedBy: r.verified_by ?? null,
    timesReferenced: r.times_referenced ?? 0,
    successRate: r.success_rate ?? null,
  }
}
