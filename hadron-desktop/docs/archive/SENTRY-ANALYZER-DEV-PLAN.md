# Sentry Analyzer — Development Plan

## Summary

5 phases, estimated 2000 lines of new code across Rust and TypeScript. Each phase produces a working increment that can be tested independently.

---

## Phase 1: Sentry API Client + Settings UI

**Goal:** Connect to Sentry, browse projects, verify auth works.

### Backend (Rust)

1. **Create `sentry_service.rs`**
   - Static `Lazy<Client>` with 30s timeout (mirror `jira_service.rs` pattern)
   - `test_sentry_connection(base_url, auth_token)` — GET `/api/0/projects/`
   - `list_sentry_projects(base_url, auth_token)` — GET `/api/0/projects/`
   - Data structs: `SentryTestResponse`, `SentryProjectInfo`
   - Auth: Bearer token in Authorization header

2. **Create `commands/sentry.rs`**
   - `#[tauri::command] test_sentry_connection`
   - `#[tauri::command] list_sentry_projects`
   - Register in `main.rs` invoke_handler

3. **Add `mod sentry_service;` to `main.rs`**

### Frontend (TypeScript)

4. **Create `SentrySettings.tsx`**
   - Form: Instance URL, Auth Token (masked), Organization slug
   - "Test Connection" button → calls `test_sentry_connection` command
   - Project dropdown populated from `list_sentry_projects`
   - Save config to Tauri store, token to `secure-storage.ts`
   - Follow `JiraSettings.tsx` patterns exactly

5. **Add to `SettingsPanel.tsx`**
   - Lazy import `SentrySettings` in integrations tab
   - Add below existing JiraSettings section

6. **Add Sentry types to `types/index.ts`**
   - `SentryConfig`, `SentryProjectInfo`, `SentryTestResponse`

### Verification
- [ ] Settings UI renders in integrations tab
- [ ] "Test Connection" succeeds with valid Sentry token
- [ ] Project dropdown populates
- [ ] Token persists across app restart (encrypted store)
- [ ] `cargo check` and `npm run build` pass

---

## Phase 2: Issue Browser

**Goal:** Browse and search Sentry issues from a selected project.

### Backend (Rust)

1. **Add to `sentry_service.rs`**
   - `list_sentry_issues(base_url, auth_token, org, project, query, cursor)` — GET `/api/0/projects/{org}/{project}/issues/`
   - `fetch_sentry_issue(base_url, auth_token, issue_id)` — GET `/api/0/issues/{issue_id}/`
   - `fetch_sentry_latest_event(base_url, auth_token, issue_id)` — GET `/api/0/issues/{issue_id}/events/latest/`
   - Data structs: `SentryIssue`, `SentryIssueList`, `SentryEvent`, `SentryStacktrace`, `SentryFrame`, `SentryBreadcrumb`
   - Parse Sentry's `entries[]` array to extract exception/stacktrace and breadcrumbs

2. **Add to `commands/sentry.rs`**
   - `#[tauri::command] list_sentry_issues`
   - `#[tauri::command] fetch_sentry_issue`
   - Register in `main.rs`

### Frontend (TypeScript)

3. **Create `SentryAnalyzerView.tsx`**
   - Three-panel layout:
     - Quick import bar (paste URL/ID)
     - Project selector + search bar + status filter
     - Scrollable issue list with: title, level badge, platform, event count, user count, last seen
   - Click issue → expand inline preview (stacktrace summary, breadcrumbs count, tags)
   - Loading/empty/error states
   - Pagination via cursor (Sentry uses cursor-based pagination)

4. **Add to `App.tsx`**
   - Add `"sentry"` to View type union
   - Add conditional render: `{currentView === "sentry" && <SentryAnalyzerView ... />}`
   - Lazy load the component

5. **Add to `Navigation.tsx`**
   - Add Sentry tab button (Shield icon from lucide-react)
   - Show only when Sentry is configured (check stored config)

