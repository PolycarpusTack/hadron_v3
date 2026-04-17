use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use sqlx::postgres::PgPoolOptions;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::{PeerIpKeyExtractor, SmartIpKeyExtractor};
use tower_governor::GovernorLayer;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod ai;
mod auth;
mod db;
mod integrations;
mod middleware;
mod routes;
mod sse;
mod jira_poller;
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
    pub poller: jira_poller::PollerState,
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

    // Auth mode — requires TWO independent signals to enable dev-mode bypass:
    // `AUTH_MODE=dev` AND `ALLOW_DEV_AUTH=true`. A single-flag misconfiguration
    // will refuse to start rather than silently hand out admin access.
    let requested_dev = std::env::var("AUTH_MODE")
        .map(|m| m == "dev")
        .unwrap_or(false);
    let allow_dev = std::env::var("ALLOW_DEV_AUTH")
        .map(|v| matches!(v.as_str(), "true" | "1"))
        .unwrap_or(false);
    if requested_dev && !allow_dev {
        return Err(anyhow::anyhow!(
            "AUTH_MODE=dev requires ALLOW_DEV_AUTH=true. Refusing to start with an \
             unguarded dev-auth bypass. Unset AUTH_MODE or set ALLOW_DEV_AUTH=true \
             (local development only).",
        ));
    }
    let dev_mode = requested_dev && allow_dev;

    let auth_config = if dev_mode {
        tracing::error!(
            "Running in DEV auth mode — all requests authenticated as dev admin. \
             This MUST NOT be enabled in production."
        );
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
        poller: jira_poller::PollerState::new(),
    };

    // Clone before state is moved into router
    let pool_for_poller = state.db.clone();
    let poller_for_start = state.poller.clone();

    // Build router
    let mut app = Router::new()
        .nest("/api", routes::api_router());

    // MCP discovery endpoint (no auth, outside /api)
    if routes::mcp::is_enabled() {
        app = app.route(
            "/.well-known/mcp",
            axum::routing::get(routes::mcp::well_known_mcp),
        );
    }

    // Per-IP rate limiter. Defaults: 10 req/sec sustained, burst of 100.
    //
    // Key extraction depends on deployment: set `TRUSTED_PROXY=true` only when
    // a reverse proxy that strips/replaces client-supplied `X-Forwarded-For`
    // sits in front of us. Otherwise we use the direct peer IP — an attacker
    // can spoof XFF on a direct connection, which would defeat per-IP limits.
    let rl_per_second: u64 = std::env::var("RATE_LIMIT_PER_SECOND")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let rl_burst: u32 = std::env::var("RATE_LIMIT_BURST")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100);
    let trusted_proxy = std::env::var("TRUSTED_PROXY")
        .map(|v| matches!(v.as_str(), "true" | "1"))
        .unwrap_or(false);

    // Pre-governor layers. `with_state` converts `Router<AppState>` into
    // `Router<()>`; subsequent `.layer` calls keep the outer Router type the
    // same, so the conditional governor branch below produces a single,
    // uniformly-typed Router regardless of which key extractor is chosen.
    let base = app
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(15 * 1024 * 1024)) // 15 MB max body
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http());

    let app_with_governor = if trusted_proxy {
        tracing::info!(
            "Rate limiter: trusting X-Forwarded-For via SmartIpKeyExtractor \
             (TRUSTED_PROXY=true). The reverse proxy MUST sanitise client XFF."
        );
        let conf = GovernorConfigBuilder::default()
            .per_second(rl_per_second)
            .burst_size(rl_burst)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("valid governor rate-limit config");
        let limiter = conf.limiter().clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            limiter.retain_recent();
        });
        base.layer(GovernorLayer {
            config: Arc::new(conf),
        })
    } else {
        tracing::info!(
            "Rate limiter: keying by direct peer IP (set TRUSTED_PROXY=true \
             only when a header-sanitising reverse proxy is in front)."
        );
        let conf = GovernorConfigBuilder::default()
            .per_second(rl_per_second)
            .burst_size(rl_burst)
            .key_extractor(PeerIpKeyExtractor)
            .finish()
            .expect("valid governor rate-limit config");
        let limiter = conf.limiter().clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            limiter.retain_recent();
        });
        base.layer(GovernorLayer {
            config: Arc::new(conf),
        })
    };

    let mut app = app_with_governor
        // Browser hardening: set conservative defaults if upstream hasn't.
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::HeaderName::from_static("x-frame-options"),
            axum::http::HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::HeaderName::from_static("x-content-type-options"),
            axum::http::HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::HeaderName::from_static("referrer-policy"),
            axum::http::HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
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

    // Auto-start JIRA poller if configured
    {
        let pool_clone = pool_for_poller;
        let poller_clone = poller_for_start;
        tokio::spawn(async move {
            jira_poller::start_poller(pool_clone, &poller_clone).await;
        });
    }

    // Start server
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Hadron Web listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

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
