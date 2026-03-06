//! Standalone JIRA deep analysis — dedicated prompt + structured output.

use serde::{Deserialize, Serialize};

// ─── Input ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct JiraDeepRequest {
    pub jira_key: String,
    pub summary: String,
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
pub struct JiraDeepResult {
    /// Human-readable plain-language summary (2–4 sentences max)
    pub plain_summary: String,
    /// Ticket quality score 0–100 with rationale
    pub quality: TicketQuality,
    /// Technical analysis section
    pub technical: TechnicalAnalysis,
    /// Open questions the ticket leaves unanswered
    pub open_questions: Vec<String>,
    /// Concrete recommended actions for the team
    pub recommended_actions: Vec<RecommendedAction>,
    /// Risk & impact assessment
    pub risk: RiskAssessment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketQuality {
    pub score: u8,            // 0–100
    pub verdict: String,      // "Good" | "Needs Work" | "Poor"
    pub strengths: Vec<String>,
    pub gaps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechnicalAnalysis {
    pub root_cause: String,
    pub affected_areas: Vec<String>,
    pub error_type: String,
    pub severity_estimate: String,
    pub confidence: String,
    pub confidence_rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendedAction {
    pub priority: String,
    pub action: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAssessment {
    pub user_impact: String,
    pub blast_radius: String,
    pub urgency: String,
    pub do_nothing_risk: String,
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

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
- 0–39 Poor: Missing description, no reproduction steps, no acceptance criteria, vague summary
- 40–69 Needs Work: Partial description, some context missing, no clear done-criteria
- 70–89 Good: Clear description, reproduction steps or clear spec, some acceptance criteria
- 90–100 Excellent: Complete description, full repro/spec, acceptance criteria, attachments/logs referenced

TICKET TYPE ADAPTATION:
- For Bug / Incident tickets: root_cause = likely cause of the defect; error_type = exception or failure class; recommended_actions = debugging & fix steps.
- For Feature / Story / Epic / Enhancement tickets: root_cause = the gap or user need driving the request; error_type = "Feature Request" or "Enhancement"; recommended_actions = design decisions, scope suggestions, implementation steps.
- For Task / Sub-task / Information Request tickets: root_cause = the underlying question or objective; error_type = "Task" or "Information Request"; recommended_actions = next steps to fulfill the request.
Adapt your language to match the ticket's intent — do not force bug-centric framing onto non-bug tickets.

Be direct. Do not hedge unnecessarily. If the ticket is vague, say so clearly in plain_summary and gaps.
"#;

// ─── Core function ────────────────────────────────────────────────────────────

pub async fn run_jira_deep_analysis(req: JiraDeepRequest) -> Result<JiraDeepResult, String> {
    use crate::ai_service::{call_openai_raw, call_anthropic_raw, call_zai_raw};

    let user_prompt = build_user_prompt(&req);

    // Use the *_raw variants which return the raw string content — we parse it ourselves
    // into JiraDeepResult (which has a different schema than the standard AnalysisResult).
    // llamacpp is not supported for structured JIRA deep analysis.
    let raw_response: String = match req.provider.to_lowercase().as_str() {
        "openai"    => call_openai_raw(JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model, 4096).await?,
        "anthropic" => call_anthropic_raw(JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "zai"       => call_zai_raw(JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "llamacpp"  => return Err("Deep JIRA analysis requires a cloud AI provider (OpenAI, Anthropic, or Z.ai). llamacpp is not supported.".to_string()),
        p           => return Err(format!("Unknown AI provider: {}", p)),
    };

    parse_deep_result(&raw_response)
}

fn build_user_prompt(req: &JiraDeepRequest) -> String {
    let mut parts = vec![
        format!("TICKET: {}", req.jira_key),
        format!("TYPE: {}", req.issue_type),
        format!("PRIORITY: {}", req.priority.as_deref().unwrap_or("not set")),
        format!("STATUS: {}", req.status.as_deref().unwrap_or("unknown")),
        format!("SUMMARY: {}", req.summary),
    ];

    if !req.components.is_empty() {
        parts.push(format!("COMPONENTS: {}", req.components.join(", ")));
    }
    if !req.labels.is_empty() {
        parts.push(format!("LABELS: {}", req.labels.join(", ")));
    }

    if !req.description.is_empty() {
        parts.push(format!("\nDESCRIPTION:\n{}", req.description));
    } else {
        parts.push("\nDESCRIPTION: (empty)".to_string());
    }

    if !req.comments.is_empty() {
        parts.push(format!("\nCOMMENTS ({}):", req.comments.len()));
        for (i, c) in req.comments.iter().enumerate() {
            parts.push(format!("[Comment {}] {}", i + 1, c));
        }
    }

    parts.join("\n")
}

fn parse_deep_result(raw: &str) -> Result<JiraDeepResult, String> {
    // Strip markdown code fences if the model wraps the JSON
    let json_str = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str(json_str).map_err(|e| {
        let preview = &raw[..raw.len().min(300)];
        format!("Failed to parse AI response as JSON: {}. Raw: {}", e, preview)
    })
}
