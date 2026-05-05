import { IpcMain } from 'electron'
import log from 'electron-log'
import { readJiraCreds, readConfluenceCreds } from '../services/jira-client'

async function fetchJiraTicket(baseUrl: string, email: string, apiToken: string, key: string): Promise<unknown> {
  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
  const fields = 'summary,description,status,priority,assignee,reporter,comment,created,updated,labels,components,issuetype'
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`
  const res = await fetch(url, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`JIRA error fetching ${key}: ${res.status}: ${body.substring(0, 200)}`)
  }
  return res.json()
}

function extractText(doc: unknown): string {
  if (!doc) return ''
  if (typeof doc === 'string') return doc
  const d = doc as { type?: string; text?: string; content?: unknown[] }
  if (d.type === 'text') return d.text ?? ''
  if (d.content) return d.content.map(extractText).join(' ')
  return ''
}

function buildDossier(key: string, issue: Record<string, unknown>, baseUrl: string, investigationType: string) {
  const fields = (issue.fields ?? {}) as Record<string, unknown>
  const comments = (fields.comment as { comments?: unknown[] })?.comments ?? []
  return {
    ticket_key: key,
    ticket_summary: (fields.summary as string) ?? key,
    ticket_url: `${baseUrl.replace(/\/$/, '')}/browse/${key}`,
    status: (fields.status as { name?: string })?.name ?? 'Unknown',
    assignee: (fields.assignee as { displayName?: string })?.displayName ?? null,
    claims: comments.slice(0, 5).map((c: unknown) => {
      const comment = c as { author?: { displayName?: string }; body?: unknown }
      return {
        text: extractText(comment.body),
        category: 'issue_comment' as const,
        entities: comment.author?.displayName ? [comment.author.displayName] : [],
      }
    }),
    related_issues: [],
    confluence_docs: [],
    hypotheses: [],
    open_questions: [],
    next_checks: [],
    attachments: [],
    warnings: [],
    investigation_type: investigationType as 'ticket' | 'regression_family' | 'expected_behavior' | 'customer_history',
    investigation_status: 'partial_failure' as const,
  }
}

export function registerInvestigationHandlers(ipcMain: IpcMain): void {
  const handlers: Array<[string, string]> = [
    ['investigate_jira_ticket', 'ticket'],
    ['investigate_jira_regression_family', 'regression_family'],
    ['investigate_jira_expected_behavior', 'expected_behavior'],
    ['investigate_jira_customer_history', 'customer_history'],
  ]

  // JIRA issue keys are uppercase letters / digits / hyphen-prefixed numbers
  // (e.g. WON-1234). Reject anything else early to avoid the renderer
  // crafting weird ticket keys that could surprise the JIRA backend or the
  // dossier builder downstream.
  const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/

  for (const [channel, investigationType] of handlers) {
    ipcMain.handle(channel, async (_e, args: { key: string; query?: string }) => {
      try {
        if (typeof args?.key !== 'string' || !JIRA_KEY_RE.test(args.key)) {
          throw new Error('Invalid JIRA ticket key')
        }
        const { baseUrl, email, apiToken } = readJiraCreds()
        const issue = await fetchJiraTicket(baseUrl, email, apiToken, args.key)
        if (typeof issue !== 'object' || issue === null) {
          throw new Error(`Unexpected response format from JIRA for ticket ${args.key}`)
        }
        return buildDossier(args.key, issue as Record<string, unknown>, baseUrl, investigationType)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn(`${channel} failed:`, message)
        throw new Error(message)
      }
    })
  }

  ipcMain.handle('search_confluence_docs', async (_e, args: {
    query: string
    spaceKey?: string | null
    limit?: number | null
  }) => {
    let creds: { baseUrl: string; email: string; apiToken: string }
    try { creds = readConfluenceCreds() } catch { return [] }

    const { default: fetch } = await import('node-fetch')
    const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')
    // Coerce limit to a bounded integer so a renderer cannot smuggle non-numeric
    // payloads (e.g. "10&extraParam=...") into the URL — defence in depth even
    // though the URL is otherwise built from constants and encodeURIComponent'd.
    const limit = Math.max(1, Math.min(50, Math.floor(Number(args.limit ?? 10) || 10)))

    const queryStr = typeof args.query === 'string' ? args.query : ''
    // Escape backslash first, then double-quote, so a crafted query like
    // `\"` cannot break out of the surrounding `text ~ "..."` CQL clause.
    const safeQuery = queryStr.replace(/\\/g, '\\\\').replace(/"/g, '\\"').substring(0, 200)
    const safeSpaceKey = typeof args.spaceKey === 'string'
      // Confluence space keys are alphanumeric — strip everything else so a
      // crafted value cannot escape the surrounding quotes or inject CQL.
      ? args.spaceKey.replace(/[^A-Za-z0-9_~-]/g, '').slice(0, 100)
      : ''
    const cql = safeSpaceKey
      ? `space = "${safeSpaceKey}" AND text ~ "${safeQuery}"`
      : `text ~ "${safeQuery}"`

    const url = `${creds.baseUrl.replace(/\/$/, '')}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=excerpt`

    try {
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
      if (!res.ok) {
        log.warn(`search_confluence_docs: ${res.status}`)
        return []
      }
      const data = await res.json() as {
        results?: Array<{
          id: string; title: string; excerpt?: string; _links?: { webui?: string }
          space?: { key?: string }
        }>
      }
      return (data.results ?? []).map(r => ({
        id: r.id,
        title: r.title,
        excerpt: r.excerpt ?? '',
        url: r._links?.webui
          ? `${creds.baseUrl.replace(/\/$/, '')}/wiki${r._links.webui}`
          : `${creds.baseUrl.replace(/\/$/, '')}/wiki/spaces/${r.space?.key ?? ''}/pages/${r.id}`,
        space_key: r.space?.key ?? null,
      }))
    } catch (err) {
      log.warn('search_confluence_docs error:', err)
      return []
    }
  })

  ipcMain.handle('get_confluence_page', async (_e, args: { contentId: string }) => {
    if (!args.contentId || !/^\d{1,19}$/.test(args.contentId)) {
      throw new Error('Invalid Confluence content ID')
    }

    let creds: { baseUrl: string; email: string; apiToken: string }
    try { creds = readConfluenceCreds() } catch (e) { throw e }

    const { default: fetch } = await import('node-fetch')
    const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')
    const url = `${creds.baseUrl.replace(/\/$/, '')}/wiki/rest/api/content/${args.contentId}?expand=body.view,space`

    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Confluence error ${res.status}: ${body.substring(0, 200)}`)
    }
    const data = await res.json() as {
      id: string; title: string
      body?: { view?: { value?: string } }
      _links?: { webui?: string }
      space?: { key?: string }
    }

    const rawHtml = data.body?.view?.value ?? ''
    const excerpt = rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1000)

    return {
      id: data.id,
      title: data.title,
      excerpt,
      url: data._links?.webui
        ? `${creds.baseUrl.replace(/\/$/, '')}/wiki${data._links.webui}`
        : `${creds.baseUrl.replace(/\/$/, '')}/wiki/pages/${data.id}`,
      space_key: data.space?.key ?? null,
    }
  })
}
