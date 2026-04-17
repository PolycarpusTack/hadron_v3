//! Sentry analysis handlers — fetch issue, stream analysis, CRUD for saved analyses.

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::ai;
use crate::auth::AuthenticatedUser;
use crate::sse;
use crate::AppState;

use super::AppError;

// ============================================================================
// Query params
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentryAnalysesQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

// ============================================================================
// Streaming analysis
// ============================================================================

/// POST /api/sentry/issues/{id}/analyze/stream — SSE streaming analysis.
pub async fn analyze_issue_stream(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // Load server-side Sentry config
    let sentry_config = crate::db::get_sentry_config(&state.db)
        .await?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::validation(
                "Sentry is not configured. Ask an admin to configure the Sentry integration.",
            ))
        })?;

    // Load AI config from server settings
    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    // Fetch issue and latest event
    let issue_json = crate::integrations::sentry::fetch_issue(&sentry_config, &issue_id).await?;
    let event_json =
        crate::integrations::sentry::fetch_latest_event(&sentry_config, &issue_id).await?;

    // Normalize and detect patterns
    let issue: hadron_core::ai::SentryIssueDetail = match serde_json::from_value(issue_json) {
        Ok(i) => i,
        Err(e) => {
            tracing::warn!("Failed to deserialize Sentry issue, using defaults: {e}");
            hadron_core::ai::SentryIssueDetail::default()
        }
    };
    let event = hadron_core::ai::normalize_sentry_event(&event_json);
    let patterns = hadron_core::ai::detect_sentry_patterns(&issue, &event);

    // Build messages
    let (system_prompt, messages) =
        hadron_core::ai::build_sentry_analysis_messages(&issue, &event, &patterns);

    // Clone data needed in the spawned task for DB persistence
    let db_pool = state.db.clone();
    let user_id = user.user.id;
    let issue_for_persist = issue.clone();
    let event_for_persist = event.clone();
    let patterns_for_persist = patterns.clone();
    let ai_config_for_spawn = ai_config.clone();
    let system_prompt_for_spawn = system_prompt.clone();
    let messages_for_spawn = messages.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<hadron_core::models::ChatStreamEvent>(100);

    tokio::spawn(async move {
        let result = crate::ai::stream_completion(
            &ai_config_for_spawn,
            messages_for_spawn,
            Some(&system_prompt_for_spawn),
            tx.clone(),
        )
        .await;

        match result {
            Ok(full_text) => {
                // Persist to DB (best-effort, log failures instead of silently discarding).
                match hadron_core::ai::parse_sentry_analysis(&full_text) {
                    Ok(analysis_result) => {
                        let full_data = serde_json::json!({
                            "issue": issue_for_persist,
                            "event": event_for_persist,
                            "patterns": patterns_for_persist,
                            "aiResult": analysis_result,
                        });
                        let fixes_json =
                            serde_json::to_value(&analysis_result.suggested_fixes).ok();
                        let filename = if issue_for_persist.short_id.is_empty() {
                            format!("sentry-{}", issue_for_persist.id)
                        } else {
                            issue_for_persist.short_id.clone()
                        };
                        match crate::db::insert_sentry_analysis(
                            &db_pool,
                            user_id,
                            &filename,
                            Some(&analysis_result.error_type),
                            Some(&analysis_result.error_message),
                            Some(&analysis_result.severity),
                            Some(&analysis_result.root_cause),
                            fixes_json.as_ref(),
                            Some(&analysis_result.confidence),
                            Some(&analysis_result.component),
                            Some(&full_data),
                        )
                        .await
                        {
                            Ok(inserted_id) => {
                                let embed_text = format!(
                                    "{} {}",
                                    analysis_result.error_type,
                                    analysis_result.root_cause,
                                )
                                .trim()
                                .to_string();
                                if !embed_text.is_empty() {
                                    crate::routes::search::spawn_embed_analysis(
                                        db_pool.clone(),
                                        inserted_id,
                                        embed_text,
                                    );
                                }
                            }
                            Err(e) => {
                                tracing::warn!("Failed to persist Sentry analysis: {e}");
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse Sentry analysis response: {e}");
                    }
                }
                let _ = tx
                    .send(hadron_core::models::ChatStreamEvent::Done {
                        session_id: String::new(),
                    })
                    .await;
            }
            Err(e) => {
                let _ = tx
                    .send(hadron_core::models::ChatStreamEvent::Error {
                        message: e.client_message(),
                    })
                    .await;
            }
        }
    });

    Ok(sse::stream_response(rx))
}

// ============================================================================
// Non-streaming analysis
// ============================================================================

/// POST /api/sentry/issues/{id}/analyze — non-streaming analysis, returns JSON.
pub async fn analyze_issue(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // Load server-side Sentry config
    let sentry_config = crate::db::get_sentry_config(&state.db)
        .await?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::validation(
                "Sentry is not configured. Ask an admin to configure the Sentry integration.",
            ))
        })?;

    // Load AI config
    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    // Fetch issue and latest event
    let issue_json = crate::integrations::sentry::fetch_issue(&sentry_config, &issue_id).await?;
    let event_json =
        crate::integrations::sentry::fetch_latest_event(&sentry_config, &issue_id).await?;

    // Normalize and detect patterns
    let issue: hadron_core::ai::SentryIssueDetail = match serde_json::from_value(issue_json) {
        Ok(i) => i,
        Err(e) => {
            tracing::warn!("Failed to deserialize Sentry issue, using defaults: {e}");
            hadron_core::ai::SentryIssueDetail::default()
        }
    };
    let event = hadron_core::ai::normalize_sentry_event(&event_json);
    let patterns = hadron_core::ai::detect_sentry_patterns(&issue, &event);

    // Build messages and run completion
    let (system_prompt, messages) =
        hadron_core::ai::build_sentry_analysis_messages(&issue, &event, &patterns);
    let raw_response = ai::complete(&ai_config, messages, Some(&system_prompt)).await?;
    let analysis_result = hadron_core::ai::parse_sentry_analysis(&raw_response)?;

    // Persist to DB (best-effort, log failures instead of silently discarding).
    let full_data = serde_json::json!({
        "issue": issue,
        "event": event,
        "patterns": patterns,
        "aiResult": analysis_result,
    });
    let fixes_json = serde_json::to_value(&analysis_result.suggested_fixes).ok();
    let filename = if issue.short_id.is_empty() {
        format!("sentry-{}", issue.id)
    } else {
        issue.short_id.clone()
    };
    match crate::db::insert_sentry_analysis(
        &state.db,
        user.user.id,
        &filename,
        Some(&analysis_result.error_type),
        Some(&analysis_result.error_message),
        Some(&analysis_result.severity),
        Some(&analysis_result.root_cause),
        fixes_json.as_ref(),
        Some(&analysis_result.confidence),
        Some(&analysis_result.component),
        Some(&full_data),
    )
    .await
    {
        Ok(inserted_id) => {
            let embed_text = format!(
                "{} {}",
                analysis_result.error_type,
                analysis_result.root_cause,
            )
            .trim()
            .to_string();
            if !embed_text.is_empty() {
                crate::routes::search::spawn_embed_analysis(
                    state.db.clone(),
                    inserted_id,
                    embed_text,
                );
            }
        }
        Err(e) => {
            tracing::warn!("Failed to persist Sentry analysis: {e}");
        }
    }

    Ok(Json(analysis_result))
}

// ============================================================================
// CRUD for saved analyses
// ============================================================================

/// GET /api/sentry/analyses — paginated list of Sentry analyses for the current user.
pub async fn list_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<SentryAnalysesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);
    let (items, total) =
        crate::db::get_sentry_analyses(&state.db, user.user.id, limit, offset).await?;
    Ok(Json(serde_json::json!({ "items": items, "total": total })))
}

/// GET /api/sentry/analyses/{id} — fetch a single saved Sentry analysis.
pub async fn get_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let analysis = crate::db::get_analysis_by_id(&state.db, id, user.user.id).await?;
    Ok(Json(analysis))
}

/// DELETE /api/sentry/analyses/{id} — soft-delete a saved Sentry analysis.
pub async fn delete_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    crate::db::delete_analysis(&state.db, id, user.user.id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
