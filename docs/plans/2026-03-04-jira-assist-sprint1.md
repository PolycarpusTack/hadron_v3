# JIRA Assist — Sprint 1: Foundation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Lay the data foundation for JIRA Assist — DB schema, Rust data layer, poller stub, and a Settings placeholder — with zero user-facing AI features. Everything Sprint 2+ builds on top of this.

**Architecture:** Add migration 14 with `ticket_briefs` + `ticket_embeddings` tables. Create a Rust CRUD module. Stub the background poller. Expose 2 Tauri commands. Add a greyed-out Settings section so users can see what's coming.

**Tech Stack:** Rust, rusqlite, Tauri v2, React/TypeScript, `@tauri-apps/plugin-store`

---

## Prerequisites

- Current schema version: 13 (canonicalize_jira_type)
- New migration will be: **14** (`jira_assist_tables`)
- All new Tauri commands go in `src-tauri/src/commands/jira_assist.rs` (new file)
- `commands/mod.rs` needs `pub mod jira_assist;`
- Do NOT touch `commands_legacy.rs` or existing JIRA commands

---

### Task 1: Add Migration 14 — DB Schema

**Files:**
- Modify: `hadron-desktop/src-tauri/src/migrations.rs`

**Step 1: Read the file for context**

Open `migrations.rs` and look at:
- `CURRENT_SCHEMA_VERSION` constant (currently `13`)
- The `MIGRATIONS` array (add to the end)
- The pattern for a migration function (e.g. `migration_013_canonicalize_jira_type`)

**Step 2: Add the migration definition to the `MIGRATIONS` array**

After the `migration_013_canonicalize_jira_type` entry, add:

```rust
Migration {
    version: 14,
    name: "jira_assist_tables",
    up: migration_014_jira_assist_tables,
},
```

**Step 3: Update `CURRENT_SCHEMA_VERSION`**

```rust
pub const CURRENT_SCHEMA_VERSION: i32 = 14;
```

**Step 4: Add the migration function**

At the end of the file, add:

```rust
fn migration_014_jira_assist_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ticket_briefs (
            jira_key         TEXT PRIMARY KEY,
            title            TEXT NOT NULL,
            customer         TEXT,
            severity         TEXT,
            category         TEXT,
            tags             TEXT,
            triage_json      TEXT,
            brief_json       TEXT,
            posted_to_jira   INTEGER NOT NULL DEFAULT 0,
            posted_at        TEXT,
            engineer_rating  INTEGER,
            engineer_notes   TEXT,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ticket_embeddings (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            jira_key     TEXT NOT NULL REFERENCES ticket_briefs(jira_key) ON DELETE CASCADE,
            embedding    BLOB NOT NULL,
            source_text  TEXT NOT NULL,
            created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ticket_embeddings_jira_key
            ON ticket_embeddings(jira_key);",
    )?;
    Ok(())
}
```

**Step 5: Verify it compiles**

```bash
cd hadron-desktop && cargo check 2>&1 | tail -5
```
Expected: no errors (just warnings are ok)

**Step 6: Commit**

```bash
git add hadron-desktop/src-tauri/src/migrations.rs
git commit -m "feat(jira-assist): add migration 14 — ticket_briefs and ticket_embeddings tables"
```

---

### Task 2: Create `ticket_briefs.rs` — Rust Data Layer

**Files:**
- Create: `hadron-desktop/src-tauri/src/ticket_briefs.rs`
- Modify: `hadron-desktop/src-tauri/src/main.rs` (add `mod ticket_briefs;`)

**Step 1: Create the file**

