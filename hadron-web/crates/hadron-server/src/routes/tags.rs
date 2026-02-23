//! Tag CRUD handlers.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

pub async fn list_tags(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let tags = db::list_tags(&state.db).await?;
    Ok(Json(tags))
}

pub async fn create_tag(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<CreateTagRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    let tag = db::create_tag(&state.db, &req.name, req.color.as_deref()).await?;
    Ok((StatusCode::CREATED, Json(tag)))
}

pub async fn update_tag(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateTagRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    let tag = db::update_tag(&state.db, id, req.name.as_deref(), req.color.as_deref()).await?;
    Ok(Json(tag))
}

pub async fn delete_tag(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    db::delete_tag(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_analysis_tags(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let tags = db::get_analysis_tags(&state.db, id).await?;
    Ok(Json(tags))
}

pub async fn set_analysis_tags(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<SetAnalysisTagsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let tags = db::set_analysis_tags(&state.db, id, user.user.id, &req.tag_ids).await?;
    Ok(Json(tags))
}
