import Store from 'electron-store'
import { getSecret } from './safe-storage'

const SERVICE_NAME = 'hadron-electron'
const settingsStore = new Store({ name: 'settings' })

export { SERVICE_NAME }

export function readJiraCreds(): { baseUrl: string; email: string; apiToken: string } {
  const baseUrl = settingsStore.get('jira_base_url', '') as string
  const email = settingsStore.get('jira_email', '') as string
  const apiToken = getSecret(SERVICE_NAME, 'jira') ?? ''
  if (!baseUrl || !email || !apiToken) {
    throw new Error('JIRA not configured. Please set up JIRA credentials in Settings.')
  }
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:') throw new Error('JIRA base URL must use https://')
  } catch (e) {
    if ((e as Error).message.includes('Invalid URL')) throw new Error('JIRA base URL is not a valid URL')
    throw e
  }
  return { baseUrl, email, apiToken }
}

export function readJiraProjectKey(): string {
  return (settingsStore.get('jira_project_key', '') as string) || ''
}

export async function jiraFetch(
  baseUrl: string,
  email: string,
  apiToken: string,
  path: string,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  } as Parameters<typeof fetch>[1])
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`JIRA API error ${res.status}: ${body.substring(0, 200)}`)
  }
  return res.json()
}
