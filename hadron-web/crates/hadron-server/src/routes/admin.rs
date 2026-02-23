//! Admin and team handlers.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

// ============================================================================
// Team / Shared feed (lead+)
// ============================================================================

pub async fn team_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;

    let team_id = user.user.team_id.ok_or_else(|| {
        AppError(hadron_core::error::HadronError::Validation(
            "You are not assigned to a team".to_string(),
        ))
    })?;

    let (data, total) =
        db::get_team_analyses(&state.db, team_id, params.limit(), params.offset()).await?;

    Ok(Json(PaginatedResponse {
        data,
        total,
        limit: params.limit(),
        offset: params.offset(),
    }))
}

// ============================================================================
// Admin
// ============================================================================

pub async fn admin_list_users(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    let users = db::list_users(&state.db).await?;
    Ok(Json(users))
}

#[derive(Deserialize)]
pub struct UpdateRoleRequest {
    role: Role,
}

pub async fn admin_update_role(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
    Json(req): Json<UpdateRoleRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    db::update_user_role(&state.db, id, req.role).await?;

    // Audit log — log errors but don't fail the operation
    if let Err(e) = db::write_audit_log(
        &state.db,
        user.user.id,
        "user.role_change",
        "user",
        Some(&id.to_string()),
        &serde_json::json!({ "new_role": req.role }),
        None,
    )
    .await
    {
        tracing::error!("Failed to write audit log for role change: {e}");
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn admin_all_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    let (data, total) =
        db::get_all_analyses(&state.db, params.limit(), params.offset()).await?;

    Ok(Json(PaginatedResponse {
        data,
        total,
        limit: params.limit(),
        offset: params.offset(),
    }))
}

#[derive(Deserialize)]
pub struct AuditLogQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    action: Option<String>,
}

pub async fn admin_audit_log(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<AuditLogQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0).max(0);

    let entries =
        db::get_audit_log(&state.db, limit, offset, params.action.as_deref()).await?;

    Ok(Json(entries))
}

/// Export verified gold analyses as JSONL training data.
pub async fn export_training_data(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    let analyses = db::get_verified_gold_training_data(&state.db).await?;

    // Build JSONL lines
    let mut lines = Vec::new();
    for a in &analyses {
        let line = serde_json::json!({
            "messages": [
                {
                    "role": "system",
                    "content": "You are a crash analysis expert. Analyze crash logs and provide structured results."
                },
                {
                    "role": "user",
                    "content": format!("Analyze this crash log:\n\n{}", a.stack_trace.as_deref().unwrap_or(""))
                },
                {
                    "role": "assistant",
                    "content": serde_json::json!({
                        "errorType": a.error_type,
                        "errorMessage": a.error_message,
                        "severity": a.severity,
                        "rootCause": a.root_cause,
                        "suggestedFixes": a.suggested_fixes,
                        "confidence": a.confidence,
                        "component": a.component,
                    }).to_string()
                }
            ]
        });
        lines.push(serde_json::to_string(&line).unwrap_or_default());
    }

    let jsonl = lines.join("\n");

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/jsonl"),
            (
                axum::http::header::CONTENT_DISPOSITION,
                "attachment; filename=\"hadron-training-data.jsonl\"",
            ),
        ],
        jsonl,
    ))
}
