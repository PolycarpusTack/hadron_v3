import { IpcMain } from 'electron'
import log from 'electron-log'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'
import { getSecret } from '../services/safe-storage'
import { SERVICE_NAME } from '../services/jira-client'

const SENTRY_CRASH_SYSTEM_PROMPT = `You are an expert software engineer specializing in crash log analysis.
Analyze the provided Sentry issue and return a JSON response with this exact structure:
{
  "error_type": "string",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "component": "string",
  "root_cause": "string",
  "suggested_fixes": ["fix1", "fix2"],
  "confidence": "HIGH|MEDIUM|LOW",
  "stack_trace": "string"
}
Return only valid JSON, no markdown fences.`

interface SentryProject {
  id: string
  slug: string
  name: string
  platform: string | null
  organization: { slug: string }
}

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

async function sentryFetch(baseUrl: string, authToken: string, path: string): Promise<{ data: unknown; nextCursor: string | null }> {
  // Validate baseUrl before sending credentials
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:') {
      throw new Error('Sentry base URL must use https://')
    }
  } catch (e) {
    if ((e as Error).message.includes('Invalid URL')) {
      throw new Error('Sentry base URL is not a valid URL')
    }
    throw e
  }
  const { default: fetch } = await import('node-fetch')
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Accept': 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Sentry API error ${res.status}: ${body.substring(0, 200)}`)
  }
  const nextCursor = parseNextCursor(res.headers.get('Link'))
  return { data: await res.json(), nextCursor }
}

