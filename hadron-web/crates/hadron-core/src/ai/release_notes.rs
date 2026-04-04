//! Release notes module — types, insights, enrichment and generation prompts.
//!
//! Transport-agnostic: no HTTP client, no async runtime.
//! The server layer handles actual AI API calls.

use crate::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

// ============================================================================
// 1. Embedded style guide
// ============================================================================

pub const DEFAULT_STYLE_GUIDE: &str =
    include_str!("../../style_guides/whatson_release_notes.md");

// ============================================================================
// 2. Config types
// ============================================================================

fn default_true() -> bool {
    true
}

/// Which categories of tickets to include in the release notes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Features,
    Fixes,
    Both,
}

impl Default for ContentType {
    fn default() -> Self {
        ContentType::Both
    }
}

impl fmt::Display for ContentType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ContentType::Features => write!(f, "features"),
            ContentType::Fixes => write!(f, "fixes"),
            ContentType::Both => write!(f, "both"),
        }
    }
}

/// Controls which AI enrichment passes are executed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEnrichmentConfig {
    #[serde(default = "default_true")]
    pub rewrite_descriptions: bool,
    #[serde(default = "default_true")]
    pub generate_keywords: bool,
    #[serde(default = "default_true")]
    pub classify_modules: bool,
    #[serde(default = "default_true")]
    pub detect_breaking_changes: bool,
}

impl Default for AiEnrichmentConfig {
    fn default() -> Self {
        AiEnrichmentConfig {
            rewrite_descriptions: true,
            generate_keywords: true,
            classify_modules: true,
            detect_breaking_changes: true,
        }
    }
}

/// Top-level configuration for a release notes generation request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesConfig {
    pub fix_version: String,
    #[serde(default)]
    pub content_type: ContentType,
    #[serde(default)]
    pub project_key: Option<String>,
    #[serde(default)]
    pub jql_filter: Option<String>,
    #[serde(default)]
    pub module_filter: Option<Vec<String>>,
    #[serde(default)]
    pub enrichment: AiEnrichmentConfig,
}

// ============================================================================
// 3. Ticket types
// ============================================================================

/// A JIRA ticket prepared for release notes processing.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNoteTicket {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub issue_type: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub module_label: Option<String>,
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
    #[serde(default)]
    pub rewritten_description: Option<String>,
    #[serde(default)]
    pub is_breaking_change: Option<bool>,
}

/// AI-enriched fields for a single ticket, returned from the enrichment pass.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedTicket {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub module_label: Option<String>,
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
    #[serde(default)]
    pub rewritten_description: Option<String>,
    #[serde(default)]
    pub is_breaking_change: Option<bool>,
}

// ============================================================================
// 4. Insights types and computation
// ============================================================================

/// Quality insights derived from a set of enriched tickets.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiInsights {
    #[serde(default)]
    pub quality_score: f64,
    #[serde(default)]
    pub suggestions: Vec<String>,
    #[serde(default)]
    pub module_breakdown: HashMap<String, i32>,
    #[serde(default)]
    pub ticket_coverage: f64,
    #[serde(default)]
    pub breaking_changes: Vec<String>,
}

/// Compute quality insights from a slice of tickets. Pure function — no I/O.
pub fn compute_insights(tickets: &[ReleaseNoteTicket]) -> AiInsights {
    if tickets.is_empty() {
        return AiInsights {
            quality_score: 0.0,
            ..Default::default()
        };
    }

    // Module breakdown: count tickets per module_label.
    let mut module_breakdown: HashMap<String, i32> = HashMap::new();
    let mut classified_count = 0usize;
    let mut breaking_changes: Vec<String> = Vec::new();

    for ticket in tickets {
        if let Some(module) = &ticket.module_label {
            *module_breakdown.entry(module.clone()).or_insert(0) += 1;
            classified_count += 1;
        }
        if ticket.is_breaking_change == Some(true) {
            breaking_changes.push(ticket.key.clone());
        }
    }

    let ticket_coverage = classified_count as f64 / tickets.len() as f64;

    // Quality score: coverage contributes 80 points, breaking changes situation 20/10.
    let breaking_penalty = if breaking_changes.is_empty() { 20.0 } else { 10.0 };
    let quality_score = (ticket_coverage * 80.0 + breaking_penalty).min(100.0);

    // Generate suggestions based on gaps.
    let mut suggestions: Vec<String> = Vec::new();
    if ticket_coverage < 1.0 {
        let unclassified = tickets.len() - classified_count;
        suggestions.push(format!(
            "{} ticket(s) have no module label — consider classifying them for better organisation.",
            unclassified
        ));
    }
    if !breaking_changes.is_empty() {
        suggestions.push(format!(
            "{} breaking change(s) detected ({}). Ensure upgrade notes are included.",
            breaking_changes.len(),
            breaking_changes.join(", ")
        ));
    }
    if tickets.iter().all(|t| t.rewritten_description.is_none()) {
        suggestions.push(
            "No rewritten descriptions found — run the enrichment pass to improve readability."
                .to_string(),
        );
    }

    AiInsights {
        quality_score,
        suggestions,
        module_breakdown,
        ticket_coverage,
        breaking_changes,
    }
}

