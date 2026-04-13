//! Common helper functions shared across command modules

use super::types::{AnalysisPhase, AnalysisProgress};
use once_cell::sync::Lazy;
use regex::Regex;
use std::borrow::Cow;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::fs as async_fs;

/// Minimum interval (ms) between non-terminal progress emissions.
/// Reduces IPC pressure on Windows where each app.emit() crosses a COM boundary
/// that security products (ESET, etc.) may hook and inspect.
const PROGRESS_DEBOUNCE_MS: u64 = 150;

/// Interval (ms) for rolling rate log lines during an active analysis.
const RATE_LOG_INTERVAL_MS: u64 = 5_000;

/// Timestamp (ms since epoch) of the last non-terminal progress emission.
static LAST_PROGRESS_EMIT_MS: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

/// Timestamp (ms) when the current analysis started (reset on Reading phase).
static ANALYSIS_START_MS: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

/// Timestamp (ms) of the last rolling rate log line.
static LAST_RATE_LOG_MS: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

/// Counter of progress events emitted in the current analysis run.
static ANALYSIS_EMIT_COUNT: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

/// Counter of total progress events emitted across all analyses (for observability).
pub static PROGRESS_EMIT_COUNT: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Helper to emit progress events to the frontend.
///
/// Terminal events (Complete, Failed) are always emitted immediately.
/// Non-terminal events are debounced to at most once per 150ms to reduce
/// IPC/COM crossing frequency on Windows.
///
/// Observability: resets counters on `Reading` phase (analysis start),
/// logs rolling emit rate every 5s during analysis, and logs a summary
/// on `Complete`/`Failed`.
pub fn emit_progress(app: &AppHandle, progress: AnalysisProgress) {
    let now = now_ms();
    let is_terminal = matches!(
        progress.phase,
        AnalysisPhase::Complete | AnalysisPhase::Failed
    );

    // Reset counters when a new analysis begins
    if matches!(progress.phase, AnalysisPhase::Reading) {
        ANALYSIS_START_MS.store(now, Ordering::Relaxed);
        ANALYSIS_EMIT_COUNT.store(0, Ordering::Relaxed);
        LAST_RATE_LOG_MS.store(now, Ordering::Relaxed);
        log::info!("Analysis progress tracking started");
    }

    if !is_terminal {
        let prev = LAST_PROGRESS_EMIT_MS.load(Ordering::Relaxed);

        if now.saturating_sub(prev) < PROGRESS_DEBOUNCE_MS {
            return; // skip — too soon since last emit
        }
        LAST_PROGRESS_EMIT_MS.store(now, Ordering::Relaxed);
    }

    let run_count = ANALYSIS_EMIT_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    PROGRESS_EMIT_COUNT.fetch_add(1, Ordering::Relaxed);

    if let Err(e) = app.emit("analysis-progress", &progress) {
        log::warn!("Failed to emit progress event: {}", e);
    }

    // Rolling rate log every 5 seconds during active analysis
    if !is_terminal {
        let last_log = LAST_RATE_LOG_MS.load(Ordering::Relaxed);
        if now.saturating_sub(last_log) >= RATE_LOG_INTERVAL_MS {
            LAST_RATE_LOG_MS.store(now, Ordering::Relaxed);
            let started = ANALYSIS_START_MS.load(Ordering::Relaxed);
            let elapsed_s = now.saturating_sub(started) as f64 / 1000.0;
            let rate = if elapsed_s > 0.0 {
                run_count as f64 / elapsed_s
            } else {
                0.0
            };
            log::info!(
                "Progress IPC rate: {} emits in {:.1}s ({:.1}/s), phase: {:?}",
                run_count,
                elapsed_s,
                rate,
                progress.phase
            );
        }
    }

    // Summary on analysis completion
    if is_terminal {
        let started = ANALYSIS_START_MS.load(Ordering::Relaxed);
        let elapsed_s = now.saturating_sub(started) as f64 / 1000.0;
        let rate = if elapsed_s > 0.0 {
            run_count as f64 / elapsed_s
        } else {
            0.0
        };
        log::info!(
            "Analysis {:?}: {} progress emits in {:.1}s ({:.1}/s, global total: {})",
            progress.phase,
            run_count,
            elapsed_s,
            rate,
            PROGRESS_EMIT_COUNT.load(Ordering::Relaxed)
        );
    }
}

/// Normalize severity to uppercase standard values
pub fn normalize_severity(severity: &str) -> String {
    match severity.to_lowercase().as_str() {
        "critical" => "CRITICAL".to_string(),
        "high" => "HIGH".to_string(),
        "medium" => "MEDIUM".to_string(),
        "low" => "LOW".to_string(),
        "info" => "LOW".to_string(),
        _ => "MEDIUM".to_string(),
    }
}