export function registerSentryHandlers(ipcMain: IpcMain): void {
  // ──────────────────────────────────────────────────────────────────────────
  // test_sentry_connection — returns success/failure, never throws
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle('test_sentry_connection', async (_e, args: { baseUrl: string; authToken: string }) => {
    try {
      const { data } = await sentryFetch(args.baseUrl, args.authToken, '/api/0/projects/')
      const projects = data as SentryProject[]
      return {
        success: true,
        message: `Connected — ${projects.length} project(s)`,
        projects: projects.map(p => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          platform: p.platform,
          organization: { slug: p.organization.slug },
        })),
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('test_sentry_connection failed:', message)
      return { success: false, message, projects: null }
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // list_sentry_projects
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle('list_sentry_projects', async (_e, args: { baseUrl: string; authToken: string }) => {
    try {
      const { data } = await sentryFetch(args.baseUrl, args.authToken, '/api/0/projects/')
      const projects = data as SentryProject[]
      return projects.map(p => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        platform: p.platform,
        organization: { slug: p.organization.slug },
      }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_sentry_projects failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // list_sentry_issues — paginated project-scoped issues
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle('list_sentry_issues', async (_e, args: {
    baseUrl: string
    authToken: string
    org: string
    project: string
    query?: string
    cursor?: string
  }) => {
    try {
      const limit = 25
      const params = new URLSearchParams({ limit: String(limit) })
      if (args.query) params.set('query', args.query)
      if (args.cursor) params.set('cursor', args.cursor)
      const path = `/api/0/projects/${encodeURIComponent(args.org)}/${encodeURIComponent(args.project)}/issues/?${params.toString()}`
      const { data, nextCursor } = await sentryFetch(args.baseUrl, args.authToken, path)
      return { issues: data, next_cursor: nextCursor }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_sentry_issues failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // list_sentry_org_issues — paginated org-scoped issues
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle('list_sentry_org_issues', async (_e, args: {
    baseUrl: string
    authToken: string
    org: string
    query?: string
    cursor?: string
  }) => {
    try {
      const limit = 25
      const params = new URLSearchParams({ limit: String(limit) })
      if (args.query) params.set('query', args.query)
      if (args.cursor) params.set('cursor', args.cursor)
      const path = `/api/0/organizations/${encodeURIComponent(args.org)}/issues/?${params.toString()}`
      const { data, nextCursor } = await sentryFetch(args.baseUrl, args.authToken, path)
      return { issues: data, next_cursor: nextCursor }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('list_sentry_org_issues failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // fetch_sentry_issue
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle('fetch_sentry_issue', async (_e, args: { baseUrl: string; authToken: string; issueId: string }) => {
    try {
      const { data } = await sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${encodeURIComponent(args.issueId)}/`)
      return data
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('fetch_sentry_issue failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // fetch_sentry_latest_event
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle('fetch_sentry_latest_event', async (_e, args: { baseUrl: string; authToken: string; issueId: string }) => {
    try {
      const { data } = await sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${encodeURIComponent(args.issueId)}/events/latest/`)
      return data
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('fetch_sentry_latest_event failed:', message)
      throw new Error(message)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // analyze_sentry_issue — fetch issue then analyze with AI
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('analyze_sentry_issue', async (_e, args: {
    baseUrl: string
    authToken: string
    issueId: string
    apiKey?: string
    model?: string
    provider?: string
  }) => {
    const provider = args.provider ?? 'openai'
    const model = args.model ?? 'gpt-4o'
    let apiKey = args.apiKey ?? ''
    if (!apiKey) apiKey = getSecret(SERVICE_NAME, provider) ?? ''
    if (!apiKey) throw new Error(`No API key configured for provider: ${provider}`)

    const { data: issueData } = await sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${encodeURIComponent(args.issueId)}/`)
    const issue = issueData as Record<string, unknown>

    let latestEvent: Record<string, unknown> = {}
    try {
      const { data } = await sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${encodeURIComponent(args.issueId)}/events/latest/`)
      latestEvent = data as Record<string, unknown>
    } catch {
      // latest event is best-effort
    }

    const userPrompt = [
      `Sentry Issue: ${issue.id ?? args.issueId}`,
      `Title: ${issue.title ?? ''}`,
      `Level: ${issue.level ?? ''}`,
      `Culprit: ${issue.culprit ?? ''}`,
      `Platform: ${issue.platform ?? ''}`,
      `Count: ${issue.count ?? ''} occurrences`,
      latestEvent.message ? `Message: ${latestEvent.message}` : '',
    ].filter(Boolean).join('\n')

    const start = Date.now()
    const result = await callAi({
      provider, model, apiKey,
      systemPrompt: SENTRY_CRASH_SYSTEM_PROMPT,
      userPrompt: `Analyze this Sentry issue:\n\n${userPrompt}`,
      maxTokens: 4096,
    })

    let parsed: Record<string, unknown>
    try {
      const jsonStr = result.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      parsed = { error_type: 'Unknown', severity: 'MEDIUM', root_cause: result.content, suggested_fixes: [], confidence: 'LOW', stack_trace: null }
    }

    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`
      INSERT INTO analyses (filename, file_size_kb, error_type, error_message, severity, component,
        stack_trace, root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
        tokens_used, cost, was_truncated, analysis_duration_ms, full_data, analysis_type, source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      `sentry_${args.issueId}`, 0,
      (parsed.error_type as string) ?? 'Unknown',
      null,
      ((parsed.severity as string) ?? 'MEDIUM').toUpperCase(),
      (parsed.component as string) ?? null,
      (parsed.stack_trace as string) ?? null,
      (parsed.root_cause as string) ?? '',
      JSON.stringify(parsed.suggested_fixes ?? []),
      (parsed.confidence as string) ?? 'MEDIUM',
      now, model, provider,
      result.inputTokens + result.outputTokens,
      result.cost, 0,
      Date.now() - start,
      JSON.stringify(parsed),
      'sentry', 'sentry',
    )

    return {
      id: Number(row.lastInsertRowid),
      filename: `sentry_${args.issueId}`,
      error_type: (parsed.error_type as string) ?? 'Unknown',
      severity: ((parsed.severity as string) ?? 'medium').toLowerCase() as 'critical' | 'high' | 'medium' | 'low',
      root_cause: (parsed.root_cause as string) ?? '',
      suggested_fixes: (parsed.suggested_fixes as string[]) ?? [],
      analyzed_at: now,
      cost: result.cost,
    }
  })
}
