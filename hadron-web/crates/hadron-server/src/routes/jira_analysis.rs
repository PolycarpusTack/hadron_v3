//! JIRA deep analysis handlers — fetch ticket, analyze, stream.

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::ai;
use crate::auth::AuthenticatedUser;
use crate::integrations::jira::{self, JiraConfig};
use crate::sse;
use crate::AppState;

use super::AppError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCredentials {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchIssueRequest {
    pub credentials: JiraCredentials,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub credentials: JiraCredentials,
    pub api_key: Option<String>,
}

fn to_jira_config(creds: &JiraCredentials) -> JiraConfig {
    JiraConfig {
        base_url: creds.base_url.clone(),
        email: creds.email.clone(),
        api_token: creds.api_token.clone(),
        project_key: String::new(), // Not needed for single-issue fetch
    }
}

/// POST /api/jira/issues/{key}/detail — fetch full ticket detail.
pub async fn fetch_issue(
    _user: AuthenticatedUser,
    Path(key): Path<String>,
    Json(req): Json<FetchIssueRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = to_jira_config(&req.credentials);
    let detail = jira::fetch_issue_detail(&config, &key).await?;
    Ok(Json(detail))
}

/// POST /api/jira/issues/{key}/analyze — non-streaming deep analysis.
pub async fn analyze_issue(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = to_jira_config(&req.credentials);
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        None,
        None,
    )
    .await?;

    let (system_prompt, messages) = hadron_core::ai::build_jira_deep_messages(&ticket);

    let raw_response = ai::complete(&ai_config, messages, Some(&system_prompt)).await?;
    let result = hadron_core::ai::parse_jira_deep_analysis(&raw_response)?;

    Ok(Json(result))
}

/// POST /api/jira/issues/{key}/analyze/stream — SSE streaming deep analysis.
pub async fn analyze_issue_stream(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = to_jira_config(&req.credentials);
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        None,
        None,
    )
    .await?;

    let (system_prompt, messages) = hadron_core::ai::build_jira_deep_messages(&ticket);

    Ok(sse::stream_ai_completion(ai_config, messages, Some(system_prompt)))
}
