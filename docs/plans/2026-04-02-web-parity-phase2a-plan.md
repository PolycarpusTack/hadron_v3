# Phase 2a: JIRA Assist (Triage + Brief + Feed) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JIRA triage classification, investigation briefs (triage + deep in parallel), DB persistence, and a project feed for browsing triaged tickets.

**Architecture:** Add triage types/prompt to hadron-core. Create `ticket_briefs` DB table. Extend hadron-server with triage + brief routes (parallel AI calls via `tokio::try_join!`). Build 3 new frontend components (TriageBadgePanel, TicketBriefPanel, JiraProjectFeed), extend JiraAnalyzerView with triage/brief buttons.

**Tech Stack:** Rust (hadron-core, hadron-server Axum, tokio, sqlx), React 18 + TypeScript + Tailwind CSS, PostgreSQL

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `crates/hadron-core/src/ai/jira_triage.rs` | Triage types, system prompt, parser |
| `crates/hadron-core/src/ai/jira_brief.rs` | JiraBriefResult type |
| `migrations/014_ticket_briefs.sql` | ticket_briefs table |
| `frontend/src/components/jira/TriageBadgePanel.tsx` | Compact triage display |
| `frontend/src/components/jira/TicketBriefPanel.tsx` | Tabbed brief + analysis |
| `frontend/src/components/jira/JiraProjectFeed.tsx` | Project feed with batch triage |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-core/src/ai/mod.rs` | Add triage + brief modules |
| `crates/hadron-server/src/db/mod.rs` | Add ticket_briefs CRUD |
| `crates/hadron-server/src/routes/jira_analysis.rs` | Add triage, brief, briefs CRUD routes |
| `crates/hadron-server/src/routes/mod.rs` | Register new routes |
| `frontend/src/services/api.ts` | Add triage/brief types + API methods |
| `frontend/src/components/jira/JiraAnalyzerView.tsx` | Add Triage + Brief buttons |
| `frontend/src/App.tsx` | Add jira-feed view |

---

## Task 1: hadron-core Triage Types, Prompt, and Parser

**Files:**
- Create: `hadron-web/crates/hadron-core/src/ai/jira_triage.rs`
- Modify: `hadron-web/crates/hadron-core/src/ai/mod.rs`

- [ ] **Step 1: Create `jira_triage.rs`**

Create `hadron-web/crates/hadron-core/src/ai/jira_triage.rs`:

```rust
//! JIRA triage engine — AI severity/category classification.
//!
//! Port of desktop's `jira_triage.rs`.

use crate::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

use super::types::AiMessage;
use super::jira_analysis::JiraTicketDetail;

// ============================================================================
// Output
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JiraTriageResult {
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub customer_impact: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub rationale: String,
}

// ============================================================================
// Prompt
// ============================================================================

pub const JIRA_TRIAGE_SYSTEM_PROMPT: &str = r#"You are a senior support engineer triaging JIRA tickets for a software product.
Your job is to classify each ticket quickly and accurately so the team can prioritize work.

OUTPUT FORMAT: Respond ONLY with valid JSON. No markdown, no prose outside JSON.

{
  "severity": "Critical|High|Medium|Low",
  "category": "Bug|Feature|Infrastructure|UX|Performance|Security",
  "customer_impact": "Plain-language description of who is affected and how severely (1-2 sentences max).",
  "tags": ["tag1", "tag2"],
  "confidence": "High|Medium|Low",
  "rationale": "1-3 sentences explaining why you chose this severity and category."
}

SEVERITY GUIDE:
- Critical: Production down, data loss, security breach, blocking all users; or a feature request that is blocking a major release or contract
- High: Major feature broken, significant user population affected, no workaround; or a high-value feature request with strong business justification
- Medium: Feature degraded, workaround exists, affects a subset of users; or a feature/info request with moderate impact
- Low: Cosmetic, edge case, minor inconvenience, nice-to-have enhancement, routine information request

