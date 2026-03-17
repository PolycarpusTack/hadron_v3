//! Sentry Integration Service
//!
//! Provides Sentry issue browsing and analysis via the Sentry API.
//! Uses Bearer token authentication.
//!
//! # Security
//! - Auth tokens are stored in encrypted storage via Tauri Store plugin
//! - Tokens are never logged or exposed to frontend
//! - All API calls use HTTPS

use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::str_utils::floor_char_boundary;

/// HTTP client with connection pooling and 30s timeout
static SENTRY_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|e| {
            log::error!("Failed to build Sentry HTTP client (TLS init): {}. Using default client.", e);
            Client::new()
        })
});

// ============================================================================
// Data Structures
// ============================================================================

/// Sentry connection test response
#[derive(Debug, Serialize)]
pub struct SentryTestResponse {
    pub success: bool,
    pub message: String,
    pub projects: Option<Vec<SentryProjectInfo>>,
}

/// Sentry project info (for settings/selection)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SentryProjectInfo {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub platform: Option<String>,
    pub organization: SentryOrgSlug,
}

/// Minimal org info embedded in project responses
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SentryOrgSlug {
    pub slug: String,
}

/// Sentry issue from list endpoint
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SentryIssue {
    pub id: String,
    pub short_id: String,
    pub title: String,
    pub culprit: Option<String>,
    pub level: String,
    pub status: String,
    pub platform: Option<String>,
    pub count: Option<String>,
    pub user_count: Option<i64>,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub permalink: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub project: Option<SentryIssueProject>,
}

/// Minimal project info embedded in org-level issue responses
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SentryIssueProject {
    pub id: String,
    pub slug: String,
    pub name: Option<String>,
}

/// Paginated issue list with cursor
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentryIssueList {
    pub issues: Vec<SentryIssue>,
    pub next_cursor: Option<String>,
}

/// Full Sentry event (latest event for an issue)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SentryEvent {
    pub event_id: Option<String>,
    pub title: Option<String>,
    pub message: Option<String>,
    pub platform: Option<String>,
    pub tags: Option<Vec<SentryTag>>,
    pub contexts: Option<serde_json::Value>,
    pub entries: Option<Vec<serde_json::Value>>,
}

/// Sentry tag key-value pair
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SentryTag {
    pub key: String,
    pub value: String,
}

/// Single stack frame
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SentryFrame {
    pub filename: Option<String>,
    pub function: Option<String>,
    pub line_no: Option<i64>,
    pub col_no: Option<i64>,
    pub context_line: Option<String>,
    pub pre_context: Option<Vec<String>>,
    pub post_context: Option<Vec<String>>,
    pub in_app: Option<bool>,
    pub module: Option<String>,
}

/// Breadcrumb entry
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SentryBreadcrumb {
    pub timestamp: Option<String>,
    pub category: Option<String>,
    pub message: Option<String>,
    pub level: Option<String>,
    pub data: Option<serde_json::Value>,
    #[serde(rename = "type")]
    pub breadcrumb_type: Option<String>,
}

/// Extracted exception from event entries
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SentryException {
    #[serde(rename = "type")]
    pub exception_type: Option<String>,
    pub value: Option<String>,
    pub module: Option<String>,
    pub stacktrace: Option<SentryRawStacktrace>,
}

/// Raw stacktrace as it appears inside exception entries
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SentryRawStacktrace {
    pub frames: Option<Vec<SentryFrame>>,
}

// ============================================================================
// API Functions
// ============================================================================

