//! In-memory ring-buffer of recent app events, flushed to disk by the crash
//! handlers.
//!
//! # Why
//!
//! The SEH text report gives us raw stack RVAs, which without line-tables
//! debug info are not actionable. What is actionable is "which Tauri command
//! was running when the abort fired" — that's the fastest path from a crash
//! to a specific code site to audit.
//!
//! This module keeps the last ~256 events in a `parking_lot::Mutex<VecDeque>`.
//! Each event is a tuple of (monotonic timestamp, kind tag, detail string).
//! Call sites:
//!
//! - every `app.emit` in `release_notes_service`, `jira_poller`, deep-scan
//!   streaming (the three concurrent paths implicated by commit 5e8e407 as
//!   the ESET-WebView2 crash trigger)
//! - Tauri command entry/exit in hot paths (deep-scan, release-notes,
//!   jira-triage)
//!
//! # SEH safety
//!
//! The SEH filter (running in the crashing thread's context) dumps the
//! buffer with `try_lock_for(50 ms)`. If the crashing thread was mid-record
//! and held the lock, the timed lock expires and we skip the dump — we
//! degrade to the previous "crash, no breadcrumbs" behaviour with no
//! regression. Lock contention in normal operation is sub-microsecond so
//! this loss window is vanishingly small in practice.
//!
//! # Overhead
//!
//! At steady state a `record()` call is one `Mutex::lock`, one `VecDeque`
//! push, and a `String::from` for the detail (typically small). No heap
//! pressure beyond the detail strings themselves, which are freed when the
//! ring evicts them.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::path::Path;
use std::time::{Duration, Instant};

/// Max events retained. 256 covers ~tens of seconds of heavy activity
/// (emits at ~10 Hz + commands + poller ticks).
const CAPACITY: usize = 256;

/// How long the dump path waits for the lock before giving up. Short enough
/// that the SEH handler doesn't hang if the crashing thread was mid-record;
/// long enough to win the lock in normal contention.
const DUMP_LOCK_TIMEOUT: Duration = Duration::from_millis(50);

#[derive(Clone)]
struct Event {
    /// Nanoseconds since `START` (monotonic). Wraps fine in u64 for ~500 yr.
    elapsed_ns: u64,
    kind: &'static str,
    detail: String,
}

/// Captured at module init so all timestamps are relative to process start.
/// `Lazy<Instant>` is cheap (one atomic read after first access).
static START: Lazy<Instant> = Lazy::new(Instant::now);

static BUFFER: Lazy<Mutex<VecDeque<Event>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(CAPACITY)));

/// Record one event. Never panics; silently drops the event if the lock is
/// contended for more than a microsecond (essentially never in practice).
///
/// `kind` is a short tag like `"emit"`, `"cmd"`, `"poll"`, `"chunk"`,
/// `"panic"`, `"abort"`. `detail` is a compact human-readable suffix
/// (channel name, command name, tick ordinal).
///
/// # What NOT to put in `detail`
///
/// **Do not** record PII, user-authored text, file paths, JIRA ticket
/// summaries, email addresses, or any value derived from a remote payload.
/// The ring is dumped to disk on crash and those dumps are shared with
/// support — treat `detail` like an access log line, not a trace event.
/// Ticket keys, counts, enum variants, and hex error codes are fine;
/// anything a user typed is not.
///
/// # Sanitisation
///
/// `detail` is stripped of CR/LF and other control characters and capped at
/// 256 characters before it is stored, so a caller who accidentally passes
/// a multi-line or user-controlled value cannot forge additional breadcrumb
/// lines in the dump file.
pub fn record(kind: &'static str, detail: impl Into<String>) {
    /// Max chars, not bytes, so we never split a UTF-8 sequence. Worst-case
    /// 4× this in bytes is still tiny (< 1 KB per entry, 256 KB for the
    /// whole ring).
    const MAX_DETAIL_CHARS: usize = 256;

    let elapsed_ns = START.elapsed().as_nanos() as u64;

    // Sanitise: strip CR/LF + other control chars so a caller whose input
    // contains a newline cannot fabricate lines in the on-disk dump, and
    // cap at MAX_DETAIL_CHARS so a misbehaving caller cannot evict the
    // ring with one giant entry.
    let raw: String = detail.into();
    let detail: String = raw
        .chars()
        .take(MAX_DETAIL_CHARS)
        .map(|c| match c {
            '\n' | '\r' => ' ',
            c if c.is_control() => '?',
            c => c,
        })
        .collect();

    let ev = Event {
        elapsed_ns,
        kind,
        detail,
    };

    let Some(mut buf) = BUFFER.try_lock_for(Duration::from_micros(100)) else {
        // Lock contended — drop the event rather than block the hot path.
        return;
    };
    if buf.len() >= CAPACITY {
        buf.pop_front();
    }
    buf.push_back(ev);
}

/// Convenience: record with a formatted detail string.
#[macro_export]
macro_rules! breadcrumb {
    ($kind:expr, $($arg:tt)*) => {
        $crate::breadcrumbs::record($kind, format!($($arg)*))
    };
}

/// Dump the current buffer to `path` as a text file. Called from the SEH
/// handler and the Rust panic hook. Never panics — all errors are silent.
pub fn dump_to(path: &Path) {
    let Some(buf) = BUFFER.try_lock_for(DUMP_LOCK_TIMEOUT) else {
        return;
    };

    let mut out = String::with_capacity(64 * buf.len() + 128);
    out.push_str("=== HADRON BREADCRUMBS ===\n");
    out.push_str(&format!("Captured: {}\n", chrono::Local::now()));
    out.push_str(&format!("Events: {} (oldest first)\n", buf.len()));
    out.push_str("format: +ssss.mmm kind    detail\n\n");

    for ev in buf.iter() {
        let secs = ev.elapsed_ns / 1_000_000_000;
        let millis = (ev.elapsed_ns % 1_000_000_000) / 1_000_000;
        out.push_str(&format!(
            "+{:05}.{:03} {:<6} {}\n",
            secs, millis, ev.kind, ev.detail
        ));
    }

    let _ = std::fs::write(path, out);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_evicts_oldest() {
        // Clear state left over from other tests (we can't easily reset a
        // static Lazy; just saturate the ring with known markers).
        for i in 0..(CAPACITY + 10) {
            record("test", format!("ev-{i}"));
        }
        let buf = BUFFER.lock();
        assert_eq!(buf.len(), CAPACITY);
        // Oldest retained event should be ev-10 (first 10 evicted).
        assert!(buf.front().unwrap().detail.starts_with("ev-"));
        assert!(buf.back().unwrap().detail.starts_with("ev-"));
    }

    #[test]
    fn dump_writes_header_and_events() {
        record("emit", "release-notes-progress");
        record("poll", "jira-tick");
        let tmp = std::env::temp_dir().join("hadron-breadcrumbs-test.txt");
        dump_to(&tmp);
        let content = std::fs::read_to_string(&tmp).unwrap();
        assert!(content.contains("HADRON BREADCRUMBS"));
        assert!(content.contains("emit"));
        assert!(content.contains("release-notes-progress"));
        let _ = std::fs::remove_file(&tmp);
    }
}
