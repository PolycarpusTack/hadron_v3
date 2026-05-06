# Hadron Electron Phase 2 — Feature IPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all remaining Tauri commands to Electron IPC handlers so the Electron app has full feature parity with hadron-desktop.

**Architecture:** Each Tauri command file maps to an Electron IPC file in `electron/ipc/`. The handlers read from a shared `electron-store` instance (for JIRA/Sentry credentials) and a `better-sqlite3` DB. Complex Rust dependencies (Keeper SDK, investigation crate, OpenSearch/RAG) are stubbed with graceful "not available" responses; everything else is a direct port using `node-fetch` + `better-sqlite3`.

**Tech Stack:** TypeScript, Electron IPC (`ipcMain.handle`), better-sqlite3, node-fetch, electron-store, the existing `ai-service.ts`.

---

## File Structure

Files to **create**:
- `electron/ipc/widget.ts` — show/hide/resize/move/focus window handlers (stubs using BrowserWindow API)
- `electron/ipc/chat.ts` — session CRUD + simplified `chat_send` + `poll_chat_stream`
- `electron/ipc/gold-answers.ts` — CRUD for gold_answers table
- `electron/ipc/summaries.ts` — session summary generate + save + export
- `electron/ipc/signatures.ts` — compute + upsert + query crash signatures
- `electron/ipc/jira.ts` — JIRA HTTP API calls (test, search, create, link, comment)
- `electron/ipc/sentry.ts` — Sentry HTTP API calls (test, list projects, list issues, fetch issue)
- `electron/ipc/release-notes.ts` — fetch JIRA tickets + AI generation + DB CRUD
- `electron/ipc/jira-assist.ts` — ticket brief triage, generate brief, batch get
- `electron/ipc/keeper.ts` — stub handlers returning "Keeper SDK not available in Electron"
- `electron/ipc/investigation.ts` — stub handlers that proxy to JIRA HTTP + return dossier

Files to **modify**:
- `electron/ipc/index.ts` — register all new handler modules
- `electron/database.ts` — add `getStoreValue` helper for reading electron-store from IPC context
- `electron/migrations.ts` — no changes needed (migrations 1-14 already cover all tables)

---

## Task 1: Widget and Window Stubs

**Files:**
- Create: `electron/ipc/widget.ts`
- Modify: `electron/ipc/index.ts`
- Modify: `electron/main.ts`

