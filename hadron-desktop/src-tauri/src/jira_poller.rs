//! JIRA Assist background poller — Sprint 1 stub.
//!
//! The poller watches a JQL filter on a configurable interval and auto-triages
//! new tickets. This stub is config-ready but never starts the actual loop.
//! Activate in Phase 2 / Sprint 7 by implementing `start_if_enabled`.

#[allow(dead_code)]
pub struct JiraPollerConfig {
    pub jql_filter: String,
    pub poll_interval_secs: u64,
    pub enabled: bool,
}

/// Start the poller if enabled. Currently a no-op (Phase 2 feature).
/// Called at app startup after settings are loaded.
#[allow(dead_code)]
pub fn start_if_enabled(_config: JiraPollerConfig) {
    // Phase 2: spawn a tokio interval task here when config.enabled is true.
}
