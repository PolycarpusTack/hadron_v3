use crate::ai_service;
use crate::ai_service::translate_ollama;
use crate::database::{
    Analysis, AnalysisNote, Database, ErrorPatternCount, Tag, Translation, TrendDataPoint,
};
use crate::jira_service;
use crate::keeper_service;
use crate::model_fetcher::{
    list_models as fetch_models, test_connection as test_api_connection, ConnectionTestResult,
    Model,
};
use crate::models::CrashFile;
use crate::parser::CrashFileParser;
use crate::python_runner::run_python_translation;
use crate::signature;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};
use tokio::fs as async_fs;
use zeroize::Zeroizing;

// ============================================================================
// Analysis Progress Events
// ============================================================================

/// Progress update for analysis operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisProgress {
    /// Current phase of analysis
    pub phase: AnalysisPhase,
    /// Progress within current phase (0-100)
    pub progress: u8,
    /// Human-readable status message
    pub message: String,
    /// Current step number (e.g., chunk 3 of 10)
    pub current_step: Option<usize>,
    /// Total steps in current phase
    pub total_steps: Option<usize>,
}

/// Phases of the analysis process
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisPhase {
    /// Reading and validating file
    Reading,
    /// Estimating tokens and selecting strategy
    Planning,
    /// Extracting key evidence (for extraction mode)
    Extracting,
    /// Chunking content (for deep scan)
    Chunking,
    /// Analyzing chunks (map phase of deep scan)
    Analyzing,
    /// Synthesizing results (reduce phase of deep scan)
    Synthesizing,
    /// Saving to database
    Saving,
    /// Analysis complete
    Complete,
    /// Analysis failed
    Failed,
}

/// Helper to emit progress events
fn emit_progress(app: &AppHandle, progress: AnalysisProgress) {
    if let Err(e) = app.emit("analysis-progress", &progress) {
        log::warn!("Failed to emit progress event: {}", e);
    }
}

/// Type alias for Arc-wrapped database state
pub type DbState<'a> = State<'a, Arc<Database>>;

/// Maximum file size for crash log analysis (5 MB)
/// Prevents memory exhaustion from maliciously large files
const MAX_CRASH_LOG_SIZE_BYTES: u64 = 5 * 1024 * 1024;

/// Maximum content size for translation (1 MB)
const MAX_TRANSLATION_CONTENT_SIZE: usize = 1024 * 1024;

/// Maximum content size for pasted logs (5 MB)
const MAX_PASTED_LOG_SIZE: usize = 5 * 1024 * 1024;

/// Maximum file size for performance trace analysis (10 MB)
const MAX_PERFORMANCE_TRACE_SIZE_BYTES: u64 = 10 * 1024 * 1024;

// ============================================================================
// Security: Path Validation Helper
// ============================================================================

/// Validate and canonicalize a file path for safe access
/// Returns the canonical path if valid, or an error message
async fn validate_file_path(raw_path: &str, max_size: u64) -> Result<std::path::PathBuf, String> {
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

fn normalize_severity(severity: &str) -> String {
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
// This provides ~10x speedup vs compiling on every call
static EMAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap());
static IPV4_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b\d{1,3}(?:\.\d{1,3}){3}\b").unwrap());
static TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    // Match API tokens like sk-xxx, sk-proj-xxx with at least 10 chars after sk-
    Regex::new(r"\bsk-[A-Za-z0-9-]{10,}").unwrap()
});
static WIN_PATH_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)C:\\Users\\[^\\\s]+").unwrap());
static UNIX_HOME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"/home/[^/\s]+").unwrap());

use std::borrow::Cow;

fn redact_pii_basic(text: &str) -> Cow<'_, str> {
    // FIX #6: Optimized PII redaction using Cow to avoid allocations when no PII found.
    // Uses pre-compiled regexes for performance.

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

#[cfg(test)]
mod tests {
    use super::redact_pii_basic;
    use std::borrow::Cow;

    // ============================================================================
    // Basic PII Redaction Tests
    // ============================================================================

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

    // ============================================================================
    // Edge Case Tests
    // ============================================================================

    #[test]
    fn handles_empty_string() {
        let input = "";
        let output = redact_pii_basic(input);
        assert_eq!(output, "");
        // Should return borrowed (no allocation)
        assert!(matches!(output, Cow::Borrowed(_)));
    }

    #[test]
    fn handles_whitespace_only() {
        let input = "   \t\n  ";
        let output = redact_pii_basic(input);
        assert_eq!(output, input);
        assert!(matches!(output, Cow::Borrowed(_)));
    }

    #[test]
    fn returns_borrowed_when_no_pii() {
        let input = "Just regular text with no sensitive data";
        let output = redact_pii_basic(input);
        // Verify zero-allocation path is taken
        assert!(matches!(output, Cow::Borrowed(_)));
    }

    #[test]
    fn returns_owned_when_pii_found() {
        let input = "Contact user@example.com";
        let output = redact_pii_basic(input);
        // Verify allocation happens when redaction needed
        assert!(matches!(output, Cow::Owned(_)));
    }

    // ============================================================================
    // Multiple PII Types Combined
    // ============================================================================

    #[test]
    fn redacts_multiple_pii_types_in_same_text() {
        let input = "User john@example.com at 192.168.1.1 with key sk-abc123defghijk used C:\\Users\\John\\file.txt";
        let output = redact_pii_basic(input);
        assert!(output.contains("[REDACTED_EMAIL]"));
        assert!(output.contains("[REDACTED_IP]"));
        assert!(output.contains("[REDACTED_TOKEN]"));
        assert!(output.contains("[REDACTED_USER]"));
        assert!(!output.contains("john@example.com"));
        assert!(!output.contains("192.168.1.1"));
        assert!(!output.contains("sk-abc123defghijk"));
        assert!(!output.contains("C:\\Users\\John"));
    }

    #[test]
    fn redacts_multiple_emails() {
        let input = "From: alice@foo.com To: bob@bar.org CC: charlie@baz.net";
        let output = redact_pii_basic(input);
        assert!(!output.contains("alice@foo.com"));
        assert!(!output.contains("bob@bar.org"));
        assert!(!output.contains("charlie@baz.net"));
        // Should have 3 redacted emails
        assert_eq!(output.matches("[REDACTED_EMAIL]").count(), 3);
    }

    #[test]
    fn redacts_multiple_ips() {
        let input = "Servers: 10.0.0.1, 172.16.0.1, 192.168.0.1";
        let output = redact_pii_basic(input);
        assert!(!output.contains("10.0.0.1"));
        assert!(!output.contains("172.16.0.1"));
        assert!(!output.contains("192.168.0.1"));
        assert_eq!(output.matches("[REDACTED_IP]").count(), 3);
    }

    // ============================================================================
    // Email Edge Cases
    // ============================================================================

    #[test]
    fn redacts_email_with_plus_addressing() {
        let input = "Contact user+tag@example.com";
        let output = redact_pii_basic(input);
        assert!(!output.contains("user+tag@example.com"));
        assert!(output.contains("[REDACTED_EMAIL]"));
    }

    #[test]
    fn redacts_email_with_subdomain() {
        let input = "Email: admin@mail.subdomain.example.co.uk";
        let output = redact_pii_basic(input);
        assert!(!output.contains("admin@mail.subdomain.example.co.uk"));
        assert!(output.contains("[REDACTED_EMAIL]"));
    }

    #[test]
    fn redacts_email_with_numbers() {
        let input = "User: test123@domain456.com";
        let output = redact_pii_basic(input);
        assert!(!output.contains("test123@domain456.com"));
        assert!(output.contains("[REDACTED_EMAIL]"));
    }

    // ============================================================================
    // IP Address Edge Cases
    // ============================================================================

    #[test]
    fn redacts_localhost_ip() {
        let input = "Connected to 127.0.0.1";
        let output = redact_pii_basic(input);
        assert!(!output.contains("127.0.0.1"));
        assert!(output.contains("[REDACTED_IP]"));
    }

    #[test]
    fn redacts_broadcast_ip() {
        let input = "Broadcast: 255.255.255.255";
        let output = redact_pii_basic(input);
        assert!(!output.contains("255.255.255.255"));
        assert!(output.contains("[REDACTED_IP]"));
    }

    #[test]
    fn does_not_redact_version_numbers() {
        // Version numbers like 1.2.3 should NOT be redacted (only 3 octets)
        let input = "Version 1.2.3 released";
        let output = redact_pii_basic(input);
        assert!(output.contains("1.2.3"));
    }

    // ============================================================================
    // Token Edge Cases
    // ============================================================================

    #[test]
    fn redacts_long_api_tokens() {
        let input = "Key: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEF";
        let output = redact_pii_basic(input);
        assert!(!output.contains("sk-proj-"));
        assert!(output.contains("[REDACTED_TOKEN]"));
    }

    #[test]
    fn does_not_redact_short_sk_prefix() {
        // sk- followed by less than 10 chars should NOT be redacted
        let input = "Variable sk-short";
        let output = redact_pii_basic(input);
        assert!(output.contains("sk-short"));
    }

    // ============================================================================
    // Path Edge Cases
    // ============================================================================

    #[test]
    fn redacts_windows_path_case_insensitive() {
        let input = "Path: c:\\users\\Admin\\Desktop\\file.txt";
        let output = redact_pii_basic(input);
        assert!(!output.contains("c:\\users\\Admin"));
        assert!(output.contains("[REDACTED_USER]"));
    }

    #[test]
    fn redacts_windows_path_with_spaces() {
        // Note: current regex stops at spaces, so partial match is expected
        let input = "C:\\Users\\John Doe\\Documents";
        let output = redact_pii_basic(input);
        assert!(!output.contains("C:\\Users\\John"));
    }

    #[test]
    fn redacts_unix_home_nested_path() {
        let input = "File at /home/developer/projects/app/src/main.rs";
        let output = redact_pii_basic(input);
        assert!(!output.contains("/home/developer"));
        assert!(output.contains("/home/[REDACTED_USER]"));
    }

    #[test]
    fn preserves_non_home_unix_paths() {
        let input = "Config at /etc/nginx/nginx.conf and /var/log/syslog";
        let output = redact_pii_basic(input);
        assert!(output.contains("/etc/nginx/nginx.conf"));
        assert!(output.contains("/var/log/syslog"));
    }