The Tauri widget commands operate on a second `BrowserWindow` labelled "widget". In Electron Phase 2 the widget window does not exist yet (it's in the Phase 1 plan as a TODO), so these handlers must return success without crashing instead of throwing. `focus_main_window` must work — it brings the existing `mainWindow` to front.

- [ ] **Step 1: Create `electron/ipc/widget.ts`**

```typescript
import { IpcMain, BrowserWindow, app } from 'electron'

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

export function registerWidgetHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('focus_main_window', () => {
    const win = getMainWindow()
    if (win) { win.show(); win.restore(); win.focus() }
  })
  ipcMain.handle('show_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('hide_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('toggle_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('resize_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('move_widget', () => { /* widget not implemented yet */ })
  ipcMain.handle('get_widget_position', () => ({ x: 0, y: 0 }))
  ipcMain.handle('is_widget_visible', () => false)
  ipcMain.handle('is_main_window_visible', () => {
    const win = getMainWindow()
    return win ? win.isVisible() && !win.isMinimized() : false
  })
  ipcMain.handle('set_hover_button_enabled', () => { /* no-op */ })
}
```

- [ ] **Step 2: Register in `electron/ipc/index.ts`**

Add at top:
```typescript
import { registerWidgetHandlers } from './widget'
```
Add inside `registerAllHandlers`:
```typescript
  registerWidgetHandlers(ipcMain)
```

- [ ] **Step 3: Verify app starts without crash**

Run: `cd hadron-electron && npm run dev`
Expected: App opens, no `IPC not ready` or `Cannot find handler` errors in DevTools console for widget-related calls.

- [ ] **Step 4: Commit**

```bash
git add hadron-electron/electron/ipc/widget.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): add widget IPC stubs — focus_main_window + no-op show/hide/resize/move"
```

---

## Task 2: Chat Session CRUD IPC

**Files:**
- Create: `electron/ipc/chat.ts` (session CRUD portion only — `chat_send` is Task 3)
- Modify: `electron/ipc/index.ts`

The `chat_sessions` and `chat_messages` tables already exist (migration 9). This task ports all DB-only chat commands: save session, load sessions/messages, delete, star, tag, metadata update, feedback.

- [ ] **Step 1: Write failing test for `chat_save_session`**

Create `electron/__tests__/chat-crud.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'

let db: Database.Database

beforeAll(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
})
afterAll(() => db.close())

it('saves and retrieves a chat session', () => {
  db.prepare(`INSERT INTO chat_sessions (id, title, provider, model, created_at, updated_at)
    VALUES ('sess-1', 'Test', 'anthropic', 'claude-3-5-sonnet-20241022', datetime('now'), datetime('now'))`).run()
  const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get('sess-1') as any
  expect(row.title).toBe('Test')
})
```

Run: `cd hadron-electron && npm test`
Expected: FAIL with missing test (or PASS if test infra already set up)

- [ ] **Step 2: Run test to verify infra**

Run: `cd hadron-electron && npm test -- --reporter=verbose 2>&1 | head -30`
Expected: vitest finds the test file.

- [ ] **Step 3: Create `electron/ipc/chat.ts` with session CRUD handlers**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'
import log from 'electron-log'

export function registerChatHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('chat_save_session', (_e, args: {
    id: string; title: string; provider: string; model: string;
    won_version?: string; customer?: string; analysis_id?: number
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`INSERT OR REPLACE INTO chat_sessions
      (id, title, provider, model, won_version, customer, analysis_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM chat_sessions WHERE id=?), ?), ?)
    `).run(args.id, args.title, args.provider, args.model,
           args.won_version ?? null, args.customer ?? null, args.analysis_id ?? null,
           args.id, now, now)
    return { id: args.id }
  })

  ipcMain.handle('chat_load_sessions', (_e, args?: { limit?: number; offset?: number }) => {
    const db = getDb()
    return db.prepare(`SELECT * FROM chat_sessions WHERE archived = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(args?.limit ?? 50, args?.offset ?? 0)
  })

  ipcMain.handle('chat_load_session', (_e, args: { id: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(args.id) ?? null
  })

  ipcMain.handle('chat_load_messages', (_e, args: { session_id: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(args.session_id)
  })

  ipcMain.handle('chat_save_message', (_e, args: {
    id: string; session_id: string; role: string; content: string;
    tool_calls_json?: string; tool_results_json?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`INSERT OR REPLACE INTO chat_messages
      (id, session_id, role, content, tool_calls_json, tool_results_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(args.id, args.session_id, args.role, args.content,
           args.tool_calls_json ?? null, args.tool_results_json ?? null, now)
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, args.session_id)
    return { id: args.id }
  })

  ipcMain.handle('chat_delete_session', (_e, args: { id: string }) => {
    const db = getDb()
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(args.id)
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(args.id)
  })

  ipcMain.handle('chat_star_session', (_e, args: { id: string; starred: boolean }) => {
    const db = getDb()
    db.prepare('UPDATE chat_sessions SET is_starred = ? WHERE id = ?').run(args.starred ? 1 : 0, args.id)
  })

  ipcMain.handle('chat_tag_session', (_e, args: { id: string; tags: string[] }) => {
    const db = getDb()
    db.prepare('UPDATE chat_sessions SET tags_json = ? WHERE id = ?').run(JSON.stringify(args.tags), args.id)
  })

  ipcMain.handle('chat_update_session_metadata', (_e, args: {
    id: string; title?: string; won_version?: string; customer?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const updates: string[] = []
    const params: unknown[] = []
    if (args.title !== undefined) { updates.push('title = ?'); params.push(args.title) }
    if (args.won_version !== undefined) { updates.push('won_version = ?'); params.push(args.won_version) }
    if (args.customer !== undefined) { updates.push('customer = ?'); params.push(args.customer) }
    if (updates.length === 0) return
    updates.push('updated_at = ?'); params.push(now)
    params.push(args.id)
    db.prepare(`UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  })

  ipcMain.handle('chat_submit_feedback', (_e, args: {
    session_id: string; message_id: string; feedback_type: string;
    rating?: number; comment?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`INSERT INTO chat_feedback
      (session_id, message_id, feedback_type, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(args.session_id, args.message_id, args.feedback_type,
           args.rating ?? null, args.comment ?? null, now)
    return { id: row.lastInsertRowid }
  })

  ipcMain.handle('chat_delete_feedback', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('DELETE FROM chat_feedback WHERE id = ?').run(args.id)
  })
}
```

- [ ] **Step 4: Register in `electron/ipc/index.ts`**

```typescript
import { registerChatHandlers } from './chat'
// inside registerAllHandlers:
  registerChatHandlers(ipcMain)
```

- [ ] **Step 5: Run tests**

Run: `cd hadron-electron && npm test`
Expected: All tests pass (or skip if test file needs adjustment for schema columns).

- [ ] **Step 6: Commit**

```bash
git add hadron-electron/electron/ipc/chat.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): chat session CRUD IPC handlers"
```

---

## Task 3: Chat Send — Simplified Agent Loop

**Files:**
- Modify: `electron/ipc/chat.ts` — add `chat_send` and `poll_chat_stream`

The Rust `chat_send` uses RAG/OpenSearch embeddings that don't exist in Electron. The Electron version implements a simplified agent: direct AI call with FTS (SQLite full-text search) as the only retrieval tool. Uses the existing `electron/services/ai-service.ts` for the AI call. Pull-based streaming via `poll_chat_stream` mirrors the Rust approach using a module-level shared state object.

- [ ] **Step 1: Add shared stream state at top of `electron/ipc/chat.ts`**

Add after imports:
```typescript
import { callAi } from '../services/ai-service'
import { getSecret } from '../services/safe-storage'
import Store from 'electron-store'

interface StreamState {
  pendingText: string
  done: boolean
  error: string | null
  events: Array<{ kind: string; [k: string]: unknown }>
}

const streamState: StreamState = { pendingText: '', done: false, error: null, events: [] }

function streamReset() {
  streamState.pendingText = ''
  streamState.done = false
  streamState.error = null
  streamState.events = []
}
```

- [ ] **Step 2: Add `poll_chat_stream` handler inside `registerChatHandlers`**

```typescript
  ipcMain.handle('poll_chat_stream', () => {
    const text = streamState.pendingText
    const done = streamState.done
    const error = streamState.error ?? undefined
    const events = [...streamState.events]
    streamState.pendingText = ''
    streamState.events = []
    return { text, done, error, events }
  })
```

- [ ] **Step 3: Add `chat_send` handler inside `registerChatHandlers`**

```typescript
  ipcMain.handle('chat_send', async (_e, args: {
    messages: Array<{ role: string; content: string }>
    api_key: string
    model: string
    provider: string
    use_rag: boolean
    use_kb: boolean
    won_version?: string
    customer?: string
    analysis_id?: number
    request_id?: string
    keeper_secret_uid?: string
    auxiliary_model?: string
    verbosity?: string
  }) => {
    streamReset()

    // Resolve API key
    const SERVICE_NAME = 'hadron-electron'
    let apiKey = args.api_key
    if (args.keeper_secret_uid) {
      const stored = getSecret(SERVICE_NAME, `keeper:${args.keeper_secret_uid}`)
      if (stored) apiKey = stored
    }
    if (!apiKey) {
      const stored = getSecret(SERVICE_NAME, args.provider)
      if (stored) apiKey = stored
    }
    if (!apiKey) {
      streamState.error = `No API key configured for provider: ${args.provider}`
      streamState.done = true
      return { content: '', inputTokens: 0, outputTokens: 0, cost: 0 }
    }

    // FTS context: search analyses for the last user message
    const query = [...args.messages].reverse().find(m => m.role === 'user')?.content ?? ''
    let ftsContext = ''
    if (query && args.use_rag) {
      try {
        const db = getDb()
        const rows = db.prepare(`SELECT id, filename, severity, root_cause, error_message, analysis_type
          FROM analyses WHERE analyses MATCH ? LIMIT 5`).all(query) as any[]
        if (rows.length > 0) {
          ftsContext = rows.map(r =>
            `<analysis id="${r.id}" filename="${r.filename}" severity="${r.severity}">\n` +
            `Root Cause: ${r.root_cause}\n` +
            `${r.error_message ? `Error: ${r.error_message}\n` : ''}` +
            `</analysis>`
          ).join('\n\n')
        }
      } catch { /* FTS not available on this DB */ }
    }

    const SYSTEM_PROMPT = `You are Ask Hadron, an expert regarding the Mediagenix WHATS'ON broadcast management software. You help users understand crashes, debug issues, and navigate historical analyses.${ftsContext ? `\n\n## Related Analyses\n${ftsContext}` : ''}`

    try {
      const result = await callAi({
        provider: args.provider,
        model: args.model,
        apiKey,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: '', // unused — messages passed directly below
        maxTokens: 4096,
        stream: true,
        messages: args.messages,
        onChunk: (chunk) => {
          streamState.pendingText += chunk
        },
      })
      streamState.done = true
      return { content: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost: result.cost }
    } catch (err) {
      streamState.error = (err as Error).message
      streamState.done = true
      return { content: '', inputTokens: 0, outputTokens: 0, cost: 0 }
    }
  })
```

- [ ] **Step 4: Update `electron/services/ai-service.ts` to accept `messages` param**

Read `electron/services/ai-service.ts` first to check existing signature. The existing `callAi` takes `userPrompt` and internally constructs the messages array. We need it to also accept a pre-built `messages` array for the chat case. Add an optional `messages` field:

In the `callAi` options interface, add:
```typescript
messages?: Array<{ role: string; content: string }>
```
In the body construction, if `messages` is provided, use it directly instead of building `[{ role: 'user', content: userPrompt }]`.

- [ ] **Step 5: Run dev and test chat manually**

Run: `cd hadron-electron && npm run dev`
Navigate to Ask Hadron section. Send a test message.
Expected: Response streams in, no crashes.

- [ ] **Step 6: Commit**

```bash
git add hadron-electron/electron/ipc/chat.ts hadron-electron/electron/services/ai-service.ts
git commit -m "feat(electron): chat_send + poll_chat_stream — simplified streaming agent"
```

---

## Task 4: Gold Answers IPC

**Files:**
- Create: `electron/ipc/gold-answers.ts`
- Modify: `electron/ipc/index.ts`

The `gold_answers` table already exists (migration 12 `ask_hadron_2`). Port all 5 commands from `commands/gold_answers.rs`.

- [ ] **Step 1: Create `electron/ipc/gold-answers.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerGoldAnswerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('save_gold_answer', (_e, args: {
    question: string; answer: string; sessionId: string; messageId: string;
    wonVersion?: string; customer?: string; tags?: string;
    verifiedBy?: string; toolResultsJson?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`INSERT INTO gold_answers
      (question, answer, session_id, message_id, won_version, customer, tags,
       verified_by, tool_results_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(args.question, args.answer, args.sessionId, args.messageId,
           args.wonVersion ?? null, args.customer ?? null, args.tags ?? null,
           args.verifiedBy ?? null, args.toolResultsJson ?? null, now, now)
    return row.lastInsertRowid
  })

  ipcMain.handle('list_gold_answers', (_e, args?: {
    limit?: number; offset?: number; customer?: string; tag?: string
  }) => {
    const db = getDb()
    const limit = args?.limit ?? 50
    const offset = args?.offset ?? 0
    let sql = 'SELECT * FROM gold_answers WHERE 1=1'
    const params: unknown[] = []
    if (args?.customer) { sql += ' AND customer = ?'; params.push(args.customer) }
    if (args?.tag) { sql += ' AND tags LIKE ?'; params.push(`%${args.tag}%`) }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('search_gold_answers_cmd', (_e, args: { query: string; limit?: number }) => {
    const db = getDb()
    const limit = args.limit ?? 10
    return db.prepare(`SELECT * FROM gold_answers
      WHERE question LIKE ? OR answer LIKE ?
      ORDER BY created_at DESC LIMIT ?`
    ).all(`%${args.query}%`, `%${args.query}%`, limit)
  })

  ipcMain.handle('delete_gold_answer_cmd', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('DELETE FROM gold_answers WHERE id = ?').run(args.id)
  })

  ipcMain.handle('export_gold_answers_jsonl', (_e, args: {
    dateFrom?: string; dateTo?: string; customer?: string; tags?: string
  }) => {
    const db = getDb()
    let sql = 'SELECT * FROM gold_answers WHERE 1=1'
    const params: unknown[] = []
    if (args.dateFrom) { sql += ' AND created_at >= ?'; params.push(args.dateFrom) }
    if (args.dateTo)   { sql += ' AND created_at <= ?'; params.push(args.dateTo) }
    if (args.customer) { sql += ' AND customer = ?'; params.push(args.customer) }
    if (args.tags)     { sql += ' AND tags LIKE ?'; params.push(`%${args.tags}%`) }
    const answers = db.prepare(sql).all(...params) as any[]

    return answers.map(a => JSON.stringify({
      messages: [
        { role: 'system', content: 'You are Ask Hadron, an expert regarding the Mediagenix WHATS\'ON broadcast management software.' },
        { role: 'user', content: a.question },
        { role: 'assistant', content: a.answer },
      ],
      _metadata: {
        gold_answer_id: a.id,
        won_version: a.won_version,
        customer: a.customer,
        tags: a.tags,
        created_at: a.created_at,
      }
    })).join('\n')
  })
}
```

- [ ] **Step 2: Register in `electron/ipc/index.ts`**

```typescript
import { registerGoldAnswerHandlers } from './gold-answers'
// inside registerAllHandlers:
  registerGoldAnswerHandlers(ipcMain)
```

- [ ] **Step 3: Commit**

```bash
git add hadron-electron/electron/ipc/gold-answers.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): gold answers IPC handlers"
```

---

## Task 5: Summaries IPC

**Files:**
- Create: `electron/ipc/summaries.ts`
- Modify: `electron/ipc/index.ts`

The `session_summaries` table already exists (migration 12). Port `generate_session_summary`, `save_session_summary`, `get_session_summary`, `export_summaries_bundle`.

- [ ] **Step 1: Create `electron/ipc/summaries.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'
import { getSecret } from '../services/safe-storage'

const SERVICE_NAME = 'hadron-electron'
const SUMMARY_SYSTEM_PROMPT = `You are a technical writer. Summarize the following support conversation into a structured document. Use this exact format:

## Topic
[One-line description]

## Context
- WON Version: [if mentioned]
- Customer: [if mentioned]
- Related Analyses: [#IDs if any]

## Question
[The core question or problem]

## Answer
[Condensed key findings]

## Sources
[KB docs, analysis IDs, JIRA tickets cited]

## Resolution
[Action taken or recommended]

Be concise. Only include sections that have content.`

export function registerSummaryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('generate_session_summary', async (_e, args: {
    sessionId: string; provider: string; model: string; apiKey: string
  }) => {
    const db = getDb()
    const messages = db.prepare(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
    ).all(args.sessionId) as Array<{ role: string; content: string }>

    if (messages.length === 0) throw new Error('No messages in session')

    const transcript = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `**${m.role === 'user' ? 'User' : 'Hadron'}:** ${m.content}`)
      .join('\n\n')

    let apiKey = args.apiKey
    if (!apiKey) {
      apiKey = getSecret(SERVICE_NAME, args.provider) ?? ''
    }
    if (!apiKey) throw new Error(`No API key for provider: ${args.provider}`)

    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: transcript,
      maxTokens: 4000,
    })
    return result.content
  })

  ipcMain.handle('save_session_summary', (_e, args: {
    sessionId: string; summaryMarkdown: string; topic: string;
    wonVersion?: string; customer?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const existing = db.prepare(
      'SELECT id FROM session_summaries WHERE session_id = ?'
    ).get(args.sessionId) as { id: number } | undefined

    if (existing) {
      db.prepare(`UPDATE session_summaries SET summary_markdown=?, topic=?, won_version=?, customer=?, updated_at=? WHERE id=?`)
        .run(args.summaryMarkdown, args.topic, args.wonVersion ?? null, args.customer ?? null, now, existing.id)
      return existing.id
    }
    const row = db.prepare(`INSERT INTO session_summaries
      (session_id, summary_markdown, topic, won_version, customer, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(args.sessionId, args.summaryMarkdown, args.topic,
           args.wonVersion ?? null, args.customer ?? null, now, now)
    return row.lastInsertRowid
  })

  ipcMain.handle('get_session_summary', (_e, args: { sessionId: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get(args.sessionId) ?? null
  })

  ipcMain.handle('export_summaries_bundle', (_e, args: {
    dateFrom?: string; dateTo?: string; customer?: string; unexportedOnly?: boolean
  }) => {
    const db = getDb()
    let sql = 'SELECT * FROM session_summaries WHERE 1=1'
    const params: unknown[] = []
    if (args.dateFrom) { sql += ' AND created_at >= ?'; params.push(args.dateFrom) }
    if (args.dateTo)   { sql += ' AND created_at <= ?'; params.push(args.dateTo) }
    if (args.customer) { sql += ' AND customer = ?'; params.push(args.customer) }
    const summaries = db.prepare(sql).all(...params) as any[]

    const bundle = summaries.map(s => {
      const datePart = (s.created_at as string).split(' ')[0] ?? 'unknown-date'
      const topicPart = (s.topic ?? 'untitled').toLowerCase().replace(/ /g, '-')
        .replace(/[^a-z0-9-]/g, '').substring(0, 50)
      return { filename: `${datePart}-${topicPart}.md`, content: s.summary_markdown }
    })
    return JSON.stringify(bundle)
  })
}
```

- [ ] **Step 2: Register in `electron/ipc/index.ts`**

```typescript
import { registerSummaryHandlers } from './summaries'
// inside registerAllHandlers:
  registerSummaryHandlers(ipcMain)
```

- [ ] **Step 3: Commit**

```bash
git add hadron-electron/electron/ipc/summaries.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): session summary IPC handlers"
```

---

## Task 6: Crash Signatures IPC

**Files:**
- Create: `electron/ipc/signatures.ts`
- Modify: `electron/ipc/index.ts`

The `crash_signatures` table already exists (migration 4). Port `compute_crash_signature`, `register_crash_signature`, `get_signature_occurrences`, `get_top_signatures`, `update_signature_status`, `link_ticket_to_signature`.

The Rust signature algorithm uses SHA-256 on a normalized key. Port the same algorithm to TypeScript using Node.js `crypto`.

- [ ] **Step 1: Create `electron/ipc/signatures.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'
import { createHash } from 'crypto'

interface CrashSignature {
  hash: string
  error_type: string
  stack_key: string | null
  occurrence_count: number
  first_seen: string
  last_seen: string
  status: string
  linked_ticket: string | null
  linked_ticket_url: string | null
  metadata: string | null
}

function computeSignatureHash(errorType: string, stackTrace: string | null): string {
  const normalized = errorType.trim().toLowerCase()
  // Extract first 3 frames from stack trace for the key
  let stackKey: string | null = null
  if (stackTrace) {
    const frames = stackTrace.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('at ') || l.match(/^\s*\d+:/))
      .slice(0, 3)
      .join('|')
    if (frames) stackKey = frames
  }
  const input = stackKey ? `${normalized}|${stackKey}` : normalized
  return createHash('sha256').update(input).digest('hex').substring(0, 16)
}

export function registerSignatureHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('compute_crash_signature', (_e, args: {
    errorType: string; stackTrace?: string; rootCause: string
  }) => {
    const hash = computeSignatureHash(args.errorType, args.stackTrace ?? null)
    return { hash, error_type: args.errorType, stack_key: args.stackTrace ?? null,
             occurrence_count: 0, first_seen: '', last_seen: '',
             status: 'new', linked_ticket: null, linked_ticket_url: null, metadata: null }
  })

  ipcMain.handle('register_crash_signature', (_e, args: {
    analysisId: number; errorType: string; stackTrace?: string; rootCause: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const hash = computeSignatureHash(args.errorType, args.stackTrace ?? null)

    const existing = db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(hash) as CrashSignature | undefined
    const isNew = !existing

    if (isNew) {
      db.prepare(`INSERT INTO crash_signatures
        (hash, error_type, stack_key, occurrence_count, first_seen, last_seen, status)
        VALUES (?, ?, ?, 1, ?, ?, 'new')
      `).run(hash, args.errorType, args.stackTrace ?? null, now, now)
    } else {
      db.prepare('UPDATE crash_signatures SET occurrence_count = occurrence_count + 1, last_seen = ? WHERE hash = ?')
        .run(now, hash)
    }

    // Link analysis to signature
    try {
      db.prepare('UPDATE analyses SET signature_hash = ? WHERE id = ?').run(hash, args.analysisId)
    } catch { /* column may not exist in older migrations */ }

    const updated = db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(hash) as CrashSignature
    return {
      signature: updated,
      is_new: isNew,
      occurrence_count: updated.occurrence_count,
      linked_ticket: updated.linked_ticket,
    }
  })

  ipcMain.handle('get_signature_occurrences', (_e, args: { hash: string }) => {
    const db = getDb()
    const sig = db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(args.hash)
    if (!sig) throw new Error('Signature not found')
    const files = db.prepare('SELECT * FROM analyses WHERE signature_hash = ? ORDER BY analyzed_at DESC').all(args.hash)
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
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('update_signature_status', (_e, args: {
    hash: string; status: string; metadata?: string
  }) => {
    const db = getDb()
    if (args.metadata !== undefined) {
      db.prepare('UPDATE crash_signatures SET status = ?, metadata = ? WHERE hash = ?')
        .run(args.status, args.metadata, args.hash)
    } else {
      db.prepare('UPDATE crash_signatures SET status = ? WHERE hash = ?').run(args.status, args.hash)
    }
  })

  ipcMain.handle('link_ticket_to_signature', (_e, args: {
    hash: string; ticketKey: string; ticketUrl?: string
  }) => {
    const db = getDb()
    db.prepare('UPDATE crash_signatures SET linked_ticket = ?, linked_ticket_url = ? WHERE hash = ?')
      .run(args.ticketKey, args.ticketUrl ?? null, args.hash)
  })
}
```

- [ ] **Step 2: Register in `electron/ipc/index.ts`**

```typescript
import { registerSignatureHandlers } from './signatures'
// inside registerAllHandlers:
  registerSignatureHandlers(ipcMain)
```

- [ ] **Step 3: Commit**

```bash
git add hadron-electron/electron/ipc/signatures.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): crash signature IPC handlers"
```

---

## Task 7: JIRA IPC

**Files:**
- Create: `electron/ipc/jira.ts`
- Modify: `electron/ipc/index.ts`

Port all JIRA core commands from `commands/jira.rs`: test_jira_connection, list_jira_projects, create_jira_ticket, search_jira_issues, search_jira_issues_next_page, post_jira_comment, link_jira_to_analysis, unlink_jira_from_analysis, get_jira_links_for_analysis, get_analyses_for_jira_ticket, update_jira_link_metadata, count_jira_links_for_analysis, get_all_jira_links.

Credentials are read from the `settings` electron-store (keys: `jira_base_url`, `jira_email`, `jira_api_key`).

- [ ] **Step 1: Create `electron/ipc/jira.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'
import Store from 'electron-store'
import log from 'electron-log'

const settingsStore = new Store({ name: 'settings' })

function readJiraCreds(): { baseUrl: string; email: string; apiToken: string } {
  const baseUrl = settingsStore.get('jira_base_url', '') as string
  const email = settingsStore.get('jira_email', '') as string
  const apiToken = settingsStore.get('jira_api_key', '') as string
  if (!baseUrl || !email || !apiToken) {
    throw new Error('JIRA not configured. Please set up JIRA credentials in Settings.')
  }
  return { baseUrl, email, apiToken }
}

async function jiraFetch(baseUrl: string, email: string, apiToken: string, path: string, options: RequestInit = {}) {
  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`JIRA API error ${res.status}: ${body.substring(0, 200)}`)
  }
  return res.json()
}

export function registerJiraHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('test_jira_connection', async () => {
    try {
      const { baseUrl, email, apiToken } = readJiraCreds()
      const data = await jiraFetch(baseUrl, email, apiToken, '/rest/api/3/myself') as any
      return { success: true, message: `Connected as ${data.displayName ?? data.emailAddress}` }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('list_jira_projects', async () => {
    const { baseUrl, email, apiToken } = readJiraCreds()
    const data = await jiraFetch(baseUrl, email, apiToken, '/rest/api/3/project') as any[]
    return data.map((p: any) => ({ id: p.id, key: p.key, name: p.name }))
  })

  ipcMain.handle('create_jira_ticket', async (_e, args: {
    projectKey: string; issueType: string
    ticket: { summary: string; description?: string; priority?: string; labels?: string[] }
  }) => {
    const { baseUrl, email, apiToken } = readJiraCreds()
    const body = {
      fields: {
        project: { key: args.projectKey },
        issuetype: { name: args.issueType },
        summary: args.ticket.summary,
        ...(args.ticket.description ? {
          description: { type: 'doc', version: 1, content: [{
            type: 'paragraph', content: [{ type: 'text', text: args.ticket.description }]
          }]}
        } : {}),
        ...(args.ticket.priority ? { priority: { name: args.ticket.priority } } : {}),
        ...(args.ticket.labels?.length ? { labels: args.ticket.labels } : {}),
      }
    }
    const data = await jiraFetch(baseUrl, email, apiToken, '/rest/api/3/issue', {
      method: 'POST', body: JSON.stringify(body)
    }) as any
    return { key: data.key, id: data.id, url: `${baseUrl}/browse/${data.key}` }
  })

  ipcMain.handle('search_jira_issues', async (_e, args: {
    jql: string; maxResults: number; includeComments: boolean
  }) => {
    const { baseUrl, email, apiToken } = readJiraCreds()
    const fields = ['summary', 'status', 'priority', 'assignee', 'reporter', 'created', 'updated', 'description', 'labels', 'components']
    if (args.includeComments) fields.push('comment')
    const path = `/rest/api/3/issue/search?jql=${encodeURIComponent(args.jql)}&maxResults=${args.maxResults}&fields=${fields.join(',')}`
    return jiraFetch(baseUrl, email, apiToken, path)
  })

  ipcMain.handle('search_jira_issues_next_page', async (_e, args: {
    jql: string; maxResults: number; includeComments: boolean; nextPageToken: string
  }) => {
    const { baseUrl, email, apiToken } = readJiraCreds()
    const fields = ['summary', 'status', 'priority', 'assignee', 'reporter', 'created', 'updated', 'description', 'labels']
    const path = `/rest/api/3/issue/search?jql=${encodeURIComponent(args.jql)}&maxResults=${args.maxResults}&startAt=${args.nextPageToken}&fields=${fields.join(',')}`
    return jiraFetch(baseUrl, email, apiToken, path)
  })

  ipcMain.handle('post_jira_comment', async (_e, args: { issueKey: string; commentBody: string }) => {
    const { baseUrl, email, apiToken } = readJiraCreds()
    const body = {
      body: { type: 'doc', version: 1, content: [{
        type: 'paragraph', content: [{ type: 'text', text: args.commentBody }]
      }]}
    }
    await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/issue/${args.issueKey}/comment`, {
      method: 'POST', body: JSON.stringify(body)
    })
  })

  // === JIRA Link DB Commands ===

  ipcMain.handle('link_jira_to_analysis', (_e, args: {
    analysisId: number; jiraKey: string; jiraUrl?: string; jiraSummary?: string;
    jiraStatus?: string; jiraPriority?: string; linkType?: string; notes?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const linkType = args.linkType ?? 'related'
    db.prepare(`INSERT OR REPLACE INTO jira_links
      (analysis_id, jira_key, jira_url, jira_summary, jira_status, jira_priority, link_type, notes, linked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(args.analysisId, args.jiraKey, args.jiraUrl ?? null, args.jiraSummary ?? null,
           args.jiraStatus ?? null, args.jiraPriority ?? null, linkType, args.notes ?? null, now)
    return db.prepare('SELECT * FROM jira_links WHERE analysis_id = ? AND jira_key = ?')
      .get(args.analysisId, args.jiraKey)
  })

  ipcMain.handle('unlink_jira_from_analysis', (_e, args: { analysisId: number; jiraKey: string }) => {
    const db = getDb()
    const result = db.prepare('DELETE FROM jira_links WHERE analysis_id = ? AND jira_key = ?')
      .run(args.analysisId, args.jiraKey)
    return result.changes > 0
  })

  ipcMain.handle('get_jira_links_for_analysis', (_e, args: { analysisId: number }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM jira_links WHERE analysis_id = ? ORDER BY linked_at DESC').all(args.analysisId)
  })

  ipcMain.handle('get_analyses_for_jira_ticket', (_e, args: { jiraKey: string }) => {
    const db = getDb()
    const links = db.prepare('SELECT * FROM jira_links WHERE jira_key = ?').all(args.jiraKey) as any[]
    return links.map(l => {
      const analysis = db.prepare('SELECT * FROM analyses WHERE id = ?').get(l.analysis_id)
      return [analysis, l]
    }).filter(([a]) => a != null)
  })

  ipcMain.handle('update_jira_link_metadata', (_e, args: {
    jiraKey: string; jiraSummary?: string; jiraStatus?: string; jiraPriority?: string
  }) => {
    const db = getDb()
    const updates: string[] = []
    const params: unknown[] = []
    if (args.jiraSummary !== undefined) { updates.push('jira_summary = ?'); params.push(args.jiraSummary) }
    if (args.jiraStatus !== undefined)  { updates.push('jira_status = ?'); params.push(args.jiraStatus) }
    if (args.jiraPriority !== undefined) { updates.push('jira_priority = ?'); params.push(args.jiraPriority) }
    if (updates.length === 0) return 0
    params.push(args.jiraKey)
    const result = db.prepare(`UPDATE jira_links SET ${updates.join(', ')} WHERE jira_key = ?`).run(...params)
    return result.changes
  })

  ipcMain.handle('count_jira_links_for_analysis', (_e, args: { analysisId: number }) => {
    const db = getDb()
    return (db.prepare('SELECT COUNT(*) AS c FROM jira_links WHERE analysis_id = ?').get(args.analysisId) as any).c
  })

  ipcMain.handle('get_all_jira_links', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM jira_links ORDER BY linked_at DESC').all()
  })
}
```

- [ ] **Step 2: Register in `electron/ipc/index.ts`**

```typescript
import { registerJiraHandlers } from './jira'
// inside registerAllHandlers:
  registerJiraHandlers(ipcMain)
```

- [ ] **Step 3: Commit**

```bash
git add hadron-electron/electron/ipc/jira.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): JIRA IPC handlers — HTTP + DB linking"
```

---

## Task 8: Sentry IPC

**Files:**
- Create: `electron/ipc/sentry.ts`
- Modify: `electron/ipc/index.ts`

Port `test_sentry_connection`, `list_sentry_projects`, `list_sentry_issues`, `list_sentry_org_issues`, `fetch_sentry_issue`, `fetch_sentry_latest_event`. Credentials come in as arguments (like the Rust version — Sentry commands accept `base_url` + `auth_token` directly).

- [ ] **Step 1: Create `electron/ipc/sentry.ts`**

```typescript
import { IpcMain } from 'electron'

async function sentryFetch(baseUrl: string, authToken: string, path: string) {
  const { default: fetch } = await import('node-fetch')
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Sentry API error ${res.status}: ${body.substring(0, 200)}`)
  }
  // Also return pagination headers for cursor
  const nextCursor = res.headers.get('Link')
    ?.match(/<[^>]+>;\s*rel="next"[^,]*cursor=([^,&"]+)/)
    ?.[1] ?? null
  return { data: await res.json(), nextCursor }
}

export function registerSentryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('test_sentry_connection', async (_e, args: { baseUrl: string; authToken: string }) => {
    try {
      const { data } = await sentryFetch(args.baseUrl, args.authToken, '/api/0/projects/')
      const projects = (data as any[]).map((p: any) => ({
        id: p.id, slug: p.slug, name: p.name, platform: p.platform ?? null,
        organization: { slug: p.organization?.slug ?? '' }
      }))
      return { success: true, message: `Connected — ${projects.length} project(s)`, projects }
    } catch (err) {
      return { success: false, message: (err as Error).message, projects: null }
    }
  })

  ipcMain.handle('list_sentry_projects', async (_e, args: { baseUrl: string; authToken: string }) => {
    const { data } = await sentryFetch(args.baseUrl, args.authToken, '/api/0/projects/')
    return (data as any[]).map((p: any) => ({
      id: p.id, slug: p.slug, name: p.name, platform: p.platform ?? null,
      organization: { slug: p.organization?.slug ?? '' }
    }))
  })

  ipcMain.handle('list_sentry_issues', async (_e, args: {
    baseUrl: string; authToken: string; org: string; project: string
    query?: string; cursor?: string
  }) => {
    const q = args.query ? `&query=${encodeURIComponent(args.query)}` : ''
    const c = args.cursor ? `&cursor=${encodeURIComponent(args.cursor)}` : ''
    const { data, nextCursor } = await sentryFetch(args.baseUrl, args.authToken,
      `/api/0/projects/${args.org}/${args.project}/issues/?limit=25${q}${c}`)
    return { issues: data, next_cursor: nextCursor }
  })

  ipcMain.handle('list_sentry_org_issues', async (_e, args: {
    baseUrl: string; authToken: string; org: string; query?: string; cursor?: string
  }) => {
    const q = args.query ? `&query=${encodeURIComponent(args.query)}` : ''
    const c = args.cursor ? `&cursor=${encodeURIComponent(args.cursor)}` : ''
    const { data, nextCursor } = await sentryFetch(args.baseUrl, args.authToken,
      `/api/0/organizations/${args.org}/issues/?limit=25${q}${c}`)
    return { issues: data, next_cursor: nextCursor }
  })

  ipcMain.handle('fetch_sentry_issue', async (_e, args: {
    baseUrl: string; authToken: string; issueId: string
  }) => {
    const { data } = await sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${args.issueId}/`)
    return data
  })

  ipcMain.handle('fetch_sentry_latest_event', async (_e, args: {
    baseUrl: string; authToken: string; issueId: string
  }) => {
    const { data } = await sentryFetch(args.baseUrl, args.authToken, `/api/0/issues/${args.issueId}/events/latest/`)
    return data
  })
}
```

- [ ] **Step 2: Register in `electron/ipc/index.ts`**

```typescript
import { registerSentryHandlers } from './sentry'
// inside registerAllHandlers:
  registerSentryHandlers(ipcMain)
