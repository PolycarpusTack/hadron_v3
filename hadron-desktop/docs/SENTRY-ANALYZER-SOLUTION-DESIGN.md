# Sentry Analyzer — Solution Design

## 1. Overview

Add a **Sentry Analyzer** tab to Hadron that lets users import Sentry issues via API and run AI-powered analysis using the same multi-provider pipeline as the Crash Analyzer. This brings Dexter's core value proposition into Hadron's stable, production-ready desktop platform.

### Goals

- Import Sentry issues by ID/URL or browse from a project list
- Analyze stacktraces, breadcrumbs, and context with AI
- Store results alongside crash analyses (unified history/search)
- Detect specialized patterns: deadlocks, N+1 queries, memory leaks
- Reuse 100% of existing Hadron infrastructure (AI, DB, export, JIRA linking)

### Non-Goals (Deferred)

- Real-time webhook ingestion (desktop app, not a server)
- Sentry alert rule management
- Session replay integration
- pgvector / PostgreSQL migration

---

## 2. Architecture

### System Context

```
┌─────────────────────────────────────────────────────┐
│                   Hadron Desktop                     │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ React    │  │ Tauri/Rust   │  │ Python AI     │  │
│  │ Frontend │──│ Backend      │──│ Engine        │  │
│  │          │  │              │  │               │  │
│  │ Sentry   │  │ sentry_      │  │ (existing     │  │
│  │ Analyzer │  │ service.rs   │  │  pipeline)    │  │
│  │ Panel    │  │              │  │               │  │
│  └──────────┘  └──────┬───────┘  └───────────────┘  │
│                       │                              │
│                ┌──────┴───────┐                      │
│                │ SQLite + FTS │                      │
│                └──────────────┘                      │
└───────────────────────┬─────────────────────────────┘
                        │ HTTPS
                  ┌─────┴──────┐
                  │ Sentry API │
                  │ (SaaS or   │
                  │  self-host)│
                  └────────────┘
```

### Data Flow

```
1. User enters Sentry issue URL or browses project issues
2. Frontend calls Tauri command: fetch_sentry_issue()
3. Rust backend calls Sentry API (Bearer token auth)
4. Response normalized to SentryIssueData struct
5. User clicks "Analyze" → analyze_sentry_issue() command
6. Backend extracts stacktrace + breadcrumbs + context
7. Constructs analysis prompt with Sentry-specific system prompt
8. Calls existing ai_service::analyze() pipeline
9. Runs pattern detectors (deadlock, N+1, memory leak)
10. Saves to analyses table (analysis_type = "sentry")
11. Frontend displays result in standard AnalysisDetailView
```

---

## 3. Component Design

### 3.1 Rust Backend

#### `sentry_service.rs` (new file, ~300 lines)

```rust
// HTTP client with 30s timeout (same pattern as jira_service.rs)
static SENTRY_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build Sentry HTTP client")
});

// Core functions:
pub async fn test_sentry_connection(base_url, auth_token) -> Result<SentryTestResponse>
pub async fn list_sentry_projects(base_url, auth_token) -> Result<Vec<SentryProject>>
pub async fn list_sentry_issues(base_url, auth_token, project, query, cursor) -> Result<SentryIssueList>
pub async fn fetch_sentry_issue(base_url, auth_token, issue_id) -> Result<SentryIssueDetail>
pub async fn fetch_sentry_event(base_url, auth_token, issue_id) -> Result<SentryEvent>
```

**Sentry API endpoints used:**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/0/projects/{org}/{project}/issues/` | Browse issues |
| `GET /api/0/issues/{issue_id}/` | Issue details |
| `GET /api/0/issues/{issue_id}/events/latest/` | Latest event (stacktrace) |
| `GET /api/0/projects/` | List projects (for settings) |

**Authentication:** Bearer token in Authorization header. Token stored in Tauri encrypted store via `secure-storage.ts` (same as JIRA/API keys).

#### `commands/sentry.rs` (new file, ~200 lines)

```rust
#[tauri::command]
pub async fn test_sentry_connection(base_url: String, auth_token: String)
    -> Result<SentryTestResponse, String>

#[tauri::command]
pub async fn list_sentry_projects(base_url: String, auth_token: String)
    -> Result<Vec<SentryProjectInfo>, String>

#[tauri::command]
pub async fn list_sentry_issues(base_url: String, auth_token: String,
    project_slug: String, query: Option<String>, cursor: Option<String>)
    -> Result<SentryIssueList, String>

#[tauri::command]
pub async fn fetch_sentry_issue(base_url: String, auth_token: String,
    issue_id: String) -> Result<SentryIssueDetail, String>

