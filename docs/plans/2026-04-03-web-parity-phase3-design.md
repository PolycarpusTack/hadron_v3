# Web-Desktop Parity Phase 3: Sentry Deep Analysis

**Date:** 2026-04-03
**Status:** Design approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`

## Overview

Port the desktop's full Sentry analysis to the web, with enhancements: 11 pattern detectors (up from desktop's 4), a 7th Recommendations tab, SSE streaming, and server-side admin-configured credentials.

## Design Decisions

1. **Credentials:** Admin-configured in `global_settings` (same pattern as JIRA/AI keys). No per-user tokens.
2. **Storage:** Reuse existing `analyses` table with `analysis_type = 'sentry'`. No new tables needed.
3. **Pattern detection:** 11 detectors in hadron-core (4 ported from desktop + 7 new). Pure functions, no I/O.
4. **Streaming:** SSE via existing `stream_ai_completion()` helper. Consistent with Code Analyzer and JIRA analysis.
5. **UI:** 7-tab detail view (desktop's 6 + new Recommendations tab).

---

## 1. hadron-core: `ai/sentry_analysis.rs`

### Input Types

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryIssueDetail {
    pub id: String,
    pub short_id: String,
    pub title: String,
    pub culprit: Option<String>,
    pub level: String,          // error | warning | info | fatal | debug
    pub status: String,         // unresolved | resolved | ignored
    pub platform: Option<String>,
    pub count: Option<String>,
    pub user_count: Option<i64>,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub permalink: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryEventDetail {
    pub event_id: Option<String>,
    pub title: Option<String>,
    pub message: Option<String>,
    pub platform: Option<String>,
    pub breadcrumbs: Vec<SentryBreadcrumb>,
    pub exceptions: Vec<SentryException>,
    pub tags: Vec<SentryTag>,
    pub contexts: serde_json::Value,  // raw contexts object
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryBreadcrumb {
    pub timestamp: Option<String>,
    pub category: Option<String>,
    pub message: Option<String>,
    pub level: Option<String>,
    pub data: Option<serde_json::Value>,
    pub breadcrumb_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryException {
    pub exception_type: Option<String>,
    pub value: Option<String>,
    pub module: Option<String>,
    pub stacktrace: Option<Vec<SentryFrame>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryFrame {
    pub filename: Option<String>,
    pub function: Option<String>,
    pub line_no: Option<i64>,
    pub col_no: Option<i64>,
    pub context_line: Option<String>,
    pub pre_context: Option<Vec<String>>,
    pub post_context: Option<Vec<String>>,
    pub in_app: Option<bool>,
    pub module: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SentryTag {
    pub key: String,
    pub value: String,
}
```