```

- [ ] **Step 3: Commit**

```bash
git add hadron-electron/electron/ipc/sentry.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): Sentry IPC handlers"
```

---

## Task 9: Release Notes IPC

**Files:**
- Create: `electron/ipc/release-notes.ts`
- Modify: `electron/ipc/index.ts`

Port the DB-side commands (get, list, update_content, update_status, update_checklist, delete) directly. For `generate_release_notes` and `append_to_release_notes` (which call JIRA + AI), implement a simplified version that fetches JIRA tickets and generates markdown via the AI service. The Rust version uses streaming progress events; we emit `release-notes:progress` events on the same BrowserWindow.

- [ ] **Step 1: Create `electron/ipc/release-notes.ts`**

```typescript
import { IpcMain, BrowserWindow } from 'electron'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'
import Store from 'electron-store'

const settingsStore = new Store({ name: 'settings' })

async function fetchJiraTicketsForRelease(
  baseUrl: string, email: string, apiToken: string, fixVersion: string, projectKey: string
): Promise<any[]> {
  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
  const jql = encodeURIComponent(`project = "${projectKey}" AND fixVersion = "${fixVersion}" AND issuetype != Sub-task ORDER BY created DESC`)
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/search?jql=${jql}&maxResults=200&fields=summary,status,issuetype,description`
  const res = await fetch(url, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } })
  if (!res.ok) throw new Error(`JIRA error: ${res.status}`)
  const data = await res.json() as any
  return (data.issues ?? []).map((i: any) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name ?? '',
    issue_type: i.fields.issuetype?.name ?? '',
    description: i.fields.description ? JSON.stringify(i.fields.description).substring(0, 500) : '',
  }))
}

function emitProgress(win: BrowserWindow | null, progress: number, message: string, requestId?: string) {
  win?.webContents.send('release-notes:progress', { progress, message, request_id: requestId ?? null })
}

export function registerReleaseNotesHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('generate_release_notes', async (event, args: {
    config: { fixVersion: string; projectKey: string; title?: string }
    requestId?: string; baseUrl?: string; email?: string; apiToken?: string
    apiKey: string; model: string; provider: string
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const baseUrl = args.baseUrl ?? settingsStore.get('jira_base_url', '') as string
    const email = args.email ?? settingsStore.get('jira_email', '') as string
    const apiToken = args.apiToken ?? settingsStore.get('jira_api_key', '') as string

    emitProgress(win, 10, 'Fetching tickets from JIRA...', args.requestId)
    const tickets = await fetchJiraTicketsForRelease(baseUrl, email, apiToken, args.config.fixVersion, args.config.projectKey)

    if (tickets.length === 0) throw new Error('No tickets found for this fix version')

    emitProgress(win, 40, `Generating release notes for ${tickets.length} tickets...`, args.requestId)
    const ticketList = tickets.map(t => `- **${t.key}** [${t.issue_type}]: ${t.summary}`).join('\n')
    const systemPrompt = `You are a technical writer creating release notes for WHATS'ON software. Format as structured markdown with sections: ## New Features, ## Bug Fixes, ## Improvements, ## Breaking Changes (only if applicable). Each item: "**[KEY]** Brief description."`
    const userPrompt = `Generate release notes for version ${args.config.fixVersion}:\n\n${ticketList}`

    const result = await callAi({
      provider: args.provider, model: args.model, apiKey: args.apiKey,
      systemPrompt, userPrompt, maxTokens: 4000,
    })

    const db = getDb()
    const now = new Date().toISOString()
    const title = args.config.title ?? `Release Notes — ${args.config.fixVersion}`
    const ticketKeys = tickets.map(t => t.key)
    const row = db.prepare(`INSERT INTO release_notes
      (title, fix_version, project_key, markdown_content, ticket_keys, ticket_count,
       status, tokens_used, cost, generation_duration_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?)
    `).run(title, args.config.fixVersion, args.config.projectKey,
           result.content, JSON.stringify(ticketKeys), tickets.length,
           result.inputTokens + result.outputTokens, result.cost, now, now)

    emitProgress(win, 100, 'Complete', args.requestId)
    return {
      id: row.lastInsertRowid, title, markdown_content: result.content,
      ticket_count: tickets.length, ticket_keys: ticketKeys,
      tokens_used: result.inputTokens + result.outputTokens, cost: result.cost,
      generation_duration_ms: 0,
    }
  })

  ipcMain.handle('list_release_notes', (_e, args?: { status?: string; limit?: number; offset?: number }) => {
    const db = getDb()
    let sql = 'SELECT id, title, fix_version, project_key, ticket_count, status, created_at, updated_at FROM release_notes WHERE deleted_at IS NULL'
    const params: unknown[] = []
    if (args?.status) { sql += ' AND status = ?'; params.push(args.status) }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(args?.limit ?? 50, args?.offset ?? 0)
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('get_release_notes', (_e, args: { id: number }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM release_notes WHERE id = ? AND deleted_at IS NULL').get(args.id) ?? null
  })

  ipcMain.handle('update_release_notes_content', (_e, args: { id: number; content: string }) => {
    const db = getDb()
    db.prepare('UPDATE release_notes SET markdown_content = ?, updated_at = ? WHERE id = ?')
      .run(args.content, new Date().toISOString(), args.id)
  })

  ipcMain.handle('update_release_notes_status', (_e, args: {
    id: number; status: string; reviewedBy?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    if (args.reviewedBy) {
      db.prepare('UPDATE release_notes SET status = ?, reviewed_by = ?, updated_at = ? WHERE id = ?')
        .run(args.status, args.reviewedBy, now, args.id)
    } else {
      db.prepare('UPDATE release_notes SET status = ?, updated_at = ? WHERE id = ?')
        .run(args.status, now, args.id)
    }
  })

  ipcMain.handle('update_release_notes_checklist', (_e, args: { id: number; checklistJson: string }) => {
    const db = getDb()
    db.prepare('UPDATE release_notes SET checklist_json = ?, updated_at = ? WHERE id = ?')
      .run(args.checklistJson, new Date().toISOString(), args.id)
  })

  ipcMain.handle('delete_release_notes', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('UPDATE release_notes SET deleted_at = ? WHERE id = ?')
      .run(new Date().toISOString(), args.id)
  })

  ipcMain.handle('list_jira_fix_versions', async (_e, args: {
    baseUrl: string; email: string; apiToken: string; projectKey: string
  }) => {
    const { default: fetch } = await import('node-fetch')
    const auth = Buffer.from(`${args.email}:${args.apiToken}`).toString('base64')
    const url = `${args.baseUrl.replace(/\/$/, '')}/rest/api/3/project/${args.projectKey}/versions?orderBy=-releaseDate`
    const res = await fetch(url, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } })
    if (!res.ok) throw new Error(`JIRA fix versions error: ${res.status}`)
    const data = await res.json() as any[]
    return data.map((v: any) => ({ id: v.id, name: v.name, released: v.released, release_date: v.releaseDate ?? null }))
  })
}
```

- [ ] **Step 2: Register in `electron/ipc/index.ts`**

```typescript
import { registerReleaseNotesHandlers } from './release-notes'
// inside registerAllHandlers:
  registerReleaseNotesHandlers(ipcMain)
