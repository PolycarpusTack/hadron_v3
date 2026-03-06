use crate::ai_service;
use crate::ai_service::translate_llamacpp;
use crate::database::{
    Analysis, Database, Translation,
};
use crate::jira_service;
use crate::keeper_service;
use crate::sentry_service;
use crate::model_fetcher::{
    list_models as fetch_models, test_connection as test_api_connection, ConnectionTestResult,
    Model,
};
use crate::python_runner::run_python_translation;
use crate::rag_commands;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::fs as async_fs;
use zeroize::Zeroizing;

// ============================================================================
// Shared types and helpers (canonical definitions in commands::common)
// ============================================================================

pub use crate::commands::common::{
    AnalysisPhase, AnalysisProgress, DbState,
    MAX_CRASH_LOG_SIZE_BYTES,
    MAX_TRANSLATION_CONTENT_SIZE, MAX_AI_CONTENT_BYTES_ESTIMATE, MAX_PASTED_LOG_SIZE,
    emit_progress, normalize_severity, redact_pii_basic, validate_file_path,
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

/// Extract a KB-relevant query from content.
/// For JIRA analyses, `hint` should be the ticket summary (avoids parsing the composed header).
fn extract_kb_query(content: &str, analysis_type: &str, hint: Option<&str>) -> String {
    match analysis_type {
        "jira" | "jira_ticket" => {
            if let Some(h) = hint {
                return h.chars().take(300).collect();
            }
            // Fallback: parse "Summary: ..." line from composed content
            content
                .lines()
                .find(|l| l.starts_with("Summary: "))
                .and_then(|l| l.strip_prefix("Summary: "))
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
    log::debug!("cmd: analyze_crash_log");
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
        let kb_query = extract_kb_query(&crash_content, &request.analysis_type, None);
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
    log::debug!("cmd: analyze_jira_ticket");
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
        let kb_query = extract_kb_query(&content, analysis_type, Some(&request.summary));
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

    // Capture context counts before moving into AI call (needed for analysis_trace)
    let rag_case_count = rag_context.as_ref().map_or(0, |c| c.similar_cases.len());
    let kb_doc_count = domain_knowledge.as_ref().map_or(0, |dk| dk.kb_results.len());
    let kb_release_note_count = domain_knowledge.as_ref().map_or(0, |dk| dk.release_note_results.len());

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

    // Build rich full_data blob with JIRA metadata & analysis trace
    let analysis_trace = serde_json::json!({
        "input": {
            "jira_key": &request.jira_key,
            "summary": request.summary.chars().take(200).collect::<String>(),
            "description_chars": request.description.len(),
            "comment_count": request.comments.len(),
            "priority": &request.priority,
            "status": &request.status,
            "components": &request.components,
            "labels": &request.labels,
        },
        "context": {
            "rag_enabled": request.use_rag.unwrap_or(false),
            "rag_case_count": rag_case_count,
            "kb_enabled": request.use_kb.unwrap_or(false),
            "kb_doc_count": kb_doc_count,
            "kb_release_note_count": kb_release_note_count,
        },
        "model": {
            "provider": &request.provider,
            "model": &request.model,
        },
    });

    let rich_full_data = {
        let full = serde_json::json!({
            "jira_key": &request.jira_key,
            "jira_summary": &request.summary,
            "jira_priority": &request.priority,
            "jira_status": &request.status,
            "jira_components": &request.components,
            "jira_labels": &request.labels,
            "description_chars": request.description.len(),
            "comment_count": request.comments.len(),
            "analysis_trace": &analysis_trace,
            "ai_result": serde_json::to_value(&result).ok(),
            "raw_enhanced_json": &result.raw_enhanced_json,
        });
        Some(full.to_string())
    };

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
        full_data: rich_full_data,
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: result.analysis_duration_ms,
        analysis_type: "jira".to_string(),
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
        analysis_type: "jira".to_string(),
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
    log::debug!("cmd: translate_content");
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

/// Call the AI and return the raw response, without persisting to the database.
/// Used by features (Code Analyzer, future tools) that handle their own persistence
/// via save_external_analysis or equivalent.
#[tauri::command]
pub async fn call_ai(
    content: String,
    api_key: String,
    model: String,
    provider: String,
    redact_pii: Option<bool>,
) -> Result<String, String> {
    log::debug!("cmd: call_ai");
    let api_key = Zeroizing::new(api_key);

    if content.len() > MAX_TRANSLATION_CONTENT_SIZE {
        return Err(format!(
            "Content too large: {} bytes exceeds maximum of {} bytes (1 MB)",
            content.len(),
            MAX_TRANSLATION_CONTENT_SIZE
        ));
    }

    if content.len() > MAX_AI_CONTENT_BYTES_ESTIMATE {
        let estimated_tokens = content.len() / 4;
        return Err(format!(
            "Content is approximately {} tokens, which likely exceeds your AI model's \
             context limit (128K). Please reduce the code size and try again.",
            estimated_tokens
        ));
    }

    let content_for_ai: Cow<'_, str> = if redact_pii.unwrap_or(false) {
        redact_pii_basic(&content)
    } else {
        Cow::Borrowed(&content)
    };

    let response = if provider.to_lowercase() == "llamacpp" {
        translate_llamacpp(&content_for_ai, &model)
            .await
            .map_err(|e| format!("llama.cpp call failed: {}", e))?
    } else {
        run_python_translation(&content_for_ai, api_key.as_str(), &model, &provider)
            .await
            .map_err(|e| format!("AI call failed: {}", e))?
            .translation
    };

    log::info!("call_ai completed: provider={}", provider);
    Ok(response)
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
    log::debug!("cmd: save_external_analysis");
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

// ============================================================================
// Bulk Operations
// ============================================================================

// ============================================================================
// Similar Crash Detection & Analytics
// ============================================================================

/// List available models from AI provider
#[tauri::command]
pub async fn list_models(provider: String, api_key: String) -> Result<Vec<Model>, String> {
    log::debug!("cmd: list_models");
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
    log::debug!("cmd: test_connection");
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
    log::debug!("cmd: save_analysis");
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
    log::debug!("cmd: save_pasted_log");
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
    log::debug!("cmd: test_jira_connection");
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
    log::debug!("cmd: list_jira_projects");
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
    log::debug!("cmd: create_jira_ticket");
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
    log::debug!("cmd: search_jira_issues");
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
    log::debug!("cmd: post_jira_comment");
    log::info!("Posting comment to JIRA issue {}", issue_key);
    jira_service::post_jira_comment(&base_url, &email, &api_token, &issue_key, &comment_body).await
}


// ============================================================================
// Report Export Commands
// ============================================================================

// ============================================================================
// Multi-Format Export Commands
// ============================================================================

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
    log::debug!("cmd: get_database_info");
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
    log::debug!("cmd: get_file_stats");
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
// Fine-Tuning Export (Phase 1.4)
// ============================================================================

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
    log::debug!("cmd: export_gold_jsonl_enhanced");
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
    log::debug!("cmd: link_jira_to_analysis");
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
    log::debug!("cmd: unlink_jira_from_analysis");
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
    log::debug!("cmd: get_jira_links_for_analysis");
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
    log::debug!("cmd: get_analyses_for_jira_ticket");
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
    log::debug!("cmd: update_jira_link_metadata");
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
    log::debug!("cmd: count_jira_links_for_analysis");
    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.count_jira_links_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to count JIRA links: {}", e))
}

/// Get all JIRA links across all analyses (for sync service)
#[tauri::command]
pub async fn get_all_jira_links(db: DbState<'_>) -> Result<Vec<JiraLink>, String> {
    log::debug!("cmd: get_all_jira_links");
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
    log::debug!("cmd: analyze_sentry_issue");
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