#[tauri::command]
pub async fn analyze_sentry_issue(base_url: String, auth_token: String,
    issue_id: String, api_key: String, model: String, provider: String,
    db: DbState<'_>, app: AppHandle) -> Result<AnalysisResponse, String>
```

The `analyze_sentry_issue` command:
1. Fetches issue + latest event from Sentry API
2. Extracts stacktrace, breadcrumbs, tags, context
3. Builds Sentry-specific analysis prompt
4. Calls existing `ai_service::analyze_crash_log_safe()` with constructed content
5. Runs pattern detectors on the structured data
6. Saves to `analyses` table with `analysis_type = "sentry"`
7. Emits progress events (same as crash analysis)

#### Data Structures

```rust
pub struct SentryIssueDetail {
    pub id: String,
    pub short_id: String,
    pub title: String,
    pub culprit: String,
    pub level: String,           // error, warning, info
    pub status: String,          // unresolved, resolved, ignored
    pub platform: String,        // python, javascript, java, etc.
    pub count: i64,              // Event count
    pub user_count: i64,         // Affected users
    pub first_seen: String,
    pub last_seen: String,
    pub permalink: String,
    pub metadata: serde_json::Value,
}

pub struct SentryEvent {
    pub event_id: String,
    pub title: String,
    pub message: Option<String>,
    pub platform: String,
    pub stacktrace: Option<SentryStacktrace>,
    pub breadcrumbs: Vec<SentryBreadcrumb>,
    pub tags: Vec<SentryTag>,
    pub contexts: serde_json::Value,
    pub entries: Vec<serde_json::Value>,
}

pub struct SentryStacktrace {
    pub frames: Vec<SentryFrame>,
}

pub struct SentryFrame {
    pub filename: Option<String>,
    pub function: Option<String>,
    pub line_no: Option<i64>,
    pub col_no: Option<i64>,
    pub context_line: Option<String>,
    pub pre_context: Vec<String>,
    pub post_context: Vec<String>,
    pub in_app: bool,
}

pub struct SentryBreadcrumb {
    pub timestamp: String,
    pub category: Option<String>,
    pub message: Option<String>,
    pub level: String,
    pub data: Option<serde_json::Value>,
}
```

### 3.2 Frontend

#### `SentryAnalyzerView.tsx` (new component, ~400 lines)

Main tab component with three states:
1. **Not configured** — Shows setup prompt linking to Settings
2. **Browse mode** — Issue list from selected project with search/filter
3. **Analysis mode** — Shows analysis result (reuses AnalysisDetailView)

```
┌─────────────────────────────────────────────┐
│ Sentry Analyzer                             │
├─────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────────────────┐ │
│ │ Quick Import│ │ Project: [dropdown]     │ │
│ │ Issue URL:  │ │ Status: [unresolved ▼]  │ │
│ │ [________]  │ │ Search: [____________]  │ │
│ │ [Analyze]   │ └─────────────────────────┘ │
│ └─────────────┘                             │
│                                             │
│ ┌───────────────────────────────────────────┤
│ │ Issue List                                │
│ ├───────────────────────────────────────────┤
│ │ ⚠ TypeError: Cannot read property 'x'    │
│ │   js • 1,234 events • 89 users • 2h ago  │
│ ├───────────────────────────────────────────┤
│ │ ❌ DatabaseError: deadlock detected       │
│ │   py • 56 events • 12 users • 5h ago     │
│ ├───────────────────────────────────────────┤
│ │ ⚠ N+1 Query: SELECT * FROM orders...     │
│ │   py • 890 events • 45 users • 1d ago    │
│ └───────────────────────────────────────────┘
│                                             │
│ [Analyze Selected]  [Import & Analyze All]  │
└─────────────────────────────────────────────┘
```

#### `SentrySettings.tsx` (new component, ~200 lines)

Added to SettingsPanel.tsx integrations tab (lazy loaded):

```
┌─────────────────────────────────────┐
│ Sentry Integration                  │
├─────────────────────────────────────┤
│ Instance URL:                       │
│ [https://sentry.io________________] │
│                                     │
│ Auth Token:                         │
│ [••••••••••••••••••] 👁             │
│                                     │
│ Organization:                       │
│ [my-org_________________________]   │
│                                     │
│ Default Project:                    │
│ [Select project... ▼]               │
│                                     │
│ [Test Connection]  [Save Settings]  │
│                                     │
│ ✅ Connected: 5 projects found      │
└─────────────────────────────────────┘
```

#### Type Additions (`types/index.ts`)

```typescript
// Add to AnalysisType union
export type AnalysisType = ... | "sentry";

// Sentry-specific types
export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: "error" | "warning" | "info" | "fatal";
  status: "unresolved" | "resolved" | "ignored";
  platform: string;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
}

export interface SentryConfig {
  enabled: boolean;
  baseUrl: string;
  organization: string;
  defaultProject: string;
}
```

### 3.3 AI Prompts

**Sentry-specific system prompt** (stored in Rust, ~500 tokens):

```
You are an expert software debugger analyzing a Sentry error event.
The event includes a stacktrace, breadcrumbs (user actions before the error),
tags, and runtime context.

Analyze this error and return JSON:
{
  "error_type": "The specific error class/type",
  "severity": "critical|high|medium|low",
  "root_cause": "Technical explanation of what triggered this error",
  "suggested_fixes": ["Fix 1", "Fix 2", "Fix 3"],
  "component": "The application component affected",
  "confidence": 0.0-1.0,
  "pattern_type": "deadlock|n_plus_one|memory_leak|unhandled_promise|generic",
  "user_impact": "Description of how this affects end users",
  "breadcrumb_analysis": "What the breadcrumbs reveal about the trigger"
}

Pay attention to:
- In-app frames vs library frames in the stacktrace
- Breadcrumb patterns leading up to the error
- Environment and runtime context clues
- Recurring patterns suggesting systemic issues
```

### 3.4 Pattern Detectors

Lightweight Rust-side pattern detection (before AI analysis):

```rust
pub fn detect_sentry_patterns(event: &SentryEvent) -> Vec<DetectedPattern> {
    let mut patterns = vec![];

    // Deadlock detection
    if event.message_contains("deadlock") || event.has_tag("error_code", "40P01") {
        patterns.push(DetectedPattern::Deadlock);
    }

    // N+1 detection (from spans if available)
    if event.has_repeated_db_spans(threshold: 3) {
        patterns.push(DetectedPattern::NPlusOne);
    }

    // Memory leak detection
    if event.message_contains("OutOfMemory") || event.message_contains("heap") {
        patterns.push(DetectedPattern::MemoryLeak);
    }

    // Unhandled promise
    if event.title_contains("UnhandledRejection") {
        patterns.push(DetectedPattern::UnhandledPromise);
    }

    patterns
}
```

### 3.5 Database

No schema migration needed. Sentry analyses use the existing `analyses` table:

| Field | Sentry Mapping |
|-------|---------------|
| `filename` | Sentry issue short ID (e.g., "PROJ-123") |
| `error_type` | Exception type from stacktrace |
| `error_message` | Event title/message |
| `severity` | Mapped from Sentry level |
| `component` | Culprit file/function |
| `stack_trace` | Formatted stacktrace from frames |
| `analysis_type` | `"sentry"` |
| `full_data` | Full Sentry event JSON + AI analysis |

Optional future migration (Phase 2): `analysis_sentry_links` table for bidirectional linking (similar to `analysis_jira_links`).

---

## 4. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Auth token storage | Tauri encrypted store (same as JIRA/API keys) |
| Token in transit | HTTPS only (Sentry API requires it) |
| Token in logs | Never logged — passed as function parameters |
| PII in stacktraces | Existing PII redaction pipeline applies |
| Sentry data in exports | Existing sensitive content detection applies |
| API rate limits | Sentry returns 429 — respect Retry-After header |

---

## 5. User Experience Flow

### First-time Setup
1. User opens Settings > Integrations
2. Expands "Sentry Integration" section
3. Enters instance URL, auth token, organization
4. Clicks "Test Connection" — sees project list
5. Selects default project
6. Saves — Sentry Analyzer tab appears in navigation

### Typical Usage
1. User clicks "Sentry Analyzer" tab
2. Sees issue list from default project (cached 1 min)
3. Clicks an issue → sees preview with stacktrace summary
4. Clicks "Analyze" → progress bar shows AI analysis phases
5. Results displayed in familiar analysis detail view
6. Can: save as favorite, add tags, export, link to JIRA, add notes

### Quick Import
1. User pastes Sentry issue URL into quick import field
2. Clicks "Analyze" — fetches and analyzes in one step
3. Equivalent to browse → select → analyze

---

## 6. What We Reuse vs Build New

### Reuse (0 effort)
- AI provider pipeline (OpenAI, Claude, Z.ai, Ollama)
- Circuit breaker + failover
- Analysis storage + FTS5 search
- History view + filtering
- Export (Markdown, HTML, JSON)
- JIRA ticket linking
- Favorites, tags, notes, archiving
- PII redaction
- Structured logging
- Progress bar component

### Build New (~1000 lines Rust, ~800 lines TypeScript)
- `sentry_service.rs` — Sentry API client
- `commands/sentry.rs` — Tauri command handlers
- `SentryAnalyzerView.tsx` — Browse + analyze UI
- `SentrySettings.tsx` — Configuration UI
- Sentry-specific AI prompt
- Pattern detectors (deadlock, N+1, memory leak, promise)
- Type definitions

### Adapt (~200 lines of changes)
- `main.rs` — Register new commands
- `App.tsx` — Add Sentry view routing
- `Navigation.tsx` — Add Sentry tab
- `SettingsPanel.tsx` — Add Sentry settings section
- `types/index.ts` — Add Sentry types
- `secure-storage.ts` — Add "sentry" provider key
