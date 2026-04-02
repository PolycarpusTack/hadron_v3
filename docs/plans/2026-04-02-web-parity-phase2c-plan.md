# Phase 2c: Background Poller — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side JIRA background poller with admin configuration, auto-triage, and user project subscriptions for feed filtering.

**Architecture:** New `jira_poller.rs` module in hadron-server manages a single `tokio::spawn` background task. Admin configures JQL/interval/creds via API. Poller reads config from DB each cycle, searches JIRA, auto-triages new tickets, persists to `ticket_briefs`. Users subscribe to project keys and the JiraProjectFeed filters by subscriptions.

**Tech Stack:** Rust (tokio, reqwest, sqlx), React 18 + TypeScript + Tailwind CSS, PostgreSQL

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `migrations/015_jira_poller.sql` | Poller config + user subscriptions tables |
| `crates/hadron-server/src/jira_poller.rs` | Background poller task (lifecycle + poll cycle) |
| `crates/hadron-server/src/routes/jira_poller.rs` | Admin poller + user subscription routes |
| `frontend/src/components/admin/JiraPollerPanel.tsx` | Admin poller config UI |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-server/src/main.rs` | Add `mod jira_poller`, PollerState to app, auto-start |
| `crates/hadron-server/src/db/mod.rs` | Add poller config + subscription CRUD |
| `crates/hadron-server/src/routes/mod.rs` | Register poller + subscription routes |
| `frontend/src/services/api.ts` | Add poller types + 6 API methods |
| `frontend/src/components/admin/AdminPanel.tsx` | Add JIRA Poller tab |
| `frontend/src/components/jira/JiraProjectFeed.tsx` | Add subscription UI + filtering |

---

## Task 1: Database Migration

**Files:**
- Create: `hadron-web/migrations/015_jira_poller.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 015_jira_poller.sql
-- Background JIRA poller configuration and user project subscriptions.

CREATE TABLE jira_poller_config (
    id              SERIAL PRIMARY KEY,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    jql_filter      TEXT NOT NULL DEFAULT '',
    interval_mins   INT NOT NULL DEFAULT 30,
    last_polled_at  TIMESTAMPTZ,
    jira_base_url   TEXT NOT NULL DEFAULT '',
    jira_email      TEXT NOT NULL DEFAULT '',
    jira_api_token  TEXT NOT NULL DEFAULT '',
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed single config row
INSERT INTO jira_poller_config (id) VALUES (1);

CREATE TABLE user_project_subscriptions (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    project_key     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, project_key)
);
```

- [ ] **Step 2: Commit**

```bash
git add hadron-web/migrations/015_jira_poller.sql
git commit -m "feat(web): add migration 015 — jira_poller_config + user_project_subscriptions"
```

---

## Task 2: DB Functions for Poller Config + Subscriptions

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`

- [ ] **Step 1: Add poller config and subscription functions**

Append to the end of `hadron-web/crates/hadron-server/src/db/mod.rs`:

```rust
// ============================================================================
// JIRA Poller Config
// ============================================================================

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PollerConfigRow {
    pub enabled: bool,
    pub jql_filter: String,
    pub interval_mins: i32,
    pub last_polled_at: Option<chrono::DateTime<chrono::Utc>>,
    pub jira_base_url: String,
    pub jira_email: String,
    pub jira_api_token: String,
}

pub async fn get_poller_config(pool: &PgPool) -> HadronResult<PollerConfigRow> {
    let row = sqlx::query_as::<_, PollerConfigRow>(
        "SELECT enabled, jql_filter, interval_mins, last_polled_at,
                jira_base_url, jira_email, jira_api_token
         FROM jira_poller_config WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row)
}

pub async fn update_poller_config(
    pool: &PgPool,
    enabled: Option<bool>,
    jql_filter: Option<&str>,
    interval_mins: Option<i32>,
    jira_base_url: Option<&str>,
    jira_email: Option<&str>,
    jira_api_token: Option<&str>,
    user_id: Uuid,
) -> HadronResult<()> {
    sqlx::query(
        "UPDATE jira_poller_config SET
            enabled = COALESCE($1, enabled),
            jql_filter = COALESCE($2, jql_filter),
            interval_mins = COALESCE($3, interval_mins),
            jira_base_url = COALESCE($4, jira_base_url),
            jira_email = COALESCE($5, jira_email),
            jira_api_token = COALESCE($6, jira_api_token),
            updated_by = $7,
            updated_at = NOW()
         WHERE id = 1",
    )
    .bind(enabled)
    .bind(jql_filter)
    .bind(interval_mins)
    .bind(jira_base_url)
    .bind(jira_email)
    .bind(jira_api_token)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

pub async fn update_poller_last_polled(pool: &PgPool) -> HadronResult<()> {
    sqlx::query("UPDATE jira_poller_config SET last_polled_at = NOW() WHERE id = 1")
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;
    Ok(())
}

// ============================================================================
// User Project Subscriptions
// ============================================================================

pub async fn get_user_subscriptions(
    pool: &PgPool,
    user_id: Uuid,
) -> HadronResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT project_key FROM user_project_subscriptions WHERE user_id = $1 ORDER BY project_key",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(|(k,)| k).collect())
}

pub async fn set_user_subscriptions(
    pool: &PgPool,
    user_id: Uuid,
    project_keys: &[String],
) -> HadronResult<()> {
    // Delete all existing, then insert new
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    sqlx::query("DELETE FROM user_project_subscriptions WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    for key in project_keys {
        sqlx::query(
            "INSERT INTO user_project_subscriptions (user_id, project_key) VALUES ($1, $2)",
        )
        .bind(user_id)
        .bind(key)
        .execute(&mut *tx)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}
```

