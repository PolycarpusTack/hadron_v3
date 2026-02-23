//! Azure AD OIDC authentication.
//!
//! Validates JWT access tokens from Azure AD against the JWKS endpoint.
//! Auto-provisions users on first login with default Analyst role.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use chrono::Utc;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::AppState;
use hadron_core::models::{Role, User};

/// Azure AD OIDC configuration.
#[derive(Clone)]
pub struct AuthConfig {
    pub tenant_id: String,
    pub client_id: String,
    /// Override JWKS URL (for testing). If None, derived from tenant_id.
    pub jwks_url: Option<String>,
}

impl AuthConfig {
    pub fn jwks_url(&self) -> String {
        self.jwks_url.clone().unwrap_or_else(|| {
            format!(
                "https://login.microsoftonline.com/{}/discovery/v2.0/keys",
                self.tenant_id
            )
        })
    }

    pub fn issuer(&self) -> String {
        format!(
            "https://login.microsoftonline.com/{}/v2.0",
            self.tenant_id
        )
    }
}

/// Claims extracted from Azure AD JWT.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct AzureAdClaims {
    /// Subject (user OID)
    pub sub: String,
    /// Object ID
    pub oid: Option<String>,
    /// User principal name / email
    #[serde(rename = "preferred_username")]
    pub email: Option<String>,
    /// Display name
    pub name: Option<String>,
    /// Token audience
    pub aud: String,
    /// Token issuer
    pub iss: String,
    /// Expiration
    pub exp: u64,
    /// Azure AD groups (if configured in token claims)
    pub groups: Option<Vec<String>>,
}

/// Authenticated user — extracted from request via middleware.
///
/// Use as an Axum extractor: `AuthenticatedUser` in handler params.
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user: User,
}

/// JWKS key cache (refreshed periodically).
#[derive(Clone)]
pub struct JwksCache {
    keys: Arc<RwLock<Vec<JwksKey>>>,
    last_fetched: Arc<RwLock<Option<chrono::DateTime<Utc>>>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JwksKey {
    pub kid: String,
    pub n: String,
    pub e: String,
    pub kty: String,
}

#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<JwksKey>,
}

impl JwksCache {
    pub fn new() -> Self {
        Self {
            keys: Arc::new(RwLock::new(Vec::new())),
            last_fetched: Arc::new(RwLock::new(None)),
        }
    }

    /// Fetch or return cached JWKS keys. Refreshes every 60 minutes.
    pub async fn get_keys(&self, jwks_url: &str) -> Result<Vec<JwksKey>, String> {
        // Check cache freshness
        let should_refresh = {
            let last = self.last_fetched.read().await;
            match *last {
                Some(t) => Utc::now().signed_duration_since(t).num_minutes() > 60,
                None => true,
            }
        };

        if should_refresh {
            let resp: JwksResponse = reqwest::get(jwks_url)
                .await
                .map_err(|e| format!("JWKS fetch failed: {e}"))?
                .json()
                .await
                .map_err(|e| format!("JWKS parse failed: {e}"))?;

            let mut keys = self.keys.write().await;
            *keys = resp.keys;
            let mut last = self.last_fetched.write().await;
            *last = Some(Utc::now());
        }

        Ok(self.keys.read().await.clone())
    }
}

/// Validate a JWT access token and return the claims.
pub async fn validate_token(
    token: &str,
    config: &AuthConfig,
    jwks_cache: &JwksCache,
) -> Result<AzureAdClaims, String> {
    // Decode header to find kid
    let header =
        decode_header(token).map_err(|e| format!("Invalid token header: {e}"))?;

    let kid = header.kid.ok_or("Token missing kid header")?;

    // Find matching key
    let keys = jwks_cache.get_keys(&config.jwks_url()).await?;
    let key = keys
        .iter()
        .find(|k| k.kid == kid)
        .ok_or_else(|| format!("No matching JWKS key for kid: {kid}"))?;

    // Build decoding key
    let decoding_key = DecodingKey::from_rsa_components(&key.n, &key.e)
        .map_err(|e| format!("Invalid RSA key: {e}"))?;

    // Validate
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&config.client_id]);
    validation.set_issuer(&[config.issuer()]);

    let token_data = decode::<AzureAdClaims>(token, &decoding_key, &validation)
        .map_err(|e| format!("Token validation failed: {e}"))?;

    Ok(token_data.claims)
}

