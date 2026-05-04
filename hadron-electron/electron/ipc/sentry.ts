import { IpcMain } from 'electron'
import log from 'electron-log'

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
}
