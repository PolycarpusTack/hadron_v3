//! API route definitions.
//!
//! Maps REST endpoints to handlers. Each feature area has its own module.

mod admin;
mod analyses;
mod analytics;
mod code_analysis;
mod chat;
mod export;
mod feedback;
mod gold;
mod integrations;
mod jira_analysis;
mod jira_poller;
mod notes;
mod patterns;
mod release_notes;
mod signatures;
mod tags;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware;
use crate::AppState;
use hadron_core::models::*;

/// Build the `/api` router.
pub fn api_router() -> Router<AppState> {
    Router::new()
        // Health
        .route("/health", get(middleware::health_check))
        .route("/health/live", get(middleware::liveness))
        // Auth
        .route("/me", get(get_me))
        // Analyses
        .route("/analyses", get(analyses::list_analyses))
        .route("/analyses/upload", post(analyses::upload_and_analyze))
        .route("/analyses/analyze", post(analyses::analyze_content))
        .route("/analyses/{id}", get(analyses::get_analysis))
        .route("/analyses/{id}", delete(analyses::delete_analysis))
        .route("/analyses/{id}/favorite", post(analyses::toggle_favorite))
        .route("/analyses/search", post(analyses::search_analyses))
        .route("/analyses/{id}/embed", post(analyses::embed_analysis))
        .route("/analyses/{id}/similar", get(analyses::similar_analyses))
        // Archive & Restore
        .route("/analyses/archived", get(analyses::list_archived))
        .route("/analyses/{id}/restore", post(analyses::restore_analysis))
        .route("/analyses/{id}/permanent", delete(analyses::permanent_delete))
        // Advanced Search
        .route("/analyses/advanced-search", post(analyses::advanced_search))
        // Bulk Operations
        .route("/analyses/bulk", post(analyses::bulk_operation))
        // Export
        .route("/analyses/{id}/export", post(export::export_analysis))
        // Tags
        .route("/tags", get(tags::list_tags))
        .route("/tags", post(tags::create_tag))
        .route("/tags/{id}", put(tags::update_tag))
        .route("/tags/{id}", delete(tags::delete_tag))
        .route("/analyses/{id}/tags", get(tags::get_analysis_tags))
        .route("/analyses/{id}/tags", put(tags::set_analysis_tags))
        // Notes
        .route("/analyses/{id}/notes", get(notes::get_analysis_notes))
        .route("/analyses/{id}/notes", post(notes::create_note))
        .route("/notes/{id}", put(notes::update_note))
        .route("/notes/{id}", delete(notes::delete_note))
        // Signatures
        .route("/signatures", get(signatures::list_signatures))
        .route("/signatures/{hash}", get(signatures::get_signature))
        .route("/signatures/{hash}/analyses", get(signatures::get_signature_analyses))
        .route("/signatures/{hash}/status", put(signatures::update_signature_status))
        .route("/signatures/{hash}/ticket", put(signatures::link_signature_ticket))
        // Feedback
        .route("/analyses/{id}/feedback", post(feedback::submit_feedback))
        .route("/analyses/{id}/feedback", get(feedback::get_analysis_feedback))
        .route("/analyses/{id}/feedback/summary", get(feedback::get_feedback_summary))
        .route("/feedback/{id}", delete(feedback::delete_feedback))
        // Gold Standard
        .route("/analyses/{id}/gold", post(gold::promote_to_gold))
        .route("/analyses/{id}/gold", delete(gold::demote_gold))
        .route("/gold", get(gold::list_gold))
        .route("/gold/{id}/verify", post(gold::verify_gold))
        // Analytics
        .route("/analytics", get(analytics::get_analytics))
        .route("/analytics/team", get(analytics::get_team_analytics))
        .route("/analytics/global", get(analytics::get_global_analytics))
        // Chat
        .route("/chat/sessions", get(chat::list_chat_sessions))
        .route("/chat/sessions", post(chat::create_chat_session))
        .route("/chat/sessions/{id}/messages", get(chat::get_chat_messages))
        .route("/chat", post(chat::chat_send))
        // Settings
        .route("/settings", get(get_settings))
        .route("/settings", put(update_settings))
        // Team / Shared feeds (lead+)
        .route("/team/analyses", get(admin::team_analyses))
        // Release notes
        .route("/release-notes", get(release_notes::list_release_notes))
        .route("/release-notes", post(release_notes::create_release_note))
        .route("/release-notes/{id}", get(release_notes::get_release_note))
        .route("/release-notes/{id}", put(release_notes::update_release_note))
        .route("/release-notes/{id}", delete(release_notes::delete_release_note))
        .route("/release-notes/{id}/publish", post(release_notes::publish_release_note))
        // OpenSearch integration
        .route("/search/opensearch", post(integrations::opensearch_search))
        .route("/search/opensearch/test", post(integrations::opensearch_test))
        // Jira integration
        .route("/jira/tickets", post(integrations::jira_create_ticket))
        .route("/jira/search", post(integrations::jira_search))
        .route("/jira/test", post(integrations::jira_test))
        // JIRA Deep Analysis
        .route("/jira/issues/{key}/detail", post(jira_analysis::fetch_issue))
        .route("/jira/issues/{key}/analyze", post(jira_analysis::analyze_issue))
        .route("/jira/issues/{key}/analyze/stream", post(jira_analysis::analyze_issue_stream))
        // JIRA Triage & Brief
        .route("/jira/issues/{key}/triage", post(jira_analysis::triage_issue))
        .route("/jira/issues/{key}/brief", post(jira_analysis::generate_brief))
        .route("/jira/issues/{key}/brief/stream", post(jira_analysis::generate_brief_stream))
        // JIRA Briefs CRUD
        .route("/jira/briefs/{key}", get(jira_analysis::get_brief))
        .route("/jira/briefs/{key}", delete(jira_analysis::delete_brief))
        .route("/jira/briefs/batch", post(jira_analysis::get_briefs_batch))
        // JIRA Similar Tickets + Round-Trip
        .route("/jira/issues/{key}/similar", post(jira_analysis::find_similar_tickets))
        .route("/jira/issues/{key}/post-brief", post(jira_analysis::post_brief_to_jira))
        .route("/jira/briefs/{key}/feedback", put(jira_analysis::submit_feedback))
        // Sentry integration
        .route("/sentry/test", post(integrations::sentry_test))
        .route("/sentry/projects", get(integrations::sentry_projects))
        .route("/sentry/issues", get(integrations::sentry_issues))
        .route("/sentry/issues/{id}/event", get(integrations::sentry_event))
        // Code Analysis
        .route("/code-analysis", post(code_analysis::analyze_code))
        .route("/code-analysis/stream", post(code_analysis::analyze_code_stream))
        // Patterns (Admin)
        .route("/admin/patterns", get(patterns::list_patterns))
        .route("/admin/patterns", post(patterns::create_pattern))
        .route("/admin/patterns/{id}", put(patterns::update_pattern))
        .route("/admin/patterns/{id}", delete(patterns::delete_pattern))
        .route("/admin/patterns/test", post(patterns::test_patterns))
        // Admin: training data export
        .route("/admin/export/training-data", get(admin::export_training_data))
        // Admin
        .route("/admin/users", get(admin::admin_list_users))
        .route("/admin/users/{id}/role", put(admin::admin_update_role))
        .route("/admin/analyses", get(admin::admin_all_analyses))
        .route("/admin/audit-log", get(admin::admin_audit_log))
        // Admin: AI configuration
        .route("/admin/ai-config", get(admin::get_ai_config))
        .route("/admin/ai-config", put(admin::update_ai_config))
        .route("/admin/ai-config/test", post(admin::test_ai_config))
        // Admin: JIRA Poller
        .route("/admin/jira-poller", get(jira_poller::get_poller_config))
        .route("/admin/jira-poller", put(jira_poller::update_poller_config))
        .route("/admin/jira-poller/start", post(jira_poller::start_poller))
        .route("/admin/jira-poller/stop", post(jira_poller::stop_poller))
        // User: JIRA Subscriptions
        .route("/jira/subscriptions", get(jira_poller::get_subscriptions))
        .route("/jira/subscriptions", put(jira_poller::set_subscriptions))
}

