use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ============================================================================
// User & Auth Models
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Analyst,
    Lead,
    Admin,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Analyst => "analyst",
            Role::Lead => "lead",
            Role::Admin => "admin",
        }
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for Role {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "analyst" => Ok(Role::Analyst),
            "lead" => Ok(Role::Lead),
            "admin" => Ok(Role::Admin),
            other => Err(format!("unknown role: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: Uuid,
    pub azure_oid: String,
    pub email: String,
    pub display_name: String,
    pub role: Role,
    pub team_id: Option<Uuid>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

/// Minimal user info returned by `/api/me`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub role: Role,
    pub team_name: Option<String>,
}

// ============================================================================
// Analysis Models
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub id: i64,
    pub user_id: Uuid,
    pub filename: String,
    pub file_size_kb: Option<f64>,
    pub error_type: Option<String>,
    pub error_message: Option<String>,
    pub severity: Option<String>,
    pub component: Option<String>,
    pub stack_trace: Option<String>,
    pub root_cause: Option<String>,
    pub suggested_fixes: Option<serde_json::Value>,
    pub confidence: Option<String>,
    pub ai_model: Option<String>,
    pub ai_provider: Option<String>,
    pub tokens_used: Option<i64>,
    pub cost: Option<f64>,
    pub analysis_duration_ms: Option<i64>,
    pub is_favorite: bool,
    pub view_count: i32,
    pub error_signature: Option<String>,
    pub full_data: Option<serde_json::Value>,
    pub analyzed_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSummary {
    pub id: i64,
    pub filename: String,
    pub error_type: Option<String>,
    pub severity: Option<String>,
    pub component: Option<String>,
    pub confidence: Option<String>,
    pub is_favorite: bool,
    pub analyzed_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub content: String,
    pub filename: Option<String>,
    pub api_key: String,
    pub model: String,
    pub provider: Option<String>,
    pub analysis_mode: Option<String>,
    pub use_rag: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResponse {
    pub id: i64,
    pub error_type: Option<String>,
    pub error_message: Option<String>,
    pub severity: Option<String>,
    pub root_cause: Option<String>,
    pub suggested_fixes: Option<serde_json::Value>,
    pub confidence: Option<String>,
    pub component: Option<String>,
    pub tokens_used: Option<i64>,
    pub cost: Option<f64>,
    pub duration_ms: Option<i64>,
}

/// Analysis summary that includes the analyst's name (for team/admin views).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamAnalysisSummary {
    pub id: i64,
    pub filename: String,
    pub error_type: Option<String>,
    pub severity: Option<String>,
    pub component: Option<String>,
    pub confidence: Option<String>,
    pub is_favorite: bool,
    pub analyzed_at: DateTime<Utc>,
    pub analyst_name: String,
}

// ============================================================================
// Chat Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub user_id: Uuid,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub session_id: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub api_key: String,
    pub use_rag: Option<bool>,
}

/// SSE event types for streaming chat.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatStreamEvent {
    Token { content: String },
    ToolUse { tool_name: String, args: String },
    ToolResult { tool_name: String, content: String },
    Done { session_id: String },
    Error { message: String },
}