// ============================================================================
// 5. Enrichment prompt & parser
// ============================================================================

pub const ENRICHMENT_SYSTEM_PROMPT: &str = r#"You are a technical writer preparing release notes for a software product.

Your task is to enrich a list of JIRA tickets with structured metadata.

For EACH ticket in the input array, produce one output object with:
- "key": the ticket key (unchanged)
- "moduleLabel": the logical product module this ticket belongs to (e.g. "Authentication", "Reporting", "API", "Dashboard"). Use null if genuinely unclear.
- "keywords": 3-6 short lowercase search keywords describing the change (e.g. ["login", "sso", "oauth"]).
- "rewrittenDescription": a single customer-facing sentence (max 120 chars) describing what changed and why it matters. Write in active voice, past tense. Omit JIRA jargon. Use null if the ticket has insufficient information.
- "isBreakingChange": true if this change requires action from users/integrators (API changes, config format changes, removed features, required migrations). false otherwise.

OUTPUT FORMAT: Respond ONLY with a valid JSON array. No markdown, no prose, no wrapper object.

Example output:
[
  {
    "key": "PROJ-123",
    "moduleLabel": "Authentication",
    "keywords": ["login", "sso", "oauth"],
    "rewrittenDescription": "Users can now sign in using corporate SSO providers, reducing password fatigue.",
    "isBreakingChange": false
  }
]

STYLE GUIDE EXCERPT is provided in the user message. Follow its tone and terminology conventions."#;

/// Char-boundary–safe string truncation.
pub fn truncate_chars(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((byte_pos, _)) => &s[..byte_pos],
        None => s,
    }
}

/// Build the system prompt string and user messages for an enrichment AI call.
///
/// Returns `(system_prompt, messages)`.
pub fn build_enrichment_messages(
    tickets: &[ReleaseNoteTicket],
    style_guide: &str,
) -> (String, Vec<super::types::AiMessage>) {
    let tickets_json = serde_json::to_string_pretty(tickets)
        .unwrap_or_else(|_| "[]".to_string());

    let guide_excerpt = truncate_chars(style_guide, 2000);

    let user_content = format!(
        "STYLE GUIDE EXCERPT:\n{}\n\n---\n\nTICKETS TO ENRICH (JSON array):\n{}",
        guide_excerpt, tickets_json
    );

    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_content,
    }];

    (ENRICHMENT_SYSTEM_PROMPT.to_string(), messages)
}

/// Parse the AI enrichment response into a vec of EnrichedTicket.
///
/// Strips markdown fences, then deserialises the JSON array.
pub fn parse_enrichment_response(raw: &str) -> HadronResult<Vec<EnrichedTicket>> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let preview = truncate_chars(raw, 400);
        HadronError::Parse(format!(
            "Failed to parse enrichment JSON array: {e}. Preview: {preview}"
        ))
    })
}

// ============================================================================
// 6. Generation prompt
// ============================================================================

pub const GENERATION_SYSTEM_PROMPT: &str = concat!(
    "You are a senior technical writer producing customer-facing release notes.\n",
    "\n",
    "You will receive a list of enriched JIRA tickets and a content type instruction.\n",
    "\n",
    "OUTPUT FORMAT: Respond with formatted Markdown ONLY. No JSON, no prose outside Markdown.\n",
    "\n",
    "STRUCTURE RULES by content type:\n",
    "- \"features\": Write an engaging introduction paragraph, then a detailed section for each feature with heading, description, and user benefit. End with a brief conclusion.\n",
    "- \"fixes\": Produce a Markdown table with columns: Module | Ticket | Summary | Impact. One row per fix. Mark breaking changes with [BREAKING] prefix in the Summary column.\n",
    "- \"both\": Two top-level sections: \"## New Features\" (same as features format) and \"## Bug Fixes & Improvements\" (same as fixes table format).\n",
    "\n",
    "WRITING RULES:\n",
    "- Address the reader as \"you\" (second person).\n",
    "- Use active voice and present tense for features, past tense for fixes.\n",
    "- Keep each description to 1-2 sentences. Be specific -- avoid filler phrases like \"various improvements\".\n",
    "- For breaking changes, add a \"> **Breaking change:**\" blockquote immediately after the description.\n",
    "- Group features by moduleLabel when available.\n",
    "- Do not include ticket keys in customer-facing text unless the style guide says otherwise.\n",
    "\n",
    "TONE: Follow the tone and terminology conventions from the style guide provided in the user message."
);

