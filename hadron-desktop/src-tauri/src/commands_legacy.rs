use crate::ai_service;
use crate::ai_service::translate_llamacpp;
use crate::database::{
    Analysis, Database, ErrorPatternCount, Tag, Translation, TrendDataPoint,
};
use crate::jira_service;
use crate::keeper_service;
use crate::sentry_service;
use crate::model_fetcher::{
    list_models as fetch_models, test_connection as test_api_connection, ConnectionTestResult,
    Model,
};
use crate::models::CrashFile;
use crate::parser::CrashFileParser;
use crate::python_runner::run_python_translation;
use crate::rag_commands;
use crate::signature;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, State};
use tokio::fs as async_fs;
use zeroize::Zeroizing;

// ============================================================================
// Shared types and helpers (canonical definitions in commands::common)
// ============================================================================

pub use crate::commands::common::{
    AnalysisPhase, AnalysisProgress, AutoTagSummary, DbState,
    MAX_CRASH_LOG_SIZE_BYTES, MAX_PERFORMANCE_TRACE_SIZE_BYTES,
    MAX_TRANSLATION_CONTENT_SIZE, MAX_PASTED_LOG_SIZE,
    emit_progress, normalize_severity, redact_pii_basic, validate_file_path,
    detect_pii_types,
};

// ============================================================================
// Automated Tagging (Deterministic)
// ============================================================================

const AUTO_TAG_LIMIT: usize = 10;

fn auto_tag_color(tag: &str) -> &'static str {
    match tag {
        "critical" => "#EF4444",
        "high" => "#F97316",
        "medium" => "#EAB308",
        "low" => "#3B82F6",
        "comprehensive" => "#10B981",
        "quick" => "#06B6D4",
        "performance" => "#F59E0B",
        "code" => "#6366F1",
        "legacy" => "#8B5CF6",
        "jira" => "#0052CC",
        _ => "#6B7280",
    }
}

fn push_auto_tag(tags: &mut Vec<(String, String)>, seen: &mut HashSet<String>, name: &str) {
    if tags.len() >= AUTO_TAG_LIMIT {
        return;
    }
    let normalized = name.to_lowercase();
    if seen.insert(normalized.clone()) {
        tags.push((normalized, auto_tag_color(name).to_string()));
    }
}

fn collect_auto_tags(analysis: &Analysis) -> Vec<(String, String)> {
    let mut tags: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Severity
    if !analysis.severity.is_empty() {
        push_auto_tag(&mut tags, &mut seen, analysis.severity.to_lowercase().as_str());
    }

    // Analysis type
    let analysis_type = analysis.analysis_type.to_lowercase();
    let type_tag = match analysis_type.as_str() {
        "whatson" | "comprehensive" => "comprehensive",
        "quick" => "quick",
        "performance" => "performance",
        "code" => "code",
        "jira_ticket" => "jira",
        "complete" | "specialized" => "legacy",
        _ => analysis_type.as_str(),
    };
    if !type_tag.is_empty() {
        push_auto_tag(&mut tags, &mut seen, type_tag);
    }

    // Large file indicators
    if analysis.file_size_kb >= 2048.0 {
        push_auto_tag(&mut tags, &mut seen, "huge-log");
    } else if analysis.file_size_kb >= 512.0 {
        push_auto_tag(&mut tags, &mut seen, "large-log");
    }

    // Build searchable text
    let mut text = String::new();
    text.push_str(&analysis.error_type);
    text.push(' ');
    if let Some(err) = &analysis.error_message {
        text.push_str(err);
        text.push(' ');
    }
    if let Some(component) = &analysis.component {
        text.push_str(component);
        text.push(' ');
    }
    if let Some(stack) = &analysis.stack_trace {
        text.push_str(stack);
        text.push(' ');
    }
    text.push_str(&analysis.root_cause);

    let text_lower = text.to_lowercase();

    // Namespace prefixes
    for (prefix, tag) in [
        ("psi.", "psi"),
        ("bm.", "bm"),
        ("pl.", "pl"),
        ("won.", "won"),
        ("ex.", "ex"),
        ("core.", "core"),
    ] {
        if text_lower.contains(prefix) {
            push_auto_tag(&mut tags, &mut seen, tag);
        }
    }

    // Error patterns
    let error_type_lower = analysis.error_type.to_lowercase();
    if error_type_lower.contains("messagenotunderstood")
        || text_lower.contains("message not understood")
        || text_lower.contains("does not understand")
    {
        push_auto_tag(&mut tags, &mut seen, "message-not-understood");
    }
    if error_type_lower.contains("subscript")
        || text_lower.contains("out of bounds")
        || text_lower.contains("bounds")
    {
        push_auto_tag(&mut tags, &mut seen, "out-of-bounds");
    }
    if text_lower.contains("nil receiver") || text_lower.contains("nil object") {
        push_auto_tag(&mut tags, &mut seen, "nil-receiver");
    }

    // Keyword tags
    if text_lower.contains("oracle") {
        push_auto_tag(&mut tags, &mut seen, "oracle");
        push_auto_tag(&mut tags, &mut seen, "database");
    }
    if text_lower.contains("postgres") || text_lower.contains("psql") {
        push_auto_tag(&mut tags, &mut seen, "postgresql");
        push_auto_tag(&mut tags, &mut seen, "database");
    }
    if text_lower.contains("database") || text_lower.contains(" sql ") {
        push_auto_tag(&mut tags, &mut seen, "database");
    }
    if text_lower.contains("deadlock") {
        push_auto_tag(&mut tags, &mut seen, "deadlock");
        push_auto_tag(&mut tags, &mut seen, "locking");
    }
    if text_lower.contains("timeout") || text_lower.contains("timed out") {
        push_auto_tag(&mut tags, &mut seen, "timeout");
    }
    if text_lower.contains("out of memory")
        || text_lower.contains("memory")
        || text_lower.contains("heap")
    {
        push_auto_tag(&mut tags, &mut seen, "memory");
    }
    if text_lower.contains("gc") || text_lower.contains("garbage") {
        push_auto_tag(&mut tags, &mut seen, "gc");
    }
    if text_lower.contains("stack trace") || text_lower.contains("stacktrace") || text_lower.contains("walkback") {
        push_auto_tag(&mut tags, &mut seen, "stack-trace");
    }
    if text_lower.contains("socket")
        || text_lower.contains("network")
        || text_lower.contains("http")
    {
        push_auto_tag(&mut tags, &mut seen, "network");
    }
    if text_lower.contains("permission") || text_lower.contains("denied") {
        push_auto_tag(&mut tags, &mut seen, "permission");
    }
    if text_lower.contains("auth") || text_lower.contains("unauthorized") || text_lower.contains("token") {
        push_auto_tag(&mut tags, &mut seen, "auth");
    }
    if text_lower.contains("serialize") || text_lower.contains("deserial") {
        push_auto_tag(&mut tags, &mut seen, "serialization");
    }
    if text_lower.contains("thread") || text_lower.contains("process") {
        push_auto_tag(&mut tags, &mut seen, "threading");
    }
    if text_lower.contains("concurren") {
        push_auto_tag(&mut tags, &mut seen, "concurrency");
    }
    if text_lower.contains("lock") || text_lower.contains("mutex") {
        push_auto_tag(&mut tags, &mut seen, "locking");
    }
    if text_lower.contains(" ui ") || text_lower.contains("window") || text_lower.contains("view ") {
        push_auto_tag(&mut tags, &mut seen, "ui");
    }

    tags
}

fn apply_auto_tags(db: &Database, analysis: &Analysis) -> Result<(), String> {
    let tags = collect_auto_tags(analysis);
    if tags.is_empty() {
        return Ok(());
    }
    for (name, color) in tags {
        let tag_id = db
            .get_or_create_tag_id(&name, &color)
            .map_err(|e| format!("Failed to get/create tag '{}': {}", name, e))?;
        db.add_tag_to_analysis(analysis.id, tag_id)
            .map_err(|e| format!("Failed to add tag '{}' to analysis: {}", name, e))?;
    }
    Ok(())
}

// AutoTagSummary, DbState, MAX_* constants imported from commands::common above

// ============================================================================
// RAG Auto-Indexing Helper
// ============================================================================

