//! Analysis notes handlers.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

pub async fn get_analysis_notes(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let notes = db::get_analysis_notes(&state.db, id).await?;
    Ok(Json(notes))
}

pub async fn create_note(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<CreateNoteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::create_note(&state.db, id, user.user.id, &req.content).await?;
    Ok((StatusCode::CREATED, Json(note)))
}

pub async fn update_note(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateNoteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::update_note(&state.db, id, user.user.id, &req.content).await?;
    Ok(Json(note))
}

pub async fn delete_note(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    db::delete_note(&state.db, id, user.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}