/// Build the system prompt and user messages for a generation AI call.
///
/// Returns `(system_prompt, messages)`.
pub fn build_generation_messages(
    tickets: &[ReleaseNoteTicket],
    content_type: &ContentType,
    style_guide: &str,
) -> (String, Vec<super::types::AiMessage>) {
    let guide_excerpt = truncate_chars(style_guide, 2000);

    // Build a compact ticket list for the prompt.
    let ticket_lines: Vec<String> = tickets
        .iter()
        .map(|t| {
            let breaking_tag = if t.is_breaking_change == Some(true) {
                " [BREAKING]"
            } else {
                ""
            };
            let module = t
                .module_label
                .as_deref()
                .unwrap_or("Uncategorised");
            let desc = t
                .rewritten_description
                .as_deref()
                .or(t.description.as_deref())
                .unwrap_or(&t.summary);
            let desc_truncated = truncate_chars(desc, 200);
            format!(
                "- [{}] {} | {} | {}{}",
                t.key, module, t.issue_type, desc_truncated, breaking_tag
            )
        })
        .collect();

    let user_content = format!(
        "CONTENT TYPE: {}\n\nSTYLE GUIDE EXCERPT:\n{}\n\n---\n\n{} TICKETS:\n{}",
        content_type,
        guide_excerpt,
        tickets.len(),
        ticket_lines.join("\n")
    );

    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_content,
    }];

    (GENERATION_SYSTEM_PROMPT.to_string(), messages)
}

// ============================================================================
// 7. Compliance Types
// ============================================================================

// ── Compliance Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceReport {
    #[serde(default)]
    pub terminology_violations: Vec<TerminologyViolation>,
    #[serde(default)]
    pub structure_violations: Vec<StructureViolation>,
    #[serde(default)]
    pub screenshot_suggestions: Vec<ScreenshotSuggestion>,
    #[serde(default)]
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyViolation {
    #[serde(default)]
    pub term: String,
    #[serde(default)]
    pub correct_term: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StructureViolation {
    #[serde(default)]
    pub rule: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSuggestion {
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub reason: String,
}

// ============================================================================
// 8. Default checklist
// ============================================================================

pub const DEFAULT_CHECKLIST_ITEMS: &[&str] = &[
    "Title is concise and searchable",
    "Correctly labelled as feature or bug fix",
    "Base fix version correctly entered",
    "Base ticket linked (both sides for Cloud)",
    "Keywords entered (including UPGRADE if needed)",
    "Administration checkbox set if applicable",
    "WHATS'ON module entered",
    "In the appropriate epic",
    "Features adapted into sentences in epic",
    "Purpose of feature/fix is clear",
    "Screenshots use deployed images (not DEV)",
    "Correct WHATS'ON terminology used",
];

// ============================================================================
// 9. Compliance prompt, builder, parser
// ============================================================================

pub const COMPLIANCE_SYSTEM_PROMPT: &str = r#"You are a release notes style guide auditor. Given a release notes draft and a style guide, check compliance and return ONLY valid JSON:

{
  "terminologyViolations": [
    { "term": "wrong term", "correctTerm": "correct term", "context": "surrounding text", "suggestion": "fix description" }
  ],
  "structureViolations": [
    { "rule": "rule violated", "description": "what is wrong", "location": "where", "suggestion": "how to fix" }
  ],
  "screenshotSuggestions": [
    { "location": "where to insert", "description": "what to screenshot", "reason": "why" }
  ],
  "score": 85
}

Scoring: Start at 100. Terminology violation: -3 each. Structure violation: -5 each. Screenshots don't affect score. Minimum 0."#;

pub fn build_compliance_messages(
    markdown: &str,
    style_guide: &str,
) -> (String, Vec<super::types::AiMessage>) {
    let system = format!("{}\n\n=== STYLE GUIDE ===\n{}", COMPLIANCE_SYSTEM_PROMPT, style_guide);
    let user_content = format!("Audit the following release notes draft:\n\n{}", truncate_chars(markdown, 50000));
    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_content,
    }];
    (system, messages)
}