- [ ] **Step 2: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-server/src/db/mod.rs
git commit -m "feat(web): add poller config and user subscription DB functions"
```

---

## Task 3: Background Poller Module

**Files:**
- Create: `hadron-web/crates/hadron-server/src/jira_poller.rs`
- Modify: `hadron-web/crates/hadron-server/src/main.rs`

- [ ] **Step 1: Create `jira_poller.rs`**

Create `hadron-web/crates/hadron-server/src/jira_poller.rs`:

```rust
//! Background JIRA poller — searches JIRA on interval and auto-triages new tickets.

use sqlx::PgPool;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::integrations::jira::{self, JiraConfig};

/// Shared poller state — managed as Axum state extension.
#[derive(Clone)]
pub struct PollerState {
    handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    cancel: Arc<AtomicBool>,
}

impl PollerState {
    pub fn new() -> Self {
        Self {
            handle: Arc::new(Mutex::new(None)),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_cancel_requested(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

/// Poller status for API responses.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollerStatus {
    pub running: bool,
    pub enabled: bool,
    pub jql_filter: String,
    pub interval_mins: i32,
    pub jira_base_url: String,
    pub jira_email: String,
    pub has_api_token: bool,
    pub last_polled_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Start the background poller. Cancels any existing poller first.
pub async fn start_poller(pool: PgPool, state: &PollerState) {
    // Stop existing poller if running
    stop_poller(state).await;

    // Read config
    let config = match crate::db::get_poller_config(&pool).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to read poller config: {e}");
            return;
        }
    };

    if !config.enabled {
        tracing::info!("JIRA poller is disabled");
        return;
    }

    if config.jql_filter.is_empty() {
        tracing::warn!("JIRA poller has empty JQL filter — not starting");
        return;
    }

    if config.jira_base_url.is_empty() || config.jira_email.is_empty() || config.jira_api_token.is_empty() {
        tracing::warn!("JIRA poller credentials not configured — not starting");
        return;
    }

    tracing::info!(
        "Starting JIRA poller (interval={}m, jql='{}')",
        config.interval_mins,
        config.jql_filter
    );

    // Reset cancel flag
    state.cancel.store(false, Ordering::Relaxed);

    let cancel = state.cancel.clone();
    let handle = tokio::spawn(async move {
        poll_loop(pool, cancel).await;
    });

    *state.handle.lock().await = Some(handle);
}

/// Stop the background poller.
pub async fn stop_poller(state: &PollerState) {
    state.cancel.store(true, Ordering::Relaxed);
    let mut guard = state.handle.lock().await;
    if let Some(handle) = guard.take() {
        handle.abort();
        tracing::info!("JIRA poller stopped");
    }
}

/// Get current poller status.
pub async fn get_poller_status(pool: &PgPool, state: &PollerState) -> PollerStatus {
    let config = crate::db::get_poller_config(pool).await.unwrap_or_else(|_| {
        crate::db::PollerConfigRow {
            enabled: false,
            jql_filter: String::new(),
            interval_mins: 30,
            last_polled_at: None,
            jira_base_url: String::new(),
            jira_email: String::new(),
            jira_api_token: String::new(),
        }
    });

    let running = {
        let guard = state.handle.lock().await;
        guard.as_ref().map(|h| !h.is_finished()).unwrap_or(false)
    };

    PollerStatus {
        running,
        enabled: config.enabled,
        jql_filter: config.jql_filter,
        interval_mins: config.interval_mins,
        jira_base_url: config.jira_base_url,
        jira_email: config.jira_email,
        has_api_token: !config.jira_api_token.is_empty(),
        last_polled_at: config.last_polled_at,
    }
}

/// The main poll loop. Runs until cancel is requested.
async fn poll_loop(pool: PgPool, cancel: Arc<AtomicBool>) {
    // Initial delay — don't poll immediately on startup
    tokio::time::sleep(std::time::Duration::from_secs(30)).await;

    let mut consecutive_failures: u32 = 0;

    loop {
        if cancel.load(Ordering::Relaxed) {
            tracing::info!("Poller: cancel requested, exiting");
            break;
        }

        // Re-read config each cycle (allows live changes)
        let config = match crate::db::get_poller_config(&pool).await {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Poller: failed to read config: {e}");
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                continue;
            }
        };

        if !config.enabled {
            tracing::info!("Poller: disabled in config, exiting");
            break;
        }

        // Decrypt API token
        let api_token = match crate::crypto::decrypt_value(&config.jira_api_token) {
            Ok(t) => t,
            Err(e) => {
                tracing::error!("Poller: failed to decrypt API token: {e}");
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                continue;
            }
        };

        let jira_config = JiraConfig {
            base_url: config.jira_base_url.clone(),
            email: config.jira_email.clone(),
            api_token: api_token.clone(),
            project_key: String::new(),
        };

        // Run one poll cycle with timeout
        let cycle_result = tokio::time::timeout(
            std::time::Duration::from_secs(300), // 5 min timeout
            run_poll_cycle(&pool, &jira_config, &config.jql_filter),
        )
        .await;

        match cycle_result {
            Ok(Ok(triaged_count)) => {
                consecutive_failures = 0;
                if triaged_count > 0 {
                    tracing::info!("Poller: triaged {triaged_count} new tickets");
                }
                let _ = crate::db::update_poller_last_polled(&pool).await;
            }
            Ok(Err(e)) => {
                consecutive_failures += 1;
                tracing::warn!(
                    "Poller: cycle failed ({consecutive_failures} consecutive): {e}"
                );
            }
            Err(_) => {
                consecutive_failures += 1;
                tracing::warn!("Poller: cycle timed out ({consecutive_failures} consecutive)");
            }
        }

        // Calculate sleep duration with exponential backoff on failure
        let base_secs = (config.interval_mins.max(5) as u64) * 60;
        let sleep_secs = if consecutive_failures >= 3 {
            let backoff = base_secs * 2u64.pow(consecutive_failures.min(6));
            backoff.min(7200) // cap at 2 hours
        } else {
            base_secs
        };

        tracing::debug!("Poller: sleeping {sleep_secs}s until next cycle");
        tokio::time::sleep(std::time::Duration::from_secs(sleep_secs)).await;
    }
}

/// Run a single poll cycle: search JIRA, skip already-triaged, triage new tickets.
async fn run_poll_cycle(
    pool: &PgPool,
    jira_config: &JiraConfig,
    jql: &str,
) -> Result<u32, String> {
    // Search JIRA
    let search_result = jira::search_issues(jira_config, Some(jql), None, 50)
        .await
        .map_err(|e| format!("JIRA search failed: {e}"))?;

    if search_result.issues.is_empty() {
        return Ok(0);
    }

    // Get existing briefs to skip already-triaged tickets
    let keys: Vec<String> = search_result.issues.iter().map(|i| i.key.clone()).collect();
    let existing = crate::db::get_ticket_briefs_batch(pool, &keys)
        .await
        .map_err(|e| format!("DB batch query failed: {e}"))?;

    let existing_keys: std::collections::HashSet<String> =
        existing.into_iter().map(|b| b.jira_key).collect();

    let new_issues: Vec<_> = search_result
        .issues
        .iter()
        .filter(|i| !existing_keys.contains(&i.key))
        .collect();

    if new_issues.is_empty() {
        return Ok(0);
    }

    // Resolve AI config for triage
    let ai_config = crate::db::get_server_ai_config(pool)
        .await
        .map_err(|e| format!("AI config error: {e}"))?
        .ok_or_else(|| "No AI API key configured — poller cannot triage".to_string())?;

    let mut triaged = 0u32;

    for issue in &new_issues {
        // Fetch full ticket detail
        let ticket = match jira::fetch_issue_detail(jira_config, &issue.key).await {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("Poller: failed to fetch {}: {e}", issue.key);
                continue;
            }
        };

        // Run triage
        let (system_prompt, messages) = hadron_core::ai::build_jira_triage_messages(&ticket);
        let raw_response = match crate::ai::complete(&ai_config, messages, Some(&system_prompt)).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Poller: triage AI call failed for {}: {e}", issue.key);
                continue;
            }
        };

        let triage = match hadron_core::ai::parse_jira_triage(&raw_response) {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("Poller: failed to parse triage for {}: {e}", issue.key);
                continue;
            }
        };

        // Persist
        let tags_json = serde_json::to_string(&triage.tags).unwrap_or_default();
        let triage_json = serde_json::to_string(&triage).unwrap_or_default();
        if let Err(e) = crate::db::upsert_ticket_brief(
            pool,
            &issue.key,
            &ticket.summary,
            Some(&triage.severity),
            Some(&triage.category),
            Some(&tags_json),
            Some(&triage_json),
            None,
        )
        .await
        {
            tracing::warn!("Poller: failed to persist triage for {}: {e}", issue.key);
            continue;
        }

        triaged += 1;
    }

    Ok(triaged)
}
```

- [ ] **Step 2: Register module and add PollerState to main.rs**

Read `hadron-web/crates/hadron-server/src/main.rs`. Make these changes:

1. Add `mod jira_poller;` near the other module declarations (after `mod sse;`).

2. Add `PollerState` to `AppState`:

Change:
```rust
pub struct AppState {
    pub db: sqlx::PgPool,
    pub auth_config: auth::AuthConfig,
    pub jwks_cache: auth::JwksCache,
    pub dev_mode: bool,
}
```

to:

```rust
pub struct AppState {
    pub db: sqlx::PgPool,
    pub auth_config: auth::AuthConfig,
    pub jwks_cache: auth::JwksCache,
    pub dev_mode: bool,
    pub poller: jira_poller::PollerState,
}
```

3. In `main()`, where `AppState` is constructed, add `poller`:

```rust
    let state = AppState {
        db: pool.clone(),
        auth_config,
        jwks_cache: auth::JwksCache::new(),
        dev_mode,
        poller: jira_poller::PollerState::new(),
    };