// PERFORMANCE: Pre-compiled regexes for PII redaction (compiled once, reused forever)
static EMAIL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
        .expect("EMAIL_RE is a valid regex pattern")
});
static IPV4_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b\d{1,3}(?:\.\d{1,3}){3}\b").expect("IPV4_RE is a valid regex pattern")
});
static TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\bsk-[A-Za-z0-9-]{10,}").expect("TOKEN_RE is a valid regex pattern")
});
static WIN_PATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)C:\\Users\\[^\\\s]+").expect("WIN_PATH_RE is a valid regex pattern")
});
static UNIX_HOME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"/home/[^/\s]+").expect("UNIX_HOME_RE is a valid regex pattern")
});

/// Redact PII from text using optimized Cow-based approach
pub fn redact_pii_basic(text: &str) -> Cow<'_, str> {
    // Fast path: check if any patterns match before allocating
    let has_pii = EMAIL_RE.is_match(text)
        || IPV4_RE.is_match(text)
        || TOKEN_RE.is_match(text)
        || WIN_PATH_RE.is_match(text)
        || UNIX_HOME_RE.is_match(text);

    // If no PII found, return borrowed reference (zero allocation)
    if !has_pii {
        return Cow::Borrowed(text);
    }

    // Only allocate once we know there's something to replace
    let mut redacted = text.to_string();

    // Email addresses
    if EMAIL_RE.is_match(&redacted) {
        redacted = EMAIL_RE
            .replace_all(&redacted, "[REDACTED_EMAIL]")
            .into_owned();
    }

    // IPv4 addresses
    if IPV4_RE.is_match(&redacted) {
        redacted = IPV4_RE.replace_all(&redacted, "[REDACTED_IP]").into_owned();
    }

    // Token-like strings (e.g., sk-... keys)
    if TOKEN_RE.is_match(&redacted) {
        redacted = TOKEN_RE
            .replace_all(&redacted, "[REDACTED_TOKEN]")
            .into_owned();
    }

    // Windows user paths: C:\Users\Name\
    if WIN_PATH_RE.is_match(&redacted) {
        redacted = WIN_PATH_RE
            .replace_all(&redacted, "C:\\Users\\[REDACTED_USER]")
            .into_owned();
    }

    // Unix home paths: /home/name/
    if UNIX_HOME_RE.is_match(&redacted) {
        redacted = UNIX_HOME_RE
            .replace_all(&redacted, "/home/[REDACTED_USER]")
            .into_owned();
    }

    Cow::Owned(redacted)
}

/// Detect PII types present in text (detection only, no redaction)
pub fn detect_pii_types(text: &str) -> Vec<&'static str> {
    let mut types = Vec::new();
    if EMAIL_RE.is_match(text) { types.push("email"); }
    if IPV4_RE.is_match(text) { types.push("ip"); }
    if TOKEN_RE.is_match(text) { types.push("token"); }
    if WIN_PATH_RE.is_match(text) || UNIX_HOME_RE.is_match(text) { types.push("path"); }
    types
}

/// Validate and canonicalize a file path for safe access
pub async fn validate_file_path(
    raw_path: &str,
    max_size: u64,
) -> Result<std::path::PathBuf, String> {
    // SECURITY: Check raw input path BEFORE canonicalize to reject early
    if raw_path.contains("..") {
        log::warn!("Path traversal attempt detected: {}", raw_path);
        return Err("Invalid file path: path traversal not allowed".to_string());
    }

    let file_path = std::path::Path::new(raw_path);
    let canonical_path = async_fs::canonicalize(file_path).await.map_err(|e| {
        log::error!("Failed to canonicalize path '{}': {}", raw_path, e);
        "Invalid file path: file not found or inaccessible".to_string()
    })?;

    // Block access to sensitive system directories (Unix).
    // Allow /var/log, /var/tmp, /usr/local — common locations for traces and app data.
    let path_str = canonical_path.to_string_lossy();
    let blocked_prefixes_unix = [
        "/etc", "/sbin", "/root", "/sys", "/proc",
    ];
    let blocked_exact_unix = [
        "/usr/bin", "/usr/sbin", "/usr/lib",
        "/var/run", "/var/spool",
    ];
    for prefix in &blocked_prefixes_unix {
        if path_str.starts_with(prefix) {
            log::warn!("Blocked access to system directory: {}", prefix);
            return Err(format!("Access denied: cannot read files from {}", prefix));
        }
    }
    for prefix in &blocked_exact_unix {
        if path_str.starts_with(prefix) {
            log::warn!("Blocked access to system directory: {}", prefix);
            return Err(format!("Access denied: cannot read files from {}", prefix));
        }
    }

    // Block access to sensitive Windows system directories.
    // Allow C:\ProgramData — common location for app logs and performance traces.
    let path_str_lower = path_str.to_lowercase();
    let blocked_prefixes_windows = [
        "c:\\windows", "c:/windows",
        "c:\\windows\\system32", "c:/windows/system32",
    ];
    for prefix in &blocked_prefixes_windows {
        if path_str_lower.starts_with(prefix) {
            log::warn!("Blocked access to Windows system directory: {}", prefix);
            return Err("Access denied: cannot read files from system directories".to_string());
        }
    }

    // SECURITY: Validate file size before reading to prevent memory exhaustion
    let file_metadata = async_fs::metadata(&canonical_path).await.map_err(|e| {
        log::error!("Failed to get metadata for '{}': {}", path_str, e);
        "Failed to access file: permission denied or file not found".to_string()
    })?;

    if file_metadata.len() > max_size {
        return Err(format!(
            "File too large: {} bytes exceeds maximum of {} bytes ({} MB)",
            file_metadata.len(),
            max_size,
            max_size / (1024 * 1024)
        ));
    }

    Ok(canonical_path)
}

