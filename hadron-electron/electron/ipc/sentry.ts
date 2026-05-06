import { IpcMain } from 'electron'
import log from 'electron-log'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'
import { getSecret } from '../services/safe-storage'
import { SERVICE_NAME } from '../services/jira-client'
import { aiRateLimiter } from '../services/rate-limiter'
import { getApiKeyFromKeeper } from './keeper'

// ─────────────────────────────────────────────────────────────────────────────
// AI system prompt — requests a rich structured response covering all four tabs
// ─────────────────────────────────────────────────────────────────────────────

const SENTRY_ANALYSIS_SYSTEM_PROMPT = `You are an expert software engineer specializing in production incident analysis.
Analyze the provided Sentry issue data and return a JSON object with EXACTLY this structure:
{
  "error_type": "short exception class or error code (e.g. NullReferenceException, ORA-01652)",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "component": "affected class, module, or service",
  "confidence": "HIGH|MEDIUM|LOW",
  "pattern_type": "deadlock|n_plus_one|memory_leak|unhandled_promise|resource_exhaustion|configuration|dependency|other",
  "root_cause": "1-3 sentence technical root cause explanation for developers",
  "plain_english": "1-2 sentence non-technical explanation suitable for customers",
  "user_impact": "What did the user experience and what workflow was interrupted?",
  "breadcrumb_analysis": "What does the event sequence reveal about the exact trigger? Be specific about the sequence of actions leading to the failure.",
  "suggested_fixes": [
    "P0: <immediate fix — specific file/function if identifiable, with before/after description>",
    "P1: <short-term improvement for this sprint>",
    "P2: <architectural prevention for next quarter>"
  ],
  "reproduction_steps": ["step 1", "step 2", "step 3"],
  "workaround": "Immediate workaround a user or support engineer can apply right now",
  "fingerprint": ["token1", "token2", "token3"],
  "monitoring_alerts": [
    { "name": "Alert name", "condition": "trigger condition description", "target": "#channel or team", "severity": "critical|high|warning" }
  ],
  "confidence_breakdown": {
    "confirmed": ["fact directly evidenced by Sentry data"],
    "inferred": ["reasonable deduction from indirect evidence"],
    "unknown": ["cannot be determined from available data"]
  },
  "stack_trace": "5-10 most relevant in-app stack frames as a single newline-separated string"
}
Return only valid JSON. No markdown fences. No extra keys.`

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

interface SentryProject {
  id: string
  slug: string
  name: string
  platform: string | null
  organization: { slug: string }
}

interface SentryBreadcrumb {
  timestamp?: string
  type?: string
  category?: string
  message?: string
  level?: string
  data?: Record<string, unknown>
}

interface SentryExceptionFrame {
  filename?: string
  function?: string
  lineNo?: number
  colNo?: number
  module?: string
  inApp?: boolean
  contextLine?: string
  preContext?: string[]
  postContext?: string[]
}

interface SentryExceptionValue {
  type?: string
  value?: string
  module?: string
  stacktrace?: { frames?: SentryExceptionFrame[] }
}

interface DetectedPattern {
  patternType: string
  confidence: number
  evidence: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentry API helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseNextCursor(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    if (/rel="next"/.test(part) && /results="true"/.test(part)) {
      const m = part.match(/cursor="([^"]+)"/)
      if (m) return m[1]
    }
  }
  return null
}