/// Auto-provision user on first login.
pub async fn provision_user(
    pool: &sqlx::PgPool,
    claims: &AzureAdClaims,
) -> Result<User, String> {
    let oid = claims
        .oid
        .as_deref()
        .unwrap_or(&claims.sub);
    let email = claims
        .email
        .as_deref()
        .unwrap_or(oid);
    let display_name = claims
        .name
        .as_deref()
        .unwrap_or(email);

    // Try to find existing user
    let existing: Option<UserRow> = sqlx::query_as(
        "SELECT id, azure_oid, email, display_name, role::text, team_id, is_active, created_at, last_login_at
         FROM users WHERE azure_oid = $1",
    )
    .bind(oid)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error finding user: {e}"))?;

    if let Some(row) = existing {
        // Update last login
        sqlx::query("UPDATE users SET last_login_at = now() WHERE id = $1")
            .bind(row.id)
            .execute(pool)
            .await
            .map_err(|e| format!("DB error updating login: {e}"))?;

        return Ok(User {
            id: row.id,
            azure_oid: row.azure_oid,
            email: row.email,
            display_name: row.display_name,
            role: row.role.parse().unwrap_or(Role::Analyst),
            team_id: row.team_id,
            is_active: row.is_active,
            created_at: row.created_at,
            last_login_at: Some(Utc::now()),
        });
    }

    // Create new user with default Analyst role
    let id = Uuid::new_v4();
    let now = Utc::now();

    sqlx::query(
        "INSERT INTO users (id, azure_oid, email, display_name, role, last_login_at)
         VALUES ($1, $2, $3, $4, 'analyst', $5)",
    )
    .bind(id)
    .bind(oid)
    .bind(email)
    .bind(display_name)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error creating user: {e}"))?;

    // Create default settings
    sqlx::query("INSERT INTO user_settings (user_id) VALUES ($1)")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("DB error creating settings: {e}"))?;

    Ok(User {
        id,
        azure_oid: oid.to_string(),
        email: email.to_string(),
        display_name: display_name.to_string(),
        role: Role::Analyst,
        team_id: None,
        is_active: true,
        created_at: now,
        last_login_at: Some(now),
    })
}

/// Internal row type for sqlx mapping.
#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct UserRow {
    id: Uuid,
    azure_oid: String,
    email: String,
    display_name: String,
    role: String,
    team_id: Option<Uuid>,
    is_active: bool,
    created_at: chrono::DateTime<Utc>,
    last_login_at: Option<chrono::DateTime<Utc>>,
}

/// API error response helper.
#[derive(Serialize)]
pub struct ErrorResponse {
    error: String,
    code: String,
}

impl ErrorResponse {
    fn unauthorized(msg: &str) -> (StatusCode, axum::Json<Self>) {
        (
            StatusCode::UNAUTHORIZED,
            axum::Json(Self {
                error: msg.to_string(),
                code: "UNAUTHENTICATED".to_string(),
            }),
        )
    }
}

/// Axum extractor — extracts `AuthenticatedUser` from the Authorization header.
///
/// Usage in handlers:
/// ```ignore
/// async fn my_handler(user: AuthenticatedUser) -> impl IntoResponse { ... }
/// ```
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = (StatusCode, axum::Json<ErrorResponse>);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Dev mode: skip JWT validation, return seeded dev admin
        if state.dev_mode {
            let dev_id =
                Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
            let user: UserRow = sqlx::query_as(
                "SELECT id, azure_oid, email, display_name, role::text, team_id, is_active, created_at, last_login_at
                 FROM users WHERE id = $1",
            )
            .bind(dev_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("Dev user lookup failed: {e}");
                ErrorResponse::unauthorized("Dev user not found")
            })?;

            return Ok(AuthenticatedUser {
                user: User {
                    id: user.id,
                    azure_oid: user.azure_oid,
                    email: user.email,
                    display_name: user.display_name,
                    role: user.role.parse().unwrap_or(Role::Admin),
                    team_id: user.team_id,
                    is_active: user.is_active,
                    created_at: user.created_at,
                    last_login_at: user.last_login_at,
                },
            });
        }

        // Extract Bearer token
        let auth_header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| ErrorResponse::unauthorized("Missing Authorization header"))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| ErrorResponse::unauthorized("Invalid Authorization format"))?;

        // Validate token using shared JWKS cache from app state
        let claims = validate_token(token, &state.auth_config, &state.jwks_cache)
            .await
            .map_err(|e| {
                tracing::warn!("Token validation failed: {e}");
                ErrorResponse::unauthorized("Invalid or expired token")
            })?;

        // Find or provision user
        let user = provision_user(&state.db, &claims).await.map_err(|e| {
            tracing::error!("User provisioning failed: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(ErrorResponse {
                    error: "User provisioning failed".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

        if !user.is_active {
            return Err(ErrorResponse::unauthorized("Account deactivated"));
        }

        Ok(AuthenticatedUser { user })
    }
}
