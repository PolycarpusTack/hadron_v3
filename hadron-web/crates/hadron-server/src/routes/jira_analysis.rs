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

// ============================================================================
// Triage
// ============================================================================

/// POST /api/jira/issues/{key}/triage — fast triage classification.
pub async fn triage_issue(
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

    let (system_prompt, messages) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let raw_response = ai::complete(&ai_config, messages, Some(&system_prompt)).await?;
    let result = hadron_core::ai::parse_jira_triage(&raw_response)?;

    // Persist triage to DB
    let tags_json = serde_json::to_string(&result.tags).unwrap_or_default();
    let triage_json = serde_json::to_string(&result).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&result.severity),
        Some(&result.category),
        Some(&tags_json),
        Some(&triage_json),
        None, // brief_json stays as-is
    )
    .await;

    Ok(Json(result))
}

// ============================================================================
// Brief (triage + deep in parallel)
// ============================================================================

/// POST /api/jira/issues/{key}/brief — full investigation brief.
pub async fn generate_brief(
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

    // Run triage + deep analysis in parallel
    let (triage_sys, triage_msgs) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let (deep_sys, deep_msgs) = hadron_core::ai::build_jira_deep_messages(&ticket);

    let ai_config2 = ai_config.clone();
    let triage_fut = async {
        let raw = ai::complete(&ai_config, triage_msgs, Some(&triage_sys)).await?;
        hadron_core::ai::parse_jira_triage(&raw)
    };
    let deep_fut = async {
        let raw = ai::complete(&ai_config2, deep_msgs, Some(&deep_sys)).await?;
        hadron_core::ai::parse_jira_deep_analysis(&raw)
    };

    let (triage, analysis) = tokio::try_join!(triage_fut, deep_fut)
        .map_err(AppError)?;

    let brief_result = hadron_core::ai::JiraBriefResult {
        triage: triage.clone(),
        analysis,
    };

    // Persist to DB
    let tags_json = serde_json::to_string(&triage.tags).unwrap_or_default();
    let triage_json = serde_json::to_string(&triage).unwrap_or_default();
    let brief_json = serde_json::to_string(&brief_result).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&triage.severity),
        Some(&triage.category),
        Some(&tags_json),
        Some(&triage_json),
        Some(&brief_json),
    )
    .await;

    Ok(Json(brief_result))
}

/// POST /api/jira/issues/{key}/brief/stream — stream deep analysis, triage runs first.
pub async fn generate_brief_stream(
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

    // Run triage first (fast, ~2-3s)
    let (triage_sys, triage_msgs) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let triage_raw = ai::complete(&ai_config.clone(), triage_msgs, Some(&triage_sys)).await?;
    let triage = hadron_core::ai::parse_jira_triage(&triage_raw)?;

    // Persist triage immediately
    let tags_json = serde_json::to_string(&triage.tags).unwrap_or_default();
    let triage_json_str = serde_json::to_string(&triage).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&triage.severity),
        Some(&triage.category),
        Some(&tags_json),
        Some(&triage_json_str),
        None,
    )
    .await;

    // Stream deep analysis
    let (deep_sys, deep_msgs) = hadron_core::ai::build_jira_deep_messages(&ticket);
    Ok(sse::stream_ai_completion(ai_config, deep_msgs, Some(deep_sys)))
}

// ============================================================================
// Briefs CRUD (persisted data)
// ============================================================================

/// GET /api/jira/briefs/{key} — load persisted brief.
pub async fn get_brief(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let brief = crate::db::get_ticket_brief(&state.db, &key).await?;
    match brief {
        Some(b) => Ok(Json(serde_json::json!(b))),
        None => Err(AppError(hadron_core::error::HadronError::not_found(
            format!("No brief found for {key}"),
        ))),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchBriefsRequest {
    pub jira_keys: Vec<String>,
}

/// POST /api/jira/briefs/batch — load multiple briefs.
pub async fn get_briefs_batch(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<BatchBriefsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let briefs = crate::db::get_ticket_briefs_batch(&state.db, &req.jira_keys).await?;
    Ok(Json(briefs))
}

/// DELETE /api/jira/briefs/{key} — delete a brief.
pub async fn delete_brief(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    crate::db::delete_ticket_brief(&state.db, &key).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
