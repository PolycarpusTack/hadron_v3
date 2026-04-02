//! Admin JIRA poller management + user project subscription routes.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::Role;

use super::AppError;

// ============================================================================
// Admin: Poller Config
// ============================================================================

/// GET /api/admin/jira-poller — get config + running status.
pub async fn get_poller_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    let status = crate::jira_poller::get_poller_status(&state.db, &state.poller).await;
    Ok(Json(status))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePollerRequest {
    pub enabled: Option<bool>,
    pub jql_filter: Option<String>,
    pub interval_mins: Option<i32>,
    pub jira_base_url: Option<String>,
    pub jira_email: Option<String>,
    pub jira_api_token: Option<String>,
}

/// PUT /api/admin/jira-poller — update config.
pub async fn update_poller_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<UpdatePollerRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    // Encrypt API token if provided
    let encrypted_token = match req.jira_api_token.as_deref() {
        Some(token) if !token.is_empty() => Some(crate::crypto::encrypt_value(token)?),
        _ => None,
    };

    db::update_poller_config(
        &state.db,
        req.enabled,
        req.jql_filter.as_deref(),
        req.interval_mins,
        req.jira_base_url.as_deref(),
        req.jira_email.as_deref(),
        encrypted_token.as_deref(),
        user.user.id,
    )
    .await?;

    // Audit log
    let _ = db::write_audit_log(
        &state.db,
        user.user.id,
        "admin.jira_poller_config_updated",
        "jira_poller_config",
        None,
        &serde_json::json!({
            "enabled": req.enabled,
            "jql_changed": req.jql_filter.is_some(),
            "token_changed": req.jira_api_token.is_some(),
        }),
        None,
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/admin/jira-poller/start — start the poller.
pub async fn start_poller(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    crate::jira_poller::start_poller(state.db.clone(), &state.poller).await;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/admin/jira-poller/stop — stop the poller.
pub async fn stop_poller(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    crate::jira_poller::stop_poller(&state.poller).await;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// User: Project Subscriptions
// ============================================================================

/// GET /api/jira/subscriptions — get user's subscribed project keys.
pub async fn get_subscriptions(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let keys = db::get_user_subscriptions(&state.db, user.user.id).await?;
    Ok(Json(keys))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSubscriptionsRequest {
    pub project_keys: Vec<String>,
}

/// PUT /api/jira/subscriptions — set user's subscribed project keys.
pub async fn set_subscriptions(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<SetSubscriptionsRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Sanitize keys: uppercase, alphanumeric + dash only, max 20 chars
    let sanitized: Vec<String> = req
        .project_keys
        .iter()
        .map(|k| {
            k.chars()
                .filter(|c| c.is_alphanumeric() || *c == '-')
                .take(20)
                .collect::<String>()
                .to_uppercase()
        })
        .filter(|k| !k.is_empty())
        .collect();

    db::set_user_subscriptions(&state.db, user.user.id, &sanitized).await?;

    Ok(Json(sanitized))
}