/// Attempt to auto-index an analysis into the RAG vector store
///
/// This is a best-effort operation - failures are logged but don't affect the main flow
async fn auto_index_analysis(analysis: &Analysis, api_key: &str) {
    // Only index if we have meaningful content
    if analysis.root_cause.is_empty() || analysis.root_cause == "Unknown" {
        log::debug!("Skipping RAG indexing for analysis {} (no meaningful content)", analysis.id);
        return;
    }

    log::info!("Auto-indexing analysis {} into RAG store", analysis.id);

    // Build analysis JSON for indexing
    let analysis_json = serde_json::json!({
        "id": analysis.id,
        "filename": analysis.filename,
        "error_type": analysis.error_type,
        "error_message": analysis.error_message,
        "severity": analysis.severity,
        "component": analysis.component,
        "root_cause": analysis.root_cause,
        "suggested_fixes": analysis.suggested_fixes,
        "confidence": analysis.confidence,
        "analysis_type": analysis.analysis_type,
    });

    // Create index request
    let index_request = rag_commands::RAGIndexRequest {
        analysis: analysis_json,
        api_key: api_key.to_string(),
    };

    // Attempt to index (failures are logged but don't fail the analysis)
    match rag_commands::rag_index_analysis(index_request).await {
        Ok(response) => {
            log::info!(
                "Successfully indexed analysis {} into RAG store: {} chunks indexed",
                analysis.id,
                response.indexed
            );
        }
        Err(e) => {
            log::warn!(
                "Failed to auto-index analysis {} into RAG store: {}",
                analysis.id,
                e
            );
        }
    }
}

// validate_file_path, normalize_severity, redact_pii_basic, PII regexes
// all imported from commands::common above

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
    /// Enable RAG-enhanced analysis (Phase 2.3)
    /// When true, retrieves similar historical cases to improve analysis quality
    #[serde(default)]
    pub use_rag: Option<bool>,
    /// Enable KB domain knowledge retrieval
    #[serde(default)]
    pub use_kb: Option<bool>,
    /// Customer name for customer-specific release notes
    pub customer: Option<String>,
    /// WHATS'ON version (e.g. "2024r8")
    pub won_version: Option<String>,
    /// KB mode: "remote" | "local"
    pub kb_mode: Option<String>,
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

// ============================================================================
// KB Helper Functions
// ============================================================================

/// Pre-compiled WHATS'ON version regex
static WON_VERSION_RE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"(\d{4})\.?[rR](\d{1,2})").expect("WON version regex"));

/// Auto-detect WHATS'ON version from content (e.g. "2024r8", "2024.r8", "2024R8")
fn detect_won_version(content: &str) -> Option<String> {
    WON_VERSION_RE
        .captures(content)
        .map(|c| format!("{}r{}", &c[1], &c[2]))
}

