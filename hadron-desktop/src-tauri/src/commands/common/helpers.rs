//! Common helper functions shared across command modules

use super::types::AnalysisProgress;
use once_cell::sync::Lazy;
use regex::Regex;
use std::borrow::Cow;
use tauri::{AppHandle, Emitter};
use tokio::fs as async_fs;

/// Helper to emit progress events to the frontend
pub fn emit_progress(app: &AppHandle, progress: AnalysisProgress) {
    if let Err(e) = app.emit("analysis-progress", &progress) {
        log::warn!("Failed to emit progress event: {}", e);
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

    // Block access to sensitive system directories (Unix)
    let path_str = canonical_path.to_string_lossy();
    let blocked_prefixes_unix = [
        "/etc", "/var", "/usr", "/bin", "/sbin", "/root", "/sys", "/proc",
    ];
    for prefix in &blocked_prefixes_unix {
        if path_str.starts_with(prefix) {
            log::warn!("Blocked access to system directory: {}", prefix);
            return Err(format!("Access denied: cannot read files from {}", prefix));
        }
    }

    // Block access to sensitive Windows system directories
    let path_str_lower = path_str.to_lowercase();
    let blocked_prefixes_windows = [
        "c:\\windows",
        "c:\\program files",
        "c:\\programdata",
        "c:/windows",
        "c:/program files",
        "c:/programdata",
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
