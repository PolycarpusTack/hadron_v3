# JIRA Assist — Sprint Overview (Reference)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement any sprint from this document.

**Goal:** Transform the JIRA Analyzer into an intelligent ticket intelligence platform — JIRA Assist — that auto-triages tickets, generates investigation briefs, detects duplicates, and posts summaries back to JIRA.

**Architecture:**
- Rust backend adds a `ticket_briefs` table (keyed by `jira_key`) to persist AI-generated triage + briefs
- AI classification uses the existing AI provider system (cloud) and optionally llamacpp (local)
- Background poller stubbed in Sprint 1, activated in Sprint 6
- Frontend extends `JiraTicketAnalyzer.tsx` and the Project Feed; no new top-level routes

**Tech Stack:** Rust/Tauri, SQLite (migrations.rs pattern), React/TypeScript, existing `jira_service.rs`, `ai_service.rs`

---

## Naming Conventions

| Term | Meaning |
|------|---------|
| **JIRA Analyzer** | Existing tab: fetch a ticket, run deep analysis (`analyze_jira_ticket_deep`) |
| **JIRA Assist** | New intelligent layer: auto-triage, brief generation, duplicate detection, round-trip |

---

## Sprint Map

### Sprint 1 — Foundation (in-depth plan: `2026-03-04-jira-assist-sprint1.md`)
**Goal:** DB schema, Rust data layer, poller stub, Settings placeholder.

Deliverables:
- Migration 14: `ticket_briefs` + `ticket_embeddings` tables
- `src-tauri/src/ticket_briefs.rs` — CRUD data layer
- `src-tauri/src/jira_poller.rs` — stub (always a no-op; config-ready)
- 2 Tauri commands: `get_ticket_brief`, `delete_ticket_brief`
- `JiraSettings.tsx` — "JIRA Assist (Beta)" section with greyed-out JQL/interval inputs

---

### Sprint 2 — Triage Engine
**Goal:** AI triage on demand — classify severity, category, customer impact. Persist result in `ticket_briefs`.

Deliverables:
- `src-tauri/src/jira_triage.rs` — prompt + structured output (`JiraTriageResult`)
  - Fields: `severity` (Critical/High/Medium/Low), `category` (Bug/Feature/Infra/UX/Performance/Security), `customer_impact` (string), `tags: Vec<String>`, `confidence`, `rationale`
  - Supports cloud (OpenAI, Anthropic, Z.ai) + llamacpp (smaller prompt, simpler schema)
- Tauri command: `triage_jira_ticket(request) -> Result<JiraTriageResult, String>`
  - Upserts into `ticket_briefs` after success
- `commands/jira_assist.rs` — new file for all JIRA Assist commands (keep separate from legacy JIRA)
- Frontend: "Triage" button in `JiraTicketAnalyzer.tsx`
  - Shows triage badge panel (severity chip, category chip, tags)
  - Persists across re-opens (loaded from DB via `get_ticket_brief`)

---

### Sprint 3 — Investigation Brief
**Goal:** Generate a full investigation brief from triage + deep analysis combined. Store as `brief_json` in `ticket_briefs`.

Deliverables:
- Reuse `jira_deep_analysis.rs` output as the "Technical" section
- New `jira_brief.rs` — combined prompt producing `JiraBriefResult`:
  - Triage summary, timeline, affected systems, recommended owners, escalation criteria, do-nothing risk
- Tauri command: `generate_ticket_brief(jira_key, ...) -> Result<JiraBriefResult, String>`
  - Calls triage + deep analysis in parallel (tokio::join!)
  - Persists combined result to `ticket_briefs.brief_json`
- Frontend: `TicketBriefPanel.tsx` component showing full brief
  - Replaces standalone `JiraAnalysisReport.tsx` for the combined output
  - "Generate Brief" button — runs both triage + deep analysis
  - Tab: "Brief" | "Raw Analysis"

---

### Sprint 4 — Duplicate Detection
**Goal:** Detect similar/duplicate tickets via embedding similarity.

Deliverables:
- Embedding generation in `ticket_embeddings.rs`: encode title + description → float32 vec → BLOB
- Cosine similarity search against existing `ticket_embeddings` rows
- Tauri command: `find_similar_tickets(jira_key, threshold: f32, limit: usize) -> Result<Vec<SimilarTicket>, String>`
  - Returns: `{jira_key, title, similarity_score, category, severity}`
- Frontend: "Similar Tickets" section in `TicketBriefPanel.tsx`
  - Compact list with similarity percentage
  - Click to open that ticket in JIRA Analyzer

