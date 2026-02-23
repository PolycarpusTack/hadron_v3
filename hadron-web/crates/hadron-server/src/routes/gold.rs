//! Gold standard analysis handlers.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

pub async fn promote_to_gold(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<PromoteToGoldRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    let gold = db::promote_to_gold(&state.db, id, user.user.id, req.quality_score).await?;
    Ok((StatusCode::CREATED, Json(gold)))
}

pub async fn demote_gold(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    db::demote_gold(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_gold(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    let (data, total) =
        db::list_gold_analyses(&state.db, params.limit(), params.offset()).await?;
    Ok(Json(PaginatedResponse {
        data,
        total,
        limit: params.limit(),
        offset: params.offset(),
    }))
}

pub async fn verify_gold(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<VerifyGoldRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    let gold = db::verify_gold(
        &state.db,
        id,
        user.user.id,
        &req.status,
        req.notes.as_deref(),
        req.quality_score,
    )
    .await?;
    Ok(Json(gold))
}
