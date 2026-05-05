import { IpcMain } from 'electron'
import { getDb } from '../database'
import { createHash } from 'crypto'

// crash_signatures schema (m004):
//   hash TEXT PK, canonical TEXT, components_json TEXT,
//   first_seen_at TEXT, last_seen_at TEXT, occurrence_count INTEGER,
//   linked_ticket_system TEXT, linked_ticket_id TEXT, linked_ticket_url TEXT,
//   status TEXT, status_metadata_json TEXT, notes TEXT,
//   created_at TEXT, updated_at TEXT
//
// analysis_signatures junction table (m004):
//   analysis_id INTEGER, signature_hash TEXT, matched_at TEXT

export function registerSignatureHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('compute_crash_signature', (_e, args: {
    errorType: string; stackTrace?: string; rootCause?: string
  }) => {
    const { hash, canonical, componentsJson } = computeHashParts(args.errorType, args.stackTrace ?? null)
    return {
      hash,
      canonical,
      components_json: componentsJson,
      occurrence_count: 0,
      first_seen_at: '',
      last_seen_at: '',
      status: 'new',
      linked_ticket_system: null,
      linked_ticket_id: null,
      linked_ticket_url: null,
      status_metadata_json: null,
      notes: null,
    }
  })

  ipcMain.handle('register_crash_signature', (_e, args: {
    analysisId: number; errorType: string; stackTrace?: string; rootCause?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const { hash, canonical, componentsJson } = computeHashParts(args.errorType, args.stackTrace ?? null)

    const existing = db.prepare('SELECT hash FROM crash_signatures WHERE hash = ?').get(hash)
    const isNew = !existing

    if (isNew) {
      db.prepare(`INSERT INTO crash_signatures
        (hash, canonical, components_json, occurrence_count, first_seen_at, last_seen_at, status, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, 'new', ?, ?)
      `).run(hash, canonical, componentsJson, now, now, now, now)
    } else {
      db.prepare(`UPDATE crash_signatures
        SET occurrence_count = occurrence_count + 1, last_seen_at = ?, updated_at = ?
        WHERE hash = ?`)
        .run(now, now, hash)
    }

    // Link analysis to signature via the junction table
    try {
      db.prepare(`INSERT OR IGNORE INTO analysis_signatures (analysis_id, signature_hash) VALUES (?, ?)`)
        .run(args.analysisId, hash)
    } catch { /* analysis may not exist */ }

    const updated = db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(hash) as Record<string, unknown>
    return {
      signature: mapSignature(updated),
      is_new: isNew,
      occurrence_count: updated.occurrence_count,
      linked_ticket_id: updated.linked_ticket_id ?? null,
      linked_ticket_system: updated.linked_ticket_system ?? null,
      linked_ticket_url: updated.linked_ticket_url ?? null,
    }
  })

  ipcMain.handle('get_signature_occurrences', (_e, args: { hash: string }) => {
    const db = getDb()
    const sig = db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(args.hash)
    if (!sig) throw new Error('Signature not found')
    // Retrieve linked analyses via analysis_signatures junction table
    let files: unknown[] = []
    try {
      files = db.prepare(`
        SELECT a.* FROM analyses a
        INNER JOIN analysis_signatures asig ON asig.analysis_id = a.id
        WHERE asig.signature_hash = ?
        ORDER BY a.analyzed_at DESC
      `).all(args.hash)
    } catch { /* analyses or junction table may not be available */ }
    return { signature: sig, files }
  })

  ipcMain.handle('get_top_signatures', (_e, args?: { limit?: number; status?: string }) => {
    const db = getDb()
    const limit = args?.limit ?? 20
    let sql = 'SELECT * FROM crash_signatures'
    const params: unknown[] = []
    if (args?.status) { sql += ' WHERE status = ?'; params.push(args.status) }
    sql += ' ORDER BY occurrence_count DESC LIMIT ?'
    params.push(limit)
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map(mapSignature)
  })

  ipcMain.handle('update_signature_status', (_e, args: {
    hash: string; status: string; metadata?: string
  }) => {
    // SECURITY: enforce a fixed enum on `status` so the renderer cannot
    // poison the column with arbitrary strings (which downstream code
    // assumes are one of these values).
    const VALID_STATUSES = new Set(['new', 'investigating', 'resolved', 'wont_fix', 'duplicate'])
    if (typeof args.status !== 'string' || !VALID_STATUSES.has(args.status)) {
      throw new Error(`Invalid signature status: ${args.status}`)
    }
    if (typeof args.hash !== 'string' || !/^[a-f0-9]{1,64}$/.test(args.hash)) {
      throw new Error('Invalid signature hash')
    }
    const db = getDb()
    const now = new Date().toISOString()
    // metadata maps to status_metadata_json (m004 column name)
    if (args.metadata !== undefined) {
      const meta = typeof args.metadata === 'string' ? args.metadata.slice(0, 64 * 1024) : null
      db.prepare('UPDATE crash_signatures SET status = ?, status_metadata_json = ?, updated_at = ? WHERE hash = ?')
        .run(args.status, meta, now, args.hash)
    } else {
      db.prepare('UPDATE crash_signatures SET status = ?, updated_at = ? WHERE hash = ?')
        .run(args.status, now, args.hash)
    }
  })

  ipcMain.handle('link_ticket_to_signature', (_e, args: {
    hash: string; ticketKey: string; ticketUrl?: string; ticketSystem?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    // Schema uses linked_ticket_system + linked_ticket_id (not a single linked_ticket column)
    db.prepare(`UPDATE crash_signatures
      SET linked_ticket_id = ?, linked_ticket_system = ?, linked_ticket_url = ?, updated_at = ?
      WHERE hash = ?`)
      .run(args.ticketKey, args.ticketSystem ?? 'jira', args.ticketUrl ?? null, now, args.hash)
  })
}

function mapSignature(r: Record<string, unknown>) {
  let components = { exceptionType: '', applicationFrames: [] as string[], affectedModule: undefined as string | undefined }
  try {
    const parsed = JSON.parse((r.components_json as string) ?? '[]') as string[]
    components = {
      exceptionType: parsed[0] ?? '',
      applicationFrames: parsed.slice(1),
      affectedModule: undefined,
    }
  } catch { /* ignore malformed JSON */ }

  return {
    hash: r.hash,
    canonical: r.canonical,
    components,
    firstSeen: r.first_seen_at ?? '',
    lastSeen: r.last_seen_at ?? '',
    occurrenceCount: r.occurrence_count ?? 0,
    linkedTicket: r.linked_ticket_id ?? undefined,
    linkedTicketUrl: r.linked_ticket_url ?? undefined,
    status: r.status ?? 'new',
    statusMetadata: r.status_metadata_json ?? undefined,
  }
}

interface HashParts {
  hash: string
  canonical: string
  componentsJson: string
}

function computeHashParts(errorType: unknown, stackTrace: unknown): HashParts {
  // SECURITY: defensively coerce inputs from the renderer. Without this,
  // sending a non-string errorType crashes the handler on .trim()/.split().
  const safeErrorType = typeof errorType === 'string' ? errorType : ''
  const safeStackTrace = typeof stackTrace === 'string' ? stackTrace : null
  const canonical = safeErrorType.trim().toLowerCase()
  const components: string[] = [canonical]

  if (safeStackTrace) {
    const frames = safeStackTrace.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('at ') || /^\s*\d+:/.test(l))
      .slice(0, 3)
    if (frames.length > 0) components.push(...frames)
  }

  const componentsJson = JSON.stringify(components)
  const input = components.join('|')
  const hash = createHash('sha256').update(input).digest('hex').substring(0, 16)

  return { hash, canonical, componentsJson }
}