CATEGORY GUIDE:
- Bug: Unintended behavior, crash, regression
- Feature: New functionality or enhancement request
- Infrastructure: Deployment, config, CI/CD, environment
- UX: Usability, accessibility, layout, wording
- Performance: Slow response, high resource usage, timeout
- Security: Auth, permissions, data exposure, injection

TAGS: 2-5 short lowercase single-word or hyphenated labels describing the affected area (e.g. "login", "api", "export", "dark-mode"). Do not repeat severity or category as tags.

Be direct. If the ticket is vague, lower your confidence and explain why."#;

/// Build user prompt from ticket detail with truncation.
pub fn build_jira_triage_user_prompt(ticket: &JiraTicketDetail) -> String {
    let mut parts = vec![
        format!("TICKET: {}", ticket.key),
        format!("TYPE: {}", ticket.issue_type),
        format!("PRIORITY (reporter-set): {}", ticket.priority.as_deref().unwrap_or("not set")),
        format!("STATUS: {}", ticket.status),
        format!("TITLE: {}", ticket.summary),
    ];

    if !ticket.components.is_empty() {
        parts.push(format!("COMPONENTS: {}", ticket.components.join(", ")));
    }
    if !ticket.labels.is_empty() {
        parts.push(format!("LABELS: {}", ticket.labels.join(", ")));
    }

    if ticket.description.is_empty() {
        parts.push("\nDESCRIPTION: (empty)".to_string());
    } else {
        let desc = truncate_chars(&ticket.description, 2000);
        let suffix = if ticket.description.len() > 2000 { "... (truncated)" } else { "" };
        parts.push(format!("\nDESCRIPTION:\n{}{}", desc, suffix));
    }

    if !ticket.comments.is_empty() {
        let recent: Vec<String> = ticket.comments.iter().rev().take(5).enumerate()
            .map(|(i, c)| {
                let body = truncate_chars(c, 500);
                let suffix = if c.len() > 500 { "..." } else { "" };
                format!("[Comment {}] {}{}", i + 1, body, suffix)
            })
            .collect();
        parts.push(format!("\nRECENT COMMENTS:\n{}", recent.join("\n")));
    }

    parts.join("\n")
}

fn truncate_chars(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((byte_pos, _)) => &s[..byte_pos],
        None => s,
    }
}

/// Build system prompt + messages for triage AI call.
pub fn build_jira_triage_messages(ticket: &JiraTicketDetail) -> (String, Vec<AiMessage>) {
    let system = JIRA_TRIAGE_SYSTEM_PROMPT.to_string();
    let messages = vec![AiMessage {
        role: "user".to_string(),
        content: build_jira_triage_user_prompt(ticket),
    }];
    (system, messages)
}

/// Parse AI response into JiraTriageResult.
pub fn parse_jira_triage(raw: &str) -> HadronResult<JiraTriageResult> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let preview = truncate_chars(raw, 400);
        HadronError::Parse(format!(
            "Failed to parse triage JSON: {e}. Preview: {preview}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_triage_prompt() {
        let ticket = JiraTicketDetail {
            key: "PROJ-42".to_string(),
            summary: "Login broken".to_string(),
            description: "Users can't log in".to_string(),
            issue_type: "Bug".to_string(),
            priority: Some("High".to_string()),
            status: "Open".to_string(),
            components: vec!["Auth".to_string()],
            ..Default::default()
        };
        let prompt = build_jira_triage_user_prompt(&ticket);
        assert!(prompt.contains("TICKET: PROJ-42"));
        assert!(prompt.contains("TITLE: Login broken"));
        assert!(prompt.contains("COMPONENTS: Auth"));
    }

    #[test]
    fn test_build_triage_prompt_truncation() {
        let long_desc = "a".repeat(3000);
        let ticket = JiraTicketDetail {
            key: "X-1".to_string(),
            description: long_desc,
            ..Default::default()
        };
        let prompt = build_jira_triage_user_prompt(&ticket);
        assert!(prompt.contains("(truncated)"));
    }

    #[test]
    fn test_parse_triage_result() {
        let input = r#"{"severity":"High","category":"Bug","customer_impact":"All users blocked","tags":["auth","login"],"confidence":"High","rationale":"Clear regression"}"#;
        let result = parse_jira_triage(input).unwrap();
        assert_eq!(result.severity, "High");
        assert_eq!(result.category, "Bug");
        assert_eq!(result.tags.len(), 2);
    }

    #[test]
    fn test_parse_triage_defaults() {
        let input = r#"{"severity":"Low"}"#;
        let result = parse_jira_triage(input).unwrap();
        assert_eq!(result.severity, "Low");
        assert_eq!(result.category, "");
        assert!(result.tags.is_empty());
    }
}
```

- [ ] **Step 2: Create `jira_brief.rs`**

Create `hadron-web/crates/hadron-core/src/ai/jira_brief.rs`:

```rust
//! JIRA investigation brief — combines triage + deep analysis.

