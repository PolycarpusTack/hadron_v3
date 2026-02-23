//! Analysis feedback handlers.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

pub async fn submit_feedback(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<SubmitFeedbackRequest>,
) -> Result<impl IntoResponse, AppError> {
    let feedback = db::submit_feedback(&state.db, id, user.user.id, &req).await?;
    Ok((StatusCode::CREATED, Json(feedback)))
}

pub async fn get_analysis_feedback(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let feedback = db::get_analysis_feedback(&state.db, id).await?;
    Ok(Json(feedback))
}

pub async fn get_feedback_summary(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let summary = db::get_feedback_summary(&state.db, id).await?;
    Ok(Json(summary))
}

pub async fn delete_feedback(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    db::delete_feedback(&state.db, id, user.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}
