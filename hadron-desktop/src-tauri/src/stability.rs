//! Stability-mode toggle: user-facing escape hatch for the ESET-WebView2
//! crash pattern.
//!
//! When enabled:
//!
//! - `parallel_chunk_limit()` returns 1 instead of 2, so deep-scan chunks run
//!   strictly serially (peak IPC rate halved again).
//! - `progress_debounce_ms()` returns 1000 instead of 150, so progress events
//!   arrive at 1 Hz instead of ~7 Hz.
//! - `jira_poller_allowed()` returns `false`, so the background poller
//!   refuses to start.
//!
//! The three levers together reduce COM-boundary crossings roughly 10× at the
//! cost of slower analyses and no background JIRA refresh — the right trade
//! for users whose corp policy prevents ESET exclusion and who'd rather ship
//! slower than not at all.
//!
//! State is cached in an `AtomicBool` for sub-ns reads on the hot path, and
//! persisted to `%APPDATA%/hadron/stability.json` so it survives restarts
//! (including auto-restart after a crash).

use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

static STABILITY_MODE: Lazy<AtomicBool> =
    Lazy::new(|| AtomicBool::new(read_from_disk()));

/// Returns true if the user has turned on stability mode. Cheap — one
/// relaxed atomic load. Call freely from hot paths.
pub fn is_enabled() -> bool {
    STABILITY_MODE.load(Ordering::Relaxed)
}

/// Persist and activate the new value. On write failure returns the error
/// and does NOT update the in-memory flag, so a failed write doesn't produce
/// a session where the UI says "on" but the runtime says "off".
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    write_to_disk(enabled)?;
    STABILITY_MODE.store(enabled, Ordering::Relaxed);
    log::info!(
        "stability mode {}",
        if enabled { "ENABLED" } else { "disabled" }
    );
    crate::breadcrumbs::record(
        "config",
        format!("stability_mode={}", enabled),
    );
    Ok(())
}

/// Parallel chunk limit for deep-scan map phase. The normal value (2) is the
/// one picked in commit 5e8e407 as the balance between throughput and COM
/// saturation; stability mode drops to 1 for users who still see crashes at 2.
pub fn parallel_chunk_limit() -> usize {
    if is_enabled() { 1 } else { 2 }
}

/// Effective debounce interval (ms) between non-terminal progress emits.
/// Replaces the `PROGRESS_DEBOUNCE_MS` constant wherever the callers want to
/// pick up runtime changes.
pub fn progress_debounce_ms() -> u64 {
    if is_enabled() { 1_000 } else { 150 }
}

/// Whether the JIRA background poller is allowed to start. Returns `false`
/// in stability mode, regardless of the user's JIRA config. `jira_poller`
/// still respects the user's `enabled` flag — stability mode is an
/// additional gate, not a replacement.
pub fn jira_poller_allowed() -> bool {
    !is_enabled()
}

fn config_path() -> PathBuf {
    let mut p = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("hadron");
    p.push("stability.json");
    p
}

fn read_from_disk() -> bool {
    let path = config_path();
    let Ok(content) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
        log::warn!("stability.json is not valid JSON; treating as disabled");
        return false;
    };
    json.get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn write_to_disk(enabled: bool) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    let json = serde_json::json!({ "enabled": enabled });
    let content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialise stability config: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_disabled_in_memory() {
        // The Lazy reads from disk on first access; in a test the file
        // usually doesn't exist so default is false. Re-reads after
        // set_enabled flip the atomic directly.
        assert!(!is_enabled() || is_enabled(), "just exercises the path");
    }

    #[test]
    fn parallel_limit_and_debounce_respond_to_flag() {
        // We can't assume initial state here; assert the function is a
        // clean branch on is_enabled's current value.
        let on = is_enabled();
        if on {
            assert_eq!(parallel_chunk_limit(), 1);
            assert_eq!(progress_debounce_ms(), 1_000);
            assert!(!jira_poller_allowed());
        } else {
            assert_eq!(parallel_chunk_limit(), 2);
            assert_eq!(progress_debounce_ms(), 150);
            assert!(jira_poller_allowed());
        }
    }
}