use serde::{Deserialize, Serialize};

use super::jira_analysis::JiraDeepResult;
use super::jira_triage::JiraTriageResult;

/// Combined result of triage + deep analysis run in parallel.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JiraBriefResult {
    pub triage: JiraTriageResult,
    pub analysis: JiraDeepResult,
}
```

- [ ] **Step 3: Register in `ai/mod.rs`**

Add to `hadron-web/crates/hadron-core/src/ai/mod.rs`:

```rust
pub mod jira_triage;
pub mod jira_brief;
```

And add re-exports:

```rust
pub use jira_triage::*;
pub use jira_brief::*;
```

- [ ] **Step 4: Run tests**

Run: `cd hadron-web && cargo test -p hadron-core ai::jira_triage 2>&1 | tail -10`
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/
git commit -m "feat(web): add JIRA triage types/prompt and brief result type to hadron-core"
```

---

## Task 2: Database Migration — ticket_briefs Table

**Files:**
- Create: `hadron-web/migrations/014_ticket_briefs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 014_ticket_briefs.sql
-- Stores triage and investigation brief results for JIRA tickets.

CREATE TABLE ticket_briefs (
    jira_key        TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '',
    severity        TEXT,
    category        TEXT,
    tags            TEXT,
    triage_json     TEXT,
    brief_json      TEXT,
    posted_to_jira  BOOLEAN NOT NULL DEFAULT FALSE,
    posted_at       TIMESTAMPTZ,
    engineer_rating SMALLINT,
    engineer_notes  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_briefs_severity ON ticket_briefs(severity);
```

- [ ] **Step 2: Commit**

```bash
git add hadron-web/migrations/014_ticket_briefs.sql
git commit -m "feat(web): add migration 014 — ticket_briefs table"
```

---

## Task 3: Database Functions for ticket_briefs

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`

- [ ] **Step 1: Add ticket_briefs types and CRUD**

Read `hadron-web/crates/hadron-server/src/db/mod.rs`. Then append these functions at the end (before any `#[cfg(test)]` block):