/// Test Sentry connection by fetching projects
pub async fn test_sentry_connection(
    base_url: &str,
    auth_token: &str,
) -> Result<SentryTestResponse, String> {
    let base_url = base_url.trim_end_matches('/');

    log::info!("Testing Sentry connection to {}", base_url);

    let response = SENTRY_CLIENT
        .get(format!("{}/api/0/projects/", base_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let status = response.status();

    if status.is_success() {
        let projects: Vec<SentryProjectInfo> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(SentryTestResponse {
            success: true,
            message: format!("Connected successfully. Found {} projects.", projects.len()),
            projects: Some(projects),
        })
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        Ok(SentryTestResponse {
            success: false,
            message: "Authentication failed. Check your auth token.".to_string(),
            projects: None,
        })
    } else if status == reqwest::StatusCode::FORBIDDEN {
        Ok(SentryTestResponse {
            success: false,
            message: "Access denied. Check your token permissions (project:read required).".to_string(),
            projects: None,
        })
    } else {
        let error_text = response.text().await.unwrap_or_default();
        Ok(SentryTestResponse {
            success: false,
            message: format!("Connection failed (HTTP {}): {}", status.as_u16(), error_text),
            projects: None,
        })
    }
}

/// List all Sentry projects accessible with the given token
pub async fn list_sentry_projects(
    base_url: &str,
    auth_token: &str,
) -> Result<Vec<SentryProjectInfo>, String> {
    let base_url = base_url.trim_end_matches('/');

    log::info!("Listing Sentry projects from {}", base_url);

    let response = SENTRY_CLIENT
        .get(format!("{}/api/0/projects/", base_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let status = response.status();

    if status.is_success() {
        let projects: Vec<SentryProjectInfo> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(projects)
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        Err("Authentication failed. Check your auth token.".to_string())
    } else if status == reqwest::StatusCode::FORBIDDEN {
        Err("Access denied. Check your token permissions.".to_string())
    } else {
        let error_text = response.text().await.unwrap_or_default();
        Err(format!(
            "Failed to list projects (HTTP {}): {}",
            status.as_u16(),
            error_text
        ))
    }
}

/// List issues for a Sentry project with optional search and cursor pagination
pub async fn list_sentry_issues(
    base_url: &str,
    auth_token: &str,
    org: &str,
    project: &str,
    query: Option<&str>,
    cursor: Option<&str>,
) -> Result<SentryIssueList, String> {
    let base_url = base_url.trim_end_matches('/');

    log::info!("Listing Sentry issues for {}/{}", org, project);

    let mut url = format!(
        "{}/api/0/projects/{}/{}/issues/",
        base_url, org, project
    );

    // Build query params
    let mut params: Vec<String> = Vec::new();
    if let Some(q) = query {
        if !q.is_empty() {
            params.push(format!("query={}", urlencoding::encode(q)));
        }
    }
    if let Some(c) = cursor {
        if !c.is_empty() {
            params.push(format!("cursor={}", urlencoding::encode(c)));
        }
    }
    if !params.is_empty() {
        url = format!("{}?{}", url, params.join("&"));
    }

    let response = SENTRY_CLIENT
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("60");
        return Err(format!(
            "Rate limited by Sentry. Retry after {} seconds.",
            retry_after
        ));
    }

    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to list issues (HTTP {}): {}",
            status.as_u16(),
            error_text
        ));
    }

    // Parse cursor from Link header for pagination
    let next_cursor = parse_next_cursor(response.headers());

    let issues: Vec<SentryIssue> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse issues: {}", e))?;

    Ok(SentryIssueList {
        issues,
        next_cursor,
    })
}

/// List issues across all projects in an organization
/// Uses the org-level endpoint with a `lastSeen:>-24h` filter by default
pub async fn list_sentry_org_issues(
    base_url: &str,
    auth_token: &str,
    org: &str,
    query: Option<&str>,
    cursor: Option<&str>,
) -> Result<SentryIssueList, String> {
    let base_url = base_url.trim_end_matches('/');

    log::info!("Listing recent Sentry issues for org {}", org);

    let mut url = format!(
        "{}/api/0/organizations/{}/issues/",
        base_url, org
    );

    // Build query params — default to lastSeen:-24h if no query provided
    let mut params: Vec<String> = Vec::new();
    let effective_query = match query {
        Some(q) if !q.is_empty() => q.to_string(),
        _ => "lastSeen:-24h".to_string(),
    };
    params.push(format!("query={}", urlencoding::encode(&effective_query)));
    params.push("sort=date".to_string());

    if let Some(c) = cursor {
        if !c.is_empty() {
            params.push(format!("cursor={}", urlencoding::encode(c)));
        }
    }
    url = format!("{}?{}", url, params.join("&"));

    let response = SENTRY_CLIENT
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("60");
        return Err(format!(
            "Rate limited by Sentry. Retry after {} seconds.",
            retry_after
        ));
    }

    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to list org issues (HTTP {}): {}",
            status.as_u16(),
            error_text
        ));
    }

    let next_cursor = parse_next_cursor(response.headers());

    let issues: Vec<SentryIssue> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse org issues: {}", e))?;

    Ok(SentryIssueList {
        issues,
        next_cursor,
    })
}

