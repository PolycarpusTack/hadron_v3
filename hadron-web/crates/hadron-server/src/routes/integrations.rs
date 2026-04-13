//! Integration handlers — OpenSearch, Jira, and Sentry.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::integrations::{jira, opensearch, sentry};
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::{Role, SentryConfig};

use super::AppError;

// ============================================================================
// OpenSearch
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSearchRequest {
    url: String,
    username: Option<String>,
    password: Option<String>,
    index: String,
    query: String,
    size: Option<u32>,
    from: Option<u32>,
}

pub async fn opensearch_search(
    _user: AuthenticatedUser,
    Json(req): Json<OpenSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = opensearch::OpenSearchConfig {
        url: req.url,
        username: req.username,
        password: req.password,
        index_pattern: req.index.clone(),
        tls_skip_verify: false,
    };

    let query = opensearch::build_text_query(&req.query);
    let result =
        opensearch::search(&config, &req.index, &query, req.size.unwrap_or(20), req.from.unwrap_or(0))
            .await?;

    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSearchTestRequest {
    url: String,
    username: Option<String>,
    password: Option<String>,
}

pub async fn opensearch_test(
    user: AuthenticatedUser,
    Json(req): Json<OpenSearchTestRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    let config = opensearch::OpenSearchConfig {
        url: req.url,
        username: req.username,
        password: req.password,
        index_pattern: "*".to_string(),
        tls_skip_verify: false,
    };

    let ok = opensearch::test_connection(&config).await?;
    Ok(Json(serde_json::json!({ "connected": ok })))
}

// ============================================================================
// Jira
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCredentials {
    base_url: String,
    email: String,
    api_token: String,
    project_key: String,
}

pub async fn jira_create_ticket(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<JiraCreateRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;

    let config = jira::JiraConfig {
        base_url: req.credentials.base_url,
        email: req.credentials.email,
        api_token: req.credentials.api_token,
        project_key: req.credentials.project_key,
    };

    let ticket_req = jira::CreateTicketRequest {
        config_id: None,
        summary: req.summary,
        description: req.description,
        priority: req.priority,
        labels: req.labels,
        issue_type: req.issue_type,
        analysis_id: req.analysis_id,
    };

    let result = jira::create_ticket(&config, &ticket_req).await?;

    // Audit log
    let _ = db::write_audit_log(
        &state.db,
        user.user.id,
        "jira.create_ticket",
        "jira_ticket",
        Some(&result.key),
        &serde_json::json!({ "analysis_id": req.analysis_id }),
        None,
    )
    .await;

    Ok((StatusCode::CREATED, Json(result)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCreateRequest {
    credentials: JiraCredentials,
    summary: String,
    description: String,
    priority: Option<String>,
    labels: Option<Vec<String>>,
    issue_type: Option<String>,
    analysis_id: Option<i64>,
}

pub async fn jira_search(
    _user: AuthenticatedUser,
    Json(req): Json<JiraSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = jira::JiraConfig {
        base_url: req.credentials.base_url,
        email: req.credentials.email,
        api_token: req.credentials.api_token,
        project_key: req.credentials.project_key,
    };

    let result = jira::search_issues(
        &config,
        req.jql.as_deref(),
        req.text.as_deref(),
        req.max_results.unwrap_or(20),
    )
    .await?;

    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSearchRequest {
    credentials: JiraCredentials,
    jql: Option<String>,
    text: Option<String>,
    max_results: Option<u32>,
}

pub async fn jira_test(
    user: AuthenticatedUser,
    Json(req): Json<JiraTestRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    let config = jira::JiraConfig {
        base_url: req.base_url,
        email: req.email,
        api_token: req.api_token,
        project_key: String::new(),
    };

    let ok = jira::test_connection(&config).await?;
    Ok(Json(serde_json::json!({ "connected": ok })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraTestRequest {
    base_url: String,
    email: String,
    api_token: String,
}

pub async fn jira_fix_versions(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let mut config = crate::db::get_jira_config_from_poller(&state.db)
        .await
        .map_err(AppError)?;
    config.project_key = project.clone();
    let versions = jira::list_fix_versions(&config, &project)
        .await
        .map_err(AppError)?;
    Ok(Json(versions))
}

// ============================================================================
// Sentry
// ============================================================================

pub async fn sentry_test(
    user: AuthenticatedUser,
    Json(config): Json<SentryConfig>,
) -> Result<impl IntoResponse, AppError> {
    crate::middleware::require_role(&user, hadron_core::models::Role::Lead)
        .map_err(|_| AppError(hadron_core::error::HadronError::forbidden("Only leads and admins can test Sentry connections.")))?;
    let ok = sentry::test_connection(&config)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(serde_json::json!({ "connected": ok })))
}

pub async fn sentry_projects(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::Validation(
                "Sentry is not configured. Ask an admin to configure it.".to_string(),
            ))
        })?;
    let projects = sentry::list_projects(&config)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(projects))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentryIssuesQuery {
    project: String,
    limit: Option<usize>,
}

pub async fn sentry_issues(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<SentryIssuesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::Validation(
                "Sentry is not configured. Ask an admin to configure it.".to_string(),
            ))
        })?;
    let issues = sentry::list_issues(&config, &params.project, params.limit.unwrap_or(25))
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(issues))
}

pub async fn sentry_issue(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::Validation(
                "Sentry is not configured. Ask an admin to configure it.".to_string(),
            ))
        })?;
    let issue = sentry::fetch_issue(&config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(issue))
}

pub async fn sentry_event(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::Validation(
                "Sentry is not configured. Ask an admin to configure it.".to_string(),
            ))
        })?;
    let event = sentry::fetch_latest_event(&config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(event))
}
