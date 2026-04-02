# Phase 1b: JIRA Deep Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the desktop's JIRA Deep Analysis to hadron-web — fetch a JIRA ticket, run AI analysis, display a structured report.

**Architecture:** Add `jira_analysis` module to hadron-core (types + prompt + parser). Extend hadron-server's JIRA integration with `fetch_issue_detail()`. Add 3 new routes (fetch, analyze, stream). Build frontend orchestrator + report component, wire into App.tsx navigation.

**Tech Stack:** Rust (hadron-core types, hadron-server Axum routes, reqwest for JIRA API), React 18 + TypeScript + Tailwind CSS

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `crates/hadron-core/src/ai/jira_analysis.rs` | Types, system prompt, user prompt builder, parser |
| `crates/hadron-server/src/routes/jira_analysis.rs` | Fetch ticket, analyze, stream endpoints |
| `frontend/src/components/jira/JiraAnalyzerView.tsx` | Orchestrator: creds, fetch, analyze flow |
| `frontend/src/components/jira/JiraAnalysisReport.tsx` | Structured report display |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-core/src/ai/mod.rs` | Add `pub mod jira_analysis` + re-exports |
| `crates/hadron-server/src/integrations/jira.rs` | Add `JiraTicketDetail` struct + `fetch_issue_detail()` |
| `crates/hadron-server/src/routes/mod.rs` | Add `mod jira_analysis` + 3 routes |
| `frontend/src/services/api.ts` | Add `JiraTicketDetail`, `JiraDeepResult` types + API methods |
| `frontend/src/App.tsx` | Add `jira-analyzer` to View type, nav, render |

---

## Task 1: hadron-core JIRA Analysis Types, Prompt, and Parser

**Files:**
- Create: `hadron-web/crates/hadron-core/src/ai/jira_analysis.rs`
- Modify: `hadron-web/crates/hadron-core/src/ai/mod.rs`

- [ ] **Step 1: Create `jira_analysis.rs`**

Create `hadron-web/crates/hadron-core/src/ai/jira_analysis.rs`:

```rust
//! JIRA deep analysis — types, prompt, and response parser.
//!
//! Port of desktop's `jira_deep_analysis.rs`.

use crate::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

use super::types::AiMessage;

// ============================================================================
// Input
// ============================================================================

/// Ticket data needed to build the analysis prompt.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JiraTicketDetail {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub issue_type: String,
    pub priority: Option<String>,
    pub status: String,
    pub components: Vec<String>,
    pub labels: Vec<String>,
    pub comments: Vec<String>,
    pub url: String,
}