/// Fetch a single Sentry issue by ID
pub async fn fetch_sentry_issue(
    base_url: &str,
    auth_token: &str,
    issue_id: &str,
) -> Result<SentryIssue, String> {
    let base_url = base_url.trim_end_matches('/');

    log::info!("Fetching Sentry issue {}", issue_id);

    let response = SENTRY_CLIENT
        .get(format!("{}/api/0/issues/{}/", base_url, issue_id))
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();

    if status.is_success() {
        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse issue: {}", e))
    } else if status == reqwest::StatusCode::NOT_FOUND {
        Err(format!("Issue {} not found", issue_id))
    } else {
        let error_text = response.text().await.unwrap_or_default();
        Err(format!(
            "Failed to fetch issue (HTTP {}): {}",
            status.as_u16(),
            error_text
        ))
    }
}

/// Fetch the latest event for a Sentry issue
pub async fn fetch_sentry_latest_event(
    base_url: &str,
    auth_token: &str,
    issue_id: &str,
) -> Result<SentryEvent, String> {
    let base_url = base_url.trim_end_matches('/');

    log::info!("Fetching latest event for Sentry issue {}", issue_id);

    let response = SENTRY_CLIENT
        .get(format!("{}/api/0/issues/{}/events/latest/", base_url, issue_id))
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();

    if status.is_success() {
        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse event: {}", e))
    } else {
        let error_text = response.text().await.unwrap_or_default();
        Err(format!(
            "Failed to fetch event (HTTP {}): {}",
            status.as_u16(),
            error_text
        ))
    }
}

// ============================================================================
// Event Data Extraction Helpers
// ============================================================================

/// Extract exceptions from event entries
pub fn extract_exceptions(event: &SentryEvent) -> Vec<SentryException> {
    let mut exceptions = Vec::new();

    if let Some(entries) = &event.entries {
        for entry in entries {
            if entry.get("type").and_then(|t| t.as_str()) == Some("exception") {
                if let Some(data) = entry.get("data") {
                    if let Some(values) = data.get("values").and_then(|v| v.as_array()) {
                        for val in values {
                            if let Ok(exc) = serde_json::from_value::<SentryException>(val.clone()) {
                                exceptions.push(exc);
                            }
                        }
                    }
                }
            }
        }
    }

    exceptions
}

/// Extract breadcrumbs from event entries
pub fn extract_breadcrumbs(event: &SentryEvent) -> Vec<SentryBreadcrumb> {
    let mut breadcrumbs = Vec::new();

    if let Some(entries) = &event.entries {
        for entry in entries {
            if entry.get("type").and_then(|t| t.as_str()) == Some("breadcrumbs") {
                if let Some(data) = entry.get("data") {
                    if let Some(values) = data.get("values").and_then(|v| v.as_array()) {
                        for val in values {
                            if let Ok(bc) = serde_json::from_value::<SentryBreadcrumb>(val.clone()) {
                                breadcrumbs.push(bc);
                            }
                        }
                    }
                }
            }
        }
    }

    breadcrumbs
}

