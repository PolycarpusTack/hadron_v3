# Bug Mitigation Plan — Code Review Findings (2026-05-08)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 5 Critical, 13 High, and 14 Medium severity bugs identified in the 2026-05-08 code review across the hadron-electron IPC, services, and renderer layers.

**Architecture:** Fixes are grouped by subsystem (security, database, MCP client, chat streaming, frontend display, React lifecycle, API contracts, miscellaneous IPC). Each task is independently deployable and test-verified before moving on.

**Tech Stack:** Electron 28+, TypeScript, React 18, better-sqlite3, vitest, node-fetch (main process), electron-store, electron-safeStorage

---

## Blast Radius Key

Each task includes a **Blast Radius** section that rates:
- **Scope** — which files change
- **Risk if fix is wrong** — what breaks
- **Dependent callers** — who calls this code

---

## Quality Gate Definitions

Before merging any task:
1. `npm run test` passes (vitest)
2. `npm run typecheck` or `tsc --noEmit` passes
3. The specific test added for the bug passes
4. No new TypeScript errors in modified files
5. Manual smoke test described in the task passes

---

## Task 1: Security — `store:entries` exposes `secure-storage` to renderer (CRIT-1)

**Blast Radius:**
- **Scope:** `electron/ipc/settings.ts` (1 line change)
- **Risk if fix is wrong:** `store:entries` becomes too restrictive — returning `[]` for valid stores. All callers would silently get empty data.
- **Dependent callers:** `src/services/api.ts` uses `window.hadron.invoke('store:entries', ...)` for settings enumeration. Search all `.ts`/`.tsx` for `store:entries`.

**Quality Gate:** After fix, calling `store:entries` with `store: 'secure-storage'` must return `[]`, not credentials.

**Files:**
- Modify: `electron/ipc/settings.ts:53`
- Create: `tests/settings-store-security.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/settings-store-security.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

// We cannot invoke ipcMain handlers directly in unit tests, so we test
// the guard functions in isolation via a small extracted helper.
// This test confirms the guard logic, not the IPC wiring.

function isRendererWritable(name: string): boolean {
  return !name.startsWith('_')
}

const RENDERER_BLOCKED_STORES = new Set(['secure-storage'])
function isRendererReadable(name: string): boolean {
  return !name.startsWith('_') && !RENDERER_BLOCKED_STORES.has(name)
}

describe('store guard functions', () => {
  it('isRendererWritable allows secure-storage (BUG: was the bug)', () => {
    // This is what the OLD behaviour was — store:entries used isRendererWritable
    // which allows 'secure-storage'. This test documents the bug.
    expect(isRendererWritable('secure-storage')).toBe(true)
  })

  it('isRendererReadable blocks secure-storage (CORRECT behaviour)', () => {
    expect(isRendererReadable('secure-storage')).toBe(false)
  })

  it('isRendererReadable allows normal stores', () => {
    expect(isRendererReadable('settings')).toBe(true)
    expect(isRendererReadable('ui-state')).toBe(true)
  })

  it('isRendererReadable blocks underscore-prefixed stores', () => {
    expect(isRendererReadable('_internal')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to confirm it passes (documents the existing guard functions)**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npm run test -- tests/settings-store-security.test.ts
```

Expected: PASS (the guard functions are already correct; the bug is that `store:entries` uses the wrong one)

- [ ] **Step 3: Apply the one-line fix**

In `electron/ipc/settings.ts`, line 53, change:
```typescript
// BEFORE (bug — uses write guard, not read guard):
if (!isRendererWritable(store)) return []

// AFTER:
if (!isRendererReadable(store)) return []
```

- [ ] **Step 4: Add integration-level test for the IPC handler logic**

Add to `tests/settings-store-security.test.ts`:

```typescript
// Integration: simulate what the handler does with the corrected guard
describe('store:entries handler guard (integration sim)', () => {
  it('blocks secure-storage from being listed', () => {
    const store = 'secure-storage'
    // Simulate what the handler now does with the fix applied
    const allowed = isRendererReadable(store)
    expect(allowed).toBe(false)
    // Handler returns [] when allowed === false
  })

  it('allows settings store to be listed', () => {
    const store = 'settings'
    expect(isRendererReadable(store)).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
npm run test -- tests/settings-store-security.test.ts
```

Expected: All PASS

- [ ] **Step 6: Manual smoke**

Start the app in dev mode. Open DevTools in the renderer. Run:
```js
await window.hadron.invoke('store:entries', { store: 'secure-storage' })
```
Expected: returns `[]`, not an array of credential entries.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/settings.ts tests/settings-store-security.test.ts
git commit -m "fix(security): block secure-storage from store:entries — use isRendererReadable not isRendererWritable"
```

---

## Task 2: Security — JQL/CQL injection in chat-tools.ts (CRIT-3, CRIT-4, M5, M10)

**Blast Radius:**
- **Scope:** `electron/services/chat-tools.ts` (3 call sites), `electron/ipc/release-notes.ts` (1 call site)
- **Risk if fix is wrong:** JQL queries may fail to match valid accountIds if over-escaped. `escapeJqlString` already exists and handles the correct escaping for JIRA JQL string literals. Test that a normal accountId like `5a2d9f1e8b3c4a7d` still resolves correctly.
- **Dependent callers:** `toolNativeCustomerHistory`, `toolNativeSearchConfluence`, `find_similar_tickets` (gold answers LIKE), release-notes `jqlFilter` input.

**Quality Gate:** Injected `"` characters in any input must not break the resulting query string structure.

**Files:**
- Modify: `electron/services/chat-tools.ts` (lines 723, 737–738, 566–568)
- Modify: `electron/ipc/release-notes.ts` (lines 92–95, 373, 540–541)
- Create: `tests/query-escaping.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/query-escaping.test.ts
import { describe, it, expect } from 'vitest'

// Copy of the escapeJqlString function from chat-tools.ts for test isolation.
// The actual fix will use the function from the module.
function escapeJqlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeLikeWildcards(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

describe('JQL escaping', () => {
  it('escapes double quotes in accountId', () => {
    const malicious = 'user" OR project != "NONE'
    const jql = `reporter = "${escapeJqlString(malicious)}" ORDER BY created DESC`
    expect(jql).toBe('reporter = "user\\" OR project != \\"NONE" ORDER BY created DESC')
    // The JQL string literal is closed correctly — no injection
    expect(jql.split('"').length).toBe(4) // open + close pair only
  })

  it('escapes backslash in accountId', () => {
    const malicious = 'user\\whatever'
    const jql = `reporter = "${escapeJqlString(malicious)}" ORDER BY created DESC`
    expect(jql).toContain('\\\\"')
  })

  it('passes through normal accountId unchanged', () => {
    const normal = '5a2d9f1e8b3c4a7d'
    expect(escapeJqlString(normal)).toBe('5a2d9f1e8b3c4a7d')
  })
})

describe('CQL escaping (space_key)', () => {
  it('escapes double quotes in space_key', () => {
    const malicious = 'FOO" OR type=blogpost OR text ~ "'
    const escaped = escapeJqlString(malicious)
    const cql = `type=page AND space.key = "${escaped}"`
    // Should not contain unescaped closing quote that breaks the CQL string
    expect(cql).not.toMatch(/space\.key = "[^"]*[^\\]"/)
  })

  it('passes through normal space_key unchanged', () => {
    expect(escapeJqlString('MYSPACE')).toBe('MYSPACE')
  })
})

describe('LIKE wildcard escaping (gold answers)', () => {
  it('escapes % wildcard in search query', () => {
    const query = '%'
    const escaped = escapeLikeWildcards(query)
    expect(escaped).toBe('\\%')
  })

  it('escapes _ wildcard in search query', () => {
    const query = 'test_case'
    const escaped = escapeLikeWildcards(query)
    expect(escaped).toBe('test\\_case')
  })

  it('passes through normal search terms unchanged', () => {
    expect(escapeLikeWildcards('null pointer')).toBe('null pointer')
  })
})
```