6. **Add types to `types/index.ts`**
   - `SentryIssue`, `SentryEvent`, `SentryStacktrace`, `SentryFrame`, `SentryBreadcrumb`

### Verification
- [ ] Sentry tab appears in navigation when configured
- [ ] Issue list loads from selected project
- [ ] Search filters issues
- [ ] Status filter works (unresolved/resolved/ignored)
- [ ] Clicking issue shows preview with stacktrace
- [ ] Pagination loads more issues
- [ ] Quick import accepts Sentry URL and resolves to issue

---

## Phase 3: AI Analysis Pipeline

**Goal:** Analyze a Sentry issue using the existing AI pipeline.

### Backend (Rust)

1. **Add to `sentry_service.rs`**
   - `normalize_sentry_to_crash_content(issue, event)` — converts Sentry data to a text format suitable for AI analysis
   - Extracts: exception chain, in-app frames, breadcrumb timeline, tags, context
   - Formats as structured text similar to a crash log

2. **Add to `commands/sentry.rs`**
   - `#[tauri::command] analyze_sentry_issue` — the main analysis command
   - Flow:
     1. Fetch issue + latest event from Sentry API
     2. Normalize to analysis content
     3. Run pattern detection (see Phase 4)
     4. Call `ai_service::analyze_crash_log_safe()` with Sentry system prompt
     5. Parse AI response
     6. Save to `analyses` table with `analysis_type = "sentry"`, `filename = short_id`
     7. Emit progress events throughout

3. **Add Sentry system prompt constant**
   - In `ai_service.rs` or `sentry_service.rs`
   - Tuned for stacktrace + breadcrumb + context analysis

### Frontend (TypeScript)

4. **Add "Analyze" button to `SentryAnalyzerView.tsx`**
   - On issue row: "Analyze" button
   - On quick import: "Import & Analyze" button
   - Shows AnalysisProgressBar during analysis
   - On completion: navigates to analysis detail view (reuse existing)

5. **Add to `services/api.ts` or create `services/sentry.ts`**
   - `analyzeSentryIssue(issueId, ...)` wrapper for the Tauri command
   - Circuit breaker integration (optional, same as crash analysis)

### Verification
- [ ] Clicking "Analyze" on a Sentry issue triggers AI analysis
- [ ] Progress bar shows phases (Fetching → Analyzing → Saving → Complete)
- [ ] Analysis result displays in standard AnalysisDetailView
- [ ] Result saved to database with `analysis_type = "sentry"`
- [ ] Result appears in History view
- [ ] Result is searchable via FTS5
- [ ] Can export, favorite, tag the result

---

## Phase 4: Pattern Detection

**Goal:** Detect deadlocks, N+1 queries, memory leaks, and unhandled promises.

### Backend (Rust)

1. **Create pattern detection module** (in `sentry_service.rs` or separate file)
   - `detect_sentry_patterns(event: &SentryEvent) -> Vec<DetectedPattern>`
   - Patterns:
     - **Deadlock**: message contains "deadlock", error code 40P01
     - **N+1 Query**: repeated similar DB spans (3+ threshold)
     - **Memory Leak**: OutOfMemory, heap exhaustion keywords
     - **Unhandled Promise**: UnhandledRejection in title/type
   - Returns pattern type + confidence + evidence

2. **Enhance AI prompt with pattern context**
   - If patterns detected, prepend to prompt:
     "Detected patterns: [deadlock, N+1]. Focus your analysis on these."
   - Include evidence snippets in the prompt

3. **Add pattern info to `full_data` JSON**
   - Store detected patterns in the analysis `full_data` field
   - Frontend can display pattern badges

### Frontend (TypeScript)

4. **Add pattern badges to analysis results**
   - Show detected pattern type as colored badge (Deadlock: red, N+1: orange, etc.)
   - In both the issue list preview and the analysis detail view

5. **Add pattern filter to History view** (optional)
   - Filter analyses by detected pattern type

