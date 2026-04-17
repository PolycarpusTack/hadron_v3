//! Serializable input/output types for every MCP tool.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Hard cap on any limit parameter to prevent resource exhaustion.
pub const MAX_LIMIT: usize = 100;

// ----- Ticket briefs --------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketBriefRecord {
    pub jira_key: String,
    pub summary: Option<String>,
    pub severity: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub customer_impact: Option<String>,
    pub brief_json: Option<serde_json::Value>,
    pub posted_to_jira_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarTicketRecord {
    pub jira_key: String,
    pub summary: Option<String>,
    pub severity: Option<String>,
    pub category: Option<String>,
    pub similarity: f32,
}

#[derive(Debug, Deserialize)]
pub struct SearchTicketBriefsInput {
    pub query: String,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

#[derive(Debug, Deserialize)]
pub struct GetTicketBriefInput {
    pub jira_key: String,
}

#[derive(Debug, Deserialize)]
pub struct FindSimilarTicketsInput {
    #[serde(default)]
    pub jira_key: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default = "default_threshold")]
    pub threshold: f32,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

// ----- Sentry ---------------------------------------------------------

/// Sentry analysis record. `id` is the database integer PK (not a UUID).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentryAnalysisRecord {
    pub id: i64,
    pub issue_id: Option<String>,
    pub title: Option<String>,
    pub patterns: Vec<String>,
    pub summary: Option<String>,
    pub created_at: DateTime<Utc>,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct SearchSentryInput {
    pub query: String,
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

#[derive(Debug, Deserialize)]
pub struct GetSentryAnalysisInput {
    pub analysis_id: i64,
}

// ----- Release notes --------------------------------------------------

/// Release note record. `id` is the database integer PK (not a UUID).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseNoteRecord {
    pub id: i64,
    pub fix_version: Option<String>,
    pub title: Option<String>,
    pub status: String,
    pub content_markdown: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListFixVersionsInput {
    pub project_key: String,
}

#[derive(Debug, Deserialize)]
pub struct GetReleaseNotesInput {
    #[serde(default)]
    pub fix_version: Option<String>,
    #[serde(default)]
    pub note_id: Option<i64>,
}

// ----- Hybrid search --------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct HybridSearchInput {
    pub query: String,
    #[serde(default = "default_sources")]
    pub sources: Vec<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

// ----- Defaults -------------------------------------------------------

fn default_limit() -> usize {
    10
}
fn default_threshold() -> f32 {
    0.65
}
fn default_sources() -> Vec<String> {
    vec![
        "briefs".to_string(),
        "sentry".to_string(),
        "release_notes".to_string(),
    ]
}
