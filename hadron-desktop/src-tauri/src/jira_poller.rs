//! JIRA Assist background poller — Sprint 7.
//!
//! Watches a user-defined JQL filter on a configurable interval and auto-triages
//! new tickets.  Runs as a Tokio task spawned at app startup (if enabled).
//!
//! Config is read from the Tauri plugin-store (`settings.json`), the same file
//! that holds JIRA credentials and AI provider settings.

use crate::database::Database;
use crate::jira_service;
use crate::jira_triage::JiraTriageRequest;
use crate::ticket_briefs::TicketBrief;
use serde::{Deserialize, Serialize};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tokio::task::JoinHandle;

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct JiraPollerConfig {
    pub enabled: bool,
    pub jql_filter: String,
    pub interval_mins: u64, // min 5, default 30
    pub last_polled_at: Option<String>,
}

/// Read poller config from the Tauri store.
pub fn read_poller_config(app: &AppHandle) -> JiraPollerConfig {
    let store = match app.get_store("settings.json") {
        Some(s) => s,
        None => return default_config(),
    };

    let enabled = store
        .get("jira_assist_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let jql_filter = store
        .get("jira_assist_jql")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    let interval_mins = store
        .get("jira_assist_interval_mins")
        .and_then(|v| v.as_u64())
        .unwrap_or(30)
        .max(5);
    let last_polled_at = store
        .get("jira_assist_last_polled_at")
        .and_then(|v| v.as_str().map(String::from));

    JiraPollerConfig {
        enabled,
        jql_filter,
        interval_mins,
        last_polled_at,
    }
}

fn default_config() -> JiraPollerConfig {
    JiraPollerConfig {
        enabled: false,
        jql_filter: String::new(),
        interval_mins: 30,
        last_polled_at: None,
    }
}

/// Write last_polled_at back to the store.
pub fn write_last_polled_at(app: &AppHandle, timestamp: &str) {
    if let Some(store) = app.get_store("settings.json") {
        store.set(
            "jira_assist_last_polled_at",
            serde_json::Value::String(timestamp.to_string()),
        );
        if let Err(e) = store.save() {
            log::warn!("poller: failed to save store: {}", e);
        }
    }
}

// ── Credentials from store ────────────────────────────────────────────────────

struct JiraCreds {
    base_url: String,
    email: String,
    api_token: String,
}

struct AiCreds {
    api_key: String,
    model: String,
    provider: String,
}

fn read_jira_creds(app: &AppHandle) -> Option<JiraCreds> {
    let store = app.get_store("settings.json")?;
    let base_url = store
        .get("jira_base_url")
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty())?;
    // Never send credentials over plain HTTP
    if !base_url.starts_with("https://") {
        log::warn!("poller: jira_base_url does not use https, skipping poll");
        return None;
    }
    let email = store
        .get("jira_email")
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty())?;
    let api_token = store
        .get("jira_api_key")
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty())?;
    Some(JiraCreds {
        base_url,
        email,
        api_token,
    })
}

fn read_ai_creds(app: &AppHandle) -> Option<AiCreds> {
    let store = app.get_store("settings.json")?;
    let provider = store
        .get("ai_provider")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "openai".to_string());
    let model = store
        .get("ai_model")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "gpt-4o-mini".to_string());
    let api_key_name = format!("{}_api_key", provider);
    let api_key = store
        .get(&api_key_name)
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty())?;
    Some(AiCreds {
        api_key,
        model,
        provider,
    })
}

// ── ADF → plaintext ──────────────────────────────────────────────────────────

/// Recursively extract plain text from a JIRA ADF (Atlassian Document Format) JSON value.
fn adf_to_plaintext(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => {
            // Text node
            if let Some(text) = map.get("text").and_then(|t| t.as_str()) {
                return text.to_string();
            }
            // Container node — recurse into "content"
            if let Some(content) = map.get("content").and_then(|c| c.as_array()) {
                let parts: Vec<String> = content.iter().map(adf_to_plaintext).collect();
                return parts.join("");
            }
            String::new()
        }
        serde_json::Value::Array(arr) => {
            let parts: Vec<String> = arr.iter().map(adf_to_plaintext).collect();
            parts.join("\n")
        }
        serde_json::Value::String(s) => s.clone(),
        _ => String::new(),
    }
}