```rust
//! CRUD data layer for the ticket_briefs table.
//! Sprint 1: basic get/upsert/delete/feedback.
//! Sprint 2+: triage_json / brief_json populated by AI commands.

use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketBrief {
    pub jira_key: String,
    pub title: String,
    pub customer: Option<String>,
    pub severity: Option<String>,
    pub category: Option<String>,
    pub tags: Option<String>,        // JSON array string
    pub triage_json: Option<String>,
    pub brief_json: Option<String>,
    pub posted_to_jira: bool,
    pub posted_at: Option<String>,
    pub engineer_rating: Option<i64>,
    pub engineer_notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Insert or replace a ticket brief (upsert keyed on jira_key).
pub fn upsert_ticket_brief(conn: &Connection, brief: &TicketBrief) -> Result<()> {
    conn.execute(
        "INSERT INTO ticket_briefs (
            jira_key, title, customer, severity, category, tags,
            triage_json, brief_json, posted_to_jira, posted_at,
            engineer_rating, engineer_notes, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now'))
        ON CONFLICT(jira_key) DO UPDATE SET
            title          = excluded.title,
            customer       = excluded.customer,
            severity       = excluded.severity,
            category       = excluded.category,
            tags           = excluded.tags,
            triage_json    = excluded.triage_json,
            brief_json     = excluded.brief_json,
            posted_to_jira = excluded.posted_to_jira,
            posted_at      = excluded.posted_at,
            engineer_rating = excluded.engineer_rating,
            engineer_notes = excluded.engineer_notes,
            updated_at     = datetime('now')",
        params![
            brief.jira_key,
            brief.title,
            brief.customer,
            brief.severity,
            brief.category,
            brief.tags,
            brief.triage_json,
            brief.brief_json,
            brief.posted_to_jira as i64,
            brief.posted_at,
            brief.engineer_rating,
            brief.engineer_notes,
        ],
    )?;
    Ok(())
}

/// Fetch a single brief by JIRA key. Returns None if not found.
pub fn get_ticket_brief(conn: &Connection, jira_key: &str) -> Result<Option<TicketBrief>> {
    let mut stmt = conn.prepare(
        "SELECT jira_key, title, customer, severity, category, tags,
                triage_json, brief_json, posted_to_jira, posted_at,
                engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs WHERE jira_key = ?1",
    )?;

    let result = stmt.query_row(params![jira_key], |row| {
        Ok(TicketBrief {
            jira_key:        row.get(0)?,
            title:           row.get(1)?,
            customer:        row.get(2)?,
            severity:        row.get(3)?,
            category:        row.get(4)?,
            tags:            row.get(5)?,
            triage_json:     row.get(6)?,
            brief_json:      row.get(7)?,
            posted_to_jira:  row.get::<_, i64>(8)? != 0,
            posted_at:       row.get(9)?,
            engineer_rating: row.get(10)?,
            engineer_notes:  row.get(11)?,
            created_at:      row.get(12)?,
            updated_at:      row.get(13)?,
        })
    });

    match result {
        Ok(brief) => Ok(Some(brief)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Delete a brief and its embeddings (cascade handles embeddings).
pub fn delete_ticket_brief(conn: &Connection, jira_key: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM ticket_briefs WHERE jira_key = ?1",
        params![jira_key],
    )?;
    Ok(())
}

/// Update engineer feedback (rating 1-5, optional notes).
pub fn update_engineer_feedback(
    conn: &Connection,
    jira_key: &str,
    rating: Option<i64>,
    notes: Option<String>,
) -> Result<()> {
    conn.execute(
        "UPDATE ticket_briefs
         SET engineer_rating = ?2, engineer_notes = ?3, updated_at = datetime('now')
         WHERE jira_key = ?1",
        params![jira_key, rating, notes],
    )?;
    Ok(())
}
```

**Step 2: Add `mod ticket_briefs;` to `main.rs`**

In `main.rs`, find the block of `mod` declarations (around line 22–32) and add:

```rust
mod ticket_briefs;
```

**Step 3: Verify compilation**

```bash
cd hadron-desktop && cargo check 2>&1 | tail -10
```
Expected: no new errors

**Step 4: Commit**

```bash
git add hadron-desktop/src-tauri/src/ticket_briefs.rs hadron-desktop/src-tauri/src/main.rs
git commit -m "feat(jira-assist): add ticket_briefs Rust data layer (CRUD)"
```

---

### Task 3: Create `jira_poller.rs` — Background Poller Stub

**Files:**
- Create: `hadron-desktop/src-tauri/src/jira_poller.rs`
- Modify: `hadron-desktop/src-tauri/src/main.rs` (add `mod jira_poller;`)

**Step 1: Create the stub file**

```rust
//! JIRA Assist background poller — Sprint 1 stub.
//!
//! The poller watches a JQL filter on a configurable interval and auto-triages
//! new tickets. This stub is config-ready but never starts the actual loop.
//! Activate in Phase 2 / Sprint 7.

#[allow(dead_code)]
pub struct JiraPollerConfig {
    pub jql_filter: String,
    pub poll_interval_secs: u64,
    pub enabled: bool,
}

/// Start the poller if enabled. Currently a no-op (Phase 2 feature).
/// Called at app startup after config is loaded.
#[allow(dead_code)]
pub fn start_if_enabled(_config: JiraPollerConfig) {
    // Phase 2: spawn tokio interval task here when enabled = true
}
```