- [ ] **Step 2: Run tests to confirm they pass (testing the escape functions themselves)**

```bash
npm run test -- tests/query-escaping.test.ts
```

Expected: PASS

- [ ] **Step 3: Apply JQL fix for `reporter.accountId` (chat-tools.ts line 723)**

Find the line:
```typescript
const jql = `reporter = "${reporter.accountId}" ORDER BY created DESC`
```
Change to:
```typescript
const jql = `reporter = "${escapeJqlString(reporter.accountId)}" ORDER BY created DESC`
```

`escapeJqlString` is already defined in the same file at approximately line 646. Verify the name before editing:
```bash
grep -n 'function escapeJqlString' /mnt/c/Projects/Hadron_v3/hadron-electron/electron/services/chat-tools.ts
```

- [ ] **Step 4: Apply CQL fix for `space_key` (chat-tools.ts lines 737–738)**

Find:
```typescript
if (args.space_key) cql += ` AND space.key = "${args.space_key}"`
```
Change to:
```typescript
if (args.space_key) cql += ` AND space.key = "${escapeJqlString(String(args.space_key))}"`
```

- [ ] **Step 5: Apply LIKE wildcard escaping (chat-tools.ts ~line 566–568)**

First, add the helper function near `escapeJqlString` in `chat-tools.ts`:
```typescript
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}
```

Then find the gold-answers LIKE query (search for `%${query}%`):
```typescript
// BEFORE:
.all(`%${query}%`, `%${query}%`)

// AFTER (also add ESCAPE '\\' to the SQL string above):
.all(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`)
```

The SQL itself must include `ESCAPE '\\'`:
```sql
-- BEFORE:
WHERE question LIKE ? OR answer LIKE ?

-- AFTER:
WHERE question LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\'
```

- [ ] **Step 6: Apply `jqlFilter` validation in release-notes.ts**

Find all three call sites of the raw `jqlFilter` pass-through. In `electron/ipc/release-notes.ts`, find lines like:
```typescript
const jql = args.config.jqlFilter ?? defaultJql
```

Add a validation helper at the top of the file (after imports):
```typescript
// JQL filter override is limited to a safe subset to prevent injection via
// the renderer-supplied value. Allows fixVersion, project, issuetype, status
// and ORDER BY clauses. Reject anything with function calls or sub-queries.
function validateJqlFilter(raw: string): string {
  if (/[(){}]/.test(raw)) throw new Error('jqlFilter must not contain parentheses or braces')
  if (raw.length > 500) throw new Error('jqlFilter exceeds maximum length')
  return raw
}
```

Then at each call site:
```typescript
// BEFORE:
const jql = args.config.jqlFilter ?? defaultJql

// AFTER:
const jql = args.config.jqlFilter != null
  ? validateJqlFilter(args.config.jqlFilter)
  : defaultJql
```

- [ ] **Step 7: Run all tests**

```bash
npm run test
```

Expected: PASS (all existing tests + new escaping tests)

- [ ] **Step 8: Commit**

```bash
git add electron/services/chat-tools.ts electron/ipc/release-notes.ts tests/query-escaping.test.ts
git commit -m "fix(security): escape JQL/CQL injection in chat-tools, validate jqlFilter, escape LIKE wildcards"
```

---

## Task 3: Database Integrity — `INSERT OR REPLACE` destroys preserved columns (HIGH-6, HIGH-7)

**Blast Radius:**
- **Scope:** `electron/ipc/jira-assist.ts` — two SQL blocks (~lines 284–303 and 362–381)
- **Risk if fix is wrong:** Upsert logic could stop creating new rows (if `INSERT OR IGNORE` is used incorrectly) or update the wrong columns. Test with both new-ticket and update-existing-ticket scenarios.
- **Dependent callers:** `triage_jira_ticket` IPC handler (called by poller and UI), `generate_ticket_brief` IPC handler. The `find_similar_tickets` and `post_brief_to_jira` handlers READ these columns — they will receive correct data after this fix.
- **Why this is critical:** Every call to `generate_ticket_brief` currently zeroes out `posted_to_jira`, `engineer_rating`, and `engineer_notes`. Users who have rated or annotated tickets lose that data silently on every refresh.

**Quality Gate:** After a ticket brief is generated, calling `generate_ticket_brief` again on the same ticket must not change `posted_to_jira`, `posted_at`, `engineer_rating`, or `engineer_notes` if they were already set.

**Files:**
- Modify: `electron/ipc/jira-assist.ts` (two SQL blocks)
- Create: `tests/jira-upsert-integrity.test.ts`

- [ ] **Step 1: Write failing tests that demonstrate data loss**

```typescript
// tests/jira-upsert-integrity.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../electron/migrations'

function setupDb() {
  const db = new Database(':memory:')
  runMigrations(db)
  return db
}

