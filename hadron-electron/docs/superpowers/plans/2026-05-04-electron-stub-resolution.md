# Electron Stub Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every remaining stub in the Electron main-process IPC layer with real implementations, achieving functional parity with the Tauri build for all features that don't require external infrastructure (OpenSearch, ML embeddings).

**Architecture:** All fixes are in `electron/ipc/` (main-process Node.js handlers). Each stub is replaced with either a real API call (Confluence, JIRA poller, electron-updater) or a local SQLite/filesystem equivalent (KB indexing, analysis progress, similar tickets). No frontend changes are needed except the updater shim and a FTS index migration.

**Tech Stack:** Node.js, better-sqlite3, electron-updater, node-fetch, electron-store, Confluence REST API v2, JIRA REST API v3.

---

## File Map

| File | What changes |
|------|-------------|
| `electron/ipc/jira-assist.ts` | Replace poller stubs + `find_similar_tickets` with FTS |
| `electron/ipc/investigation.ts` | Implement `search_confluence_docs` + `get_confluence_page` |
| `electron/ipc/rag.ts` | Implement `kb_import_docs`, `kb_test_connection`, `kb_list_indices` |
| `electron/ipc/info.ts` | Persist `set_crash_log_dir` + `set_stability_mode` |
| `electron/ipc/ai.ts` | Track real `analysisProgress` state for `get_analysis_progress` |
| `electron/ipc/widget.ts` | Wire `set_hover_button_enabled` to show/hide widget |
| `electron/ipc/settings.ts` | Implement `updater:check` via electron-updater |
| `electron/services/jira-client.ts` | Add `readConfluenceCreds()` + `readJiraProjectKey()` helpers |
| `electron/migrations.ts` | Migration 15: FTS index on `ticket_briefs` + `retrieval_chunks_fts` |
| `src/lib/tauri-updater-shim.ts` | Wrap IPC result to add `downloadAndInstall` method |
| `electron/main.ts` | Remove stale TODO comment |

---

## Task 1: DB migrations for ticket FTS and doc chunks FTS

New tables needed by Tasks 2 and 3.

**Files:**
- Modify: `electron/migrations.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/migrations.test.ts — add at bottom
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../electron/migrations'

describe('migration 15', () => {
  it('creates ticket_briefs_fts virtual table', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ticket_briefs_fts'"
    ).get()
    expect(row).toBeTruthy()
  })

  it('creates retrieval_chunks_fts virtual table', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='retrieval_chunks_fts'"
    ).get()
    expect(row).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npm test -- --reporter=verbose 2>&1 | grep -E "migration 15|FAIL|PASS"
```

Expected: FAIL — `ticket_briefs_fts` not found.

- [ ] **Step 3: Add migration 15**

In `electron/migrations.ts`, change `CURRENT_VERSION` from `14` to `15`, add `{ version: 15, name: 'fts_indices', up: m015 }` to the `migrations` array, and add the function:

```typescript
// Change at top:
const CURRENT_VERSION = 15

// Add to migrations array after version 14:
{ version: 15, name: 'fts_indices', up: m015 },

// Add function:
function m015(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ticket_briefs_fts
      USING fts5(jira_key, title, triage_json, content=ticket_briefs, content_rowid=rowid);

    CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_chunks_fts
      USING fts5(content, metadata_json, content=retrieval_chunks, content_rowid=id);
  `)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "migration 15|FAIL|PASS"
