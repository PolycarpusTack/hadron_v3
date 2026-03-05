//! JIRA Assist — Investigation Brief (Sprint 3).
//!
//! Runs triage + deep analysis in parallel and combines the results
//! into a single `JiraBriefResult` that is persisted as `brief_json`.

use serde::{Deserialize, Serialize};
use crate::jira_triage::{JiraTriageRequest, JiraTriageResult};
use crate::jira_deep_analysis::{JiraDeepRequest, JiraDeepResult};

// ─── Input ───────────────────────────────────────────────────────────────────

/// Combined input for the investigation brief.
/// Contains all fields needed by both triage and deep analysis.
#[derive(Debug, Deserialize)]
pub struct JiraBriefRequest {
    pub jira_key: String,
    /// Ticket summary/title — maps to `title` in triage and `summary` in deep analysis.
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

/// Combined result: triage classification + deep technical analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraBriefResult {
    pub triage: JiraTriageResult,
    pub analysis: JiraDeepResult,
}

// ─── Core function ────────────────────────────────────────────────────────────

/// Run triage and deep analysis in parallel, then combine.
/// Both calls use the same provider/model/key from the request.
pub async fn run_jira_brief(req: JiraBriefRequest) -> Result<JiraBriefResult, String> {
    // Build both sub-requests from the combined input
    let triage_req = JiraTriageRequest {
        jira_key:    req.jira_key.clone(),
        title:       req.title.clone(),
        description: req.description.clone(),
        issue_type:  req.issue_type.clone(),
        priority:    req.priority.clone(),
        status:      req.status.clone(),
        components:  req.components.clone(),
        labels:      req.labels.clone(),
        comments:    req.comments.clone(),
        api_key:     req.api_key.clone(),
        model:       req.model.clone(),
        provider:    req.provider.clone(),
    };

    let deep_req = JiraDeepRequest {
        jira_key:    req.jira_key,
        summary:     req.title,           // JiraDeepRequest uses "summary" for what we call "title"
        description: req.description,
        issue_type:  req.issue_type,
        priority:    req.priority,
        status:      req.status,
        components:  req.components,
        labels:      req.labels,
        comments:    req.comments,
        api_key:     req.api_key,
        model:       req.model,
        provider:    req.provider,
    };

    // Run both AI calls in parallel
    let (triage, analysis) = tokio::try_join!(
        crate::jira_triage::run_jira_triage(triage_req),
        crate::jira_deep_analysis::run_jira_deep_analysis(deep_req),
    )?;

    Ok(JiraBriefResult { triage, analysis })
}