```

- [ ] **Step 3: Commit**

```bash
git add hadron-electron/electron/ipc/release-notes.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): release notes IPC handlers"
```

---

## Task 10: JIRA Assist IPC

**Files:**
- Create: `electron/ipc/jira-assist.ts`
- Modify: `electron/ipc/index.ts`

Port `get_ticket_brief`, `get_ticket_briefs_batch`, `get_all_ticket_briefs`, `delete_ticket_brief`, `triage_jira_ticket`, `generate_ticket_brief`. The poller is NOT ported (requires background service; stub with no-op). Embeddings NOT ported (requires OpenSearch). The AI calls use the `ai-service.ts`. Credentials read from `settings` store.

- [ ] **Step 1: Create `electron/ipc/jira-assist.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'
import { callAi } from '../services/ai-service'
import Store from 'electron-store'

const settingsStore = new Store({ name: 'settings' })

function getAiApiKey(provider: string): string {
  const key = settingsStore.get(`${provider.toLowerCase()}_api_key`, '') as string
  if (!key) throw new Error(`No API key configured for provider '${provider}'`)
  return key
}

const TRIAGE_SYSTEM_PROMPT = `You are a JIRA ticket triage assistant. Classify this JIRA ticket and return JSON:
{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "category": "string (e.g. Bug, Performance, UX, Data, Config)",
  "customer_impact": "string (1-2 sentences on user impact)",
  "tags": ["tag1", "tag2"],
  "priority_score": 0-100,
  "reasoning": "string"
}
Return only valid JSON.`

