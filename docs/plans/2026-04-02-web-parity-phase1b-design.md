# Web-Desktop Parity — Phase 1b: JIRA Deep Analysis

**Date:** 2026-04-02
**Status:** Approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`
**Depends on:** Phase 0 (complete)

Port the desktop's JIRA Deep Analysis feature to hadron-web — fetch a JIRA ticket and run AI-powered structured analysis.

---

## Backend

### hadron-core: `ai/jira_analysis.rs`

New module with types matching the desktop (`jira_deep_analysis.rs`):

```rust
pub struct JiraDeepResult {
    pub plain_summary: String,
    pub quality: TicketQuality,
    pub technical: TechnicalAnalysis,
    pub open_questions: Vec<String>,
    pub recommended_actions: Vec<RecommendedAction>,
    pub risk: RiskAssessment,
}

pub struct TicketQuality {
    pub score: u8,
    pub verdict: String,
    pub strengths: Vec<String>,
    pub gaps: Vec<String>,
}

pub struct TechnicalAnalysis {
    pub root_cause: String,
    pub affected_areas: Vec<String>,
    pub error_type: String,
    pub severity_estimate: String,
    pub confidence: String,
    pub confidence_rationale: String,
}

pub struct RecommendedAction {
    pub priority: String,
    pub action: String,
    pub rationale: String,
}

pub struct RiskAssessment {
    pub user_impact: String,
    pub blast_radius: String,
    pub urgency: String,
    pub do_nothing_risk: String,
}
```

All fields use `#[serde(default)]` and `#[serde(rename_all = "snake_case")]` (the desktop prompt uses snake_case JSON keys).

Additional items in this module:
- `JiraTicketDetail` — struct holding ticket data needed for the prompt (key, summary, description, issue_type, priority, status, components, labels, comments)
- `JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT` — the desktop's full system prompt (copy from `jira_deep_analysis.rs`)
- `build_jira_deep_user_prompt(ticket: &JiraTicketDetail) -> String` — builds the user prompt from ticket fields (port of `build_user_prompt`)
- `build_jira_deep_messages(ticket: &JiraTicketDetail) -> (Option<String>, Vec<AiMessage>)` — returns (system_prompt, messages) for the AI call
- `parse_jira_deep_analysis(raw: &str) -> Result<JiraDeepResult>` — JSON parser using `strip_markdown_fences`

### hadron-server: `integrations/jira.rs` extension

Add `fetch_issue_detail()`:
- `pub async fn fetch_issue_detail(config: &JiraConfig, key: &str) -> HadronResult<JiraTicketDetail>`
- Calls JIRA REST API v3: `GET /rest/api/3/issue/{key}?fields=summary,description,status,priority,issuetype,components,labels,comment&expand=renderedFields`
- Extracts: key, summary, description (rendered text or ADF-to-text), issue type, priority, status, component names, label names, comment bodies
- Returns `JiraTicketDetail` for prompt building

### hadron-server: `routes/jira_analysis.rs`

New route file with three endpoints:

**`GET /api/jira/issues/{key}`**
- Request: JIRA credentials in query params or headers (baseUrl, email, apiToken)
- Calls `fetch_issue_detail()`
- Returns `JiraTicketDetail` as JSON (for ticket preview)

**`POST /api/jira/issues/{key}/analyze`**
- Request body: `{ credentials: { baseUrl, email, apiToken }, apiKey?: string }`
- Fetches ticket detail, resolves AI config, builds prompt, calls `ai::complete()`, parses response
- Returns `JiraDeepResult`

**`POST /api/jira/issues/{key}/analyze/stream`**
- Same request, SSE streaming via `sse::stream_ai_completion()`
- Frontend parses JSON on stream completion

No DB persistence — ephemeral analysis (matches Code Analyzer pattern).

---

## Frontend

### Types (in `api.ts`)

```typescript
interface JiraTicketDetail {
  key: string;
  summary: string;
  description: string;
  issueType: string;
  priority: string | null;
  status: string;
  components: string[];
  labels: string[];
  comments: string[];
  url: string;
}

interface JiraDeepResult {
  plain_summary: string;
  quality: {
    score: number;
    verdict: string;
    strengths: string[];
    gaps: string[];
  };
  technical: {
    root_cause: string;
    affected_areas: string[];
    error_type: string;
    severity_estimate: string;
    confidence: string;
    confidence_rationale: string;
  };
  open_questions: string[];
  recommended_actions: {
    priority: string;
    action: string;
    rationale: string;
  }[];
  risk: {
    user_impact: string;
    blast_radius: string;
    urgency: string;
    do_nothing_risk: string;
  };
}
```

### Components

**`JiraAnalyzerView.tsx`** — orchestrator:

State flow:
1. Credentials section: baseUrl, email, apiToken inputs (persisted to localStorage)
2. Ticket key input (or paste URL — auto-extract key with regex)
3. "Fetch" button → `GET /api/jira/issues/{key}` → ticket preview card (summary, status, priority, type, components, labels)
4. "Deep Analyze" button → `useAiStream` streams from `POST /api/jira/issues/{key}/analyze/stream` → loading spinner + raw text → parse JSON on completion → render `JiraAnalysisReport`
5. Clear/reset functionality

**`JiraAnalysisReport.tsx`** — report display (port from desktop):

Props: `{ result: JiraDeepResult; jiraKey: string; category?: string }`

Sections (all collapsible, start expanded):
1. **Plain Language Summary** — paragraph
2. **Ticket Quality** — QualityGauge (reuse from code-analyzer/shared) + verdict badge + strengths/gaps lists
3. **Technical Analysis** — labeled fields: root cause, error type, affected areas, severity estimate, confidence + rationale. Labels adapt: bug-like shows "Root Cause"/"Error Type", feature-like shows "Analysis"/"Feature Type"
4. **Open Questions** — numbered list (hidden if empty)
5. **Recommended Actions** — cards with priority badges (Immediate=red, Short-term=amber, Long-term=blue), checkbox for tracking, action text, rationale
6. **Risk & Impact** — 4 labeled fields: user impact, blast radius, urgency, do-nothing risk

### Navigation

Add `"jira-analyzer"` to View type in App.tsx + nav item after "Code Analyzer".

---

## API Endpoints Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/jira/issues/{key}` | Any role | Fetch ticket detail from JIRA |
| POST | `/api/jira/issues/{key}/analyze` | Any role | Non-streaming deep analysis |
| POST | `/api/jira/issues/{key}/analyze/stream` | Any role | SSE streaming deep analysis |

---

## File Summary

### New files

| File | Purpose |
|------|---------|
| `crates/hadron-core/src/ai/jira_analysis.rs` | Types, prompt, parser for JIRA deep analysis |
| `crates/hadron-server/src/routes/jira_analysis.rs` | JIRA analysis route handlers |
| `frontend/src/components/jira/JiraAnalyzerView.tsx` | Orchestrator: creds, fetch, analyze |
| `frontend/src/components/jira/JiraAnalysisReport.tsx` | Structured report display |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-core/src/ai/mod.rs` | Add `pub mod jira_analysis` |
| `crates/hadron-server/src/integrations/jira.rs` | Add `fetch_issue_detail()` |
| `crates/hadron-server/src/routes/mod.rs` | Add `mod jira_analysis` + routes |
| `frontend/src/services/api.ts` | Add `JiraTicketDetail`, `JiraDeepResult` types + API methods |
| `frontend/src/App.tsx` | Add `jira-analyzer` to View type, nav, render |