```

4. After building the router but before starting the server, add auto-start:

```rust
    // Auto-start JIRA poller if configured
    {
        let pool_clone = state.db.clone();
        let poller_clone = state.poller.clone();
        tokio::spawn(async move {
            jira_poller::start_poller(pool_clone, &poller_clone).await;
        });
    }
```

- [ ] **Step 3: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-server/src/jira_poller.rs hadron-web/crates/hadron-server/src/main.rs
git commit -m "feat(web): add background JIRA poller with auto-triage and exponential backoff"
```

---

## Task 4: Poller + Subscription Routes

**Files:**
- Create: `hadron-web/crates/hadron-server/src/routes/jira_poller.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Create route handlers**

Create `hadron-web/crates/hadron-server/src/routes/jira_poller.rs`:

```rust
//! Admin JIRA poller management + user project subscription routes.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::Role;

use super::AppError;

// ============================================================================
// Admin: Poller Config
// ============================================================================

/// GET /api/admin/jira-poller — get config + running status.
pub async fn get_poller_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    let status = crate::jira_poller::get_poller_status(&state.db, &state.poller).await;
    Ok(Json(status))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePollerRequest {
    pub enabled: Option<bool>,
    pub jql_filter: Option<String>,
    pub interval_mins: Option<i32>,
    pub jira_base_url: Option<String>,
    pub jira_email: Option<String>,
    pub jira_api_token: Option<String>,
}

