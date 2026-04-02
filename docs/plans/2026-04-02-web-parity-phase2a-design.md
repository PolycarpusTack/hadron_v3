# Web-Desktop Parity — Phase 2a: JIRA Assist (Triage + Brief + Feed)

**Date:** 2026-04-02
**Status:** Approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`
**Depends on:** Phase 0 (infra), Phase 1b (JIRA deep analysis types + routes)

Core JIRA Assist features: AI triage classification, investigation briefs (triage + deep in parallel), DB persistence, and a project feed for browsing triaged tickets.

---

## Backend

### hadron-core: `ai/jira_triage.rs`

New module with types and prompt matching desktop's `jira_triage.rs`:

```rust
pub struct JiraTriageResult {
    pub severity: String,        // Critical | High | Medium | Low
    pub category: String,        // Bug | Feature | Infrastructure | UX | Performance | Security
    pub customer_impact: String, // 1-2 sentence plain-language
    pub tags: Vec<String>,       // 2-5 lowercase tags
    pub confidence: String,      // High | Medium | Low
    pub rationale: String,       // 1-3 sentence explanation
}
```

- `JIRA_TRIAGE_SYSTEM_PROMPT` — senior support engineer persona (copy from desktop)
- `build_jira_triage_user_prompt(ticket: &JiraTicketDetail) -> String` — builds prompt with truncation (description 2000 chars, comments last 5 at 500 chars each)
- `build_jira_triage_messages(ticket: &JiraTicketDetail) -> (String, Vec<AiMessage>)` — returns (system_prompt, messages)
- `parse_jira_triage(raw: &str) -> Result<JiraTriageResult>` — JSON parser with fence stripping

### hadron-core: `ai/jira_brief.rs`

Combines triage + deep analysis:

```rust
pub struct JiraBriefResult {
    pub triage: JiraTriageResult,
    pub analysis: JiraDeepResult,  // from existing jira_analysis.rs
}
```

No prompt of its own — it's an orchestration type.

### Database: `migrations/014_ticket_briefs.sql`

```sql
CREATE TABLE ticket_briefs (
    jira_key        TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '',
    severity        TEXT,
    category        TEXT,
    tags            TEXT,             -- JSON array string
    triage_json     TEXT,             -- full JiraTriageResult serialized
    brief_json      TEXT,             -- full JiraBriefResult serialized
    posted_to_jira  BOOLEAN NOT NULL DEFAULT FALSE,
    posted_at       TIMESTAMPTZ,
    engineer_rating SMALLINT,
    engineer_notes  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_briefs_severity ON ticket_briefs(severity);
```

### hadron-server: DB functions

New file `db/ticket_briefs.rs` (or append to `db/mod.rs`):
- `upsert_ticket_brief(pool, jira_key, title, severity, category, tags, triage_json, brief_json)` — ON CONFLICT upsert
- `get_ticket_brief(pool, jira_key) -> Option<TicketBriefRow>`
- `get_ticket_briefs_batch(pool, jira_keys: &[String]) -> Vec<TicketBriefRow>`
- `delete_ticket_brief(pool, jira_key)`

`TicketBriefRow` — mirrors DB columns, serialized to frontend as JSON.

### hadron-server: Routes

Extend `routes/jira_analysis.rs` with new endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/jira/issues/{key}/triage` | Triage only (fast ~2-3s), persists to DB |
| POST | `/api/jira/issues/{key}/brief` | Triage + deep in parallel, persists |
| POST | `/api/jira/issues/{key}/brief/stream` | SSE — streams deep analysis, triage runs first |
| GET | `/api/jira/briefs/{key}` | Load persisted brief from DB |
| POST | `/api/jira/briefs/batch` | Load multiple briefs by keys |
| DELETE | `/api/jira/briefs/{key}` | Delete brief |

**Triage endpoint flow:**
1. Fetch ticket detail (reuse `fetch_issue_detail`)
2. Build triage prompt, call `ai::complete()`
3. Parse result, persist to `ticket_briefs` (triage_json only, brief_json=NULL)
4. Return `JiraTriageResult`

**Brief endpoint flow:**
1. Fetch ticket detail
2. `tokio::try_join!` — run triage + deep analysis in parallel
3. Parse both results, persist to `ticket_briefs` (both triage_json + brief_json)
4. Return `JiraBriefResult`

**Brief stream flow:**
1. Fetch ticket detail
2. Run triage first (fast, ~2-3s)
3. Stream deep analysis via SSE
4. On completion, persist both to DB (fire-and-forget)

All endpoints take `JiraCredentials` in request body (same pattern as Phase 1b).

---

## Frontend

### Types (in `api.ts`)

```typescript
interface JiraTriageResult {
  severity: string;
  category: string;
  customer_impact: string;
  tags: string[];
  confidence: string;
  rationale: string;
}

interface JiraBriefResult {
  triage: JiraTriageResult;
  analysis: JiraDeepResult;  // already defined in Phase 1b
}

interface TicketBriefRow {
  jiraKey: string;
  title: string;
  severity: string | null;
  category: string | null;
  tags: string | null;        // JSON string
  triageJson: string | null;
  briefJson: string | null;
  postedToJira: boolean;
  postedAt: string | null;
  engineerRating: number | null;
  engineerNotes: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### API methods

```typescript
triageJiraIssue(key, credentials): Promise<JiraTriageResult>
generateJiraBrief(key, credentials): Promise<JiraBriefResult>
getTicketBrief(key): Promise<TicketBriefRow | null>
getTicketBriefsBatch(keys): Promise<TicketBriefRow[]>
deleteTicketBrief(key): Promise<void>
```

### JiraAnalyzerView extensions

Extend the existing component from Phase 1b:
- After ticket fetch, check for stored brief: `getTicketBrief(key)` → if found, display cached triage/brief
- Add "Triage" button (amber) — calls `triageJiraIssue()` (non-streaming), shows `TriageBadgePanel`
- Add "Generate Brief" button (indigo) — streams from `/api/jira/issues/{key}/brief/stream`, shows `TicketBriefPanel`
- Button order: Fetch → [Triage] [Generate Brief] [Deep Analyze]

### TriageBadgePanel (new)

Props: `{ result: JiraTriageResult }`

Compact display:
- Row of badges: severity (colored), category (colored), confidence
- Tags as small pills
- Expandable: customer impact text, rationale

Color maps:
- Severity: Critical=red, High=orange, Medium=yellow, Low=green
- Category: Bug=red, Feature=blue, Infrastructure=gray, UX=pink, Performance=orange, Security=purple
- Confidence: High=green, Medium=yellow, Low=red

### TicketBriefPanel (new)

Props: `{ jiraKey: string; result: JiraBriefResult }`

Two tabs:
- **Brief tab:** Triage line (severity + category + tags), plain summary, customer impact, technical analysis (root cause, error type, affected areas, severity estimate, confidence), recommended actions (checkboxes + priority badges), risk & impact, triage rationale
- **Analysis tab:** Quality gauge + verdict + strengths/gaps, open questions

Reuses `QualityGauge` from code-analyzer shared components.

### JiraProjectFeed (new view)

Add `"jira-feed"` to App.tsx View type + nav.

Sections:
1. **Config:** JIRA credentials (shared from localStorage), project key input, "Load Issues" button
2. **Toolbar:** Search input (debounced 300ms), "Triage All" button, "Triaged only" checkbox, severity dropdown filter
3. **Feed:** Expandable issue rows — key, status, severity badge (from cached brief), title. Expanded: type, components, labels, description excerpt, triage badges
4. **Batch triage:** Sequential processing with progress bar (X/Y), cancel button, confirmation dialog (triage remaining vs re-triage all)

Feed loads issues via existing `POST /api/jira/search`, then enriches with `POST /api/jira/briefs/batch`.

---

## File Summary

### New files

| File | Purpose |
|------|---------|
| `crates/hadron-core/src/ai/jira_triage.rs` | Triage types, prompt, parser |
| `crates/hadron-core/src/ai/jira_brief.rs` | Brief result type (triage + deep) |
| `migrations/014_ticket_briefs.sql` | ticket_briefs table |
| `frontend/src/components/jira/TriageBadgePanel.tsx` | Compact triage display |
| `frontend/src/components/jira/TicketBriefPanel.tsx` | Tabbed brief + analysis display |
| `frontend/src/components/jira/JiraProjectFeed.tsx` | Project feed with batch triage |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-core/src/ai/mod.rs` | Add `pub mod jira_triage`, `pub mod jira_brief` |
| `crates/hadron-server/src/db/mod.rs` | Add ticket_briefs CRUD functions |
| `crates/hadron-server/src/routes/jira_analysis.rs` | Add triage, brief, briefs CRUD routes |
| `crates/hadron-server/src/routes/mod.rs` | Register new routes |
| `frontend/src/services/api.ts` | Add triage/brief types + API methods |
| `frontend/src/components/jira/JiraAnalyzerView.tsx` | Add Triage + Brief buttons, cached brief loading |
| `frontend/src/App.tsx` | Add `jira-feed` to View type, nav, render |