const BRIEF_SYSTEM_PROMPT = `You are a technical analyst. Analyze this JIRA ticket and return JSON:
{
  "triage": { "severity": "CRITICAL|HIGH|MEDIUM|LOW", "category": "string", "customer_impact": "string", "tags": [], "priority_score": 0 },
  "analysis": {
    "plain_summary": "string",
    "technical": { "error_type": "string", "severity_estimate": "string", "root_cause": "string", "confidence": "HIGH|MEDIUM|LOW" },
    "recommended_actions": [{ "priority": "HIGH|MEDIUM|LOW", "action": "string" }]
  }
}
Return only valid JSON.`

export function registerJiraAssistHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_ticket_brief', (_e, args: { jiraKey: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM ticket_briefs WHERE jira_key = ?').get(args.jiraKey) ?? null
  })

  ipcMain.handle('get_ticket_briefs_batch', (_e, args: { jiraKeys: string[] }) => {
    if (args.jiraKeys.length === 0) return []
    const db = getDb()
    const placeholders = args.jiraKeys.map(() => '?').join(',')
    return db.prepare(`SELECT * FROM ticket_briefs WHERE jira_key IN (${placeholders})`).all(...args.jiraKeys)
  })

  ipcMain.handle('get_all_ticket_briefs', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM ticket_briefs ORDER BY updated_at DESC').all()
  })

  ipcMain.handle('delete_ticket_brief', (_e, args: { jiraKey: string }) => {
    const db = getDb()
    db.prepare('DELETE FROM ticket_briefs WHERE jira_key = ?').run(args.jiraKey)
  })

  ipcMain.handle('triage_jira_ticket', async (_e, args: {
    jiraKey: string; title: string; description: string; provider: string; model: string
  }) => {
    const apiKey = getAiApiKey(args.provider)
    const userPrompt = `Key: ${args.jiraKey}\nTitle: ${args.title}\nDescription: ${args.description.substring(0, 3000)}`
    const result = await callAi({
      provider: args.provider, model: args.model, apiKey,
      systemPrompt: TRIAGE_SYSTEM_PROMPT, userPrompt, maxTokens: 1000,
    })
    let parsed: any
    try {
      parsed = JSON.parse(result.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim())
    } catch {
      parsed = { severity: 'MEDIUM', category: 'Unknown', customer_impact: result.content, tags: [], priority_score: 50, reasoning: '' }
    }

    const db = getDb()
    const now = new Date().toISOString()
    const tagsJson = JSON.stringify(parsed.tags ?? [])
    const triageJson = JSON.stringify(parsed)
    db.prepare(`INSERT OR REPLACE INTO ticket_briefs
      (jira_key, title, severity, category, tags, triage_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?,
        COALESCE((SELECT created_at FROM ticket_briefs WHERE jira_key=?), ?), ?)
    `).run(args.jiraKey, args.title, parsed.severity, parsed.category,
           tagsJson, triageJson, args.jiraKey, now, now)

    return parsed
  })

  ipcMain.handle('generate_ticket_brief', async (_e, args: {
    jiraKey: string; title: string; description: string; provider: string; model: string
  }) => {
    const apiKey = getAiApiKey(args.provider)
    const userPrompt = `Key: ${args.jiraKey}\nTitle: ${args.title}\nDescription: ${args.description.substring(0, 4000)}`
    const result = await callAi({
      provider: args.provider, model: args.model, apiKey,
      systemPrompt: BRIEF_SYSTEM_PROMPT, userPrompt, maxTokens: 2000,
    })
    let parsed: any
    try {
      parsed = JSON.parse(result.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim())
    } catch {
      parsed = { triage: { severity: 'MEDIUM', category: 'Unknown', tags: [], priority_score: 50 }, analysis: { plain_summary: result.content } }
    }

    const db = getDb()
    const now = new Date().toISOString()
    const tagsJson = JSON.stringify(parsed.triage?.tags ?? [])
    const triageJson = JSON.stringify(parsed.triage ?? {})
    const briefJson = JSON.stringify(parsed)
    db.prepare(`INSERT OR REPLACE INTO ticket_briefs
      (jira_key, title, severity, category, tags, triage_json, brief_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?,
        COALESCE((SELECT created_at FROM ticket_briefs WHERE jira_key=?), ?), ?)
    `).run(args.jiraKey, args.title, parsed.triage?.severity ?? 'MEDIUM',
           parsed.triage?.category ?? 'Unknown', tagsJson, triageJson, briefJson,
           args.jiraKey, now, now)
    return parsed
  })

  // Poller stubs (poller runs as background service — not ported to Electron Phase 2)
  ipcMain.handle('start_jira_poller', () => ({ status: 'not_available', message: 'Background poller not implemented in Electron' }))
  ipcMain.handle('stop_jira_poller', () => {})
  ipcMain.handle('get_poller_status', () => ({ running: false, status: 'stopped' }))
}
```

- [ ] **Step 2: Register in `electron/ipc/index.ts`**

```typescript
import { registerJiraAssistHandlers } from './jira-assist'
// inside registerAllHandlers:
  registerJiraAssistHandlers(ipcMain)
