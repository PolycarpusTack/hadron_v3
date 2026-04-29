//! Crash signature handlers.

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

pub async fn list_signatures(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    let (rows, total) =
        db::get_crash_signatures(&state.db, params.limit(), params.offset()).await?;

    // Convert DB rows to API response
    let data: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "hash": r.hash,
                "canonical": r.canonical,
                "components": r.components_json,
                "firstSeenAt": r.first_seen_at,
                "lastSeenAt": r.last_seen_at,
                "occurrenceCount": r.occurrence_count,
                "linkedTicketId": r.linked_ticket_id,
                "linkedTicketUrl": r.linked_ticket_url,
                "status": r.status,
            })
        })
        .collect();

    Ok(Json(PaginatedResponse {
        data,
        total,
        limit: params.limit(),
        offset: params.offset(),
    }))
}

pub async fn get_signature(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(hash): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let row = db::get_signature_by_hash(&state.db, &hash).await?;
    Ok(Json(serde_json::json!({
        "hash": row.hash,
        "canonical": row.canonical,
        "components": row.components_json,
        "firstSeenAt": row.first_seen_at,
        "lastSeenAt": row.last_seen_at,
        "occurrenceCount": row.occurrence_count,
        "linkedTicketId": row.linked_ticket_id,
        "linkedTicketUrl": row.linked_ticket_url,
        "status": row.status,
    })))
}

/// ORG-WIDE: returns all analyses matching the signature across the whole team.
/// Crash signatures are shared fingerprints — this is intentional, not a leak.
pub async fn get_signature_analyses(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(hash): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let analyses = db::get_signature_analyses(&state.db, &hash).await?;
    Ok(Json(analyses))
}

#[derive(Deserialize)]
pub struct UpdateStatusRequest {
    status: String,
}

pub async fn update_signature_status(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(hash): Path<String>,
    Json(req): Json<UpdateStatusRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    db::update_signature_status(&state.db, &hash, &req.status).await?;
    Ok(Json(serde_json::json!({ "status": req.status })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTicketRequest {
    ticket_id: Option<String>,
    ticket_url: Option<String>,
}

pub async fn link_signature_ticket(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(hash): Path<String>,
    Json(req): Json<LinkTicketRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    db::link_signature_ticket(
        &state.db,
        &hash,
        req.ticket_id.as_deref(),
        req.ticket_url.as_deref(),
    )
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
