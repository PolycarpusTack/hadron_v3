//! Release Notes Generator Service
//!
//! Three-stage pipeline: Extract tickets from JIRA → Transform with AI → Deliver as Markdown/Confluence/HTML.
//! Uses the consolidated WHATS'ON style guide for formatting consistency.

use crate::str_utils::floor_char_boundary;

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::ai_service;
use crate::database::{Database, InsertReleaseNotes};
use crate::jira_service;

// ============================================================================
// Style Guide (embedded at compile time)
// ============================================================================

const STYLE_GUIDE: &str = include_str!("style_guides/whatson_release_notes.md");

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesConfig {
    pub fix_version: String,
    pub content_type: ContentType,
    pub project_key: Option<String>,
    pub jql_filter: Option<String>,
    pub module_filter: Option<Vec<String>>,
    pub ai_enrichment: AiEnrichmentConfig,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Features,
    Fixes,
    Both,
}

impl ContentType {
    pub fn as_str(&self) -> &str {
        match self {
            ContentType::Features => "features",
            ContentType::Fixes => "fixes",
            ContentType::Both => "both",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEnrichmentConfig {
    pub rewrite_descriptions: bool,
    pub generate_keywords: bool,
    pub classify_modules: bool,
    pub detect_breaking_changes: bool,
}

impl Default for AiEnrichmentConfig {
    fn default() -> Self {
        Self {
            rewrite_descriptions: true,
            generate_keywords: true,
            classify_modules: true,
            detect_breaking_changes: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNoteTicket {
    pub key: String,
    pub summary: String,
    pub description: Option<String>,
    pub issue_type: String,
    pub priority: String,
    pub status: String,
    pub components: Vec<String>,
    pub labels: Vec<String>,
    // AI-enriched fields
    pub module_label: Option<String>,
    pub keywords: Option<Vec<String>>,
    pub rewritten_description: Option<String>,
    pub is_breaking_change: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesResult {
    pub id: i64,
    pub title: String,
    pub markdown_content: String,
    pub ticket_count: i32,
    pub ticket_keys: Vec<String>,
    pub ai_insights: Option<AiInsights>,
    pub tokens_used: i32,
    pub cost: f64,
    pub generation_duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInsights {
    pub quality_score: f64,
    pub suggestions: Vec<String>,
    pub module_breakdown: std::collections::HashMap<String, i32>,
    pub ticket_coverage: f64,
    pub breaking_changes: Vec<String>,
}

// ============================================================================
// Style Compliance
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceReport {
    pub terminology_violations: Vec<TerminologyViolation>,
    pub structure_violations: Vec<StructureViolation>,
    pub screenshot_suggestions: Vec<ScreenshotSuggestion>,
    pub score: f64,
    pub tokens_used: i32,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyViolation {
    pub line_context: String,
    pub violation: String,
    pub suggested_fix: String,
    pub rule_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureViolation {
    pub section: String,
    pub violation: String,
    pub suggested_fix: String,
    pub rule_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSuggestion {
    pub ticket_key: String,
    pub description: String,
    pub placement_hint: String,
    pub inline_placeholder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseNotesPhase {
    FetchingTickets,
    ClassifyingTickets,
    EnrichingContent,
    GeneratingDraft,
    ApplyingStyleGuide,
    ComputingInsights,
    Saving,
    Complete,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub phase: ReleaseNotesPhase,
    pub progress: f64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

// ============================================================================
// Progress Emission
// ============================================================================
//
// Debounced to avoid saturating the WebView2 COM boundary. Each non-terminal
// emit is dropped if it lands within `PROGRESS_DEBOUNCE_MS` of the previous
// one; terminal phases (Complete, Failed) are always emitted so the UI never
// gets stuck on an intermediate state. This mirrors the pattern in
// `commands/common/helpers.rs::emit_progress` and keeps the combined IPC
// rate under the threshold that destabilises ESET's hook.

// Debounce interval now lives in `crate::stability::progress_debounce_ms()`
// so the toggle propagates to this service too.
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static LAST_RN_EMIT_MS: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

fn now_ms_rn() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn emit_progress_with_request(
    app: &AppHandle,
    phase: ReleaseNotesPhase,
    progress: f64,
    message: &str,
    request_id: Option<&str>,
) {
    let is_terminal = matches!(
        phase,
        ReleaseNotesPhase::Complete | ReleaseNotesPhase::Failed
    );

    if !is_terminal {
        let now = now_ms_rn();
        let prev = LAST_RN_EMIT_MS.load(Ordering::Relaxed);
        // Debounce is dynamic — stability mode widens it from 150ms to 1s.
        if now.saturating_sub(prev) < crate::stability::progress_debounce_ms() {
            return; // skip — too soon since last emit
        }
        LAST_RN_EMIT_MS.store(now, Ordering::Relaxed);
    }

    crate::breadcrumbs::record(
        "emit",
        format!("release-notes-progress phase={:?} pct={:.0}", phase, progress * 100.0),
    );
    let event = ProgressEvent {
        phase,
        progress,
        message: message.to_string(),
        request_id: request_id.map(|id| id.to_string()),
    };
    let _ = app.emit("release-notes-progress", &event);
}

// ============================================================================
// Stage 1: Extract — Fetch Tickets from JIRA
// ============================================================================

pub async fn fetch_tickets_for_release(
    config: &ReleaseNotesConfig,
    base_url: &str,
    email: &str,
    api_token: &str,
) -> Result<Vec<ReleaseNoteTicket>, String> {
    let project_key = config
        .project_key
        .as_deref()
        .filter(|k| !k.trim().is_empty())
        .unwrap_or("MGXPRODUCT");

    let all_issues = if let Some(ref custom_jql) = config.jql_filter {
        log::info!("Fetching JIRA tickets with custom JQL: {}", custom_jql);
        fetch_issues_by_jql(base_url, email, api_token, custom_jql).await?
    } else {
        // Import all tickets for the selected fixVersion.
        // We intentionally do NOT filter by issue type or status here;
        // triage/selection can happen later in the workflow.
        let default_jql = format!(
            "project = \"{}\" AND fixVersion = \"{}\"",
            escape_jql_string(project_key),
            escape_jql_string(&config.fix_version)
        );
        log::info!(
            "Fetching JIRA tickets with unfiltered default JQL: {}",
            default_jql
        );
        fetch_issues_by_jql(base_url, email, api_token, &default_jql).await?
    };

    let mut tickets: Vec<ReleaseNoteTicket> = all_issues
        .into_iter()
        .map(|issue| {
            let description = issue
                .fields
                .description
                .as_ref()
                .and_then(|d| extract_text_from_adf(d));

            ReleaseNoteTicket {
                key: issue.key,
                summary: issue.fields.summary,
                description,
                issue_type: issue.fields.issuetype.name,
                priority: issue
                    .fields
                    .priority
                    .map(|p| p.name)
                    .unwrap_or_else(|| "Medium".to_string()),
                status: issue.fields.status.name,
                components: issue.fields.components.into_iter().map(|c| c.name).collect(),
                labels: issue.fields.labels,
                module_label: None,
                keywords: None,
                rewritten_description: None,
                is_breaking_change: None,
            }
        })
        .collect();

    // Apply module filter if provided
    if let Some(ref modules) = config.module_filter {
        if !modules.is_empty() {
            tickets.retain(|t| {
                t.components.iter().any(|c| modules.contains(c))
                    || t.labels.iter().any(|l| modules.contains(l))
            });
        }
    }

    log::info!("Fetched {} tickets for release", tickets.len());
    Ok(tickets)
}

async fn fetch_issues_by_jql(
    base_url: &str,
    email: &str,
    api_token: &str,
    jql: &str,
) -> Result<Vec<jira_service::JiraSearchIssue>, String> {
    let page_size = 100;
    let mut all_issues = Vec::new();
    let mut next_page_token: Option<String> = None;
    let mut page_count_total = 0;

    loop {
        let page = jira_service::search_jira_issues_page_cursor(
            base_url.to_string(),
            email.to_string(),
            api_token.to_string(),
            jql.to_string(),
            next_page_token.clone(),
            page_size,
            false,
        )
        .await?;

        let page_count = page.issues.len();
        all_issues.extend(page.issues);
        page_count_total += page_count;

        // Guardrail to avoid unexpectedly large pulls.
        if page_count_total >= 5000 {
            log::warn!(
                "Release notes ticket fetch hit pagination guardrail at {} issues",
                page_count_total
            );
            break;
        }

        // Use cursor-based pagination: stop when no nextPageToken or empty page
        match page.next_page_token {
            Some(token) if !token.is_empty() && page_count > 0 => {
                next_page_token = Some(token);
            }
            _ => break,
        }
    }

    Ok(all_issues)
}

/// Escape special characters in JQL string literals to prevent injection.
fn escape_jql_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Extract plain text from Atlassian Document Format (ADF) JSON
fn extract_text_from_adf(value: &serde_json::Value) -> Option<String> {
    let mut text = String::new();
    extract_text_recursive(value, &mut text);
    if text.trim().is_empty() {
        None
    } else {
        Some(text.trim().to_string())
    }
}

fn extract_text_recursive(value: &serde_json::Value, output: &mut String) {
    match value {
        serde_json::Value::Object(obj) => {
            if let Some(serde_json::Value::String(t)) = obj.get("text") {
                output.push_str(t);
            }
            if let Some(serde_json::Value::Array(content)) = obj.get("content") {
                for item in content {
                    extract_text_recursive(item, output);
                }
                // Add paragraph break after block elements
                if let Some(serde_json::Value::String(node_type)) = obj.get("type") {
                    if node_type == "paragraph" || node_type == "heading" {
                        output.push('\n');
                    }
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                extract_text_recursive(item, output);
            }
        }
        _ => {}
    }
}

// ============================================================================
// Stage 2: Transform — AI Classification & Enrichment
// ============================================================================

pub async fn classify_and_enrich_batch(
    tickets: &mut Vec<ReleaseNoteTicket>,
    api_key: &str,
    model: &str,
    provider: &str,
    enrichment: &AiEnrichmentConfig,
    app: &AppHandle,
    request_id: Option<&str>,
) -> Result<(i32, f64), String> {
    if tickets.is_empty() {
        return Ok((0, 0.0));
    }

    let batch_size = 10;
    let total_batches = (tickets.len() + batch_size - 1) / batch_size;
    let mut total_tokens = 0i32;
    let mut total_cost = 0.0f64;

    for (batch_idx, chunk) in tickets.chunks_mut(batch_size).enumerate() {
        let progress = 15.0 + (batch_idx as f64 / total_batches as f64) * 35.0;
        emit_progress_with_request(
            app,
            ReleaseNotesPhase::ClassifyingTickets,
            progress,
            &format!("Enriching batch {}/{}", batch_idx + 1, total_batches),
            request_id,
        );

        let system_prompt = build_enrichment_system_prompt(enrichment);
        let user_prompt = build_enrichment_user_prompt(chunk);

        let request_body = build_ai_request(provider, &system_prompt, &user_prompt, model, 4000);
        let response = ai_service::call_provider_raw_json(provider, request_body, api_key).await?;

        let (content, tokens, cost) = match extract_ai_response(provider, &response) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Empty AI response for enrichment batch {}: {}", batch_idx, e);
                continue;
            }
        };
        total_tokens += tokens;
        total_cost += cost;

        // Parse enrichment results and apply to tickets
        if let Ok(enrichments) = serde_json::from_str::<Vec<TicketEnrichment>>(&content) {
            for enrichment_result in enrichments {
                if let Some(ticket) = chunk
                    .iter_mut()
                    .find(|t| t.key == enrichment_result.key)
                {
                    ticket.module_label = enrichment_result.module_label;
                    ticket.keywords = enrichment_result.keywords;
                    ticket.rewritten_description = enrichment_result.rewritten_description;
                    ticket.is_breaking_change = enrichment_result.is_breaking_change;
                }
            }
        } else {
            log::warn!(
                "Failed to parse enrichment response for batch {}, applying raw content",
                batch_idx
            );
        }
    }

    Ok((total_tokens, total_cost))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TicketEnrichment {
    key: String,
    module_label: Option<String>,
    keywords: Option<Vec<String>>,
    rewritten_description: Option<String>,
    is_breaking_change: Option<bool>,
}

fn build_enrichment_system_prompt(config: &AiEnrichmentConfig) -> String {
    let mut prompt = String::from(
        "You are a release notes assistant for WHATS'ON broadcast management software.\n\
         You classify and enrich JIRA tickets for release notes generation.\n\n\
         Return a JSON array of objects with the same `key` as each input ticket.\n\n",
    );

    if config.classify_modules {
        prompt.push_str(
            "## Module Classification\n\
             Assign each ticket a `moduleLabel` from the official module list.\n\
             Use the module label that best matches the ticket's components and description.\n\n",
        );
    }

    if config.generate_keywords {
        prompt.push_str(
            "## Keyword Generation\n\
             Generate 2-4 `keywords` per ticket. Use plural concept names (e.g., 'contracts', 'transmissions').\n\
             Include 'upgrade' if the change affects upgrade behavior.\n\n",
        );
    }

    if config.rewrite_descriptions {
        prompt.push_str(
            "## Description Rewriting\n\
             Provide a `rewrittenDescription` that follows the style guide:\n\
             - For bugs: Start with 'Previously, ...' and end with 'This issue has been fixed in this version.'\n\
             - For features: Start with 'It is now possible to...' or 'Users can now...'\n\
             - Use proper English, active voice, British English spelling\n\
             - Use correct WHATS'ON terminology\n\n",
        );
    }

    if config.detect_breaking_changes {
        prompt.push_str(
            "## Breaking Change Detection\n\
             Set `isBreakingChange` to true if the ticket changes pre-upgrade behavior.\n\n",
        );
    }

    prompt.push_str("Return ONLY valid JSON. No markdown fences.");
    prompt
}

fn build_enrichment_user_prompt(tickets: &[ReleaseNoteTicket]) -> String {
    let ticket_data: Vec<serde_json::Value> = tickets
        .iter()
        .map(|t| {
            json!({
                "key": t.key,
                "summary": t.summary,
                "description": t.description,
                "issueType": t.issue_type,
                "components": t.components,
                "labels": t.labels,
            })
        })
        .collect();

    format!(
        "Classify and enrich these JIRA tickets:\n\n{}",
        serde_json::to_string_pretty(&ticket_data).unwrap_or_default()
    )
}

// ============================================================================
// Stage 2b: Generate Release Notes Markdown
// ============================================================================

pub async fn generate_release_notes_markdown(
    tickets: &[ReleaseNoteTicket],
    config: &ReleaseNotesConfig,
    api_key: &str,
    model: &str,
    provider: &str,
) -> Result<(String, i32, f64), String> {
    let system_prompt = build_generation_system_prompt(config);
    let user_prompt = build_generation_user_prompt(tickets, config);

    let request_body = build_ai_request_freeform(provider, &system_prompt, &user_prompt, model, 8000);
    let response = ai_service::call_provider_raw_json(provider, request_body, api_key).await?;

    let (content, tokens, cost) = extract_ai_response(provider, &response)?;
    Ok((content, tokens, cost))
}

fn build_generation_system_prompt(config: &ReleaseNotesConfig) -> String {
    let format_instruction = match config.content_type {
        ContentType::Features => {
            "Generate release notes for NEW FEATURES only.\n\
             Structure each feature with: Introduction, Detail, Conclusion.\n\
             Vary opening phrases ('It is now possible to...', 'Users can now...', 'From now on...')."
        }
        ContentType::Fixes => {
            "Generate release notes for FIXES only.\n\
             Use the Simplified Table format:\n\
             | Issue Key | Description | Module | Keywords |\n\
             Each description starts with 'Previously, ...' and ends with 'This issue has been fixed in this version.'"
        }
        ContentType::Both => {
            "Generate release notes with TWO sections:\n\
             ## New Features\n\
             Structure each feature with: Introduction, Detail, Conclusion.\n\n\
             ## Fixed Issues\n\
             Use the Simplified Table format:\n\
             | Issue Key | Description | Module | Keywords |"
        }
    };

    format!(
        "You are a technical writer generating WHATS'ON release notes for version {}.\n\
         Follow this style guide EXACTLY:\n\n{}\n\n---\n\n## Output Instructions\n\n{}\n\n\
         IMPORTANT RULES:\n\
         - Use British English\n\
         - Use correct WHATS'ON UI terminology (see style guide section 1)\n\
         - Never abbreviate WHATS'ON\n\
         - Use bold for on-screen text, active voice, present tense\n\
         - Include ticket references in brackets at the end: (MGXPRODUCT-XXXXX)\n\
         - Output as Markdown",
        config.fix_version, STYLE_GUIDE, format_instruction
    )
}

fn build_generation_user_prompt(
    tickets: &[ReleaseNoteTicket],
    config: &ReleaseNotesConfig,
) -> String {
    let mut prompt = format!(
        "Generate release notes for {} version {}.\n\n## Tickets:\n\n",
        match config.content_type {
            ContentType::Features => "new features in",
            ContentType::Fixes => "fixed issues in",
            ContentType::Both => "",
        },
        config.fix_version
    );

    for ticket in tickets {
        prompt.push_str(&format!("### {} — {}\n", ticket.key, ticket.summary));
        prompt.push_str(&format!("- Type: {}\n", ticket.issue_type));
        prompt.push_str(&format!("- Priority: {}\n", ticket.priority));
        if !ticket.components.is_empty() {
            prompt.push_str(&format!("- Components: {}\n", ticket.components.join(", ")));
        }
        if let Some(ref module) = ticket.module_label {
            prompt.push_str(&format!("- Module: {}\n", module));
        }
        if let Some(ref keywords) = ticket.keywords {
            if !keywords.is_empty() {
                prompt.push_str(&format!("- Keywords: {}\n", keywords.join(", ")));
            }
        }
        if let Some(ref desc) = ticket.rewritten_description {
            let truncated = if desc.len() > 500 { &desc[..floor_char_boundary(desc, 500)] } else { desc.as_str() };
            prompt.push_str(&format!("- Description (enriched): {}\n", truncated));
        } else if let Some(ref desc) = ticket.description {
            let truncated = if desc.len() > 500 { &desc[..floor_char_boundary(desc, 500)] } else { desc.as_str() };
            prompt.push_str(&format!("- Description: {}\n", truncated));
        }
        if ticket.is_breaking_change == Some(true) {
            prompt.push_str("- **BREAKING CHANGE**\n");
        }
        prompt.push('\n');
    }

    // Cap total prompt size to ~128K tokens (~512KB).
    // Beyond this, AI providers will reject the request.
    const MAX_PROMPT_BYTES: usize = 512_000;
    if prompt.len() > MAX_PROMPT_BYTES {
        log::warn!(
            "Release notes prompt truncated from {} to {} bytes ({} tickets)",
            prompt.len(), MAX_PROMPT_BYTES, tickets.len()
        );
        prompt.truncate(floor_char_boundary(&prompt, MAX_PROMPT_BYTES));
    }

    prompt
}

// ============================================================================
// Stage 3: Post-Generation Analysis
// ============================================================================

pub fn compute_ai_insights(
    tickets: &[ReleaseNoteTicket],
    _markdown: &str,
) -> AiInsights {
    let mut module_breakdown = std::collections::HashMap::new();
    let mut breaking_changes = Vec::new();

    for ticket in tickets {
        if let Some(ref module) = ticket.module_label {
            *module_breakdown.entry(module.clone()).or_insert(0) += 1;
        } else {
            *module_breakdown.entry("Unclassified".to_string()).or_insert(0) += 1;
        }

        if ticket.is_breaking_change == Some(true) {
            breaking_changes.push(format!("{}: {}", ticket.key, ticket.summary));
        }
    }

    let classified = tickets
        .iter()
        .filter(|t| t.module_label.is_some())
        .count();
    let coverage = if tickets.is_empty() {
        0.0
    } else {
        classified as f64 / tickets.len() as f64
    };

    let mut suggestions = Vec::new();
    if coverage < 0.9 {
        suggestions.push(format!(
            "{} tickets lack module classification — review manually",
            tickets.len() - classified
        ));
    }
    if !breaking_changes.is_empty() {
        suggestions.push(format!(
            "{} breaking changes detected — ensure UPGRADE keyword is present",
            breaking_changes.len()
        ));
    }

    let quality_score = (coverage * 80.0) + if breaking_changes.is_empty() { 20.0 } else { 10.0 };

    AiInsights {
        quality_score: quality_score.min(100.0),
        suggestions,
        module_breakdown,
        ticket_coverage: coverage,
        breaking_changes,
    }
}

// ============================================================================
// Style Compliance Check
// ============================================================================

pub async fn check_compliance(
    markdown: &str,
    api_key: &str,
    model: &str,
    provider: &str,
) -> Result<ComplianceReport, String> {
    let system_prompt = r#"You are a WHATS'ON release notes style auditor. You enforce the company's release notes style guide with precision.

Given a draft and the full style guide, analyze the draft and return a JSON object with exactly these fields:

1. "terminologyViolations" — array of objects with: lineContext, violation, suggestedFix, ruleReference. Check wrong UI terms against Section 1 terminology table, abbreviations, "customers" vs "users", incorrect capitalization, passive voice, quotes around UI text instead of bold, etc.

2. "structureViolations" — array of objects with: section, violation, suggestedFix, ruleReference. Check: features missing Introduction/Detail/Conclusion structure, fixes not starting with "Previously,...", missing ticket references in brackets, titles with colons or quotes, content not ending with "This issue has been fixed in this version." for fixes, etc.

3. "screenshotSuggestions" — array of objects with: ticketKey, description, placementHint, inlinePlaceholder. Identify places where a screenshot would help readers understand a UI change, new dialog, new column, new button, layout change, etc. The inlinePlaceholder should be formatted as [SCREENSHOT: brief description of what to capture].

4. "score" — number 0-100 reflecting overall style guide compliance. 100 = perfect compliance. Deduct points per violation: terminology -3, structure -5, missing screenshots don't affect score.

Be thorough but concise. For each violation, provide just enough context to identify and fix it. Return ONLY valid JSON. No markdown fences."#;

    let user_prompt = format!(
        "## Style Guide:\n\n{}\n\n---\n\n## Draft to Review:\n\n{}",
        STYLE_GUIDE, markdown
    );

    let request_body = build_ai_request(provider, system_prompt, &user_prompt, model, 6000);
    let response = ai_service::call_provider_raw_json(provider, request_body, api_key).await?;

    let (content, tokens, cost) = extract_ai_response(provider, &response)?;

    let mut report: ComplianceReport = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse compliance report: {}. Raw: {}", e, &content[..floor_char_boundary(&content, 200)]))?;

    report.tokens_used = tokens;
    report.cost = cost;

    Ok(report)
}

// ============================================================================
// Incremental Append
// ============================================================================

pub async fn apply_incremental_update(
    existing_md: &str,
    new_tickets: &[ReleaseNoteTicket],
    _existing_keys: &[String],
    config: &ReleaseNotesConfig,
    api_key: &str,
    model: &str,
    provider: &str,
) -> Result<(String, i32, f64), String> {
    // Generate content only for new tickets
    let (new_content, tokens, cost) =
        generate_release_notes_markdown(new_tickets, config, api_key, model, provider).await?;

    // Append to existing content
    let combined = format!(
        "{}\n\n<!-- Incremental update: {} new tickets -->\n\n{}",
        existing_md,
        new_tickets.len(),
        new_content
    );

    Ok((combined, tokens, cost))
}

// ============================================================================
// Export Formats
// ============================================================================

/// Convert markdown to Confluence wiki markup
pub fn markdown_to_confluence(markdown: &str) -> String {
    let mut output = String::with_capacity(markdown.len());
    let lines: Vec<&str> = markdown.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Headings: ## → h2.
        if let Some(rest) = trimmed.strip_prefix("######") {
            output.push_str(&format!("h6. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("#####") {
            output.push_str(&format!("h5. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("####") {
            output.push_str(&format!("h4. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("###") {
            output.push_str(&format!("h3. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("##") {
            output.push_str(&format!("h2. {}\n", rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix('#') {
            output.push_str(&format!("h1. {}\n", rest.trim()));
        }
        // Table header separators (skip --- lines)
        else if trimmed.starts_with('|') && trimmed.contains("---") {
            continue;
        }
        // Table rows
        else if trimmed.starts_with('|') {
            // Determine if this is a header row: next line is a separator (|---|)
            let is_header = lines.get(i + 1)
                .map(|next| next.trim().starts_with('|') && next.contains("---"))
                .unwrap_or(false);

            if is_header {
                let converted = trimmed
                    .replace("**", "")
                    .replace("| ", "|| ")
                    .replace(" |", " ||");
                output.push_str(&converted);
            } else {
                output.push_str(trimmed);
            }
            output.push('\n');
        }
        // Bold: **text** → *text*
        else if trimmed.contains("**") {
            let converted = line.replace("**", "*");
            output.push_str(&converted);
            output.push('\n');
        }
        // Bullet points: - → *
        else if let Some(rest) = trimmed.strip_prefix("- ") {
            output.push_str(&format!("* {}\n", rest));
        }
        // Code blocks
        else if trimmed == "```" {
            output.push_str("{code}\n");
        } else if trimmed.starts_with("```") {
            let lang = trimmed.strip_prefix("```").unwrap_or("");
            output.push_str(&format!("{{code:language={}}}\n", lang));
        } else {
            output.push_str(line);
            output.push('\n');
        }
    }

    output
}

/// Convert markdown to basic HTML
pub fn markdown_to_html(markdown: &str) -> String {
    let mut html = String::from(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">\n\
         <style>body{font-family:system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;line-height:1.6}\n\
         table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}\n\
         th{background:#f5f5f5}h1,h2,h3{margin-top:1.5em}</style>\n</head><body>\n",
    );

    let mut in_table = false;
    let mut in_list = false;
    let mut header_row_seen = false;

    for line in markdown.lines() {
        let trimmed = line.trim();

        // Table handling
        if trimmed.starts_with('|') && trimmed.contains("---") {
            continue; // skip separator
        }

        if trimmed.starts_with('|') {
            if !in_table {
                html.push_str("<table>\n");
                in_table = true;
                header_row_seen = false;
            }

            let cells: Vec<&str> = trimmed
                .split('|')
                .filter(|s| !s.trim().is_empty())
                .collect();

            if !header_row_seen {
                html.push_str("<thead><tr>");
                for cell in &cells {
                    html.push_str(&format!("<th>{}</th>", html_escape(&cell.trim().replace("**", ""))));
                }
                html.push_str("</tr></thead>\n<tbody>\n");
                header_row_seen = true;
            } else {
                html.push_str("<tr>");
                for cell in &cells {
                    let content = apply_inline_formatting(cell.trim());
                    html.push_str(&format!("<td>{}</td>", content));
                }
                html.push_str("</tr>\n");
            }
            continue;
        }

        if in_table {
            html.push_str("</tbody></table>\n");
            in_table = false;
        }

        // List handling
        if let Some(rest) = trimmed.strip_prefix("- ") {
            if !in_list {
                html.push_str("<ul>\n");
                in_list = true;
            }
            html.push_str(&format!("<li>{}</li>\n", apply_inline_formatting(rest)));
            continue;
        }

        if in_list {
            html.push_str("</ul>\n");
            in_list = false;
        }

        // Headings
        if let Some(rest) = trimmed.strip_prefix("### ") {
            html.push_str(&format!("<h3>{}</h3>\n", html_escape(rest)));
        } else if let Some(rest) = trimmed.strip_prefix("## ") {
            html.push_str(&format!("<h2>{}</h2>\n", html_escape(rest)));
        } else if let Some(rest) = trimmed.strip_prefix("# ") {
            html.push_str(&format!("<h1>{}</h1>\n", html_escape(rest)));
        } else if trimmed.is_empty() {
            html.push('\n');
        } else {
            html.push_str(&format!("<p>{}</p>\n", apply_inline_formatting(trimmed)));
        }
    }

    if in_table {
        html.push_str("</tbody></table>\n");
    }
    if in_list {
        html.push_str("</ul>\n");
    }

    html.push_str("</body></html>");
    html
}

/// Escape HTML entities to prevent XSS when inserting user content into HTML.
fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn apply_inline_formatting(text: &str) -> String {
    // First escape HTML entities, then apply formatting
    let escaped = html_escape(text);
    let mut result = escaped;
    // Bold: **text** → <strong>text</strong>
    while let Some(start) = result.find("**") {
        if let Some(end) = result[start + 2..].find("**") {
            let inner = &result[start + 2..start + 2 + end].to_string();
            result = format!(
                "{}<strong>{}</strong>{}",
                &result[..start],
                inner,
                &result[start + 2 + end + 2..]
            );
        } else {
            break;
        }
    }
    result
}

// ============================================================================
// Full Pipeline
// ============================================================================

pub async fn run_full_pipeline(
    config: ReleaseNotesConfig,
    base_url: &str,
    email: &str,
    api_token: &str,
    api_key: &str,
    model: &str,
    provider: &str,
    db: &Database,
    app: &AppHandle,
    request_id: Option<&str>,
) -> Result<ReleaseNotesResult, String> {
    let result = run_full_pipeline_inner(
        config, base_url, email, api_token, api_key, model, provider, db, app, request_id,
    )
    .await;

    if let Err(ref e) = result {
        emit_progress_with_request(app, ReleaseNotesPhase::Failed, 0.0, e, request_id);
    }

    result
}

async fn run_full_pipeline_inner(
    config: ReleaseNotesConfig,
    base_url: &str,
    email: &str,
    api_token: &str,
    api_key: &str,
    model: &str,
    provider: &str,
    db: &Database,
    app: &AppHandle,
    request_id: Option<&str>,
) -> Result<ReleaseNotesResult, String> {
    let start = Instant::now();
    let mut total_tokens = 0i32;
    let mut total_cost = 0.0f64;

    // Phase 1: Fetch tickets
    emit_progress_with_request(
        app,
        ReleaseNotesPhase::FetchingTickets,
        5.0,
        "Fetching JIRA tickets...",
        request_id,
    );
    let mut tickets = fetch_tickets_for_release(&config, base_url, email, api_token).await?;

    if tickets.is_empty() {
        return Err("No tickets found matching the filter criteria.".to_string());
    }

    emit_progress_with_request(
        app,
        ReleaseNotesPhase::FetchingTickets,
        15.0,
        &format!("Found {} tickets", tickets.len()),
        request_id,
    );

    // Phase 2: Classify & Enrich
    emit_progress_with_request(
        app,
        ReleaseNotesPhase::ClassifyingTickets,
        20.0,
        "Classifying tickets with AI...",
        request_id,
    );
    let (enrich_tokens, enrich_cost) = classify_and_enrich_batch(
        &mut tickets,
        api_key,
        model,
        provider,
        &config.ai_enrichment,
        app,
        request_id,
    )
    .await?;
    total_tokens += enrich_tokens;
    total_cost += enrich_cost;

    // Phase 3: Generate markdown
    emit_progress_with_request(
        app,
        ReleaseNotesPhase::GeneratingDraft,
        55.0,
        "Generating release notes draft...",
        request_id,
    );
    let (markdown, gen_tokens, gen_cost) =
        generate_release_notes_markdown(&tickets, &config, api_key, model, provider).await?;
    total_tokens += gen_tokens;
    total_cost += gen_cost;

    emit_progress_with_request(
        app,
        ReleaseNotesPhase::ApplyingStyleGuide,
        80.0,
        "Applying style guide...",
        request_id,
    );

    // Phase 4: Compute insights
    emit_progress_with_request(
        app,
        ReleaseNotesPhase::ComputingInsights,
        88.0,
        "Computing quality insights...",
        request_id,
    );
    let insights = compute_ai_insights(&tickets, &markdown);

    // Phase 5: Save to database
    emit_progress_with_request(
        app,
        ReleaseNotesPhase::Saving,
        95.0,
        "Saving release notes draft...",
        request_id,
    );

    let ticket_keys: Vec<String> = tickets.iter().map(|t| t.key.clone()).collect();
    let title = format!(
        "Release Notes — {} ({})",
        config.fix_version,
        config.content_type.as_str()
    );

    let duration_ms = start.elapsed().as_millis() as i32;

    let draft = InsertReleaseNotes {
        fix_version: config.fix_version.clone(),
        content_type: config.content_type.as_str().to_string(),
        title: title.clone(),
        markdown_content: markdown.clone(),
        original_ai_content: Some(markdown.clone()),
        ticket_keys: serde_json::to_string(&ticket_keys).unwrap_or_else(|_| "[]".to_string()),
        ticket_count: tickets.len() as i32,
        jql_filter: config.jql_filter.clone(),
        module_filter: config
            .module_filter
            .as_ref()
            .and_then(|m| serde_json::to_string(m).ok()),
        ai_model: model.to_string(),
        ai_provider: provider.to_string(),
        tokens_used: total_tokens,
        cost: total_cost,
        generation_duration_ms: Some(duration_ms),
        ai_insights: serde_json::to_string(&insights).ok(),
    };

    let id = db
        .insert_release_notes(&draft)
        .map_err(|e| format!("Failed to save release notes: {}", e))?;

    emit_progress_with_request(
        app,
        ReleaseNotesPhase::Complete,
        100.0,
        "Release notes generated successfully!",
        request_id,
    );

    Ok(ReleaseNotesResult {
        id,
        title,
        markdown_content: markdown,
        ticket_count: tickets.len() as i32,
        ticket_keys,
        ai_insights: Some(insights),
        tokens_used: total_tokens,
        cost: total_cost,
        generation_duration_ms: start.elapsed().as_millis() as i64,
    })
}

// ============================================================================
// AI Request Helpers
// ============================================================================

fn build_ai_request(
    provider: &str,
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
    max_tokens: u32,
) -> serde_json::Value {
    build_ai_request_inner(provider, system_prompt, user_prompt, model, max_tokens, true)
}

fn build_ai_request_freeform(
    provider: &str,
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
    max_tokens: u32,
) -> serde_json::Value {
    build_ai_request_inner(provider, system_prompt, user_prompt, model, max_tokens, false)
}

fn build_ai_request_inner(
    provider: &str,
    system_prompt: &str,
    user_prompt: &str,
    model: &str,
    max_tokens: u32,
    json_mode: bool,
) -> serde_json::Value {
    match provider {
        "anthropic" => json!({
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "system": system_prompt,
            "messages": [
                {"role": "user", "content": user_prompt}
            ]
        }),
        _ => {
            let is_gpt5 = model.starts_with("gpt-5") || model.starts_with("o1") || model.starts_with("o3");
            let mut body = json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.1
            });
            if json_mode {
                body["response_format"] = json!({"type": "json_object"});
            }
            if is_gpt5 {
                body["max_completion_tokens"] = json!(max_tokens);
            } else {
                body["max_tokens"] = json!(max_tokens);
            }
            body
        }
    }
}

fn extract_ai_response(provider: &str, response: &serde_json::Value) -> Result<(String, i32, f64), String> {
    let content = match provider {
        "anthropic" => response["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        _ => response["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string(),
    };

    if content.trim().is_empty() {
        let raw = serde_json::to_string(response).unwrap_or_default();
        return Err(format!(
            "AI provider returned empty response. Raw: {}",
            &raw[..floor_char_boundary(&raw, 300)]
        ));
    }

    let tokens = match provider {
        "anthropic" => {
            let input = response["usage"]["input_tokens"].as_i64().unwrap_or(0);
            let output = response["usage"]["output_tokens"].as_i64().unwrap_or(0);
            (input + output) as i32
        }
        _ => response["usage"]["total_tokens"].as_i64().unwrap_or(0) as i32,
    };

    // Rough cost estimate
    let cost = tokens as f64 * 0.00001;

    Ok((content, tokens, cost))
}