// ============================================================================
// Output
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JiraDeepResult {
    #[serde(default)]
    pub plain_summary: String,
    #[serde(default)]
    pub quality: TicketQuality,
    #[serde(default)]
    pub technical: TechnicalAnalysis,
    #[serde(default)]
    pub open_questions: Vec<String>,
    #[serde(default)]
    pub recommended_actions: Vec<RecommendedAction>,
    #[serde(default)]
    pub risk: RiskAssessment,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TicketQuality {
    #[serde(default)]
    pub score: u8,
    #[serde(default)]
    pub verdict: String,
    #[serde(default)]
    pub strengths: Vec<String>,
    #[serde(default)]
    pub gaps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TechnicalAnalysis {
    #[serde(default)]
    pub root_cause: String,
    #[serde(default)]
    pub affected_areas: Vec<String>,
    #[serde(default)]
    pub error_type: String,
    #[serde(default)]
    pub severity_estimate: String,
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub confidence_rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RecommendedAction {
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RiskAssessment {
    #[serde(default)]
    pub user_impact: String,
    #[serde(default)]
    pub blast_radius: String,
    #[serde(default)]
    pub urgency: String,
    #[serde(default)]
    pub do_nothing_risk: String,
}

// ============================================================================
// Prompt
// ============================================================================

pub const JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT: &str = r#"You are a senior software engineering lead and JIRA expert.
You receive a JIRA ticket (summary, description, comments, metadata) and produce a thorough structured analysis.

OUTPUT FORMAT: Respond ONLY with valid JSON matching this exact schema. No markdown, no prose outside JSON.

{
  "plain_summary": "2-4 sentence plain-language explanation of what this ticket is about and why it matters. Avoid jargon.",
  "quality": {
    "score": 0,
    "verdict": "Good|Needs Work|Poor",
    "strengths": ["..."],
    "gaps": ["..."]
  },
  "technical": {
    "root_cause": "Your best understanding of the root cause based on available evidence. Be specific.",
    "affected_areas": ["component or service names"],
    "error_type": "e.g. NullPointerException, Race Condition, Config Error, UX Bug, Performance Regression",
    "severity_estimate": "Critical|High|Medium|Low",
    "confidence": "High|Medium|Low",
    "confidence_rationale": "Why your confidence is high/medium/low given the ticket's information density."
  },
  "open_questions": [
    "Question the ticket leaves unanswered that would help resolve it faster"
  ],
  "recommended_actions": [
    {
      "priority": "Immediate|Short-term|Long-term",
      "action": "Concrete action for the team",
      "rationale": "Why this action matters"
    }
  ],
  "risk": {
    "user_impact": "Who is affected and how",
    "blast_radius": "Single user|Team|Org|All users",
    "urgency": "Blocking|High|Medium|Low",
    "do_nothing_risk": "What happens if this ticket is ignored or deprioritized"
  }
}

SCORING GUIDE for quality.score:
- 0-39 Poor: Missing description, no reproduction steps, no acceptance criteria, vague summary
- 40-69 Needs Work: Partial description, some context missing, no clear done-criteria
- 70-89 Good: Clear description, reproduction steps or clear spec, some acceptance criteria
- 90-100 Excellent: Complete description, full repro/spec, acceptance criteria, attachments/logs referenced

TICKET TYPE ADAPTATION:
- For Bug / Incident tickets: root_cause = likely cause of the defect; error_type = exception or failure class; recommended_actions = debugging & fix steps.
- For Feature / Story / Epic / Enhancement tickets: root_cause = the gap or user need driving the request; error_type = "Feature Request" or "Enhancement"; recommended_actions = design decisions, scope suggestions, implementation steps.
- For Task / Sub-task / Information Request tickets: root_cause = the underlying question or objective; error_type = "Task" or "Information Request"; recommended_actions = next steps to fulfill the request.
Adapt your language to match the ticket's intent — do not force bug-centric framing onto non-bug tickets.

Be direct. Do not hedge unnecessarily. If the ticket is vague, say so clearly in plain_summary and gaps."#;

/// Build the user prompt from ticket detail.
pub fn build_jira_deep_user_prompt(ticket: &JiraTicketDetail) -> String {
    let mut parts = vec![
        format!("TICKET: {}", ticket.key),
        format!("TYPE: {}", ticket.issue_type),
        format!("PRIORITY: {}", ticket.priority.as_deref().unwrap_or("not set")),
        format!("STATUS: {}", ticket.status),
        format!("SUMMARY: {}", ticket.summary),
    ];

    if !ticket.components.is_empty() {
        parts.push(format!("COMPONENTS: {}", ticket.components.join(", ")));
    }
    if !ticket.labels.is_empty() {
        parts.push(format!("LABELS: {}", ticket.labels.join(", ")));
    }

    if !ticket.description.is_empty() {
        parts.push(format!("\nDESCRIPTION:\n{}", ticket.description));
    } else {
        parts.push("\nDESCRIPTION: (empty)".to_string());
    }

    if !ticket.comments.is_empty() {
        parts.push(format!("\nCOMMENTS ({}):", ticket.comments.len()));
        for (i, c) in ticket.comments.iter().enumerate() {
            parts.push(format!("[Comment {}] {}", i + 1, c));
        }
    }

    parts.join("\n")
}

/// Build the system prompt + messages for an AI call.
pub fn build_jira_deep_messages(ticket: &JiraTicketDetail) -> (String, Vec<AiMessage>) {
    let system = JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT.to_string();
    let messages = vec![AiMessage {
        role: "user".to_string(),
        content: build_jira_deep_user_prompt(ticket),
    }];
    (system, messages)
}

/// Parse AI response into JiraDeepResult.
pub fn parse_jira_deep_analysis(raw: &str) -> HadronResult<JiraDeepResult> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let preview = if raw.len() > 200 { &raw[..200] } else { raw };
        HadronError::Parse(format!(
            "Failed to parse JIRA deep analysis: {e}. Preview: {preview}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_user_prompt() {
        let ticket = JiraTicketDetail {
            key: "PROJ-123".to_string(),
            summary: "Login fails".to_string(),
            description: "Users cannot log in after update".to_string(),
            issue_type: "Bug".to_string(),
            priority: Some("High".to_string()),
            status: "Open".to_string(),
            components: vec!["Auth".to_string()],
            labels: vec!["regression".to_string()],
            comments: vec!["Reproduced on staging".to_string()],
            url: String::new(),
        };
        let prompt = build_jira_deep_user_prompt(&ticket);
        assert!(prompt.contains("TICKET: PROJ-123"));
        assert!(prompt.contains("TYPE: Bug"));
        assert!(prompt.contains("PRIORITY: High"));
        assert!(prompt.contains("COMPONENTS: Auth"));
        assert!(prompt.contains("[Comment 1] Reproduced on staging"));
    }

    #[test]
    fn test_build_user_prompt_empty_description() {
        let ticket = JiraTicketDetail {
            key: "X-1".to_string(),
            description: String::new(),
            ..Default::default()
        };
        let prompt = build_jira_deep_user_prompt(&ticket);
        assert!(prompt.contains("DESCRIPTION: (empty)"));
    }

    #[test]
    fn test_parse_deep_result() {
        let input = r#"{
            "plain_summary": "Login is broken",
            "quality": {"score": 75, "verdict": "Good", "strengths": ["Clear repro"], "gaps": ["No logs"]},
            "technical": {"root_cause": "Session timeout", "affected_areas": ["Auth"], "error_type": "AuthError", "severity_estimate": "High", "confidence": "Medium", "confidence_rationale": "Limited info"},
            "open_questions": ["Which version?"],
            "recommended_actions": [{"priority": "Immediate", "action": "Check session config", "rationale": "Most likely cause"}],
            "risk": {"user_impact": "All users blocked", "blast_radius": "All users", "urgency": "Blocking", "do_nothing_risk": "Complete service outage"}
        }"#;
        let result = parse_jira_deep_analysis(input).unwrap();
        assert_eq!(result.plain_summary, "Login is broken");
        assert_eq!(result.quality.score, 75);
        assert_eq!(result.technical.root_cause, "Session timeout");
        assert_eq!(result.recommended_actions[0].priority, "Immediate");
        assert_eq!(result.risk.blast_radius, "All users");
    }

    #[test]
    fn test_parse_deep_result_defaults() {
        let input = r#"{"plain_summary": "test"}"#;
        let result = parse_jira_deep_analysis(input).unwrap();
        assert_eq!(result.plain_summary, "test");
        assert_eq!(result.quality.score, 0);
        assert!(result.open_questions.is_empty());
    }
}
```

- [ ] **Step 2: Register in `ai/mod.rs`**

In `hadron-web/crates/hadron-core/src/ai/mod.rs`, add:

```rust
pub mod jira_analysis;
```

And add to re-exports:

```rust
pub use jira_analysis::*;
```

- [ ] **Step 3: Run tests**

Run: `cd hadron-web && cargo test -p hadron-core ai::jira_analysis 2>&1 | tail -10`
Expected: 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/
git commit -m "feat(web): add hadron-core JIRA deep analysis types, prompt, and parser"
```

---

## Task 2: Extend JIRA Integration with `fetch_issue_detail`

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/integrations/jira.rs`

- [ ] **Step 1: Add `fetch_issue_detail` to `jira.rs`**

Read `hadron-web/crates/hadron-server/src/integrations/jira.rs`. Then append this function and the helper at the end (before the closing of the file):

```rust
/// Fetch full issue detail including description and comments.
pub async fn fetch_issue_detail(
    config: &JiraConfig,
    key: &str,
) -> HadronResult<hadron_core::ai::jira_analysis::JiraTicketDetail> {
    let client = build_client()?;

    // Validate key format (PROJ-123)
    if !key.chars().all(|c| c.is_alphanumeric() || c == '-') {
        return Err(HadronError::Validation(format!("Invalid JIRA key: {key}")));
    }

    let url = format!(
        "{}/rest/api/3/issue/{}?fields=summary,description,status,priority,issuetype,components,labels,comment",
        config.base_url.trim_end_matches('/'),
        key
    );

    let resp = client
        .get(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("JIRA fetch failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "JIRA returned {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| HadronError::external_service(format!("Failed to parse JIRA response: {e}")))?;

    let fields = &data["fields"];

    let description = extract_adf_text(&fields["description"]);

    let comments: Vec<String> = fields["comment"]["comments"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|c| extract_adf_text(&c["body"]))
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let components: Vec<String> = fields["components"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c["name"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let labels: Vec<String> = fields["labels"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|l| l.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let browse_url = format!(
        "{}/browse/{}",
        config.base_url.trim_end_matches('/'),
        key
    );

    Ok(hadron_core::ai::jira_analysis::JiraTicketDetail {
        key: key.to_string(),
        summary: fields["summary"].as_str().unwrap_or("").to_string(),
        description,
        issue_type: fields["issuetype"]["name"].as_str().unwrap_or("Bug").to_string(),
        priority: fields["priority"]["name"].as_str().map(|s| s.to_string()),
        status: fields["status"]["name"].as_str().unwrap_or("").to_string(),
        components,
        labels,
        comments,
        url: browse_url,
    })
}

/// Extract plain text from JIRA's Atlassian Document Format (ADF).
///
/// ADF is a nested JSON structure. This does a simple recursive text extraction.
/// Falls back to treating the value as a plain string if it's not ADF.
fn extract_adf_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(obj) => {
            // ADF document: { "type": "doc", "content": [...] }
            if let Some(content) = obj.get("content") {
                extract_adf_content(content)
            } else if let Some(text) = obj.get("text") {
                text.as_str().unwrap_or("").to_string()
            } else {
                String::new()
            }
        }
        serde_json::Value::Null => String::new(),
        _ => value.to_string(),
    }
}

fn extract_adf_content(content: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(arr) = content.as_array() {
        for node in arr {
            let node_type = node["type"].as_str().unwrap_or("");
            match node_type {
                "text" => {
                    if let Some(text) = node["text"].as_str() {
                        parts.push(text.to_string());
                    }
                }
                "hardBreak" => parts.push("\n".to_string()),
                "paragraph" | "heading" | "blockquote" | "listItem" | "tableCell" => {
                    if let Some(inner) = node.get("content") {
                        let text = extract_adf_content(inner);
                        if !text.is_empty() {
                            parts.push(text);
                        }
                    }
                    if node_type == "paragraph" || node_type == "heading" {
                        parts.push("\n".to_string());
                    }
                }
                "bulletList" | "orderedList" | "table" | "tableRow" => {
                    if let Some(inner) = node.get("content") {
                        let text = extract_adf_content(inner);
                        if !text.is_empty() {
                            parts.push(text);
                        }
                    }
                }
                "codeBlock" => {
                    if let Some(inner) = node.get("content") {
                        let text = extract_adf_content(inner);
                        if !text.is_empty() {
                            parts.push(format!("\n```\n{}\n```\n", text));
                        }
                    }
                }
                _ => {
                    // Unknown node type — try extracting content recursively
                    if let Some(inner) = node.get("content") {
                        let text = extract_adf_content(inner);
                        if !text.is_empty() {
                            parts.push(text);
                        }
                    }
                }
            }
        }
    }
    parts.join("")
}
```

- [ ] **Step 2: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -5`
Expected: compiles cleanly

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-server/src/integrations/jira.rs
git commit -m "feat(web): add fetch_issue_detail with ADF text extraction for JIRA deep analysis"
```

---

## Task 3: Backend JIRA Analysis Routes

**Files:**
- Create: `hadron-web/crates/hadron-server/src/routes/jira_analysis.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Create `jira_analysis.rs`**

Create `hadron-web/crates/hadron-server/src/routes/jira_analysis.rs`:

```rust
//! JIRA deep analysis handlers — fetch ticket, analyze, stream.

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::ai;
use crate::auth::AuthenticatedUser;
use crate::integrations::jira::{self, JiraConfig};
use crate::sse;
use crate::AppState;

use super::AppError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCredentials {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchIssueRequest {
    pub credentials: JiraCredentials,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub credentials: JiraCredentials,
    pub api_key: Option<String>,
}

fn to_jira_config(creds: &JiraCredentials) -> JiraConfig {
    JiraConfig {
        base_url: creds.base_url.clone(),
        email: creds.email.clone(),
        api_token: creds.api_token.clone(),
        project_key: String::new(), // Not needed for single-issue fetch
    }
}

/// POST /api/jira/issues/{key}/detail — fetch full ticket detail.
pub async fn fetch_issue(
    _user: AuthenticatedUser,
    Path(key): Path<String>,
    Json(req): Json<FetchIssueRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = to_jira_config(&req.credentials);
    let detail = jira::fetch_issue_detail(&config, &key).await?;
    Ok(Json(detail))
}

/// POST /api/jira/issues/{key}/analyze — non-streaming deep analysis.
pub async fn analyze_issue(
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

    let (system_prompt, messages) = hadron_core::ai::build_jira_deep_messages(&ticket);

    let raw_response = ai::complete(&ai_config, messages, Some(&system_prompt)).await?;
    let result = hadron_core::ai::parse_jira_deep_analysis(&raw_response)?;

    Ok(Json(result))
}

/// POST /api/jira/issues/{key}/analyze/stream — SSE streaming deep analysis.
pub async fn analyze_issue_stream(
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

    let (system_prompt, messages) = hadron_core::ai::build_jira_deep_messages(&ticket);

    Ok(sse::stream_ai_completion(ai_config, messages, Some(system_prompt)))
}
```

- [ ] **Step 2: Register routes in `mod.rs`**

In `hadron-web/crates/hadron-server/src/routes/mod.rs`, add:

Module declaration (near the other mods):
```rust
mod jira_analysis;
```

Routes inside `api_router()` (after existing JIRA routes):
```rust
        // JIRA Deep Analysis
        .route("/jira/issues/{key}/detail", post(jira_analysis::fetch_issue))
        .route("/jira/issues/{key}/analyze", post(jira_analysis::analyze_issue))
        .route("/jira/issues/{key}/analyze/stream", post(jira_analysis::analyze_issue_stream))
```

- [ ] **Step 3: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -5`
Expected: compiles cleanly

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/jira_analysis.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(web): add JIRA deep analysis routes (fetch detail, analyze, stream)"
```

---

## Task 4: Frontend Types and API Methods

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`

- [ ] **Step 1: Add types and API methods**

In `hadron-web/frontend/src/services/api.ts`, add these interfaces after the `GlossaryTerm` interface:

```typescript
// ============================================================================
// JIRA Deep Analysis Types
// ============================================================================

export interface JiraTicketDetail {
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

export interface JiraDeepResult {
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

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}
```

Add these methods inside the `ApiClient` class (after the existing JIRA methods):

```typescript
  // === JIRA Deep Analysis ===

  async fetchJiraIssueDetail(
    key: string,
    credentials: JiraCredentials,
  ): Promise<JiraTicketDetail> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/detail`, {
      credentials,
    });
  }

  async analyzeJiraIssue(
    key: string,
    credentials: JiraCredentials,
  ): Promise<JiraDeepResult> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/analyze`, {
      credentials,
    });
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts
git commit -m "feat(web): add JIRA deep analysis types and API methods"
```

---

## Task 5: JiraAnalysisReport Component

**Files:**
- Create: `hadron-web/frontend/src/components/jira/JiraAnalysisReport.tsx`

- [ ] **Step 1: Create the report component**

Port from desktop's `JiraAnalysisReport.tsx`. This is a rich report display with collapsible sections.

Create `hadron-web/frontend/src/components/jira/JiraAnalysisReport.tsx`:

Props: `{ result: JiraDeepResult; jiraKey: string; category?: string }`

The component should display these sections (all collapsible, start expanded):

1. **Plain Language Summary** — `result.plain_summary` in a card
2. **Ticket Quality** — QualityGauge (import from `../code-analyzer/shared/QualityGauge`) + verdict badge (Good=green, Needs Work=amber, Poor=red) + strengths list (green bullets) + gaps list (red bullets)
3. **Technical Analysis** — labeled fields in a card:
   - Root Cause (or "Analysis" if category is feature-like)
   - Error Type (or "Feature Type" if feature-like)
   - Affected Areas (pill badges)
   - Severity Estimate (colored: Critical=red, High=orange, Medium=yellow, Low=blue)
   - Confidence + Rationale
4. **Open Questions** — numbered list, hidden if empty
5. **Recommended Actions** — cards with:
   - Priority badge (Immediate=red bg, Short-term=amber bg, Long-term=blue bg)
   - Checkbox (local state only, for tracking)
   - Action text (bold)
   - Rationale (gray text below)
6. **Risk & Impact** — 4 labeled fields: user impact, blast radius, urgency, do-nothing risk

Category detection: treat `category` as bug-like if it starts with "Bug" or "Incident" or is undefined. Feature-like if "Feature", "Story", "Epic", "Enhancement". This only changes labels in the Technical Analysis section.

Use dark theme (slate-800/900 backgrounds, slate-200/300 text). Reuse `QualityGauge` from `../code-analyzer/shared/QualityGauge`.

The implementer should read the desktop version at `hadron-desktop/src/components/jira/JiraAnalysisReport.tsx` for exact layout and behavior, then create the web version with Tailwind classes.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/jira/JiraAnalysisReport.tsx
git commit -m "feat(web): add JiraAnalysisReport component with collapsible sections"
```

---

## Task 6: JiraAnalyzerView Orchestrator

**Files:**
- Create: `hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx`

- [ ] **Step 1: Create the orchestrator**

Create `hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx`.

This component manages: JIRA credentials, ticket fetching, AI analysis streaming, and report display.

```typescript
import { useCallback, useEffect, useState } from "react";
import { useAiStream } from "../../hooks/useAiStream";
import { api, JiraCredentials, JiraTicketDetail, JiraDeepResult } from "../../services/api";
import { useToast } from "../Toast";
import { JiraAnalysisReport } from "./JiraAnalysisReport";
```

**State:**
```typescript
// Credentials (persisted to localStorage)
const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem("hadron_jira_url") || "");
const [email, setEmail] = useState(() => localStorage.getItem("hadron_jira_email") || "");
const [apiToken, setApiToken] = useState(() => localStorage.getItem("hadron_jira_token") || "");

// Ticket
const [ticketKey, setTicketKey] = useState("");
const [ticket, setTicket] = useState<JiraTicketDetail | null>(null);
const [fetching, setFetching] = useState(false);

// Analysis
const [result, setResult] = useState<JiraDeepResult | null>(null);
const [parseError, setParseError] = useState<string | null>(null);
const { streamAi, content, isStreaming, error, reset } = useAiStream();
```

**Key behaviors:**

1. **Credentials persistence**: On change, save to localStorage (`hadron_jira_url`, `hadron_jira_email`, `hadron_jira_token`).

2. **Ticket key input**: Text input. Auto-extract key from URL: if input contains `/browse/`, extract the key after it. e.g. `https://jira.example.com/browse/PROJ-123` → `PROJ-123`.

3. **Fetch button**: Builds `JiraCredentials`, calls `api.fetchJiraIssueDetail(key, creds)`. On success, sets `ticket`. On error, shows toast.

4. **Ticket preview card**: After fetch, show: key (linked to JIRA URL), summary, status badge, priority, issue type, components as pills, labels as pills, description truncated to 3 lines with expand toggle, comment count.

5. **"Deep Analyze" button**: Only shown when `ticket` is set. Calls `streamAi("/jira/issues/{key}/analyze/stream", { credentials: { baseUrl, email, apiToken } })`. Clears previous result.

6. **Parse on stream completion**: Same pattern as Code Analyzer — `useEffect` on `[content, isStreaming]`, try `JSON.parse`, fallback regex extract, `setParseError` on failure.

7. **Report display**: When `result` is set, render `<JiraAnalysisReport result={result} jiraKey={ticket.key} category={ticket.issueType} />`.

8. **Clear**: Reset ticket, result, stream state.

**Layout:**
```
┌────────────────────────────────────────────┐
│ JIRA Deep Analysis                [Clear]  │
├────────────────────────────────────────────┤
│ JIRA URL: [________________________]       │
│ Email:    [________________________]       │
│ API Token:[________________________]       │
│                                            │
│ Ticket Key: [____________]  [Fetch]        │
├────────────────────────────────────────────┤
│ ┌─ticket preview card──────────────────┐   │
│ │ PROJ-123: Login fails after update   │   │
│ │ Status: Open | Priority: High | Bug  │   │
│ │ Components: Auth, SSO                │   │
│ │ Description: Users cannot log in...  │   │
│ │              [Deep Analyze]          │   │
│ └──────────────────────────────────────┘   │
├────────────────────────────────────────────┤
│ (streaming indicator or error)             │
├────────────────────────────────────────────┤
│ ┌─JiraAnalysisReport───────────────────┐   │
│ │ (collapsible sections)               │   │
│ └──────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx
git commit -m "feat(web): add JiraAnalyzerView orchestrator with credential management and streaming"
```

---

## Task 7: Wire Into App.tsx Navigation

**Files:**
- Modify: `hadron-web/frontend/src/App.tsx`

- [ ] **Step 1: Read App.tsx and make 4 changes**

1. **Add import**:
```typescript
import { JiraAnalyzerView } from "./components/jira/JiraAnalyzerView";
```

2. **Add to View type** — add `"jira-analyzer"` to the union.

3. **Add to navItems** — add after the "code-analyzer" entry:
```typescript
{ key: "jira-analyzer", label: "JIRA Analyzer" },
```

4. **Add conditional render**:
```tsx
{activeView === "jira-analyzer" && <JiraAnalyzerView />}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/App.tsx
git commit -m "feat(web): wire JIRA Analyzer into navigation and routing"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Full Rust check**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`
Expected: compiles cleanly

- [ ] **Step 2: Run all Rust tests**

Run: `cd hadron-web && cargo test 2>&1 | tail -20`
Expected: all tests pass (existing + new jira_analysis tests)

- [ ] **Step 3: Run hadron-core tests**

Run: `cd hadron-web && cargo test -p hadron-core 2>&1 | tail -20`
Expected: all tests pass including jira_analysis tests

- [ ] **Step 4: Frontend type check**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 5: Verify new files exist**

Run: `ls hadron-web/crates/hadron-core/src/ai/jira_analysis.rs && ls hadron-web/crates/hadron-server/src/routes/jira_analysis.rs && ls hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx && ls hadron-web/frontend/src/components/jira/JiraAnalysisReport.tsx`
Expected: all 4 files exist

- [ ] **Step 6: Verify route count**

Run: `grep -c "jira_analysis" hadron-web/crates/hadron-server/src/routes/mod.rs`
Expected: 4 (1 mod declaration + 3 route registrations)