/// PUT /api/admin/jira-poller — update config.
pub async fn update_poller_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<UpdatePollerRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    // Encrypt API token if provided
    let encrypted_token = match req.jira_api_token.as_deref() {
        Some(token) if !token.is_empty() => Some(crate::crypto::encrypt_value(token)?),
        _ => None,
    };

    db::update_poller_config(
        &state.db,
        req.enabled,
        req.jql_filter.as_deref(),
        req.interval_mins,
        req.jira_base_url.as_deref(),
        req.jira_email.as_deref(),
        encrypted_token.as_deref(),
        user.user.id,
    )
    .await?;

    // Audit log
    let _ = db::write_audit_log(
        &state.db,
        user.user.id,
        "admin.jira_poller_config_updated",
        "jira_poller_config",
        None,
        &serde_json::json!({
            "enabled": req.enabled,
            "jql_changed": req.jql_filter.is_some(),
            "token_changed": req.jira_api_token.is_some(),
        }),
        None,
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/admin/jira-poller/start — start the poller.
pub async fn start_poller(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    crate::jira_poller::start_poller(state.db.clone(), &state.poller).await;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/admin/jira-poller/stop — stop the poller.
pub async fn stop_poller(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    crate::jira_poller::stop_poller(&state.poller).await;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// User: Project Subscriptions
// ============================================================================

/// GET /api/jira/subscriptions — get user's subscribed project keys.
pub async fn get_subscriptions(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let keys = db::get_user_subscriptions(&state.db, user.user.id).await?;
    Ok(Json(keys))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSubscriptionsRequest {
    pub project_keys: Vec<String>,
}

/// PUT /api/jira/subscriptions — set user's subscribed project keys.
pub async fn set_subscriptions(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<SetSubscriptionsRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Sanitize keys: uppercase, alphanumeric + dash only, max 20 chars
    let sanitized: Vec<String> = req
        .project_keys
        .iter()
        .map(|k| {
            k.chars()
                .filter(|c| c.is_alphanumeric() || *c == '-')
                .take(20)
                .collect::<String>()
                .to_uppercase()
        })
        .filter(|k| !k.is_empty())
        .collect();

    db::set_user_subscriptions(&state.db, user.user.id, &sanitized).await?;

    Ok(Json(sanitized))
}
```

- [ ] **Step 2: Register routes in `mod.rs`**

In `hadron-web/crates/hadron-server/src/routes/mod.rs`:

Add module declaration:
```rust
mod jira_poller;
```

Add routes inside `api_router()`:
```rust
        // Admin: JIRA Poller
        .route("/admin/jira-poller", get(jira_poller::get_poller_config))
        .route("/admin/jira-poller", put(jira_poller::update_poller_config))
        .route("/admin/jira-poller/start", post(jira_poller::start_poller))
        .route("/admin/jira-poller/stop", post(jira_poller::stop_poller))
        // User: JIRA Subscriptions
        .route("/jira/subscriptions", get(jira_poller::get_subscriptions))
        .route("/jira/subscriptions", put(jira_poller::set_subscriptions))
```

- [ ] **Step 3: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/jira_poller.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(web): add admin poller config and user subscription routes"
```

---

## Task 5: Frontend Types + API Methods

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`

- [ ] **Step 1: Add types and methods**

Add type after `SimilarTicketMatch`:

```typescript
// ============================================================================
// JIRA Poller Types
// ============================================================================

export interface PollerConfigStatus {
  running: boolean;
  enabled: boolean;
  jqlFilter: string;
  intervalMins: number;
  jiraBaseUrl: string;
  jiraEmail: string;
  hasApiToken: boolean;
  lastPolledAt: string | null;
}
```

Add methods to `ApiClient` class:

```typescript
  // === JIRA Poller (Admin) ===

  async getPollerConfig(): Promise<PollerConfigStatus> {
    return this.request("GET", "/admin/jira-poller");
  }

  async updatePollerConfig(config: {
    enabled?: boolean;
    jqlFilter?: string;
    intervalMins?: number;
    jiraBaseUrl?: string;
    jiraEmail?: string;
    jiraApiToken?: string;
  }): Promise<void> {
    return this.request("PUT", "/admin/jira-poller", config);
  }

  async startPoller(): Promise<void> {
    return this.request("POST", "/admin/jira-poller/start");
  }

  async stopPoller(): Promise<void> {
    return this.request("POST", "/admin/jira-poller/stop");
  }

  // === JIRA Subscriptions ===

  async getUserSubscriptions(): Promise<string[]> {
    return this.request("GET", "/jira/subscriptions");
  }

  async setUserSubscriptions(projectKeys: string[]): Promise<string[]> {
    return this.request("PUT", "/jira/subscriptions", { projectKeys });
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts
git commit -m "feat(web): add poller config and subscription types and API methods"
```

---

## Task 6: Admin JiraPollerPanel Component

**Files:**
- Create: `hadron-web/frontend/src/components/admin/JiraPollerPanel.tsx`
- Modify: `hadron-web/frontend/src/components/admin/AdminPanel.tsx`

- [ ] **Step 1: Create JiraPollerPanel**

Create `hadron-web/frontend/src/components/admin/JiraPollerPanel.tsx`:

The component displays:
- JIRA credentials: base URL, email, API token (password) — pre-filled from config
- JQL filter text input
- Interval number input (min 5)
- Enable toggle
- Status: running badge (green dot if running, gray if stopped), last polled timestamp, interval
- "Save" button → `api.updatePollerConfig(...)` 
- "Start" / "Stop" button based on running state → `api.startPoller()` / `api.stopPoller()`
- Auto-refresh status every 15s via `setInterval` + `api.getPollerConfig()`

Props: none (self-contained).

Import from `../../services/api` and `../Toast`. Use dark theme (slate-800/900). Match AiConfigPanel layout style.

Read the desktop `JiraSettings.tsx` (lines 530-672 of `/mnt/c/Projects/Hadron_v3/hadron-desktop/src/components/JiraSettings.tsx`) for UX reference, but adapt for web admin panel.

- [ ] **Step 2: Add to AdminPanel**

In `hadron-web/frontend/src/components/admin/AdminPanel.tsx`:

1. Import: `import { JiraPollerPanel } from "./JiraPollerPanel";`
2. Add to `AdminTab` type: `"jira-poller"`
3. Add to tabs array: `{ key: "jira-poller", label: "JIRA Poller" }`
4. Add render: `{activeTab === "jira-poller" && <JiraPollerPanel />}`

- [ ] **Step 3: Verify TypeScript compiles**

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/admin/JiraPollerPanel.tsx hadron-web/frontend/src/components/admin/AdminPanel.tsx
git commit -m "feat(web): add JiraPollerPanel admin UI with status monitoring"
```

---

## Task 7: Extend JiraProjectFeed with Subscriptions

**Files:**
- Modify: `hadron-web/frontend/src/components/jira/JiraProjectFeed.tsx`

- [ ] **Step 1: Add subscription management and filtering**

Read the current file. Add these features:

1. **New state:**
```typescript
const [subscriptions, setSubscriptions] = useState<string[]>([]);
const [newSubKey, setNewSubKey] = useState("");
```

2. **Load subscriptions on mount:**
```typescript
useEffect(() => {
  api.getUserSubscriptions().then(setSubscriptions).catch(() => {});
}, []);
```

3. **Subscription management UI** — add inline section at top of feed, below the project key input:
   - "Your Subscriptions" label
   - List of subscribed keys as removable pills (click X to remove)
   - Small input + "Add" button to subscribe to a new key
   - On add: call `api.setUserSubscriptions([...subscriptions, newKey])`
   - On remove: call `api.setUserSubscriptions(subscriptions.filter(k => k !== removed))`

4. **Feed filtering:** When `subscriptions.length > 0`, filter the `issues` array to only show issues whose key starts with any subscribed project key (e.g., if subscribed to "PROJ", show "PROJ-1", "PROJ-2", etc.):
```typescript
const filteredBySubscription = subscriptions.length > 0
  ? issues.filter(i => subscriptions.some(sub => i.key.startsWith(sub + "-")))
  : issues;
```
Apply this filter before the existing search/triaged/severity filters.

5. **Graceful fallback:** If no subscriptions, show all issues (don't block the feed).

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/jira/JiraProjectFeed.tsx
git commit -m "feat(web): add project subscription management and filtering to JiraProjectFeed"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Full Rust check**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 2: Run all Rust tests**

Run: `cd hadron-web && cargo test 2>&1 | tail -20`

- [ ] **Step 3: Frontend type check**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 4: Verify new files**

Run: `ls hadron-web/migrations/015_jira_poller.sql && ls hadron-web/crates/hadron-server/src/jira_poller.rs && ls hadron-web/crates/hadron-server/src/routes/jira_poller.rs && ls hadron-web/frontend/src/components/admin/JiraPollerPanel.tsx`

- [ ] **Step 5: Verify migration count**

Run: `ls hadron-web/migrations/ | wc -l`
Expected: 15
