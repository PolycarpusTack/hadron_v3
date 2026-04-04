//! Release notes handlers — CRUD + publish.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware;
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

// ============================================================================
// Status Transition
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusRequest {
    pub status: String,
}

fn check_checklist_complete(note: &db::ReleaseNote) -> Result<(), AppError> {
    if let Some(ref checklist) = note.checklist_state {
        if let Some(items) = checklist.as_array() {
            let all_checked = items.iter().all(|item| {
                item.get("checked")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            });
            if all_checked && !items.is_empty() {
                return Ok(());
            }
        }
    }
    Err(AppError(hadron_core::error::HadronError::validation(
        "All checklist items must be checked before this transition.",
    )))
}

pub async fn update_release_note_status(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateStatusRequest>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id).await.map_err(AppError)?;
    let owner_id = db::get_release_note_owner(&state.db, id).await.map_err(AppError)?;
    let is_owner = user.user.id == owner_id;

    let current_status = note.status.as_deref().unwrap_or("draft");
    let new_status = req.status.as_str();

    let mut reviewed_by: Option<uuid::Uuid> = None;
    let mut reviewed_at: Option<chrono::DateTime<Utc>> = None;
    let mut published_at: Option<chrono::DateTime<Utc>> = None;

    match (current_status, new_status) {
        ("draft", "in_review") => {
            if !is_owner {
                return Err(AppError(hadron_core::error::HadronError::forbidden(
                    "Only the owner can submit for review.",
                )));
            }
            check_checklist_complete(&note)?;
        }
        ("in_review", "approved") => {
            middleware::require_role(&user, Role::Lead)
                .map_err(|_| AppError(hadron_core::error::HadronError::forbidden("Lead role required to approve.")))?;
            check_checklist_complete(&note)?;
            reviewed_by = Some(user.user.id);
            reviewed_at = Some(Utc::now());
        }
        ("approved", "published") => {
            middleware::require_role(&user, Role::Admin)
                .map_err(|_| AppError(hadron_core::error::HadronError::forbidden("Admin role required to publish.")))?;
            check_checklist_complete(&note)?;
            published_at = Some(Utc::now());
        }
        ("in_review", "draft") => {
            if !is_owner {
                return Err(AppError(hadron_core::error::HadronError::forbidden(
                    "Only the owner can withdraw from review.",
                )));
            }
        }
        (_, "archived") => {
            if !is_owner {
                middleware::require_role(&user, Role::Admin)
                    .map_err(|_| AppError(hadron_core::error::HadronError::forbidden("Only the owner or an admin can archive.")))?;
            }
        }
        _ => {
            return Err(AppError(hadron_core::error::HadronError::validation(
                format!("Invalid status transition from '{current_status}' to '{new_status}'."),
            )));
        }
    }

    db::update_release_note_status(&state.db, id, user.user.id, new_status, reviewed_by, reviewed_at, published_at)
        .await
        .map_err(AppError)?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Checklist
// ============================================================================

async fn get_checklist_items(pool: &sqlx::PgPool) -> Vec<String> {
    if let Ok(Some(custom)) = db::get_global_setting(pool, "release_notes_checklist").await {
        if !custom.is_empty() {
            if let Ok(items) = serde_json::from_str::<Vec<String>>(&custom) {
                return items;
            }
        }
    }
    hadron_core::ai::DEFAULT_CHECKLIST_ITEMS
        .iter()
        .map(|s| s.to_string())
        .collect()
}

pub async fn get_checklist(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(AppError)?;

    let items: Vec<serde_json::Value> = if let Some(ref state_json) = note.checklist_state {
        serde_json::from_value(state_json.clone()).unwrap_or_default()
    } else {
        let config_items = get_checklist_items(&state.db).await;
        config_items
            .iter()
            .map(|item| serde_json::json!({ "item": item, "checked": false }))
            .collect()
    };

    let complete = !items.is_empty()
        && items.iter().all(|i| {
            i.get("checked")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });

    Ok(Json(serde_json::json!({ "items": items, "complete": complete })))
}

pub async fn update_checklist(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(items): Json<Vec<serde_json::Value>>,
) -> Result<impl IntoResponse, AppError> {
    let checklist_json = serde_json::to_value(&items)
        .map_err(|e| AppError(hadron_core::error::HadronError::validation(e.to_string())))?;
    db::update_release_note_checklist(&state.db, id, user.user.id, &checklist_json)
        .await
        .map_err(AppError)?;
    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Confluence Export & Publish
// ============================================================================

pub async fn export_confluence(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(AppError)?;

    let markdown = note
        .markdown_content
        .as_deref()
        .unwrap_or(&note.content);

    let wiki_text = hadron_core::ai::markdown_to_confluence(markdown);

    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        wiki_text,
    ))
}

pub async fn publish_confluence(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(AppError)?;

    let space_key = db::get_global_setting(&state.db, "confluence_space_key")
        .await?
        .unwrap_or_default();

    if space_key.is_empty() {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "Confluence space key is not configured. Ask an admin to set it.",
        )));
    }

    let parent_page_id = db::get_global_setting(&state.db, "confluence_parent_page_id")
        .await?
        .unwrap_or_default();

    let jira_config = db::get_jira_config_from_poller(&state.db).await?;

    let markdown = note
        .markdown_content
        .as_deref()
        .unwrap_or(&note.content);

    let wiki_text = hadron_core::ai::markdown_to_confluence(markdown);

    let result = crate::integrations::confluence::publish_page(
        &jira_config.base_url,
        &jira_config.email,
        &jira_config.api_token,
        &space_key,
        &parent_page_id,
        &note.title,
        &wiki_text,
    )
    .await?;

    Ok(Json(result))
}

// ============================================================================
// Compliance Check
// ============================================================================

pub async fn run_compliance_check(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let note = db::get_release_note(&state.db, id, user.user.id)
        .await
        .map_err(AppError)?;

    let content = note
        .markdown_content
        .as_deref()
        .unwrap_or(&note.content);

    let style_guide = db::get_global_setting(&state.db, "release_notes_style_guide")
        .await
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| hadron_core::ai::DEFAULT_STYLE_GUIDE.to_string());

    let ai_config = crate::routes::analyses::resolve_ai_config(&state.db, None, None, None).await?;
    let (system, messages) = hadron_core::ai::build_compliance_messages(content, &style_guide);
    let raw = crate::ai::complete(&ai_config, messages, Some(&system)).await?;
    let report = hadron_core::ai::parse_compliance_response(&raw)?;

    Ok(Json(report))
}
