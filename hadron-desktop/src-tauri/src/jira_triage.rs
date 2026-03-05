//! JIRA Assist — Triage Engine (Sprint 2).
//!
//! Classifies a JIRA ticket into severity/category/tags/customer_impact
//! and returns a structured `JiraTriageResult`. Supports all AI providers.

use serde::{Deserialize, Serialize};

// ─── Input ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct JiraTriageRequest {
    pub jira_key: String,
    pub title: String,
    pub description: String,
    pub issue_type: String,
    pub priority: Option<String>,
    pub status: Option<String>,
    pub components: Vec<String>,
    pub labels: Vec<String>,
    pub comments: Vec<String>,
    pub api_key: String,
    pub model: String,
    pub provider: String,
}

// ─── Output ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraTriageResult {
    /// Critical | High | Medium | Low
    pub severity: String,
    /// Bug | Feature | Infrastructure | UX | Performance | Security
    pub category: String,
    /// Plain-language description of who is impacted and how severely
    pub customer_impact: String,
    /// Short classification tags (max 5), e.g. ["login", "auth", "regression"]
    pub tags: Vec<String>,
    /// High | Medium | Low — model's confidence in this triage
    pub confidence: String,
    /// 1–3 sentence rationale for the severity/category choices
    pub rationale: String,
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT: &str = r#"You are a senior support engineer triaging JIRA tickets for a software product.
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
- Critical: Production down, data loss, security breach, blocking all users
- High: Major feature broken, significant user population affected, no workaround
- Medium: Feature degraded, workaround exists, affects a subset of users
- Low: Cosmetic, edge case, minor inconvenience, enhancement request

CATEGORY GUIDE:
- Bug: Unintended behavior, crash, regression
- Feature: New functionality or enhancement request
- Infrastructure: Deployment, config, CI/CD, environment
- UX: Usability, accessibility, layout, wording
- Performance: Slow response, high resource usage, timeout
- Security: Auth, permissions, data exposure, injection

TAGS: 2-5 short lowercase single-word or hyphenated labels describing the affected area (e.g. "login", "api", "export", "dark-mode"). Do not repeat severity or category as tags.

Be direct. If the ticket is vague, lower your confidence and explain why.
"#;

// ─── Core function ────────────────────────────────────────────────────────────

pub async fn run_jira_triage(req: JiraTriageRequest) -> Result<JiraTriageResult, String> {
    use crate::ai_service::{call_anthropic, call_llamacpp, call_openai, call_zai};

    let user_prompt = build_prompt(&req);

    let raw = match req.provider.to_lowercase().as_str() {
        "openai"    => call_openai(TRIAGE_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "anthropic" => call_anthropic(TRIAGE_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "zai"       => call_zai(TRIAGE_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "llamacpp"  => call_llamacpp(TRIAGE_SYSTEM_PROMPT, &user_prompt, &req.model).await?,
        p           => return Err(format!("Unknown AI provider: {}", p)),
    };

    parse_triage_result(&raw)
}

fn build_prompt(req: &JiraTriageRequest) -> String {
    let mut parts = vec![
        format!("TICKET: {}", req.jira_key),
        format!("TYPE: {}", req.issue_type),
        format!("PRIORITY (reporter-set): {}", req.priority.as_deref().unwrap_or("not set")),
        format!("STATUS: {}", req.status.as_deref().unwrap_or("unknown")),
        format!("TITLE: {}", req.title),
    ];

    if !req.components.is_empty() {
        parts.push(format!("COMPONENTS: {}", req.components.join(", ")));
    }
    if !req.labels.is_empty() {
        parts.push(format!("LABELS: {}", req.labels.join(", ")));
    }

    if req.description.is_empty() {
        parts.push("\nDESCRIPTION: (empty)".to_string());
    } else {
        let desc = if req.description.len() > 2000 {
            format!("{}… (truncated)", &req.description[..2000])
        } else {
            req.description.clone()
        };
        parts.push(format!("\nDESCRIPTION:\n{}", desc));
    }

    if !req.comments.is_empty() {
        let recent: Vec<String> = req.comments.iter().rev().take(5).enumerate()
            .map(|(i, c)| {
                let body = if c.len() > 500 { format!("{}…", &c[..500]) } else { c.clone() };
                format!("[Comment {}] {}", i + 1, body)
            })
            .collect();
        parts.push(format!("\nRECENT COMMENTS:\n{}", recent.join("\n")));
    }

    parts.join("\n")
}

fn parse_triage_result(raw: &str) -> Result<JiraTriageResult, String> {
    let json_str = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str(json_str).map_err(|e| {
        format!(
            "Failed to parse triage JSON: {}. Raw (first 400 chars): {}",
            e,
            &raw[..raw.len().min(400)]
        )
    })
}
