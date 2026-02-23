//! Release notes handlers — CRUD + publish.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

pub async fn list_release_notes(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    let (data, total) =
        db::get_release_notes(&state.db, user.user.id, params.limit(), params.offset()).await?;

    Ok(Json(PaginatedResponse {
        data,
        total,
        limit: params.limit(),
        offset: params.offset(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReleaseNoteRequest {
    title: String,
    version: Option<String>,
    content: String,
    format: Option<String>,
}

pub async fn create_release_note(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<CreateReleaseNoteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let format = req.format.as_deref().unwrap_or("markdown");
    let note = db::create_release_note(
        &state.db,
        user.user.id,
        &req.title,
        req.version.as_deref(),
        &req.content,
        format,
    )
    .await?;

    Ok((StatusCode::CREATED, Json(note)))
}

pub async fn get_release_note(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id).await?;
    Ok(Json(note))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReleaseNoteRequest {
    title: Option<String>,
    version: Option<String>,
    content: Option<String>,
    format: Option<String>,
}

pub async fn update_release_note(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateReleaseNoteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::update_release_note(
        &state.db,
        id,
        user.user.id,
        req.title.as_deref(),
        req.version.as_deref(),
        req.content.as_deref(),
        req.format.as_deref(),
    )
    .await?;

    Ok(Json(note))
}

pub async fn delete_release_note(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    db::delete_release_note(&state.db, id, user.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn publish_release_note(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::publish_release_note(&state.db, id, user.user.id).await?;
    Ok(Json(note))
}