```rust
// ============================================================================
// Ticket Briefs
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketBriefRow {
    pub jira_key: String,
    pub title: String,
    pub severity: Option<String>,
    pub category: Option<String>,
    pub tags: Option<String>,
    pub triage_json: Option<String>,
    pub brief_json: Option<String>,
    pub posted_to_jira: bool,
    pub posted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub engineer_rating: Option<i16>,
    pub engineer_notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

pub async fn upsert_ticket_brief(
    pool: &PgPool,
    jira_key: &str,
    title: &str,
    severity: Option<&str>,
    category: Option<&str>,
    tags: Option<&str>,
    triage_json: Option<&str>,
    brief_json: Option<&str>,
) -> HadronResult<()> {
    sqlx::query(
        "INSERT INTO ticket_briefs (jira_key, title, severity, category, tags, triage_json, brief_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (jira_key) DO UPDATE SET
            title = EXCLUDED.title,
            severity = COALESCE(EXCLUDED.severity, ticket_briefs.severity),
            category = COALESCE(EXCLUDED.category, ticket_briefs.category),
            tags = COALESCE(EXCLUDED.tags, ticket_briefs.tags),
            triage_json = COALESCE(EXCLUDED.triage_json, ticket_briefs.triage_json),
            brief_json = COALESCE(EXCLUDED.brief_json, ticket_briefs.brief_json),
            updated_at = NOW()",
    )
    .bind(jira_key)
    .bind(title)
    .bind(severity)
    .bind(category)
    .bind(tags)
    .bind(triage_json)
    .bind(brief_json)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

pub async fn get_ticket_brief(
    pool: &PgPool,
    jira_key: &str,
) -> HadronResult<Option<TicketBriefRow>> {
    let row = sqlx::query_as!(
        TicketBriefRow,
        "SELECT jira_key, title, severity, category, tags, triage_json, brief_json,
                posted_to_jira, posted_at, engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs WHERE jira_key = $1",
        jira_key
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row)
}

pub async fn get_ticket_briefs_batch(
    pool: &PgPool,
    jira_keys: &[String],
) -> HadronResult<Vec<TicketBriefRow>> {
    if jira_keys.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query_as!(
        TicketBriefRow,
        "SELECT jira_key, title, severity, category, tags, triage_json, brief_json,
                posted_to_jira, posted_at, engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs WHERE jira_key = ANY($1)",
        jira_keys
    )
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows)
}

pub async fn delete_ticket_brief(pool: &PgPool, jira_key: &str) -> HadronResult<()> {
    sqlx::query("DELETE FROM ticket_briefs WHERE jira_key = $1")
        .bind(jira_key)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}
```

**Important:** These use `query_as!` macros which need compile-time DB checking. If `SQLX_OFFLINE=true` doesn't work, the implementer should fall back to `query_as::<_, TicketBriefRow>(...)` with manual column binding instead. Read how other queries in the file handle this — some use `query_as!` and others use runtime `query_as`.

- [ ] **Step 2: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

If `query_as!` fails (no offline metadata), switch to runtime `sqlx::query_as()` with a manual `FromRow` derive on `TicketBriefRow`:
```rust
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
```
and use `sqlx::query_as::<_, TicketBriefRow>("SELECT ...")`.

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-server/src/db/mod.rs
git commit -m "feat(web): add ticket_briefs DB CRUD functions"
```

---

## Task 4: Triage and Brief Routes

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/jira_analysis.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add triage and brief handlers to `jira_analysis.rs`**

Read the current file. Then append these handlers:

```rust
// ============================================================================
// Triage
// ============================================================================

/// POST /api/jira/issues/{key}/triage — fast triage classification.
pub async fn triage_issue(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = to_jira_config(&req.credentials);
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        None,
        None,
    )
    .await?;

    let (system_prompt, messages) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let raw_response = ai::complete(&ai_config, messages, Some(&system_prompt)).await?;
    let result = hadron_core::ai::parse_jira_triage(&raw_response)?;

    // Persist triage to DB
    let tags_json = serde_json::to_string(&result.tags).unwrap_or_default();
    let triage_json = serde_json::to_string(&result).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&result.severity),
        Some(&result.category),
        Some(&tags_json),
        Some(&triage_json),
        None, // brief_json stays as-is
    )
    .await;

    Ok(Json(result))
}

// ============================================================================
// Brief (triage + deep in parallel)
// ============================================================================

