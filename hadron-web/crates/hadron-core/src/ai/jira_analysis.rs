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
