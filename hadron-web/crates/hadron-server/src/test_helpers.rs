//! Test utilities for hadron-server integration tests.

use chrono::Utc;
use hadron_core::models::{Role, User};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;

/// Create a mock authenticated user with the given role.
pub fn mock_user(role: Role) -> AuthenticatedUser {
    AuthenticatedUser {
        user: User {
            id: Uuid::new_v4(),
            azure_oid: format!("test-oid-{}", Uuid::new_v4()),
            email: format!("test-{}@example.com", role.as_str()),
            display_name: format!("Test {}", role.as_str()),
            role,
            team_id: Some(Uuid::new_v4()),
            is_active: true,
            created_at: Utc::now(),
            last_login_at: Some(Utc::now()),
        },
    }
}

/// Create a mock authenticated user with a specific ID.
pub fn mock_user_with_id(id: Uuid, role: Role) -> AuthenticatedUser {
    AuthenticatedUser {
        user: User {
            id,
            azure_oid: format!("test-oid-{id}"),
            email: format!("test-{id}@example.com"),
            display_name: format!("Test User {}", role.as_str()),
            role,
            team_id: Some(Uuid::new_v4()),
            is_active: true,
            created_at: Utc::now(),
            last_login_at: Some(Utc::now()),
        },
    }
}
