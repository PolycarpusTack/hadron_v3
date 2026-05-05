import type { Database as BetterSqlite3 } from 'better-sqlite3'
import type { ToolDefinition, ToolResult } from './ai-service'
import { readJiraCreds, readJiraProjectKey, jiraFetch, readConfluenceCreds } from './jira-client'
import { ftsPhrase } from './db-helpers'
import log from 'electron-log'

export type { ToolDefinition, ToolResult }

export interface ToolContext {
  db: BetterSqlite3
  apiKey: string
  provider: string
  model: string
  wonVersion?: string | null
  customer?: string | null
  useKb: boolean
  useMcp: boolean
}

// ── Tool Definitions ────────────────────────────────────────────────────────

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'search_analyses',
      description: 'Search historical crash analyses by text query. Returns matching analyses ranked by relevance.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "NilReceiver PSI scheduling", "Oracle deadlock")' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Optional severity filter' },
          date_from: { type: 'string', description: 'Optional ISO-8601 start date (e.g., "2025-01-01")' },
          date_to: { type: 'string', description: 'Optional ISO-8601 end date (e.g., "2025-06-30")' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_analysis_detail',
      description: 'Get full details of a specific crash analysis by its ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The analysis ID number' },
        },
        required: ['id'],
      },
    },
    {
      name: 'find_similar_crashes',
      description: 'Find crashes similar to a given analysis. Matches by error type and component.',
      parameters: {
        type: 'object',
        properties: {
          analysis_id: { type: 'integer', description: 'The analysis ID to find similar crashes for' },
          limit: { type: 'integer', description: 'Max results (default 5)', default: 5 },
        },
        required: ['analysis_id'],
      },
    },
    {
      name: 'get_crash_signature',
      description: 'Look up a crash signature by hash and get all its occurrences. Use to check if a crash is a known issue.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'The signature hash (e.g., "a3f2b1c4d5e6")' },
        },
        required: ['hash'],
      },
    },
    {
      name: 'get_top_signatures',
      description: 'Get the most frequent crash signatures. Shows recurring crash patterns.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max results (default 10)', default: 10 },
          status: { type: 'string', enum: ['new', 'known', 'investigating', 'fixed', 'wont_fix'], description: 'Filter by status' },
        },
      },
    },
    {
      name: 'get_trend_data',
      description: 'Get crash trend analytics over a time period. Shows how many crashes occurred per day/week/month.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['day', 'week', 'month'], description: 'Grouping period' },
          range_days: { type: 'integer', description: 'Lookback window in days (default 30)', default: 30 },
        },
        required: ['period'],
      },
    },
    {
      name: 'get_error_patterns',
      description: 'Get the most common error types and their frequency.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max results (default 10)', default: 10 },
        },
      },
    },
    {
      name: 'get_statistics',
      description: 'Get overall database statistics: total analyses, severity breakdown, favorites count.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'correlate_crash_to_jira',
      description: 'Find JIRA tickets linked to a crash analysis.',
      parameters: {
        type: 'object',
        properties: {
          analysis_id: { type: 'integer', description: 'The analysis ID to find JIRA links for' },
        },
        required: ['analysis_id'],
      },
    },
    {
      name: 'get_crash_timeline',
      description: 'Build a chronological timeline of a crash signature showing all occurrences.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'The crash signature hash to trace' },
        },
        required: ['hash'],
      },
    },
    {
      name: 'compare_crashes',
      description: 'Compare two crash analyses side-by-side.',
      parameters: {
        type: 'object',
        properties: {
          analysis_id_a: { type: 'integer', description: 'First analysis ID' },
          analysis_id_b: { type: 'integer', description: 'Second analysis ID' },
        },
        required: ['analysis_id_a', 'analysis_id_b'],
      },
    },
    {
      name: 'get_component_health',
      description: "Get a health summary for a WHATS'ON component: total crashes, severity breakdown, most common errors.",
      parameters: {
        type: 'object',
        properties: {
          component: { type: 'string', description: 'Component name (e.g., "PSI", "Scheduling", "Oracle")' },
        },
        required: ['component'],
      },
    },
    {
      name: 'search_gold_answers',
      description: 'Search verified gold answers from previous investigations. Check here first before other sources.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to find relevant verified answers' },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_kb',
      description: "Search WHATS'ON Knowledge Base documentation and release notes. Use for questions about features, configuration, or what changed in a release.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for KB docs (e.g., "scheduling engine conflicts", "PSI namespace")' },
          top_k: { type: 'integer', description: 'Max results (default 8)', default: 8 },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_jira',
      description: 'Search JIRA issues by JQL query or text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'JQL query or text search' },
          max_results: { type: 'integer', description: 'Max results (default 5)', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_jira_ticket',
      description: 'Create a new JIRA ticket. Use when the user asks to file a bug or create a ticket.',
      parameters: {
        type: 'object',
        properties: {
          project_key: { type: 'string', description: 'JIRA project key (e.g., "PSI", "WON")' },
          summary: { type: 'string', description: 'Ticket summary/title' },
          description: { type: 'string', description: 'Detailed ticket description' },
          issue_type: { type: 'string', enum: ['Bug', 'Task', 'Story'], description: 'Issue type (default: Bug)' },
          priority: { type: 'string', enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'], description: 'Priority (default: Medium)' },
        },
        required: ['project_key', 'summary', 'description'],
      },
    },
    {
      name: 'investigate_jira_ticket',
      description: 'Run a full investigation on a JIRA ticket. Returns changelog, comments, worklogs, related issues, Confluence docs, hypotheses, and open questions. Use when a user asks to investigate or deep-dive into a ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticket_key: { type: 'string', description: 'The JIRA ticket key, e.g. BR-997 or SRF-1165' },
        },
        required: ['ticket_key'],
      },
    },
    {
      name: 'investigate_regression_family',
      description: 'Find all related historical issues that may be siblings or predecessors of the given ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticket_key: { type: 'string', description: 'The JIRA ticket key to find regression siblings for' },
        },
        required: ['ticket_key'],
      },
    },
    {
      name: 'investigate_expected_behavior',
      description: "Look up expected behavior and documentation for a feature or component. Searches Confluence, MOD documentation, and the WHATS'ON knowledge base.",
      parameters: {
        type: 'object',
        properties: {
          ticket_key: { type: 'string', description: 'The JIRA ticket key providing context (may be empty)' },
          query: { type: 'string', description: 'What to look up, e.g. "EPG scheduling rules"' },
        },
        required: ['query'],
      },
    },
    {
      name: 'investigate_customer_history',
      description: "Retrieve all tickets reported by the same customer/reporter as the given ticket.",
      parameters: {
        type: 'object',
        properties: {
          ticket_key: { type: 'string', description: "The JIRA ticket key whose reporter's history to fetch" },
        },
        required: ['ticket_key'],
      },
    },
    {
      name: 'search_confluence',
      description: 'Search Confluence for documentation pages.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query or CQL expression' },
          space_key: { type: 'string', description: 'Optional Confluence space key' },
          limit: { type: 'integer', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_confluence_page',
      description: 'Fetch a specific Confluence page by its content ID.',
      parameters: {
        type: 'object',
        properties: {
          content_id: { type: 'string', description: 'The Confluence page content ID' },
        },
        required: ['content_id'],
      },
    },
  ]
}