// ============================================================================
// Auth handler
// ============================================================================

async fn get_me(user: AuthenticatedUser) -> impl IntoResponse {
    Json(UserProfile {
        id: user.user.id,
        email: user.user.email.clone(),
        display_name: user.user.display_name.clone(),
        role: user.user.role,
        team_name: None,
    })
}

// ============================================================================
// Settings handlers
// ============================================================================

async fn get_settings(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let settings = db::get_user_settings(&state.db, user.user.id).await?;
    Ok(Json(settings))
}

async fn update_settings(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(settings): Json<serde_json::Value>,
) -> Result<impl IntoResponse, AppError> {
    db::update_user_settings(&state.db, user.user.id, &settings).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Error conversion — maps HadronError to HTTP responses
// ============================================================================

pub(crate) struct AppError(pub hadron_core::error::HadronError);

impl From<hadron_core::error::HadronError> for AppError {
    fn from(err: hadron_core::error::HadronError) -> Self {
        Self(err)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        use hadron_core::error::HadronError;

        let status = match &self.0 {
            HadronError::NotFound(_) => StatusCode::NOT_FOUND,
            HadronError::Conflict(_) => StatusCode::CONFLICT,
            HadronError::Unauthenticated => StatusCode::UNAUTHORIZED,
            HadronError::Forbidden(_) => StatusCode::FORBIDDEN,
            HadronError::Validation(_) | HadronError::InvalidFormat(_) => {
                StatusCode::BAD_REQUEST
            }
            HadronError::FileTooLarge { .. } => StatusCode::PAYLOAD_TOO_LARGE,
            HadronError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            HadronError::Timeout(_) => StatusCode::GATEWAY_TIMEOUT,
            HadronError::Http(_) | HadronError::Jira(_) | HadronError::AiService(_) => {
                StatusCode::BAD_GATEWAY
            }
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let body = serde_json::json!({
            "error": self.0.client_message(),
            "code": self.0.error_code(),
        });

        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = %self.0, "Internal server error");
        }

        (status, Json(body)).into_response()
    }
}

impl From<(StatusCode, Json<middleware::RbacError>)> for AppError {
    fn from((_status, body): (StatusCode, Json<middleware::RbacError>)) -> Self {
        Self(hadron_core::error::HadronError::Forbidden(
            body.0.error.clone(),
        ))
    }
}
