# Hadron Web-Desktop Parity Design

**Date:** 2026-03-25
**Status:** In progress — Phases 0-1 designed, Phases 2-7 outlined
**Approach:** Feature-First (Phase 0 infra sprint, then end-to-end per feature)

## Design Decisions (Agreed)

1. **Phasing order:** Code Analyzer > JIRA Deep Analysis > JIRA Assist > Sentry Analysis > Release Notes AI > Performance Analyzer > Export > RAG/OpenSearch
2. **AI API keys:** Server-side shared key (admin configures via admin panel). Per-request user key as fallback.
3. **hadron-core expansion:** New features go into hadron-core as shared logic. Desktop migration to consume hadron-core planned for later.
4. **JIRA poller (Phase 2):** Single global server-side poller. Users subscribe to projects; only see tickets from their subscribed projects.
5. **Architecture:** Feature-First with a small Phase 0 infrastructure sprint.

---

## Phase 0: Infrastructure Sprint

### 0a. Server-side AI API Key Management
- New DB migration: `global_settings` gets seeded keys `ai_api_key_openai` and `ai_api_key_anthropic` (encrypted at rest via `SERVER_ENCRYPTION_KEY` env var)
- Admin panel gets "AI Configuration" section: provider selector, API key input (masked), model selector, test connection button
- `hadron-server` reads key server-side — never reaches frontend
- Existing per-request API key from sessionStorage becomes fallback (if server key not configured, user can still supply their own)

### 0b. AI Service in hadron-core
Move core AI calling logic into `hadron-core`:
- `hadron-core::ai::AiProvider` — enum (OpenAI, Anthropic)
- `hadron-core::ai::complete()` — non-streaming completion
- `hadron-core::ai::stream_completion()` — returns channel of `ChatStreamEvent`
- `hadron-core::ai::prompts` — all system prompts (crash analysis, code analysis, JIRA triage, JIRA deep, sentry analysis)
- `hadron-server` wraps these with Axum route handlers and SSE
- HTTP client (`reqwest`) stays in hadron-server; hadron-core takes a trait/closure for the actual HTTP call (transport-agnostic)

### 0c. SSE Streaming Pattern
- Extend `hadron-server::sse` module with generic `stream_ai_response()` helper
- Frontend gets shared `useAiStream()` React hook: SSE connection, event parsing, reconnection, cleanup

---

## Phase 1a: Code Analyzer

### Backend (hadron-core + hadron-server)

