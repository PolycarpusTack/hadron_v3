//! Request middleware: RBAC guards, request logging, rate limiting.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::AppState;
use hadron_core::models::Role;

/// RBAC guard — checks that the authenticated user has the required role.
///
/// Roles are ordered: Analyst < Lead < Admin.
/// A user with a higher role can access endpoints requiring lower roles.
///
/// Usage in handlers:
/// ```ignore
/// async fn admin_only(user: AuthenticatedUser) -> impl IntoResponse {
///     require_role(&user, Role::Admin)?;
///     // ... admin logic
/// }
/// ```
pub fn require_role(
    user: &AuthenticatedUser,
    required: Role,
) -> Result<(), (StatusCode, Json<RbacError>)> {
    if user.user.role >= required {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(RbacError {
                error: format!(
                    "Requires {} role, you have {}",
                    required, user.user.role
                ),
                code: "FORBIDDEN".to_string(),
                required_role: required.as_str().to_string(),
                current_role: user.user.role.as_str().to_string(),
            }),
        ))
    }
}

#[derive(Debug, Serialize)]
pub struct RbacError {
    pub error: String,
    pub code: String,
    pub required_role: String,
    pub current_role: String,
}

/// Check if user can access another user's resources.
///
/// Rules:
/// - Users can always access their own resources
/// - Leads can access their team members' resources
/// - Admins can access anyone's resources
#[allow(dead_code)]
pub fn can_access_user_resource(
    actor: &AuthenticatedUser,
    resource_owner_id: uuid::Uuid,
) -> bool {
    // Own resources
    if actor.user.id == resource_owner_id {
        return true;
    }

    // Admins can access anything
    if actor.user.role >= Role::Admin {
        return true;
    }

    // Leads can access team resources (team check done at query level)
    if actor.user.role >= Role::Lead {
        return true; // Team filtering happens in DB queries
    }

    false
}

/// Health check handler (readiness probe — checks DB connectivity).
///
/// Returns a generic status to the client; full error detail is logged server-side.
/// This prevents DB driver/connection errors from leaking to unauthenticated callers.
pub async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "healthy",
                "version": env!("CARGO_PKG_VERSION"),
            })),
        ),
        Err(e) => {
            tracing::error!("Health check DB probe failed: {e}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "status": "unhealthy",
                    "error": "Database unavailable",
                })),
            )
        }
    }
}

/// Liveness probe (always returns 200 if the server is running).
pub async fn liveness() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({ "status": "alive" })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{mock_user, mock_user_with_id};
    use uuid::Uuid;

    #[test]
    fn test_require_role_admin_passes() {
        let user = mock_user(Role::Admin);
        assert!(require_role(&user, Role::Admin).is_ok());
    }

    #[test]
    fn test_require_role_analyst_denied_admin() {
        let user = mock_user(Role::Analyst);
        let result = require_role(&user, Role::Admin);
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_require_role_lead_passes_for_analyst_endpoint() {
        let user = mock_user(Role::Lead);
        assert!(require_role(&user, Role::Analyst).is_ok());
    }

    #[test]
    fn test_require_role_admin_passes_for_lead_endpoint() {
        let user = mock_user(Role::Admin);
        assert!(require_role(&user, Role::Lead).is_ok());
    }

    #[test]
    fn test_require_role_analyst_denied_lead() {
        let user = mock_user(Role::Analyst);
        let result = require_role(&user, Role::Lead);
        assert!(result.is_err());
    }

    #[test]
    fn test_can_access_own_resource() {
        let user = mock_user(Role::Analyst);
        let own_id = user.user.id;
        assert!(can_access_user_resource(&user, own_id));
    }

    #[test]
    fn test_analyst_cannot_access_other_resource() {
        let user = mock_user(Role::Analyst);
        let other_id = Uuid::new_v4();
        assert!(!can_access_user_resource(&user, other_id));
    }

    #[test]
    fn test_admin_can_access_any_resource() {
        let user = mock_user(Role::Admin);
        let other_id = Uuid::new_v4();
        assert!(can_access_user_resource(&user, other_id));
    }

    #[test]
    fn test_lead_can_access_team_resource() {
        let user = mock_user(Role::Lead);
        let other_id = Uuid::new_v4();
        assert!(can_access_user_resource(&user, other_id));
    }

    #[test]
    fn test_user_with_specific_id_accesses_own() {
        let id = Uuid::new_v4();
        let user = mock_user_with_id(id, Role::Analyst);
        assert!(can_access_user_resource(&user, id));
    }
}