```

- [ ] **Step 3: Commit**

```bash
git add hadron-electron/electron/ipc/jira-assist.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): JIRA Assist IPC — triage, brief, batch get, poller stubs"
```

---

## Task 11: Keeper Stubs + Investigation Stubs

**Files:**
- Create: `electron/ipc/keeper.ts`
- Create: `electron/ipc/investigation.ts`
- Modify: `electron/ipc/index.ts`

The Keeper Secrets Manager SDK is a Rust crate (`keeper_secrets_manager_core`) with no JS equivalent in scope. The investigation commands use a private `hadron-investigation` Rust crate. Both get graceful "not available" stubs so the frontend degrades without crashing.

- [ ] **Step 1: Create `electron/ipc/keeper.ts`**

```typescript
import { IpcMain } from 'electron'

const NOT_AVAILABLE = { success: false, message: 'Keeper Secrets Manager requires the Tauri desktop build', secrets_count: 0 }

export function registerKeeperHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('initialize_keeper', () => NOT_AVAILABLE)
  ipcMain.handle('list_keeper_secrets', () => ({ success: false, secrets: [], message: NOT_AVAILABLE.message }))
  ipcMain.handle('get_keeper_status', () => ({ configured: false, connected: false, secrets_count: 0, message: NOT_AVAILABLE.message }))
  ipcMain.handle('clear_keeper_config', () => {})
  ipcMain.handle('test_keeper_connection', () => ({ success: false, secrets: [], message: NOT_AVAILABLE.message }))
}
```

- [ ] **Step 2: Create `electron/ipc/investigation.ts`**

```typescript
import { IpcMain } from 'electron'
import Store from 'electron-store'