/// POST /api/jira/issues/{key}/brief — full investigation brief.
pub async fn generate_brief(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = to_jira_config(&req.credentials);
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        None,
        None,
    )
    .await?;

    // Run triage + deep analysis in parallel
    let (triage_sys, triage_msgs) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let (deep_sys, deep_msgs) = hadron_core::ai::build_jira_deep_messages(&ticket);

    let ai_config2 = ai_config.clone();
    let triage_fut = async {
        let raw = ai::complete(&ai_config, triage_msgs, Some(&triage_sys)).await?;
        hadron_core::ai::parse_jira_triage(&raw)
    };
    let deep_fut = async {
        let raw = ai::complete(&ai_config2, deep_msgs, Some(&deep_sys)).await?;
        hadron_core::ai::parse_jira_deep_analysis(&raw)
    };

    let (triage, analysis) = tokio::try_join!(triage_fut, deep_fut)
        .map_err(|e| AppError(e))?;

    let brief_result = hadron_core::ai::JiraBriefResult {
        triage: triage.clone(),
        analysis,
    };

    // Persist to DB
    let tags_json = serde_json::to_string(&triage.tags).unwrap_or_default();
    let triage_json = serde_json::to_string(&triage).unwrap_or_default();
    let brief_json = serde_json::to_string(&brief_result).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&triage.severity),
        Some(&triage.category),
        Some(&tags_json),
        Some(&triage_json),
        Some(&brief_json),
    )
    .await;

    Ok(Json(brief_result))
}

/// POST /api/jira/issues/{key}/brief/stream — stream deep analysis, triage runs first.
pub async fn generate_brief_stream(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = to_jira_config(&req.credentials);
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        None,
        None,
    )
    .await?;

    // Run triage first (fast, ~2-3s)
    let (triage_sys, triage_msgs) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let triage_raw = ai::complete(&ai_config.clone(), triage_msgs, Some(&triage_sys)).await?;
    let triage = hadron_core::ai::parse_jira_triage(&triage_raw)?;

    // Persist triage immediately
    let tags_json = serde_json::to_string(&triage.tags).unwrap_or_default();
    let triage_json_str = serde_json::to_string(&triage).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&triage.severity),
        Some(&triage.category),
        Some(&tags_json),
        Some(&triage_json_str),
        None,
    )
    .await;

    // Stream deep analysis
    let (deep_sys, deep_msgs) = hadron_core::ai::build_jira_deep_messages(&ticket);
    Ok(sse::stream_ai_completion(ai_config, deep_msgs, Some(deep_sys)))
}

// ============================================================================
// Briefs CRUD (persisted data)
// ============================================================================

