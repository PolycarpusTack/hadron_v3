# JIRA History in General History Tab — Design

**Date:** 2026-03-06
**Goal:** Show JIRA ticket briefs alongside crash/code analyses in the History tab, with filter chips to toggle between them.

---

## Backend

### New Rust Command

`get_all_ticket_briefs() -> Vec<TicketBrief>`

- New function in `ticket_briefs.rs`: `get_all_briefs(conn) -> Result<Vec<TicketBrief>>`
- Query: `SELECT * FROM ticket_briefs ORDER BY updated_at DESC`
- New Tauri command in `commands/jira_assist.rs`: `get_all_ticket_briefs`
- Register in `main.rs`

### TypeScript API

New function in `services/jira-assist.ts`:
```typescript
export async function getAllTicketBriefs(): Promise<TicketBrief[]>
```

---

## Frontend

### Unified Item Model

Discriminated union in `HistoryView.tsx`:
```typescript
type HistoryItem =
  | { kind: "analysis"; data: Analysis; date: string }
  | { kind: "jira"; data: TicketBrief; date: string }
```

Items merged into a single list sorted by date (`analyzed_at` for analyses, `updated_at` for briefs).

### Quick Filter Chips

Add two new chips alongside existing "all", "today", "7days", "gold", "noTags":
- `"jira"` — show only JIRA briefs
- `"analyses"` — show only analyses (hides JIRA)
- `"all"` — shows both (default, now includes JIRA)

### List Row Mapping

JIRA items render using the same grid columns:

| Column | Analysis value | JIRA value |
|--------|---------------|------------|
| File | `analysis.filename` | JIRA key + "JIRA" badge |
| Root Cause | `analysis.root_cause` | ticket title |
| Severity | `analysis.severity` | triage severity |
| Status | "analyzed" | "triaged" / "briefed" / "posted" |
| Component | `analysis.component` | category |
| Cost | `analysis.cost` | "—" |

### Preview Panel

When a JIRA item is selected, the right preview panel shows:
- Triage summary: severity badge, category badge, customer impact
- Brief summary (if `brief_json` exists): one-line summary from parsed brief
- Tags if present
- "Open in JIRA Analyzer" button → navigates to JIRA tab with ticket key
- "Delete" button

### Sorting

JIRA items participate in existing sort modes:
- `recent` — by date (unified with analyses)
- `severity` — same ordering (critical=0, high=1, medium=2, low=3)
- `recurrence` / `cost` — JIRA items sort to bottom (no data)

### Grouping

- `severity` — grouped with analyses of same severity
- `component` — uses category as component
- `status` — uses derived status string

### Navigation

"Open in JIRA Analyzer" button calls `onViewJiraTicket(jiraKey)` prop, which the parent (`App.tsx`) handles by switching to the JIRA tab and loading the ticket.

---

## Not In Scope

- Bulk operations on JIRA items (selection, export, tagging)
- Search across JIRA brief content
- Tags on JIRA items
- Favorites on JIRA items

---

## Files Changed

### New/Modified Backend
- `src-tauri/src/ticket_briefs.rs` — add `get_all_briefs()`
- `src-tauri/src/database.rs` — add `get_all_ticket_briefs()` wrapper
- `src-tauri/src/commands/jira_assist.rs` — add `get_all_ticket_briefs` command
- `src-tauri/src/main.rs` — register command

### New/Modified Frontend
- `src/services/jira-assist.ts` — add `getAllTicketBriefs()` API
- `src/components/HistoryView.tsx` — unified items, JIRA rows, JIRA preview, filter chips
- `src/App.tsx` — pass `onViewJiraTicket` prop to HistoryView, handle navigation
