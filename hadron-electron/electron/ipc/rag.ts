import { IpcMain } from 'electron'
import { getDb } from '../database'
import log from 'electron-log'
import fsAsync from 'fs/promises'
import path from 'path'

// RAG, KB, and Pattern handlers for the Electron build.
//
// RAG uses SQLite FTS5 (analyses_fts + retrieval_chunks) for similarity search
// instead of a vector store. KB uses local file scanning. These are functionally
// equivalent to the Tauri/Rust implementations for the Electron context.

// ============================================================================
// RAG — SQLite FTS5-based similarity search
// ============================================================================

function ftsPhrase(q: string): string {
  const truncated = q.substring(0, 200)
  return '"' + truncated.replace(/"/g, '""') + '"'
}

function chunkText(text: string, chunkSize = 500): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '))
  }
  return chunks.length > 0 ? chunks : [text.substring(0, chunkSize)]
}

export function registerRagHandlers(ipcMain: IpcMain): void {
  // rag_query — FTS5-based similarity search over retrieval_chunks
  ipcMain.handle('rag_query', (_e, args: { request?: { query: string; component?: string; severity?: string; top_k?: number }; query?: string; component?: string; severity?: string; top_k?: number }) => {
    const req = args.request ?? args as { query: string; component?: string; severity?: string; top_k?: number }
    const db = getDb()
    const topK = req.top_k ?? 5

    try {
      // Search retrieval_chunks_fts (covers KB docs and indexed analysis chunks)
      let chunkSql = `
        SELECT rc.id, rc.content, rc.source_type, rc.source_id, rc.metadata_json
        FROM retrieval_chunks_fts
        JOIN retrieval_chunks rc ON retrieval_chunks_fts.rowid = rc.id
        WHERE retrieval_chunks_fts MATCH ?
      `
      const chunkParams: unknown[] = [ftsPhrase(req.query)]

      if (req.component) { chunkSql += ' AND json_extract(rc.metadata_json, "$.component") = ?'; chunkParams.push(req.component) }
      if (req.severity)  { chunkSql += ' AND json_extract(rc.metadata_json, "$.severity") = ?'; chunkParams.push(req.severity.toUpperCase()) }
      chunkSql += ' LIMIT ?'
      chunkParams.push(topK)

      const chunkRows = db.prepare(chunkSql).all(...chunkParams) as Array<Record<string, unknown>>

      if (chunkRows.length > 0) {
        return chunkRows.map((r, i) => ({
          id: `chunk-${r.id}-${i}`,
          content: (r.content as string) ?? '',
          score: Math.max(0.1, 1.0 - i * 0.15),
          metadata: {
            source_type: r.source_type ?? null,
            source_id: r.source_id ?? null,
            ...JSON.parse((r.metadata_json as string) || '{}'),
          },
        }))
      }

      // Fall back to analyses_fts when no KB/chunk results found
      const ftsRows = db.prepare(`
        SELECT a.id, a.root_cause AS content, a.component, a.severity,
               a.error_type, 0 AS is_gold
        FROM analyses_fts
        JOIN analyses a ON analyses_fts.rowid = a.id
        WHERE analyses_fts MATCH ?
        LIMIT ?
      `).all(ftsPhrase(req.query), topK) as Array<Record<string, unknown>>

      return ftsRows.map((r, i) => ({
        id: `analysis-${r.id}-${i}`,
        content: (r.content as string) ?? '',
        score: Math.max(0.1, 1.0 - i * 0.15),
        metadata: {
          component: r.component ?? null,
          severity: r.severity ?? null,
          error_type: r.error_type ?? null,
          source_type: 'analysis',
          source_id: r.id,
          is_gold: false,
        },
      }))
    } catch (err) {
      log.warn('rag_query FTS failed, returning empty:', err)
      return []
    }
  })

  // rag_build_context — builds RAG context from FTS search
  ipcMain.handle('rag_build_context', (_e, args: { request?: { query: string; component?: string; severity?: string; top_k?: number }; query?: string; component?: string; severity?: string; top_k?: number }) => {
    const req = args.request ?? args as { query: string; component?: string; severity?: string; top_k?: number }
    const db = getDb()
    const topK = req.top_k ?? 5
    const start = Date.now()

    try {
      // Regular analyses
      const analyses = db.prepare(`
        SELECT a.id, a.root_cause, a.suggested_fixes, a.component, a.severity, 0 AS is_gold
        FROM analyses_fts
        JOIN analyses a ON analyses_fts.rowid = a.id
        WHERE analyses_fts MATCH ?
        LIMIT ?
      `).all(ftsPhrase(req.query), topK) as Array<Record<string, unknown>>

      // Gold analyses
      const goldRows = db.prepare(`
        SELECT ga.id, ga.root_cause, ga.suggested_fixes, ga.component, ga.severity,
               ga.source_analysis_id, 1 AS is_gold
        FROM gold_analyses ga
        WHERE ga.validation_status = 'verified'
          AND (ga.component = ? OR ? IS NULL)
        LIMIT ?
      `).all(req.component ?? null, req.component ?? null, Math.min(topK, 3)) as Array<Record<string, unknown>>

      const toCase = (r: Record<string, unknown>, isGold: boolean) => ({
        analysis_id: Number(r.id),
        similarity_score: 0.7,
        root_cause: (r.root_cause as string) ?? '',
        suggested_fixes: JSON.parse((r.suggested_fixes as string) || '[]'),
        is_gold: isGold,
        citation_id: `${isGold ? 'gold' : 'analysis'}-${r.id}`,
        component: r.component ?? null,
        severity: r.severity ?? null,
      })

      return {
        similar_analyses: analyses.map(r => toCase(r, false)),
        gold_matches: goldRows.map(r => toCase(r, true)),
        confidence_boost: goldRows.length > 0 ? 0.15 : 0,
        retrieval_time_ms: Date.now() - start,
      }
    } catch (err) {
      log.warn('rag_build_context failed:', err)
      return { similar_analyses: [], gold_matches: [], confidence_boost: 0, retrieval_time_ms: Date.now() - start }
    }
  })

  // rag_index_analysis — chunk analysis text and store in retrieval_chunks
  ipcMain.handle('rag_index_analysis', (_e, args: { request?: { analysis: Record<string, unknown> }; analysis?: Record<string, unknown> }) => {
    const req = args.request ?? args as { analysis: Record<string, unknown> }
    const analysis = req.analysis
    if (!analysis?.id) return { indexed: 0, ids: [] }

    const db = getDb()
    const sourceId = Number(analysis.id)

    // Remove old chunks for this analysis
    db.prepare("DELETE FROM retrieval_chunks WHERE source_type = 'analysis' AND source_id = ?").run(sourceId)

    const textParts = [
      analysis.root_cause as string ?? '',
      analysis.error_type as string ?? '',
      analysis.component as string ?? '',
      analysis.error_message as string ?? '',
    ].filter(Boolean).join(' ')

    const chunks = chunkText(textParts)
    const ids: string[] = []

    const insert = db.prepare(`
      INSERT INTO retrieval_chunks
        (source_type, source_id, chunk_index, content, metadata_json, created_at)
      VALUES ('analysis', ?, ?, ?, ?, ?)
    `)

    const metadata = JSON.stringify({
      component: analysis.component ?? null,
      severity: analysis.severity ?? null,
      error_type: analysis.error_type ?? null,
      is_gold: false,
    })

    const now = new Date().toISOString()
    for (let i = 0; i < chunks.length; i++) {
      const row = insert.run(sourceId, i, chunks[i], metadata, now)
      ids.push(`chunk-${row.lastInsertRowid}`)
    }

    return { indexed: chunks.length, ids }
  })

  // rag_get_stats — count retrieval_chunks and analyses
  ipcMain.handle('rag_get_stats', () => {
    const db = getDb()
    try {
      const totalChunks = (db.prepare('SELECT COUNT(*) AS c FROM retrieval_chunks').get() as { c: number }).c
      const totalAnalyses = (db.prepare("SELECT COUNT(DISTINCT source_id) AS c FROM retrieval_chunks WHERE source_type = 'analysis'").get() as { c: number }).c
      const goldAnalyses = (db.prepare("SELECT COUNT(*) AS c FROM gold_analyses WHERE validation_status = 'verified'").get() as { c: number }).c
      return {
        total_chunks: totalChunks,
        total_analyses: totalAnalyses,
        gold_analyses: goldAnalyses,
        storage_path: 'SQLite (local, in hadron.db)',
      }
    } catch {
      return { total_chunks: 0, total_analyses: 0, gold_analyses: 0, storage_path: 'SQLite (local, in hadron.db)' }
    }
  })

  // ============================================================================
  // KB — local file-based knowledge base
  // ============================================================================

  ipcMain.handle('kb_test_connection', () => {
    const db = getDb()
    try {
      const count = (db.prepare(
        "SELECT COUNT(*) AS c FROM retrieval_chunks WHERE source_type = 'documentation'"
      ).get() as { c: number }).c
      const versions = db.prepare(
        "SELECT DISTINCT json_extract(metadata_json, '$.won_version') AS v FROM retrieval_chunks WHERE source_type = 'documentation' AND v IS NOT NULL"
      ).all() as Array<{ v: string }>
      return {
        success: true,
        message: count > 0
          ? `Local KB ready — ${count} indexed chunks across ${versions.length} version(s)`
          : 'Local KB ready — no documents indexed yet. Use "Import Docs" to add documentation.',
        available_indices: versions.map(r => r.v),
      }
    } catch {
      return { success: false, message: 'KB unavailable', available_indices: [] }
    }
  })

  ipcMain.handle('kb_list_indices', () => {
    const db = getDb()
    try {
      return db.prepare(
        "SELECT DISTINCT json_extract(metadata_json, '$.won_version') AS v FROM retrieval_chunks WHERE source_type = 'documentation' AND v IS NOT NULL ORDER BY v"
      ).all().map((r: unknown) => (r as { v: string }).v)
    } catch { return [] }
  })

  ipcMain.handle('kb_import_docs', async (_e, args: {
    request?: { root_path: string; won_version: string; api_key?: string }
    root_path?: string; won_version?: string
  }) => {
    const p = args.request ?? (args as { root_path: string; won_version: string })
    const rootPath = p.root_path ?? ''
    const wonVersion = p.won_version ?? 'unknown'

    if (!rootPath) return { indexed_chunks: 0, won_version: wonVersion }

    try { await fsAsync.access(rootPath) } catch {
      throw new Error(`Cannot access path: ${rootPath}`)
    }

    const CHUNK_MAX = 2000
    const ALLOWED_EXTS = new Set(['.md', '.txt', '.rst'])

    function chunkText(text: string): string[] {
      const chunks: string[] = []
      const paragraphs = text.split(/\n{2,}/)
      let current = ''
      for (const para of paragraphs) {
        if (current && (current + '\n\n' + para).length > CHUNK_MAX) {
          chunks.push(current.trim())
          current = para
        } else {
          current = current ? current + '\n\n' + para : para
        }
      }
      if (current.trim()) chunks.push(current.trim())
      return chunks
    }

    async function walkDir(dir: string): Promise<string[]> {
      const entries = await fsAsync.readdir(dir, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          files.push(...await walkDir(fullPath))
        } else if (entry.isFile() && ALLOWED_EXTS.has(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath)
        }
      }
      return files
    }

    const db = getDb()
    db.prepare(
      "DELETE FROM retrieval_chunks WHERE source_type = 'documentation' AND json_extract(metadata_json, '$.won_version') = ?"
    ).run(wonVersion)

    const files = await walkDir(rootPath)
    let totalChunks = 0

    for (const filePath of files) {
      const text = await fsAsync.readFile(filePath, 'utf-8').catch(() => null)
      if (!text) continue
      const chunks = chunkText(text)
      const relPath = path.relative(rootPath, filePath)

      for (let i = 0; i < chunks.length; i++) {
        const meta = JSON.stringify({ won_version: wonVersion, file: relPath, chunk_index: i })
        db.prepare(`
          INSERT INTO retrieval_chunks (source_type, source_id, chunk_index, content, metadata_json)
          VALUES ('documentation', 0, ?, ?, ?)
        `).run(i, chunks[i], meta)
        totalChunks++
      }
    }

    try { db.exec("INSERT INTO retrieval_chunks_fts(retrieval_chunks_fts) VALUES('rebuild')") } catch { /* ok */ }

    log.info(`KB import complete: ${totalChunks} chunks from ${files.length} files (${wonVersion})`)
    return { indexed_chunks: totalChunks, won_version: wonVersion }
  })

  ipcMain.handle('kb_get_stats', () => {
    const db = getDb()
    try {
      const docChunks = (db.prepare("SELECT COUNT(*) AS c FROM retrieval_chunks WHERE source_type = 'documentation'").get() as { c: number }).c
      return {
        total_chunks: docChunks,
        indexed_versions: [],
        storage_path: 'SQLite (local, in hadron.db)',
      }
    } catch {
      return { total_chunks: 0, indexed_versions: [], storage_path: 'N/A' }
    }
  })

  // ============================================================================
  // Pattern handlers — static built-in patterns
  // ============================================================================

  const BUILT_IN_PATTERNS = [
    { id: 'null-ptr', name: 'Null Pointer', category: 'Memory', enabled: true, priority: 1, tags: ['memory', 'crash'] },
    { id: 'oom', name: 'Out of Memory', category: 'Memory', enabled: true, priority: 2, tags: ['memory', 'performance'] },
    { id: 'db-lock', name: 'Database Lock Timeout', category: 'Database', enabled: true, priority: 3, tags: ['database', 'timeout'] },
    { id: 'net-timeout', name: 'Network Timeout', category: 'Network', enabled: true, priority: 4, tags: ['network', 'timeout'] },
    { id: 'stack-overflow', name: 'Stack Overflow', category: 'Memory', enabled: true, priority: 5, tags: ['memory', 'crash'] },
    { id: 'access-denied', name: 'Access Denied', category: 'Security', enabled: true, priority: 6, tags: ['security', 'auth'] },
    { id: 'parse-error', name: 'Parse Error', category: 'Data', enabled: true, priority: 7, tags: ['data', 'validation'] },
    { id: 'connection-refused', name: 'Connection Refused', category: 'Network', enabled: true, priority: 8, tags: ['network', 'connectivity'] },
  ]

  const toSummary = ({ id, name, category, enabled, priority }: typeof BUILT_IN_PATTERNS[0]) =>
    ({ id, name, category, enabled, priority })

  ipcMain.handle('list_patterns', () => BUILT_IN_PATTERNS.map(toSummary))

  ipcMain.handle('get_pattern_categories', () =>
    [...new Set(BUILT_IN_PATTERNS.map(p => p.category))])

  ipcMain.handle('get_pattern_tags', () =>
    [...new Set(BUILT_IN_PATTERNS.flatMap(p => p.tags))])

  ipcMain.handle('get_patterns_by_category', (_e, args: { category: string }) =>
    BUILT_IN_PATTERNS
      .filter(p => p.category.toLowerCase() === args.category.toLowerCase())
      .map(toSummary))

  ipcMain.handle('get_patterns_by_tag', (_e, args: { tag: string }) =>
    BUILT_IN_PATTERNS
      .filter(p => p.tags.includes(args.tag.toLowerCase()))
      .map(toSummary))
}