pub fn parse_compliance_response(raw: &str) -> HadronResult<ComplianceReport> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let preview = &json_str[..json_str.len().min(300)];
        HadronError::Parse(format!("Failed to parse compliance response: {e}. Preview: {preview}"))
    })
}

// ============================================================================
// 10. Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------

    fn make_ticket(
        key: &str,
        summary: &str,
        module: Option<&str>,
        breaking: Option<bool>,
    ) -> ReleaseNoteTicket {
        ReleaseNoteTicket {
            key: key.to_string(),
            summary: summary.to_string(),
            module_label: module.map(|s| s.to_string()),
            is_breaking_change: breaking,
            issue_type: "Bug".to_string(),
            ..Default::default()
        }
    }

    // -------------------------------------------------------------------------
    // Insights tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_compute_insights_full_coverage() {
        // 3 tickets all classified, 1 breaking → coverage 100%, score = 80 + 10 = 90
        let tickets = vec![
            make_ticket("PROJ-1", "Feature A", Some("Auth"), None),
            make_ticket("PROJ-2", "Feature B", Some("API"), Some(true)),
            make_ticket("PROJ-3", "Fix C", Some("UI"), Some(false)),
        ];
        let insights = compute_insights(&tickets);
        assert_eq!(insights.ticket_coverage, 1.0);
        assert_eq!(insights.breaking_changes, vec!["PROJ-2"]);
        assert_eq!(insights.quality_score, 90.0);
        assert_eq!(*insights.module_breakdown.get("Auth").unwrap(), 1);
        assert_eq!(*insights.module_breakdown.get("API").unwrap(), 1);
    }

    #[test]
    fn test_compute_insights_partial_coverage() {
        // 2 tickets, 1 classified → 50% coverage → score = 0.5 * 80 + 20 = 60
        let tickets = vec![
            make_ticket("PROJ-1", "Feature A", Some("Auth"), None),
            make_ticket("PROJ-2", "Feature B", None, None),
        ];
        let insights = compute_insights(&tickets);
        assert_eq!(insights.ticket_coverage, 0.5);
        assert!(!insights.suggestions.is_empty());
        // Score: 40 + 20 = 60
        assert_eq!(insights.quality_score, 60.0);
    }

    #[test]
    fn test_compute_insights_empty() {
        let insights = compute_insights(&[]);
        assert_eq!(insights.quality_score, 0.0);
        assert!(insights.module_breakdown.is_empty());
        assert!(insights.breaking_changes.is_empty());
        assert_eq!(insights.ticket_coverage, 0.0);
    }

    // -------------------------------------------------------------------------
    // Type tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_content_type_serialization() {
        let features: ContentType =
            serde_json::from_str("\"features\"").unwrap();
        assert_eq!(features, ContentType::Features);

        let both: ContentType = serde_json::from_str("\"both\"").unwrap();
        assert_eq!(both, ContentType::Both);

        let serialised = serde_json::to_string(&ContentType::Both).unwrap();
        assert_eq!(serialised, "\"both\"");
    }

    #[test]
    fn test_default_enrichment_config() {
        let cfg = AiEnrichmentConfig::default();
        assert!(cfg.rewrite_descriptions);
        assert!(cfg.generate_keywords);
        assert!(cfg.classify_modules);
        assert!(cfg.detect_breaking_changes);
    }

    #[test]
    fn test_default_style_guide_not_empty() {
        assert!(
            DEFAULT_STYLE_GUIDE.len() > 1000,
            "Style guide should be > 1000 chars, got {}",
            DEFAULT_STYLE_GUIDE.len()
        );
    }

    // -------------------------------------------------------------------------
    // Enrichment prompt tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_build_enrichment_prompt() {
        let tickets = vec![make_ticket("ABC-1", "Fix login", Some("Auth"), None)];
        let (system, messages) =
            build_enrichment_messages(&tickets, DEFAULT_STYLE_GUIDE);
        assert!(!system.is_empty());
        let user_msg = &messages[0].content;
        assert!(user_msg.contains("ABC-1"), "User message should contain ticket key");
        assert!(
            user_msg.len() > 100,
            "User message should reference style guide content"
        );
    }

    #[test]
    fn test_parse_enrichment_response() {
        let raw = r#"[{"key":"PROJ-1","moduleLabel":"Auth","keywords":["login","sso"],"rewrittenDescription":"Users can now log in via SSO.","isBreakingChange":false}]"#;
        let result = parse_enrichment_response(raw).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].key, "PROJ-1");
        assert_eq!(result[0].module_label.as_deref(), Some("Auth"));
        assert_eq!(result[0].is_breaking_change, Some(false));
        let kw = result[0].keywords.as_ref().unwrap();
        assert_eq!(kw.len(), 2);
    }

    #[test]
    fn test_parse_enrichment_defaults() {
        // Minimal JSON — optional fields should default.
        let raw = r#"[{"key":"PROJ-2"}]"#;
        let result = parse_enrichment_response(raw).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].key, "PROJ-2");
        assert!(result[0].module_label.is_none());
        assert!(result[0].keywords.is_none());
        assert!(result[0].rewritten_description.is_none());
        assert!(result[0].is_breaking_change.is_none());
    }

    #[test]
    fn test_parse_enrichment_with_fences() {
        let raw = "```json\n[{\"key\":\"PROJ-3\",\"moduleLabel\":\"UI\"}]\n```";
        let result = parse_enrichment_response(raw).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].module_label.as_deref(), Some("UI"));
    }

    // -------------------------------------------------------------------------
    // Generation prompt tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_build_generation_prompt_features() {
        let tickets = vec![make_ticket("F-1", "New dashboard", Some("UI"), None)];
        let (system, _messages) =
            build_generation_messages(&tickets, &ContentType::Features, DEFAULT_STYLE_GUIDE);
        assert!(
            system.contains("features"),
            "System prompt should describe features format"
        );
    }

    #[test]
    fn test_build_generation_prompt_fixes() {
        // A breaking change ticket should appear with [BREAKING] in the user message.
        let tickets = vec![
            make_ticket("BUG-1", "Remove legacy API", Some("API"), Some(true)),
        ];
        let (_system, messages) =
            build_generation_messages(&tickets, &ContentType::Fixes, DEFAULT_STYLE_GUIDE);
        let user_msg = &messages[0].content;
        assert!(
            user_msg.contains("[BREAKING]"),
            "User message should tag breaking change tickets"
        );
    }

    #[test]
    fn test_build_generation_prompt_both() {
        let tickets = vec![
            make_ticket("F-1", "Feature X", Some("Core"), None),
            make_ticket("B-1", "Fix Y", Some("Auth"), None),
            make_ticket("B-2", "Fix Z", None, None),
        ];
        let (_system, messages) =
            build_generation_messages(&tickets, &ContentType::Both, DEFAULT_STYLE_GUIDE);
        let user_msg = &messages[0].content;
        // The user message should reference the total ticket count (3).
        assert!(
            user_msg.contains("3 TICKETS"),
            "User message should contain ticket count, got: {}",
            &user_msg[..200.min(user_msg.len())]
        );
    }

    // -------------------------------------------------------------------------
    // Compliance prompt tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_build_compliance_prompt() {
        let (system, messages) = build_compliance_messages("## Release Notes\nContent here", "Test guide");
        assert!(system.contains("style guide auditor"));
        assert!(system.contains("Test guide"));
        assert_eq!(messages.len(), 1);
        assert!(messages[0].content.contains("Release Notes"));
    }

    #[test]
    fn test_parse_compliance_response() {
        let json = r#"{
            "terminologyViolations": [
                { "term": "customers", "correctTerm": "users", "context": "for our customers", "suggestion": "Replace with users" }
            ],
            "structureViolations": [
                { "rule": "Fix format", "description": "Missing Previously", "location": "Line 5", "suggestion": "Start with Previously" }
            ],
            "screenshotSuggestions": [
                { "location": "After section 2", "description": "New dialog", "reason": "UI change" }
            ],
            "score": 82.0
        }"#;
        let report = parse_compliance_response(json).unwrap();
        assert_eq!(report.terminology_violations.len(), 1);
        assert_eq!(report.terminology_violations[0].term, "customers");
        assert_eq!(report.structure_violations.len(), 1);
        assert_eq!(report.screenshot_suggestions.len(), 1);
        assert!((report.score - 82.0).abs() < 0.1);
    }

    #[test]
    fn test_parse_compliance_defaults() {
        let json = r#"{"score": 100}"#;
        let report = parse_compliance_response(json).unwrap();
        assert!(report.terminology_violations.is_empty());
        assert!(report.structure_violations.is_empty());
        assert!((report.score - 100.0).abs() < 0.1);
    }

    #[test]
    fn test_default_checklist_items() {
        assert_eq!(DEFAULT_CHECKLIST_ITEMS.len(), 12);
        for item in DEFAULT_CHECKLIST_ITEMS {
            assert!(!item.is_empty());
        }
    }
}