describe('ticket_briefs upsert integrity', () => {
  it('INSERT OR REPLACE + sub-SELECT always returns NULL (demonstrates the bug)', () => {
    const db = setupDb()
    const now = new Date().toISOString()

    // Insert initial row
    db.prepare(`
      INSERT INTO ticket_briefs (jira_key, title, severity, category, brief_json, posted_to_jira, engineer_rating, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('TEST-1', 'Title', 'HIGH', 'Bug', '{"brief":"initial"}', 1, 5, now, now)

    // Simulate the buggy REPLACE behaviour: REPLACE deletes first, then sub-SELECT returns NULL
    db.prepare(`
      INSERT OR REPLACE INTO ticket_briefs
        (jira_key, title, severity, category, brief_json,
         posted_to_jira, engineer_rating, created_at, updated_at)
      VALUES (
        ?, ?, ?, ?, ?,
        COALESCE((SELECT posted_to_jira FROM ticket_briefs WHERE jira_key=?), 0),
        COALESCE((SELECT engineer_rating FROM ticket_briefs WHERE jira_key=?), NULL),
        COALESCE((SELECT created_at FROM ticket_briefs WHERE jira_key=?), ?),
        ?
      )
    `).run('TEST-1', 'Updated Title', 'HIGH', 'Bug', '{"brief":"updated"}',
           'TEST-1', 'TEST-1', 'TEST-1', now, now)

    const row = db.prepare('SELECT * FROM ticket_briefs WHERE jira_key = ?').get('TEST-1') as Record<string, unknown>
    // BUG: posted_to_jira and engineer_rating are reset to 0/NULL because REPLACE deleted the row first
    expect(row.posted_to_jira).toBe(0)    // was 1 — data loss!
    expect(row.engineer_rating).toBe(null) // was 5 — data loss!
  })

  it('INSERT OR IGNORE + UPDATE preserves posted_to_jira and engineer_rating', () => {
    const db = setupDb()
    const now = new Date().toISOString()

    // Insert initial row
    db.prepare(`
      INSERT INTO ticket_briefs (jira_key, title, severity, category, brief_json, posted_to_jira, engineer_rating, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('TEST-2', 'Title', 'HIGH', 'Bug', '{"brief":"initial"}', 1, 5, now, now)

    // Correct approach: INSERT OR IGNORE to create if missing, then UPDATE mutable fields only
    db.prepare(`
      INSERT OR IGNORE INTO ticket_briefs (jira_key, title, severity, category, brief_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('TEST-2', 'Updated Title', 'HIGH', 'Bug', '{"brief":"updated"}', now, now)

    db.prepare(`
      UPDATE ticket_briefs SET title=?, severity=?, category=?, brief_json=?, updated_at=?
      WHERE jira_key=?
    `).run('Updated Title', 'HIGH', 'Bug', '{"brief":"updated"}', now, 'TEST-2')

    const row = db.prepare('SELECT * FROM ticket_briefs WHERE jira_key = ?').get('TEST-2') as Record<string, unknown>
    expect(row.posted_to_jira).toBe(1)  // preserved
    expect(row.engineer_rating).toBe(5) // preserved
    expect(row.title).toBe('Updated Title') // updated
  })

  it('INSERT OR IGNORE + UPDATE creates new rows correctly', () => {
    const db = setupDb()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT OR IGNORE INTO ticket_briefs (jira_key, title, severity, category, brief_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('TEST-3', 'New Ticket', 'LOW', 'Feature', '{"brief":"new"}', now, now)

    db.prepare(`
      UPDATE ticket_briefs SET title=?, severity=?, category=?, brief_json=?, updated_at=?
      WHERE jira_key=?
    `).run('New Ticket', 'LOW', 'Feature', '{"brief":"new"}', now, 'TEST-3')

    const row = db.prepare('SELECT * FROM ticket_briefs WHERE jira_key = ?').get('TEST-3') as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.jira_key).toBe('TEST-3')
    expect(row.posted_to_jira).toBe(0) // default
  })
})
```

- [ ] **Step 2: Run tests — first two should PASS (they verify the bug and the fix independently), third should PASS**

```bash
npm run test -- tests/jira-upsert-integrity.test.ts
```

Expected: All 3 PASS (they test the patterns, not the IPC handler directly)

- [ ] **Step 3: Fix `triage_jira_ticket` in `electron/ipc/jira-assist.ts`**

Find the `INSERT OR REPLACE INTO ticket_briefs` block inside `triage_jira_ticket` (around line 284–303). Replace the entire block with a two-statement INSERT OR IGNORE + UPDATE pattern:

```typescript
// BEFORE (buggy — sub-SELECTs always return NULL after REPLACE deletes the row):
db.prepare(`
  INSERT OR REPLACE INTO ticket_briefs
    (jira_key, title, severity, category, tags, triage_json,
     brief_json, brief_model, sources_json, posted_to_jira, posted_at,
     created_at, updated_at)
  VALUES (
    ?, ?, ?, ?, ?, ?,
    COALESCE((SELECT brief_json   FROM ticket_briefs WHERE jira_key=?), NULL),
    COALESCE((SELECT brief_model  FROM ticket_briefs WHERE jira_key=?), NULL),
    COALESCE((SELECT sources_json FROM ticket_briefs WHERE jira_key=?), NULL),
    COALESCE((SELECT posted_to_jira FROM ticket_briefs WHERE jira_key=?), 0),
    COALESCE((SELECT posted_at    FROM ticket_briefs WHERE jira_key=?), NULL),
    COALESCE((SELECT created_at   FROM ticket_briefs WHERE jira_key=?), ?),
    ?
  )
`).run(jiraKey, p.title, severity, category, tags, triage_json,
       jiraKey, jiraKey, jiraKey, jiraKey, jiraKey, jiraKey, now, now)

// AFTER (correct — INSERT OR IGNORE preserves the existing row if present,
//        UPDATE only touches the fields that triage owns):
const now = new Date().toISOString()
db.prepare(`
  INSERT OR IGNORE INTO ticket_briefs
    (jira_key, title, severity, category, tags, triage_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(jiraKey, p.title, severity, category, tags, triage_json, now, now)

db.prepare(`
  UPDATE ticket_briefs
  SET title=?, severity=?, category=?, tags=?, triage_json=?, updated_at=?
  WHERE jira_key=?
`).run(p.title, severity, category, tags, triage_json, now, jiraKey)
```

Adapt the exact field list by reading the actual INSERT column list in your file — the pattern above is the template.

- [ ] **Step 4: Fix `generate_ticket_brief` in `electron/ipc/jira-assist.ts`**

Find the `INSERT OR REPLACE INTO ticket_briefs` block inside `generate_ticket_brief` (around line 362–381). Apply the same two-statement pattern, but this time `generate_ticket_brief` owns `brief_json`, `brief_model`, `sources_json`:

```typescript
// AFTER:
const now = new Date().toISOString()
db.prepare(`
  INSERT OR IGNORE INTO ticket_briefs
    (jira_key, title, severity, category, tags, triage_json,
     brief_json, brief_model, sources_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(jiraKey, title, severity, category, tags, triageJson,
       briefJson, briefModel, sourcesJson, now, now)

db.prepare(`
  UPDATE ticket_briefs
  SET brief_json=?, brief_model=?, sources_json=?, updated_at=?
  WHERE jira_key=?
`).run(briefJson, briefModel, sourcesJson, now, jiraKey)
```

Fields `posted_to_jira`, `posted_at`, `engineer_rating`, `engineer_notes` are NOT in either UPDATE statement — they are only touched by `post_brief_to_jira` and `save_engineer_feedback` handlers, which is correct.

- [ ] **Step 5: Run all tests**

```bash
npm run test
```

Expected: PASS

- [ ] **Step 6: Manual smoke**

1. Triage a JIRA ticket.
2. Rate it (`engineer_rating = 5`).
3. Re-triage the same ticket.
4. Open the ticket in the UI — rating should still show 5.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/jira-assist.ts tests/jira-upsert-integrity.test.ts
git commit -m "fix(jira): replace INSERT OR REPLACE+sub-SELECT with INSERT OR IGNORE+UPDATE to stop destroying engineer_rating and posted_to_jira"
```

---

## Task 4: MCP Client Reliability (CRIT-2, M8, M9, HIGH-11)

**Blast Radius:**
- **Scope:** `electron/services/mcp-client.ts` (concurrency guard, buffer cap, stdin guard), `electron/ipc/settings.ts` (shutdown condition)
- **Risk if fix is wrong:** If the initPromise guard is wrong, `ensureInitialized` could deadlock (promise never resolves). Test both sequential and parallel call scenarios. If the shutdown guard is wrong, MCP client may never shut down when the user disables CodexMgX.
- **Dependent callers:** `callTool` (called by `executeTool` in `chat.ts`), `save_codexmgx_config` IPC handler (called from Settings UI)

**Quality Gate:**
- Two concurrent `ensureInitialized()` calls must not spawn two processes.
- Disabling CodexMgX in settings must shut down the process.
- Re-enabling must restart it.
- A frame with `Content-Length: 50000000` must not crash the process.

**Files:**
- Modify: `electron/services/mcp-client.ts`
- Modify: `electron/ipc/settings.ts` (~line 171)
- Create: `tests/mcp-client-reliability.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/mcp-client-reliability.test.ts
import { describe, it, expect, vi } from 'vitest'

// Test the initPromise guard pattern in isolation (no real child process)
describe('McpClient concurrency guard (pattern verification)', () => {
  it('concurrent calls to a promise-locked init run init only once', async () => {
    let callCount = 0

    class MockClient {
      private initialized = false
      private initPromise: Promise<void> | null = null

      async ensureInitialized(): Promise<void> {
        if (this.initialized) return
        if (!this.initPromise) {
          this.initPromise = this.start().finally(() => { this.initPromise = null })
        }
        return this.initPromise
      }

      private async start(): Promise<void> {
        callCount++
        await new Promise<void>(res => setTimeout(res, 10))
        this.initialized = true
      }
    }

    const client = new MockClient()
    // Three concurrent callers
    await Promise.all([
      client.ensureInitialized(),
      client.ensureInitialized(),
      client.ensureInitialized(),
    ])
    expect(callCount).toBe(1) // start() called exactly once
  })
})

describe('McpClient buffer size guard', () => {
  it('rejects oversized Content-Length frames', () => {
    const MAX_FRAME_BYTES = 10 * 1024 * 1024 // 10 MB

    function shouldRejectFrame(contentLength: number): boolean {
      return contentLength > MAX_FRAME_BYTES
    }

    expect(shouldRejectFrame(10 * 1024 * 1024 + 1)).toBe(true)
    expect(shouldRejectFrame(10 * 1024 * 1024)).toBe(false)
    expect(shouldRejectFrame(1024)).toBe(false)
    expect(shouldRejectFrame(999_999_999)).toBe(true)
  })
})

describe('save_codexmgx_config shutdown guard', () => {
  it('only shuts down when transitioning from enabled to disabled', () => {
    let shutdownCalled = false
    const shutdown = () => { shutdownCalled = true }

    function handleSave(wasEnabled: boolean, nowEnabled: boolean) {
      if (wasEnabled && !nowEnabled) shutdown()
    }

    // enabled → disabled: should shut down
    shutdownCalled = false
    handleSave(true, false)
    expect(shutdownCalled).toBe(true)

    // disabled → enabled: should NOT shut down
    shutdownCalled = false
    handleSave(false, true)
    expect(shutdownCalled).toBe(false)

    // enabled → enabled (no change): should NOT shut down
    shutdownCalled = false
    handleSave(true, true)
    expect(shutdownCalled).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm run test -- tests/mcp-client-reliability.test.ts
```

Expected: PASS

- [ ] **Step 3: Apply concurrency guard to `McpClient.ensureInitialized`**

In `electron/services/mcp-client.ts`, add the `initPromise` field to the class and update `ensureInitialized`:

```typescript
class McpClient {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private rawBuffer = Buffer.alloc(0)
  private initialized = false
  private tools: McpTool[] = []
  private initPromise: Promise<void> | null = null  // ADD THIS LINE

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = this.start().finally(() => { this.initPromise = null })
    }
    return this.initPromise
  }
  // rest of class unchanged
```

- [ ] **Step 4: Apply max frame size guard in `processBuffer`**

In `electron/services/mcp-client.ts`, find `processBuffer()` and add a frame-size check. Find the block where `contentLength` is parsed:

```typescript
private processBuffer(): void {
  while (true) {
    const headerEnd = this.rawBuffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const header = this.rawBuffer.slice(0, headerEnd).toString('ascii')
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) { this.rawBuffer = Buffer.alloc(0); break }
    const contentLength = parseInt(match[1], 10)

    // ADD THIS GUARD:
    const MAX_FRAME_BYTES = 10 * 1024 * 1024 // 10 MB
    if (contentLength > MAX_FRAME_BYTES) {
      log.error('[MCP] Oversized frame received, resetting buffer', { contentLength })
      this.rawBuffer = Buffer.alloc(0)
      break
    }

    const bodyStart = headerEnd + 4
    if (this.rawBuffer.length < bodyStart + contentLength) break
    // ... rest of existing processBuffer logic
```

- [ ] **Step 5: Replace non-null assertions in `writeFramed`**

Find `writeFramed` in `electron/services/mcp-client.ts`:

```typescript
// BEFORE:
private writeFramed(msg: unknown): void {
  const bodyBytes = Buffer.from(JSON.stringify(msg), 'utf8')
  const header = Buffer.from(`Content-Length: ${bodyBytes.length}\r\n\r\n`, 'ascii')
  this.process!.stdin!.write(Buffer.concat([header, bodyBytes]))
}

// AFTER:
private writeFramed(msg: unknown): void {
  if (!this.process?.stdin) throw new Error('MCP process stdin not available')
  const bodyBytes = Buffer.from(JSON.stringify(msg), 'utf8')
  const header = Buffer.from(`Content-Length: ${bodyBytes.length}\r\n\r\n`, 'ascii')
  this.process.stdin.write(Buffer.concat([header, bodyBytes]))
}
```

- [ ] **Step 6: Fix `save_codexmgx_config` to only shut down on state change**

In `electron/ipc/settings.ts`, find the `save_codexmgx_config` handler (~line 171):

```typescript
// BEFORE:
ipcMain.handle('save_codexmgx_config', (_e, args: { scriptPath: string; enabled: boolean }) => {
  if (typeof args.enabled !== 'boolean') throw new Error('enabled must be boolean')
  const s = getStore('settings')
  s.delete('codexmgx_script_path')
  s.set('codexmgx_enabled', args.enabled)
  shutdownMcpClient()
  return { ok: true }
})

// AFTER:
ipcMain.handle('save_codexmgx_config', (_e, args: { scriptPath: string; enabled: boolean }) => {
  if (typeof args.enabled !== 'boolean') throw new Error('enabled must be boolean')
  const s = getStore('settings')
  const wasEnabled = s.get('codexmgx_enabled', false) as boolean
  s.delete('codexmgx_script_path')
  s.set('codexmgx_enabled', args.enabled)
  if (wasEnabled && !args.enabled) shutdownMcpClient()
  return { ok: true }
})
```

- [ ] **Step 7: Run all tests**

```bash
npm run test
```

Expected: PASS

- [ ] **Step 8: Manual smoke**

1. Enable CodexMgX in settings. Confirm MCP process starts (check electron-log).
2. Start a chat with an MCP tool call in flight.
3. Open settings and save without changing the CodexMgX toggle — confirm the in-flight tool call completes normally.
4. Toggle CodexMgX off — confirm the MCP process terminates.

- [ ] **Step 9: Commit**

```bash
git add electron/services/mcp-client.ts electron/ipc/settings.ts tests/mcp-client-reliability.test.ts
git commit -m "fix(mcp): add init concurrency guard, frame size cap, stdin null guard; only shutdown MCP on disable"
```

---

## Task 5: Chat Streaming Correctness (HIGH-7 duplicate request_id, HIGH-8 GC timer, HIGH-9 synthesis history, M1 id validation)

**Blast Radius:**
- **Scope:** `electron/ipc/chat.ts` only
- **Risk if fix is wrong:** Changing stream state management could break the core chat polling loop. The `streams` map is the heart of the streaming system — any change must preserve the invariant that `poll_chat_stream` eventually receives `done: true` for every `chat_send`.
- **Dependent callers:** `chat_send` → `poll_chat_stream` cycle in renderer via `src/services/api.ts`.

**Quality Gate:** A chat message from start to finish (including tool calls) must produce a complete streamed response. Run the existing `analysis-progress.test.ts` as a regression check.

**Files:**
- Modify: `electron/ipc/chat.ts`
- Create: `tests/chat-streaming.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/chat-streaming.test.ts
import { describe, it, expect } from 'vitest'

// Test the stream map identity guard pattern
describe('stream GC timer identity guard', () => {
  it('timer only deletes the stream it was created for', () => {
    const streams = new Map<string, { done: boolean; pendingText: string }>()

    function streamCreate(id: string) {
      const s = { done: false, pendingText: '' }
      streams.set(id, s)
      return s
    }

    const ss1 = streamCreate('req-1')
    // Simulate: old GC timer for req-1 fires after a new req-1 was created
    const ss2 = streamCreate('req-1') // replaces ss1

    // The CORRECT guard (fixes HIGH-8):
    const guardedDelete = (id: string, ss: typeof ss1) => {
      if (streams.get(id) === ss) streams.delete(id)
    }

    // Timer from ss1 fires — should NOT delete ss2
    guardedDelete('req-1', ss1)
    expect(streams.has('req-1')).toBe(true) // ss2 still present
    expect(streams.get('req-1')).toBe(ss2)

    // Timer from ss2 fires — SHOULD delete
    guardedDelete('req-1', ss2)
    expect(streams.has('req-1')).toBe(false)
  })
})

describe('active stream abort before clobber (duplicate request_id)', () => {
  it('aborts existing non-done stream before creating a new one for same id', () => {
    const streams = new Map<string, { done: boolean; pendingText: string; controller: AbortController }>()
    let aborted = false

    function streamCreate(id: string) {
      const existing = streams.get(id)
      if (existing && !existing.done) {
        existing.controller.abort()
        existing.done = true
        aborted = true
        streams.delete(id)
      }
      const s = { done: false, pendingText: '', controller: new AbortController() }
      streams.set(id, s)
      return s
    }

    const ss1 = streamCreate('req-1')
    ss1.pendingText = 'partial'
    const ss2 = streamCreate('req-1') // should abort ss1, then create ss2
    expect(aborted).toBe(true)
    expect(streams.get('req-1')).toBe(ss2)
    expect(ss1.done).toBe(true)
  })
})

describe('chat_save_session id validation', () => {
  it('rejects undefined id', () => {
    function validateSessionId(id: unknown): string {
      if (!id || typeof id !== 'string') throw new Error('chat_save_session requires a non-empty string id')
      return id
    }
    expect(() => validateSessionId(undefined)).toThrow('requires a non-empty string id')
    expect(() => validateSessionId(null)).toThrow()
    expect(() => validateSessionId('')).toThrow()
    expect(validateSessionId('session-123')).toBe('session-123')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm run test -- tests/chat-streaming.test.ts
```

Expected: PASS

- [ ] **Step 3: Fix GC timer to use identity guard (chat.ts ~line 615–621)**

Find the `finally` block in `chat_send` handler:

```typescript
// BEFORE:
} finally {
  if (!ss.done) ss.done = true
  setTimeout(() => streams.delete(requestId), 30_000)
}

// AFTER:
} finally {
  if (!ss.done) ss.done = true
  setTimeout(() => { if (streams.get(requestId) === ss) streams.delete(requestId) }, 30_000)
}
```

- [ ] **Step 4: Fix duplicate `request_id` clobber (chat.ts ~line 326)**

Find where `streamCreate(requestId)` is called. Before that call, add the abort-existing check. Find `streamCreate` to understand its implementation — it likely does `streams.set(requestId, s)`. Add before the call:

```typescript
// Check for existing non-done stream before creating a new one
const existing = streams.get(requestId)
if (existing && !existing.done) {
  existing.controller?.abort()
  existing.done = true
  streams.delete(requestId)
}
const ss = streamCreate(requestId)
```

If `streamCreate` does its own `streams.set`, the call order is fine — the existing entry was already deleted. Verify `streamCreate`'s signature in chat.ts before editing.

- [ ] **Step 5: Fix `chat_save_session` id validation (~line 86)**

Find:
```typescript
const id = (p.id ?? (p as Record<string, unknown>).sessionId) as string
```
After that line, add:
```typescript
if (!id || typeof id !== 'string') throw new Error('chat_save_session requires a non-empty string id')
```

- [ ] **Step 6: Fix synthesis history (chat.ts ~line 458–459)**

Find `synthesisMessages`:
```typescript
// BEFORE:
let agentMessages: unknown[] = (args.messages ?? []).map(m => ({ role: m.role, content: m.content }))
const synthesisMessages = [...agentMessages]

// AFTER — synthesisMessages is a live reference, updated at end of tool loop:
let agentMessages: unknown[] = (args.messages ?? []).map(m => ({ role: m.role, content: m.content }))
// synthesisMessages will be set to the evolved agentMessages after the tool loop completes.
// Do NOT snapshot it here — the synthesis needs the full reasoning chain.
```

Then find the `callAiStreaming` call for synthesis (the second one, after the tool loop), and replace `synthesisMessages` with `agentMessages`:

```typescript
// BEFORE:
await callAiStreaming(..., synthesisMessages, ...)

// AFTER:
await callAiStreaming(..., agentMessages, ...)
```

And remove the `synthesisMessages` variable declaration entirely if it is now unused.

- [ ] **Step 7: Run all tests**

```bash
npm run test
```

Expected: PASS including `analysis-progress.test.ts`

- [ ] **Step 8: Manual smoke**

Start a chat that triggers at least one tool call. Confirm the final synthesized response is coherent and references the tool results (not just the original user message).

- [ ] **Step 9: Commit**

```bash
git add electron/ipc/chat.ts tests/chat-streaming.test.ts
git commit -m "fix(chat): GC timer identity guard, abort duplicate streams, validate session id, pass agent history to synthesis"
```

---

## Task 6: Frontend Data Display Bugs (HIGH-12 confidence ×100, HIGH-13 unit labels, HIGH-14 activeTab crash, M14 invoke generic)

**Blast Radius:**
- **Scope:** `src/components/PerformanceAnalyzerView.tsx` (3 line changes), `src/lib/electron-types.d.ts` (1 line change)
- **Risk if fix is wrong:** Removing the `* 100` from the export path could hide a genuine scale difference if the backend returns 0–1 floats. Confirm by checking what `DetectedPattern.confidence` looks like in a real response — line 541 renders it as an integer percentage without multiplication, which is the authoritative display path.
- **Dependent callers:** `buildExportSource` (export path), `AnalysisResultView` (display path). The `export_analysis` IPC handler receives the export string — this fix only changes what string is produced.

**Quality Gate:** Export a performance analysis report and confirm confidence values match what is shown in the UI tab.

**Files:**
- Modify: `src/components/PerformanceAnalyzerView.tsx` (lines 668, 648, 732/951)
- Modify: `src/lib/electron-types.d.ts` (line 6)

- [ ] **Step 1: Fix confidence ×100 in export (line 668)**

Find in `buildExportSource` the line:
```typescript
.map((p) => `**[${p.severity.toUpperCase()}] ${p.title}** (${(p.confidence * 100).toFixed(0)}% confidence)`)
```
Change to:
```typescript
.map((p) => `**[${p.severity.toUpperCase()}] ${p.title}** (${p.confidence.toFixed(0)}% confidence)`)
```

- [ ] **Step 2: Fix unit labels in export (line 648)**

Find in `buildExportSource` the line containing `active_time` and `real_time` with the `ms` suffix:
```typescript
`**Active Time:** ${h.active_time.toFixed(1)}ms | **Real Time:** ${h.real_time.toFixed(1)}ms`
```
Change to:
```typescript
`**Active Time:** ${h.active_time.toFixed(1)}s | **Real Time:** ${h.real_time.toFixed(1)}s`
```

- [ ] **Step 3: Fix activeTab not reset at start of `handleAnalyze` (~line 732)**

Find `handleAnalyze` and the `setAnalysisResults([])` call at the start. Add `setActiveTab(0)` immediately before or after it:

```typescript
// BEFORE:
setAnalysisResults([])
setIsAnalyzing(true)

// AFTER:
setAnalysisResults([])
setActiveTab(0)      // reset tab before results arrive to prevent undefined[activeTab] access
setIsAnalyzing(true)
```

- [ ] **Step 4: Fix `invoke` type declaration in `electron-types.d.ts` (line 6)**

Find:
```typescript
invoke(channel: string, args?: unknown): Promise<unknown>
```
Change to:
```typescript
invoke<T = unknown>(channel: string, args?: unknown): Promise<T>
```

- [ ] **Step 5: Run typecheck**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npx tsc --noEmit
```

Expected: 0 errors (the generic addition is backwards-compatible)

- [ ] **Step 6: Manual smoke**

1. Run a performance analysis on a file.
2. Export the results as Markdown.
3. Confirm: confidence values in the export match what the UI tab shows.
4. Confirm: time values in the export show `s` not `ms`.
5. Select tab 2 from a previous analysis, then run a new analysis — confirm no crash and tab resets to 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/PerformanceAnalyzerView.tsx src/lib/electron-types.d.ts
git commit -m "fix(perf-analyzer): remove double confidence multiply, fix unit labels in export, reset activeTab on new analysis; make invoke generic"
```

---

## Task 7: React Lifecycle — Listener Leak, Stuck Progress Bar, Widget Cleanup (CRIT-5, HIGH-15, M12, M13)

**Blast Radius:**
- **Scope:** `src/App.tsx` (listener setup), `src/components/ReleaseNotesView.tsx` (request ID filter), `src/components/widget/WidgetApp.tsx` (position restore, unlisten cleanup)
- **Risk if fix is wrong:** Changes to the `setupListeners` flow in App.tsx affect every IPC event the app receives. The ReleaseNotesView fix changes which progress events are accepted — if the logic is inverted again, progress will stop updating entirely rather than getting stuck.
- **Dependent callers:** `setupListeners` runs once on mount and its listeners receive `open-analysis`, `open-analysis-from-file`, and other app-level events.

**Quality Gate:**
- Unmount and remount the main view — no duplicate event handlers fire.
- Complete a release notes generation — progress bar disappears after completion.
- Kill and restart the widget — position is restored; a corrupted localStorage entry does not crash the widget.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ReleaseNotesView.tsx`
- Modify: `src/components/widget/WidgetApp.tsx`

- [ ] **Step 1: Fix App.tsx listener race (CRIT-5)**

Find `setupListeners` in `src/App.tsx`. The function is async and called without `await`. The fix has two parts:

**Part A** — await the setup in `useEffect`:
```typescript
// BEFORE:
useEffect(() => {
  let cancelled = false
  setupListeners()  // not awaited

  return () => {
    cancelled = true
    unlisteners.forEach(u => u())
  }
}, [])

// AFTER:
useEffect(() => {
  let cancelled = false
  let cleanupFns: Array<() => void> = []

  setupListeners().then((fns) => {
    if (cancelled) {
      fns.forEach(fn => fn())  // if already unmounted, immediately unlisten
    } else {
      cleanupFns = fns
    }
  })

  return () => {
    cancelled = true
    cleanupFns.forEach(fn => fn())
  }
}, [])
```

**Part B** — refactor `setupListeners` to return the unlisten functions:
```typescript
async function setupListeners(): Promise<Array<() => void>> {
  const fns: Array<() => void> = []

  const unlistenOpenAnalysis = await listen('open-analysis', (event) => { ... })
  fns.push(unlistenOpenAnalysis)

  // ... all other listeners pushed to fns

  return fns
}
```

Read the actual `setupListeners` function body in `src/App.tsx` before editing — adapt the pattern to the actual listeners registered. The key invariant is: every `await listen(...)` result must be pushed to `fns` and returned.

- [ ] **Step 2: Fix ReleaseNotesView stuck progress bar (HIGH-15)**

In `src/components/ReleaseNotesView.tsx`, find the request ID filter block (~lines 56–61):

```typescript
// BEFORE (inverted logic drops the "complete" event after ref is cleared):
const payloadRequestId = payload.requestId || null;
const currentRequestId = activeRequestIdRef.current;
if (currentRequestId) {
  if (payloadRequestId !== currentRequestId) return;
} else if (payloadRequestId) {
  return;  // BUG: this drops "complete" when ref was already cleared
}

// AFTER (accept events that match a known requestId, or have no requestId):
const payloadRequestId = payload.requestId || null;
const currentRequestId = activeRequestIdRef.current;
if (currentRequestId && payloadRequestId && payloadRequestId !== currentRequestId) {
  return;  // Only drop events from a different active request
}
```

- [ ] **Step 3: Fix WidgetApp.tsx JSON.parse without guard (~line 81–85)**

In `src/components/widget/WidgetApp.tsx`, find the position restore block:

```typescript
// BEFORE:
const saved = localStorage.getItem(POSITION_STORAGE_KEY);
if (saved) {
  const { x, y } = JSON.parse(saved);
  await invoke("move_widget", { x, y });
}

// AFTER:
const saved = localStorage.getItem(POSITION_STORAGE_KEY);
if (saved) {
  try {
    const parsed = JSON.parse(saved) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).x === 'number' &&
      typeof (parsed as Record<string, unknown>).y === 'number'
    ) {
      const { x, y } = parsed as { x: number; y: number };
      await invoke("move_widget", { x, y });
    } else {
      localStorage.removeItem(POSITION_STORAGE_KEY);
    }
  } catch {
    localStorage.removeItem(POSITION_STORAGE_KEY);
  }
}
```

- [ ] **Step 4: Fix WidgetApp.tsx unlisten cleanup promise (~lines 94–100)**

Find the `listen(...)` cleanup:
```typescript
// BEFORE:
const unlisten = listen<{ enabled: boolean }>("settings:hover-button-changed", (event) => { ... });
return () => { unlisten.then(fn => fn()); };

// AFTER:
const unlisten = listen<{ enabled: boolean }>("settings:hover-button-changed", (event) => { ... });
return () => { unlisten.then(fn => fn()).catch(() => {}); };
```

- [ ] **Step 5: Run tests**

```bash
npm run test
```

Expected: PASS

- [ ] **Step 6: Manual smoke**

1. Open settings, generate release notes. Confirm progress bar disappears when done.
2. Corrupt `hadron-widget-position` in DevTools → Application → LocalStorage (set it to `"invalid"`). Reload the widget — confirm no crash and the key is cleared.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/ReleaseNotesView.tsx src/components/widget/WidgetApp.tsx
git commit -m "fix(react): fix listener leak in setupListeners, unstick release notes progress bar, guard widget position parse"
```

---

## Task 8: API Contract Correctness (HIGH-16 limit=-1, HIGH-17 toggleTranslationFavorite, HIGH-18 Keeper sentinel)

**Blast Radius:**
- **Scope:** `src/services/api.ts` (pagination, toggle), `src/App.tsx` (Keeper sentinel)
- **Risk if fix is wrong:** Changing the Keeper sentinel approach affects every place `apiKey` flows to backend commands. Test with both Keeper and non-Keeper modes.
- **Dependent callers:** `getAnalyses`, `listAnalyses` — any component that requests analyses with `limit: -1` expecting all records. `TranslationView` or equivalent — any UI that calls `toggleTranslationFavorite`.

**Quality Gate:**
- `getAnalyses({ limit: -1 })` must return all records, not just 50.
- After toggling a translation favorite, the UI must reflect the actual new boolean state.
- Keeper-mode analysis must not fail with 401.

**Files:**
- Modify: `src/services/api.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write tests**

```typescript
// tests/api-contracts.test.ts
import { describe, it, expect } from 'vitest'

describe('pagination limit sentinel', () => {
  it('-1 limit should not be silently clamped', () => {
    function calcPagination(limit: number, offset: number) {
      if (limit === -1) return { page_size: -1, page: 1 }  // pass through to backend
      const page_size = limit > 0 ? limit : 50
      const page = Math.floor(offset / page_size) + 1
      return { page_size, page }
    }

    const result = calcPagination(-1, 0)
    expect(result.page_size).toBe(-1)  // must not be clamped to 50
  })

  it('normal limit calculates correctly', () => {
    function calcPagination(limit: number, offset: number) {
      if (limit === -1) return { page_size: -1, page: 1 }
      const page_size = limit > 0 ? limit : 50
      const page = Math.floor(offset / page_size) + 1
      return { page_size, page }
    }

    expect(calcPagination(25, 50)).toEqual({ page_size: 25, page: 3 })
    expect(calcPagination(50, 0)).toEqual({ page_size: 50, page: 1 })
  })
})

describe('Keeper sentinel should not reach backend as api_key', () => {
  it('apiKey of "keeper-managed" is intercepted before forwarding', () => {
    function resolveApiKeyForBackend(apiKey: string, keeperActive: boolean): string | null {
      if (keeperActive && apiKey === 'keeper-managed') return null  // backend fetches its own key
      return apiKey
    }

    expect(resolveApiKeyForBackend('keeper-managed', true)).toBeNull()
    expect(resolveApiKeyForBackend('sk-abc123', false)).toBe('sk-abc123')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm run test -- tests/api-contracts.test.ts
```

Expected: First test FAILS (demonstrates the bug), others PASS.

- [ ] **Step 3: Fix `limit = -1` in `src/services/api.ts` (~lines 315–326)**

Find the pagination calculation and add the sentinel pass-through:

```typescript
// BEFORE:
const page_size = limit > 0 ? limit : 50
const page = Math.floor(offset / page_size) + 1

// AFTER:
// -1 is the "all records" sentinel; pass it through to the backend command.
// The backend must support page_size = -1 — verify this in the Rust command.
// If the backend does not support it, use a large cap (e.g., 100000) instead.
if (limit === -1) {
  return window.hadron.invoke('get_analyses_paginated', { page_size: -1, page: 1, ...otherArgs })
}
const page_size = limit > 0 ? limit : 50
const page = Math.floor(offset / page_size) + 1
```

**Important:** Before applying this fix, verify whether the Rust `get_analyses_paginated` command accepts `page_size = -1`. Run:
```bash
grep -n 'page_size' /mnt/c/Projects/Hadron_v3/hadron-electron/electron/ipc/crud.ts 2>/dev/null || \
grep -rn 'get_analyses_paginated' /mnt/c/Projects/Hadron_v3/hadron-electron/electron/
```
If the backend does not handle `-1`, use `page_size: 100_000` as a safe upper bound and remove the JSDoc claim of `-1` being supported.

- [ ] **Step 4: Fix `toggleTranslationFavorite` return type (~line 551–555)**

First, check the actual backend response shape:
```bash
grep -n 'toggle_translation_favorite\|is_favorite' /mnt/c/Projects/Hadron_v3/hadron-electron/electron/ipc/crud.ts 2>/dev/null | head -20
```

If the backend returns `{ is_favorite: boolean }` (same as `toggle_favorite`):
```typescript
// BEFORE:
export async function toggleTranslationFavorite(id: number): Promise<boolean> {
  const result = await invoke<boolean>("toggle_translation_favorite", { id });
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
  return result;
}

// AFTER:
export async function toggleTranslationFavorite(id: number): Promise<boolean> {
  const result = await invoke<{ is_favorite: boolean }>("toggle_translation_favorite", { id });
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
  return result.is_favorite;
}
```

If the backend returns `boolean` directly, leave it as-is and add a comment:
```typescript
// Backend toggle_translation_favorite returns a raw boolean (unlike toggle_favorite which returns { is_favorite })
```

- [ ] **Step 5: Fix Keeper sentinel forwarding in `src/App.tsx`**

The safest fix without refactoring the entire state shape is to intercept at the call sites. Find every place `apiKey` is passed to a backend `invoke` call (search for `apiKey` in `App.tsx`). At each call site:

```typescript
// BEFORE:
() => analyzeCrashLog(filePath, apiKey, model, provider, analysisType, analysisMode)

// AFTER:
() => analyzeCrashLog(filePath, keeperActive ? '' : apiKey, model, provider, analysisType, analysisMode)
```

Where `keeperActive` is derived from state or the stored Keeper config. Alternatively, add a helper:

```typescript
// Near the top of the component (after state declarations):
const effectiveApiKey = keeperActive ? '' : apiKey
```

Then use `effectiveApiKey` everywhere `apiKey` is passed to backend calls. The empty string `''` signals to the backend that it should use its own credential source (Keeper). Verify in the Rust handler that an empty `api_key` triggers the Keeper path.

- [ ] **Step 6: Run all tests**

```bash
npm run test
```

Expected: PASS

- [ ] **Step 7: Manual smoke**

1. Configure Keeper mode. Run an analysis. Confirm it does not 401.
2. Toggle a translation favorite. Confirm the heart icon shows the new state (not always-on).
3. Call `getAnalyses({ limit: -1 })` from DevTools. Confirm it returns more than 50 items if more exist.

- [ ] **Step 8: Commit**

```bash
git add src/services/api.ts src/App.tsx tests/api-contracts.test.ts
git commit -m "fix(api): pass limit=-1 through to backend, fix toggleTranslationFavorite return type, stop Keeper sentinel leaking to AI calls"
```

---

## Task 9: Miscellaneous IPC and Widget Fixes (M1-poller overlap, M3-FTS rebuild, M4-export deleted_at, M6-window identity, M7-shell promise, M11-preload exit, HIGH-10-comment body)

**Blast Radius:**
- **Scope:** `electron/ipc/jira-assist.ts`, `electron/ipc/release-notes.ts`, `electron/ipc/widget.ts`, `electron/preload.ts`, `electron/services/chat-tools.ts`
- **Risk if fix is wrong:** The poller cycling guard could deadlock the poller if an exception inside the cycle leaves `cycling = true`. Use a `try/finally` pattern. The window identity fix (returning a stored reference instead of exclusion logic) requires that the main window reference is available in widget.ts.

**Quality Gate:** Run the existing `jira-poller.test.ts` after poller changes. Confirm `find_similar_tickets` response time does not regress.

**Files:**
- Modify: `electron/ipc/jira-assist.ts` (poller overlap guard)
- Modify: `electron/ipc/release-notes.ts` (`deleted_at` filter)
- Modify: `electron/ipc/widget.ts` (window identity, shell.openExternal)
- Modify: `electron/preload.ts` (`exit` fire-and-forget)
- Modify: `electron/services/chat-tools.ts` (comment body, FTS rebuild → optimize)

- [ ] **Step 1: Fix FTS `rebuild` → `optimize` on every `find_similar_tickets` call**

In `electron/ipc/jira-assist.ts`, find:
```typescript
db.exec("INSERT INTO ticket_briefs_fts(ticket_briefs_fts) VALUES('rebuild')")
```
Change to:
```typescript
db.exec("INSERT INTO ticket_briefs_fts(ticket_briefs_fts) VALUES('optimize')")
```

`optimize` is incremental and safe to call on every read. Move the `rebuild` call to the write paths (`triage_jira_ticket`, `generate_ticket_brief`) instead:
```typescript
// Add after each INSERT OR IGNORE + UPDATE pair (Tasks 3 fix):
db.exec("INSERT INTO ticket_briefs_fts(ticket_briefs_fts) VALUES('rebuild')")
```

- [ ] **Step 2: Add poller cycle guard to prevent overlapping cycles**

In `electron/ipc/jira-assist.ts`, find `pollerState` and add a `cycling` boolean:
```typescript
const pollerState = {
  running: false,
  cycling: false,        // ADD THIS
  intervalMins: 15,
  // ... existing fields
}
```

Then in `runPollerCycle`:
```typescript
async function runPollerCycle(): Promise<void> {
  if (pollerState.cycling) return   // ADD THIS GUARD
  pollerState.cycling = true
  try {
    // ... existing cycle body
  } finally {
    pollerState.cycling = false     // ADD THIS CLEANUP
  }
}
```

- [ ] **Step 3: Fix `export_release_notes` to filter soft-deleted records**

In `electron/ipc/release-notes.ts`, find:
```typescript
const row = db.prepare('SELECT * FROM release_notes WHERE id = ?').get(args.id)
```
Change to:
```typescript
const row = db.prepare('SELECT * FROM release_notes WHERE id = ? AND deleted_at IS NULL').get(args.id)
```

- [ ] **Step 4: Fix main window identity in widget.ts**

In `electron/ipc/widget.ts`, find `getMainWindow`:
```typescript
function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find(w => w !== widgetWindow) ?? null
}
```

The correct fix requires a stored reference. Check how `registerWidgetHandlers` is called — it should receive the main window as a parameter. Update the signature:

```typescript
// BEFORE:
export function registerWidgetHandlers(ipcMain: IpcMain): void {

// AFTER:
export function registerWidgetHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow): void {
```

Then replace `getMainWindow()` in the file with the captured `mainWindow` reference:
```typescript
// Remove the getMainWindow function entirely.
// All calls to getMainWindow() are replaced with mainWindow directly.
```

Update the call site in `electron/main.ts` (or wherever `registerWidgetHandlers` is called):
```bash
grep -n 'registerWidgetHandlers' /mnt/c/Projects/Hadron_v3/hadron-electron/electron/main.ts
```
Pass the main window reference at that call site.

- [ ] **Step 5: Fix `shell.openExternal` promise (widget.ts)**

In `electron/ipc/widget.ts`, find the `setWindowOpenHandler` block:
```typescript
// BEFORE:
const { shell } = require('electron') as typeof import('electron')
shell.openExternal(parsed.toString())

// AFTER (1): Import shell at top of file, replace require:
// Add `shell` to the existing top-level import line:
import { IpcMain, BrowserWindow, screen, shell } from 'electron'
// Remove the inline require.

// AFTER (2): Add catch to the openExternal call:
shell.openExternal(parsed.toString()).catch(err =>
  log.warn('[widget] shell.openExternal failed:', err)
)
```

- [ ] **Step 6: Fix `exit` in preload.ts to use `send` instead of `invoke`**

In `electron/preload.ts`, find:
```typescript
exit: (code?: number): void => { ipcRenderer.invoke('app:exit', { code: code ?? 0 }) },
```
Change to:
```typescript
exit: (code?: number): void => { ipcRenderer.send('app:exit', { code: code ?? 0 }) },
```

Then in `electron/ipc/settings.ts`, find `ipcMain.handle('app:exit', ...)` and change it to `ipcMain.on`:
```typescript
// BEFORE:
ipcMain.handle('app:exit', (_e, { code }: { code: number }) => {
  app.exit(code)
})

// AFTER:
ipcMain.on('app:exit', (_e, { code }: { code: number }) => {
  app.exit(typeof code === 'number' && Number.isFinite(code) ? Math.max(0, Math.min(255, code)) : 0)
})
```

Note: changing from `handle` to `on` means this channel no longer returns a response — which is correct for a fire-and-forget exit call. Verify no caller awaits the result.

- [ ] **Step 7: Fix `toolNativeInvestigateTicket` comment body (chat-tools.ts ~line 669)**

Find:
```typescript
.map(c => `  [${c.created.substring(0, 10)}] ${c.author.displayName}: (comment)`)
```

Check what fields are available on `c` by searching for the JIRA fetch call above it. If `renderedFields.comment.comments` is available from the `expand=renderedFields` parameter, use `c.body` (which in JIRA Server is a string) or parse the ADF. At minimum:

```typescript
// Extract plain text from ADF body if present, fall back to a summary
function adfToText(body: unknown): string {
  if (!body || typeof body !== 'object') return '(no body)'
  const adf = body as { content?: Array<{ content?: Array<{ text?: string }> }> }
  return adf.content?.flatMap(block =>
    block.content?.map(inline => inline.text ?? '').filter(Boolean) ?? []
  ).join(' ').trim() || '(no body)'
}

// Then in the map:
.map(c => `  [${c.created.substring(0, 10)}] ${c.author.displayName}: ${adfToText(c.body)}`)
```

If `c.body` is undefined for all comments (meaning the JIRA fetch does not return it), add `body` to the fetch `fields` or `expand` parameter.

- [ ] **Step 8: Run all tests**

```bash
npm run test
```

Expected: PASS including `jira-poller.test.ts`

- [ ] **Step 9: Commit**

```bash
git add electron/ipc/jira-assist.ts electron/ipc/release-notes.ts electron/ipc/widget.ts \
        electron/preload.ts electron/ipc/settings.ts electron/services/chat-tools.ts
git commit -m "fix(misc): FTS optimize on read, poller cycle guard, export respects deleted_at, main window ref, openExternal catch, exit via send, investigate comment body"
```

---

## Execution Order and Dependencies

```
Task 1 (settings guard)     — independent, highest security priority, ship first
Task 2 (JQL/CQL injection)  — independent, security, ship second
Task 3 (DB integrity)       — independent, data correctness, ship third
Task 4 (MCP reliability)    — depends on nothing, ship fourth
Task 5 (chat streaming)     — independent; regression-test with Task 4 changes
Task 6 (frontend display)   — independent, frontend only
Task 7 (React lifecycle)    — independent, frontend only
Task 8 (API contracts)      — Task 8 Step 3 (limit=-1) requires verifying Rust backend first
Task 9 (miscellaneous)      — Step 4 (window identity) must be checked for impact on main.ts
```

Tasks 1–3 are the highest priority and fully independent. They can be worked in parallel by separate engineers.

---

## Final Quality Gate Checklist

Before declaring done:

- [ ] `npm run test` passes with 0 failures
- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] All 9 commit messages are in place
- [ ] Manual smoke tests in Tasks 1, 2, 3, 4, 5, 6, 7, 8 have been executed
- [ ] No existing tests regressed (compare test counts before and after)
- [ ] `store:entries` with `secure-storage` returns `[]` in production build
- [ ] A ticket that was previously triaged retains `engineer_rating` after re-triage
- [ ] A release notes generation in progress bar disappears on completion
- [ ] An MCP tool call is not aborted by a settings save that does not change the enabled state