/// Normalize Sentry issue + event data into a structured text block for AI analysis
pub fn normalize_sentry_to_analysis_content(
    issue: &SentryIssue,
    event: &SentryEvent,
) -> String {
    let mut content = String::new();

    // Header
    content.push_str(&format!("=== Sentry Issue: {} ===\n", issue.short_id));
    content.push_str(&format!("Title: {}\n", issue.title));
    content.push_str(&format!("Level: {}\n", issue.level));
    content.push_str(&format!("Status: {}\n", issue.status));
    if let Some(platform) = &issue.platform {
        content.push_str(&format!("Platform: {}\n", platform));
    }
    if let Some(culprit) = &issue.culprit {
        content.push_str(&format!("Culprit: {}\n", culprit));
    }
    if let Some(count) = &issue.count {
        content.push_str(&format!("Event Count: {}\n", count));
    }
    if let Some(user_count) = issue.user_count {
        content.push_str(&format!("Affected Users: {}\n", user_count));
    }
    if let Some(first_seen) = &issue.first_seen {
        content.push_str(&format!("First Seen: {}\n", first_seen));
    }
    if let Some(last_seen) = &issue.last_seen {
        content.push_str(&format!("Last Seen: {}\n", last_seen));
    }
    content.push('\n');

    // Exceptions
    let exceptions = extract_exceptions(event);
    if !exceptions.is_empty() {
        content.push_str("=== Exception Chain ===\n");
        for (i, exc) in exceptions.iter().enumerate() {
            content.push_str(&format!(
                "Exception #{}: {} - {}\n",
                i + 1,
                exc.exception_type.as_deref().unwrap_or("Unknown"),
                exc.value.as_deref().unwrap_or("(no message)")
            ));
            if let Some(module) = &exc.module {
                content.push_str(&format!("  Module: {}\n", module));
            }

            // Stacktrace frames
            if let Some(st) = &exc.stacktrace {
                if let Some(frames) = &st.frames {
                    content.push_str("  Stacktrace:\n");
                    // Show frames in reverse (most recent call first)
                    for frame in frames.iter().rev().take(30) {
                        let in_app = frame.in_app.unwrap_or(false);
                        let marker = if in_app { "[APP]" } else { "[LIB]" };
                        let func = frame.function.as_deref().unwrap_or("<unknown>");
                        let file = frame.filename.as_deref().unwrap_or("?");
                        let line = frame.line_no.map(|l| format!(":{}", l)).unwrap_or_default();
                        content.push_str(&format!("    {} {} at {}{}\n", marker, func, file, line));
                        if let Some(ctx) = &frame.context_line {
                            content.push_str(&format!("      > {}\n", ctx.trim()));
                        }
                    }
                }
            }
            content.push('\n');
        }
    }

    // Breadcrumbs
    let breadcrumbs = extract_breadcrumbs(event);
    if !breadcrumbs.is_empty() {
        content.push_str("=== Breadcrumbs (recent activity) ===\n");
        // Show last 20 breadcrumbs
        for bc in breadcrumbs.iter().rev().take(20).collect::<Vec<_>>().into_iter().rev() {
            let ts = bc.timestamp.as_deref().unwrap_or("?");
            let cat = bc.category.as_deref().unwrap_or("default");
            let level = bc.level.as_deref().unwrap_or("info");
            let msg = bc.message.as_deref().unwrap_or("");
            content.push_str(&format!("  [{}] ({}) {}: {}\n", ts, level, cat, msg));
        }
        content.push('\n');
    }

    // Tags
    if let Some(tags) = &event.tags {
        if !tags.is_empty() {
            content.push_str("=== Tags ===\n");
            for tag in tags {
                content.push_str(&format!("  {}: {}\n", tag.key, tag.value));
            }
            content.push('\n');
        }
    }

    // Runtime context (if available)
    if let Some(contexts) = &event.contexts {
        if let Some(obj) = contexts.as_object() {
            let relevant_contexts: Vec<&str> = vec!["os", "browser", "runtime", "device"];
            let mut has_context = false;
            for ctx_name in &relevant_contexts {
                if let Some(ctx) = obj.get(*ctx_name) {
                    if !has_context {
                        content.push_str("=== Runtime Context ===\n");
                        has_context = true;
                    }
                    content.push_str(&format!("  {}: {}\n", ctx_name, ctx));
                }
            }
            if has_context {
                content.push('\n');
            }
        }
    }

    content
}

// ============================================================================
// Pattern Detection
// ============================================================================

/// A detected pattern in a Sentry issue/event
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPattern {
    pub pattern_type: PatternType,
    pub confidence: f32,
    pub evidence: Vec<String>,
}

/// Known pattern types for Sentry issues
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PatternType {
    Deadlock,
    NPlusOne,
    MemoryLeak,
    UnhandledPromise,
}

impl PatternType {
    pub fn label(&self) -> &str {
        match self {
            PatternType::Deadlock => "Deadlock",
            PatternType::NPlusOne => "N+1 Query",
            PatternType::MemoryLeak => "Memory Leak",
            PatternType::UnhandledPromise => "Unhandled Promise",
        }
    }
}