// ── Poll event payload ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollCompletePayload {
    pub triaged_count: usize,
    pub keys: Vec<String>,
}

// ── Poller status ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollerStatus {
    pub running: bool,
    pub last_polled_at: Option<String>,
    pub tickets_triaged_total: u64,
    pub interval_mins: u64,
}

// ── Managed state ────────────────────────────────────────────────────────────

pub struct PollerState {
    handle: Mutex<Option<JoinHandle<()>>>,
    cancel: Arc<AtomicBool>,
    pub triaged_total: AtomicU64,
}

impl PollerState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
            cancel: Arc::new(AtomicBool::new(false)),
            triaged_total: AtomicU64::new(0),
        }
    }
}

// ── Core poll cycle ──────────────────────────────────────────────────────────

/// Run a single poll cycle: fetch tickets, filter already-triaged, triage new ones.
/// Returns the list of newly triaged jira_keys.
async fn run_poll_cycle(
    app: &AppHandle,
    db: &Arc<Database>,
    config: &JiraPollerConfig,
) -> Result<Vec<String>, String> {
    let jira = read_jira_creds(app).ok_or("JIRA credentials not configured")?;
    let ai = read_ai_creds(app).ok_or("AI credentials not configured")?;

    // Build JQL — append date filter if we have a last_polled_at
    let jql = if let Some(ref ts) = config.last_polled_at {
        format!("({}) AND updated >= \"{}\"", config.jql_filter, ts)
    } else {
        config.jql_filter.clone()
    };

    log::info!("poller: searching JIRA with JQL: {}", jql);

    // Fetch up to 50 tickets (no comments needed for triage)
    let search_result = jira_service::search_jira_issues(
        jira.base_url,
        jira.email,
        jira.api_token,
        jql,
        50,
        false,
    )
    .await?;

    if search_result.issues.is_empty() {
        log::debug!("poller: no tickets found");
        return Ok(Vec::new());
    }

    // Filter out tickets that already have a brief in the DB
    let all_keys: Vec<String> = search_result.issues.iter().map(|i| i.key.clone()).collect();
    let db2 = Arc::clone(db);
    let keys_for_query = all_keys.clone();
    let existing = tauri::async_runtime::spawn_blocking(move || {
        db2.get_ticket_briefs_batch(&keys_for_query)
            .map_err(|e| format!("Database error: {e}"))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    let existing_keys: std::collections::HashSet<String> =
        existing.into_iter().map(|b| b.jira_key).collect();

    let new_issues: Vec<_> = search_result
        .issues
        .into_iter()
        .filter(|i| !existing_keys.contains(&i.key))
        .collect();

    if new_issues.is_empty() {
        log::debug!("poller: all {} tickets already triaged", all_keys.len());
        return Ok(Vec::new());
    }

    log::info!(
        "poller: triaging {} new tickets (skipped {} existing)",
        new_issues.len(),
        existing_keys.len()
    );

    let mut triaged_keys = Vec::new();

    for issue in &new_issues {
        let description = issue
            .fields
            .description
            .as_ref()
            .map(adf_to_plaintext)
            .unwrap_or_default();

        let components: Vec<String> = issue
            .fields
            .components
            .iter()
            .map(|c| c.name.clone())
            .collect();

        let request = JiraTriageRequest {
            jira_key: issue.key.clone(),
            title: issue.fields.summary.clone(),
            description: description.clone(),
            issue_type: issue.fields.issuetype.name.clone(),
            priority: issue.fields.priority.as_ref().map(|p| p.name.clone()),
            status: Some(issue.fields.status.name.clone()),
            components,
            labels: issue.fields.labels.clone(),
            comments: Vec::new(), // no comments in feed fetch
            model: ai.model.clone(),
            provider: ai.provider.clone(),
        };

        match crate::jira_triage::run_jira_triage(request, &ai.api_key).await {
            Ok(result) => {
                // Persist to ticket_briefs (same pattern as triage_jira_ticket command)
                let tags_json = serde_json::to_string(&result.tags)
                    .unwrap_or_else(|_| "[]".to_string());
                let triage_json = match serde_json::to_string(&result) {
                    Ok(j) => j,
                    Err(e) => {
                        log::warn!("poller: failed to serialize triage for {}: {e}", issue.key);
                        continue;
                    }
                };

                let brief = TicketBrief {
                    jira_key: issue.key.clone(),
                    title: issue.fields.summary.clone(),
                    customer: None,
                    severity: Some(result.severity),
                    category: Some(result.category),
                    tags: Some(tags_json),
                    triage_json: Some(triage_json),
                    brief_json: None,
                    posted_to_jira: false,
                    posted_at: None,
                    engineer_rating: None,
                    engineer_notes: None,
                    created_at: String::new(),
                    updated_at: String::new(),
                };

                let db3 = Arc::clone(db);
                if let Err(e) = tauri::async_runtime::spawn_blocking(move || {
                    db3.upsert_ticket_brief(&brief)
                })
                .await
                .map_err(|e| format!("Task error: {e}"))?
                {
                    log::warn!("poller: failed to persist triage for {}: {e}", issue.key);
                    continue;
                }

                triaged_keys.push(issue.key.clone());
            }
            Err(e) => {
                log::warn!("poller: triage failed for {}: {e}", issue.key);
                // Continue with remaining tickets
            }
        }
    }

    Ok(triaged_keys)
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/// Start the background poller. Cancels any existing task first.
pub fn start_poller(app: AppHandle, db: Arc<Database>, state: &PollerState) {
    // Cancel previous task if running
    stop_poller(state);

    let config = read_poller_config(&app);
    if !config.enabled || config.jql_filter.is_empty() {
        log::info!("poller: not starting (enabled={}, jql='{}')", config.enabled, config.jql_filter);
        return;
    }
    // Stability mode disables the poller entirely — one of its three levers
    // for removing the background COM traffic that ESET destabilises.
    if !crate::stability::jira_poller_allowed() {
        log::info!("poller: not starting (stability mode enabled)");
        crate::breadcrumbs::record("config", "jira poller suppressed by stability mode");
        return;
    }

    // Reset the cancel flag so the new task sees false;
    // stop_poller() sets this same Arc to true for graceful shutdown.
    state.cancel.store(false, Ordering::Relaxed);
    let cancel_flag = Arc::clone(&state.cancel);

    let interval_mins = config.interval_mins;
    let app2 = app.clone();

    log::info!(
        "poller: starting (interval={}m, jql='{}')",
        interval_mins,
        config.jql_filter
    );

    let handle = tokio::spawn(async move {
        let mut consecutive_failures: u32 = 0;
        let base_interval = std::time::Duration::from_secs(interval_mins * 60);

        // Initial delay — don't poll immediately on startup, wait 30s
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;

        loop {
            if cancel_flag.load(Ordering::Relaxed) {
                log::info!("poller: cancelled");
                break;
            }

            // Re-read config each cycle (user may have changed JQL)
            let cycle_config = read_poller_config(&app2);
            if !cycle_config.enabled {
                log::info!("poller: disabled by config, stopping");
                break;
            }

            crate::breadcrumbs::record("poll", "jira-tick start");

            // Timeout the entire poll cycle to prevent hung network calls from stalling the poller.
            let cycle_timeout = std::time::Duration::from_secs(5 * 60);
            match tokio::time::timeout(cycle_timeout, run_poll_cycle(&app2, &db, &cycle_config)).await {
                Err(_elapsed) => {
                    consecutive_failures += 1;
                    log::warn!(
                        "poller: cycle timed out after {}s ({} consecutive failures)",
                        cycle_timeout.as_secs(),
                        consecutive_failures
                    );
                    // Skip emitting while an analysis is running — the combined
                    // IPC rate can destabilise the WebView2 boundary under ESET.
                    // The DB state + counter above are persisted regardless; the
                    // UI will catch up on the next poll cycle that finds the app
                    // idle.
                    if crate::commands::common::helpers::is_analysis_active() {
                        log::debug!(
                            "poller: analysis active, suppressing jira-assist-poll-error IPC (cycle timeout)"
                        );
                    } else {
                        crate::breadcrumbs::record("emit", "jira-assist-poll-error (timeout)");
                        let _ = app2.emit("jira-assist-poll-error", "Poll cycle timed out");
                    }
                }
                Ok(inner) => match inner {
                    Ok(keys) => {
                        consecutive_failures = 0;
                        let count = keys.len();

                        // Update last_polled_at
                        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M").to_string();
                        write_last_polled_at(&app2, &now);

                        // Skip emitting results if cancelled during this cycle
                        if count > 0 && !cancel_flag.load(Ordering::Relaxed) {
                            // Update total
                            if let Some(poller_state) = app2.try_state::<PollerState>() {
                                poller_state
                                    .triaged_total
                                    .fetch_add(count as u64, Ordering::Relaxed);
                            }

                            // Emit frontend event — but only if no analysis is
                            // running. The DB/counter updates above already
                            // happened, so suppression here just defers visual
                            // notification until the UI is idle again.
                            if crate::commands::common::helpers::is_analysis_active() {
                                log::debug!(
                                    "poller: analysis active, suppressing jira-assist-poll-complete IPC ({} keys will appear on next idle cycle)",
                                    count
                                );
                            } else {
                                let payload = PollCompletePayload {
                                    triaged_count: count,
                                    keys: keys.clone(),
                                };
                                crate::breadcrumbs::record(
                                    "emit",
                                    format!("jira-assist-poll-complete n={}", count),
                                );
                                let _ = app2.emit("jira-assist-poll-complete", &payload);
                            }

                            // OS notification
                            if let Err(e) = send_notification(&app2, count) {
                                log::warn!("poller: notification failed: {e}");
                            }

                            log::info!("poller: triaged {} new tickets", count);
                        } else {
                            log::debug!("poller: no new tickets to triage");
                        }
                    }
                    Err(e) => {
                        consecutive_failures += 1;
                        log::warn!(
                            "poller: cycle failed ({} consecutive): {e}",
                            consecutive_failures
                        );

                        // Emit error event so frontend can show a warning —
                        // same idle guard as the success path above.
                        if crate::commands::common::helpers::is_analysis_active() {
                            log::debug!(
                                "poller: analysis active, suppressing jira-assist-poll-error IPC (error: {e})"
                            );
                        } else {
                            crate::breadcrumbs::record("emit", "jira-assist-poll-error");
                            let _ = app2.emit("jira-assist-poll-error", &e);
                        }
                    }
                }
            }

            // Sleep — back off on consecutive failures (2x each, cap at 2h)
            let sleep_duration = if consecutive_failures >= 3 {
                let backoff = base_interval * 2u32.pow(consecutive_failures.min(6));
                let max = std::time::Duration::from_secs(2 * 60 * 60);
                backoff.min(max)
            } else {
                base_interval
            };

            log::debug!("poller: sleeping for {}s", sleep_duration.as_secs());
            tokio::time::sleep(sleep_duration).await;
        }
    });

    *state.handle.lock() = Some(handle);
}

/// Stop the background poller if running.
pub fn stop_poller(state: &PollerState) {
    state.cancel.store(true, Ordering::Relaxed);
    if let Some(handle) = state.handle.lock().take() {
        handle.abort();
        log::info!("poller: stopped");
    }
}

/// Get current poller status.
pub fn get_poller_status(state: &PollerState, app: &AppHandle) -> PollerStatus {
    let running = state
        .handle
        .lock()
        .as_ref()
        .map(|h| !h.is_finished())
        .unwrap_or(false);
    let config = read_poller_config(app);

    PollerStatus {
        running,
        last_polled_at: config.last_polled_at,
        tickets_triaged_total: state.triaged_total.load(Ordering::Relaxed),
        interval_mins: config.interval_mins,
    }
}

// ── Notification helper ──────────────────────────────────────────────────────

fn send_notification(app: &AppHandle, count: usize) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let body = if count == 1 {
        "Hadron triaged 1 new ticket".to_string()
    } else {
        format!("Hadron triaged {} new tickets", count)
    };

    app.notification()
        .builder()
        .title("JIRA Assist")
        .body(&body)
        .show()
        .map_err(|e| format!("Notification error: {e}"))?;

    Ok(())
}