### Output Types

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryAnalysisResult {
    #[serde(default)]
    pub error_type: String,
    #[serde(default)]
    pub error_message: String,
    #[serde(default)]
    pub severity: String,          // CRITICAL | HIGH | MEDIUM | LOW
    #[serde(default)]
    pub root_cause: String,
    #[serde(default)]
    pub suggested_fixes: Vec<String>,
    #[serde(default)]
    pub component: String,
    #[serde(default)]
    pub confidence: String,        // HIGH | MEDIUM | LOW
    #[serde(default)]
    pub pattern_type: String,      // deadlock | n_plus_one | memory_leak | etc. | generic
    #[serde(default)]
    pub user_impact: String,
    #[serde(default)]
    pub breadcrumb_analysis: String,
    #[serde(default)]
    pub recommendations: Vec<SentryRecommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryRecommendation {
    #[serde(default)]
    pub priority: String,          // high | medium | low
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub effort: String,            // low | medium | high
    #[serde(default)]
    pub code_snippet: Option<String>,
}
```

### Pattern Detection

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedPattern {
    pub pattern_type: PatternType,
    pub confidence: f32,           // 0.0–1.0
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PatternType {
    Deadlock,
    NPlusOne,
    MemoryLeak,
    UnhandledPromise,
    RaceCondition,
    ConnectionExhaustion,
    TimeoutCascade,
    AuthFailure,
    ConstraintViolation,
    ResourceExhaustion,
    StackOverflow,
}
```

**Detector functions** — each is `fn detect_<name>(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern>`:

| Detector | Keywords / Heuristics | Confidence |
|---|---|---|
| **Deadlock** | "deadlock", "lock timeout", "lock wait timeout", "40p01" in title/exceptions/tags | 0.9 (2+ evidence), 0.7 (1) |
| **N+1 Query** | Repeated DB/HTTP breadcrumbs grouped by normalized query (≥3 repeats); "n+1" keyword | 0.85 (repeated), 0.6 (keyword) |
| **Memory Leak** | "out of memory", "oom", "heap exhausted", "OutOfMemoryError" | 0.9 (2+), 0.75 (1) |
| **Unhandled Promise** | "unhandledrejection", "unhandled promise", exception type matching | 0.9 (2+), 0.8 (1) |
| **Race Condition** | "race condition", "concurrent modification", "ConcurrentModificationException", "data race", "TOCTOU"; multiple threads in context | 0.85 (2+), 0.65 (1) |
| **Connection Exhaustion** | "pool timeout", "too many connections", "connection limit", "EMFILE", "ENFILE", "socket limit" | 0.9 (2+), 0.7 (1) |
| **Timeout Cascade** | Multiple timeout-related breadcrumbs within short window; "upstream timeout", "gateway timeout", "504" | 0.85 (3+ timeouts), 0.65 (1-2) |
| **Auth Failure** | 401/403 in breadcrumb HTTP statuses or tags; "token expired", "unauthorized", "forbidden", "JWT expired" | 0.9 (2+), 0.7 (1) |
| **Constraint Violation** | "unique constraint", "duplicate key", "foreign key violation", "check constraint", "serialization failure", "23505", "23503" | 0.9 (explicit error code), 0.75 (keyword) |
| **Resource Exhaustion** | "disk full", "no space left", "ENOSPC", "file descriptor", "EMFILE", "too many open files", "CPU quota" | 0.9 (2+), 0.75 (1) |
| **Stack Overflow** | "stack overflow", "maximum call stack size exceeded", "StackOverflowError", "recursion depth" | 0.95 (explicit), 0.8 (keyword) |

**Orchestrator:** `detect_sentry_patterns(issue, event) -> Vec<DetectedPattern>` — runs all 11 detectors, collects non-None results, sorts by confidence descending.

### Prompt

`SENTRY_ANALYSIS_SYSTEM_PROMPT` — system prompt requesting JSON with the `SentryAnalysisResult` schema. Instructs the AI to:
- Analyze in-app frames (marked `[APP]`) vs library frames (`[LIB]`)
- Interpret breadcrumb sequence leading to the error
- Consider runtime context clues (OS, browser, runtime versions)
- Assess user impact based on event count and affected users
- Generate prioritized recommendations with effort estimates
- If pattern detectors found results, incorporate them (included in user message)

`build_sentry_analysis_messages(issue, event, patterns) -> (String, Vec<AiMessage>)`:
- Normalizes issue + event into structured text (issue header, exception chain with up to 30 frames, last 30 breadcrumbs, tags, contexts)
- Appends detected patterns section if non-empty
- Returns system prompt + user message

`parse_sentry_analysis(raw: &str) -> HadronResult<SentryAnalysisResult>`:
- Strips markdown fences, parses JSON, returns result with helpful error preview on failure

### Event Normalization

`normalize_sentry_event(raw: &serde_json::Value) -> SentryEventDetail`:
- Extracts `entries` array → finds "breadcrumbs" and "exception" entry types
- Breadcrumbs: takes last 30, parses each into `SentryBreadcrumb`
- Exceptions: parses each with frames into `SentryException`
- Tags: extracts from top-level `tags` array
- Contexts: passes through raw JSON value

---

## 2. hadron-server: Routes & Config

### Migration 016

Seeds `global_settings` with three new keys (same encrypted storage pattern as AI/JIRA):
- `sentry_base_url` (default empty)
- `sentry_auth_token` (default empty, encrypted)
- `sentry_organization` (default empty)

No new tables. No schema changes to `analyses`.

### Admin Config

Add "Sentry Configuration" section to admin panel:
- Inputs: Base URL, Organization slug, Auth Token (masked)
- Test Connection button (calls existing `sentry_test` with candidate creds)
- Save button (persists to `global_settings`)
- Status indicator (configured / not configured)

### Refactored Browse Routes

Existing routes (`sentry_projects`, `sentry_issues`, `sentry_event`) change from accepting config in request body to reading from `global_settings`. The `sentry_test` route stays as-is (admin provides candidate credentials during setup).

New route: `GET /api/sentry/issues/{id}` — fetch single issue detail.

### New Route File: `routes/sentry_analysis.rs`

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `POST /api/sentry/issues/{id}/analyze/stream` | POST | any user | SSE streaming analysis |
| `POST /api/sentry/issues/{id}/analyze` | POST | any user | Non-streaming analysis (fallback) |
| `GET /api/sentry/analyses` | GET | any user | List user's Sentry analyses (`analysis_type = 'sentry'`) |
| `GET /api/sentry/analyses/{id}` | GET | any user | Get single analysis |
| `DELETE /api/sentry/analyses/{id}` | DELETE | any user | Soft-delete analysis |

### Streaming Analysis Flow

1. Load Sentry config from `global_settings`
2. Fetch issue via Sentry API → deserialize to `SentryIssueDetail`
3. Fetch latest event via Sentry API → raw JSON
4. `normalize_sentry_event(raw)` → `SentryEventDetail`
5. `detect_sentry_patterns(&issue, &event)` → `Vec<DetectedPattern>`
6. `build_sentry_analysis_messages(&issue, &event, &patterns)` → `(system, messages)`
7. Load AI config from `global_settings`
8. `stream_ai_completion(ai_config, messages, Some(system))` → SSE response
9. On stream completion: `parse_sentry_analysis(accumulated_text)` → `SentryAnalysisResult`
10. Insert into `analyses` table:
    - `filename` = issue short ID (e.g., `PROJ-123`)
    - `analysis_type` = `'sentry'`
    - `error_type`, `severity`, `root_cause`, `suggested_fixes`, `component`, `confidence` from AI result
    - `full_data` = `{ issue, event, patterns, ai_result, breadcrumbs, exceptions, tags, contexts }`
11. Send final SSE event with analysis ID

---

## 3. Frontend Components

### Component Tree

```
frontend/src/components/sentry/
├── SentryPanel.tsx              # orchestrator: 3 nav tabs, config check, progress
├── SentrySettings.tsx           # admin config section (Base URL, org, token, test)
├── SentryIssueBrowser.tsx       # project selector, status filter, search, issue list
├── SentryIssueRow.tsx           # expandable issue card, Analyze button
├── SentryQuickImport.tsx        # URL/ID/short-ID input, issue preview
├── SentryAnalysisHistory.tsx    # past analyses (analysis_type='sentry'), search
├── SentryDetailView.tsx         # 7-tab analysis report, header actions
├── SentryPatternCard.tsx        # pattern confidence, evidence, remediation
├── SentryBreadcrumbTimeline.tsx # vertical timeline, category icons, color levels
├── SentryExceptionChain.tsx     # expandable exception cards, APP/LIB frame tables
├── SentryRuntimeContext.tsx     # OS/browser/device/runtime grid, tags
├── SentryUserImpact.tsx         # event count, affected users, timeline stats
├── SentryRecommendations.tsx    # priority-ordered fix cards, effort, code snippets
└── sentryHelpers.ts             # getLevelColor, getStatusColor, formatCount, formatRelativeTime
```

### SentryPanel.tsx (Orchestrator)

- On mount: checks if Sentry is configured (GET admin config status)
- Shows "Sentry not configured" message with link to admin panel if unconfigured
- 3 tabs: **Browse Issues** | **Quick Import** | **Analysis History**
- Streaming progress bar during analysis
- Error display
- On analysis complete → renders SentryDetailView

### SentryIssueBrowser.tsx

- Project selector dropdown (from `/api/sentry/projects`)
- Status filter: all / unresolved / resolved / ignored
- Search input (debounced 400ms)
- Issue list renders SentryIssueRow components
- "Load More" pagination (cursor-based)

### SentryIssueRow.tsx

- Collapsed: title, level badge (color-coded fatal/error/warning/info/debug), platform, status badge, event count, user count, relative time
- Expanded: short ID, issue ID, first seen, last seen timestamps
- "Analyze" button (emerald) → triggers streaming analysis
- "View in Sentry" external link (if permalink available)

### SentryQuickImport.tsx

- Text input accepting: numeric ID, short ID (`PROJ-123`), or full Sentry URL
- Parses input → fetches issue → shows preview as SentryIssueRow
- Error display for invalid input

### SentryAnalysisHistory.tsx

- Search bar (debounced 300ms)
- Fetches from `/api/sentry/analyses`
- List items: severity badge, error type, filename (short ID), timestamp, AI model
- Click → loads full analysis into SentryDetailView
- Delete button (soft-delete)

### SentryDetailView.tsx — 7 Tabs

| # | Tab | Component | Content |
|---|---|---|---|
| 1 | Overview | inline | Error type, severity badge, root cause (editable), component, confidence, quick stats |
| 2 | Patterns | SentryPatternCard | Detected patterns: icon, name, confidence %, evidence bullets, remediation steps |
| 3 | Breadcrumbs | SentryBreadcrumbTimeline | Vertical timeline, category icons (Globe=HTTP, Database=DB, Mouse=UI, Terminal=default), last entry highlighted red |
| 4 | Stack Trace | SentryExceptionChain | Expandable exception cards (first expanded), type/module/message, frame table with APP/LIB badges |
| 5 | Context | SentryRuntimeContext | Grid sections (OS, Browser, Device, Runtime), key-value pairs, tag list (excludes sentry:* internal) |
| 6 | Impact | SentryUserImpact | AI user impact assessment, stats grid (Total Events, Affected Users, First Seen, Days Active) |
| 7 | Recommendations | SentryRecommendations | Priority-ordered cards: title, description, effort badge (low/med/high), optional code snippet block |

**Header actions:** Copy Report | Export (via ExportDialog) | View in Sentry

### SSE Streaming

Uses the established `useAiStream()` hook pattern:
- Connect to `/api/sentry/issues/{id}/analyze/stream`
- Accumulate token events, update progress
- On `done` event: receive analysis ID, fetch full analysis, render SentryDetailView

---

## 4. Testing

### hadron-core Unit Tests

In `sentry_analysis.rs`:

- `test_build_sentry_analysis_prompt` — prompt construction with sample issue + event
- `test_parse_sentry_analysis_result` — parse complete AI JSON response
- `test_parse_sentry_analysis_defaults` — graceful degradation with minimal JSON
- `test_normalize_sentry_event` — extract breadcrumbs/exceptions/tags from raw event JSON
- 11 pattern detector tests (one per pattern) — feed known input, assert detection + confidence
- `test_no_false_positive_patterns` — clean event produces empty pattern list
- `test_pattern_confidence_ordering` — multiple patterns sorted by confidence descending

### Manual Testing

- Connect to Sentry → browse projects → list issues → analyze → verify 7-tab detail view
- Quick import with URL, short ID, numeric ID
- Analysis history: list, view, delete
- Admin config: save, test, clear
- SSE streaming: verify progressive output

---

## 5. Implementation Order

1. **Migration 016** — seed Sentry config keys in `global_settings`
2. **Admin config UI** — Sentry section in admin panel
3. **hadron-core `sentry_analysis`** — types, 11 pattern detectors, prompt, parser, event normalizer, tests
4. **hadron-server routes** — refactor browse routes to use server config, add analyze/stream + CRUD routes
5. **Frontend** — SentryPanel refactor → IssueBrowser → IssueRow → QuickImport → DetailView (7 tabs) → AnalysisHistory → sentryHelpers