#[cfg(test)]
mod tests {
    use super::redact_pii_basic;
    use std::borrow::Cow;

    #[test]
    fn redacts_emails() {
        let input = "Contact john.doe@example.com for details.";
        let output = redact_pii_basic(input);
        assert!(!output.contains("john.doe@example.com"));
        assert!(output.contains("[REDACTED_EMAIL]"));
    }

    #[test]
    fn redacts_ipv4_addresses() {
        let input = "Server at 192.168.1.10 responded with error.";
        let output = redact_pii_basic(input);
        assert!(!output.contains("192.168.1.10"));
        assert!(output.contains("[REDACTED_IP]"));
    }

    #[test]
    fn redacts_tokens() {
        let input = "API key: sk-abcdefghijklmnop123456";
        let output = redact_pii_basic(input);
        assert!(!output.contains("sk-abcdefghijklmnop123456"));
        assert!(output.contains("[REDACTED_TOKEN]"));
    }

    #[test]
    fn redacts_user_paths() {
        let input = "Path C:\\Users\\Alice\\Documents and /home/bob/projects";
        let output = redact_pii_basic(input);
        assert!(!output.contains("C:\\Users\\Alice"));
        assert!(!output.contains("/home/bob"));
        assert!(output.contains("C:\\Users\\[REDACTED_USER]"));
        assert!(output.contains("/home/[REDACTED_USER]"));
    }

    #[test]
    fn leaves_text_without_pii_unchanged() {
        let input = "Simple message without any obvious PII.";
        let output = redact_pii_basic(input);
        assert_eq!(input, output);
    }

    #[test]
    fn handles_empty_string() {
        let output = redact_pii_basic("");
        assert_eq!(output, "");
        assert!(matches!(output, Cow::Borrowed(_)));
    }

    #[test]
    fn returns_borrowed_when_no_pii() {
        let input = "Just regular text with no sensitive data";
        let output = redact_pii_basic(input);
        assert!(matches!(output, Cow::Borrowed(_)));
    }

    #[test]
    fn returns_owned_when_pii_found() {
        let input = "Contact user@example.com";
        let output = redact_pii_basic(input);
        assert!(matches!(output, Cow::Owned(_)));
    }

    #[test]
    fn redacts_multiple_pii_types_in_same_text() {
        let input = "User john@example.com at 192.168.1.1 with key sk-abc123defghijk used C:\\Users\\John\\file.txt";
        let output = redact_pii_basic(input);
        assert!(output.contains("[REDACTED_EMAIL]"));
        assert!(output.contains("[REDACTED_IP]"));
        assert!(output.contains("[REDACTED_TOKEN]"));
        assert!(output.contains("[REDACTED_USER]"));
    }

    #[test]
    fn redacts_pii_in_stack_trace() {
        let input = r#"
Exception in thread "main" java.lang.NullPointerException
    at com.example.App.process(App.java:42)
    at C:\Users\Developer\projects\app\src\Main.java:15
Reported by: developer@company.com
Server: 192.168.1.100
        "#;
        let output = redact_pii_basic(input);
        assert!(!output.contains("Developer"));
        assert!(!output.contains("developer@company.com"));
        assert!(!output.contains("192.168.1.100"));
        assert!(output.contains("NullPointerException"));
    }
}