**Step 2: Add `mod jira_poller;` to `main.rs`**

In the mod declarations block, add:

```rust
mod jira_poller;
```

**Step 3: Compile check**

```bash
cd hadron-desktop && cargo check 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add hadron-desktop/src-tauri/src/jira_poller.rs hadron-desktop/src-tauri/src/main.rs
git commit -m "feat(jira-assist): add jira_poller stub (Phase 2 placeholder)"
```

---

### Task 4: Create `commands/jira_assist.rs` — Tauri Commands

**Files:**
- Create: `hadron-desktop/src-tauri/src/commands/jira_assist.rs`
- Modify: `hadron-desktop/src-tauri/src/commands/mod.rs` (add `pub mod jira_assist;`)
- Modify: `hadron-desktop/src-tauri/src/main.rs` (register commands)

**Step 1: Create the commands file**

```rust
//! JIRA Assist Tauri commands.
//!
//! Sprint 1: read-only DB commands (get, delete).
//! Sprint 2+: triage, brief generation, post-to-jira commands added here.

use super::common::DbState;
use crate::ticket_briefs::{self, TicketBrief};
use std::sync::Arc;

/// Fetch a stored ticket brief by JIRA key.
/// Returns null if no brief has been generated for this ticket yet.
#[tauri::command]
pub async fn get_ticket_brief(
    jira_key: String,
    db: DbState<'_>,
) -> Result<Option<TicketBrief>, String> {
    log::debug!("cmd: get_ticket_brief key={}", jira_key);
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| ticket_briefs::get_ticket_brief(conn, &jira_key))
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Delete a ticket brief and its embeddings from the database.
#[tauri::command]
pub async fn delete_ticket_brief(
    jira_key: String,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: delete_ticket_brief key={}", jira_key);
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.with_conn(|conn| ticket_briefs::delete_ticket_brief(conn, &jira_key))
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}
```

**Step 2: Check how `db.with_conn` works (important)**

Read `src-tauri/src/database.rs` to verify the `Database` struct API — specifically whether it exposes a `with_conn` method or if you call methods directly on `db`. Adjust the command implementation to match the actual API.

If `Database` uses a different pattern (e.g., `db.get_connection()` or `db.execute()`), look at existing commands in `commands/jira.rs` for the correct pattern. The `DbState` type alias and connection access must match exactly.

**Step 3: Add `pub mod jira_assist;` to `commands/mod.rs`**

In `commands/mod.rs`, find where other `pub mod` declarations are and add:

```rust
pub mod jira_assist;
```

**Step 4: Register commands in `main.rs`**

In the `invoke_handler!` macro in `main.rs`, after the `// Widget` section, add:

```rust
// JIRA Assist
commands::jira_assist::get_ticket_brief,
commands::jira_assist::delete_ticket_brief,
```

**Step 5: Verify compilation**

```bash
cd hadron-desktop && cargo check 2>&1 | grep "^error" | head -20
```
Expected: 0 errors (fix any if present)

**Step 6: Commit**

```bash
git add hadron-desktop/src-tauri/src/commands/jira_assist.rs \
        hadron-desktop/src-tauri/src/commands/mod.rs \
        hadron-desktop/src-tauri/src/main.rs
git commit -m "feat(jira-assist): add get_ticket_brief and delete_ticket_brief Tauri commands"
```

---

### Task 5: Frontend — TypeScript API Functions

**Files:**
- Create: `hadron-desktop/src/services/jira-assist.ts`

**Step 1: Create the service file**

```typescript
/**
 * JIRA Assist API functions — Sprint 1 (read-only DB access).
 * Sprint 2+ will add triage, brief generation, and post-to-JIRA.
 */

import { invoke } from "@tauri-apps/api/core";

export interface TicketBrief {
  jira_key: string;
  title: string;
  customer: string | null;
  severity: string | null;  // "Critical" | "High" | "Medium" | "Low"
  category: string | null;  // "Bug" | "Feature" | "Infrastructure" | "UX" | "Performance" | "Security"
  tags: string | null;      // JSON string: '["tag1", "tag2"]'
  triage_json: string | null;
  brief_json: string | null;
  posted_to_jira: boolean;
  posted_at: string | null;
  engineer_rating: number | null;
  engineer_notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Fetch a stored ticket brief by JIRA key. Returns null if not yet generated. */
export async function getTicketBrief(jiraKey: string): Promise<TicketBrief | null> {
  return invoke<TicketBrief | null>("get_ticket_brief", { jiraKey });
}

/** Delete a ticket brief and its embeddings. */
export async function deleteTicketBrief(jiraKey: string): Promise<void> {
  return invoke<void>("delete_ticket_brief", { jiraKey });
}

/** Parse tags JSON string to array. Returns [] on parse failure. */
export function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    return JSON.parse(tagsJson);
  } catch {
    return [];
  }
}

/** Severity → Tailwind color class for badges. */
export const SEVERITY_COLORS: Record<string, string> = {
  Critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  High:     "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  Medium:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  Low:      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};
```