---

### Sprint 5 — JIRA Round-Trip
**Goal:** Post brief summary back to JIRA as a comment; track posted status.

Deliverables:
- Tauri command: `post_brief_to_jira(jira_key, ...) -> Result<(), String>`
  - Reuses `post_jira_comment` under the hood
  - Formats brief as clean JIRA markup
  - Updates `ticket_briefs.posted_to_jira = 1` + `posted_at`
- Engineer feedback: `update_engineer_feedback(jira_key, rating: u8, notes: String)` command
- Frontend: "Post to JIRA" button with confirmation dialog
  - Disabled if `posted_to_jira = 1` (shows "Posted" badge with date)
  - Star rating (1–5) + free-text notes for engineer feedback

---

### Sprint 6 — Project Feed Integration
**Goal:** Bulk triage from Project Feed; sort/filter by JIRA Assist severity.

Deliverables:
- "Triage All Visible" button in Project Feed header
  - Batch `triage_jira_ticket` with progress indicator
  - Respects rate limits (sequential with 200ms delay)
- Severity badge in feed ticket rows (from `ticket_briefs` if present)
- Feed filter: "Triaged Only", "By Severity" dropdown
- Tauri command: `bulk_triage_tickets(keys: Vec<String>, ...) -> Result<Vec<JiraTriageResult>, String>`

---

### Phase 2 — Background Poller (Sprint 7+)
**Goal:** Auto-triage new tickets on a schedule.

Deliverables:
- `jira_poller.rs` — activate by reading `jira_assist_jql_filter` + `jira_assist_poll_interval` from settings store
- Tokio interval task started at app launch (opt-in via settings toggle)
- Notification via Tauri notification plugin when N new tickets are triaged
- Settings: activate the currently greyed-out JIRA Assist controls in `JiraSettings.tsx`
- Tauri command: `get_poller_status() -> Result<PollerStatus, String>` (last run, next run, ticket count)

---

## Database Schema (Migration 14)

```sql
-- ticket_briefs: one row per JIRA ticket, upserted on re-analysis
CREATE TABLE IF NOT EXISTS ticket_briefs (
    jira_key     TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    customer     TEXT,
    severity     TEXT,        -- Critical|High|Medium|Low
    category     TEXT,        -- Bug|Feature|Infrastructure|UX|Performance|Security
    tags         TEXT,        -- JSON array: ["tag1", "tag2"]
    triage_json  TEXT,        -- JiraTriageResult as JSON (Sprint 2)
    brief_json   TEXT,        -- JiraBriefResult as JSON (Sprint 3)
    posted_to_jira INTEGER NOT NULL DEFAULT 0,
    posted_at    TEXT,
    engineer_rating  INTEGER, -- 1-5 star rating
    engineer_notes   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ticket_embeddings: embeddings for duplicate detection (Sprint 4)
CREATE TABLE IF NOT EXISTS ticket_embeddings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jira_key    TEXT NOT NULL REFERENCES ticket_briefs(jira_key) ON DELETE CASCADE,
    embedding   BLOB NOT NULL,   -- f32 vector serialized as little-endian bytes
    source_text TEXT NOT NULL,   -- the text that was embedded
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_embeddings_jira_key ON ticket_embeddings(jira_key);
```

---

## Key File Map

| File | Role |
|------|------|
| `src-tauri/src/migrations.rs` | Add migration 014 |
| `src-tauri/src/ticket_briefs.rs` | CRUD data layer for ticket_briefs table |
| `src-tauri/src/jira_poller.rs` | Background poller (stub Sprint 1, activate Phase 2) |
| `src-tauri/src/jira_triage.rs` | AI triage prompt + output types (Sprint 2) |
| `src-tauri/src/jira_brief.rs` | Combined brief generation (Sprint 3) |
| `src-tauri/src/ticket_embeddings.rs` | Embedding store + similarity search (Sprint 4) |
| `src-tauri/src/commands/jira_assist.rs` | All JIRA Assist Tauri commands |
| `src-tauri/src/commands/mod.rs` | Add `pub mod jira_assist;` |
| `src-tauri/src/main.rs` | Register all JIRA Assist commands |
| `src/components/jira/JiraTicketAnalyzer.tsx` | Add Triage + Generate Brief buttons |
| `src/components/jira/TicketBriefPanel.tsx` | Full brief display (Sprint 3) |
| `src/components/JiraSettings.tsx` | JIRA Assist settings section |
| `src/services/jira-assist.ts` | TypeScript API functions for JIRA Assist |