    // ============================================================================
    // Real-world Crash Log Patterns
    // ============================================================================

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
        // Stack trace structure should be preserved
        assert!(output.contains("NullPointerException"));
        assert!(output.contains("App.java:42"));
    }

    #[test]
    fn redacts_pii_in_log_format() {
        let input = "2024-01-15 10:30:45 [ERROR] User admin@test.com from 10.0.0.50 failed auth with sk-test1234567890abc";
        let output = redact_pii_basic(input);
        assert!(output.contains("2024-01-15 10:30:45 [ERROR]"));
        assert!(!output.contains("admin@test.com"));
        assert!(!output.contains("10.0.0.50"));
        assert!(!output.contains("sk-test1234567890abc"));
    }

    // ============================================================================
    // Unicode and Special Characters
    // ============================================================================

    #[test]
    fn handles_unicode_text_without_pii() {
        let input = "Error: 日本語テキスト with émojis 🎉 and ñ characters";
        let output = redact_pii_basic(input);
        assert_eq!(output, input);
    }

    #[test]
    fn redacts_pii_in_unicode_context() {
        let input = "ユーザー: user@example.com からのリクエスト";
        let output = redact_pii_basic(input);
        assert!(!output.contains("user@example.com"));
        assert!(output.contains("[REDACTED_EMAIL]"));
        assert!(output.contains("ユーザー"));
    }

    // ============================================================================
    // Performance Sanity Tests
    // ============================================================================

    #[test]
    fn handles_large_text_efficiently() {
        // Generate a large text block without PII
        let input: String = "This is a test line without any PII data.\n".repeat(1000);
        let output = redact_pii_basic(&input);
        // Should return borrowed (no allocation for large text without PII)
        assert!(matches!(output, Cow::Borrowed(_)));
        assert_eq!(output.len(), input.len());
    }

    #[test]
    fn handles_many_redactions() {
        // Text with many PII items
        let mut input = String::new();
        for i in 0..100 {
            input.push_str(&format!("user{}@test.com 192.168.1.{} ", i, i));
        }
        let output = redact_pii_basic(&input);
        assert_eq!(output.matches("[REDACTED_EMAIL]").count(), 100);
        assert_eq!(output.matches("[REDACTED_IP]").count(), 100);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisRequest {
    pub file_path: String,
    pub api_key: String,
    pub model: String,
    pub provider: String,
    pub analysis_type: String, // "complete" or "specialized"
    pub redact_pii: Option<bool>,
    /// Optional Keeper secret UID - if provided, API key is fetched from Keeper
    /// instead of using the api_key field directly
    pub keeper_secret_uid: Option<String>,
    /// Analysis mode: "quick" (default), "deep_scan", or "auto"
    /// - "quick": Fast analysis with evidence extraction if needed
    /// - "deep_scan": Full map-reduce for very large files
    /// - "auto": Automatically select based on file size
    pub analysis_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisResponse {
    pub id: i64,
    pub filename: String,
    pub error_type: String,
    pub severity: String,
    pub root_cause: String,
    pub suggested_fixes: Vec<String>,
    pub analyzed_at: String,
    pub cost: f64,
    /// Analysis mode used (Quick, QuickWithExtraction, DeepScan)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis_mode: Option<String>,
    /// Coverage information for display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage_summary: Option<String>,
    /// Token utilization percentage
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_utilization: Option<f32>,
}

/// Analyze a crash log file using Rust AI service
#[tauri::command]
pub async fn analyze_crash_log(
    request: AnalysisRequest,
    db: DbState<'_>,
    app: AppHandle,
) -> Result<AnalysisResponse, String> {
    log::info!(
        "Starting crash analysis: file={}, provider={}, model={}, type={}",
        request.file_path,
        request.provider,
        request.model,
        request.analysis_type
    );

    // Emit initial progress
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Reading,
            progress: 0,
            message: "Reading crash log file...".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    // SECURITY: Validate file path to prevent path traversal attacks
    // FIX #4: Check raw input path BEFORE canonicalize to reject early and avoid information leaks
    if request.file_path.contains("..") {
        log::warn!("Path traversal attempt detected: {}", request.file_path);
        return Err("Invalid file path: path traversal not allowed".to_string());
    }

    let file_path = std::path::Path::new(&request.file_path);
    // FIX #1: Use async_fs to avoid blocking the Tauri async runtime
    let canonical_path = async_fs::canonicalize(file_path).await.map_err(|e| {
        // SECURITY: Log full error but don't expose path details to frontend
        log::error!("Failed to canonicalize path '{}': {}", request.file_path, e);
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

    // FIX #5: Block access to sensitive Windows system directories
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
    // FIX #1: Use async_fs to avoid blocking the Tauri async runtime
    let file_metadata = async_fs::metadata(&canonical_path).await.map_err(|e| {
        log::error!("Failed to get metadata for '{}': {}", path_str, e);
        "Failed to access file: permission denied or file not found".to_string()
    })?;

    if file_metadata.len() > MAX_CRASH_LOG_SIZE_BYTES {
        return Err(format!(
            "File too large: {} bytes exceeds maximum of {} bytes (5 MB). Please use a smaller log file.",
            file_metadata.len(),
            MAX_CRASH_LOG_SIZE_BYTES
        ));
    }

    // Read crash log file (size already validated, path already canonicalized)
    // FIX #1: Use async_fs to avoid blocking the Tauri async runtime
    let mut crash_content = async_fs::read_to_string(&canonical_path)
        .await
        .map_err(|e| {
            log::error!("Failed to read file '{}': {}", path_str, e);
            "Failed to read file: check file permissions".to_string()
        })?;

    // Optionally redact PII before sending to AI providers
    if request.redact_pii.unwrap_or(false) {
        crash_content = redact_pii_basic(&crash_content).into_owned();
    }

    // Emit progress - file read complete
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Planning,
            progress: 10,
            message: "Planning analysis strategy...".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    // Resolve API key - prefer Keeper if configured
    // SECURITY: Wrap in Zeroizing to ensure key is cleared from memory after use
    let api_key: Zeroizing<String> = if let Some(ref keeper_uid) = request.keeper_secret_uid {
        log::info!("Fetching API key from Keeper for analysis");
        // keeper_service already returns Zeroizing<String>
        keeper_service::get_api_key_from_keeper(keeper_uid)
            .map_err(|e| format!("Failed to get API key from Keeper: {}", e))?
    } else {
        Zeroizing::new(request.api_key.clone())
    };

    // Determine analysis mode from request
    let token_safe_config = match request.analysis_mode.as_deref() {
        Some("deep_scan") => Some(ai_service::TokenSafeConfig {
            force_mode: Some(ai_service::AnalysisMode::DeepScan),
            ..Default::default()
        }),
        Some("quick") => Some(ai_service::TokenSafeConfig {
            enable_deep_scan: false, // Force quick mode, no deep scan fallback
            ..Default::default()
        }),
        _ => None, // "auto" or unspecified - let the system decide
    };

    // Emit progress - starting AI analysis
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Analyzing,
            progress: 20,
            message: "Analyzing crash log with AI...".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    // Call token-safe Rust AI service
    // This automatically handles large files by:
    // 1. Estimating token usage
    // 2. Using evidence extraction if needed
    // 3. Falling back to deep scan (map-reduce) for very large files
    let result = ai_service::analyze_crash_log_safe(
        &crash_content,
        None, // raw_walkback is embedded in crash_content for now
        api_key.as_str(),
        &request.model,
        &request.provider,
        &request.analysis_type,
        token_safe_config,
    )
    .await
    .map_err(|e| {
        log::error!(
            "AI analysis failed: file={}, error={}",
            request.file_path,
            e
        );
        format!("AI analysis failed: {}", e)
    })?;

    // Log analysis mode used
    if let Some(ref meta) = result.analysis_meta {
        log::info!(
            "Analysis completed with mode={:?}, utilization={:.1}%",
            meta.mode,
            meta.token_estimates.utilization * 100.0
        );
    }

    // Emit progress - AI analysis complete
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Saving,
            progress: 80,
            message: "Saving analysis results...".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    log::info!(
        "AI analysis completed: file={}, severity={}, confidence={}, has_enhanced_json={}",
        request.file_path,
        result.severity,
        result.confidence,
        result.raw_enhanced_json.is_some()
    );

    // Get file size (reuse already-fetched metadata)
    let file_size_kb = file_metadata.len() as f64 / 1024.0;

    // Create analysis with all new fields
    let analysis = Analysis {
        id: 0,
        filename: PathBuf::from(&request.file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown.txt")
            .to_string(),
        file_size_kb,
        error_type: result.error_type.clone(),
        error_message: result.error_message.clone(),
        severity: result.severity.to_uppercase(),
        component: result.component.clone(),
        stack_trace: result.stack_trace.clone(),
        root_cause: result.root_cause.clone(),
        suggested_fixes: serde_json::to_string(&result.suggested_fixes).unwrap_or_else(|e| {
            log::warn!("Failed to serialize suggested_fixes: {}", e);
            "[]".to_string()
        }),
        confidence: Some(result.confidence.to_uppercase()),
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        ai_model: request.model.clone(),
        ai_provider: Some(request.provider.clone()),
        tokens_used: result.tokens_used,
        cost: result.cost,
        was_truncated: result.was_truncated.unwrap_or(false),
        // For WHATS'ON enhanced analyses, store the raw JSON for frontend parsing
        // For other types, store the serialized AnalysisResult
        full_data: result.raw_enhanced_json.clone().or_else(|| {
            Some(serde_json::to_string(&result).unwrap_or_else(|e| {
                log::warn!("Failed to serialize full analysis result: {}", e);
                "{}".to_string()
            }))
        }),
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: result.analysis_duration_ms,
        analysis_type: request.analysis_type.clone(),
    };

    // Extract fields needed for response BEFORE moving analysis into spawn_blocking
    let response_filename = analysis.filename.clone();
    let response_error_type = analysis.error_type.clone();
    let response_severity = analysis.severity.clone();
    let response_root_cause = analysis.root_cause.clone();
    let response_analyzed_at = analysis.analyzed_at.clone();
    let response_cost = analysis.cost;

    // Log analysis details before insert
    log::info!(
        "Inserting analysis: type={}, severity={}, confidence={:?}, full_data_len={}",
        analysis.analysis_type,
        analysis.severity,
        analysis.confidence,
        analysis.full_data.as_ref().map(|s| s.len()).unwrap_or(0)
    );

    // Save to database (use spawn_blocking to avoid blocking async runtime)
    let db_clone = Arc::clone(&db);
    let file_path_for_log = request.file_path.clone();
    let id = tauri::async_runtime::spawn_blocking(move || db_clone.insert_analysis(&analysis))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| {
            log::error!(
                "Database insert failed: file={}, error={}",
                file_path_for_log,
                e
            );
            format!("Database error: {}", e)
        })?;

    log::info!(
        "Analysis completed successfully: id={}, file={}, provider={}, cost={}",
        id,
        request.file_path,
        request.provider,
        response_cost
    );

    // Emit progress - complete
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Complete,
            progress: 100,
            message: "Analysis complete!".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    // Extract metadata for response
    let (analysis_mode_str, coverage_summary, token_utilization) = match &result.analysis_meta {
        Some(meta) => {
            let mode_str = match meta.mode {
                ai_service::AnalysisMode::Quick => "Quick",
                ai_service::AnalysisMode::QuickWithExtraction => "Quick (Extracted)",
                ai_service::AnalysisMode::DeepScan => "Deep Scan",
            };

            let coverage = format!(
                "Walkback: {:?}, DB: {:?}",
                meta.coverage.walkback_coverage, meta.coverage.db_sessions_coverage
            );

            (
                Some(mode_str.to_string()),
                Some(coverage),
                Some(meta.token_estimates.utilization),
            )
        }
        None => (None, None, None),
    };

    Ok(AnalysisResponse {
        id,
        filename: response_filename,
        error_type: response_error_type,
        severity: response_severity,
        root_cause: response_root_cause,
        suggested_fixes: result.suggested_fixes,
        analyzed_at: response_analyzed_at,
        cost: response_cost,
        analysis_mode: analysis_mode_str,
        coverage_summary,
        token_utilization,
    })
}

/// Translate technical content to plain language
#[tauri::command]
pub async fn translate_content(
    content: String,
    api_key: String,
    model: String,
    provider: String,
    redact_pii: Option<bool>,
    db: DbState<'_>,
) -> Result<String, String> {
    // SECURITY: Wrap API key in Zeroizing to ensure it's cleared from memory after use
    let api_key = Zeroizing::new(api_key);

    // SECURITY: Validate content size to prevent memory exhaustion
    if content.len() > MAX_TRANSLATION_CONTENT_SIZE {
        return Err(format!(
            "Content too large: {} bytes exceeds maximum of {} bytes (1 MB)",
            content.len(),
            MAX_TRANSLATION_CONTENT_SIZE
        ));
    }

    log::info!(
        "Starting translation: provider={}, model={}",
        provider,
        model
    );

    // Optionally redact PII in free-form content before sending to AI
    // FIX #6: Use Cow to avoid clone when no PII redaction needed
    let content_for_ai: Cow<'_, str> = if redact_pii.unwrap_or(false) {
        redact_pii_basic(&content)
    } else {
        Cow::Borrowed(&content)
    };

    // For Ollama, use Rust-native translation (no Python needed)
    let translation_text = if provider.to_lowercase() == "ollama" {
        translate_ollama(&content_for_ai, &model)
            .await
            .map_err(|e| {
                log::error!("Ollama translation failed: error={}", e);
                format!("Ollama translation failed: {}", e)
            })?
    } else {
        // Run Python translation for cloud providers
        let result = run_python_translation(&content_for_ai, api_key.as_str(), &model, &provider)
            .await
            .map_err(|e| {
                log::error!("Translation failed: error={}", e);
                format!("Translation failed: {}", e)
            })?;
        result.translation.clone()
    };

    log::info!("Translation completed successfully: provider={}", provider);

    // Save translation to database
    let translation = Translation {
        id: 0,
        input_content: content,
        translation: translation_text.clone(),
        translated_at: chrono::Utc::now().to_rfc3339(),
        ai_model: model,
        ai_provider: provider.clone(),
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
    };

    // Use spawn_blocking to avoid blocking the async runtime during database insert
    let db_clone = Arc::clone(&db);
    let provider_for_log = provider.clone();
    let id =
        tauri::async_runtime::spawn_blocking(move || db_clone.insert_translation(&translation))
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| {
                log::error!("Database insert failed for translation: error={}", e);
                format!("Database error: {}", e)
            })?;

    log::info!(
        "Translation saved to database: id={}, provider={}",
        id,
        provider_for_log
    );

    Ok(translation_text)
}

#[derive(Debug, Deserialize)]
pub struct ExternalAnalysisRequest {
    pub filename: String,
    pub file_size_kb: Option<f64>,
    pub summary: String,
    pub severity: Option<String>,
    pub analysis_type: String,
    pub suggested_fixes: Option<Vec<String>>,
    pub ai_model: Option<String>,
    pub ai_provider: Option<String>,
    pub full_data: Option<serde_json::Value>,
    pub component: Option<String>,
    pub error_type: Option<String>,
}

/// Save an external analysis result to history (e.g., code analysis)
#[tauri::command]
pub async fn save_external_analysis(
    request: ExternalAnalysisRequest,
    db: DbState<'_>,
) -> Result<i64, String> {
    let severity = normalize_severity(request.severity.as_deref().unwrap_or("medium"));
    let suggested_fixes = request.suggested_fixes.unwrap_or_default();

    let analysis = Analysis {
        id: 0,
        filename: request.filename.clone(),
        file_size_kb: request.file_size_kb.unwrap_or(0.0),
        error_type: request.error_type.unwrap_or_else(|| "ExternalAnalysis".to_string()),
        error_message: None,
        severity,
        component: request.component,
        stack_trace: None,
        root_cause: request.summary,
        suggested_fixes: serde_json::to_string(&suggested_fixes).unwrap_or_else(|e| {
            log::warn!("Failed to serialize suggested_fixes: {}", e);
            "[]".to_string()
        }),
        confidence: None,
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        ai_model: request.ai_model.unwrap_or_else(|| "unknown".to_string()),
        ai_provider: request.ai_provider,
        tokens_used: 0,
        cost: 0.0,
        was_truncated: false,
        full_data: request.full_data.map(|value| {
            serde_json::to_string(&value).unwrap_or_else(|e| {
                log::warn!("Failed to serialize external analysis full_data: {}", e);
                "{}".to_string()
            })
        }),
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: None,
        analysis_type: request.analysis_type,
    };

    let db_clone = Arc::clone(&db);
    let filename_for_log = analysis.filename.clone();
    let analysis_type_for_log = analysis.analysis_type.clone();
    let id = tauri::async_runtime::spawn_blocking(move || db_clone.insert_analysis(&analysis))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| {
            log::error!(
                "Database insert failed for external analysis: file={}, error={}",
                filename_for_log,
                e
            );
            format!("Database error: {}", e)
        })?;

    log::info!(
        "External analysis saved: id={}, file={}, type={}",
        id,
        filename_for_log,
        analysis_type_for_log
    );

    Ok(id)
}

/// Get all analyses from history (with default pagination)
#[tauri::command]
pub async fn get_all_analyses(db: DbState<'_>) -> Result<Vec<Analysis>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_all_analyses())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get analyses with pagination
/// - limit: Number of results to return (-1 for unlimited)
/// - offset: Number of results to skip
#[tauri::command]
pub async fn get_analyses_paginated(
    limit: Option<i64>,
    offset: Option<i64>,
    db: DbState<'_>,
) -> Result<Vec<Analysis>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_analyses_paginated(limit, offset))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get total count of analyses (for pagination UI)
#[tauri::command]
pub async fn get_analyses_count(db: DbState<'_>) -> Result<i64, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_analyses_count())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get a specific analysis by ID
#[tauri::command]
pub async fn get_analysis_by_id(id: i64, db: DbState<'_>) -> Result<Analysis, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_analysis_by_id(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Delete an analysis
#[tauri::command]
pub async fn delete_analysis(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.delete_analysis(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Export analysis to Markdown
#[tauri::command]
pub async fn export_analysis(id: i64, db: DbState<'_>) -> Result<String, String> {
    let db = Arc::clone(&db);
    let analysis = tauri::async_runtime::spawn_blocking(move || db.get_analysis_by_id(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    let fixes: Vec<String> = serde_json::from_str(&analysis.suggested_fixes).unwrap_or_else(|e| {
        log::warn!(
            "Failed to deserialize suggested_fixes for analysis {}: {}",
            id,
            e
        );
        vec!["(Unable to parse suggested fixes)".to_string()]
    });

    let markdown = format!(
        "# Crash Analysis Report\n\n\
         **File**: {}\n\
         **Error Type**: {}\n\
         **Severity**: {}\n\
         **Analyzed**: {}\n\n\
         ## Root Cause\n\n{}\n\n\
         ## Suggested Fixes\n\n{}\n\n\
         ---\n\
         Generated by Hadron - Smalltalk Crash Analyzer\n",
        analysis.filename,
        analysis.error_type,
        analysis.severity,
        analysis.analyzed_at,
        analysis.root_cause,
        fixes
            .iter()
            .enumerate()
            .map(|(i, fix)| format!("{}. {}", i + 1, fix))
            .collect::<Vec<_>>()
            .join("\n")
    );

    Ok(markdown)
}

/// Full-text search analyses using FTS5
#[tauri::command]
pub async fn search_analyses(
    query: String,
    severity_filter: Option<String>,
    db: DbState<'_>,
) -> Result<Vec<Analysis>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.search_analyses(&query, severity_filter.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Search error: {}", e))
}

/// Toggle favorite status for an analysis
#[tauri::command]
pub async fn toggle_favorite(id: i64, db: DbState<'_>) -> Result<bool, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.toggle_favorite(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all favorite analyses
#[tauri::command]
pub async fn get_favorites(db: DbState<'_>) -> Result<Vec<Analysis>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_favorites())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get recently viewed analyses
#[tauri::command]
pub async fn get_recent(limit: Option<i64>, db: DbState<'_>) -> Result<Vec<Analysis>, String> {
    let db = Arc::clone(&db);
    let limit = limit.unwrap_or(10);
    tauri::async_runtime::spawn_blocking(move || db.get_recent(limit))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get database statistics
#[tauri::command]
pub async fn get_database_statistics(db: DbState<'_>) -> Result<serde_json::Value, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_statistics())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Optimize FTS5 index
#[tauri::command]
pub async fn optimize_fts_index(db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.optimize_fts())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Run database integrity check
#[tauri::command]
pub async fn check_database_integrity(db: DbState<'_>) -> Result<bool, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.integrity_check())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Compact database (VACUUM)
#[tauri::command]
pub async fn compact_database(db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.compact())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Checkpoint WAL file
#[tauri::command]
pub async fn checkpoint_wal(db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.checkpoint_wal())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all translations from history
#[tauri::command]
pub async fn get_all_translations(db: DbState<'_>) -> Result<Vec<Translation>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_all_translations())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get a specific translation by ID
#[tauri::command]
pub async fn get_translation_by_id(id: i64, db: DbState<'_>) -> Result<Translation, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_translation_by_id(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Delete a translation
#[tauri::command]
pub async fn delete_translation(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.delete_translation(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Toggle favorite status for a translation
#[tauri::command]
pub async fn toggle_translation_favorite(id: i64, db: DbState<'_>) -> Result<bool, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.toggle_translation_favorite(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

// ============================================================================
// Tag Management Commands
// ============================================================================

/// Create a new tag
#[tauri::command]
pub async fn create_tag(name: String, color: String, db: DbState<'_>) -> Result<Tag, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.create_tag(&name, &color))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Update an existing tag
#[tauri::command]
pub async fn update_tag(
    id: i64,
    name: Option<String>,
    color: Option<String>,
    db: DbState<'_>,
) -> Result<Tag, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.update_tag(id, name.as_deref(), color.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

/// Delete a tag (cascades to remove from all analyses and translations)
#[tauri::command]
pub async fn delete_tag(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.delete_tag(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all tags ordered by usage
#[tauri::command]
pub async fn get_all_tags(db: DbState<'_>) -> Result<Vec<Tag>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_all_tags())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Add a tag to an analysis
#[tauri::command]
pub async fn add_tag_to_analysis(
    analysis_id: i64,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.add_tag_to_analysis(analysis_id, tag_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Remove a tag from an analysis
#[tauri::command]
pub async fn remove_tag_from_analysis(
    analysis_id: i64,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.remove_tag_from_analysis(analysis_id, tag_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all tags for a specific analysis
#[tauri::command]
pub async fn get_tags_for_analysis(analysis_id: i64, db: DbState<'_>) -> Result<Vec<Tag>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_tags_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Add a tag to a translation
#[tauri::command]
pub async fn add_tag_to_translation(
    translation_id: i64,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.add_tag_to_translation(translation_id, tag_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Remove a tag from a translation
#[tauri::command]
pub async fn remove_tag_from_translation(
    translation_id: i64,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.remove_tag_from_translation(translation_id, tag_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

/// Get all tags for a specific translation
#[tauri::command]
pub async fn get_tags_for_translation(
    translation_id: i64,
    db: DbState<'_>,
) -> Result<Vec<Tag>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_tags_for_translation(translation_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

// ============================================================================
// Advanced Filtering
// ============================================================================

/// Options for advanced filtering of analyses
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterOptions {
    /// Full-text search query
    pub search: Option<String>,
    /// Severity levels to include (e.g., ["critical", "high"])
    pub severities: Option<Vec<String>>,
    /// Analysis types to include (e.g., ["whatson", "complete", "specialized"])
    pub analysis_types: Option<Vec<String>>,
    /// Analysis modes to include (e.g., ["Quick", "Deep Scan"])
    pub analysis_modes: Option<Vec<String>>,
    /// Tag IDs to filter by
    pub tag_ids: Option<Vec<i64>>,
    /// Tag filter mode: "any" (OR) or "all" (AND)
    pub tag_mode: Option<String>,
    /// Start date (ISO 8601 format)
    pub date_from: Option<String>,
    /// End date (ISO 8601 format)
    pub date_to: Option<String>,
    /// Minimum cost
    pub cost_min: Option<f64>,
    /// Maximum cost
    pub cost_max: Option<f64>,
    /// Include archived (soft-deleted) items
    pub include_archived: Option<bool>,
    /// Show only favorites
    pub favorites_only: Option<bool>,
    /// Sort field
    pub sort_by: Option<String>,
    /// Sort order: "asc" or "desc"
    pub sort_order: Option<String>,
    /// Page size (default 50, max 1000)
    pub limit: Option<i64>,
    /// Offset for pagination
    pub offset: Option<i64>,
}

/// Result of filtered query with pagination metadata
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredResults<T> {
    pub items: Vec<T>,
    pub total_count: i64,
    pub page: i64,
    pub page_size: i64,
    pub has_more: bool,
}

/// Get analyses with advanced filtering
#[tauri::command]
pub async fn get_analyses_filtered(
    options: AdvancedFilterOptions,
    db: DbState<'_>,
) -> Result<FilteredResults<Analysis>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_analyses_filtered(&options))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

// ============================================================================
// Bulk Operations
// ============================================================================

/// Result of a bulk operation
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkOperationResult {
    pub success_count: usize,
    pub total_requested: usize,
}

/// Delete multiple analyses in a single operation
#[tauri::command]
pub async fn bulk_delete_analyses(
    ids: Vec<i64>,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = ids.len();
    let db = Arc::clone(&db);

    let deleted = tauri::async_runtime::spawn_blocking(move || db.bulk_delete_analyses(&ids))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Bulk deleted {} of {} analyses", deleted, total);
    Ok(BulkOperationResult {
        success_count: deleted,
        total_requested: total,
    })
}

/// Delete multiple translations in a single operation
#[tauri::command]
pub async fn bulk_delete_translations(
    ids: Vec<i64>,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = ids.len();
    let db = Arc::clone(&db);

    let deleted = tauri::async_runtime::spawn_blocking(move || db.bulk_delete_translations(&ids))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Bulk deleted {} of {} translations", deleted, total);
    Ok(BulkOperationResult {
        success_count: deleted,
        total_requested: total,
    })
}

/// Add a tag to multiple analyses
#[tauri::command]
pub async fn bulk_add_tag_to_analyses(
    analysis_ids: Vec<i64>,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = analysis_ids.len();
    let db = Arc::clone(&db);

    let added = tauri::async_runtime::spawn_blocking(move || {
        db.bulk_add_tag_to_analyses(&analysis_ids, tag_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Bulk added tag {} to {} of {} analyses",
        tag_id,
        added,
        total
    );
    Ok(BulkOperationResult {
        success_count: added,
        total_requested: total,
    })
}

/// Remove a tag from multiple analyses
#[tauri::command]
pub async fn bulk_remove_tag_from_analyses(
    analysis_ids: Vec<i64>,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = analysis_ids.len();
    let db = Arc::clone(&db);

    let removed = tauri::async_runtime::spawn_blocking(move || {
        db.bulk_remove_tag_from_analyses(&analysis_ids, tag_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Bulk removed tag {} from {} of {} analyses",
        tag_id,
        removed,
        total
    );
    Ok(BulkOperationResult {
        success_count: removed,
        total_requested: total,
    })
}

/// Set favorite status for multiple analyses
#[tauri::command]
pub async fn bulk_set_favorite_analyses(
    analysis_ids: Vec<i64>,
    favorite: bool,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = analysis_ids.len();
    let db = Arc::clone(&db);

    let updated = tauri::async_runtime::spawn_blocking(move || {
        db.bulk_set_favorite_analyses(&analysis_ids, favorite)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Bulk set favorite={} for {} of {} analyses",
        favorite,
        updated,
        total
    );
    Ok(BulkOperationResult {
        success_count: updated,
        total_requested: total,
    })
}

/// Set favorite status for multiple translations
#[tauri::command]
pub async fn bulk_set_favorite_translations(
    translation_ids: Vec<i64>,
    favorite: bool,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = translation_ids.len();
    let db = Arc::clone(&db);

    let updated = tauri::async_runtime::spawn_blocking(move || {
        db.bulk_set_favorite_translations(&translation_ids, favorite)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Bulk set favorite={} for {} of {} translations",
        favorite,
        updated,
        total
    );
    Ok(BulkOperationResult {
        success_count: updated,
        total_requested: total,
    })
}

// ============================================================================
// Archive System
// ============================================================================

/// Archive an analysis (soft delete)
#[tauri::command]
pub async fn archive_analysis(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.archive_analysis(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Archived analysis id={}", id);
    Ok(())
}

/// Restore an archived analysis
#[tauri::command]
pub async fn restore_analysis(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.restore_analysis(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Restored analysis id={}", id);
    Ok(())
}

/// Get all archived analyses
#[tauri::command]
pub async fn get_archived_analyses(db: DbState<'_>) -> Result<Vec<Analysis>, String> {
    let db = Arc::clone(&db);

    let analyses = tauri::async_runtime::spawn_blocking(move || db.get_archived_analyses())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Retrieved {} archived analyses", analyses.len());
    Ok(analyses)
}

/// Permanently delete an analysis
#[tauri::command]
pub async fn permanently_delete_analysis(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.permanently_delete_analysis(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Permanently deleted analysis id={}", id);
    Ok(())
}

/// Bulk archive analyses
#[tauri::command]
pub async fn bulk_archive_analyses(
    ids: Vec<i64>,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = ids.len();
    let db = Arc::clone(&db);

    let archived = tauri::async_runtime::spawn_blocking(move || db.bulk_archive_analyses(&ids))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Bulk archived {} of {} analyses", archived, total);
    Ok(BulkOperationResult {
        success_count: archived,
        total_requested: total,
    })
}

// ============================================================================
// Notes System
// ============================================================================

/// Add a note to an analysis
#[tauri::command]
pub async fn add_note_to_analysis(
    analysis_id: i64,
    content: String,
    db: DbState<'_>,
) -> Result<AnalysisNote, String> {
    let db = Arc::clone(&db);

    let note = tauri::async_runtime::spawn_blocking(move || db.add_note(analysis_id, &content))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Added note id={} to analysis id={}", note.id, analysis_id);
    Ok(note)
}

/// Update a note
#[tauri::command]
pub async fn update_note(
    id: i64,
    content: String,
    db: DbState<'_>,
) -> Result<AnalysisNote, String> {
    let db = Arc::clone(&db);

    let note = tauri::async_runtime::spawn_blocking(move || db.update_note(id, &content))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Updated note id={}", id);
    Ok(note)
}

/// Delete a note
#[tauri::command]
pub async fn delete_note(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.delete_note(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Deleted note id={}", id);
    Ok(())
}

/// Get all notes for an analysis
#[tauri::command]
pub async fn get_notes_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<Vec<AnalysisNote>, String> {
    let db = Arc::clone(&db);

    let notes =
        tauri::async_runtime::spawn_blocking(move || db.get_notes_for_analysis(analysis_id))
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Retrieved {} notes for analysis id={}",
        notes.len(),
        analysis_id
    );
    Ok(notes)
}

/// Get note count for an analysis
#[tauri::command]
pub async fn get_note_count(analysis_id: i64, db: DbState<'_>) -> Result<i32, String> {
    let db = Arc::clone(&db);

    let count = tauri::async_runtime::spawn_blocking(move || db.get_note_count(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    Ok(count)
}

/// Check if an analysis has any notes
#[tauri::command]
pub async fn analysis_has_notes(analysis_id: i64, db: DbState<'_>) -> Result<bool, String> {
    let db = Arc::clone(&db);

    let has_notes = tauri::async_runtime::spawn_blocking(move || db.analysis_has_notes(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    Ok(has_notes)
}

// ============================================================================
// Translation Archive System
// ============================================================================

/// Archive a translation (soft delete)
#[tauri::command]
pub async fn archive_translation(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.archive_translation(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Archived translation id={}", id);
    Ok(())
}

/// Restore an archived translation
#[tauri::command]
pub async fn restore_translation(id: i64, db: DbState<'_>) -> Result<(), String> {
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.restore_translation(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Restored translation id={}", id);
    Ok(())
}

// ============================================================================
// Similar Crash Detection & Analytics
// ============================================================================

/// Get similar analyses based on error signature
#[tauri::command]
pub async fn get_similar_analyses(
    analysis_id: i64,
    limit: Option<i32>,
    db: DbState<'_>,
) -> Result<Vec<Analysis>, String> {
    let db = Arc::clone(&db);
    let limit = limit.unwrap_or(10);

    let analyses =
        tauri::async_runtime::spawn_blocking(move || db.get_similar_analyses(analysis_id, limit))
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Found {} similar analyses for id={}",
        analyses.len(),
        analysis_id
    );
    Ok(analyses)
}

/// Count similar analyses for an analysis
#[tauri::command]
pub async fn count_similar_analyses(analysis_id: i64, db: DbState<'_>) -> Result<i32, String> {
    let db = Arc::clone(&db);

    let count =
        tauri::async_runtime::spawn_blocking(move || db.count_similar_analyses(analysis_id))
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| format!("Database error: {}", e))?;

    Ok(count)
}

/// Get trend data for analytics
#[tauri::command]
pub async fn get_trend_data(
    period: String,
    range_days: i32,
    db: DbState<'_>,
) -> Result<Vec<TrendDataPoint>, String> {
    let db = Arc::clone(&db);
    let period_clone = period.clone();

    let data =
        tauri::async_runtime::spawn_blocking(move || db.get_trend_data(&period_clone, range_days))
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Retrieved {} trend data points for period={}, range={}d",
        data.len(),
        period,
        range_days
    );
    Ok(data)
}

/// Get top error patterns
#[tauri::command]
pub async fn get_top_error_patterns(
    limit: Option<i32>,
    db: DbState<'_>,
) -> Result<Vec<ErrorPatternCount>, String> {
    let db = Arc::clone(&db);
    let limit = limit.unwrap_or(10);

    let patterns = tauri::async_runtime::spawn_blocking(move || db.get_top_error_patterns(limit))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Retrieved {} top error patterns", patterns.len());
    Ok(patterns)
}

/// List available models from AI provider
#[tauri::command]
pub async fn list_models(provider: String, api_key: String) -> Result<Vec<Model>, String> {
    // SECURITY: Wrap API key in Zeroizing to ensure it's cleared from memory after use
    let api_key = Zeroizing::new(api_key);

    log::info!("Fetching models: provider={}", provider);

    let models = fetch_models(&provider, api_key.as_str()).await?;

    log::info!("Fetched {} models from {}", models.len(), provider);
    Ok(models)
}

/// Test API connection by attempting to list models
#[tauri::command]
pub async fn test_connection(
    provider: String,
    api_key: String,
) -> Result<ConnectionTestResult, String> {
    // SECURITY: Wrap API key in Zeroizing to ensure it's cleared from memory after use
    let api_key = Zeroizing::new(api_key);

    log::info!("Testing connection: provider={}", provider);

    let result = test_api_connection(&provider, api_key.as_str()).await?;

    log::info!(
        "Connection test: provider={}, success={}",
        provider,
        result.success
    );
    Ok(result)
}

/// Save analysis result to database (called from TypeScript after AI analysis)
#[tauri::command]
#[allow(dead_code, clippy::too_many_arguments)]
pub async fn save_analysis(
    file_path: String,
    error_type: String,
    error_message: Option<String>,
    severity: String,
    component: Option<String>,
    stack_trace: Option<String>,
    root_cause: String,
    suggested_fixes: Vec<String>,
    confidence: String,
    model: String,
    provider: String,
    tokens_used: i32,
    cost: f64,
    was_truncated: bool,
    analysis_duration_ms: Option<i32>,
    analysis_type: String,
    db: DbState<'_>,
) -> Result<i64, String> {
    log::info!(
        "Saving analysis to database: file={}, provider={}",
        file_path,
        provider
    );

    // Get file size
    // FIX #1: Use async_fs to avoid blocking the Tauri async runtime
    let file_size_kb = async_fs::metadata(&file_path)
        .await
        .map(|m| m.len() as f64 / 1024.0)
        .unwrap_or(0.0);

    let analysis = Analysis {
        id: 0,
        filename: PathBuf::from(&file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown.txt")
            .to_string(),
        file_size_kb,
        error_type,
        error_message,
        severity: severity.to_uppercase(),
        component,
        stack_trace,
        root_cause,
        suggested_fixes: serde_json::to_string(&suggested_fixes).unwrap_or_else(|e| {
            log::warn!(
                "Failed to serialize suggested_fixes in save_analysis: {}",
                e
            );
            "[]".to_string()
        }),
        confidence: Some(confidence.to_uppercase()),
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        ai_model: model,
        ai_provider: Some(provider),
        tokens_used,
        cost,
        was_truncated,
        full_data: None,
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms,
        analysis_type,
    };

    // Use spawn_blocking to avoid blocking the async runtime during database insert
    let db_clone = Arc::clone(&db);
    let id = tauri::async_runtime::spawn_blocking(move || db_clone.insert_analysis(&analysis))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Analysis saved: id={}", id);
    Ok(id)
}

/// Save pasted log text to a temporary file
#[tauri::command]
pub async fn save_pasted_log(content: String) -> Result<String, String> {
    use std::env;

    // SECURITY: Validate content size to prevent memory exhaustion
    if content.len() > MAX_PASTED_LOG_SIZE {
        return Err(format!(
            "Pasted content too large: {} bytes exceeds maximum of {} bytes (5 MB)",
            content.len(),
            MAX_PASTED_LOG_SIZE
        ));
    }

    // Create temp file path
    let temp_dir = env::temp_dir();
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("pasted_log_{}.txt", timestamp);
    let file_path = temp_dir.join(filename);

    // Write content to temp file
    // FIX #1: Use async_fs to avoid blocking the Tauri async runtime
    async_fs::write(&file_path, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to temp file: {}", e))?;

    log::info!("Saved pasted log to temp file: {:?}", file_path);

    Ok(file_path.to_string_lossy().to_string())
}

// ============================================================================
// Keeper Secrets Manager Commands
// ============================================================================

/// Initialize Keeper with a one-time access token
/// This binds the token to this device and enables secure API key retrieval
#[tauri::command]
pub async fn initialize_keeper(token: String) -> Result<keeper_service::KeeperInitResult, String> {
    log::info!("Initializing Keeper connection");
    // Keeper SDK may perform blocking I/O - run in blocking thread pool
    tauri::async_runtime::spawn_blocking(move || keeper_service::initialize_keeper(&token))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// List available secrets from Keeper (metadata only, not values)
/// Safe to return to frontend - only shows titles and UIDs
#[tauri::command]
pub async fn list_keeper_secrets() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::debug!("Listing Keeper secrets");
    // Keeper SDK may perform blocking I/O - run in blocking thread pool
    tauri::async_runtime::spawn_blocking(keeper_service::list_keeper_secrets)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// Get Keeper connection status
#[tauri::command]
pub async fn get_keeper_status() -> Result<keeper_service::KeeperStatus, String> {
    log::debug!("Getting Keeper status");
    Ok(keeper_service::get_keeper_status())
}

/// Clear Keeper configuration (disconnect)
#[tauri::command]
pub async fn clear_keeper_config() -> Result<(), String> {
    log::info!("Clearing Keeper configuration");
    // Keeper SDK may perform blocking I/O - run in blocking thread pool
    tauri::async_runtime::spawn_blocking(keeper_service::clear_keeper_config)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// Test Keeper connection by attempting to list secrets
#[tauri::command]
pub async fn test_keeper_connection() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::info!("Testing Keeper connection");
    // Keeper SDK may perform blocking I/O - run in blocking thread pool
    tauri::async_runtime::spawn_blocking(keeper_service::list_keeper_secrets)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

// ============================================================================
// JIRA Integration Commands
// ============================================================================

/// Test JIRA connection
#[tauri::command]
pub async fn test_jira_connection(
    base_url: String,
    email: String,
    api_token: String,
) -> Result<jira_service::JiraTestResponse, String> {
    log::info!("Testing JIRA connection");
    jira_service::test_jira_connection(base_url, email, api_token).await
}

/// Create JIRA ticket from crash analysis
#[tauri::command]
pub async fn create_jira_ticket(
    base_url: String,
    email: String,
    api_token: String,
    project_key: String,
    issue_type: String,
    ticket: jira_service::JiraTicketRequest,
) -> Result<jira_service::JiraCreateResponse, String> {
    log::info!("Creating JIRA ticket");
    jira_service::create_jira_ticket(base_url, email, api_token, project_key, issue_type, ticket)
        .await
}

// ============================================================================
// Crash Signature Commands
// ============================================================================

/// Compute a crash signature from analysis data (does not persist)
#[tauri::command]
pub fn compute_crash_signature(
    error_type: String,
    stack_trace: Option<String>,
    root_cause: String,
) -> Result<signature::CrashSignature, String> {
    log::debug!("Computing crash signature for: {}", error_type);
    let config = signature::SignatureConfig::default();
    Ok(signature::compute_signature(
        &error_type,
        stack_trace.as_deref(),
        &root_cause,
        &config,
    ))
}

/// Register a crash signature for an analysis (compute, persist, and link)
#[tauri::command]
pub async fn register_crash_signature(
    analysis_id: i64,
    error_type: String,
    stack_trace: Option<String>,
    root_cause: String,
    db: DbState<'_>,
) -> Result<signature::SignatureRegistrationResult, String> {
    log::info!("Registering crash signature for analysis {}", analysis_id);

    let config = signature::SignatureConfig::default();
    let sig =
        signature::compute_signature(&error_type, stack_trace.as_deref(), &root_cause, &config);

    // Use spawn_blocking for all database operations
    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        // Upsert signature
        let is_new = db_clone
            .upsert_signature(&sig)
            .map_err(|e| format!("Failed to upsert signature: {}", e))?;

        // Link analysis to signature
        db_clone
            .link_analysis_to_signature(analysis_id, &sig.hash)
            .map_err(|e| format!("Failed to link analysis to signature: {}", e))?;

        // Get updated signature with occurrence count
        let updated_sig = db_clone
            .find_signature_by_hash(&sig.hash)
            .map_err(|e| format!("Failed to retrieve signature: {}", e))?
            .unwrap_or(sig);

        Ok(signature::SignatureRegistrationResult {
            signature: updated_sig.clone(),
            is_new,
            occurrence_count: updated_sig.occurrence_count,
            linked_ticket: updated_sig.linked_ticket,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Get all analyses that share a signature
#[tauri::command]
pub async fn get_signature_occurrences(
    hash: String,
    db: DbState<'_>,
) -> Result<signature::SignatureOccurrences, String> {
    log::debug!("Getting occurrences for signature: {}", hash);

    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        let sig = db_clone
            .find_signature_by_hash(&hash)
            .map_err(|e| format!("Failed to find signature: {}", e))?
            .ok_or_else(|| "Signature not found".to_string())?;

        let files = db_clone
            .get_analyses_for_signature(&hash)
            .map_err(|e| format!("Failed to get analyses for signature: {}", e))?;

        Ok(signature::SignatureOccurrences {
            signature: sig,
            files,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Get top crash signatures by occurrence count
#[tauri::command]
pub async fn get_top_signatures(
    limit: Option<usize>,
    status: Option<String>,
    db: DbState<'_>,
) -> Result<Vec<signature::CrashSignature>, String> {
    log::debug!(
        "Getting top signatures (limit: {:?}, status: {:?})",
        limit,
        status
    );

    let db_clone = Arc::clone(&db);
    let limit_val = limit.unwrap_or(20);
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.get_top_signatures(limit_val, status.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to get top signatures: {}", e))
}

/// Update signature status
#[tauri::command]
pub async fn update_signature_status(
    hash: String,
    status: String,
    metadata: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::info!("Updating signature {} status to {}", hash, status);

    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.update_signature_status(&hash, &status, metadata.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to update signature status: {}", e))
}

/// Link a ticket to a signature
#[tauri::command]
pub async fn link_ticket_to_signature(
    hash: String,
    ticket_id: String,
    ticket_url: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::info!("Linking ticket {} to signature {}", ticket_id, hash);

    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.link_ticket_to_signature(&hash, &ticket_id, ticket_url.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to link ticket to signature: {}", e))
}

// ============================================================================
// WCR Parser Commands
// ============================================================================

/// Parse a crash file from disk path
#[tauri::command]
pub async fn parse_crash_file(path: String) -> Result<CrashFile, String> {
    // SECURITY: Validate path to prevent path traversal attacks
    if path.contains("..") {
        log::warn!("Path traversal attempt in parse_crash_file: {}", path);
        return Err("Invalid file path: path traversal not allowed".to_string());
    }

    // Canonicalize path to resolve symlinks and validate existence
    let canonical_path = async_fs::canonicalize(&path).await.map_err(|e| {
        log::error!("Failed to canonicalize path '{}': {}", path, e);
        "Invalid file path: file not found or inaccessible".to_string()
    })?;

    // Block access to sensitive system directories
    let path_str = canonical_path.to_string_lossy();
    let path_str_lower = path_str.to_lowercase();

    // Unix sensitive directories
    let blocked_unix = [
        "/etc", "/var", "/usr", "/bin", "/sbin", "/root", "/sys", "/proc",
    ];
    for prefix in &blocked_unix {
        if path_str.starts_with(prefix) {
            log::warn!(
                "Blocked access to system directory in parse_crash_file: {}",
                prefix
            );
            return Err(format!("Access denied: cannot read files from {}", prefix));
        }
    }

    // Windows sensitive directories
    let blocked_windows = [
        "c:\\windows",
        "c:\\program files",
        "c:\\programdata",
        "c:/windows",
        "c:/program files",
        "c:/programdata",
    ];
    for prefix in &blocked_windows {
        if path_str_lower.starts_with(prefix) {
            log::warn!("Blocked access to Windows system directory in parse_crash_file");
            return Err("Access denied: cannot read files from system directories".to_string());
        }
    }

    log::info!("Parsing crash file: {}", path);
    let parser = CrashFileParser::new();
    parser
        .parse_file(&canonical_path)
        .await
        .map_err(|e| format!("Parse error: {}", e))
}

/// Parse crash file content directly (for pasted content)
#[tauri::command]
pub fn parse_crash_content(content: String, file_name: String) -> Result<CrashFile, String> {
    log::info!("Parsing crash content: {}", file_name);
    let parser = CrashFileParser::new();
    parser
        .parse_content(&content, &file_name, content.len() as u64)
        .map_err(|e| format!("Parse error: {}", e))
}

/// Parse multiple crash files in batch
#[tauri::command]
pub async fn parse_crash_files_batch(
    paths: Vec<String>,
) -> Result<Vec<(String, Result<CrashFile, String>)>, String> {
    log::info!("Parsing {} crash files in batch", paths.len());
    let parser = CrashFileParser::new();
    let mut results = Vec::new();

    for path in paths {
        // SECURITY: Validate each path before parsing
        let result = validate_and_parse_file(&parser, &path).await;
        results.push((path, result));
    }

    Ok(results)
}

/// Helper function to validate path and parse crash file
async fn validate_and_parse_file(
    parser: &CrashFileParser,
    path: &str,
) -> Result<CrashFile, String> {
    // Check for path traversal
    if path.contains("..") {
        log::warn!("Path traversal attempt in batch parse: {}", path);
        return Err("Invalid file path: path traversal not allowed".to_string());
    }

    // Canonicalize path
    let canonical_path = async_fs::canonicalize(path)
        .await
        .map_err(|_| "Invalid file path: file not found or inaccessible".to_string())?;

    // Block sensitive directories
    let path_str = canonical_path.to_string_lossy();
    let path_str_lower = path_str.to_lowercase();

    let blocked_unix = [
        "/etc", "/var", "/usr", "/bin", "/sbin", "/root", "/sys", "/proc",
    ];
    for prefix in &blocked_unix {
        if path_str.starts_with(prefix) {
            return Err(format!("Access denied: cannot read files from {}", prefix));
        }
    }

    let blocked_windows = [
        "c:\\windows",
        "c:\\program files",
        "c:\\programdata",
        "c:/windows",
        "c:/program files",
        "c:/programdata",
    ];
    for prefix in &blocked_windows {
        if path_str_lower.starts_with(prefix) {
            return Err("Access denied: cannot read files from system directories".to_string());
        }
    }

    parser
        .parse_file(&canonical_path)
        .await
        .map_err(|e| format!("Parse error: {}", e))
}

// ============================================================================
// Known Patterns Commands
// ============================================================================

use crate::patterns::{create_pattern_engine, CrashPattern, PatternEngine, PatternMatchResult};
use std::sync::RwLock;

/// Managed state for pattern engine
pub struct PatternEngineState(pub RwLock<PatternEngine>);

/// Summary of a pattern for listing
#[derive(Serialize)]
pub struct PatternSummary {
    pub id: String,
    pub name: String,
    pub category: String,
    pub enabled: bool,
    pub priority: u32,
}

/// Find all matching patterns for a parsed crash file
#[tauri::command]
pub fn match_patterns(
    crash: CrashFile,
    engine: State<'_, PatternEngineState>,
) -> Result<Vec<PatternMatchResult>, String> {
    log::debug!("Matching patterns for crash file");
    // FIX #2/#3: Handle lock poisoning gracefully instead of panicking
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let results = engine_guard.find_matches(&crash);
    drop(engine_guard); // FIX #2: Explicit drop for clarity
    Ok(results)
}

/// Find the best matching pattern for a parsed crash file
#[tauri::command]
pub fn get_best_pattern_match(
    crash: CrashFile,
    engine: State<'_, PatternEngineState>,
) -> Result<Option<PatternMatchResult>, String> {
    log::debug!("Finding best pattern match");
    // FIX #2/#3: Handle lock poisoning gracefully instead of panicking
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let result = engine_guard.find_best_match(&crash);
    drop(engine_guard);
    Ok(result)
}

/// List all available patterns
#[tauri::command]
pub fn list_patterns(engine: State<'_, PatternEngineState>) -> Result<Vec<PatternSummary>, String> {
    log::debug!("Listing all patterns");
    // FIX #2/#3: Handle lock poisoning gracefully instead of panicking
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let summaries: Vec<PatternSummary> = engine_guard
        .patterns()
        .iter()
        .map(|p| PatternSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            category: format!("{:?}", p.category),
            enabled: p.enabled,
            priority: p.priority,
        })
        .collect();
    drop(engine_guard);
    Ok(summaries)
}

/// Get a specific pattern by ID
#[tauri::command]
pub fn get_pattern_by_id(
    id: String,
    engine: State<'_, PatternEngineState>,
) -> Result<Option<CrashPattern>, String> {
    log::debug!("Getting pattern by ID: {}", id);
    // FIX #2/#3: Handle lock poisoning gracefully instead of panicking
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let pattern = engine_guard.get_pattern(&id).cloned();
    drop(engine_guard);
    Ok(pattern)
}

/// Reload patterns from disk (including custom patterns)
#[tauri::command]
pub fn reload_patterns(
    custom_dir: Option<String>,
    engine: State<'_, PatternEngineState>,
) -> Result<usize, String> {
    log::info!("Reloading patterns (custom_dir: {:?})", custom_dir);
    // Create new engine OUTSIDE the lock to minimize hold time
    let new_engine = create_pattern_engine(
        custom_dir
            .as_ref()
            .map(|s| std::path::Path::new(s.as_str())),
    );
    let count = new_engine.patterns().len();

    // FIX #2/#3: Handle lock poisoning gracefully instead of panicking
    let mut state = engine
        .0
        .write()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    *state = new_engine;
    drop(state);

    log::info!("Loaded {} patterns", count);
    Ok(count)
}

/// Quick match: parse content and match patterns in one call
#[tauri::command]
pub fn quick_pattern_match(
    content: String,
    file_name: String,
    engine: State<'_, PatternEngineState>,
) -> Result<Option<PatternMatchResult>, String> {
    log::info!("Quick pattern match for: {}", file_name);

    // Parse the crash file OUTSIDE the lock (good practice already)
    let parser = CrashFileParser::new();
    let crash = parser
        .parse_content(&content, &file_name, content.len() as u64)
        .map_err(|e| format!("Parse error: {}", e))?;

    // FIX #2/#3: Handle lock poisoning gracefully instead of panicking
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let result = engine_guard.find_best_match(&crash);
    drop(engine_guard);
    Ok(result)
}

// ============================================================================
// Report Export Commands
// ============================================================================

use crate::export::{
    default_config_for_audience, export_report, export_report_multi, has_sensitive_content,
    sanitize_for_customer, simplify_technical_terms, ExportFormat, ReportAudience, ReportData,
    ReportSections,
};

/// Export configuration from frontend
#[derive(Deserialize)]
pub struct ExportRequest {
    pub crash_content: String,
    pub file_name: String,
    pub format: String,
    pub audience: Option<String>,
    pub title: Option<String>,
    pub include_sections: Option<Vec<String>>,
    pub footer_text: Option<String>,
}

/// Export response with content and suggested filename
#[derive(Serialize)]
pub struct ExportResponse {
    pub content: String,
    pub suggested_filename: String,
    pub format: String,
}

/// Generate a report from crash content
#[tauri::command]
pub fn generate_report(
    request: ExportRequest,
    engine: State<'_, PatternEngineState>,
) -> Result<ExportResponse, String> {
    log::info!(
        "Generating {} report for: {}",
        request.format,
        request.file_name
    );

    // Parse the crash file
    let parser = CrashFileParser::new();
    let crash = parser
        .parse_content(
            &request.crash_content,
            &request.file_name,
            request.crash_content.len() as u64,
        )
        .map_err(|e| format!("Parse error: {}", e))?;

    // Get pattern match
    // FIX #2/#3: Handle lock poisoning gracefully instead of panicking
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let pattern_match = engine_guard.find_best_match(&crash);
    drop(engine_guard);

    // Determine audience
    let audience = match request.audience.as_deref() {
        Some("customer") => ReportAudience::Customer,
        Some("support") => ReportAudience::Support,
        Some("executive") => ReportAudience::Executive,
        _ => ReportAudience::Technical,
    };

    // Build config
    let mut config = default_config_for_audience(audience);
    config.title = request.title;

    if let Some(footer) = request.footer_text {
        config.branding.footer_text = Some(footer);
    }

    // Override sections if specified
    if let Some(sections) = request.include_sections {
        config.sections = ReportSections {
            summary: sections.contains(&"summary".to_string()),
            environment: sections.contains(&"environment".to_string()),
            exception_details: sections.contains(&"exception_details".to_string()),
            root_cause: sections.contains(&"root_cause".to_string()),
            reproduction_steps: sections.contains(&"reproduction_steps".to_string()),
            suggested_fix: sections.contains(&"suggested_fix".to_string()),
            stack_trace: sections.contains(&"stack_trace".to_string()),
            context_arguments: sections.contains(&"context_arguments".to_string()),
            database_state: sections.contains(&"database_state".to_string()),
            memory_report: sections.contains(&"memory_report".to_string()),
            system_warnings: sections.contains(&"system_warnings".to_string()),
            impact_analysis: sections.contains(&"impact_analysis".to_string()),
            test_scenarios: sections.contains(&"test_scenarios".to_string()),
            investigation_queries: sections.contains(&"investigation_queries".to_string()),
            pattern_match: sections.contains(&"pattern_match".to_string()),
        };
    }

    // Create report data
    let report_data = ReportData::from_crash(&crash, pattern_match.as_ref(), config);

    // Determine format
    let format = match request.format.to_lowercase().as_str() {
        "html" => ExportFormat::Html,
        "json" => ExportFormat::Json,
        _ => ExportFormat::Markdown,
    };

    // Generate report
    let content = export_report(&report_data, format);

    // Determine file extension
    let extension = match format {
        ExportFormat::Html => "html",
        ExportFormat::Json => "json",
        ExportFormat::Markdown => "md",
    };

    // Create suggested filename
    let base_name = std::path::Path::new(&request.file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("report");

    let suggested_filename = format!("{}_report.{}", base_name, extension);

    Ok(ExportResponse {
        content,
        suggested_filename,
        format: request.format,
    })
}

/// Get available export formats
#[tauri::command]
pub fn get_export_formats() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "markdown",
            "name": "Markdown",
            "extension": "md",
            "description": "Plain text with formatting, ideal for documentation"
        }),
        serde_json::json!({
            "id": "html",
            "name": "HTML",
            "extension": "html",
            "description": "Styled web page, can be opened in any browser"
        }),
        serde_json::json!({
            "id": "json",
            "name": "JSON",
            "extension": "json",
            "description": "Structured data, ideal for integrations"
        }),
    ]
}

/// Get available audience options
#[tauri::command]
pub fn get_audience_options() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "technical",
            "name": "Technical",
            "description": "Full details for developers"
        }),
        serde_json::json!({
            "id": "support",
            "name": "Support",
            "description": "Actionable info for support engineers"
        }),
        serde_json::json!({
            "id": "customer",
            "name": "Customer",
            "description": "Sanitized summary for end users"
        }),
        serde_json::json!({
            "id": "executive",
            "name": "Executive",
            "description": "High-level summary for management"
        }),
    ]
}

/// Preview a report without saving
#[tauri::command]
pub fn preview_report(
    crash_content: String,
    file_name: String,
    format: String,
    audience: String,
    engine: State<'_, PatternEngineState>,
) -> Result<String, String> {
    let request = ExportRequest {
        crash_content,
        file_name,
        format,
        audience: Some(audience),
        title: None,
        include_sections: None,
        footer_text: None,
    };

    let response = generate_report(request, engine)?;
    Ok(response.content)
}

// ============================================================================
// Sensitive Content Detection Commands
// ============================================================================

/// Result of sensitive content check
#[derive(Serialize)]
pub struct SensitiveContentResult {
    pub has_sensitive: bool,
    pub warnings: Vec<String>,
    pub detected_types: Vec<String>,
}

/// Check content for sensitive data before sending to AI
#[tauri::command]
pub fn check_sensitive_content(content: String) -> Result<SensitiveContentResult, String> {
    log::debug!(
        "Checking content for sensitive data ({} bytes)",
        content.len()
    );

    let mut warnings = Vec::new();
    let mut detected_types = Vec::new();

    // Use regex patterns to detect specific types
    if EMAIL_RE.is_match(&content) {
        detected_types.push("email".to_string());
        warnings.push("Email addresses detected in content".to_string());
    }

    if IPV4_RE.is_match(&content) {
        detected_types.push("ip".to_string());
        warnings.push("IP addresses detected in content".to_string());
    }

    if TOKEN_RE.is_match(&content) {
        detected_types.push("token".to_string());
        warnings.push("API tokens or keys detected in content".to_string());
    }

    if WIN_PATH_RE.is_match(&content) || UNIX_HOME_RE.is_match(&content) {
        detected_types.push("path".to_string());
        warnings.push("User directory paths detected in content".to_string());
    }

    // Also use the sanitizer's check
    let has_sensitive = has_sensitive_content(&content) || !detected_types.is_empty();

    if has_sensitive && warnings.is_empty() {
        warnings.push("Potentially sensitive content detected (usernames, passwords)".to_string());
        detected_types.push("credentials".to_string());
    }

    log::info!(
        "Sensitive content check: has_sensitive={}, types={:?}",
        has_sensitive,
        detected_types
    );

    Ok(SensitiveContentResult {
        has_sensitive,
        warnings,
        detected_types,
    })
}

// ============================================================================
// Content Sanitization Commands
// ============================================================================

/// Sanitize content for a specific audience
#[tauri::command]
pub fn sanitize_content(content: String, audience: String) -> Result<String, String> {
    log::debug!("Sanitizing content for audience: {}", audience);

    let sanitized = match audience.to_lowercase().as_str() {
        "customer" | "executive" => {
            // Maximum sanitization: redact PII and simplify technical terms
            let redacted = sanitize_for_customer(&content);
            simplify_technical_terms(&redacted)
        }
        "support" => {
            // Moderate sanitization: redact PII but keep technical terms
            sanitize_for_customer(&content)
        }
        _ => {
            // Minimal sanitization (including "technical"): just redact obvious PII
            redact_pii_basic(&content).into_owned()
        }
    };

    log::info!("Content sanitized for audience: {}", audience);
    Ok(sanitized)
}

// ============================================================================
// Pattern Filtering Commands
// ============================================================================

/// Get patterns filtered by category
#[tauri::command]
pub fn get_patterns_by_category(
    category: String,
    engine: State<'_, PatternEngineState>,
) -> Result<Vec<PatternSummary>, String> {
    log::debug!("Getting patterns by category: {}", category);

    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    // Parse the category string into PatternCategory enum
    let category_enum = match category.to_lowercase().as_str() {
        "collectionerror" | "collection_error" | "collection" =>
            crate::patterns::PatternCategory::CollectionError,
        "nullreference" | "null_reference" | "null" =>
            crate::patterns::PatternCategory::NullReference,
        "databaseerror" | "database_error" | "database" =>
            crate::patterns::PatternCategory::DatabaseError,
        "typeerror" | "type_error" | "type" =>
            crate::patterns::PatternCategory::TypeError,
        "memoryerror" | "memory_error" | "memory" =>
            crate::patterns::PatternCategory::MemoryError,
        "concurrencyerror" | "concurrency_error" | "concurrency" =>
            crate::patterns::PatternCategory::ConcurrencyError,
        "businesslogic" | "business_logic" | "business" =>
            crate::patterns::PatternCategory::BusinessLogic,
        "configuration" | "config" =>
            crate::patterns::PatternCategory::Configuration,
        "whatsonspecific" | "whatson_specific" | "whatson" =>
            crate::patterns::PatternCategory::WhatsOnSpecific,
        "other" =>
            crate::patterns::PatternCategory::Other,
        _ => return Err(format!("Unknown category: {}. Valid: collection, null, database, type, memory, concurrency, business, configuration, whatson, other", category)),
    };

    let patterns = engine_guard.get_by_category(&category_enum);
    let summaries: Vec<PatternSummary> = patterns
        .iter()
        .map(|p| PatternSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            category: format!("{:?}", p.category),
            enabled: p.enabled,
            priority: p.priority,
        })
        .collect();

    drop(engine_guard);

    log::info!(
        "Found {} patterns in category: {}",
        summaries.len(),
        category
    );
    Ok(summaries)
}

/// Get patterns filtered by tag
#[tauri::command]
pub fn get_patterns_by_tag(
    tag: String,
    engine: State<'_, PatternEngineState>,
) -> Result<Vec<PatternSummary>, String> {
    log::debug!("Getting patterns by tag: {}", tag);

    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    let patterns = engine_guard.get_by_tag(&tag);
    let summaries: Vec<PatternSummary> = patterns
        .iter()
        .map(|p| PatternSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            category: format!("{:?}", p.category),
            enabled: p.enabled,
            priority: p.priority,
        })
        .collect();

    drop(engine_guard);

    log::info!("Found {} patterns with tag: {}", summaries.len(), tag);
    Ok(summaries)
}

/// Get all unique tags from patterns
#[tauri::command]
pub fn get_pattern_tags(engine: State<'_, PatternEngineState>) -> Result<Vec<String>, String> {
    log::debug!("Getting all pattern tags");

    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    // Clone individual strings instead of entire Vec for each pattern
    let mut tags: Vec<String> = engine_guard
        .patterns()
        .iter()
        .flat_map(|p| p.tags.iter().cloned())
        .collect();

    tags.sort();
    tags.dedup();

    drop(engine_guard);

    log::info!("Found {} unique tags", tags.len());
    Ok(tags)
}

/// Get all unique categories from patterns
#[tauri::command]
pub fn get_pattern_categories(
    engine: State<'_, PatternEngineState>,
) -> Result<Vec<String>, String> {
    log::debug!("Getting all pattern categories");

    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    let mut categories: Vec<String> = engine_guard
        .patterns()
        .iter()
        .map(|p| format!("{:?}", p.category))
        .collect();

    categories.sort();
    categories.dedup();

    drop(engine_guard);

    log::info!("Found {} unique categories", categories.len());
    Ok(categories)
}

// ============================================================================
// Multi-Format Export Commands
// ============================================================================

/// Request for multi-format export
#[derive(Deserialize)]
pub struct MultiExportRequest {
    pub crash_content: String,
    pub file_name: String,
    pub formats: Vec<String>,
    pub audience: Option<String>,
    pub title: Option<String>,
    pub include_sections: Option<Vec<String>>,
    pub footer_text: Option<String>,
}

/// Generate reports in multiple formats at once
#[tauri::command]
pub fn generate_report_multi(
    request: MultiExportRequest,
    engine: State<'_, PatternEngineState>,
) -> Result<Vec<ExportResponse>, String> {
    log::info!(
        "Generating multi-format report for: {} ({} formats)",
        request.file_name,
        request.formats.len()
    );

    // Parse the crash file
    let parser = CrashFileParser::new();
    let crash = parser
        .parse_content(
            &request.crash_content,
            &request.file_name,
            request.crash_content.len() as u64,
        )
        .map_err(|e| format!("Parse error: {}", e))?;

    // Get pattern match
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let pattern_match = engine_guard.find_best_match(&crash);
    drop(engine_guard);

    // Determine audience
    let audience = match request.audience.as_deref() {
        Some("customer") => ReportAudience::Customer,
        Some("support") => ReportAudience::Support,
        Some("executive") => ReportAudience::Executive,
        _ => ReportAudience::Technical,
    };

    // Build config
    let mut config = default_config_for_audience(audience);
    config.title = request.title.clone();

    if let Some(footer) = request.footer_text.clone() {
        config.branding.footer_text = Some(footer);
    }

    // Override sections if specified
    if let Some(sections) = request.include_sections.clone() {
        config.sections = ReportSections {
            summary: sections.contains(&"summary".to_string()),
            environment: sections.contains(&"environment".to_string()),
            exception_details: sections.contains(&"exception_details".to_string()),
            root_cause: sections.contains(&"root_cause".to_string()),
            reproduction_steps: sections.contains(&"reproduction_steps".to_string()),
            suggested_fix: sections.contains(&"suggested_fix".to_string()),
            stack_trace: sections.contains(&"stack_trace".to_string()),
            context_arguments: sections.contains(&"context_arguments".to_string()),
            database_state: sections.contains(&"database_state".to_string()),
            memory_report: sections.contains(&"memory_report".to_string()),
            system_warnings: sections.contains(&"system_warnings".to_string()),
            impact_analysis: sections.contains(&"impact_analysis".to_string()),
            test_scenarios: sections.contains(&"test_scenarios".to_string()),
            investigation_queries: sections.contains(&"investigation_queries".to_string()),
            pattern_match: sections.contains(&"pattern_match".to_string()),
        };
    }

    // Create report data
    let report_data = ReportData::from_crash(&crash, pattern_match.as_ref(), config);

    // Parse format strings into enum values
    let export_formats: Vec<ExportFormat> = request
        .formats
        .iter()
        .filter_map(|f| match f.to_lowercase().as_str() {
            "html" => Some(ExportFormat::Html),
            "json" => Some(ExportFormat::Json),
            "markdown" | "md" => Some(ExportFormat::Markdown),
            _ => None,
        })
        .collect();

    // Generate reports in all formats
    let results = export_report_multi(&report_data, &export_formats);

    // Get base name for suggested filenames
    let base_name = std::path::Path::new(&request.file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("report");

    // Convert to response format
    let responses: Vec<ExportResponse> = results
        .into_iter()
        .map(|(format, content)| {
            let (extension, format_str) = match format {
                ExportFormat::Html => ("html", "html"),
                ExportFormat::Json => ("json", "json"),
                ExportFormat::Markdown => ("md", "markdown"),
            };

            ExportResponse {
                content,
                suggested_filename: format!("{}_report.{}", base_name, extension),
                format: format_str.to_string(),
            }
        })
        .collect();

    log::info!("Generated {} format reports", responses.len());
    Ok(responses)
}

// ============================================================================
// Database Admin Commands
// ============================================================================

/// Database information for admin panel
#[derive(Serialize)]
pub struct DatabaseInfo {
    pub schema_version: i32,
    pub analyses_count: i64,
    pub translations_count: i64,
    pub favorites_count: i64,
    pub needs_migration: bool,
    pub database_size_bytes: Option<u64>,
    pub last_analysis_at: Option<String>,
}

/// Get database admin information
#[tauri::command]
pub async fn get_database_info(db: DbState<'_>) -> Result<DatabaseInfo, String> {
    log::debug!("Getting database info");

    // Try to get database file size asynchronously (separate from blocking DB ops)
    let database_size_bytes =
        if let Some(db_path) = dirs::data_dir().map(|p| p.join("hadron").join("analyses.db")) {
            async_fs::metadata(&db_path).await.ok().map(|m| m.len())
        } else {
            None
        };

    // Run all database operations in spawn_blocking to avoid blocking async runtime
    let db_clone = Arc::clone(&db);
    let db_result = tauri::async_runtime::spawn_blocking(move || {
        // Get schema version
        let schema_version = db_clone
            .get_schema_version()
            .map_err(|e| format!("Failed to get schema version: {}", e))?;

        // Expected version (should match latest migration)
        const EXPECTED_SCHEMA_VERSION: i32 = 5;
        let needs_migration = schema_version < EXPECTED_SCHEMA_VERSION;

        // Get counts
        let analyses_count = db_clone
            .get_analyses_count()
            .map_err(|e| format!("Failed to get analyses count: {}", e))?;

        let translations_count = db_clone
            .get_translations_count()
            .map_err(|e| format!("Failed to get translations count: {}", e))?;

        // Get statistics for favorites count
        let stats = db_clone
            .get_statistics()
            .map_err(|e| format!("Failed to get statistics: {}", e))?;
        let favorites_count = stats
            .get("favorite_count")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // Get last analysis timestamp
        let last_analysis_at = db_clone
            .get_recent(1)
            .ok()
            .and_then(|v| v.into_iter().next())
            .map(|a| a.analyzed_at);

        log::info!(
            "Database info: version={}, analyses={}, translations={}",
            schema_version,
            analyses_count,
            translations_count
        );

        Ok::<_, String>((
            schema_version,
            analyses_count,
            translations_count,
            favorites_count,
            needs_migration,
            last_analysis_at,
        ))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let (
        schema_version,
        analyses_count,
        translations_count,
        favorites_count,
        needs_migration,
        last_analysis_at,
    ) = db_result;

    Ok(DatabaseInfo {
        schema_version,
        analyses_count,
        translations_count,
        favorites_count,
        needs_migration,
        database_size_bytes,
        last_analysis_at,
    })
}

// ============================================================================
// Performance Trace Analysis Commands
// ============================================================================

/// Performance trace header statistics
#[derive(Serialize, Clone)]
pub struct PerformanceHeader {
    pub samples: i64,
    pub avg_ms_per_sample: f64,
    pub scavenges: i64,
    pub inc_gcs: i64,
    pub stack_spills: i64,
    pub mark_stack_overflows: i64,
    pub weak_list_overflows: i64,
    pub jit_cache_spills: i64,
    pub active_time: f64,
    pub other_processes: f64,
    pub real_time: f64,
    pub profiling_overhead: f64,
}

/// Derived performance metrics
#[derive(Serialize, Clone)]
pub struct DerivedMetrics {
    pub cpu_utilization: f64,
    pub smalltalk_activity_ratio: f64,
    pub sample_density: f64,
    pub gc_pressure: f64,
}

/// Process info from performance trace
#[derive(Serialize, Clone)]
pub struct ProcessInfo {
    pub name: String,
    pub priority: String,
    pub percentage: f64,
    pub status: String,
}

/// Top method info
#[derive(Serialize, Clone)]
pub struct TopMethod {
    pub method: String,
    pub percentage: f64,
    pub category: String,
}

/// Detected performance pattern
#[derive(Serialize, Clone)]
pub struct DetectedPattern {
    pub r#type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub confidence: i32,
}

/// User scenario reconstruction
#[derive(Serialize, Clone)]
pub struct UserScenario {
    pub trigger: String,
    pub action: String,
    pub context: String,
    pub impact: String,
    pub additional_factors: Vec<String>,
}

/// Performance recommendation
#[derive(Serialize, Clone)]
pub struct PerformanceRecommendation {
    pub r#type: String,
    pub priority: String,
    pub title: String,
    pub description: String,
    pub effort: String,
}

/// Full performance analysis result
#[derive(Serialize, Clone)]
pub struct PerformanceAnalysisResult {
    pub filename: String,
    pub user: String,
    pub timestamp: String,
    pub header: PerformanceHeader,
    pub derived: DerivedMetrics,
    pub processes: Vec<ProcessInfo>,
    pub top_methods: Vec<TopMethod>,
    pub patterns: Vec<DetectedPattern>,
    pub scenario: UserScenario,
    pub recommendations: Vec<PerformanceRecommendation>,
    pub overall_severity: String,
    pub summary: String,
}

/// Parse and analyze a VisualWorks Smalltalk performance trace file
#[tauri::command]
pub async fn analyze_performance_trace(
    file_path: String,
    db: DbState<'_>,
) -> Result<PerformanceAnalysisResult, String> {
    log::info!("Analyzing performance trace: {}", file_path);
    let start_time = Instant::now();

    // SECURITY: Validate file path before reading (canonicalization, blocklist, size limit)
    let canonical_path = validate_file_path(&file_path, MAX_PERFORMANCE_TRACE_SIZE_BYTES).await?;

    // Read the file from validated path
    let content = async_fs::read_to_string(&canonical_path)
        .await
        .map_err(|e| {
            log::error!(
                "Failed to read performance trace '{}': {}",
                canonical_path.display(),
                e
            );
            "Failed to read file: check file permissions".to_string()
        })?;
    let metadata = async_fs::metadata(&canonical_path).await.map_err(|e| {
        log::error!(
            "Failed to read performance trace metadata '{}': {}",
            canonical_path.display(),
            e
        );
        "Failed to read file metadata".to_string()
    })?;

    let filename = canonical_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.log")
        .to_string();

    // Move CPU-bound parsing to blocking thread pool to avoid starving the async executor
    let filename_for_parse = filename.clone();
    let result = tauri::async_runtime::spawn_blocking(move || parse_performance_trace(&content, &filename_for_parse))
        .await
        .map_err(|e| format!("Task error: {}", e))??;

    let duration_ms = start_time.elapsed().as_millis() as i32;
    let severity = normalize_severity(&result.overall_severity);
    let suggested_fixes: Vec<String> = result
        .recommendations
        .iter()
        .map(|rec| format!("{}: {}", rec.title, rec.description))
        .collect();

    let analysis = Analysis {
        id: 0,
        filename: filename.clone(),
        file_size_kb: metadata.len() as f64 / 1024.0,
        error_type: "PerformanceTrace".to_string(),
        error_message: None,
        severity,
        component: None,
        stack_trace: None,
        root_cause: result.summary.clone(),
        suggested_fixes: serde_json::to_string(&suggested_fixes).unwrap_or_else(|e| {
            log::warn!("Failed to serialize performance suggestions: {}", e);
            "[]".to_string()
        }),
        confidence: None,
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        ai_model: "performance-analyzer".to_string(),
        ai_provider: Some("local".to_string()),
        tokens_used: 0,
        cost: 0.0,
        was_truncated: false,
        full_data: Some(serde_json::to_string(&result).unwrap_or_else(|e| {
            log::warn!("Failed to serialize performance analysis result: {}", e);
            "{}".to_string()
        })),
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: Some(duration_ms),
        analysis_type: "performance".to_string(),
    };

    let db_clone = Arc::clone(&db);
    let file_path_for_log = file_path.clone();
    let severity_for_log = analysis.severity.clone();
    let id = tauri::async_runtime::spawn_blocking(move || db_clone.insert_analysis(&analysis))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| {
            log::error!(
                "Database insert failed for performance analysis: file={}, error={}",
                file_path_for_log,
                e
            );
            format!("Database error: {}", e)
        })?;

    log::info!(
        "Performance analysis saved: id={}, file={}, severity={}",
        id,
        file_path,
        severity_for_log
    );

    Ok(result)
}

/// Get file stats (size) for a file path
/// SECURITY: Uses path validation to prevent access to sensitive system files
#[tauri::command]
pub async fn get_file_stats(path: String) -> Result<serde_json::Value, String> {
    // SECURITY: Validate file path before accessing (canonicalization, blocklist)
    // Use a generous size limit since we're only reading metadata, not content
    let canonical_path = validate_file_path(&path, u64::MAX).await?;

    let metadata = async_fs::metadata(&canonical_path).await.map_err(|e| {
        log::error!(
            "Failed to get file stats for '{}': {}",
            canonical_path.display(),
            e
        );
        "Failed to access file: permission denied or file not found".to_string()
    })?;

    Ok(serde_json::json!({
        "size": metadata.len()
    }))
}

/// Parse performance trace content
fn parse_performance_trace(
    content: &str,
    filename: &str,
) -> Result<PerformanceAnalysisResult, String> {
    let lines: Vec<&str> = content.lines().collect();

    // Extract user and timestamp from filename
    // Format: performanceTrace_username_YYYY-MM-DD_HH-MM-SS.log
    let (user, timestamp) = extract_user_timestamp(filename);

    // Parse header section
    let header = parse_header(&lines)?;

    // Calculate derived metrics
    let derived = calculate_derived_metrics(&header);

    // Parse process distribution
    let processes = parse_processes(&lines);

    // Parse top methods
    let top_methods = parse_top_methods(&lines);

    // Detect patterns
    let patterns = detect_patterns(&header, &derived, &processes, &top_methods, &lines);

    // Reconstruct user scenario
    let scenario = reconstruct_scenario(&patterns, &top_methods, &lines);

    // Generate recommendations
    let recommendations = generate_recommendations(&patterns, &header, &derived);

    // Determine overall severity
    let overall_severity = determine_severity(&patterns);

    // Generate summary
    let summary = generate_summary(&patterns, &header, &derived);

    Ok(PerformanceAnalysisResult {
        filename: filename.to_string(),
        user,
        timestamp,
        header,
        derived,
        processes,
        top_methods,
        patterns,
        scenario,
        recommendations,
        overall_severity,
        summary,
    })
}

fn extract_user_timestamp(filename: &str) -> (String, String) {
    // Try to parse: performanceTrace_username_YYYY-MM-DD_HH-MM-SS.log
    let parts: Vec<&str> = filename
        .trim_start_matches("performanceTrace_")
        .trim_end_matches(".log")
        .splitn(3, '_')
        .collect();

    if parts.len() >= 2 {
        let user = parts[0].replace('_', " ");
        let date_time = if parts.len() >= 3 {
            format!("{} {}", parts[1], parts[2].replace('-', ":"))
        } else {
            parts[1].to_string()
        };
        (user, date_time)
    } else {
        (
            "Unknown".to_string(),
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        )
    }
}

fn parse_header(lines: &[&str]) -> Result<PerformanceHeader, String> {
    let mut header = PerformanceHeader {
        samples: 0,
        avg_ms_per_sample: 0.0,
        scavenges: 0,
        inc_gcs: 0,
        stack_spills: 0,
        mark_stack_overflows: 0,
        weak_list_overflows: 0,
        jit_cache_spills: 0,
        active_time: 0.0,
        other_processes: 0.0,
        real_time: 0.0,
        profiling_overhead: 0.0,
    };

    for line in lines {
        let line = line.trim();

        // Parse various header fields
        if line.starts_with("Samples:") || line.contains("samples") {
            if let Some(num) = extract_number(line) {
                header.samples = num as i64;
            }
        } else if line.contains("ms/sample") || line.contains("msPerSample") {
            if let Some(num) = extract_float(line) {
                header.avg_ms_per_sample = num;
            }
        } else if line.starts_with("Scavenges:") || line.contains("scavenges") {
            if let Some(num) = extract_number(line) {
                header.scavenges = num as i64;
            }
        } else if line.contains("incGC") || line.contains("incremental GC") {
            if let Some(num) = extract_number(line) {
                header.inc_gcs = num as i64;
            }
        } else if line.contains("stackSpill") || line.contains("stack spill") {
            if let Some(num) = extract_number(line) {
                header.stack_spills = num as i64;
            }
        } else if line.contains("markStackOverflow") {
            if let Some(num) = extract_number(line) {
                header.mark_stack_overflows = num as i64;
            }
        } else if line.contains("weakListOverflow") {
            if let Some(num) = extract_number(line) {
                header.weak_list_overflows = num as i64;
            }
        } else if line.contains("jitCacheSpill") {
            if let Some(num) = extract_number(line) {
                header.jit_cache_spills = num as i64;
            }
        } else if line.contains("active time") || line.contains("activeTime") {
            if let Some(num) = extract_float(line) {
                header.active_time = num;
            }
        } else if line.contains("other processes") || line.contains("otherProcesses") {
            if let Some(num) = extract_float(line) {
                header.other_processes = num;
            }
        } else if line.contains("real time") || line.contains("realTime") {
            if let Some(num) = extract_float(line) {
                header.real_time = num;
            }
        } else if line.contains("profiling overhead") {
            if let Some(num) = extract_float(line) {
                header.profiling_overhead = num;
            }
        }
    }

    // Default real time if not found
    if header.real_time == 0.0 && header.active_time > 0.0 {
        header.real_time = header.active_time + header.other_processes;
    }

    Ok(header)
}

fn extract_number(text: &str) -> Option<f64> {
    static NUM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[\d,]+(?:\.\d+)?").unwrap());

    NUM_RE
        .find(text)
        .and_then(|m| m.as_str().replace(',', "").parse::<f64>().ok())
}

fn extract_float(text: &str) -> Option<f64> {
    static FLOAT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\d+\.?\d*").unwrap());

    FLOAT_RE
        .find(text)
        .and_then(|m| m.as_str().parse::<f64>().ok())
}

fn calculate_derived_metrics(header: &PerformanceHeader) -> DerivedMetrics {
    let total_time = header.active_time + header.other_processes;
    let cpu_utilization = if total_time > 0.0 {
        (total_time / header.real_time.max(total_time)) * 100.0
    } else {
        0.0
    };

    let smalltalk_activity_ratio = if header.real_time > 0.0 {
        (header.active_time / header.real_time) * 100.0
    } else {
        0.0
    };

    let sample_density = if header.active_time > 0.0 {
        header.samples as f64 / header.active_time
    } else {
        0.0
    };

    let gc_pressure = if header.samples > 0 {
        (header.scavenges + header.inc_gcs) as f64 / header.samples as f64
    } else {
        0.0
    };

    DerivedMetrics {
        cpu_utilization: (cpu_utilization * 10.0).round() / 10.0,
        smalltalk_activity_ratio: (smalltalk_activity_ratio * 10.0).round() / 10.0,
        sample_density: (sample_density * 10.0).round() / 10.0,
        gc_pressure: (gc_pressure * 100.0).round() / 100.0,
    }
}

fn parse_processes(lines: &[&str]) -> Vec<ProcessInfo> {
    let mut processes = Vec::new();
    let mut in_process_section = false;

    static PROCESS_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(?:@\s*)?(\d+|-)\s+(\d+\.?\d*)%?").unwrap()
    });

    for line in lines {
        let line = line.trim();

        // Look for process section markers
        if line.contains("Process") && (line.contains("Priority") || line.contains("Samples")) {
            in_process_section = true;
            continue;
        }

        // End of section
        if in_process_section && line.is_empty() {
            in_process_section = false;
            continue;
        }

        if in_process_section {
            if let Some(caps) = PROCESS_RE.captures(line) {
                let name = caps.get(1).map_or("", |m| m.as_str()).to_string();
                let priority = caps.get(2).map_or("-", |m| m.as_str()).to_string();
                let percentage: f64 = caps
                    .get(3)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0.0);

                let status = if (name.contains("Idle") && percentage > 8.0)
                    || (percentage > 90.0 && !name.contains("Launcher"))
                {
                    "warning"
                } else {
                    "normal"
                };

                processes.push(ProcessInfo {
                    name,
                    priority,
                    percentage,
                    status: status.to_string(),
                });
            }
        }
    }

    // If no processes found, add default entries
    if processes.is_empty() {
        processes.push(ProcessInfo {
            name: "Main Process".to_string(),
            priority: "50".to_string(),
            percentage: 85.0,
            status: "normal".to_string(),
        });
    }

    processes
}

fn parse_top_methods(lines: &[&str]) -> Vec<TopMethod> {
    let mut methods = Vec::new();
    let mut in_methods_section = false;

    static METHOD_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+\.?\d*)%?\s+(.+)").unwrap());

    for line in lines {
        let line = line.trim();

        // Look for method section markers
        if line.contains("Totals") || line.contains("Self-Time") || line.contains("self time") {
            in_methods_section = true;
            continue;
        }

        // End of section marker
        if in_methods_section && (line.is_empty() || line.starts_with("===")) {
            if methods.len() >= 8 {
                break;
            }
            continue;
        }

        if in_methods_section && !line.is_empty() {
            if let Some(caps) = METHOD_RE.captures(line) {
                let percentage: f64 = caps
                    .get(1)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0.0);
                let method = caps.get(2).map_or("", |m| m.as_str()).trim().to_string();

                if percentage > 0.0 && !method.is_empty() && methods.len() < 8 {
                    let category = categorize_method(&method);
                    methods.push(TopMethod {
                        method,
                        percentage,
                        category,
                    });
                }
            }
        }
    }

    methods
}

fn categorize_method(method: &str) -> String {
    let method_lower = method.to_lowercase();

    if method_lower.contains("primcallc")
        || method_lower.contains("external")
        || method_lower.contains("ffi")
    {
        "FFI/External".to_string()
    } else if method_lower.contains("graphicscontext")
        || method_lower.contains("paint")
        || method_lower.contains("display")
    {
        "Graphics".to_string()
    } else if method_lower.contains("gc")
        || method_lower.contains("scavenge")
        || method_lower.contains("memory")
        || method_lower.contains("weakarray")
    {
        "GC".to_string()
    } else if method_lower.contains("postgres")
        || method_lower.contains("oracle")
        || method_lower.contains("database")
        || method_lower.contains("sql")
        || method_lower.contains("session")
    {
        "Database".to_string()
    } else if method_lower.contains("maf")
        || method_lower.contains("widget")
        || method_lower.contains("column")
        || method_lower.contains("label")
        || method_lower.contains("button")
    {
        "UI Rendering".to_string()
    } else if method_lower.contains("collection")
        || method_lower.contains("array")
        || method_lower.contains("do:")
        || method_lower.contains("select:")
        || method_lower.contains("orderedcollection")
    {
        "Collection".to_string()
    } else if method_lower.contains("session") || method_lower.contains("t3session") {
        "Session".to_string()
    } else {
        "Other".to_string()
    }
}

fn detect_patterns(
    header: &PerformanceHeader,
    derived: &DerivedMetrics,
    processes: &[ProcessInfo],
    top_methods: &[TopMethod],
    lines: &[&str],
) -> Vec<DetectedPattern> {
    let mut patterns = Vec::new();
    let content = lines.join("\n");

    // Check for GC pressure
    if derived.gc_pressure > 1.0 || header.scavenges > 5000 {
        patterns.push(DetectedPattern {
            r#type: "gc_pressure".to_string(),
            severity: if derived.gc_pressure > 2.0 {
                "high"
            } else {
                "medium"
            }
            .to_string(),
            title: "Elevated GC Activity".to_string(),
            description: format!(
                "GC pressure at {:.2} with {} scavenges indicates memory pressure",
                derived.gc_pressure, header.scavenges
            ),
            confidence: 90,
        });
    }

    // Check for UI rendering overhead
    let ui_percentage: f64 = top_methods
        .iter()
        .filter(|m| m.category == "Graphics" || m.category == "UI Rendering")
        .map(|m| m.percentage)
        .sum();

    if ui_percentage > 10.0 {
        patterns.push(DetectedPattern {
            r#type: "ui_rendering".to_string(),
            severity: if ui_percentage > 20.0 {
                "high"
            } else {
                "medium"
            }
            .to_string(),
            title: "UI Rendering Overhead".to_string(),
            description: format!(
                "Graphics and UI operations consuming {:.1}% of CPU time",
                ui_percentage
            ),
            confidence: 85,
        });
    }

    // Check for database activity
    let db_percentage: f64 = top_methods
        .iter()
        .filter(|m| m.category == "Database")
        .map(|m| m.percentage)
        .sum();

    if db_percentage > 5.0 {
        let severity = if db_percentage > 15.0 {
            "high"
        } else if db_percentage > 8.0 {
            "medium"
        } else {
            "low"
        };
        patterns.push(DetectedPattern {
            r#type: "database".to_string(),
            severity: severity.to_string(),
            title: "Database Activity".to_string(),
            description: format!(
                "Database operations consuming {:.1}% of CPU time",
                db_percentage
            ),
            confidence: 90,
        });
    }

    // Check for changelog sync (WHATS'ON specific)
    if content.contains("ChangeLogSynchronizer") || content.contains("changelog") {
        patterns.push(DetectedPattern {
            r#type: "changelog_sync".to_string(),
            severity: "high".to_string(),
            title: "Change Log Synchronization".to_string(),
            description:
                "Multi-user synchronization activity detected - processing changes from other users"
                    .to_string(),
            confidence: 95,
        });
    }

    // Check for widget update cascade
    if content.contains("updateWidgetsInApplications") || content.contains("widgetUpdate") {
        patterns.push(DetectedPattern {
            r#type: "widget_update".to_string(),
            severity: "medium".to_string(),
            title: "Widget Update Cascade".to_string(),
            description: "Cascading widget updates detected - all open windows being refreshed"
                .to_string(),
            confidence: 92,
        });
    }

    // Check for low activity ratio
    if derived.smalltalk_activity_ratio < 25.0 && derived.smalltalk_activity_ratio > 0.0 {
        patterns.push(DetectedPattern {
            r#type: "low_activity".to_string(),
            severity: "info".to_string(),
            title: "Low Smalltalk Activity Ratio".to_string(),
            description: format!(
                "Only {:.1}% of time in Smalltalk code - system may be waiting on external resources",
                derived.smalltalk_activity_ratio
            ),
            confidence: 85,
        });
    }

    // Check for user interaction patterns
    if content.contains("YellowButtonPressedEvent") || content.contains("right-click") {
        patterns.push(DetectedPattern {
            r#type: "user_interaction".to_string(),
            severity: "info".to_string(),
            title: "Right-Click List Selection".to_string(),
            description: "User performed right-click selection in a list widget".to_string(),
            confidence: 95,
        });
    }

    // Check for high idle process
    for process in processes {
        if process.name.contains("Idle") && process.percentage > 8.0 {
            patterns.push(DetectedPattern {
                r#type: "idle_process".to_string(),
                severity: "warning".to_string(),
                title: "Elevated Idle Process".to_string(),
                description: format!(
                    "IdleLoopProcess at {:.1}% indicates system waiting or GC activity",
                    process.percentage
                ),
                confidence: 88,
            });
            break;
        }
    }

    patterns
}

fn reconstruct_scenario(
    patterns: &[DetectedPattern],
    top_methods: &[TopMethod],
    lines: &[&str],
) -> UserScenario {
    let content = lines.join("\n");

    // Determine trigger based on patterns
    let trigger = if patterns.iter().any(|p| p.r#type == "changelog_sync") {
        "Change Log Polling (automatic)".to_string()
    } else if patterns.iter().any(|p| p.r#type == "user_interaction") {
        "User interaction (mouse/keyboard)".to_string()
    } else if patterns.iter().any(|p| p.r#type == "database") {
        "Database query or transaction".to_string()
    } else {
        "Application activity".to_string()
    };

    // Determine action
    let action = if content.contains("ChangeLogSynchronizer") {
        "Background synchronization processing changes from concurrent users".to_string()
    } else if content.contains("YellowButtonPressedEvent") {
        "User performed a right-click selection operation in a list component".to_string()
    } else {
        "Normal application processing".to_string()
    };

    // Determine context
    let context = if patterns.iter().any(|p| p.r#type == "widget_update") {
        "The system processed changes and propagated updates to all open application windows"
            .to_string()
    } else if patterns.iter().any(|p| p.r#type == "ui_rendering") {
        "UI rendering operations were active during the trace period".to_string()
    } else {
        "Standard application operation".to_string()
    };

    // Calculate impact
    let total_impact: f64 = patterns
        .iter()
        .filter(|p| p.severity == "high" || p.severity == "medium")
        .count() as f64
        * 15.0;
    let impact = format!(
        "Detected patterns consumed approximately {:.0}% of active processing time",
        total_impact.min(75.0)
    );

    // Additional factors
    let mut factors = Vec::new();
    if patterns.iter().any(|p| p.r#type == "gc_pressure") {
        factors.push("Memory pressure requiring frequent garbage collection".to_string());
    }
    if patterns.iter().any(|p| p.r#type == "ui_rendering") {
        factors.push("Complex UI rendering with multiple components".to_string());
    }
    if top_methods.iter().any(|m| m.category == "FFI/External") {
        factors.push("External function calls (FFI) contributing to overhead".to_string());
    }

    UserScenario {
        trigger,
        action,
        context,
        impact,
        additional_factors: factors,
    }
}

fn generate_recommendations(
    patterns: &[DetectedPattern],
    _header: &PerformanceHeader,
    derived: &DerivedMetrics,
) -> Vec<PerformanceRecommendation> {
    let mut recommendations = Vec::new();

    // GC-related recommendations
    if patterns.iter().any(|p| p.r#type == "gc_pressure") {
        recommendations.push(PerformanceRecommendation {
            r#type: "optimization".to_string(),
            priority: "medium".to_string(),
            title: "Review Memory Allocation".to_string(),
            description: "Consider reviewing code for excessive object creation or retention"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    // UI rendering recommendations
    if patterns.iter().any(|p| p.r#type == "ui_rendering") {
        recommendations.push(PerformanceRecommendation {
            r#type: "optimization".to_string(),
            priority: "medium".to_string(),
            title: "Review List Rendering".to_string(),
            description: "Consider implementing virtual scrolling for lists with many items"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    // Changelog sync recommendations
    if patterns.iter().any(|p| p.r#type == "changelog_sync") {
        recommendations.push(PerformanceRecommendation {
            r#type: "documentation".to_string(),
            priority: "high".to_string(),
            title: "Expected Multi-User Behavior".to_string(),
            description: "This is normal behavior when other users commit changes. Document for user awareness.".to_string(),
            effort: "None".to_string(),
        });
        recommendations.push(PerformanceRecommendation {
            r#type: "workaround".to_string(),
            priority: "medium".to_string(),
            title: "Close Unused Windows".to_string(),
            description:
                "Users can close windows they are not actively using to reduce sync overhead"
                    .to_string(),
            effort: "None".to_string(),
        });
    }

    // Widget update recommendations
    if patterns.iter().any(|p| p.r#type == "widget_update") {
        recommendations.push(PerformanceRecommendation {
            r#type: "optimization".to_string(),
            priority: "low".to_string(),
            title: "Incremental Widget Updates".to_string(),
            description: "Investigate selective widget refresh instead of full hierarchy update"
                .to_string(),
            effort: "High".to_string(),
        });
    }

    // Low activity recommendations
    if derived.smalltalk_activity_ratio < 25.0 {
        recommendations.push(PerformanceRecommendation {
            r#type: "investigation".to_string(),
            priority: "medium".to_string(),
            title: "Investigate External Waits".to_string(),
            description: "Low Smalltalk activity suggests waiting on I/O or external services"
                .to_string(),
            effort: "Medium".to_string(),
        });
    }

    // Default recommendations if none generated
    if recommendations.is_empty() {
        recommendations.push(PerformanceRecommendation {
            r#type: "documentation".to_string(),
            priority: "low".to_string(),
            title: "Normal Operation".to_string(),
            description: "No significant performance issues detected. Continue monitoring."
                .to_string(),
            effort: "None".to_string(),
        });
    }

    recommendations
}

fn determine_severity(patterns: &[DetectedPattern]) -> String {
    if patterns.iter().any(|p| p.severity == "critical") {
        "critical".to_string()
    } else if patterns.iter().any(|p| p.severity == "high") {
        "high".to_string()
    } else if patterns.iter().any(|p| p.severity == "medium") {
        "medium".to_string()
    } else if patterns.iter().any(|p| p.severity == "low") {
        "low".to_string()
    } else {
        "info".to_string()
    }
}

fn generate_summary(
    patterns: &[DetectedPattern],
    header: &PerformanceHeader,
    derived: &DerivedMetrics,
) -> String {
    let high_count = patterns.iter().filter(|p| p.severity == "high").count();
    let medium_count = patterns.iter().filter(|p| p.severity == "medium").count();

    if high_count > 0 {
        let main_issue = patterns
            .iter()
            .find(|p| p.severity == "high")
            .map(|p| p.title.clone())
            .unwrap_or_else(|| "Performance issues".to_string());
        format!(
            "Significant performance impact detected. Primary issue: {}. {} high and {} medium severity patterns found.",
            main_issue, high_count, medium_count
        )
    } else if medium_count > 0 {
        format!(
            "Moderate performance overhead detected with {} patterns. CPU utilization at {:.1}%, Smalltalk activity at {:.1}%.",
            medium_count, derived.cpu_utilization, derived.smalltalk_activity_ratio
        )
    } else {
        format!(
            "Normal operation detected. {} samples collected over {:.1} seconds with {:.1}% CPU utilization.",
            header.samples, header.real_time, derived.cpu_utilization
        )
    }
}