**Step 2: Verify TypeScript compiles**

```bash
cd hadron-desktop && npx tsc --noEmit 2>&1 | grep "jira-assist" | head -10
```
Expected: no errors for `jira-assist.ts`

**Step 3: Commit**

```bash
git add hadron-desktop/src/services/jira-assist.ts
git commit -m "feat(jira-assist): add TypeScript API types and functions"
```

---

### Task 6: Frontend — JIRA Assist Settings Section

**Files:**
- Modify: `hadron-desktop/src/components/JiraSettings.tsx`

**Step 1: Read the file**

Read `JiraSettings.tsx` to find where it ends — the return JSX. The JIRA Assist section goes just above the final closing `</div>` of the component's root element.

**Step 2: Add the settings section**

Find the closing `</div>` tag near the bottom of the JSX return and insert this section before it:

```tsx
{/* JIRA Assist (Beta) */}
<div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
  <div className="flex items-center gap-2 mb-3">
    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
      JIRA Assist
    </h3>
    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 font-medium">
      Beta
    </span>
  </div>
  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
    Auto-triage, investigation briefs, and duplicate detection for your JIRA tickets.
    Background polling is coming in Phase 2.
  </p>

  {/* JQL Filter — greyed out, Phase 2 */}
  <div className="mb-3 opacity-50 cursor-not-allowed" title="Available in Phase 2">
    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
      Auto-Triage JQL Filter
    </label>
    <input
      type="text"
      disabled
      placeholder='project = "MYPROJ" AND created >= -7d'
      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
    />
    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
      JQL filter for tickets to auto-triage on a schedule (Phase 2)
    </p>
  </div>

  {/* Poll Interval — greyed out, Phase 2 */}
  <div className="opacity-50 cursor-not-allowed" title="Available in Phase 2">
    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
      Poll Interval (minutes)
    </label>
    <input
      type="number"
      disabled
      placeholder="30"
      className="w-24 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
    />
    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
      How often to check for new tickets (Phase 2)
    </p>
  </div>
</div>
```

**Step 3: Verify TypeScript compiles**

```bash
cd hadron-desktop && npx tsc --noEmit 2>&1 | grep "JiraSettings" | head -10
```
Expected: no errors for `JiraSettings.tsx`

**Step 4: Commit**

```bash
git add hadron-desktop/src/components/JiraSettings.tsx
git commit -m "feat(jira-assist): add JIRA Assist settings placeholder (Phase 2 preview)"
```

---

### Task 7: Verify Full Build

**Step 1: Rust clean build**

```bash
cd hadron-desktop && cargo build 2>&1 | grep "^error" | head -20
```
Expected: 0 errors

**Step 2: TypeScript build**

```bash
cd hadron-desktop && npm run build 2>&1 | tail -20
```
Expected: build succeeds (pre-existing TS errors in unrelated files are ok — document them if present)

**Step 3: Run the app briefly to confirm the migration runs**

If you can run the dev server:
```bash
cd hadron-desktop && cargo tauri dev
```
Check log output for: `Running migration 14: jira_assist_tables`
Then close the app.

**Step 4: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore(jira-assist): sprint 1 complete — foundation layer ready"
```

---

## Sprint 1 Acceptance Criteria

- [ ] `cargo build` succeeds with 0 errors
- [ ] `npm run build` succeeds (existing TS errors are pre-existing, not introduced)
- [ ] Migration 14 appears in log on first launch: `Running migration 14: jira_assist_tables`
- [ ] `ticket_briefs` and `ticket_embeddings` tables exist in DB after migration
- [ ] `get_ticket_brief("NONEXISTENT")` returns `null` from the frontend (test via devtools invoke)
- [ ] JIRA Settings shows "JIRA Assist (Beta)" section with greyed-out inputs
- [ ] No regressions in existing JIRA Analyzer functionality