**hadron-core::code_analysis module:**
- `detect_language(content: &str) -> Language` — heuristic language detection (port of desktop's `detectLanguage.ts`)
- `build_code_analysis_prompt(code: &str, language: &Language) -> Vec<AiMessage>` — system+user prompt for 6-tab structured JSON
- `parse_code_analysis_response(raw: &str) -> Result<CodeAnalysisResult>` — parse AI JSON
- Types: `CodeAnalysisResult`, `CodeIssue`, `WalkthroughSection`, `CodeQualityScores`, `GlossaryTerm`

**hadron-server routes:**
- `POST /api/code-analysis` — accepts `{ code, language? }`, uses server-side API key, returns `CodeAnalysisResult`
- `POST /api/code-analysis/stream` — SSE version
- No DB persistence (ephemeral, matches desktop)
- Token budget: reject >512KB input

### Frontend
- New route `/code-analyzer`
- `CodeAnalyzerView.tsx` — orchestrator: code input (paste/file upload), language auto-detect + manual override, analyze button, tab nav
- 6 tabs: `OverviewTab`, `WalkthroughTab`, `IssuesTab`, `OptimizedTab`, `QualityTab`, `LearnTab`
- Shared: `SeverityBadge`, `CategoryBadge`, `QualityGauge` (SVG radial gauge)
- Uses `useAiStream()` hook
- Available to all roles, no feature flag

---

## Phase 1b: JIRA Deep Analysis

### Backend (hadron-core + hadron-server)

**hadron-core::jira_analysis module:**
- `build_deep_analysis_prompt(ticket: &JiraTicketData) -> Vec<AiMessage>` — prompt from ticket summary, description, comments, attachments metadata
- `parse_deep_analysis_response(raw: &str) -> Result<JiraDeepAnalysis>` — structured result: root cause, components, repro steps, severity, actions, risk
- Types: `JiraTicketData`, `JiraDeepAnalysis`, `JiraAnalysisAction`, `JiraRiskAssessment`

**hadron-server routes:**
- Extend `integrations/jira.rs`: `fetch_issue_detail(key) -> JiraTicketData` (full ticket via REST API)
- `POST /api/jira/issues/{key}/analyze` — deep AI analysis, returns `JiraDeepAnalysis`
- `POST /api/jira/issues/{key}/analyze/stream` — SSE streaming version
- `GET /api/jira/projects/{key}/issues` — paginated issue list (new)
- `GET /api/jira/issues/{key}` — fetch single issue detail (new)
- Optionally persist to `analyses` table with `source_type: "jira"`

### Frontend
- `JiraIssueBrowser.tsx` — project selector, paginated issue list
- `JiraIssueDetail.tsx` — ticket fields + "Deep Analyze" button
- `JiraAnalysisReport.tsx` — renders analysis (root cause, actions, risk)
- "Save to History" button on analysis results
- JIRA config: lead+ to set up, all users can browse/analyze

---

## Phase 2: JIRA Assist (Outlined)

### Triage Engine
- `hadron-core::jira_triage` — AI triage: severity/category/tags/customer_impact
- `POST /api/jira/issues/{key}/triage` route
- `TriageBadgePanel.tsx` frontend component

### Investigation Briefs
- `hadron-core::jira_brief` — triage + deep analysis in parallel (like desktop's `tokio::try_join!`)
- `POST /api/jira/issues/{key}/brief` route
- `TicketBriefPanel.tsx` — tabbed Brief/Analysis, QualityGauge, checkboxes

### Duplicate Detection (Embeddings)
- DB migration: `ticket_embeddings` table (pgvector, 1536 dims)
- `POST /api/jira/issues/{key}/similar` — cosine similarity search
- "Similar Tickets" section in brief panel

### Background Poller
- Single global poller: `tokio::spawn` background task in hadron-server
- Polls all configured JIRA projects on interval
- Auto-triages new tickets
- DB migration: `jira_poller_config` (JQL, interval, enabled) + `user_project_subscriptions` (user_id, project_key)
- `GET /api/jira/feed` — returns triaged tickets filtered by user's subscribed projects
- SSE push notifications for new triaged tickets

### JIRA Round-Trip
- `POST /api/jira/issues/{key}/post-brief` — format + post as JIRA comment
- `POST /api/jira/issues/{key}/feedback` — engineer star rating + notes

### Project Feed
- `JiraProjectFeed.tsx` — severity pills, triage badges, "Triage All" bulk action
- Client-side filters: "Triaged only" checkbox, severity dropdown

---

## Phase 3: Sentry Deep Analysis (Outlined)
- `hadron-core::sentry_analysis` — AI analysis of Sentry issue+event data
- Port desktop's pattern detection (breadcrumb timeline, exception chain, runtime context, user impact)
- `POST /api/sentry/issues/{id}/analyze` route
- `SentryAnalysisReport.tsx` with sub-components matching desktop

---

## Phase 4: Release Notes AI Pipeline (Outlined)
- `hadron-core::release_notes` — 3-stage pipeline: extract (JIRA fix versions) -> transform (AI + style guide) -> deliver
- Port embedded style guide from desktop
- Compliance checking, review workflow, versioning
- Extend existing CRUD routes with AI generation endpoints

---

## Phase 5: Performance Analyzer (Outlined)
- `hadron-core::performance` — VisualWorks trace file parser + AI scenario reconstruction
- `POST /api/performance/analyze` route
- `PerformanceAnalyzerView.tsx` frontend

---

## Phase 6: Export Improvements (Outlined)
- `hadron-core::export` — generic report generators (XLSX, interactive HTML, TXT)
- Port `GenericReportData`/`GenericSection` from desktop
- `POST /api/export/generic` route
- Extend `ExportDialog.tsx` with new formats + section toggles

---

## Phase 7: RAG/OpenSearch Hybrid (Outlined)
- `hadron-core::retrieval` — hybrid vector+BM25 search, RRF merging, query planner, evidence gate
- Extend existing OpenSearch integration with vector search paths
- Upgrade chat tools to use hybrid retrieval

---

## Parity Matrix

| Feature | Desktop | Web Current | Web Target | Phase |
|---------|---------|-------------|------------|-------|
| Code Analyzer | Full | None | Full | 1a |
| JIRA Deep Analysis | Full | None | Full | 1b |
| JIRA Assist | Full (7 sprints) | None | Full | 2 |
| Sentry Analysis | Full | Browse only | Full | 3 |
| Release Notes AI | Full pipeline | CRUD only | Full | 4 |
| Performance Analyzer | Full | None | Full | 5 |
| Export (XLSX, iHTML) | 6 formats | 3 formats | 6 formats | 6 |
| RAG Hybrid Search | Full | Text only | Full | 7 |