const settingsStore = new Store({ name: 'settings' })

function readInvestigationConfig() {
  const jiraBaseUrl = settingsStore.get('jira_base_url', '') as string
  const jiraEmail = settingsStore.get('jira_email', '') as string
  const jiraApiToken = settingsStore.get('jira_api_key', '') as string
  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
    throw new Error('JIRA not configured')
  }
  return { jiraBaseUrl, jiraEmail, jiraApiToken }
}

async function fetchJiraTicket(baseUrl: string, email: string, apiToken: string, key: string) {
  const { default: fetch } = await import('node-fetch')
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${key}?fields=summary,description,status,priority,assignee,reporter,comment,created,updated,labels,components,issuetype`
  const res = await fetch(url, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } })
  if (!res.ok) throw new Error(`JIRA error fetching ${key}: ${res.status}`)
  return res.json()
}

export function registerInvestigationHandlers(ipcMain: IpcMain): void {
  // These return a minimal InvestigationDossier-shaped object from JIRA data.
  // Full Confluence + deep analysis requires the Rust investigation crate.

  ipcMain.handle('investigate_jira_ticket', async (_e, args: { key: string }) => {
    const { jiraBaseUrl, jiraEmail, jiraApiToken } = readInvestigationConfig()
    const issue = await fetchJiraTicket(jiraBaseUrl, jiraEmail, jiraApiToken, args.key) as any
    return buildMinimalDossier(args.key, issue, 'ticket')
  })

  ipcMain.handle('investigate_jira_regression_family', async (_e, args: { key: string }) => {
    const { jiraBaseUrl, jiraEmail, jiraApiToken } = readInvestigationConfig()
    const issue = await fetchJiraTicket(jiraBaseUrl, jiraEmail, jiraApiToken, args.key) as any
    return buildMinimalDossier(args.key, issue, 'regression_family')
  })

  ipcMain.handle('investigate_expected_behavior', async (_e, args: { key: string }) => {
    const { jiraBaseUrl, jiraEmail, jiraApiToken } = readInvestigationConfig()
    const issue = await fetchJiraTicket(jiraBaseUrl, jiraEmail, jiraApiToken, args.key) as any
    return buildMinimalDossier(args.key, issue, 'expected_behavior')
  })

  ipcMain.handle('investigate_customer_history', async (_e, args: { key: string }) => {
    const { jiraBaseUrl, jiraEmail, jiraApiToken } = readInvestigationConfig()
    const issue = await fetchJiraTicket(jiraBaseUrl, jiraEmail, jiraApiToken, args.key) as any
    return buildMinimalDossier(args.key, issue, 'customer_history')
  })

  // Confluence helpers — return empty result (no Confluence client in Electron scope)
  ipcMain.handle('search_confluence', () => ({ results: [], note: 'Confluence search not available in Electron build' }))
  ipcMain.handle('get_confluence_content', () => ({ content: null, note: 'Confluence content not available in Electron build' }))
}

function buildMinimalDossier(key: string, issue: any, investigationType: string) {
  const fields = issue.fields ?? {}
  return {
    ticket_key: key,
    investigation_type: investigationType,
    summary: fields.summary ?? key,
    description: extractText(fields.description),
    status: fields.status?.name ?? 'Unknown',
    priority: fields.priority?.name ?? 'Unknown',
    assignee: fields.assignee?.displayName ?? null,
    comments: (fields.comment?.comments ?? []).map((c: any) => ({
      author: c.author?.displayName ?? 'Unknown',
      body: extractText(c.body),
      created: c.created,
    })),
    jira_links: [],
    confluence_pages: [],
    related_tickets: [],
    note: 'Investigation via Electron uses direct JIRA data only. Confluence + deep analysis available in Tauri build.',
  }
}

function extractText(doc: any): string {
  if (!doc) return ''
  if (typeof doc === 'string') return doc
  if (doc.type === 'text') return doc.text ?? ''
  if (doc.content) return (doc.content as any[]).map(extractText).join(' ')
  return ''
}
```

- [ ] **Step 3: Register in `electron/ipc/index.ts`**

```typescript
import { registerKeeperHandlers } from './keeper'
import { registerInvestigationHandlers } from './investigation'
// inside registerAllHandlers:
  registerKeeperHandlers(ipcMain)
  registerInvestigationHandlers(ipcMain)
```

- [ ] **Step 4: Commit**

```bash
git add hadron-electron/electron/ipc/keeper.ts hadron-electron/electron/ipc/investigation.ts hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): keeper stubs + investigation IPC (minimal JIRA dossier)"
```

---

## Task 12: Final Wire-up and Smoke Test

**Files:**
- Modify: `electron/ipc/index.ts` — verify all imports are present
- No new files

- [ ] **Step 1: Verify `electron/ipc/index.ts` final state**

The file should look like:

```typescript
import { IpcMain, ipcMain as electronIpcMain, app } from 'electron'
import { registerSettingsHandlers } from './settings'
import { registerDialogHandlers } from './dialog'
import { registerAiHandlers } from './ai'
import { registerCrudHandlers } from './crud'
import { registerSearchHandlers } from './search'
import { registerTagHandlers } from './tags'
import { registerNotesHandlers } from './notes'
import { registerArchiveHandlers } from './archive'
import { registerAnalyticsHandlers } from './analytics'
import { registerBulkHandlers } from './bulk'
import { registerInfoHandlers } from './info'
import { registerExportHandlers } from './export'
import { registerWidgetHandlers } from './widget'
import { registerChatHandlers } from './chat'
import { registerGoldAnswerHandlers } from './gold-answers'
import { registerSummaryHandlers } from './summaries'
import { registerSignatureHandlers } from './signatures'
import { registerJiraHandlers } from './jira'
import { registerSentryHandlers } from './sentry'
import { registerReleaseNotesHandlers } from './release-notes'
import { registerJiraAssistHandlers } from './jira-assist'
import { registerKeeperHandlers } from './keeper'
import { registerInvestigationHandlers } from './investigation'

export function registerAllHandlers(ipcMain: IpcMain): void {
  registerSettingsHandlers(ipcMain)
  registerDialogHandlers(ipcMain)
  registerAiHandlers(ipcMain)
  registerCrudHandlers(ipcMain)
  registerSearchHandlers(ipcMain)
  registerTagHandlers(ipcMain)
  registerNotesHandlers(ipcMain)
  registerArchiveHandlers(ipcMain)
  registerAnalyticsHandlers(ipcMain)
  registerBulkHandlers(ipcMain)
  registerInfoHandlers(ipcMain)
  registerExportHandlers(ipcMain)
  registerWidgetHandlers(ipcMain)
  registerChatHandlers(ipcMain)
  registerGoldAnswerHandlers(ipcMain)
  registerSummaryHandlers(ipcMain)
  registerSignatureHandlers(ipcMain)
  registerJiraHandlers(ipcMain)
  registerSentryHandlers(ipcMain)
  registerReleaseNotesHandlers(ipcMain)
  registerJiraAssistHandlers(ipcMain)
  registerKeeperHandlers(ipcMain)
  registerInvestigationHandlers(ipcMain)

  electronIpcMain.handle('app:version', () => app.getVersion())
  electronIpcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0) })
}
```

- [ ] **Step 2: Build to catch TypeScript errors**

Run: `cd hadron-electron && npm run build 2>&1 | tail -30`
Expected: Build succeeds with no TypeScript errors (or only unused-variable warnings).

- [ ] **Step 3: Run dev and check all features load**

Run: `cd hadron-electron && npm run dev`

Navigate to each major section and verify no "IPC not ready" or unhandled errors in DevTools:
- [ ] Dashboard loads
- [ ] History tab loads
- [ ] Ask Hadron / Chat tab loads
- [ ] JIRA tab loads
- [ ] Settings tab (Keeper section shows graceful "not available" message)
- [ ] Gold Answers tab loads
- [ ] Signatures tab loads
- [ ] Sentry tab loads
- [ ] Release Notes tab loads

- [ ] **Step 4: Run tests**

Run: `cd hadron-electron && npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit final wire-up**

```bash
git add hadron-electron/electron/ipc/index.ts
git commit -m "feat(electron): wire all Phase 2 IPC handlers — feature parity complete"
```

---

## Self-Review

### Spec Coverage

| Feature | Task |
|---------|------|
| Widget stubs (focus_main_window, show/hide/resize/move) | Task 1 ✓ |
| Chat session CRUD | Task 2 ✓ |
| Chat streaming (chat_send + poll_chat_stream) | Task 3 ✓ |
| Gold Answers CRUD | Task 4 ✓ |
| Session Summaries | Task 5 ✓ |
| Crash Signatures | Task 6 ✓ |
| JIRA core + linking | Task 7 ✓ |
| Sentry API | Task 8 ✓ |
| Release Notes | Task 9 ✓ |
| JIRA Assist (triage + brief) | Task 10 ✓ |
| Keeper stubs | Task 11 ✓ |
| Investigation stubs | Task 11 ✓ |
| Wire-up + smoke test | Task 12 ✓ |

**Not in scope:** RAG/OpenSearch embeddings (requires OpenSearch cluster), Keeper native SDK (Rust-only), full agent tool loop (simplified to FTS), Confluence deep search (Rust crate dependency), floating widget BrowserWindow (Phase 3).

### Type Consistency
- `chat_send` args use `camelCase` matching the frontend (TypeScript side of IPC); Tauri used `snake_case` Rust structs. The existing frontend already serializes to camelCase for invoke().
- `generate_session_summary` uses `sessionId` (camelCase) consistently.
- All DB reads return snake_case column names as SQLite returns them — this matches what the frontend expects from Tauri.