/// Detect known patterns from a Sentry issue and its latest event
pub fn detect_sentry_patterns(issue: &SentryIssue, event: &SentryEvent) -> Vec<DetectedPattern> {
    let mut patterns = Vec::new();

    // Collect searchable text
    let title_lower = issue.title.to_lowercase();
    let message_lower = event.message.as_deref().unwrap_or("").to_lowercase();
    let exceptions = extract_exceptions(event);
    let breadcrumbs = extract_breadcrumbs(event);

    let exc_text: String = exceptions
        .iter()
        .map(|e| {
            format!(
                "{} {}",
                e.exception_type.as_deref().unwrap_or(""),
                e.value.as_deref().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();

    // --- Deadlock Detection ---
    {
        let mut evidence = Vec::new();
        let keywords = ["deadlock", "lock timeout", "lock wait timeout", "40p01"];
        for kw in &keywords {
            if title_lower.contains(kw) {
                evidence.push(format!("Title contains '{}'", kw));
            }
            if message_lower.contains(kw) {
                evidence.push(format!("Message contains '{}'", kw));
            }
            if exc_text.contains(kw) {
                evidence.push(format!("Exception contains '{}'", kw));
            }
        }
        // Check tags for deadlock error codes
        if let Some(tags) = &event.tags {
            for tag in tags {
                let val_lower = tag.value.to_lowercase();
                if val_lower.contains("deadlock") || val_lower == "40p01" {
                    evidence.push(format!("Tag {}={}", tag.key, tag.value));
                }
            }
        }
        if !evidence.is_empty() {
            let confidence = if evidence.len() >= 2 { 0.9 } else { 0.7 };
            patterns.push(DetectedPattern {
                pattern_type: PatternType::Deadlock,
                confidence,
                evidence,
            });
        }
    }

    // --- N+1 Query Detection ---
    {
        let mut evidence = Vec::new();
        // Check breadcrumbs for repeated DB queries
        let db_breadcrumbs: Vec<&SentryBreadcrumb> = breadcrumbs
            .iter()
            .filter(|bc| {
                let cat = bc.category.as_deref().unwrap_or("");
                cat == "query" || cat == "db" || cat.starts_with("django.db")
                    || cat.starts_with("sqlalchemy") || cat == "http"
            })
            .collect();

        if db_breadcrumbs.len() >= 3 {
            // Look for similar messages (3+ threshold)
            let mut query_counts: std::collections::HashMap<String, usize> =
                std::collections::HashMap::new();
            for bc in &db_breadcrumbs {
                if let Some(msg) = &bc.message {
                    // Normalize: strip numeric params to group similar queries
                    let normalized = normalize_query(msg);
                    *query_counts.entry(normalized).or_insert(0) += 1;
                }
            }
            for (query, count) in &query_counts {
                if *count >= 3 {
                    evidence.push(format!(
                        "Query pattern repeated {} times: {}",
                        count,
                        &query[..floor_char_boundary(query, 100)]
                    ));
                }
            }
        }

        // Also check title/message for N+1 keywords
        if title_lower.contains("n+1") || message_lower.contains("n+1") {
            evidence.push("Title/message references N+1".to_string());
        }

        if !evidence.is_empty() {
            let confidence = if evidence.iter().any(|e| e.contains("repeated")) {
                0.85
            } else {
                0.6
            };
            patterns.push(DetectedPattern {
                pattern_type: PatternType::NPlusOne,
                confidence,
                evidence,
            });
        }
    }

    // --- Memory Leak Detection ---
    {
        let mut evidence = Vec::new();
        let keywords = [
            "out of memory",
            "outofmemory",
            "oom",
            "heap exhausted",
            "heap space",
            "memory limit",
            "memoryerror",
            "allocation failed",
            "gc overhead limit",
            "java.lang.outofmemoryerror",
        ];
        for kw in &keywords {
            if title_lower.contains(kw) {
                evidence.push(format!("Title contains '{}'", kw));
            }
            if exc_text.contains(kw) {
                evidence.push(format!("Exception contains '{}'", kw));
            }
        }
        if !evidence.is_empty() {
            let confidence = if evidence.len() >= 2 { 0.9 } else { 0.75 };
            patterns.push(DetectedPattern {
                pattern_type: PatternType::MemoryLeak,
                confidence,
                evidence,
            });
        }
    }

    // --- Unhandled Promise Detection ---
    {
        let mut evidence = Vec::new();
        let keywords = ["unhandledrejection", "unhandled promise", "unhandled rejection"];
        for kw in &keywords {
            if title_lower.contains(kw) {
                evidence.push(format!("Title contains '{}'", kw));
            }
            if message_lower.contains(kw) {
                evidence.push(format!("Message contains '{}'", kw));
            }
            if exc_text.contains(kw) {
                evidence.push(format!("Exception contains '{}'", kw));
            }
        }
        // Check exception types
        for exc in &exceptions {
            if let Some(etype) = &exc.exception_type {
                let etype_lower = etype.to_lowercase();
                if etype_lower.contains("unhandledrejection")
                    || etype_lower == "unhandledpromiserejection"
                {
                    evidence.push(format!("Exception type: {}", etype));
                }
            }
        }
        if !evidence.is_empty() {
            let confidence = if evidence.len() >= 2 { 0.9 } else { 0.8 };
            patterns.push(DetectedPattern {
                pattern_type: PatternType::UnhandledPromise,
                confidence,
                evidence,
            });
        }
    }

    patterns
}

/// Build a supplementary prompt section describing detected patterns
pub fn build_pattern_prompt(patterns: &[DetectedPattern]) -> Option<String> {
    if patterns.is_empty() {
        return None;
    }

    let mut prompt = String::from("\n\n[DETECTED PATTERNS]\n");
    prompt.push_str("The following patterns were detected automatically. Focus your analysis on these:\n");
    for p in patterns {
        prompt.push_str(&format!(
            "- {} (confidence: {:.0}%): {}\n",
            p.pattern_type.label(),
            p.confidence * 100.0,
            p.evidence.join("; ")
        ));
    }
    prompt.push_str("Include these patterns in your response's pattern_type field.\n");
    Some(prompt)
}

/// Normalize a SQL query by stripping numeric literals for grouping similar queries
fn normalize_query(query: &str) -> String {
    // Replace numeric literals with ?
    let mut result = String::with_capacity(query.len());
    let mut chars = query.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch.is_ascii_digit() {
            result.push('?');
            while chars.peek().map_or(false, |c| c.is_ascii_digit()) {
                chars.next();
            }
        } else {
            result.push(ch);
        }
    }
    result
}

// ============================================================================
// AI Analysis Constants
// ============================================================================

/// Sentry-specific system prompt for AI analysis
pub const SENTRY_ANALYSIS_SYSTEM_PROMPT: &str = r#"You are an expert software debugger analyzing a Sentry error event.
The event includes a stacktrace with in-app and library frames, breadcrumbs showing user actions before the error, tags, and runtime context.

Analyze this error and provide your response as a JSON object with these fields:
{
  "error_type": "The specific error class/type",
  "error_message": "The error message",
  "severity": "CRITICAL or HIGH or MEDIUM or LOW",
  "root_cause": "Technical explanation of what triggered this error",
  "suggested_fixes": ["Fix 1", "Fix 2", "Fix 3"],
  "component": "The application component/file affected",
  "confidence": "HIGH or MEDIUM or LOW",
  "pattern_type": "deadlock|n_plus_one|memory_leak|unhandled_promise|generic",
  "user_impact": "Description of how this affects end users",
  "breadcrumb_analysis": "What the breadcrumbs reveal about the error trigger"
}

Pay attention to:
- In-app frames (marked [APP]) vs library frames (marked [LIB]) in the stacktrace
- Breadcrumb patterns leading up to the error
- Environment and runtime context clues
- Recurring patterns suggesting systemic issues
- Event frequency and affected user count for severity assessment

Return ONLY the JSON object, no markdown fencing or explanation."#;

// ============================================================================
// Internal Helpers
// ============================================================================

/// Parse the next cursor from Sentry's Link header
/// Format: `<url>; rel="next"; results="true"; cursor="value"`
fn parse_next_cursor(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let link = headers.get("link")?.to_str().ok()?;

    // Find the "next" relation
    for part in link.split(',') {
        if part.contains("rel=\"next\"") && part.contains("results=\"true\"") {
            // Extract cursor value
            if let Some(cursor_start) = part.find("cursor=\"") {
                let after = &part[cursor_start + 8..];
                if let Some(cursor_end) = after.find('"') {
                    let cursor = &after[..cursor_end];
                    if !cursor.is_empty() {
                        return Some(cursor.to_string());
                    }
                }
            }
        }
    }

    None
}