/// Extract a KB-relevant query from content
fn extract_kb_query(content: &str, analysis_type: &str) -> String {
    match analysis_type {
        "jira" => {
            // For JIRA: summary (first line) is the best query
            content
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(300)
                .collect()
        }
        _ => {
            // For crash logs: extract error/exception lines + WON namespace references
            let key_lines: Vec<&str> = content
                .lines()
                .filter(|l| {
                    l.contains("Error")
                        || l.contains("Exception")
                        || l.contains("PSI.")
                        || l.contains("BM.")
                        || l.contains("WOn.")
                })
                .take(3)
                .collect();
            if key_lines.is_empty() {
                content.chars().take(300).collect()
            } else {
                key_lines.join(" ").chars().take(500).collect()
            }
        }
    }
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
    // NOTE: Keeper SDK uses reqwest::blocking internally, so it must run off the
    // tokio runtime to avoid "Cannot drop a runtime" panics.
    let api_key: Zeroizing<String> = if let Some(ref keeper_uid) = request.keeper_secret_uid {
        log::info!("Fetching API key from Keeper for analysis");
        let uid = keeper_uid.clone();
        run_keeper_off_runtime(move || keeper_service::get_api_key_from_keeper(&uid)).await?
            .map_err(|e| format!("Failed to get API key from Keeper: {}", e))?
    } else {
        Zeroizing::new(request.api_key.clone())
    };

    // Determine analysis mode from request, with enforced overrides by analysis type
    let token_safe_config = match request.analysis_type.as_str() {
        "whatson" | "comprehensive" => Some(ai_service::TokenSafeConfig {
            force_mode: Some(ai_service::AnalysisMode::DeepScan),
            ..Default::default()
        }),
        "quick" => Some(ai_service::TokenSafeConfig {
            enable_deep_scan: false, // Never deep scan for quick analysis
            ..Default::default()
        }),
        _ => match request.analysis_mode.as_deref() {
            Some("deep_scan") => Some(ai_service::TokenSafeConfig {
                force_mode: Some(ai_service::AnalysisMode::DeepScan),
                ..Default::default()
            }),
            Some("quick") => Some(ai_service::TokenSafeConfig {
                enable_deep_scan: false, // Force quick mode, no deep scan fallback
                ..Default::default()
            }),
            _ => None, // "auto" or unspecified - let the system decide
        },
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

    // Optionally retrieve RAG context for enhanced analysis (Phase 2.3)
    let rag_context = if request.use_rag.unwrap_or(false) {
        log::info!("RAG-enhanced analysis enabled, retrieving similar cases...");
        // Extract query from crash content (first 500 chars for embedding)
        let query = crash_content.chars().take(500).collect::<String>();

        match rag_commands::rag_build_context_internal(&query, None, None, 5, api_key.as_str()).await {
            Ok(ctx) => {
                log::info!(
                    "RAG context retrieved: {} similar cases, {} gold matches",
                    ctx.similar_analyses.len(),
                    ctx.gold_matches.len()
                );
                Some(ai_service::RagContext::from(ctx))
            }
            Err(e) => {
                log::warn!("Failed to retrieve RAG context, continuing without: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Optionally retrieve KB domain knowledge
    let domain_knowledge = if request.use_kb.unwrap_or(false) {
        log::info!("KB domain knowledge retrieval enabled");
        let version = detect_won_version(&crash_content).or(request.won_version.clone());
        let kb_query = extract_kb_query(&crash_content, &request.analysis_type);
        let mode = request.kb_mode.as_deref().unwrap_or("remote");

        emit_progress(
            &app,
            AnalysisProgress {
                phase: AnalysisPhase::Analyzing,
                progress: 25,
                message: "Retrieving domain knowledge...".to_string(),
                current_step: None,
                total_steps: None,
            },
        );

        match rag_commands::kb_query_internal(
            &kb_query,
            mode,
            None, // OpenSearch config passed via settings, not per-request for now
            version,
            request.customer.clone(),
            5,
            api_key.as_str(),
        )
        .await
        {
            Ok(ctx) => {
                log::info!(
                    "KB context retrieved: {} KB docs, {} release notes ({}ms)",
                    ctx.kb_results.len(),
                    ctx.release_note_results.len(),
                    ctx.retrieval_time_ms.unwrap_or(0)
                );
                Some(ai_service::DomainKnowledge::from(ctx))
            }
            Err(e) => {
                log::warn!("KB retrieval failed, continuing without: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Call AI service - use RAG-enhanced if context available
    let has_extra_context = rag_context.is_some() || domain_knowledge.is_some();
    let result = if has_extra_context && matches!(request.analysis_type.as_str(), "whatson" | "comprehensive" | "jira") {
        // Use RAG-enhanced analysis for WHATS'ON types
        ai_service::analyze_crash_log_with_rag(
            &crash_content,
            api_key.as_str(),
            &request.model,
            &request.provider,
            &request.analysis_type,
            rag_context,
            domain_knowledge,
        )
        .await
        .map_err(|e| {
            log::error!(
                "RAG-enhanced AI analysis failed: file={}, error={}",
                request.file_path,
                e
            );
            format!("AI analysis failed: {}", e)
        })?
    } else {
        // Use standard token-safe analysis
        // This automatically handles large files by:
        // 1. Estimating token usage
        // 2. Using evidence extraction if needed
        // 3. Falling back to deep scan (map-reduce) for very large files
        ai_service::analyze_crash_log_safe(
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
        })?
    };

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
        "AI analysis completed: file={}, severity={}, confidence={}, has_enhanced_json={}, enhanced_json_len={}",
        request.file_path,
        result.severity,
        result.confidence,
        result.raw_enhanced_json.is_some(),
        result.raw_enhanced_json.as_ref().map(|s| s.len()).unwrap_or(0)
    );

    // Log the first 500 chars of the enhanced JSON for debugging
    if let Some(ref json) = result.raw_enhanced_json {
        log::debug!(
            "Enhanced JSON preview (first 500 chars): {}",
            &json[..json.len().min(500)]
        );
    }

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
    let analysis_for_tags = analysis.clone();
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

    // Auto-tag analysis (best-effort, non-blocking)
    {
        let db_for_tags = Arc::clone(&db);
        let mut analysis_for_tags = analysis_for_tags;
        analysis_for_tags.id = id;
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = apply_auto_tags(&db_for_tags, &analysis_for_tags) {
                log::warn!("Auto-tagging failed for analysis {}: {}", analysis_for_tags.id, e);
            }
        });
    }

    // Auto-index into RAG store (best-effort, non-blocking)
    // Create a minimal analysis object for indexing
    let analysis_for_indexing = Analysis {
        id,
        filename: response_filename.clone(),
        file_size_kb: file_metadata.len() as f64 / 1024.0,
        error_type: response_error_type.clone(),
        error_message: None,
        severity: response_severity.clone(),
        component: result.component.clone(),
        stack_trace: None,
        root_cause: response_root_cause.clone(),
        suggested_fixes: serde_json::to_string(&result.suggested_fixes).unwrap_or_default(),
        confidence: Some(result.confidence.clone()),
        analyzed_at: response_analyzed_at.clone(),
        ai_model: request.model.clone(),
        ai_provider: Some(request.provider.clone()),
        tokens_used: result.tokens_used,
        cost: response_cost,
        was_truncated: result.was_truncated.unwrap_or(false),
        full_data: None,
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: None,
        analysis_type: request.analysis_type.clone(),
    };

    // Spawn auto-indexing task (don't await - fire and forget)
    let api_key_clone = api_key.to_string();
    tokio::spawn(async move {
        auto_index_analysis(&analysis_for_indexing, &api_key_clone).await;
    });

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

// ============================================================================
// Jira Ticket Analysis
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraTicketAnalysisRequest {
    pub jira_key: String,
    pub summary: String,
    pub description: String,
    pub comments: Vec<String>,
    pub priority: Option<String>,
    pub status: Option<String>,
    pub components: Vec<String>,
    pub labels: Vec<String>,
    pub api_key: String,
    pub model: String,
    pub provider: String,
    pub keeper_secret_uid: Option<String>,
    #[serde(default)]
    pub use_rag: Option<bool>,
    /// Enable KB domain knowledge retrieval
    #[serde(default)]
    pub use_kb: Option<bool>,
    /// Customer name for customer-specific release notes
    pub customer: Option<String>,
    /// WHATS'ON version (e.g. "2024r8")
    pub won_version: Option<String>,
    /// KB mode: "remote" | "local"
    pub kb_mode: Option<String>,
}

/// Analyze a JIRA ticket using the same AI pipeline as crash log analysis.
///
/// Composes the ticket fields into a structured text document and feeds it
/// through the standard WhatsOn analysis pipeline.
#[tauri::command]
pub async fn analyze_jira_ticket(
    request: JiraTicketAnalysisRequest,
    db: DbState<'_>,
    app: AppHandle,
) -> Result<AnalysisResponse, String> {
    log::info!(
        "Starting JIRA ticket analysis: key={}, provider={}, model={}",
        request.jira_key,
        request.provider,
        request.model
    );

    // Emit initial progress
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Reading,
            progress: 0,
            message: format!("Preparing JIRA ticket {} for analysis...", request.jira_key),
            current_step: None,
            total_steps: None,
        },
    );

    // Compose ticket content into a structured text document
    let mut content = String::new();
    content.push_str("=== JIRA Ticket Analysis ===\n");
    content.push_str(&format!("Key: {}\n", request.jira_key));
    content.push_str(&format!("Summary: {}\n", request.summary));
    if let Some(ref priority) = request.priority {
        content.push_str(&format!("Priority: {}\n", priority));
    }
    if let Some(ref status) = request.status {
        content.push_str(&format!("Status: {}\n", status));
    }
    if !request.components.is_empty() {
        content.push_str(&format!("Components: {}\n", request.components.join(", ")));
    }
    if !request.labels.is_empty() {
        content.push_str(&format!("Labels: {}\n", request.labels.join(", ")));
    }
    content.push('\n');
    content.push_str("=== Description ===\n");
    content.push_str(&request.description);
    content.push('\n');

    if !request.comments.is_empty() {
        content.push_str(&format!("\n=== Comments ({} total) ===\n", request.comments.len()));
        for (i, comment) in request.comments.iter().enumerate() {
            content.push_str(&format!("--- Comment {} ---\n", i + 1));
            content.push_str(comment);
            content.push('\n');
        }
    }

    let content_len = content.len();

    // Emit progress - content composed
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
    // NOTE: Keeper SDK uses reqwest::blocking internally, so it must run off the
    // tokio runtime to avoid "Cannot drop a runtime" panics.
    let api_key: Zeroizing<String> = if let Some(ref keeper_uid) = request.keeper_secret_uid {
        log::info!("Fetching API key from Keeper for JIRA ticket analysis");
        let uid = keeper_uid.clone();
        run_keeper_off_runtime(move || keeper_service::get_api_key_from_keeper(&uid)).await?
            .map_err(|e| format!("Failed to get API key from Keeper: {}", e))?
    } else {
        Zeroizing::new(request.api_key.clone())
    };

    // Use jira analysis type for JIRA ticket analyses
    let analysis_type = "jira";

    // Emit progress - starting AI analysis
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Analyzing,
            progress: 20,
            message: format!("Analyzing JIRA ticket {} with AI...", request.jira_key),
            current_step: None,
            total_steps: None,
        },
    );

    // Optionally retrieve RAG context for enhanced analysis
    let rag_context = if request.use_rag.unwrap_or(false) {
        log::info!("RAG-enhanced analysis enabled for JIRA ticket, retrieving similar cases...");
        let query = request.description.chars().take(500).collect::<String>();

        match rag_commands::rag_build_context_internal(&query, None, None, 5, api_key.as_str()).await {
            Ok(ctx) => {
                log::info!(
                    "RAG context retrieved: {} similar cases, {} gold matches",
                    ctx.similar_analyses.len(),
                    ctx.gold_matches.len()
                );
                Some(ai_service::RagContext::from(ctx))
            }
            Err(e) => {
                log::warn!("Failed to retrieve RAG context for JIRA ticket, continuing without: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Optionally retrieve KB domain knowledge for JIRA ticket
    let domain_knowledge = if request.use_kb.unwrap_or(false) {
        log::info!("KB domain knowledge retrieval enabled for JIRA ticket");
        let version = detect_won_version(&content).or(request.won_version.clone());
        let kb_query = extract_kb_query(&content, analysis_type);
        let mode = request.kb_mode.as_deref().unwrap_or("remote");

        emit_progress(
            &app,
            AnalysisProgress {
                phase: AnalysisPhase::Analyzing,
                progress: 25,
                message: "Retrieving domain knowledge...".to_string(),
                current_step: None,
                total_steps: None,
            },
        );

        match rag_commands::kb_query_internal(
            &kb_query,
            mode,
            None,
            version,
            request.customer.clone(),
            5,
            api_key.as_str(),
        )
        .await
        {
            Ok(ctx) => {
                log::info!(
                    "KB context retrieved for JIRA: {} KB docs, {} release notes",
                    ctx.kb_results.len(),
                    ctx.release_note_results.len()
                );
                Some(ai_service::DomainKnowledge::from(ctx))
            }
            Err(e) => {
                log::warn!("KB retrieval failed for JIRA ticket, continuing without: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Call AI service - use RAG-enhanced if context available
    let has_extra_context = rag_context.is_some() || domain_knowledge.is_some();
    let result = if has_extra_context {
        ai_service::analyze_crash_log_with_rag(
            &content,
            api_key.as_str(),
            &request.model,
            &request.provider,
            analysis_type,
            rag_context,
            domain_knowledge,
        )
        .await
        .map_err(|e| {
            log::error!("RAG-enhanced AI analysis failed for JIRA ticket {}: {}", request.jira_key, e);
            format!("AI analysis failed: {}", e)
        })?
    } else {
        ai_service::analyze_crash_log_safe(
            &content,
            None,
            api_key.as_str(),
            &request.model,
            &request.provider,
            analysis_type,
            None,
        )
        .await
        .map_err(|e| {
            log::error!("AI analysis failed for JIRA ticket {}: {}", request.jira_key, e);
            format!("AI analysis failed: {}", e)
        })?
    };

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
        "AI analysis completed for JIRA ticket {}: severity={}, confidence={}",
        request.jira_key,
        result.severity,
        result.confidence
    );

    let file_size_kb = content_len as f64 / 1024.0;
    let filename = format!("JIRA: {}", request.jira_key);

    // Create analysis record
    let analysis = Analysis {
        id: 0,
        filename: filename.clone(),
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
        analysis_type: "jira_ticket".to_string(),
    };

    // Extract fields for response before moving analysis
    let response_filename = analysis.filename.clone();
    let response_error_type = analysis.error_type.clone();
    let response_severity = analysis.severity.clone();
    let response_root_cause = analysis.root_cause.clone();
    let response_analyzed_at = analysis.analyzed_at.clone();
    let response_cost = analysis.cost;

    // Save to database
    let analysis_for_tags = analysis.clone();
    let db_clone = Arc::clone(&db);
    let jira_key_for_log = request.jira_key.clone();
    let id = tauri::async_runtime::spawn_blocking(move || db_clone.insert_analysis(&analysis))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| {
            log::error!("Database insert failed for JIRA ticket {}: {}", jira_key_for_log, e);
            format!("Database error: {}", e)
        })?;

    log::info!(
        "JIRA ticket analysis saved: id={}, key={}, cost={}",
        id, request.jira_key, response_cost
    );

    // Auto-tag analysis (best-effort) + add "jira" tag
    {
        let db_for_tags = Arc::clone(&db);
        let mut analysis_for_tags = analysis_for_tags;
        analysis_for_tags.id = id;
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = apply_auto_tags(&db_for_tags, &analysis_for_tags) {
                log::warn!("Auto-tagging failed for JIRA ticket analysis {}: {}", analysis_for_tags.id, e);
            }
            // Always add "jira" tag
            let jira_color = "#0052CC"; // JIRA blue
            match db_for_tags.get_or_create_tag_id("jira", jira_color) {
                Ok(tag_id) => {
                    if let Err(e) = db_for_tags.add_tag_to_analysis(analysis_for_tags.id, tag_id) {
                        log::warn!("Failed to add 'jira' tag to analysis {}: {}", analysis_for_tags.id, e);
                    }
                }
                Err(e) => log::warn!("Failed to get/create 'jira' tag: {}", e),
            }
        });
    }

    // Auto-index into RAG store (fire-and-forget)
    let analysis_for_indexing = Analysis {
        id,
        filename: response_filename.clone(),
        file_size_kb,
        error_type: response_error_type.clone(),
        error_message: None,
        severity: response_severity.clone(),
        component: result.component.clone(),
        stack_trace: None,
        root_cause: response_root_cause.clone(),
        suggested_fixes: serde_json::to_string(&result.suggested_fixes).unwrap_or_default(),
        confidence: Some(result.confidence.clone()),
        analyzed_at: response_analyzed_at.clone(),
        ai_model: request.model.clone(),
        ai_provider: Some(request.provider.clone()),
        tokens_used: result.tokens_used,
        cost: response_cost,
        was_truncated: result.was_truncated.unwrap_or(false),
        full_data: None,
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: None,
        analysis_type: "jira_ticket".to_string(),
    };

    let api_key_clone = api_key.to_string();
    tokio::spawn(async move {
        auto_index_analysis(&analysis_for_indexing, &api_key_clone).await;
    });

    // Emit progress - complete
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Complete,
            progress: 100,
            message: "JIRA ticket analysis complete!".to_string(),
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

    // For llama.cpp, use Rust-native translation (no Python needed)
    let translation_text = if provider.to_lowercase() == "llamacpp" {
        translate_llamacpp(&content_for_ai, &model)
            .await
            .map_err(|e| {
                log::error!("llama.cpp translation failed: error={}", e);
                format!("llama.cpp translation failed: {}", e)
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
    /// Optional API key for RAG auto-indexing
    pub api_key: Option<String>,
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
    let analysis_clone = analysis.clone();
    let analysis_for_tags = analysis.clone();
    let id = tauri::async_runtime::spawn_blocking(move || db_clone.insert_analysis(&analysis_clone))
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

    // Auto-tag external analysis (best-effort, non-blocking)
    {
        let db_for_tags = Arc::clone(&db);
        let mut analysis_for_tags = analysis_for_tags;
        analysis_for_tags.id = id;
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = apply_auto_tags(&db_for_tags, &analysis_for_tags) {
                log::warn!("Auto-tagging failed for external analysis {}: {}", analysis_for_tags.id, e);
            }
        });
    }

    // Auto-index into RAG store if API key is provided (best-effort, non-blocking)
    if let Some(api_key) = request.api_key {
        let mut analysis_with_id = analysis;
        analysis_with_id.id = id;

        tokio::spawn(async move {
            auto_index_analysis(&analysis_with_id, &api_key).await;
        });
    }

    Ok(id)
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

/// Auto-tag analyses using deterministic rules
/// - limit: Optional maximum number of analyses to process (None = all)
#[tauri::command]
pub async fn auto_tag_analyses(
    limit: Option<i64>,
    db: DbState<'_>,
) -> Result<AutoTagSummary, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        const PAGE_SIZE: i64 = 200;
        let max_to_process = limit.unwrap_or(-1);
        let mut offset: i64 = 0;
        let mut scanned: i64 = 0;
        let mut tagged: i64 = 0;
        let mut skipped: i64 = 0;
        let mut failed: i64 = 0;

        loop {
            let analyses = db
                .get_analyses_paginated(Some(PAGE_SIZE), Some(offset))
                .map_err(|e| format!("Database error: {}", e))?;

            if analyses.is_empty() {
                break;
            }

            for analysis in analyses {
                if max_to_process >= 0 && scanned >= max_to_process {
                    return Ok(AutoTagSummary {
                        scanned,
                        tagged,
                        skipped,
                        failed,
                    });
                }

                scanned += 1;

                match db.analysis_has_tags(analysis.id) {
                    Ok(true) => {
                        skipped += 1;
                        continue;
                    }
                    Ok(false) => {}
                    Err(e) => {
                        failed += 1;
                        log::warn!(
                            "Auto-tagging skipped analysis {} (tag check failed): {}",
                            analysis.id,
                            e
                        );
                        continue;
                    }
                }

                if let Err(e) = apply_auto_tags(&db, &analysis) {
                    failed += 1;
                    log::warn!("Auto-tagging failed for analysis {}: {}", analysis.id, e);
                } else {
                    tagged += 1;
                }
            }

            offset += PAGE_SIZE;
        }

        Ok(AutoTagSummary {
            scanned,
            tagged,
            skipped,
            failed,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Count analyses without any tags (used for auto-tag preview)
#[tauri::command]
pub async fn count_analyses_without_tags(db: DbState<'_>) -> Result<i64, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.count_analyses_without_tags())
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

/// Run a closure on a dedicated OS thread outside the tokio runtime.
/// The Keeper SDK uses `reqwest::blocking` which creates its own tokio runtime,
/// conflicting with Tauri's runtime if called from `spawn_blocking`.
async fn run_keeper_off_runtime<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let result = f();
        let _ = tx.send(result);
    });
    rx.await.map_err(|_| "Keeper task was cancelled".to_string())
}

/// Initialize Keeper with a one-time access token
/// This binds the token to this device and enables secure API key retrieval
#[tauri::command]
pub async fn initialize_keeper(
    token: String,
    hostname: Option<String>,
) -> Result<keeper_service::KeeperInitResult, String> {
    log::info!("Initializing Keeper connection");
    run_keeper_off_runtime(move || {
        keeper_service::initialize_keeper(&token, hostname.as_deref())
    })
    .await?
}

/// List available secrets from Keeper (metadata only, not values)
/// Safe to return to frontend - only shows titles and UIDs
#[tauri::command]
pub async fn list_keeper_secrets() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::debug!("Listing Keeper secrets");
    run_keeper_off_runtime(keeper_service::list_keeper_secrets).await?
}

/// Get Keeper connection status
#[tauri::command]
pub async fn get_keeper_status() -> Result<keeper_service::KeeperStatus, String> {
    log::debug!("Getting Keeper status");
    run_keeper_off_runtime(|| Ok(keeper_service::get_keeper_status())).await?
}

/// Clear Keeper configuration (disconnect)
#[tauri::command]
pub async fn clear_keeper_config() -> Result<(), String> {
    log::info!("Clearing Keeper configuration");
    keeper_service::clear_keeper_config()
}

/// Test Keeper connection by attempting to list secrets
#[tauri::command]
pub async fn test_keeper_connection() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::info!("Testing Keeper connection");
    run_keeper_off_runtime(keeper_service::list_keeper_secrets).await?
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

/// List JIRA projects for autocomplete
#[tauri::command]
pub async fn list_jira_projects(
    base_url: String,
    email: String,
    api_token: String,
) -> Result<Vec<jira_service::JiraProjectInfo>, String> {
    log::info!("Listing JIRA projects");
    jira_service::list_jira_projects(base_url, email, api_token).await
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

/// Search JIRA issues using JQL (Phase 3 - JIRA Intelligence)
#[tauri::command]
pub async fn search_jira_issues(
    base_url: String,
    email: String,
    api_token: String,
    jql: String,
    max_results: i32,
    include_comments: bool,
) -> Result<jira_service::JiraSearchResponse, String> {
    log::info!("Searching JIRA issues with JQL");
    jira_service::search_jira_issues(base_url, email, api_token, jql, max_results, include_comments)
        .await
}

/// Post a comment to a JIRA issue
#[tauri::command]
pub async fn post_jira_comment(
    base_url: String,
    email: String,
    api_token: String,
    issue_key: String,
    comment_body: String,
) -> Result<(), String> {
    log::info!("Posting comment to JIRA issue {}", issue_key);
    jira_service::post_jira_comment(&base_url, &email, &api_token, &issue_key, &comment_body).await
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
        "html_interactive" => ExportFormat::HtmlInteractive,
        "json" => ExportFormat::Json,
        "txt" | "text" => ExportFormat::Txt,
        "xlsx" | "excel" => ExportFormat::Xlsx,
        _ => ExportFormat::Markdown,
    };

    // Generate report
    let content = export_report(&report_data, format);

    // Determine file extension
    let extension = match format {
        ExportFormat::Html => "html",
        ExportFormat::HtmlInteractive => "html",
        ExportFormat::Json => "json",
        ExportFormat::Markdown => "md",
        ExportFormat::Txt => "txt",
        ExportFormat::Xlsx => "xlsx",
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
            "id": "html_interactive",
            "name": "Interactive HTML",
            "extension": "html",
            "description": "Interactive report with tabbed navigation"
        }),
        serde_json::json!({
            "id": "json",
            "name": "JSON",
            "extension": "json",
            "description": "Structured data, ideal for integrations"
        }),
        serde_json::json!({
            "id": "txt",
            "name": "Plain Text",
            "extension": "txt",
            "description": "Simple text format, no formatting"
        }),
        serde_json::json!({
            "id": "xlsx",
            "name": "Excel (XLSX)",
            "extension": "xlsx",
            "description": "Multi-sheet spreadsheet with tabbed sections"
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

    // Use shared PII detection from commands::common
    let pii_types = detect_pii_types(&content);
    let mut detected_types: Vec<String> = Vec::new();
    for pii_type in &pii_types {
        match *pii_type {
            "email" => {
                detected_types.push("email".to_string());
                warnings.push("Email addresses detected in content".to_string());
            }
            "ip" => {
                detected_types.push("ip".to_string());
                warnings.push("IP addresses detected in content".to_string());
            }
            "token" => {
                detected_types.push("token".to_string());
                warnings.push("API tokens or keys detected in content".to_string());
            }
            "path" => {
                detected_types.push("path".to_string());
                warnings.push("User directory paths detected in content".to_string());
            }
            _ => {}
        }
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
            "html_interactive" => Some(ExportFormat::HtmlInteractive),
            "json" => Some(ExportFormat::Json),
            "markdown" | "md" => Some(ExportFormat::Markdown),
            "txt" | "text" => Some(ExportFormat::Txt),
            "xlsx" | "excel" => Some(ExportFormat::Xlsx),
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
                ExportFormat::HtmlInteractive => ("html", "html_interactive"),
                ExportFormat::Json => ("json", "json"),
                ExportFormat::Markdown => ("md", "markdown"),
                ExportFormat::Txt => ("txt", "txt"),
                ExportFormat::Xlsx => ("xlsx", "xlsx"),
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

// ============================================================================
// Intelligence Platform Commands (Phase 1-2)
// ============================================================================

use crate::database::{AnalysisFeedback, GoldAnalysis};

/// Request structure for submitting feedback
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    pub analysis_id: i64,
    pub feedback_type: String,
    pub field_name: Option<String>,
    pub original_value: Option<String>,
    pub new_value: Option<String>,
    pub rating: Option<i32>,
}

/// Submit feedback for an analysis
#[tauri::command]
pub fn submit_analysis_feedback(
    feedback: FeedbackRequest,
    db: DbState<'_>,
) -> Result<AnalysisFeedback, String> {
    log::info!(
        "Submitting {} feedback for analysis {}",
        feedback.feedback_type,
        feedback.analysis_id
    );

    // Validate feedback type
    let valid_types = ["accept", "reject", "edit", "rating"];
    if !valid_types.contains(&feedback.feedback_type.as_str()) {
        return Err(format!(
            "Invalid feedback type: {}. Must be one of: {:?}",
            feedback.feedback_type, valid_types
        ));
    }

    // Validate rating if provided
    if let Some(rating) = feedback.rating {
        if !(1..=5).contains(&rating) {
            return Err("Rating must be between 1 and 5".to_string());
        }
    }

    db.submit_feedback(
        feedback.analysis_id,
        &feedback.feedback_type,
        feedback.field_name.as_deref(),
        feedback.original_value.as_deref(),
        feedback.new_value.as_deref(),
        feedback.rating,
    )
    .map_err(|e| format!("Failed to save feedback: {}", e))
}

/// Get all feedback for an analysis
#[tauri::command]
pub fn get_feedback_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<Vec<AnalysisFeedback>, String> {
    log::info!("Getting feedback for analysis {}", analysis_id);
    db.get_feedback_for_analysis(analysis_id)
        .map_err(|e| format!("Failed to get feedback: {}", e))
}

/// Promote an analysis to gold standard
#[tauri::command]
pub fn promote_to_gold(analysis_id: i64, db: DbState<'_>) -> Result<GoldAnalysis, String> {
    log::info!("Promoting analysis {} to gold standard", analysis_id);
    db.promote_to_gold(analysis_id)
        .map_err(|e| format!("Failed to promote to gold: {}", e))
}

/// Get all gold analyses
#[tauri::command]
pub fn get_gold_analyses(db: DbState<'_>) -> Result<Vec<GoldAnalysis>, String> {
    log::info!("Getting all gold analyses");
    db.get_gold_analyses()
        .map_err(|e| format!("Failed to get gold analyses: {}", e))
}

/// Check if an analysis is a gold standard
#[tauri::command]
pub fn is_gold_analysis(analysis_id: i64, db: DbState<'_>) -> Result<bool, String> {
    db.is_gold_analysis(analysis_id)
        .map_err(|e| format!("Failed to check gold status: {}", e))
}

/// Get pending gold analyses for review
#[tauri::command]
pub fn get_pending_gold_analyses(db: DbState<'_>) -> Result<Vec<GoldAnalysis>, String> {
    log::info!("Getting pending gold analyses for review");
    db.get_pending_gold_analyses()
        .map_err(|e| format!("Failed to get pending gold analyses: {}", e))
}

/// Verify a gold analysis
#[tauri::command]
pub fn verify_gold_analysis(
    gold_analysis_id: i64,
    verified_by: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::info!("Verifying gold analysis {}", gold_analysis_id);
    db.verify_gold_analysis(gold_analysis_id, verified_by.as_deref())
        .map_err(|e| format!("Failed to verify gold analysis: {}", e))
}

/// Reject a gold analysis
#[tauri::command]
pub fn reject_gold_analysis(
    gold_analysis_id: i64,
    verified_by: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::info!("Rejecting gold analysis {}", gold_analysis_id);
    db.reject_gold_analysis(gold_analysis_id, verified_by.as_deref())
        .map_err(|e| format!("Failed to reject gold analysis: {}", e))
}

/// Get rejected gold analyses for review
#[tauri::command]
pub fn get_rejected_gold_analyses(db: DbState<'_>) -> Result<Vec<GoldAnalysis>, String> {
    db.get_gold_analyses_by_status("rejected")
        .map_err(|e| format!("Failed to get rejected gold analyses: {}", e))
}

/// Reopen a rejected gold analysis (set back to pending)
#[tauri::command]
pub fn reopen_gold_analysis(gold_analysis_id: i64, db: DbState<'_>) -> Result<(), String> {
    log::info!("Reopening gold analysis {}", gold_analysis_id);
    db.reopen_gold_analysis(gold_analysis_id)
        .map_err(|e| format!("Failed to reopen gold analysis: {}", e))
}

/// Check if an analysis is eligible for auto-promotion
#[tauri::command]
pub fn check_auto_promotion_eligibility(analysis_id: i64, db: DbState<'_>) -> Result<bool, String> {
    db.check_auto_promotion_eligibility(analysis_id)
        .map_err(|e| format!("Failed to check auto-promotion eligibility: {}", e))
}

/// Auto-promote an analysis to gold if eligible
#[tauri::command]
pub fn auto_promote_if_eligible(analysis_id: i64, db: DbState<'_>) -> Result<bool, String> {
    log::info!("Checking auto-promotion eligibility for analysis {}", analysis_id);
    db.auto_promote_if_eligible(analysis_id)
        .map_err(|e| format!("Failed to auto-promote analysis: {}", e))
}

// ============================================================================
// Fine-Tuning Export (Phase 1.4)
// ============================================================================

/// Export result for fine-tuning data
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FineTuneExportResult {
    pub total_exported: usize,
    pub jsonl_content: String,
    pub format: String,
}

/// OpenAI fine-tuning message format
#[derive(Debug, Serialize, Deserialize)]
struct FineTuneMessage {
    role: String,
    content: String,
}

/// OpenAI fine-tuning conversation format
#[derive(Debug, Serialize, Deserialize)]
struct FineTuneConversation {
    messages: Vec<FineTuneMessage>,
}

/// Export verified gold analyses as JSONL for OpenAI fine-tuning
#[tauri::command]
pub fn export_gold_jsonl(db: DbState<'_>) -> Result<FineTuneExportResult, String> {
    log::info!("Exporting gold analyses to JSONL for fine-tuning");

    let gold_analyses = db
        .get_gold_analyses_for_export()
        .map_err(|e| format!("Failed to get gold analyses: {}", e))?;

    if gold_analyses.is_empty() {
        return Ok(FineTuneExportResult {
            total_exported: 0,
            jsonl_content: String::new(),
            format: "openai_chat".to_string(),
        });
    }

    let system_prompt = r#"You are a WHATS'ON broadcast management system crash analysis expert. Analyze Smalltalk crash logs and provide:
1. Root cause identification with specific class/method references
2. Severity assessment (critical/high/medium/low)
3. Actionable fix suggestions specific to WHATS'ON
4. Component classification (EPG, Rights, Scheduling, etc.)

Return your analysis as structured JSON with fields: error_type, severity, root_cause, suggested_fixes (array), component."#;

    let mut jsonl_lines: Vec<String> = Vec::new();

    for gold in &gold_analyses {
        // Build the user content (crash context)
        let user_content = build_crash_context(gold);

        // Build the assistant content (the gold-standard analysis)
        let assistant_content = build_analysis_response(gold);

        let conversation = FineTuneConversation {
            messages: vec![
                FineTuneMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                FineTuneMessage {
                    role: "user".to_string(),
                    content: user_content,
                },
                FineTuneMessage {
                    role: "assistant".to_string(),
                    content: assistant_content,
                },
            ],
        };

        // Serialize to JSON (single line)
        let json_line = serde_json::to_string(&conversation)
            .map_err(|e| format!("Failed to serialize conversation: {}", e))?;
        jsonl_lines.push(json_line);
    }

    let jsonl_content = jsonl_lines.join("\n");

    log::info!("Exported {} gold analyses to JSONL", gold_analyses.len());

    Ok(FineTuneExportResult {
        total_exported: gold_analyses.len(),
        jsonl_content,
        format: "openai_chat".to_string(),
    })
}

/// Build crash context from gold analysis source data
fn build_crash_context(gold: &crate::database::GoldAnalysisExport) -> String {
    let mut context = String::new();

    // Add error signature as context
    context.push_str(&format!("Error Signature: {}\n", gold.error_signature));

    if let Some(error_type) = &gold.source_error_type {
        context.push_str(&format!("Error Type: {}\n", error_type));
    }

    if let Some(error_message) = &gold.source_error_message {
        context.push_str(&format!("Error Message: {}\n", error_message));
    }

    if let Some(stack_trace) = &gold.source_stack_trace {
        context.push_str(&format!("\nStack Trace:\n{}\n", stack_trace));
    }

    // If full_data exists, try to extract additional context
    if let Some(full_data) = &gold.source_full_data {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(full_data) {
            // Extract key sections from full analysis data
            if let Some(exception) = data.get("exception_details") {
                if let Some(exception_str) = exception.as_str() {
                    context.push_str(&format!("\nException Details:\n{}\n", exception_str));
                }
            }
            if let Some(env) = data.get("environment") {
                if let Some(env_obj) = env.as_object() {
                    context.push_str("\nEnvironment:\n");
                    for (key, value) in env_obj {
                        if let Some(v) = value.as_str() {
                            context.push_str(&format!("  {}: {}\n", key, v));
                        }
                    }
                }
            }
        }
    }

    context
}

/// Build the gold-standard analysis response
fn build_analysis_response(gold: &crate::database::GoldAnalysisExport) -> String {
    // Parse suggested_fixes from JSON array string
    let fixes: Vec<String> = serde_json::from_str(&gold.suggested_fixes)
        .unwrap_or_else(|_| vec![gold.suggested_fixes.clone()]);

    let response = serde_json::json!({
        "error_type": gold.error_signature.split("::").next().unwrap_or(&gold.error_signature),
        "severity": gold.severity.as_deref().unwrap_or("medium"),
        "root_cause": gold.root_cause,
        "suggested_fixes": fixes,
        "component": gold.component.as_deref().unwrap_or("Unknown")
    });

    serde_json::to_string_pretty(&response).unwrap_or_else(|_| gold.root_cause.clone())
}

/// Count verified gold analyses available for export
#[tauri::command]
pub fn count_gold_for_export(db: DbState<'_>) -> Result<i64, String> {
    db.count_verified_gold_analyses()
        .map_err(|e| format!("Failed to count gold analyses: {}", e))
}

// ============================================================================
// Enhanced Export with Statistics (Phase 4)
// ============================================================================

/// Export options for fine-tuning data
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// Include pending (unverified) gold analyses
    pub include_pending: Option<bool>,
    /// Filter by components
    pub component_filter: Option<Vec<String>>,
    /// Filter by severities
    pub severity_filter: Option<Vec<String>>,
    /// Balance dataset across components
    pub balance_dataset: Option<bool>,
    /// Maximum examples to export
    pub max_examples: Option<usize>,
    /// Test split ratio (0.0 to 0.5)
    pub test_split: Option<f32>,
}

/// Dataset statistics for export
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetStatistics {
    pub total_examples: usize,
    pub by_component: std::collections::HashMap<String, usize>,
    pub by_severity: std::collections::HashMap<String, usize>,
    pub verified_count: usize,
    pub pending_count: usize,
    pub avg_rating: Option<f64>,
}

/// Enhanced export result with statistics
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedExportResult {
    pub total_exported: usize,
    pub train_count: usize,
    pub test_count: usize,
    pub train_jsonl: String,
    pub test_jsonl: String,
    pub format: String,
    pub statistics: DatasetStatistics,
}

/// Export gold analyses with enhanced options and statistics
#[tauri::command]
pub fn export_gold_jsonl_enhanced(
    options: Option<ExportOptions>,
    db: DbState<'_>,
) -> Result<EnhancedExportResult, String> {
    log::info!("Exporting gold analyses with enhanced options");

    let opts = options.unwrap_or(ExportOptions {
        include_pending: Some(false),
        component_filter: None,
        severity_filter: None,
        balance_dataset: Some(false),
        max_examples: None,
        test_split: Some(0.1),
    });

    // Get all gold analyses
    let mut gold_analyses = db
        .get_gold_analyses_for_export()
        .map_err(|e| format!("Failed to get gold analyses: {}", e))?;

    // Calculate initial statistics
    let mut by_component: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut by_severity: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut verified_count = 0;
    let mut pending_count = 0;

    for gold in &gold_analyses {
        let component = gold.component.clone().unwrap_or_else(|| "Unknown".to_string());
        let severity = gold.severity.clone().unwrap_or_else(|| "medium".to_string());

        *by_component.entry(component).or_insert(0) += 1;
        *by_severity.entry(severity).or_insert(0) += 1;

        if gold.validation_status == "verified" {
            verified_count += 1;
        } else {
            pending_count += 1;
        }
    }

    // Apply include_pending filter (default: only verified)
    let include_pending = opts.include_pending.unwrap_or(false);
    if !include_pending {
        gold_analyses.retain(|g| g.validation_status == "verified");
        log::debug!("Filtered to verified-only: {} analyses remain", gold_analyses.len());
    }

    // Apply component filter
    if let Some(ref components) = opts.component_filter {
        gold_analyses.retain(|g| {
            g.component.as_ref()
                .map(|c| components.iter().any(|f| f.eq_ignore_ascii_case(c)))
                .unwrap_or(false)
        });
    }

    // Apply severity filter
    if let Some(ref severities) = opts.severity_filter {
        gold_analyses.retain(|g| {
            g.severity.as_ref()
                .map(|s| severities.iter().any(|f| f.eq_ignore_ascii_case(s)))
                .unwrap_or(false)
        });
    }

    // Balance dataset if requested
    if opts.balance_dataset.unwrap_or(false) {
        gold_analyses = balance_by_component(gold_analyses);
    }

    // Apply max examples limit
    if let Some(max) = opts.max_examples {
        if gold_analyses.len() > max {
            gold_analyses.truncate(max);
        }
    }

    // Split into train/test
    let test_split = opts.test_split.unwrap_or(0.1).clamp(0.0, 0.5);
    let split_idx = ((gold_analyses.len() as f32) * (1.0 - test_split)) as usize;

    let train_set: Vec<_> = gold_analyses.iter().take(split_idx).collect();
    let test_set: Vec<_> = gold_analyses.iter().skip(split_idx).collect();

    // Generate JSONL for both sets
    let system_prompt = r#"You are a WHATS'ON broadcast management system crash analysis expert. Analyze Smalltalk crash logs and provide:
1. Root cause identification with specific class/method references
2. Severity assessment (critical/high/medium/low)
3. Actionable fix suggestions specific to WHATS'ON
4. Component classification (EPG, Rights, Scheduling, etc.)

Return your analysis as structured JSON with fields: error_type, severity, root_cause, suggested_fixes (array), component."#;

    let train_jsonl = generate_jsonl(&train_set, system_prompt)?;
    let test_jsonl = generate_jsonl(&test_set, system_prompt)?;

    log::info!(
        "Exported {} gold analyses (train: {}, test: {})",
        gold_analyses.len(),
        train_set.len(),
        test_set.len()
    );

    let statistics = DatasetStatistics {
        total_examples: gold_analyses.len(),
        by_component,
        by_severity,
        verified_count,
        pending_count,
        avg_rating: None, // TODO: Calculate from feedback
    };

    Ok(EnhancedExportResult {
        total_exported: gold_analyses.len(),
        train_count: train_set.len(),
        test_count: test_set.len(),
        train_jsonl,
        test_jsonl,
        format: "openai_chat".to_string(),
        statistics,
    })
}

/// Balance dataset by component (sample equal numbers from each)
fn balance_by_component(
    analyses: Vec<crate::database::GoldAnalysisExport>,
) -> Vec<crate::database::GoldAnalysisExport> {
    use std::collections::HashMap;

    // Group by component
    let mut by_component: HashMap<String, Vec<crate::database::GoldAnalysisExport>> = HashMap::new();
    for analysis in analyses {
        let component = analysis.component.clone().unwrap_or_else(|| "Unknown".to_string());
        by_component.entry(component).or_default().push(analysis);
    }

    // Find minimum count
    let min_count = by_component.values().map(|v| v.len()).min().unwrap_or(0);

    // Sample equally from each component
    let mut balanced = Vec::new();
    for (_, mut items) in by_component {
        items.truncate(min_count);
        balanced.extend(items);
    }

    balanced
}

/// Generate JSONL from gold analyses
fn generate_jsonl(
    analyses: &[&crate::database::GoldAnalysisExport],
    system_prompt: &str,
) -> Result<String, String> {
    let mut lines = Vec::new();

    for gold in analyses {
        let user_content = build_crash_context(gold);
        let assistant_content = build_analysis_response(gold);

        let conversation = FineTuneConversation {
            messages: vec![
                FineTuneMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                FineTuneMessage {
                    role: "user".to_string(),
                    content: user_content,
                },
                FineTuneMessage {
                    role: "assistant".to_string(),
                    content: assistant_content,
                },
            ],
        };

        let json_line = serde_json::to_string(&conversation)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        lines.push(json_line);
    }

    Ok(lines.join("\n"))
}

/// Get dataset statistics without exporting
#[tauri::command]
pub fn get_export_statistics(db: DbState<'_>) -> Result<DatasetStatistics, String> {
    log::info!("Getting export statistics");

    let gold_analyses = db
        .get_gold_analyses_for_export()
        .map_err(|e| format!("Failed to get gold analyses: {}", e))?;

    let mut by_component: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut by_severity: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut verified_count = 0;
    let mut pending_count = 0;

    for gold in &gold_analyses {
        let component = gold.component.clone().unwrap_or_else(|| "Unknown".to_string());
        let severity = gold.severity.clone().unwrap_or_else(|| "medium".to_string());

        *by_component.entry(component).or_insert(0) += 1;
        *by_severity.entry(severity).or_insert(0) += 1;

        if gold.validation_status == "verified" {
            verified_count += 1;
        } else {
            pending_count += 1;
        }
    }

    Ok(DatasetStatistics {
        total_examples: gold_analyses.len(),
        by_component,
        by_severity,
        verified_count,
        pending_count,
        avg_rating: None,
    })
}

// ============================================================================
// JIRA Ticket Linking Commands (Phase 3)
// ============================================================================

use crate::database::JiraLink;

/// Link request from frontend
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkJiraTicketRequest {
    pub analysis_id: i64,
    pub jira_key: String,
    pub jira_url: Option<String>,
    pub jira_summary: Option<String>,
    pub jira_status: Option<String>,
    pub jira_priority: Option<String>,
    pub link_type: Option<String>,
    pub notes: Option<String>,
}

/// Link a JIRA ticket to an analysis
#[tauri::command]
pub async fn link_jira_to_analysis(
    request: LinkJiraTicketRequest,
    db: DbState<'_>,
) -> Result<JiraLink, String> {
    log::info!(
        "Linking JIRA {} to analysis {}",
        request.jira_key,
        request.analysis_id
    );

    let db_clone = Arc::clone(&db);
    let analysis_id = request.analysis_id;

    tauri::async_runtime::spawn_blocking(move || {
        let link_type = request.link_type.as_deref().unwrap_or("related");

        db_clone
            .link_jira_ticket(
                analysis_id,
                &request.jira_key,
                request.jira_url.as_deref(),
                request.jira_summary.as_deref(),
                request.jira_status.as_deref(),
                request.jira_priority.as_deref(),
                link_type,
                request.notes.as_deref(),
            )
            .map_err(|e| format!("Failed to link JIRA ticket: {}", e))?;

        // Return the created link
        db_clone
            .get_jira_links_for_analysis(analysis_id)
            .map_err(|e| format!("Failed to get link: {}", e))?
            .into_iter()
            .find(|l| l.jira_key == request.jira_key)
            .ok_or_else(|| "Link not found after creation".to_string())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Unlink a JIRA ticket from an analysis
#[tauri::command]
pub async fn unlink_jira_from_analysis(
    analysis_id: i64,
    jira_key: String,
    db: DbState<'_>,
) -> Result<bool, String> {
    log::info!("Unlinking JIRA {} from analysis {}", jira_key, analysis_id);

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.unlink_jira_ticket(analysis_id, &jira_key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to unlink JIRA ticket: {}", e))
}

/// Get all JIRA links for an analysis
#[tauri::command]
pub async fn get_jira_links_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<Vec<JiraLink>, String> {
    log::debug!("Getting JIRA links for analysis {}", analysis_id);

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.get_jira_links_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to get JIRA links: {}", e))
}

/// Get all analyses linked to a specific JIRA ticket
#[tauri::command]
pub async fn get_analyses_for_jira_ticket(
    jira_key: String,
    db: DbState<'_>,
) -> Result<Vec<(Analysis, JiraLink)>, String> {
    log::debug!("Getting analyses linked to JIRA {}", jira_key);

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.get_analyses_for_jira_ticket(&jira_key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to get analyses for JIRA ticket: {}", e))
}

/// Update JIRA ticket metadata in all links (e.g., after status change)
#[tauri::command]
pub async fn update_jira_link_metadata(
    jira_key: String,
    jira_summary: Option<String>,
    jira_status: Option<String>,
    jira_priority: Option<String>,
    db: DbState<'_>,
) -> Result<usize, String> {
    log::info!("Updating JIRA {} metadata in links", jira_key);

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || {
        db_clone.update_jira_link_metadata(
            &jira_key,
            jira_summary.as_deref(),
            jira_status.as_deref(),
            jira_priority.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to update JIRA link metadata: {}", e))
}

/// Count JIRA links for an analysis
#[tauri::command]
pub async fn count_jira_links_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<i64, String> {
    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.count_jira_links_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to count JIRA links: {}", e))
}

/// Get all JIRA links across all analyses (for sync service)
#[tauri::command]
pub async fn get_all_jira_links(db: DbState<'_>) -> Result<Vec<JiraLink>, String> {
    log::debug!("Getting all JIRA links for sync");

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.get_all_jira_links())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to get all JIRA links: {}", e))
}

// ============================================================================
// Sentry Integration Commands
// ============================================================================

/// Test Sentry connection
#[tauri::command]
pub async fn test_sentry_connection(
    base_url: String,
    auth_token: String,
) -> Result<sentry_service::SentryTestResponse, String> {
    log::info!("Testing Sentry connection");
    sentry_service::test_sentry_connection(&base_url, &auth_token).await
}

/// List Sentry projects for settings dropdown
#[tauri::command]
pub async fn list_sentry_projects(
    base_url: String,
    auth_token: String,
) -> Result<Vec<sentry_service::SentryProjectInfo>, String> {
    log::info!("Listing Sentry projects");
    sentry_service::list_sentry_projects(&base_url, &auth_token).await
}

/// List issues for a Sentry project
#[tauri::command]
pub async fn list_sentry_issues(
    base_url: String,
    auth_token: String,
    org: String,
    project: String,
    query: Option<String>,
    cursor: Option<String>,
) -> Result<sentry_service::SentryIssueList, String> {
    log::info!("Listing Sentry issues for {}/{}", org, project);
    sentry_service::list_sentry_issues(
        &base_url,
        &auth_token,
        &org,
        &project,
        query.as_deref(),
        cursor.as_deref(),
    )
    .await
}

/// List recent issues across all projects in an organization
#[tauri::command]
pub async fn list_sentry_org_issues(
    base_url: String,
    auth_token: String,
    org: String,
    query: Option<String>,
    cursor: Option<String>,
) -> Result<sentry_service::SentryIssueList, String> {
    log::info!("Listing recent Sentry issues for org {}", org);
    sentry_service::list_sentry_org_issues(
        &base_url,
        &auth_token,
        &org,
        query.as_deref(),
        cursor.as_deref(),
    )
    .await
}

/// Fetch a single Sentry issue by ID
#[tauri::command]
pub async fn fetch_sentry_issue(
    base_url: String,
    auth_token: String,
    issue_id: String,
) -> Result<sentry_service::SentryIssue, String> {
    log::info!("Fetching Sentry issue {}", issue_id);
    sentry_service::fetch_sentry_issue(&base_url, &auth_token, &issue_id).await
}

/// Fetch latest event for a Sentry issue
#[tauri::command]
pub async fn fetch_sentry_latest_event(
    base_url: String,
    auth_token: String,
    issue_id: String,
) -> Result<sentry_service::SentryEvent, String> {
    log::info!("Fetching latest event for Sentry issue {}", issue_id);
    sentry_service::fetch_sentry_latest_event(&base_url, &auth_token, &issue_id).await
}

/// Analyze a Sentry issue using the AI pipeline
#[tauri::command]
pub async fn analyze_sentry_issue(
    base_url: String,
    auth_token: String,
    issue_id: String,
    api_key: String,
    model: String,
    provider: String,
    db: DbState<'_>,
    app: AppHandle,
) -> Result<AnalysisResponse, String> {
    log::info!("Starting Sentry issue analysis: issue_id={}", issue_id);

    // Phase 1: Fetch issue and event data
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Reading,
            progress: 0,
            message: "Fetching Sentry issue data...".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    let issue = sentry_service::fetch_sentry_issue(&base_url, &auth_token, &issue_id)
        .await
        .map_err(|e| format!("Failed to fetch Sentry issue: {}", e))?;

    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Reading,
            progress: 5,
            message: "Fetching latest event data...".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    let event = sentry_service::fetch_sentry_latest_event(&base_url, &auth_token, &issue_id)
        .await
        .map_err(|e| format!("Failed to fetch Sentry event: {}", e))?;

    // Phase 2: Normalize data for analysis
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Planning,
            progress: 10,
            message: "Preparing analysis content...".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    let mut analysis_content = sentry_service::normalize_sentry_to_analysis_content(&issue, &event);

    // Detect known patterns (deadlock, N+1, memory leak, unhandled promise)
    let detected_patterns = sentry_service::detect_sentry_patterns(&issue, &event);
    if !detected_patterns.is_empty() {
        let labels: Vec<&str> = detected_patterns.iter().map(|p| p.pattern_type.label()).collect();
        log::info!("Sentry patterns detected: {:?}", labels);

        // Append pattern context to the analysis content so the AI can see it
        if let Some(pattern_prompt) = sentry_service::build_pattern_prompt(&detected_patterns) {
            analysis_content.push_str(&pattern_prompt);
        }
    }

    let content_size_kb = analysis_content.len() as f64 / 1024.0;

    log::info!(
        "Sentry issue normalized: {} bytes, short_id={}, patterns={}",
        analysis_content.len(),
        issue.short_id,
        detected_patterns.len()
    );

    // Phase 3: Run AI analysis
    emit_progress(
        &app,
        AnalysisProgress {
            phase: AnalysisPhase::Analyzing,
            progress: 20,
            message: "Analyzing Sentry issue with AI...".to_string(),
            current_step: None,
            total_steps: None,
        },
    );

    let api_key_z = Zeroizing::new(api_key);
    let result = ai_service::analyze_crash_log_safe(
        &analysis_content,
        None,
        api_key_z.as_str(),
        &model,
        &provider,
        "sentry",
        None,
    )
    .await
    .map_err(|e| {
        log::error!("Sentry AI analysis failed: issue={}, error={}", issue_id, e);
        format!("AI analysis failed: {}", e)
    })?;

    // Phase 4: Save to database
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

    let analysis = Analysis {
        id: 0,
        filename: issue.short_id.clone(),
        file_size_kb: content_size_kb,
        error_type: result.error_type.clone(),
        error_message: result.error_message.clone(),
        severity: normalize_severity(&result.severity),
        component: result.component.clone().or(issue.culprit.clone()),
        stack_trace: result.stack_trace.clone(),
        root_cause: result.root_cause.clone(),
        suggested_fixes: serde_json::to_string(&result.suggested_fixes)
            .unwrap_or_else(|_| "[]".to_string()),
        confidence: Some(result.confidence.to_uppercase()),
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        ai_model: model.clone(),
        ai_provider: Some(provider.clone()),
        tokens_used: result.tokens_used,
        cost: result.cost,
        was_truncated: result.was_truncated.unwrap_or(false),
        full_data: result.raw_enhanced_json.clone().or_else(|| {
            // Extract event data for rich frontend display
            let breadcrumbs = sentry_service::extract_breadcrumbs(&event);
            let exceptions = sentry_service::extract_exceptions(&event);

            // Build a full_data blob with Sentry context + AI result + detected patterns + event data
            let full = serde_json::json!({
                "sentry_issue_id": issue.id,
                "sentry_short_id": issue.short_id,
                "sentry_permalink": issue.permalink,
                "sentry_level": issue.level,
                "sentry_status": issue.status,
                "sentry_platform": issue.platform,
                "sentry_count": issue.count,
                "sentry_user_count": issue.user_count,
                "sentry_first_seen": issue.first_seen,
                "sentry_last_seen": issue.last_seen,
                "sentry_culprit": issue.culprit,
                "detected_patterns": serde_json::to_value(&detected_patterns).ok(),
                "ai_result": serde_json::to_value(&result).ok(),
                "breadcrumbs": serde_json::to_value(&breadcrumbs).ok(),
                "exceptions": serde_json::to_value(&exceptions).ok(),
                "tags": serde_json::to_value(&event.tags).ok(),
                "contexts": &event.contexts,
            });
            Some(full.to_string())
        }),
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: result.analysis_duration_ms,
        analysis_type: "sentry".to_string(),
    };

    let response_filename = analysis.filename.clone();
    let response_error_type = analysis.error_type.clone();
    let response_severity = analysis.severity.clone();
    let response_root_cause = analysis.root_cause.clone();
    let response_analyzed_at = analysis.analyzed_at.clone();
    let response_cost = analysis.cost;

    let db_clone = Arc::clone(&db);
    let id = tauri::async_runtime::spawn_blocking(move || db_clone.insert_analysis(&analysis))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| {
            log::error!("Database insert failed for Sentry analysis: {}", e);
            format!("Database error: {}", e)
        })?;

    log::info!(
        "Sentry analysis completed: id={}, issue={}, severity={}",
        id,
        issue_id,
        response_severity
    );

    // Emit completion
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

    Ok(AnalysisResponse {
        id,
        filename: response_filename,
        error_type: response_error_type,
        severity: response_severity,
        root_cause: response_root_cause,
        suggested_fixes: result.suggested_fixes,
        analyzed_at: response_analyzed_at,
        cost: response_cost,
        analysis_mode: None,
        coverage_summary: None,
        token_utilization: None,
    })
}
