//! Performance trace analysis handlers.

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::routes::AppError;
use crate::AppState;
use crate::{ai, db};

// ============================================================================
// Request types
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub content: String,
    pub filename: String,
}

#[derive(Deserialize)]
pub struct AnalysesQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /api/performance/analyze — rule-based parsing only, no AI, instant.
pub async fn analyze(
    _user: AuthenticatedUser,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let result = hadron_core::performance::parse_trace(&req.content, &req.filename)
        .map_err(AppError)?;
    Ok(Json(result))
}

/// POST /api/performance/analyze/enrich — rule-based parsing + AI enrichment, persisted.
pub async fn analyze_enrich(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let ai_config = crate::routes::analyses::resolve_ai_config(&state.db).await?;

    let mut result = hadron_core::performance::parse_trace(&req.content, &req.filename)
        .map_err(AppError)?;

    // AI enrichment (non-streaming — response is small)
    let (system, messages) =
        hadron_core::ai::performance::build_performance_enrichment_messages(&result);
    if let Ok(raw) = ai::complete(&ai_config, messages, Some(&system)).await {
        if let Ok(enrichment) = hadron_core::ai::performance::parse_performance_enrichment(&raw) {
            result.scenario.action = enrichment.scenario_narrative;
            result.recommendations = enrichment.recommendations;
            result.summary = enrichment.summary;
        }
    }

    // Persist (best-effort — don't fail the response on DB error)
    let full_data = serde_json::to_value(&result).ok();
    match db::insert_performance_analysis(
        &state.db,
        user.user.id,
        &req.filename,
        Some(&result.overall_severity),
        result.top_methods.first().map(|m| m.category.as_str()),
        full_data.as_ref(),
    )
    .await
    {
        Ok(inserted_id) => {
            // Build embed text from summary + severity
            let embed_text = format!(
                "{} {}",
                result.summary.trim(),
                result.overall_severity,
            )
            .trim()
            .to_string();
            if !embed_text.is_empty() {
                crate::routes::search::spawn_embed_analysis(
                    state.db.clone(),
                    inserted_id,
                    user.user.id,
                    embed_text,
                );
            }
        }
        Err(e) => {
            tracing::warn!("Failed to persist performance analysis: {e}");
        }
    }

    Ok(Json(result))
}

/// GET /api/performance/analyses — paginated list of saved analyses.
pub async fn list_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<AnalysesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let (items, total) = db::get_performance_analyses(
        &state.db,
        user.user.id,
        params.limit.unwrap_or(20).min(100),
        params.offset.unwrap_or(0),
    )
    .await?;
    Ok(Json(serde_json::json!({ "items": items, "total": total })))
}

/// GET /api/performance/analyses/{id} — fetch a single saved analysis.
pub async fn get_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let analysis = db::get_analysis_by_id(&state.db, id, user.user.id).await?;
    Ok(Json(analysis))
}

/// DELETE /api/performance/analyses/{id} — soft-delete a saved analysis.
pub async fn delete_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    db::delete_analysis(&state.db, id, user.user.id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