// ============================================================================
// Settings Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    pub user_id: Uuid,
    pub settings: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// Pagination
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl PaginationParams {
    pub fn limit(&self) -> i64 {
        self.limit.unwrap_or(50).min(200)
    }

    pub fn offset(&self) -> i64 {
        self.offset.unwrap_or(0).max(0)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

// ============================================================================
// Audit Log
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub id: i64,
    pub user_id: Uuid,
    pub user_name: String,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub details: serde_json::Value,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// Signature Models (shared with hadron-core parser)
// ============================================================================

// ============================================================================
// Tag Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i32,
    pub name: String,
    pub color: Option<String>,
    pub usage_count: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagRequest {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagRequest {
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAnalysisTagsRequest {
    pub tag_ids: Vec<i32>,
}

// ============================================================================
// Note Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisNote {
    pub id: i64,
    pub analysis_id: i64,
    pub user_id: Uuid,
    pub user_name: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteRequest {
    pub content: String,
}

// ============================================================================
// Feedback Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisFeedback {
    pub id: i64,
    pub analysis_id: i64,
    pub user_id: Uuid,
    pub feedback_type: String,
    pub field_name: Option<String>,
    pub original_value: Option<String>,
    pub corrected_value: Option<String>,
    pub rating: Option<i16>,
    pub comment: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitFeedbackRequest {
    pub feedback_type: String,
    pub field_name: Option<String>,
    pub original_value: Option<String>,
    pub corrected_value: Option<String>,
    pub rating: Option<i16>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSummary {
    pub thumbs_up: i64,
    pub thumbs_down: i64,
    pub corrections: i64,
    pub average_rating: Option<f64>,
}

// ============================================================================
// Gold Standard Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldAnalysis {
    pub id: i64,
    pub analysis_id: i64,
    pub promoted_by: Uuid,
    pub verified_by: Option<Uuid>,
    pub verification_status: String,
    pub verification_notes: Option<String>,
    pub quality_score: Option<i16>,
    pub promoted_at: DateTime<Utc>,
    pub verified_at: Option<DateTime<Utc>>,
    // Joined fields
    pub filename: Option<String>,
    pub error_type: Option<String>,
    pub severity: Option<String>,
    pub promoter_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteToGoldRequest {
    pub quality_score: Option<i16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyGoldRequest {
    pub status: String,
    pub notes: Option<String>,
    pub quality_score: Option<i16>,
}

// ============================================================================
// Advanced Search Models
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSearchRequest {
    pub q: Option<String>,
    pub severity: Option<Vec<String>>,
    pub component: Option<Vec<String>>,
    pub tags: Option<Vec<i32>>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub is_favorite: Option<bool>,
    pub has_signature: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

// ============================================================================
// Analytics Models
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsDashboard {
    pub total_analyses: i64,
    pub this_week: i64,
    pub this_month: i64,
    pub severity_distribution: Vec<CountByField>,
    pub component_distribution: Vec<CountByField>,
    pub error_type_top: Vec<CountByField>,
    pub daily_trend: Vec<DailyCount>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountByField {
    pub label: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyCount {
    pub date: String,
    pub count: i64,
}

// ============================================================================
// Bulk Operations Models
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkRequest {
    pub ids: Vec<i64>,
    pub operation: String,
    pub tag_ids: Option<Vec<i32>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkResult {
    pub affected: i64,
}

// ============================================================================
// Export Models
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub format: String,
    pub audience: Option<String>,
}

// ============================================================================
// Pattern Matching Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternRule {
    pub id: String,
    pub name: String,
    pub pattern: String,
    pub pattern_type: String,
    pub severity: Option<String>,
    pub component: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternMatch {
    pub rule_id: String,
    pub rule_name: String,
    pub severity: Option<String>,
    pub component: Option<String>,
}

// ============================================================================
// Sentry Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentryConfig {
    pub base_url: String,
    pub auth_token: String,
    pub organization: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentryProject {
    pub id: String,
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentryIssue {
    pub id: String,
    pub title: String,
    pub culprit: Option<String>,
    pub level: String,
    pub count: String,
    pub first_seen: String,
    pub last_seen: String,
    pub status: String,
}

// ============================================================================
// Signature Models (shared with hadron-core parser)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashSignature {
    pub hash: String,
    pub canonical: String,
    pub components: SignatureComponents,
    pub first_seen: String,
    pub last_seen: String,
    pub occurrence_count: u32,
    pub linked_ticket: Option<String>,
    pub linked_ticket_url: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureComponents {
    pub exception_type: String,
    pub application_frames: Vec<String>,
    pub affected_module: Option<String>,
    pub database_backend: Option<String>,
}
