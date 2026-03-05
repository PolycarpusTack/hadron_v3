# Sprint 6: Project Feed Integration

**Status**: Planning
**Depends on**: Sprints 1-5 (complete)
**Files touched**: 5 Rust, 2 TypeScript, 1 component

---

## Overview

Integrate JIRA Assist triage data into the Project Feed tab. Add batch triage, severity badges in feed rows, and client-side filters for triaged/severity.

---

## Task 1: `get_ticket_briefs_batch` Rust command

Add a batch lookup command so the feed can load triage data for all visible tickets in one call instead of N individual calls.

### Steps

1. **`src-tauri/src/ticket_briefs.rs`** — add `get_briefs_batch`:
   ```rust
   pub fn get_briefs_batch(conn: &Connection, jira_keys: &[String]) -> Result<Vec<TicketBrief>> {
       // Build "WHERE jira_key IN (?, ?, ...)" with params
       // Return all matching TicketBrief rows
   }
   ```

2. **`src-tauri/src/database.rs`** — add wrapper:
   ```rust
   pub fn get_ticket_briefs_batch(&self, jira_keys: &[String]) -> Result<Vec<TicketBrief>> {
       let conn = self.lock_conn();
       crate::ticket_briefs::get_briefs_batch(&conn, jira_keys)
   }
   ```

3. **`src-tauri/src/commands/jira_assist.rs`** — add Tauri command:
   ```rust
   #[tauri::command]
   pub async fn get_ticket_briefs_batch(
       jira_keys: Vec<String>,
       db: DbState<'_>,
   ) -> Result<Vec<TicketBrief>, String> { ... }
   ```

4. **`src-tauri/src/main.rs`** — register in `invoke_handler`.

5. **`src/services/jira-assist.ts`** — add TypeScript function:
   ```typescript
   export async function getTicketBriefsBatch(jiraKeys: string[]): Promise<TicketBrief[]> {
       return invoke<TicketBrief[]>("get_ticket_briefs_batch", { jiraKeys });
   }
   ```

### Verify
- `cargo check` passes in `src-tauri/`.

---

## Task 2: Severity badges in feed rows

Show triage data in the Project Feed — compact pill in collapsed row, full badges on expand.

### Steps

1. **`JiraProjectFeed.tsx`** — import `getTicketBriefsBatch`, `TicketBrief`, `SEVERITY_BADGE`, `CATEGORY_COLORS` from jira-assist.ts.

2. **Add state**: `briefsMap: Map<string, TicketBrief>` (keyed by jira_key).

3. **Load briefs on feed refresh**: After `loadIssues()` resolves with issues, call `getTicketBriefsBatch(issues.map(i => i.key))` and populate `briefsMap`.

4. **Collapsed row**: After the issue key, render a small severity pill if `briefsMap.has(issue.key)`:
   ```tsx
   {brief && brief.severity && (
     <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${SEVERITY_BADGE[brief.severity] ?? ""}`}>
       {brief.severity}
     </span>
   )}
   ```

5. **Expanded details**: Below existing labels/components, render severity + category + tags badges if triage data exists. Use the same badge styles from `SEVERITY_BADGE` and `CATEGORY_COLORS`.

### Verify
- Visual check: feed rows show severity pills for triaged tickets.
- Non-triaged tickets show no badge (no visual regression).

---

## Task 3: Batch triage button + progress

Add "Triage All Visible" button with confirmation dialog, sequential processing, and progress indicator.

### Steps

1. **`JiraProjectFeed.tsx`** — import `triageJiraTicket`, `getTicketBrief` from jira-assist.ts. Import `getApiKey`, `getAiConfig` (or equivalent) for AI credentials.

2. **Add state**:
   - `triageProgress: { current: number; total: number; key: string } | null`
   - `triageCancelled: React.MutableRefObject<boolean>` (useRef)

3. **Confirmation dialog**: When "Triage All Visible" clicked:
   - Count how many visible (filtered) tickets already have briefs in `briefsMap`.
   - Show confirm: "X of Y tickets already triaged. Triage remaining X only, or re-triage all?"
   - Two buttons: "Remaining Only" / "Re-triage All" + Cancel.

4. **Sequential triage loop**:
   ```typescript
   async function handleBatchTriage(ticketsToTriage: NormalizedIssue[]) {
     triageCancelled.current = false;
     for (let i = 0; i < ticketsToTriage.length; i++) {
       if (triageCancelled.current) break;
       setTriageProgress({ current: i + 1, total: ticketsToTriage.length, key: ticketsToTriage[i].key });
       await triageJiraTicket({ ...params });
       // Update briefsMap with new result
     }
     setTriageProgress(null);
   }
   ```

5. **Progress bar**: When `triageProgress` is set, show inline progress in the header:
   ```
   Triaging 3/47 (PROJ-123)...  [Cancel]
   ```

6. **Cancel button**: Sets `triageCancelled.current = true`. Loop exits on next iteration.

7. **After completion**: Refresh `briefsMap` via `getTicketBriefsBatch` to pick up all new triage data.

### Verify
- Click "Triage All Visible" on feed with mix of triaged/untriaged tickets.
- Confirm dialog shows correct counts.
- Progress updates per ticket. Cancel stops the loop.
- Severity badges appear on newly triaged tickets after completion.

---

## Task 4: Feed filters (Triaged Only + Severity)

Add client-side filters alongside existing search bar.

### Steps

1. **Add state**:
   - `filterTriagedOnly: boolean` (default false)
   - `filterSeverity: string` (default "All")

2. **Filter UI**: Add next to search input:
   - Toggle/checkbox: "Triaged Only"
   - Dropdown: Severity (All / Critical / High / Medium / Low)

3. **Compose filters** in the existing `filteredIssues` computation:
   ```typescript
   let filtered = issues;
   // Existing text search
   if (debouncedSearch) { filtered = filtered.filter(...); }
   // New: triaged only
   if (filterTriagedOnly) { filtered = filtered.filter(i => briefsMap.has(i.key)); }
   // New: severity
   if (filterSeverity !== "All") {
     filtered = filtered.filter(i => briefsMap.get(i.key)?.severity === filterSeverity);
   }
   ```

4. **Style**: Use same dark-mode styling as existing feed controls (gray-700 borders, gray-300 text).

### Verify
- Toggle "Triaged Only" hides untriaged tickets.
- Severity dropdown filters correctly.
- Filters compose with text search.
- "Load More" button still hidden when filters are active.

---

## Task 5: Verify + commit

### Steps
1. Run `cargo check` in `src-tauri/` — must pass.
2. Run `npx tsc --noEmit` in `hadron-desktop/` — must pass (or show only pre-existing errors).
3. Visual smoke test: feed loads, badges show, batch triage works, filters work.
4. Commit with message: `feat(jira-assist): Sprint 6 — project feed integration with batch triage + severity badges`.

---

## Batch Plan

| Batch | Tasks | Gate |
|-------|-------|------|
| 1 | Tasks 1-2 | Cargo check + badges visible |
| 2 | Tasks 3-4 | Batch triage + filters working |
| 3 | Task 5 | Final verify + commit |