// ── Tool Executor ────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  mcpCallTool?: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<ToolResult> {
  const id = `${name}-${Date.now()}`
  try {
    const content = await executeToolInner(name, args, ctx, mcpCallTool)
    return { toolUseId: id, content, isError: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn(`Tool ${name} failed: ${msg}`)
    return { toolUseId: id, content: `Error: ${msg}`, isError: true }
  }
}

async function executeToolInner(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  mcpCallTool?: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<string> {
  switch (name) {
    case 'search_analyses': return toolSearchAnalyses(args, ctx)
    case 'get_analysis_detail': return toolGetAnalysisDetail(args, ctx)
    case 'find_similar_crashes': return toolFindSimilarCrashes(args, ctx)
    case 'get_crash_signature': return toolGetCrashSignature(args, ctx)
    case 'get_top_signatures': return toolGetTopSignatures(args, ctx)
    case 'get_trend_data': return toolGetTrendData(args, ctx)
    case 'get_error_patterns': return toolGetErrorPatterns(args, ctx)
    case 'get_statistics': return toolGetStatistics(ctx)
    case 'correlate_crash_to_jira': return toolCorrelateToJira(args, ctx)
    case 'get_crash_timeline': return toolGetCrashTimeline(args, ctx)
    case 'compare_crashes': return toolCompareCrashes(args, ctx)
    case 'get_component_health': return toolGetComponentHealth(args, ctx)
    case 'search_gold_answers': return toolSearchGoldAnswers(args, ctx)
    case 'search_kb': return toolSearchKb(args, ctx)
    case 'search_jira': return toolSearchJira(args)
    case 'create_jira_ticket': return toolCreateJiraTicket(args)
    case 'investigate_jira_ticket':
      if (mcpCallTool) return mcpCallTool('investigate_ticket', { ticket_key: args.ticket_key })
      return toolNativeInvestigateTicket(args)
    case 'investigate_regression_family':
      if (mcpCallTool) return mcpCallTool('investigate_regression_family', { ticket_key: args.ticket_key })
      return toolNativeRegressionFamily(args)
    case 'investigate_expected_behavior':
      if (mcpCallTool) return mcpCallTool('investigate_expected_behavior', { ticket_key: args.ticket_key ?? '', query: args.query })
      return toolNativeExpectedBehavior(args)
    case 'investigate_customer_history':
      if (mcpCallTool) return mcpCallTool('investigate_customer_history', { ticket_key: args.ticket_key })
      return toolNativeCustomerHistory(args)
    case 'search_confluence':
      if (mcpCallTool) return mcpCallTool('confluence_search_content', { query: args.query, space_key: args.space_key, limit: args.limit })
      return toolNativeSearchConfluence(args)
    case 'get_confluence_page':
      if (mcpCallTool) return mcpCallTool('confluence_get_content', { content_id: args.content_id })
      return toolNativeGetConfluencePage(args)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── Native DB implementations ────────────────────────────────────────────────

function toolSearchAnalyses(args: Record<string, unknown>, ctx: ToolContext): string {
  const query = String(args.query ?? '')
  if (!query) return 'Missing query parameter.'
  const db = ctx.db
  type Row = { id: number; filename: string; severity: string; error_type: string; root_cause: string; component: string | null; analyzed_at: string }
  let sql = `
    SELECT a.id, a.filename, a.severity, a.error_type, a.root_cause, a.component, a.analyzed_at
    FROM analyses_fts
    JOIN analyses a ON analyses_fts.rowid = a.id
    WHERE analyses_fts MATCH ? AND a.deleted_at IS NULL`
  const params: unknown[] = [ftsPhrase(query)]
  if (args.severity) { sql += ' AND LOWER(a.severity) = ?'; params.push(String(args.severity).toLowerCase()) }
  if (args.date_from) { sql += ' AND a.analyzed_at >= ?'; params.push(args.date_from) }
  if (args.date_to)   { sql += ' AND a.analyzed_at <= ?'; params.push(args.date_to) }
  sql += ' LIMIT 10'
  const rows = db.prepare(sql).all(...params) as Row[]
  if (rows.length === 0) return 'No analyses found matching the query.'
  return `Found ${rows.length} analyses:\n\n` + rows.map(r =>
    `**[Analysis #${r.id}](hadron://analysis/${r.id})** — ${r.filename} (${r.severity})\n` +
    `- Error: ${r.error_type}\n- Root Cause: ${r.root_cause.substring(0, 200)}\n` +
    `- Component: ${r.component ?? 'unknown'}\n- Date: ${r.analyzed_at}\n`
  ).join('\n')
}

function toolGetAnalysisDetail(args: Record<string, unknown>, ctx: ToolContext): string {
  const id = Number(args.id)
  if (!id) throw new Error("Missing 'id' parameter")
  type Row = { id: number; filename: string; error_type: string; error_message: string | null; severity: string; component: string | null; root_cause: string; suggested_fixes: string; confidence: string | null; analyzed_at: string; ai_model: string; ai_provider: string | null; analysis_type: string; stack_trace: string | null }
  const row = ctx.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as Row | undefined
  if (!row) return `Analysis #${id} not found.`
  let fixes: string[] = []
  try { fixes = JSON.parse(row.suggested_fixes) } catch { fixes = [] }
  return `**[Analysis #${row.id}](hadron://analysis/${row.id})**: ${row.filename}\n\n` +
    `- **Error Type**: ${row.error_type}\n` +
    `- **Error Message**: ${row.error_message ?? 'N/A'}\n` +
    `- **Severity**: ${row.severity}\n` +
    `- **Component**: ${row.component ?? 'unknown'}\n` +
    `- **Root Cause**: ${row.root_cause}\n` +
    `- **Suggested Fixes**:\n${fixes.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}\n` +
    `- **Confidence**: ${row.confidence ?? 'N/A'}\n` +
    `- **Date**: ${row.analyzed_at}\n` +
    `- **Model**: ${row.ai_model} (${row.ai_provider ?? 'unknown'})\n` +
    `- **Type**: ${row.analysis_type}`
}

function toolFindSimilarCrashes(args: Record<string, unknown>, ctx: ToolContext): string {
  const id = Number(args.analysis_id)
  if (!id) throw new Error("Missing 'analysis_id' parameter")
  const limit = Number(args.limit ?? 5)
  type Source = { error_type: string; component: string | null }
  const source = ctx.db.prepare('SELECT error_type, component FROM analyses WHERE id = ?').get(id) as Source | undefined
  if (!source) return `Analysis #${id} not found.`
  type Row = { id: number; filename: string; severity: string; error_type: string; root_cause: string }
  const rows = ctx.db.prepare(`
    SELECT id, filename, severity, error_type, root_cause FROM analyses
    WHERE id != ? AND deleted_at IS NULL
      AND (error_type = ? OR (component = ? AND component IS NOT NULL))
    ORDER BY analyzed_at DESC LIMIT ?
  `).all(id, source.error_type, source.component, limit) as Row[]
  if (rows.length === 0) return 'No similar crashes found.'
  return `Found ${rows.length} similar crashes:\n\n` + rows.map(r =>
    `- **#${r.id}** ${r.filename} (${r.severity}) — ${r.error_type}: ${r.root_cause.substring(0, 100)}`
  ).join('\n')
}

function toolGetCrashSignature(args: Record<string, unknown>, ctx: ToolContext): string {
  const hash = String(args.hash ?? '')
  if (!hash) throw new Error("Missing 'hash' parameter")
  type Sig = { hash: string; canonical: string; occurrence_count: number; first_seen_at: string; last_seen_at: string; status: string; linked_ticket_id: string | null; linked_ticket_url: string | null }
  const sig = ctx.db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(hash) as Sig | undefined
  if (!sig) return `Signature ${hash} not found.`
  type File = { id: number; filename: string; severity: string; analyzed_at: string }
  const files = ctx.db.prepare(`
    SELECT a.id, a.filename, a.severity, a.analyzed_at FROM analyses a
    JOIN analysis_signatures asig ON asig.analysis_id = a.id
    WHERE asig.signature_hash = ? ORDER BY a.analyzed_at DESC LIMIT 10
  `).all(hash) as File[]
  return `**Signature**: \`${sig.hash}\`\n` +
    `- **Status**: ${sig.status}\n` +
    `- **Occurrences**: ${sig.occurrence_count}\n` +
    `- **First seen**: ${sig.first_seen_at}\n` +
    `- **Last seen**: ${sig.last_seen_at}\n` +
    (sig.linked_ticket_id ? `- **Linked ticket**: [${sig.linked_ticket_id}](${sig.linked_ticket_url})\n` : '') +
    `\n**Recent occurrences** (${files.length}):\n` +
    files.map(f => `- [Analysis #${f.id}](hadron://analysis/${f.id}) — ${f.filename} (${f.severity}) — ${f.analyzed_at}`).join('\n')
}

function toolGetTopSignatures(args: Record<string, unknown>, ctx: ToolContext): string {
  const limit = Number(args.limit ?? 10)
  type Sig = { hash: string; canonical: string; occurrence_count: number; status: string; first_seen_at: string; last_seen_at: string }
  let sql = 'SELECT * FROM crash_signatures'
  const params: unknown[] = []
  if (args.status) { sql += ' WHERE status = ?'; params.push(args.status) }
  sql += ' ORDER BY occurrence_count DESC LIMIT ?'
  params.push(limit)
  const rows = ctx.db.prepare(sql).all(...params) as Sig[]
  if (rows.length === 0) return 'No crash signatures found.'
  return `Top ${rows.length} crash signatures:\n\n` + rows.map((s, i) =>
    `${i + 1}. \`${s.hash}\` — ${s.occurrence_count} occurrences (${s.status})\n   ${s.canonical.substring(0, 100)}`
  ).join('\n')
}

function toolGetTrendData(args: Record<string, unknown>, ctx: ToolContext): string {
  const period = String(args.period ?? 'day')
  const rangeDays = Number(args.range_days ?? 30)
  const strfmt = period === 'month' ? '%Y-%m' : period === 'week' ? '%Y-W%W' : '%Y-%m-%d'
  type Row = { period: string; count: number }
  const rows = ctx.db.prepare(`
    SELECT strftime(?, analyzed_at) as period, COUNT(*) as count
    FROM analyses
    WHERE deleted_at IS NULL AND analyzed_at >= datetime('now', ?)
    GROUP BY period ORDER BY period ASC
  `).all(strfmt, `-${rangeDays} days`) as Row[]
  if (rows.length === 0) return `No crash data found for the last ${rangeDays} days.`
  return `Crash trends (by ${period}, last ${rangeDays} days):\n\n` +
    rows.map(r => `- **${r.period}**: ${r.count} crashes`).join('\n')
}

function toolGetErrorPatterns(args: Record<string, unknown>, ctx: ToolContext): string {
  const limit = Number(args.limit ?? 10)
  type Row = { error_type: string; count: number }
  const rows = ctx.db.prepare(`
    SELECT error_type, COUNT(*) as count FROM analyses
    WHERE deleted_at IS NULL GROUP BY error_type ORDER BY count DESC LIMIT ?
  `).all(limit) as Row[]
  if (rows.length === 0) return 'No error patterns found.'
  return `Top error patterns:\n\n` + rows.map((r, i) => `${i + 1}. **${r.error_type}**: ${r.count} occurrences`).join('\n')
}

function toolGetStatistics(ctx: ToolContext): string {
  type Total = { total: number }
  type Sev = { severity: string; count: number }
  type Fav = { fav: number }
  const total = (ctx.db.prepare('SELECT COUNT(*) as total FROM analyses WHERE deleted_at IS NULL').get() as Total).total
  const bySeverity = ctx.db.prepare('SELECT severity, COUNT(*) as count FROM analyses WHERE deleted_at IS NULL GROUP BY severity ORDER BY count DESC').all() as Sev[]
  const favorites = (ctx.db.prepare('SELECT COUNT(*) as fav FROM analyses WHERE is_favorite = 1 AND deleted_at IS NULL').get() as Fav).fav
  return `**Hadron Database Statistics**\n\n` +
    `- **Total analyses**: ${total}\n` +
    `- **Favorites**: ${favorites}\n` +
    `- **By severity**:\n${bySeverity.map(s => `  - ${s.severity}: ${s.count}`).join('\n')}`
}

function toolCorrelateToJira(args: Record<string, unknown>, ctx: ToolContext): string {
  const id = Number(args.analysis_id)
  if (!id) throw new Error("Missing 'analysis_id' parameter")
  type Link = { jira_key: string; jira_url: string | null; link_type: string | null; created_at: string }
  const links = ctx.db.prepare(`
    SELECT jira_key, jira_url, link_type, created_at FROM analysis_jira_links WHERE analysis_id = ?
  `).all(id) as Link[]
  if (links.length === 0) return `No JIRA tickets linked to analysis #${id}.`
  return `JIRA tickets linked to analysis #${id}:\n\n` + links.map(l =>
    `- **${l.jira_key}** (${l.link_type ?? 'linked'})${l.jira_url ? ` — [${l.jira_url}](${l.jira_url})` : ''} — ${l.created_at}`
  ).join('\n')
}

function toolGetCrashTimeline(args: Record<string, unknown>, ctx: ToolContext): string {
  const hash = String(args.hash ?? '')
  if (!hash) throw new Error("Missing 'hash' parameter")
  type Sig = { hash: string; canonical: string; occurrence_count: number; first_seen_at: string; last_seen_at: string; status: string; linked_ticket_id: string | null; linked_ticket_url: string | null }
  const sig = ctx.db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(hash) as Sig | undefined
  if (!sig) return `Signature ${hash} not found.`
  type File = { id: number; filename: string; severity: string; analyzed_at: string }
  const files = ctx.db.prepare(`
    SELECT a.id, a.filename, a.severity, a.analyzed_at
    FROM analyses a JOIN analysis_signatures asig ON asig.analysis_id = a.id
    WHERE asig.signature_hash = ? ORDER BY a.analyzed_at ASC
  `).all(hash) as File[]
  return `**Timeline for signature** \`${hash}\`\n` +
    `**Canonical**: ${sig.canonical.substring(0, 150)}\n` +
    `**Status**: ${sig.status} | **Total**: ${sig.occurrence_count} occurrences\n` +
    (sig.linked_ticket_id ? `**Linked ticket**: ${sig.linked_ticket_id}\n` : '') +
    `\n| Date | Analysis | Severity |\n|---|---|---|\n` +
    files.map(f => `| ${f.analyzed_at.substring(0, 10)} | [#${f.id} ${f.filename}](hadron://analysis/${f.id}) | ${f.severity} |`).join('\n')
}

function toolCompareCrashes(args: Record<string, unknown>, ctx: ToolContext): string {
  const idA = Number(args.analysis_id_a)
  const idB = Number(args.analysis_id_b)
  if (!idA || !idB) throw new Error("Missing 'analysis_id_a' or 'analysis_id_b'")
  type Row = { id: number; filename: string; error_type: string; severity: string; component: string | null; root_cause: string; suggested_fixes: string; confidence: string | null }
  const a = ctx.db.prepare('SELECT id, filename, error_type, severity, component, root_cause, suggested_fixes, confidence FROM analyses WHERE id = ?').get(idA) as Row | undefined
  const b = ctx.db.prepare('SELECT id, filename, error_type, severity, component, root_cause, suggested_fixes, confidence FROM analyses WHERE id = ?').get(idB) as Row | undefined
  if (!a || !b) return `One or both analyses not found (${idA}, ${idB}).`
  const field = (label: string, va: string | null, vb: string | null) =>
    `| **${label}** | ${va ?? 'N/A'} | ${vb ?? 'N/A'} |\n`
  return `**Comparison: Analysis #${a.id} vs Analysis #${b.id}**\n\n` +
    `| Field | #${a.id} ${a.filename} | #${b.id} ${b.filename} |\n|---|---|---|\n` +
    field('Error Type', a.error_type, b.error_type) +
    field('Severity', a.severity, b.severity) +
    field('Component', a.component, b.component) +
    field('Confidence', a.confidence, b.confidence) +
    `| **Root Cause** | ${a.root_cause.substring(0, 150)} | ${b.root_cause.substring(0, 150)} |`
}

function toolGetComponentHealth(args: Record<string, unknown>, ctx: ToolContext): string {
  const component = String(args.component ?? '')
  if (!component) throw new Error("Missing 'component' parameter")
  type Total = { total: number }
  type Sev = { severity: string; count: number }
  type Err = { error_type: string; count: number }
  type Link = { jira_key: string }
  const total = (ctx.db.prepare('SELECT COUNT(*) as total FROM analyses WHERE component LIKE ? AND deleted_at IS NULL').get(`%${component}%`) as Total).total
  const bySev = ctx.db.prepare('SELECT severity, COUNT(*) as count FROM analyses WHERE component LIKE ? AND deleted_at IS NULL GROUP BY severity ORDER BY count DESC').all(`%${component}%`) as Sev[]
  const topErrors = ctx.db.prepare('SELECT error_type, COUNT(*) as count FROM analyses WHERE component LIKE ? AND deleted_at IS NULL GROUP BY error_type ORDER BY count DESC LIMIT 5').all(`%${component}%`) as Err[]
  const jiraLinks = ctx.db.prepare(`SELECT DISTINCT jl.jira_key FROM analysis_jira_links jl JOIN analyses a ON a.id = jl.analysis_id WHERE a.component LIKE ? AND a.deleted_at IS NULL LIMIT 5`).all(`%${component}%`) as Link[]
  return `**Component Health: ${component}**\n\n` +
    `- **Total crashes**: ${total}\n` +
    `- **By severity**: ${bySev.map(s => `${s.severity}: ${s.count}`).join(', ')}\n` +
    `- **Top error types**:\n${topErrors.map(e => `  - ${e.error_type}: ${e.count}`).join('\n')}\n` +
    (jiraLinks.length > 0 ? `- **Related JIRA tickets**: ${jiraLinks.map(l => l.jira_key).join(', ')}\n` : '')
}

function toolSearchGoldAnswers(args: Record<string, unknown>, ctx: ToolContext): string {
  const query = String(args.query ?? '')
  if (!query) throw new Error("Missing 'query' parameter")
  type Row = { id: number; question: string; answer: string; won_version: string | null; customer: string | null; created_at: string }
  const rows = ctx.db.prepare(`
    SELECT id, question, answer, won_version, customer, created_at
    FROM gold_answers
    WHERE question LIKE ? OR answer LIKE ?
    ORDER BY created_at DESC LIMIT 5
  `).all(`%${query}%`, `%${query}%`) as Row[]
  if (rows.length === 0) return `No verified answers found for "${query}".`
  return `Found ${rows.length} verified answers:\n\n` + rows.map(r =>
    `**Q**: ${r.question.substring(0, 200)}\n**A**: ${r.answer.substring(0, 400)}\n` +
    (r.won_version ? `*(WON ${r.won_version}${r.customer ? `, ${r.customer}` : ''})*` : '')
  ).join('\n\n---\n\n')
}

async function toolSearchKb(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const query = String(args.query ?? '')
  const topK = Number(args.top_k ?? 8)
  if (!query) throw new Error("Missing 'query' parameter")
  type Chunk = { id: number; source_path: string; content: string }
  const db = ctx.db
  const rows = db.prepare(`
    SELECT rc.id, rc.source_path, rc.content
    FROM retrieval_chunks_fts rcf
    JOIN retrieval_chunks rc ON rcf.rowid = rc.id
    WHERE rcf MATCH ?
    LIMIT ?
  `).all(ftsPhrase(query), topK) as Chunk[]
  if (rows.length === 0) {
    return 'No Knowledge Base documents found matching the query. Ensure KB documents have been imported in Settings → Knowledge Base.'
  }
  return `Found ${rows.length} KB documents:\n\n` + rows.map(r => {
    const title = r.source_path.split(/[\\/]/).pop() ?? r.source_path
    return `<documentation>\n  <source>${title}</source>\n  <extract>${r.content.substring(0, 1200)}</extract>\n</documentation>`
  }).join('\n\n')
}

// ── JIRA native tools ────────────────────────────────────────────────────────

async function toolSearchJira(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '')
  if (!query) throw new Error("Missing 'query' parameter")
  const maxResults = Number(args.max_results ?? 5)
  const { baseUrl, email, apiToken } = readJiraCreds()
  const isJql = /\b(project|status|assignee|priority|AND|OR|ORDER BY|issuetype)\b/i.test(query)
  const jql = isJql ? query : `text ~ "${query.replace(/"/g, '\\"')}" ORDER BY updated DESC`
  const data = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,priority,issuetype`) as {
    issues: Array<{ key: string; fields: { summary: string; status: { name: string }; assignee: { displayName: string } | null; priority: { name: string } | null; issuetype: { name: string } } }>
  }
  if (!data.issues?.length) return 'No JIRA tickets found.'
  return `Found ${data.issues.length} JIRA tickets:\n\n` + data.issues.map(i =>
    `- **${i.key}**: ${i.fields.summary}\n  Status: ${i.fields.status.name} | Priority: ${i.fields.priority?.name ?? 'N/A'} | Assignee: ${i.fields.assignee?.displayName ?? 'Unassigned'}`
  ).join('\n')
}

async function toolCreateJiraTicket(args: Record<string, unknown>): Promise<string> {
  const { project_key, summary, description, issue_type = 'Bug', priority = 'Medium' } = args as {
    project_key: string; summary: string; description: string; issue_type?: string; priority?: string
  }
  if (!project_key || !summary || !description) throw new Error('Missing required parameters: project_key, summary, description')
  const { baseUrl, email, apiToken } = readJiraCreds()
  const body = {
    fields: {
      project: { key: project_key },
      summary,
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] },
      issuetype: { name: issue_type },
      priority: { name: priority },
    },
  }
  const created = await jiraFetch(baseUrl, email, apiToken, '/rest/api/3/issue', { method: 'POST', body: JSON.stringify(body) }) as { key: string; id: string }
  return `Successfully created JIRA ticket **${created.key}**: "${summary}"\nIssue ID: ${created.id}`
}

// ── Native fallbacks for investigation tools (when MCP not available) ─────────

async function toolNativeInvestigateTicket(args: Record<string, unknown>): Promise<string> {
  const ticketKey = String(args.ticket_key ?? '')
  if (!ticketKey) throw new Error("Missing 'ticket_key' parameter")
  const { baseUrl, email, apiToken } = readJiraCreds()
  const issue = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/issue/${ticketKey}?expand=changelog,renderedFields&fields=summary,description,status,priority,assignee,reporter,issuetype,labels,components,comment,attachment`) as {
    key: string
    fields: {
      summary: string
      status: { name: string }
      priority: { name: string } | null
      assignee: { displayName: string } | null
      reporter: { displayName: string } | null
      issuetype: { name: string }
      labels: string[]
      components: Array<{ name: string }>
      comment: { comments: Array<{ author: { displayName: string }; created: string }> }
    }
    changelog: { histories: Array<{ created: string; author: { displayName: string }; items: Array<{ field: string; fromString: string | null; toString: string | null }> }> }
  }
  const f = issue.fields
  const comments = f.comment.comments.slice(-5).map(c => `  [${c.created.substring(0, 10)}] ${c.author.displayName}: (comment)`)
  const history = issue.changelog.histories.slice(-10).map(h =>
    `  [${h.created.substring(0, 10)}] ${h.author.displayName}: ` + h.items.map(i => `${i.field}: ${i.fromString ?? '(none)'} → ${i.toString ?? '(none)'}`).join(', ')
  )
  return `**Investigation: ${ticketKey} — ${f.summary}**\n\n` +
    `- **Status**: ${f.status.name} | **Priority**: ${f.priority?.name ?? 'N/A'} | **Type**: ${f.issuetype.name}\n` +
    `- **Assignee**: ${f.assignee?.displayName ?? 'Unassigned'} | **Reporter**: ${f.reporter?.displayName ?? 'Unknown'}\n` +
    `- **Labels**: ${f.labels.join(', ') || 'none'} | **Components**: ${f.components.map(c => c.name).join(', ') || 'none'}\n\n` +
    `**Recent Comments** (last 5):\n${comments.join('\n') || '  None'}\n\n` +
    `**Changelog** (last 10 changes):\n${history.join('\n') || '  No changes'}\n\n` +
    `*Tip: For deeper investigation including Confluence docs and hypotheses, configure CodexMgX in Settings.*`
}

async function toolNativeRegressionFamily(args: Record<string, unknown>): Promise<string> {
  const ticketKey = String(args.ticket_key ?? '')
  if (!ticketKey) throw new Error("Missing 'ticket_key' parameter")
  const { baseUrl, email, apiToken } = readJiraCreds()
  const project = ticketKey.split('-')[0]
  const jql = `project = "${project}" AND created >= -90d AND text ~ "${ticketKey}" ORDER BY created DESC`
  const data = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,status,created`) as {
    issues: Array<{ key: string; fields: { summary: string; status: { name: string }; created: string } }>
  }
  if (!data.issues?.length) return `No related issues found for ${ticketKey} in the last 90 days.`
  return `**Regression family for ${ticketKey}** (last 90 days, project ${project}):\n\n` +
    data.issues.map(i => `- **${i.key}**: ${i.fields.summary} (${i.fields.status.name}, ${i.fields.created.substring(0, 10)})`).join('\n') +
    `\n\n*For cross-project analysis, configure CodexMgX in Settings.*`
}

async function toolNativeExpectedBehavior(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '')
  if (!query) throw new Error("Missing 'query' parameter")
  try {
    const { baseUrl, email, apiToken } = readConfluenceCreds()
    const confluenceBase = baseUrl.replace(/\/rest\/api.*/, '')
    const data = await jiraFetch(confluenceBase, email, apiToken,
      `/wiki/rest/api/content/search?cql=${encodeURIComponent(`type=page AND text ~ "${query}"`)}&limit=5&expand=excerpt`) as {
      results: Array<{ id: string; title: string; _links: { webui: string }; excerpt?: string }>
    }
    if (!data.results?.length) return `No Confluence documentation found for "${query}".`
    return `**Confluence docs for "${query}"**:\n\n` + data.results.map(r =>
      `- **[${r.title}](${r._links.webui})**\n  ${r.excerpt ?? '(no excerpt)'}`
    ).join('\n\n')
  } catch (e) {
    return `Could not search documentation: ${e instanceof Error ? e.message : String(e)}. Configure CodexMgX for full MOD/KB search.`
  }
}

async function toolNativeCustomerHistory(args: Record<string, unknown>): Promise<string> {
  const ticketKey = String(args.ticket_key ?? '')
  if (!ticketKey) throw new Error("Missing 'ticket_key' parameter")
  const { baseUrl, email, apiToken } = readJiraCreds()
  const issue = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/issue/${ticketKey}?fields=reporter`) as {
    fields: { reporter: { accountId: string; displayName: string } | null }
  }
  const reporter = issue.fields.reporter
  if (!reporter) return `No reporter found for ${ticketKey}.`
  const jql = `reporter = "${reporter.accountId}" ORDER BY created DESC`
  const data = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,status,created,priority`) as {
    issues: Array<{ key: string; fields: { summary: string; status: { name: string }; created: string; priority: { name: string } | null } }>
  }
  if (!data.issues?.length) return `No ticket history found for reporter ${reporter.displayName}.`
  return `**Ticket history for ${reporter.displayName}** (reporter of ${ticketKey}):\n\n` +
    data.issues.map(i => `- **${i.key}**: ${i.fields.summary} (${i.fields.status.name}, ${i.fields.priority?.name ?? 'N/A'}, ${i.fields.created.substring(0, 10)})`).join('\n')
}

async function toolNativeSearchConfluence(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '')
  const limit = Number(args.limit ?? 10)
  const { baseUrl, email, apiToken } = readConfluenceCreds()
  const confluenceBase = baseUrl.replace(/\/rest\/api.*/, '')
  let cql = `type=page AND text ~ "${query.replace(/"/g, '\\"')}"`
  if (args.space_key) cql += ` AND space.key = "${args.space_key}"`
  const data = await jiraFetch(confluenceBase, email, apiToken,
    `/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=excerpt`) as {
    results: Array<{ id: string; title: string; _links: { webui: string }; excerpt?: string }>
  }
  if (!data.results?.length) return `No Confluence pages found for "${query}".`
  return `Found ${data.results.length} Confluence pages:\n\n` + data.results.map(r =>
    `- **[${r.title}](${r._links.webui})**\n  ID: ${r.id}\n  ${r.excerpt ?? ''}`
  ).join('\n\n')
}

async function toolNativeGetConfluencePage(args: Record<string, unknown>): Promise<string> {
  const contentId = String(args.content_id ?? '')
  if (!contentId) throw new Error("Missing 'content_id' parameter")
  const { baseUrl, email, apiToken } = readConfluenceCreds()
  const confluenceBase = baseUrl.replace(/\/rest\/api.*/, '')
  const data = await jiraFetch(confluenceBase, email, apiToken,
    `/wiki/rest/api/content/${contentId}?expand=body.view,version`) as {
    title: string
    _links: { webui: string }
    body: { view: { value: string } }
  }
  const text = data.body?.view?.value?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
  return `**${data.title}**\nURL: ${data._links.webui}\n\n${text.substring(0, 3000)}`
}