/// GET /api/jira/briefs/{key} — load persisted brief.
pub async fn get_brief(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let brief = crate::db::get_ticket_brief(&state.db, &key).await?;
    match brief {
        Some(b) => Ok(Json(serde_json::json!(b))),
        None => Err(AppError(hadron_core::error::HadronError::not_found(
            format!("No brief found for {key}"),
        ))),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchBriefsRequest {
    pub jira_keys: Vec<String>,
}

/// POST /api/jira/briefs/batch — load multiple briefs.
pub async fn get_briefs_batch(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<BatchBriefsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let briefs = crate::db::get_ticket_briefs_batch(&state.db, &req.jira_keys).await?;
    Ok(Json(briefs))
}

/// DELETE /api/jira/briefs/{key} — delete a brief.
pub async fn delete_brief(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    crate::db::delete_ticket_brief(&state.db, &key).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Register routes in `mod.rs`**

In `hadron-web/crates/hadron-server/src/routes/mod.rs`, add after the existing JIRA analysis routes:

```rust
        // JIRA Triage & Brief
        .route("/jira/issues/{key}/triage", post(jira_analysis::triage_issue))
        .route("/jira/issues/{key}/brief", post(jira_analysis::generate_brief))
        .route("/jira/issues/{key}/brief/stream", post(jira_analysis::generate_brief_stream))
        // JIRA Briefs CRUD
        .route("/jira/briefs/{key}", get(jira_analysis::get_brief))
        .route("/jira/briefs/{key}", delete(jira_analysis::delete_brief))
        .route("/jira/briefs/batch", post(jira_analysis::get_briefs_batch))
```

Note: The `delete` import may be needed — check if it's already imported in `mod.rs`. If not, add it to the `use axum::routing::{delete, get, post, put};` line.

- [ ] **Step 3: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/jira_analysis.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(web): add JIRA triage, brief (parallel), and briefs CRUD routes"
```

---

## Task 5: Frontend Types and API Methods

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`

- [ ] **Step 1: Add types**

In `hadron-web/frontend/src/services/api.ts`, add after the `JiraCredentials` interface:

```typescript
// ============================================================================
// JIRA Triage & Brief Types
// ============================================================================

export interface JiraTriageResult {
  severity: string;
  category: string;
  customer_impact: string;
  tags: string[];
  confidence: string;
  rationale: string;
}

export interface JiraBriefResult {
  triage: JiraTriageResult;
  analysis: JiraDeepResult;
}

export interface TicketBriefRow {
  jiraKey: string;
  title: string;
  severity: string | null;
  category: string | null;
  tags: string | null;
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

- [ ] **Step 2: Add API methods**

Add to the `ApiClient` class after the existing JIRA methods:

```typescript
  // === JIRA Triage & Brief ===

  async triageJiraIssue(
    key: string,
    credentials: JiraCredentials,
  ): Promise<JiraTriageResult> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/triage`, {
      credentials,
    });
  }

  async generateJiraBrief(
    key: string,
    credentials: JiraCredentials,
  ): Promise<JiraBriefResult> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/brief`, {
      credentials,
    });
  }

  async getTicketBrief(key: string): Promise<TicketBriefRow | null> {
    try {
      return await this.request("GET", `/jira/briefs/${encodeURIComponent(key)}`);
    } catch (e) {
      if (e instanceof HadronApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async getTicketBriefsBatch(keys: string[]): Promise<TicketBriefRow[]> {
    if (keys.length === 0) return [];
    return this.request("POST", "/jira/briefs/batch", { jiraKeys: keys });
  }

  async deleteTicketBrief(key: string): Promise<void> {
    return this.request("DELETE", `/jira/briefs/${encodeURIComponent(key)}`);
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts
git commit -m "feat(web): add JIRA triage/brief types and API methods"
```

---

## Task 6: TriageBadgePanel Component

**Files:**
- Create: `hadron-web/frontend/src/components/jira/TriageBadgePanel.tsx`

- [ ] **Step 1: Create the component**

Port from desktop's `TriageBadgePanel.tsx`. Props: `{ result: JiraTriageResult }`.

Compact display:
- Row: severity badge (colored), category badge (colored), confidence badge, tags as small pills
- Expandable detail (click to toggle): customer impact text, rationale

Color maps:
- Severity: Critical = `bg-red-500/20 text-red-400`, High = `bg-orange-500/20 text-orange-400`, Medium = `bg-yellow-500/20 text-yellow-400`, Low = `bg-green-500/20 text-green-400`
- Category: Bug = `bg-red-500/20 text-red-400`, Feature = `bg-blue-500/20 text-blue-400`, Infrastructure = `bg-slate-500/20 text-slate-400`, UX = `bg-pink-500/20 text-pink-400`, Performance = `bg-orange-500/20 text-orange-400`, Security = `bg-purple-500/20 text-purple-400`
- Confidence: High = `text-green-400`, Medium = `text-yellow-400`, Low = `text-red-400`

Read the desktop version at `hadron-desktop/src/components/jira/TriageBadgePanel.tsx` for the exact layout, then build the web version with Tailwind dark theme.

- [ ] **Step 2: Verify TypeScript compiles**

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/jira/TriageBadgePanel.tsx
git commit -m "feat(web): add TriageBadgePanel with severity/category/tags badges"
```

---

## Task 7: TicketBriefPanel Component

**Files:**
- Create: `hadron-web/frontend/src/components/jira/TicketBriefPanel.tsx`

- [ ] **Step 1: Create the component**

Props: `{ jiraKey: string; result: JiraBriefResult }`

Two tabs ("Brief" and "Analysis"):

**Brief tab:**
- Triage summary line (severity + category + tags using TriageBadgePanel)
- Plain summary (`result.analysis.plain_summary`)
- Customer impact (`result.triage.customer_impact`)
- Technical Analysis section: root cause, error type, affected areas (pills), severity estimate, confidence + rationale
- Recommended Actions: cards with priority badges (Immediate=red, Short-term=amber, Long-term=blue), checkboxes (local state), action + rationale
- Risk & Impact: user impact, blast radius, urgency, do-nothing risk
- Triage Rationale (`result.triage.rationale`)

**Analysis tab:**
- Quality gauge (reuse from `../code-analyzer/shared/QualityGauge`) with score + verdict
- Strengths (green) / Gaps (red) lists
- Open Questions list

Read the desktop's `TicketBriefPanel.tsx` for exact layout and behavior. Port with Tailwind dark theme. All sections collapsible.

- [ ] **Step 2: Verify TypeScript compiles**

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/jira/TicketBriefPanel.tsx
git commit -m "feat(web): add TicketBriefPanel with tabbed brief and analysis display"
```

---

## Task 8: Extend JiraAnalyzerView with Triage + Brief

**Files:**
- Modify: `hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx`

- [ ] **Step 1: Read the current file and add triage/brief functionality**

Read `hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx`. Add:

1. **New imports:**
```typescript
import { api, JiraTriageResult, JiraBriefResult, TicketBriefRow } from "../../services/api";
import { TriageBadgePanel } from "./TriageBadgePanel";
import { TicketBriefPanel } from "./TicketBriefPanel";
```

2. **New state:**
```typescript
const [triageResult, setTriageResult] = useState<JiraTriageResult | null>(null);
const [triaging, setTriaging] = useState(false);
const [briefResult, setBriefResult] = useState<JiraBriefResult | null>(null);
const [cachedBrief, setCachedBrief] = useState<TicketBriefRow | null>(null);
```

3. **Load cached brief on ticket fetch:** After `setTicket(detail)` succeeds, also call:
```typescript
const cached = await api.getTicketBrief(key);
setCachedBrief(cached);
if (cached?.triageJson) {
  try { setTriageResult(JSON.parse(cached.triageJson)); } catch {}
}
if (cached?.briefJson) {
  try { setBriefResult(JSON.parse(cached.briefJson)); } catch {}
}
```

4. **"Triage" button handler:**
```typescript
const handleTriage = async () => {
  if (!ticket) return;
  setTriaging(true);
  try {
    const creds = { baseUrl, email, apiToken };
    const result = await api.triageJiraIssue(ticket.key, creds);
    setTriageResult(result);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Triage failed");
  } finally {
    setTriaging(false);
  }
};
```

5. **"Generate Brief" button:** Uses `useAiStream` to stream from `/jira/issues/{key}/brief/stream`. On stream completion, parse JSON as `JiraDeepResult` (the stream only returns the deep analysis part — triage was persisted server-side). Then call `getTicketBrief()` to reload the full cached brief with triage.

6. **Button layout** (in ticket preview card): Three buttons in a row:
   - "Triage" (amber, calls handleTriage)
   - "Generate Brief" (indigo, starts streaming)
   - "Deep Analyze" (purple, existing)

7. **Result display** (below ticket card):
   - If `triageResult` and no `briefResult`: show `<TriageBadgePanel result={triageResult} />`
   - If `briefResult`: show `<TicketBriefPanel jiraKey={ticket.key} result={briefResult} />`
   - If streaming deep analysis (from existing Phase 1b): show `<JiraAnalysisReport>` as before

8. **Clear handler:** Also reset `triageResult`, `briefResult`, `cachedBrief`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx
git commit -m "feat(web): extend JiraAnalyzerView with triage and brief buttons"
```

---

## Task 9: JiraProjectFeed Component + App.tsx Wiring

**Files:**
- Create: `hadron-web/frontend/src/components/jira/JiraProjectFeed.tsx`
- Modify: `hadron-web/frontend/src/App.tsx`

- [ ] **Step 1: Create JiraProjectFeed**

Create `hadron-web/frontend/src/components/jira/JiraProjectFeed.tsx`.

This is the largest frontend component. Read the desktop version at `hadron-desktop/src/components/jira/JiraProjectFeed.tsx` for exact behavior and port it.

**Props:** None (self-contained view).

**State:**
- JIRA credentials from localStorage (same keys as JiraAnalyzerView)
- `projectKey: string` — JIRA project key input
- `issues: JiraIssue[]` — loaded from search API
- `briefsMap: Map<string, TicketBriefRow>` — cached briefs keyed by jira_key
- `search: string` — debounced search filter
- `triagedOnly: boolean` — filter checkbox
- `severityFilter: string` — "all" | specific severity
- `triageProgress: { current: number; total: number; key: string } | null`
- `triageCancelled: useRef<boolean>`

**Behavior:**
1. **Load issues:** User enters project key, clicks "Load" → `api.searchJira(creds, { jql: "project = KEY ORDER BY updated DESC", maxResults: 50 })` → sets `issues`
2. **Load briefs:** After issues load, `api.getTicketBriefsBatch(issues.map(i => i.key))` → build map
3. **Issue rows:** Expandable. Collapsed: key (monospace), status badge, severity badge (from briefsMap), title. Expanded: type, priority, assignee, components, labels, description excerpt, triage badges
4. **Search:** Filters `issues` client-side by key/summary containing search text (debounced 300ms)
5. **Filters:** "Triaged only" checkbox filters to issues with entry in briefsMap. Severity dropdown filters by `briefsMap[key]?.severity`
6. **"Triage All" button:** Confirmation dialog → sequential loop: for each visible issue, call `api.triageJiraIssue(key, creds)`, update briefsMap, update progress counter. Check `triageCancelledRef` each iteration.
7. **Cancel:** Sets `triageCancelledRef.current = true`

Use Tailwind dark theme. Expandable rows use `useState<Set<string>>` for expanded keys.

- [ ] **Step 2: Wire into App.tsx**

In `hadron-web/frontend/src/App.tsx`:

1. Import: `import { JiraProjectFeed } from "./components/jira/JiraProjectFeed";`
2. Add `"jira-feed"` to the View type
3. Add to navItems after "jira-analyzer": `{ key: "jira-feed", label: "JIRA Feed" }`
4. Add render: `{activeView === "jira-feed" && <JiraProjectFeed />}`

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/jira/JiraProjectFeed.tsx hadron-web/frontend/src/App.tsx
git commit -m "feat(web): add JiraProjectFeed with batch triage and wire into navigation"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Full Rust check**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 2: Run all Rust tests**

Run: `cd hadron-web && cargo test 2>&1 | tail -20`

- [ ] **Step 3: hadron-core tests**

Run: `cd hadron-web && cargo test -p hadron-core 2>&1 | tail -20`
Expected: all pass including new jira_triage tests

- [ ] **Step 4: Frontend type check**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 5: Verify new files**

Run: `ls hadron-web/crates/hadron-core/src/ai/jira_triage.rs && ls hadron-web/crates/hadron-core/src/ai/jira_brief.rs && ls hadron-web/migrations/014_ticket_briefs.sql && ls hadron-web/frontend/src/components/jira/TriageBadgePanel.tsx && ls hadron-web/frontend/src/components/jira/TicketBriefPanel.tsx && ls hadron-web/frontend/src/components/jira/JiraProjectFeed.tsx`

- [ ] **Step 6: Verify migration count**

Run: `ls hadron-web/migrations/ | wc -l`
Expected: 14