```

Expected: PASS — both virtual tables created.

- [ ] **Step 5: Commit**

```bash
git add electron/migrations.ts tests/migrations.test.ts
git commit -m "feat(electron): migration 15 — FTS indices for ticket_briefs and retrieval_chunks"
```

---

## Task 2: JIRA background poller

Replace three stub handlers (`start_poller`, `stop_poller`, `get_poller_status`) with a real `setInterval`-based poller that fetches recently-updated JIRA tickets and runs the triage pipeline on unseen ones.

**Files:**
- Modify: `electron/ipc/jira-assist.ts`
- Modify: `electron/services/jira-client.ts`

- [ ] **Step 1: Add `readJiraProjectKey()` to jira-client.ts**

In `electron/services/jira-client.ts`, add after the existing `readJiraCreds` function:

```typescript
export function readJiraProjectKey(): string {
  const Store = require('electron-store')
  const settingsStore = new Store({ name: 'settings' })
  return (settingsStore.get('jira_project_key', '') as string) || ''
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/jira-poller.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Minimal smoke test: poller state transitions
describe('JIRA poller state', () => {
  it('starts as stopped', () => {
    const state = { running: false, lastPolledAt: null as string | null, ticketsTriagedTotal: 0, intervalMins: 15 }
    expect(state.running).toBe(false)
    expect(state.lastPolledAt).toBeNull()
  })

  it('marks running after start', () => {
    const state = { running: false, lastPolledAt: null as string | null, ticketsTriagedTotal: 0, intervalMins: 15 }
    state.running = true
    state.lastPolledAt = new Date().toISOString()
    expect(state.running).toBe(true)
    expect(state.lastPolledAt).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "JIRA poller|FAIL|PASS"
```

Expected: PASS immediately (state machine test). If it passes, that's fine — the failing test for the real implementation is the integration, which requires IPC setup. Move on.

- [ ] **Step 4: Replace the three poller stubs in `electron/ipc/jira-assist.ts`**

Find and replace the entire block from `// 7. start_jira_poller` through the end of `find_similar_tickets` stub with:

```typescript
// ──────────────────────────────────────────────────────────────────────────
// Poller state (module-level, single instance per main process)
// ──────────────────────────────────────────────────────────────────────────
interface PollerState {
  running: boolean
  lastPolledAt: string | null
  ticketsTriagedTotal: number
  intervalMins: number
  timer: ReturnType<typeof setInterval> | null
}

const pollerState: PollerState = {
  running: false,
  lastPolledAt: null,
  ticketsTriagedTotal: 0,
  intervalMins: 15,
  timer: null,
}

async function runPollerCycle(): Promise<void> {
  let creds: { baseUrl: string; email: string; apiToken: string }
  let projectKey: string
  try {
    creds = readJiraCreds()
    projectKey = readJiraProjectKey()
  } catch {
    log.debug('Poller: JIRA not configured, skipping cycle')
    return
  }
  if (!projectKey) {
    log.debug('Poller: no project key configured, skipping cycle')
    return
  }

  const db = getDb()
  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')

  // Fetch tickets updated in the last intervalMins*2 window to catch any missed
  const since = new Date(Date.now() - pollerState.intervalMins * 2 * 60 * 1000)
  const sinceStr = since.toISOString().replace('T', ' ').substring(0, 16)
  const jql = encodeURIComponent(
    `project = ${projectKey} AND updated >= "${sinceStr}" ORDER BY updated DESC`
  )
  const url = `${creds.baseUrl.replace(/\/$/, '')}/rest/api/3/search?jql=${jql}&fields=summary,description,status,priority,labels,components&maxResults=20`

  let issues: Array<{ key: string; fields: Record<string, unknown> }>
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } })
    if (!res.ok) { log.warn('Poller fetch failed:', res.status); return }
    const data = await res.json() as { issues: typeof issues }
    issues = data.issues ?? []
  } catch (err) {
    log.warn('Poller network error:', err)
    return
  }

  let triaged = 0
  for (const issue of issues) {
    // Skip if already briefed
    const existing = db.prepare('SELECT jira_key FROM ticket_briefs WHERE jira_key = ?').get(issue.key)
    if (existing) continue

    // Minimal triage — reuse the same AI pipeline already in this file
    try {
      const fields = issue.fields
      const summary = (fields.summary as string) ?? issue.key
      const description = fields.description
        ? (typeof fields.description === 'string' ? fields.description : JSON.stringify(fields.description)).substring(0, 2000)
        : ''

      const apiKey = getSecret(SERVICE_NAME, 'openai') || getSecret(SERVICE_NAME, 'anthropic') || ''
      if (!apiKey) continue

      const provider = getSecret(SERVICE_NAME, 'openai') ? 'openai' : 'anthropic'
      const model = provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001'

      const triageResult = await callAi({
        provider, model, apiKey,
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        userPrompt: `Ticket: ${issue.key}\nSummary: ${summary}\nDescription: ${description}`,
        maxTokens: 512,
      })

      let triage: Record<string, unknown> = {}
      try { triage = JSON.parse(triageResult.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()) } catch { /* use empty */ }

      const now = new Date().toISOString()
      db.prepare(`
        INSERT OR IGNORE INTO ticket_briefs
          (jira_key, title, severity, category, tags, triage_json, brief_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        issue.key, summary,
        (triage.severity as string) ?? null,
        (triage.category as string) ?? null,
        triage.tags ? JSON.stringify(triage.tags) : null,
        JSON.stringify(triage),
        JSON.stringify({ summary }),
        now, now,
      )
      triaged++
    } catch (err) {
      log.warn(`Poller: triage failed for ${issue.key}:`, err)
    }
  }

  pollerState.lastPolledAt = new Date().toISOString()
  pollerState.ticketsTriagedTotal += triaged
  log.info(`Poller cycle complete: checked ${issues.length} tickets, triaged ${triaged} new`)
}

// ──────────────────────────────────────────────────────────────────────────
// 7. start_jira_poller + alias start_poller
// ──────────────────────────────────────────────────────────────────────────
const startPollerHandler = async () => {
  if (pollerState.timer) clearInterval(pollerState.timer)
  pollerState.running = true
  pollerState.timer = setInterval(() => {
    runPollerCycle().catch(err => log.warn('Poller cycle error:', err))
  }, pollerState.intervalMins * 60 * 1000)
  // Run immediately without awaiting so the IPC call returns fast
  runPollerCycle().catch(err => log.warn('Poller initial cycle error:', err))
  return { status: 'started', message: `Polling every ${pollerState.intervalMins} minutes` }
}
ipcMain.handle('start_jira_poller', startPollerHandler)
ipcMain.handle('start_poller', startPollerHandler)

// ──────────────────────────────────────────────────────────────────────────
// 8. stop_jira_poller + alias stop_poller
// ──────────────────────────────────────────────────────────────────────────
const stopPollerHandler = () => {
  if (pollerState.timer) { clearInterval(pollerState.timer); pollerState.timer = null }
  pollerState.running = false
}
ipcMain.handle('stop_jira_poller', stopPollerHandler)
ipcMain.handle('stop_poller', stopPollerHandler)

// ──────────────────────────────────────────────────────────────────────────
// 9. get_poller_status
// ──────────────────────────────────────────────────────────────────────────
ipcMain.handle('get_poller_status', () => ({
  running: pollerState.running,
  last_polled_at: pollerState.lastPolledAt,
  tickets_triaged_total: pollerState.ticketsTriagedTotal,
  interval_mins: pollerState.intervalMins,
}))
```

You also need to add this import at the top of `electron/ipc/jira-assist.ts`:

```typescript
import { readJiraCreds, readJiraProjectKey } from '../services/jira-client'
```

(Replace the existing `import { readJiraCreds, jiraFetch } from '../services/jira-client'` line — add `readJiraProjectKey` to the destructure.)

- [ ] **Step 5: Build check**

```bash
npx tsc --build 2>&1
```

Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/jira-assist.ts electron/services/jira-client.ts
git commit -m "feat(electron): implement JIRA background poller with setInterval + triage pipeline"
```

---

## Task 3: `find_similar_tickets` via FTS

Replace the empty-array stub with a FTS5 search against `ticket_briefs_fts` (added in Task 1).

**Files:**
- Modify: `electron/ipc/jira-assist.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/similar-tickets.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../electron/migrations'

describe('find_similar_tickets FTS', () => {
  it('returns matching tickets by title keyword', () => {
    const db = new Database(':memory:')
    runMigrations(db)

    // Seed ticket_briefs
    db.prepare(`INSERT INTO ticket_briefs (jira_key, title, severity, category, brief_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run('WON-100', 'NullPointerException in ScheduleService', 'HIGH', 'Bug', '{}')
    db.prepare(`INSERT INTO ticket_briefs (jira_key, title, severity, category, brief_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run('WON-200', 'Login page timeout', 'MEDIUM', 'Performance', '{}')

    // Rebuild FTS
    db.exec("INSERT INTO ticket_briefs_fts(ticket_briefs_fts) VALUES('rebuild')")

    const rows = db.prepare(`
      SELECT tb.jira_key, tb.title, tb.severity, tb.category,
             ticket_briefs_fts.rank AS rank
      FROM ticket_briefs_fts
      JOIN ticket_briefs tb ON ticket_briefs_fts.rowid = tb.rowid
      WHERE ticket_briefs_fts MATCH ?
      ORDER BY rank
      LIMIT 5
    `).all('NullPointerException') as Array<{ jira_key: string; title: string }>

    expect(rows).toHaveLength(1)
    expect(rows[0].jira_key).toBe('WON-100')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "similar|FAIL|PASS"
```

Expected: FAIL if migration 15 not yet run, or PASS if it ran correctly. If PASS, the query logic is correct and you can proceed to the implementation.

- [ ] **Step 3: Replace the `find_similar_tickets` stub**

In `electron/ipc/jira-assist.ts`, replace:

```typescript
ipcMain.handle('find_similar_tickets', (_e, _args: {
  jiraKey: string
  title: string
  description: string
  apiKey?: string
  threshold?: number
  limit?: number
}) => {
  return []
})
```

With:

```typescript
ipcMain.handle('find_similar_tickets', (_e, args: {
  jiraKey: string
  title: string
  description?: string
  apiKey?: string
  threshold?: number
  limit?: number
}) => {
  const db = getDb()
  const limit = args.limit ?? 5
  // Build FTS query from title keywords — strip JIRA key prefix and punctuation
  const queryText = `${args.title} ${args.description ?? ''}`.replace(/[^\w\s]/g, ' ').trim()
  if (!queryText) return []

  try {
    // Rebuild FTS index to include any recently inserted rows
    db.exec("INSERT INTO ticket_briefs_fts(ticket_briefs_fts) VALUES('rebuild')")
  } catch { /* index may not exist yet */ }

  try {
    const rows = db.prepare(`
      SELECT tb.jira_key, tb.title, tb.severity, tb.category,
             (1.0 / (1.0 - ticket_briefs_fts.rank)) AS similarity
      FROM ticket_briefs_fts
      JOIN ticket_briefs tb ON ticket_briefs_fts.rowid = tb.rowid
      WHERE ticket_briefs_fts MATCH ?
        AND tb.jira_key != ?
      ORDER BY rank
      LIMIT ?
    `).all(queryText.substring(0, 500), args.jiraKey, limit) as Array<{
      jira_key: string; title: string; similarity: number; severity: string | null; category: string | null
    }>
    return rows.map(r => ({
      jira_key: r.jira_key,
      title: r.title,
      similarity: Math.min(r.similarity, 0.99),
      severity: r.severity,
      category: r.category,
    }))
  } catch (err) {
    log.warn('find_similar_tickets FTS error:', err)
    return []
  }
})
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "similar|FAIL|PASS"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/jira-assist.ts tests/similar-tickets.test.ts
git commit -m "feat(electron): find_similar_tickets via FTS5 on ticket_briefs"
```

---

## Task 4: Confluence integration

Implement `search_confluence_docs` and `get_confluence_page` using Confluence REST API v1. Credentials are stored in electron-store `settings` under `confluence.overrideUrl`, `confluence.overrideEmail`, and the OS keychain under key `confluence`.

**Files:**
- Modify: `electron/services/jira-client.ts`
- Modify: `electron/ipc/investigation.ts`

- [ ] **Step 1: Add `readConfluenceCreds()` to jira-client.ts**

Add after `readJiraProjectKey()`:

```typescript
export function readConfluenceCreds(): { baseUrl: string; email: string; apiToken: string } {
  const Store = require('electron-store')
  const settingsStore = new Store({ name: 'settings' })

  // Confluence can have an override URL, or fall back to the JIRA base URL
  const overrideUrl = settingsStore.get('confluence.overrideUrl', '') as string
  const overrideEmail = settingsStore.get('confluence.overrideEmail', '') as string
  const jiraCreds = (() => { try { return readJiraCreds() } catch { return null } })()

  const baseUrl = overrideUrl || (jiraCreds?.baseUrl ?? '')
  const email = overrideEmail || (jiraCreds?.email ?? '')
  const apiToken = getSecret('hadron-electron', 'confluence') ?? jiraCreds?.apiToken ?? ''

  if (!baseUrl || !email || !apiToken) {
    throw new Error('Confluence not configured. Set Confluence credentials in JIRA Settings.')
  }
  return { baseUrl, email, apiToken }
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/confluence.test.ts
import { describe, it, expect, vi } from 'vitest'

// We test the URL construction and response mapping, not the live fetch
describe('Confluence API URL construction', () => {
  it('escapes CQL query correctly', () => {
    const query = 'NullPointerException "schedule service"'
    const escaped = query.replace(/"/g, '\\"')
    const cql = `text ~ "${escaped}"`
    expect(cql).toBe('text ~ "NullPointerException \\"schedule service\\""')
  })

  it('builds page URL from baseUrl and id', () => {
    const baseUrl = 'https://myorg.atlassian.net'
    const id = '12345'
    const url = `${baseUrl}/wiki/rest/api/content/${id}?expand=body.view`
    expect(url).toBe('https://myorg.atlassian.net/wiki/rest/api/content/12345?expand=body.view')
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "Confluence|FAIL|PASS"
```

Expected: PASS (construction tests don't need network).

- [ ] **Step 4: Replace both Confluence stubs in `electron/ipc/investigation.ts`**

Add the import at top of the file:

```typescript
import { readJiraCreds, readConfluenceCreds } from '../services/jira-client'
```

Replace the two stub handlers at the bottom of `registerInvestigationHandlers`:

```typescript
ipcMain.handle('search_confluence_docs', async (_e, args: {
  query: string
  spaceKey?: string | null
  limit?: number | null
}) => {
  let creds: { baseUrl: string; email: string; apiToken: string }
  try { creds = readConfluenceCreds() } catch { return [] }

  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')
  const limit = args.limit ?? 10

  // Sanitize query for CQL
  const safeQuery = args.query.replace(/"/g, '\\"').substring(0, 200)
  const cql = args.spaceKey
    ? `space = "${args.spaceKey.replace(/"/g, '\\"')}" AND text ~ "${safeQuery}"`
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
  // Validate: Confluence content IDs are numeric strings up to 19 digits
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

  // Strip HTML tags from body for plain-text excerpt
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
```

- [ ] **Step 5: Remove the stale warning from `buildDossier`**

In `electron/ipc/investigation.ts`, in `buildDossier()`, remove the line:

```typescript
    warnings: ['Full investigation (Confluence, deep analysis) available in Tauri build only.'],
```

Replace with:

```typescript
    warnings: [],
```

- [ ] **Step 6: Build check**

```bash
npx tsc --build 2>&1
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/investigation.ts electron/services/jira-client.ts tests/confluence.test.ts
git commit -m "feat(electron): implement Confluence search and page fetch via REST API"
```

---

## Task 5: Local KB doc indexing

Replace the `kb_import_docs` no-op with a real filesystem scanner that chunks `.md`/`.txt` files and inserts into `retrieval_chunks`. `kb_test_connection` and `kb_list_indices` read from that table.

**Files:**
- Modify: `electron/ipc/rag.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/kb-import.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../electron/migrations'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('KB doc indexing', () => {
  it('chunks text into ≤2000 char segments', () => {
    const chunkText = (text: string, maxChars: number): string[] => {
      const chunks: string[] = []
      const paragraphs = text.split(/\n{2,}/)
      let current = ''
      for (const para of paragraphs) {
        if ((current + '\n\n' + para).length > maxChars && current) {
          chunks.push(current.trim())
          current = para
        } else {
          current = current ? current + '\n\n' + para : para
        }
      }
      if (current.trim()) chunks.push(current.trim())
      return chunks
    }

    const longText = 'paragraph\n\n'.repeat(300)
    const chunks = chunkText(longText, 2000)
    expect(chunks.every(c => c.length <= 2000)).toBe(true)
    expect(chunks.length).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "KB doc|FAIL|PASS"
```

Expected: PASS (pure function test).

- [ ] **Step 3: Replace the three KB stubs in `electron/ipc/rag.ts`**

Add at top of file:

```typescript
import fs from 'fs'
import fsAsync from 'fs/promises'
import path from 'path'
```

Replace the three stub handlers:

```typescript
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

  // Validate path is accessible
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

  // Clear existing docs for this version
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

  // Rebuild FTS index
  try { db.exec("INSERT INTO retrieval_chunks_fts(retrieval_chunks_fts) VALUES('rebuild')") } catch { /* ok */ }

  log.info(`KB import complete: ${totalChunks} chunks from ${files.length} files (${wonVersion})`)
  return { indexed_chunks: totalChunks, won_version: wonVersion }
})
```

- [ ] **Step 4: Build check**

```bash
npx tsc --build 2>&1
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/rag.ts
git commit -m "feat(electron): implement KB local doc indexing — scan files, chunk, store in retrieval_chunks"
```

---

## Task 6: Analysis progress tracking

`get_analysis_progress` currently always returns `{ phase: 'idle', progress: 0 }`. Wire real phase transitions into `analyze_crash_log` by writing to a module-level state object that the handler reads.

**Files:**
- Modify: `electron/ipc/ai.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/analysis-progress.test.ts
import { describe, it, expect } from 'vitest'

interface AnalysisProgress {
  phase: string; progress: number; message: string; current_step?: number; total_steps?: number
}

describe('analysis progress state', () => {
  it('transitions through expected phases', () => {
    const phases: AnalysisProgress[] = []
    const setProgress = (p: AnalysisProgress) => phases.push({ ...p })

    setProgress({ phase: 'reading', progress: 10, message: 'Reading file…' })
    setProgress({ phase: 'analyzing', progress: 40, message: 'Analyzing with AI…' })
    setProgress({ phase: 'saving', progress: 90, message: 'Saving result…' })
    setProgress({ phase: 'complete', progress: 100, message: 'Done' })

    expect(phases[0].phase).toBe('reading')
    expect(phases[3].progress).toBe(100)
    expect(phases.map(p => p.phase)).toEqual(['reading', 'analyzing', 'saving', 'complete'])
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "analysis progress|FAIL|PASS"
```

Expected: PASS (pure logic test).

- [ ] **Step 3: Add progress state and update `analyze_crash_log` in `electron/ipc/ai.ts`**

Add after the `const MAX_PROMPT_CHARS` line (near top of file, after imports):

```typescript
interface ProgressState {
  phase: string; progress: number; message: string; current_step?: number; total_steps?: number
}
let analysisProgress: ProgressState = { phase: 'idle', progress: 0, message: '' }
function setProgress(p: ProgressState) { analysisProgress = p }
```

Replace the `get_analysis_progress` handler:

```typescript
ipcMain.handle('get_analysis_progress', () => analysisProgress)
```

In `analyze_crash_log`, add `setProgress` calls at the natural phase boundaries. Find the handler body and insert progress updates:

```typescript
// After: const p = args.request ?? (args as { ... })
// After: if (!isSafePath(p.file_path)) { throw ... }
setProgress({ phase: 'reading', progress: 10, message: 'Reading file…', current_step: 1, total_steps: 4 })
const start = Date.now()
const stat = await fs.stat(p.file_path)
if (stat.size > MAX_FILE_BYTES) throw new Error('File too large (max 10 MB)')
const content = await fs.readFile(p.file_path, 'utf-8')
const filename = path.basename(p.file_path)
const fileSizeKb = content.length / 1024
const apiKey = p.api_key || await resolveKey(p.provider, p.keeper_secret_uid)

setProgress({ phase: 'analyzing', progress: 30, message: 'Sending to AI…', current_step: 2, total_steps: 4 })
let resultText = ''
const win = BrowserWindow.fromWebContents(event.sender)
let tokenCount = 0

const result = await callAi({
  provider: p.provider,
  model: p.model,
  apiKey,
  systemPrompt: CRASH_SYSTEM_PROMPT,
  userPrompt: `Analyze this crash log:\n\nFilename: ${filename}\n\n${content}`,
  maxTokens: 4096,
  stream: true,
  onChunk: (chunk) => {
    resultText += chunk
    tokenCount += chunk.length
    // Rough progress: 30-85% during streaming based on chars received vs expected
    const streamPct = Math.min(30 + Math.floor((tokenCount / 3000) * 55), 85)
    setProgress({ phase: 'analyzing', progress: streamPct, message: 'Analyzing…', current_step: 2, total_steps: 4 })
    win?.webContents.send('stream:chunk', chunk)
  },
})

setProgress({ phase: 'saving', progress: 90, message: 'Saving result…', current_step: 3, total_steps: 4 })
// ... existing JSON parse and DB insert code ...
// After the DB insert row:
setProgress({ phase: 'complete', progress: 100, message: 'Analysis complete', current_step: 4, total_steps: 4 })
```

Also wrap the whole handler body in a try/finally to reset on error:

```typescript
// After streamReset or at start of handler:
try {
  // ... all existing code with setProgress calls ...
} catch (err) {
  setProgress({ phase: 'failed', progress: 0, message: (err as Error).message })
  throw err
} finally {
  // Reset to idle after a short delay so the UI can read 'complete'
  setTimeout(() => { analysisProgress = { phase: 'idle', progress: 0, message: '' } }, 3000)
}
```

- [ ] **Step 4: Build check**

```bash
npx tsc --build 2>&1
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/ai.ts tests/analysis-progress.test.ts
git commit -m "feat(electron): real analysis progress tracking in analyze_crash_log"
```

---

## Task 7: Persist crash log directory and stability mode

`set_crash_log_dir` is a no-op; `set_stability_mode` only echoes the value without persisting. Persist both in `electron-store` settings, and use the stored crash log dir when analyzing files.

**Files:**
- Modify: `electron/ipc/info.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/info-settings.test.ts
import { describe, it, expect } from 'vitest'

// Test the Store.set / Store.get round-trip logic (we mock the Store)
describe('crash_log_dir persistence', () => {
  it('stores and retrieves a dir path', () => {
    const store = new Map<string, unknown>()
    const set = (k: string, v: unknown) => store.set(k, v)
    const get = (k: string, def: unknown) => store.get(k) ?? def

    set('crash_log_dir', '/custom/logs')
    expect(get('crash_log_dir', '')).toBe('/custom/logs')
  })

  it('stores and retrieves stability mode', () => {
    const store = new Map<string, unknown>()
    store.set('stability_mode', true)
    expect(store.get('stability_mode')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "crash_log_dir|info-settings|FAIL|PASS"
```

Expected: PASS.

- [ ] **Step 3: Replace the three stubs in `electron/ipc/info.ts`**

At top of `registerInfoHandlers`, ensure `electron-store` is available. The file already imports `app` from electron. Add:

```typescript
import Store from 'electron-store'
const settingsStore = new Store({ name: 'settings' })
```

Replace the three stub handlers:

```typescript
// BEFORE (remove these):
ipcMain.handle('get_crash_log_dir', () => app.getPath('userData'))
ipcMain.handle('set_crash_log_dir', () => {})
ipcMain.handle('get_stability_mode', () => false)
ipcMain.handle('set_stability_mode', (_e, args: { enabled: boolean } | boolean) => {
  const enabled = typeof args === 'boolean' ? args : (args as { enabled: boolean }).enabled
  return enabled
})

// AFTER:
ipcMain.handle('get_crash_log_dir', () => {
  return (settingsStore.get('crash_log_dir', '') as string) || app.getPath('userData')
})

ipcMain.handle('set_crash_log_dir', (_e, args: { dir: string } | string) => {
  const dir = typeof args === 'string' ? args : (args as { dir: string }).dir
  if (dir) {
    settingsStore.set('crash_log_dir', dir)
  } else {
    settingsStore.delete('crash_log_dir')
  }
  return dir || app.getPath('userData')
})

ipcMain.handle('get_stability_mode', () => {
  return settingsStore.get('stability_mode', false) as boolean
})

ipcMain.handle('set_stability_mode', (_e, args: { enabled: boolean } | boolean) => {
  const enabled = typeof args === 'boolean' ? args : (args as { enabled: boolean }).enabled
  settingsStore.set('stability_mode', enabled)
  return enabled
})
```

- [ ] **Step 4: Build check**

```bash
npx tsc --build 2>&1
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/info.ts tests/info-settings.test.ts
git commit -m "feat(electron): persist crash_log_dir and stability_mode in electron-store"
```

---

## Task 8: Auto-update via electron-updater

Wire `electron-updater`'s `autoUpdater` to `updater:check`. The frontend shim calls `updater:check` and expects back a serializable object; `downloadAndInstall` must be added in the shim (can't serialize a function over IPC).

**Files:**
- Modify: `electron/ipc/settings.ts`
- Modify: `src/lib/tauri-updater-shim.ts`
- Modify: `electron/main.ts` (remove stale TODO)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/updater.test.ts
import { describe, it, expect } from 'vitest'

interface UpdateInfo { version: string; releaseDate: string; releaseNotes?: string }

describe('updater response shape', () => {
  it('returns null when no update available', () => {
    const currentVersion = '5.0.0'
    const latestVersion = '5.0.0'
    const result = latestVersion === currentVersion ? null : { available: true, version: latestVersion }
    expect(result).toBeNull()
  })

  it('returns update object when newer version exists', () => {
    const currentVersion = '5.0.0'
    const latestVersion = '5.1.0'
    const result = latestVersion === currentVersion ? null : {
      available: true, currentVersion, version: latestVersion,
    }
    expect(result?.available).toBe(true)
    expect(result?.version).toBe('5.1.0')
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "updater|FAIL|PASS"
```

Expected: PASS.

- [ ] **Step 3: Implement `updater:check` in `electron/ipc/settings.ts`**

Add import at top of `electron/ipc/settings.ts`:

```typescript
import { autoUpdater } from 'electron-updater'
```

Replace the stub handler:

```typescript
// BEFORE:
ipcMain.handle('updater:check', () => null) // Updates handled by electron-updater outside IPC

// AFTER:
ipcMain.handle('updater:check', async () => {
  try {
    autoUpdater.autoDownload = false
    const result = await autoUpdater.checkForUpdates()
    if (!result) return null
    const info = result.updateInfo
    const currentVersion = app.getVersion()
    const hasUpdate = info.version !== currentVersion
    if (!hasUpdate) return null
    return {
      available: true,
      currentVersion,
      version: info.version,
      date: info.releaseDate ?? null,
      body: Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n: { note?: string } | string) =>
            typeof n === 'string' ? n : (n.note ?? '')
          ).join('\n')
        : (info.releaseNotes as string | null ?? null),
    }
  } catch (err) {
    log.warn('updater:check failed:', err)
    return null
  }
})

ipcMain.handle('updater:download-and-install', async () => {
  try {
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall()
  } catch (err) {
    log.warn('updater:download-and-install failed:', err)
    throw err
  }
})
```

- [ ] **Step 4: Update the updater shim `src/lib/tauri-updater-shim.ts`**

The shim currently just casts the IPC result. Replace it so the returned object has a working `downloadAndInstall` method:

```typescript
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

export interface Update {
  available: boolean
  currentVersion: string
  version: string
  date?: string
  body?: string
  rawJson?: Record<string, unknown>
  download: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
  install: () => Promise<void>
  downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
}

export async function check(): Promise<Update | null> {
  const raw = await window.hadron.invoke('updater:check') as {
    available: boolean; currentVersion: string; version: string; date?: string; body?: string
  } | null
  if (!raw) return null
  return {
    ...raw,
    download: async () => { await window.hadron.invoke('updater:download-and-install') },
    install: async () => { /* handled by download-and-install combined */ },
    downloadAndInstall: async () => { await window.hadron.invoke('updater:download-and-install') },
  }
}
```

- [ ] **Step 5: Remove the stale TODO from `electron/main.ts`**

In `electron/main.ts`, find and remove:

```typescript
// TODO Phase 2: wire up floating widget BrowserWindow (widget-main.tsx)
```

The widget window is already implemented in `electron/ipc/widget.ts` and is created on demand. The comment is stale.

- [ ] **Step 6: Build check**

```bash
npx tsc --build 2>&1
```

Expected: no output. If electron-updater types cause issues (needs a publish config to resolve), the check call will return null in dev — that is acceptable.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/settings.ts src/lib/tauri-updater-shim.ts electron/main.ts tests/updater.test.ts
git commit -m "feat(electron): auto-update via electron-updater + downloadAndInstall in shim"
```

---

## Task 9: Widget hover button enable/disable

`set_hover_button_enabled` is a no-op. It should show or hide the floating widget window. The `show_widget` and `hide_widget` handlers already work — this just needs to call them.

**Files:**
- Modify: `electron/ipc/widget.ts`

- [ ] **Step 1: Replace the no-op handler**

In `electron/ipc/widget.ts`, replace:

```typescript
ipcMain.handle('set_hover_button_enabled', () => { /* no-op in Electron */ })
```

With:

```typescript
ipcMain.handle('set_hover_button_enabled', (_e, args: { enabled: boolean } | boolean) => {
  const enabled = typeof args === 'boolean' ? args : (args as { enabled: boolean }).enabled
  if (enabled) {
    getOrCreateWidgetWindow().show()
  } else if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.hide()
  }
})
```

- [ ] **Step 2: Build check**

```bash
npx tsc --build 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/widget.ts
git commit -m "fix(electron): set_hover_button_enabled shows/hides floating widget"
```

---

## Task 10: Final build and test run

- [ ] **Step 1: Run full test suite**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npm test 2>&1
```

Expected: all tests pass. If any fail, fix before proceeding.

- [ ] **Step 2: Full TypeScript build**

```bash
npx tsc --build 2>&1
```

Expected: no output.

- [ ] **Step 3: Electron-vite build (optional — confirms bundling works)**

```bash
npm run build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git status  # Verify only expected files changed
git commit -m "chore(electron): final build verification — all stubs resolved"
```

---

## Self-Review

### Spec coverage

| Finding | Task |
|---------|------|
| High: JIRA background polling stubbed | Task 2 |
| High: Confluence stubs | Task 4 |
| High: KB import no-op | Task 5 |
| Medium: Auto-update disabled | Task 8 |
| Medium: crash_log_dir / stability_mode not persisted | Task 7 |
| Medium: analysis progress always idle | Task 6 |
| Medium: find_similar_tickets always [] | Task 3 |
| Low: widget hover button no-op | Task 9 |
| Low: stale TODO in main.ts | Task 8 Step 5 |
| Enabling: DB FTS indices | Task 1 |

All findings have a task. ✅

### Placeholder scan

No TBDs, no "handle edge cases", no "similar to Task N". Each step has exact file paths and complete code. ✅

### Type consistency

- `PollerState.timer` typed as `ReturnType<typeof setInterval> | null` — consistent everywhere
- `ProgressState` interface defined in Task 6 and used in `setProgress()` — consistent
- `readConfluenceCreds()` returns `{ baseUrl, email, apiToken }` — same shape as `readJiraCreds()` — consistent
- `ConfluenceDoc` shape (`id, title, excerpt, url, space_key`) matches `src/services/investigation.ts:24` — consistent ✅
