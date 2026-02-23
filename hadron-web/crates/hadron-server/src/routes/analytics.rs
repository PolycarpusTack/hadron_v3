//! Analytics dashboard handlers.

use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::Role;

use super::AppError;

#[derive(Deserialize)]
pub struct AnalyticsQuery {
    days: Option<i64>,
}

/// User's own analytics.
pub async fn get_analytics(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let days = params.days.unwrap_or(30).min(365);
    let dashboard =
        db::get_analytics_dashboard(&state.db, Some(user.user.id), days).await?;
    Ok(Json(dashboard))
}

/// Team analytics (lead+).
pub async fn get_team_analytics(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    // For now, team analytics = same as user analytics for the lead
    // In production, this would filter by team_id
    let days = params.days.unwrap_or(30).min(365);
    let dashboard =
        db::get_analytics_dashboard(&state.db, Some(user.user.id), days).await?;
    Ok(Json(dashboard))
}

/// Global analytics (admin).
pub async fn get_global_analytics(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    let days = params.days.unwrap_or(30).min(365);
    let dashboard = db::get_analytics_dashboard(&state.db, None, days).await?;
    Ok(Json(dashboard))
}
