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
