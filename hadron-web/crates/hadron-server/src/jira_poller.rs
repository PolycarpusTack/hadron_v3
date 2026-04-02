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

    if config.jira_base_url.is_empty()
        || config.jira_email.is_empty()
        || config.jira_api_token.is_empty()
    {
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
    let config = crate::db::get_poller_config(pool)
        .await
        .unwrap_or_else(|_| crate::db::PollerConfigRow {
            enabled: false,
            jql_filter: String::new(),
            interval_mins: 30,
            last_polled_at: None,
            jira_base_url: String::new(),
            jira_email: String::new(),
            jira_api_token: String::new(),
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
        let raw_response =
            match crate::ai::complete(&ai_config, messages, Some(&system_prompt)).await {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!(
                        "Poller: triage AI call failed for {}: {e}",
                        issue.key
                    );
                    continue;
                }
            };

        let triage = match hadron_core::ai::parse_jira_triage(&raw_response) {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!(
                    "Poller: failed to parse triage for {}: {e}",
                    issue.key
                );
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
            tracing::warn!(
                "Poller: failed to persist triage for {}: {e}",
                issue.key
            );
            continue;
        }

        triaged += 1;
    }

    Ok(triaged)
}
