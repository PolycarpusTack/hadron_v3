use std::net::SocketAddr;
use std::path::PathBuf;

use axum::Router;
use sqlx::postgres::PgPoolOptions;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod ai;
mod auth;
mod db;
mod integrations;
mod middleware;
mod routes;
mod sse;
mod crypto;

#[cfg(test)]
mod test_helpers;

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub auth_config: auth::AuthConfig,
    pub jwks_cache: auth::JwksCache,
    pub dev_mode: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env in development
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .json()
        .init();

    // Database
    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .idle_timeout(std::time::Duration::from_secs(600))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .connect(&database_url)
        .await?;

    tracing::info!("Connected to PostgreSQL");

    // Run migrations
    sqlx::migrate!("../../migrations").run(&pool).await?;
    tracing::info!("Migrations applied");

    // Auth mode
    let dev_mode = std::env::var("AUTH_MODE")
        .map(|m| m == "dev")
        .unwrap_or(false);

    let auth_config = if dev_mode {
        tracing::warn!("Running in DEV auth mode — all requests authenticated as dev admin");
        auth::AuthConfig {
            tenant_id: "dev".to_string(),
            client_id: "dev".to_string(),
            jwks_url: None,
        }
    } else {
        auth::AuthConfig {
            tenant_id: std::env::var("AZURE_AD_TENANT_ID")
                .expect("AZURE_AD_TENANT_ID must be set"),
            client_id: std::env::var("AZURE_AD_CLIENT_ID")
                .expect("AZURE_AD_CLIENT_ID must be set"),
            jwks_url: None,
        }
    };

    // Seed dev admin user
    if dev_mode {
        db::seed_dev_user(&pool).await?;
    }

    let state = AppState {
        db: pool,
        auth_config,
        jwks_cache: auth::JwksCache::new(),
        dev_mode,
    };

    // Build router
    let mut app = Router::new()
        .nest("/api", routes::api_router())
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(15 * 1024 * 1024)) // 15 MB max body
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors_layer());

    // Serve frontend static files in production
    let static_dir = std::env::var("STATIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("frontend/dist"));

    if static_dir.exists() {
        tracing::info!("Serving frontend from {}", static_dir.display());
        let index = static_dir.join("index.html");
        app = app.fallback_service(
            ServeDir::new(&static_dir).fallback(ServeFile::new(index)),
        );
    } else {
        tracing::info!("No frontend build found at {}, API-only mode", static_dir.display());
    }

    // Start server
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Hadron Web listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

fn cors_layer() -> CorsLayer {
    use axum::http::{header, HeaderValue, Method};

    let origins_str =
        std::env::var("CORS_ORIGINS").unwrap_or_else(|_| "http://localhost:3000".to_string());

    let origins: Vec<HeaderValue> = origins_str
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let mut cors = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
        ])
        .allow_credentials(true);

    if origins.is_empty() {
        tracing::warn!(
            "CORS_ORIGINS produced no valid origins from '{}', defaulting to http://localhost:3000",
            origins_str
        );
        cors = cors.allow_origin("http://localhost:3000".parse::<HeaderValue>().unwrap());
    } else {
        cors = cors.allow_origin(origins);
    }

    cors
}