### Verification
- [ ] Deadlock issues show "Deadlock" badge
- [ ] N+1 patterns detected from span data
- [ ] Memory leak keywords trigger detection
- [ ] Unhandled promise issues identified
- [ ] AI analysis is enhanced by pattern context
- [ ] Patterns stored in full_data and visible in UI

---

## Phase 5: Polish & Integration

**Goal:** Production-quality UX, edge cases, and cross-feature integration.

### Tasks

1. **Error handling hardening**
   - Sentry API rate limiting (429 → show "Rate limited, retry in X seconds")
   - Network errors → clear messages
   - Invalid token → prompt to re-enter in settings
   - Empty projects → helpful message

2. **JIRA cross-linking**
   - From Sentry analysis result, "Create JIRA Ticket" (reuse existing flow)
   - Include Sentry permalink in JIRA ticket description

3. **Bulk analysis**
   - Select multiple issues → "Analyze All" button
   - Queue with progress indicator
   - Skip already-analyzed issues (check by Sentry issue ID in filename field)

4. **Re-analysis**
   - "Re-analyze" button on existing Sentry analyses
   - Fetches fresh event data from Sentry before re-running AI

5. **Sentry link in analysis detail**
   - "View in Sentry" button that opens permalink in browser

6. **Keyboard shortcuts**
   - `Ctrl+S` or similar to open Sentry Analyzer tab

7. **Help documentation**
   - Add Sentry section to HELP.md
   - Include: setup guide, troubleshooting, supported patterns

### Verification
- [ ] Rate limiting handled gracefully
- [ ] JIRA ticket creation works from Sentry analysis
- [ ] Bulk analysis processes multiple issues
- [ ] "View in Sentry" opens correct URL
- [ ] Help docs cover Sentry features
- [ ] All existing features still work (regression check)

---

## File Summary

### New Files (8)

| File | Lines (est.) | Phase |
|------|-------------|-------|
| `src-tauri/src/sentry_service.rs` | 400 | 1-3 |
| `src-tauri/src/commands/sentry.rs` | 250 | 1-3 |
| `src/components/SentryAnalyzerView.tsx` | 450 | 2-3 |
| `src/components/SentrySettings.tsx` | 200 | 1 |
| `src/services/sentry.ts` | 100 | 2 |
| `docs/SENTRY-ANALYZER-SOLUTION-DESIGN.md` | — | 0 |
| `docs/SENTRY-ANALYZER-DEV-PLAN.md` | — | 0 |
| `docs/mockups/sentry-analyzer-mockup.html` | — | 0 |

### Modified Files (7)

| File | Changes | Phase |
|------|---------|-------|
| `src-tauri/src/main.rs` | Add mod + command registration | 1 |
| `src/App.tsx` | Add sentry view routing | 2 |
| `src/components/Navigation.tsx` | Add Sentry tab | 2 |
| `src/components/SettingsPanel.tsx` | Add SentrySettings import | 1 |
| `src/types/index.ts` | Add Sentry types | 1-2 |
| `src/services/secure-storage.ts` | Add "sentry" provider (if needed) | 1 |
| `docs/HELP.md` | Add Sentry section | 5 |

### Unchanged (reused as-is)
- `ai_service.rs` — AI analysis pipeline
- `circuit-breaker.ts` — Failover logic
- `database.rs` — Analysis storage
- `AnalysisDetailView.tsx` — Result display
- `AnalysisProgressBar.tsx` — Progress UI
- `HistoryView.tsx` — History + search
- `export.rs` — Export pipeline
- All JIRA linking infrastructure

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Sentry API changes | Low | Medium | Pin to `/api/0/` (stable, versioned) |
| Rate limiting | Medium | Low | Respect 429 + Retry-After header |
| Large stacktraces | Medium | Low | Truncate to token budget (existing) |
| Self-hosted Sentry differences | Low | Low | Use standard API, test both |
| Scope creep into Dexter features | Medium | High | Stick to this plan, defer extras |
