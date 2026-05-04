import { IpcMain } from 'electron'
import Store from 'electron-store'
import log from 'electron-log'

const settingsStore = new Store({ name: 'settings' })

function readJiraCreds(): { baseUrl: string; email: string; apiToken: string } {
  const baseUrl = settingsStore.get('jira_base_url', '') as string
  const email = settingsStore.get('jira_email', '') as string
  const apiToken = settingsStore.get('jira_api_key', '') as string
  if (!baseUrl || !email || !apiToken) throw new Error('JIRA not configured')
  // https-only validation
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:') throw new Error('JIRA base URL must use https://')
  } catch (e) {
    if ((e as Error).message.includes('Invalid URL')) throw new Error('JIRA base URL is not a valid URL')
    throw e
  }
  return { baseUrl, email, apiToken }
}

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

function buildDossier(key: string, issue: Record<string, unknown>, investigationType: string) {
  const fields = (issue.fields ?? {}) as Record<string, unknown>
  const comments = (fields.comment as { comments?: unknown[] })?.comments ?? []
  return {
    ticket_key: key,
    investigation_type: investigationType,
    summary: (fields.summary as string) ?? key,
    description: extractText(fields.description),
    status: (fields.status as { name?: string })?.name ?? 'Unknown',
    priority: (fields.priority as { name?: string })?.name ?? 'Unknown',
    assignee: (fields.assignee as { displayName?: string })?.displayName ?? null,
    comments: comments.map((c: unknown) => {
      const comment = c as { author?: { displayName?: string }; body?: unknown; created?: string }
      return {
        author: comment.author?.displayName ?? 'Unknown',
        body: extractText(comment.body),
        created: comment.created ?? '',
      }
    }),
    jira_links: [],
    confluence_pages: [],
    related_tickets: [],
    note: 'Investigation via Electron uses direct JIRA data only. Confluence + deep analysis available in Tauri build.',
  }
}

export function registerInvestigationHandlers(ipcMain: IpcMain): void {
  const handlers: Array<[string, string]> = [
    ['investigate_jira_ticket', 'ticket'],
    ['investigate_jira_regression_family', 'regression_family'],
    ['investigate_expected_behavior', 'expected_behavior'],
    ['investigate_customer_history', 'customer_history'],
  ]

  for (const [channel, investigationType] of handlers) {
    ipcMain.handle(channel, async (_e, args: { key: string }) => {
      try {
        const { baseUrl, email, apiToken } = readJiraCreds()
        const issue = await fetchJiraTicket(baseUrl, email, apiToken, args.key)
        if (typeof issue !== 'object' || issue === null) {
          throw new Error(`Unexpected response format from JIRA for ticket ${args.key}`)
        }
        return buildDossier(args.key, issue as Record<string, unknown>, investigationType)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn(`${channel} failed:`, message)
        throw new Error(message)
      }
    })
  }

  // Confluence stubs — not available in Electron
  ipcMain.handle('search_confluence', () => ({
    results: [],
    note: 'Confluence search not available in Electron build',
  }))

  ipcMain.handle('get_confluence_content', () => ({
    content: null,
    note: 'Confluence content not available in Electron build',
  }))
}