async function sentryFetch(
  baseUrl: string,
  authToken: string,
  path: string
): Promise<{ data: unknown; nextCursor: string | null }> {
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:') throw new Error('Sentry base URL must use https://')
  } catch (e) {
    if ((e as Error).message.includes('Invalid URL')) throw new Error('Sentry base URL is not a valid URL')
    throw e
  }
  const { default: fetch } = await import('node-fetch')
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Sentry API error ${res.status}: ${body.substring(0, 200)}`)
  }
  const nextCursor = parseNextCursor(res.headers.get('Link'))
  return { data: await res.json(), nextCursor }
}

// Sentry issue IDs are short alphanumeric strings (numeric or 32-char hex).
// Reject anything else to prevent path traversal in URLs.
const SENTRY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
function validateSentryId(id: unknown): string {
  if (typeof id !== 'string' || !SENTRY_ID_RE.test(id)) throw new Error('Invalid Sentry issue ID')
  return id
}

const SENTRY_SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/
function validateSentrySlug(slug: unknown, kind: string): string {
  if (typeof slug !== 'string' || !SENTRY_SLUG_RE.test(slug)) throw new Error(`Invalid Sentry ${kind} slug`)
  return slug
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse typed entries from a Sentry event into breadcrumbs, exceptions,
 * contexts, and tags. The Sentry Events API returns an `entries` array where
 * each element has a `type` discriminator and a `data` payload.
 */
function extractEventData(event: Record<string, unknown>): {
  breadcrumbs: SentryBreadcrumb[]
  exceptions: SentryExceptionValue[]
  contexts: Record<string, unknown>
  eventTags: Array<{ key: string; value: string }>
  environment?: string
  release?: string
} {
  const entries =
    (event.entries as Array<{ type: string; data: Record<string, unknown> }> | undefined) ?? []

  const breadcrumbs: SentryBreadcrumb[] = []
  const exceptions: SentryExceptionValue[] = []

  for (const entry of entries) {
    if (entry.type === 'breadcrumbs') {
      const values = (entry.data?.values as SentryBreadcrumb[] | undefined) ?? []
      breadcrumbs.push(...values)
    } else if (entry.type === 'exception') {
      const values = (entry.data?.values as SentryExceptionValue[] | undefined) ?? []
      exceptions.push(...values)
    }
  }

  return {
    breadcrumbs,
    exceptions,
    contexts: (event.contexts as Record<string, unknown> | undefined) ?? {},
    eventTags: (event.tags as Array<{ key: string; value: string }> | undefined) ?? [],
    environment: event.environment as string | undefined,
    release: event.release as string | undefined,
  }
}

/**
 * Heuristic pattern detection — runs on raw Sentry data before the AI call
 * so results are deterministic and cannot hallucinate.
 */
function detectPatterns(
  exceptions: SentryExceptionValue[],
  breadcrumbs: SentryBreadcrumb[]
): DetectedPattern[] {
  const patterns: DetectedPattern[] = []

  const exText = exceptions.flatMap(e => [e.type ?? '', e.value ?? '']).join(' ')
  const frameText = exceptions
    .flatMap(e => e.stacktrace?.frames ?? [])
    .map(f => `${f.module ?? ''} ${f.function ?? ''} ${f.filename ?? ''}`)
    .join(' ')
  const combined = `${exText} ${frameText}`

  if (/out.?of.?memory|heap.?space|gc overhead|memory exhausted|allocation failed/i.test(combined)) {
    patterns.push({ patternType: 'memory_leak', confidence: 0.85, evidence: ['OutOfMemory/heap exhaustion in exception'] })
  }

  if (/dead.?lock/i.test(combined)) {
    patterns.push({ patternType: 'deadlock', confidence: 0.90, evidence: ['Deadlock keyword in exception or frames'] })
  }

  if (/unhandledpromise|unhandledrejection|uncaughtexception/i.test(combined)) {
    patterns.push({ patternType: 'unhandled_promise', confidence: 0.88, evidence: ['Unhandled promise/rejection exception type'] })
  }

  if (/quota|rate.?limit|too many|exhausted|limit.?exceeded/i.test(exText)) {
    patterns.push({ patternType: 'resource_exhaustion', confidence: 0.80, evidence: ['Resource/rate-limit exhaustion in exception message'] })
  }

  // N+1 — look for 5+ near-identical DB breadcrumbs
  const dbCrumbs = breadcrumbs.filter(b =>
    b.category === 'db' || b.category === 'sql' ||
    /\bSELECT\b|\bINSERT\b|\bUPDATE\b/i.test(b.message ?? '')
  )
  if (dbCrumbs.length >= 5) {
    const sigs = dbCrumbs.map(b => (b.message ?? '').replace(/\d+/g, '?').trim().slice(0, 60))
    const counts = new Map<string, number>()
    for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1)
    const max = Math.max(...counts.values())
    if (max >= 5) {
      patterns.push({ patternType: 'n_plus_one', confidence: 0.75, evidence: [`${max} near-identical DB queries in breadcrumbs`] })
    }
  }

  return patterns
}

/**
 * Build a structured analysis prompt from issue metadata and event data.
 * Caps breadcrumbs at 20 and stack frames at 10 to stay within token budgets.
 */
function buildAnalysisPrompt(
  issue: Record<string, unknown>,
  breadcrumbs: SentryBreadcrumb[],
  exceptions: SentryExceptionValue[],
  tags: Array<{ key: string; value: string }>,
  contexts: Record<string, unknown>,
  environment?: string,
  release?: string
): string {
  const lines: string[] = []

  lines.push('## Sentry Issue')
  lines.push(`ID: ${issue.id ?? ''} | Short ID: ${issue.shortId ?? ''}`)
  lines.push(`Title: ${issue.title ?? ''}`)
  lines.push(`Level: ${issue.level ?? ''} | Platform: ${issue.platform ?? ''} | Status: ${issue.status ?? ''}`)
  lines.push(`Events: ${issue.count ?? '?'} | Users affected: ${issue.userCount ?? '?'}`)
  lines.push(`First seen: ${issue.firstSeen ?? '?'} | Last seen: ${issue.lastSeen ?? '?'}`)
  if (issue.culprit) lines.push(`Culprit: ${issue.culprit}`)
  if (environment) lines.push(`Environment: ${environment}`)
  if (release) lines.push(`Release: ${release}`)

  if (tags.length > 0) {
    lines.push('\n## Tags')
    for (const t of tags.slice(0, 20)) lines.push(`  ${t.key}: ${t.value}`)
  }

  if (exceptions.length > 0) {
    lines.push('\n## Exceptions')
    for (const ex of exceptions) {
      lines.push(`  ${ex.type ?? 'Exception'}: ${ex.value ?? ''}`)
      if (ex.module) lines.push(`    Module: ${ex.module}`)
      const frames = ex.stacktrace?.frames ?? []
      const inApp = frames.filter(f => f.inApp)
      const relevant = (inApp.length > 0 ? inApp : frames).slice(-10)
      if (relevant.length > 0) {
        lines.push(`    Stack (${relevant.length} frames):`)
        for (const f of relevant) {
          const loc = [f.module ?? f.filename, f.function].filter(Boolean).join('.')
          const lineInfo = f.lineNo != null ? `:${f.lineNo}` : ''
          lines.push(`      ${f.inApp ? '→' : ' '} ${loc}${lineInfo}`)
          if (f.contextLine?.trim()) lines.push(`         ${f.contextLine.trim()}`)
        }
      }
    }
  }

  const crumbs = breadcrumbs.slice(-20)
  if (crumbs.length > 0) {
    lines.push(`\n## Event Breadcrumbs (last ${crumbs.length})`)
    for (const c of crumbs) {
      const ts = c.timestamp ? c.timestamp.slice(11, 19) : '?'
      const cat = c.category ?? c.type ?? 'info'
      lines.push(`  [${ts}] ${cat}: ${c.message ?? ''}`)
    }
  }

  const ctxEntries = Object.entries(contexts)
  if (ctxEntries.length > 0) {
    lines.push('\n## Runtime Contexts')
    for (const [key, val] of ctxEntries.slice(0, 6)) {
      if (val && typeof val === 'object') {
        const kv = Object.entries(val as Record<string, unknown>)
          .slice(0, 6)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(', ')
        lines.push(`  ${key}: ${kv}`)
      }
    }
  }

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC handler registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerSentryHandlers(ipcMain: IpcMain): void {
  // ── test_sentry_connection ─────────────────────────────────────────────────

  ipcMain.handle('test_sentry_connection', async (_e, args: { baseUrl: string; authToken: string }) => {
    try {
      const { data } = await sentryFetch(args.baseUrl, args.authToken, '/api/0/projects/')
      const projects = data as SentryProject[]
      return {
        success: true,
        message: `Connected — ${projects.length} project(s)`,
        projects: projects.map(p => ({
          id: p.id, slug: p.slug, name: p.name, platform: p.platform,
          organization: { slug: p.organization.slug },
        })),
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('test_sentry_connection failed:', message)
      return { success: false, message, projects: null }
    }
  })

  // ── list_sentry_projects ───────────────────────────────────────────────────

  ipcMain.handle('list_sentry_projects', async (_e, args: { baseUrl: string; authToken: string }) => {
    try {
      const { data } = await sentryFetch(args.baseUrl, args.authToken, '/api/0/projects/')
      const projects = data as SentryProject[]
      return projects.map(p => ({
        id: p.id, slug: p.slug, name: p.name, platform: p.platform,
        organization: { slug: p.organization.slug },
      }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_sentry_projects failed:', message)
      throw new Error(message)
    }
  })

  // ── list_sentry_issues ─────────────────────────────────────────────────────

  ipcMain.handle('list_sentry_issues', async (_e, args: {
    baseUrl: string; authToken: string; org: string; project: string; query?: string; cursor?: string
  }) => {
    try {
      const org = validateSentrySlug(args.org, 'org')
      const project = validateSentrySlug(args.project, 'project')
      const params = new URLSearchParams({ limit: '25' })
      if (args.query) params.set('query', String(args.query).slice(0, 500))
      if (args.cursor) params.set('cursor', String(args.cursor).slice(0, 200))
      const path = `/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?${params.toString()}`
      const { data, nextCursor } = await sentryFetch(args.baseUrl, args.authToken, path)
      return { issues: data, next_cursor: nextCursor }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_sentry_issues failed:', message)
      throw new Error(message)
    }
  })

  // ── list_sentry_org_issues ─────────────────────────────────────────────────

  ipcMain.handle('list_sentry_org_issues', async (_e, args: {
    baseUrl: string; authToken: string; org: string; query?: string; cursor?: string
  }) => {
    try {
      const org = validateSentrySlug(args.org, 'org')
      const params = new URLSearchParams({ limit: '25' })
      if (args.query) params.set('query', String(args.query).slice(0, 500))
      if (args.cursor) params.set('cursor', String(args.cursor).slice(0, 200))
      const path = `/api/0/organizations/${encodeURIComponent(org)}/issues/?${params.toString()}`
      const { data, nextCursor } = await sentryFetch(args.baseUrl, args.authToken, path)
      return { issues: data, next_cursor: nextCursor }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_sentry_org_issues failed:', message)
      throw new Error(message)
    }
  })

  // ── fetch_sentry_issue ─────────────────────────────────────────────────────

  ipcMain.handle('fetch_sentry_issue', async (_e, args: { baseUrl: string; authToken: string; issueId: string }) => {
    try {
      const issueId = validateSentryId(args.issueId)
      const { data } = await sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${encodeURIComponent(issueId)}/`)
      return data
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('fetch_sentry_issue failed:', message)
      throw new Error(message)
    }
  })

  // ── fetch_sentry_latest_event ──────────────────────────────────────────────

  ipcMain.handle('fetch_sentry_latest_event', async (_e, args: { baseUrl: string; authToken: string; issueId: string }) => {
    try {
      const issueId = validateSentryId(args.issueId)
      const { data } = await sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${encodeURIComponent(issueId)}/events/latest/`)
      return data
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('fetch_sentry_latest_event failed:', message)
      throw new Error(message)
    }
  })

  // ── analyze_sentry_issue ───────────────────────────────────────────────────

  ipcMain.handle('analyze_sentry_issue', async (_e, args: {
    baseUrl: string
    authToken: string
    issueId: string
    apiKey?: string
    model?: string
    provider?: string
    keeperSecretUid?: string | null
  }) => {
    if (!aiRateLimiter.tryAcquire('ai')) {
      throw new Error('Rate limit exceeded: too many AI requests. Please wait a moment.')
    }

    const provider = args.provider ?? 'openai'
    const model = args.model ?? 'gpt-4o'
    let apiKey = args.apiKey ?? ''
    if (!apiKey) apiKey = getSecret(SERVICE_NAME, provider) ?? ''
    if (!apiKey && args.keeperSecretUid) apiKey = await getApiKeyFromKeeper(args.keeperSecretUid)
    if (!apiKey) throw new Error(`No API key configured for provider: ${provider}`)

    const issueId = validateSentryId(args.issueId)
    const { data: issueData } = await sentryFetch(
      args.baseUrl, args.authToken,
      `/api/0/issues/${encodeURIComponent(issueId)}/`
    )
    const issue = issueData as Record<string, unknown>

    // Fetch latest event + event stats in parallel (both best-effort)
    let latestEvent: Record<string, unknown> = {}
    let eventStats: Array<[number, number]> = []
    await Promise.allSettled([
      sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${encodeURIComponent(issueId)}/events/latest/`)
        .then(({ data }) => { latestEvent = data as Record<string, unknown> }),
      sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${encodeURIComponent(issueId)}/stats/?resolution=1d`)
        .then(({ data }) => { eventStats = data as Array<[number, number]> }),
    ])

    // Extract rich data from the event's typed entry list
    const { breadcrumbs, exceptions, contexts, eventTags, environment, release } =
      extractEventData(latestEvent)

    // Merge issue-level tags with event-level tags (dedup by key, event wins)
    const issueTags = (issue.tags as Array<{ key: string; value: string }> | undefined) ?? []
    const tagMap = new Map<string, string>()
    for (const t of issueTags) tagMap.set(t.key, t.value)
    for (const t of eventTags) tagMap.set(t.key, t.value)
    const mergedTags = Array.from(tagMap.entries()).map(([key, value]) => ({ key, value }))

    // Heuristic pattern detection before the AI call (deterministic, not hallucinated)
    const detectedPatterns = detectPatterns(exceptions, breadcrumbs)

    // Build the enriched AI prompt
    const userPrompt = buildAnalysisPrompt(
      issue, breadcrumbs, exceptions, mergedTags, contexts, environment, release
    )

    const start = Date.now()
    const result = await callAi({
      provider, model, apiKey,
      systemPrompt: SENTRY_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: `Analyze this Sentry issue:\n\n${userPrompt}`,
      maxTokens: 4096,
    })

    let parsed: Record<string, unknown>
    try {
      const jsonStr = result.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      parsed = {
        error_type: String(issue.title ?? 'Unknown').slice(0, 100),
        severity: 'MEDIUM',
        root_cause: result.content,
        plain_english: '',
        user_impact: '',
        breadcrumb_analysis: '',
        suggested_fixes: [],
        confidence: 'LOW',
        stack_trace: null,
      }
    }

    // Build the full_data envelope — keys match what parseSentryFullData() reads in sentryTypes.ts
    const fullData = {
      // Issue metadata
      sentry_issue_id:  issue.id,
      sentry_short_id:  issue.shortId,
      sentry_permalink: issue.permalink,
      sentry_level:     issue.level,
      sentry_status:    issue.status,
      sentry_platform:  issue.platform,
      sentry_count:     String(issue.count ?? ''),
      sentry_user_count: typeof issue.userCount === 'number' ? issue.userCount : null,
      sentry_first_seen: issue.firstSeen,
      sentry_last_seen:  issue.lastSeen,
      sentry_culprit:    issue.culprit,
      // Event data for UI tabs (breadcrumbs, exception chain, runtime context, tags)
      breadcrumbs: breadcrumbs.map(b => ({
        timestamp: b.timestamp,
        category:  b.category,
        message:   b.message,
        level:     b.level,
        data:      b.data,
        breadcrumb_type: b.type,
      })),
      exceptions: exceptions.map(ex => ({
        exception_type: ex.type,
        value:   ex.value,
        module:  ex.module,
        stacktrace: ex.stacktrace
          ? {
              frames: (ex.stacktrace.frames ?? []).map(f => ({
                filename:    f.filename,
                function:    f.function,
                lineNo:      f.lineNo,
                colNo:       f.colNo,
                contextLine: f.contextLine,
                preContext:  f.preContext,
                postContext: f.postContext,
                inApp:       f.inApp,
                module:      f.module,
              })),
            }
          : undefined,
      })),
      tags:     mergedTags,
      contexts: Object.keys(contexts).length > 0 ? contexts : null,
      // Event frequency stats (daily buckets: [[epoch_ms, count], ...])
      event_stats: eventStats,
      // Deterministic pattern detection results
      detected_patterns: detectedPatterns,
      // AI analysis — sub-keyed so parseSentryFullData maps it to aiResult
      ai_result: {
        error_type:           parsed.error_type,
        severity:             parsed.severity,
        component:            parsed.component,
        confidence:           parsed.confidence,
        pattern_type:         parsed.pattern_type,
        root_cause:           parsed.root_cause,
        plain_english:        parsed.plain_english,
        user_impact:          parsed.user_impact,
        breadcrumb_analysis:  parsed.breadcrumb_analysis,
        suggested_fixes:      Array.isArray(parsed.suggested_fixes) ? parsed.suggested_fixes : [],
        reproduction_steps:   Array.isArray(parsed.reproduction_steps) ? parsed.reproduction_steps : [],
        workaround:           parsed.workaround,
        fingerprint:          Array.isArray(parsed.fingerprint) ? parsed.fingerprint : [],
        monitoring_alerts:    Array.isArray(parsed.monitoring_alerts) ? parsed.monitoring_alerts : [],
        confidence_breakdown: parsed.confidence_breakdown ?? null,
        stack_trace:          parsed.stack_trace,
      },
    }

    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`
      INSERT INTO analyses (filename, file_size_kb, error_type, error_message, severity, component,
        stack_trace, root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
        tokens_used, cost, was_truncated, analysis_duration_ms, full_data, analysis_type, source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      `sentry_${issueId}`,
      0,
      (parsed.error_type as string) ?? String(issue.title ?? 'Unknown').slice(0, 100),
      // error_message carries the plain-English summary for list/preview views
      (parsed.plain_english as string) || (parsed.user_impact as string) || null,
      ((parsed.severity as string) ?? 'MEDIUM').toUpperCase(),
      (parsed.component as string) ?? (issue.culprit as string) ?? null,
      (parsed.stack_trace as string) ?? null,
      (parsed.root_cause as string) ?? '',
      JSON.stringify(Array.isArray(parsed.suggested_fixes) ? parsed.suggested_fixes : []),
      (parsed.confidence as string) ?? 'MEDIUM',
      now, model, provider,
      result.inputTokens + result.outputTokens,
      result.cost,
      0,
      Date.now() - start,
      JSON.stringify(fullData),
      'sentry',
      'sentry',
    )

    return {
      id: Number(row.lastInsertRowid),
      filename: `sentry_${issueId}`,
      error_type: (parsed.error_type as string) ?? 'Unknown',
      severity: ((parsed.severity as string) ?? 'medium').toLowerCase() as 'critical' | 'high' | 'medium' | 'low',
      root_cause: (parsed.root_cause as string) ?? '',
      suggested_fixes: (parsed.suggested_fixes as string[]) ?? [],
      analyzed_at: now,
      cost: result.cost,
    }
  })
}
