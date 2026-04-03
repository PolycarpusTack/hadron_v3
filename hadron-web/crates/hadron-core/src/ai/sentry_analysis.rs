//! Sentry analysis — types, event normalizer, and output types.
//!
//! Port of desktop's sentry analysis into hadron-core for web parity.

use serde::{Deserialize, Serialize};
use std::fmt;

// ============================================================================
// Input types
// ============================================================================

/// Top-level Sentry issue metadata (from the issues API).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryIssueDetail {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub short_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub culprit: Option<String>,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub count: Option<String>,
    #[serde(default)]
    pub user_count: Option<i64>,
    #[serde(default)]
    pub first_seen: Option<String>,
    #[serde(default)]
    pub last_seen: Option<String>,
    #[serde(default)]
    pub permalink: Option<String>,
}

/// Detailed Sentry event, normalized from raw API JSON.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryEventDetail {
    #[serde(default)]
    pub event_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub breadcrumbs: Vec<SentryBreadcrumb>,
    #[serde(default)]
    pub exceptions: Vec<SentryException>,
    #[serde(default)]
    pub tags: Vec<SentryTag>,
    #[serde(default)]
    pub contexts: serde_json::Value,
}

/// A single breadcrumb entry from the Sentry event.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryBreadcrumb {
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    #[serde(default, rename = "type")]
    pub breadcrumb_type: Option<String>,
}

/// An exception entry from the Sentry event.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryException {
    #[serde(default, rename = "type")]
    pub exception_type: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub module: Option<String>,
    #[serde(default)]
    pub stacktrace: Option<Vec<SentryFrame>>,
}

/// A single stack frame from a Sentry exception.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryFrame {
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub function: Option<String>,
    #[serde(default)]
    pub line_no: Option<i64>,
    #[serde(default)]
    pub col_no: Option<i64>,
    #[serde(default)]
    pub context_line: Option<String>,
    #[serde(default)]
    pub pre_context: Option<Vec<String>>,
    #[serde(default)]
    pub post_context: Option<Vec<String>>,
    #[serde(default)]
    pub in_app: Option<bool>,
    #[serde(default)]
    pub module: Option<String>,
}

/// A key-value tag attached to a Sentry event.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SentryTag {
    pub key: String,
    pub value: String,
}

// ============================================================================
// Output types
// ============================================================================

/// AI analysis result for a Sentry issue/event.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryAnalysisResult {
    #[serde(default)]
    pub error_type: String,
    #[serde(default)]
    pub error_message: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub root_cause: String,
    #[serde(default)]
    pub suggested_fixes: Vec<String>,
    #[serde(default)]
    pub component: String,
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub pattern_type: String,
    #[serde(default)]
    pub user_impact: String,
    #[serde(default)]
    pub breadcrumb_analysis: String,
    #[serde(default)]
    pub recommendations: Vec<SentryRecommendation>,
}

/// A concrete recommendation produced by the analysis.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SentryRecommendation {
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub code_snippet: Option<String>,
}

// ============================================================================
// Pattern detection types
// ============================================================================

/// A detected error pattern with evidence.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPattern {
    pub pattern_type: PatternType,
    pub confidence: f32,
    pub evidence: Vec<String>,
}

/// Known error pattern categories.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PatternType {
    #[default]
    Deadlock,
    NPlusOne,
    MemoryLeak,
    UnhandledPromise,
    RaceCondition,
    ConnectionExhaustion,
    TimeoutCascade,
    AuthFailure,
    ConstraintViolation,
    ResourceExhaustion,
    StackOverflow,
}

impl fmt::Display for PatternType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            PatternType::Deadlock => "Deadlock",
            PatternType::NPlusOne => "N+1 Query",
            PatternType::MemoryLeak => "Memory Leak",
            PatternType::UnhandledPromise => "Unhandled Promise",
            PatternType::RaceCondition => "Race Condition",
            PatternType::ConnectionExhaustion => "Connection Exhaustion",
            PatternType::TimeoutCascade => "Timeout Cascade",
            PatternType::AuthFailure => "Auth Failure",
            PatternType::ConstraintViolation => "Constraint Violation",
            PatternType::ResourceExhaustion => "Resource Exhaustion",
            PatternType::StackOverflow => "Stack Overflow",
        };
        write!(f, "{}", name)
    }
}

// ============================================================================
// Event normalizer
// ============================================================================

/// Normalize a raw Sentry event JSON value into a structured `SentryEventDetail`.
///
/// Handles the Sentry REST API event format where breadcrumbs and exceptions
/// live inside an `entries` array keyed by `type`.
pub fn normalize_sentry_event(raw: &serde_json::Value) -> SentryEventDetail {
    let event_id = raw
        .get("eventID")
        .or_else(|| raw.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let title = raw.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
    let message = raw.get("message").and_then(|v| v.as_str()).map(|s| s.to_string());
    let platform = raw.get("platform").and_then(|v| v.as_str()).map(|s| s.to_string());

    let contexts = raw
        .get("contexts")
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    // Tags: array of objects with "key" and "value"
    let tags = raw
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let key = t.get("key")?.as_str()?.to_string();
                    let value = t.get("value")?.as_str()?.to_string();
                    Some(SentryTag { key, value })
                })
                .collect()
        })
        .unwrap_or_default();

    let mut breadcrumbs: Vec<SentryBreadcrumb> = Vec::new();
    let mut exceptions: Vec<SentryException> = Vec::new();

    if let Some(entries) = raw.get("entries").and_then(|v| v.as_array()) {
        for entry in entries {
            let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let data = entry.get("data");

            match entry_type {
                "breadcrumbs" => {
                    if let Some(values) = data
                        .and_then(|d| d.get("values"))
                        .and_then(|v| v.as_array())
                    {
                        let crumbs: Vec<SentryBreadcrumb> = values
                            .iter()
                            .rev()
                            .take(30)
                            .map(|crumb| SentryBreadcrumb {
                                timestamp: crumb
                                    .get("timestamp")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                category: crumb
                                    .get("category")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                message: crumb
                                    .get("message")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                level: crumb
                                    .get("level")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                data: crumb.get("data").cloned(),
                                breadcrumb_type: crumb
                                    .get("type")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                            })
                            .collect();
                        // Restore chronological order after reversing for take(30)
                        breadcrumbs.extend(crumbs.into_iter().rev());
                    }
                }
                "exception" => {
                    if let Some(values) = data
                        .and_then(|d| d.get("values"))
                        .and_then(|v| v.as_array())
                    {
                        let excs: Vec<SentryException> = values
                            .iter()
                            .rev()
                            .take(30)
                            .map(|exc| {
                                let frames = exc
                                    .get("stacktrace")
                                    .and_then(|st| st.get("frames"))
                                    .and_then(|v| v.as_array())
                                    .map(|frames_arr| {
                                        frames_arr
                                            .iter()
                                            .rev()
                                            .take(30)
                                            .map(|fr| SentryFrame {
                                                filename: fr
                                                    .get("filename")
                                                    .and_then(|v| v.as_str())
                                                    .map(|s| s.to_string()),
                                                function: fr
                                                    .get("function")
                                                    .and_then(|v| v.as_str())
                                                    .map(|s| s.to_string()),
                                                line_no: fr
                                                    .get("lineNo")
                                                    .and_then(|v| v.as_i64()),
                                                col_no: fr
                                                    .get("colNo")
                                                    .and_then(|v| v.as_i64()),
                                                context_line: fr
                                                    .get("context")
                                                    .and_then(|v| v.as_str())
                                                    .map(|s| s.to_string()),
                                                pre_context: fr
                                                    .get("preContext")
                                                    .and_then(|v| v.as_array())
                                                    .map(|a| {
                                                        a.iter()
                                                            .filter_map(|x| x.as_str())
                                                            .map(|s| s.to_string())
                                                            .collect()
                                                    }),
                                                post_context: fr
                                                    .get("postContext")
                                                    .and_then(|v| v.as_array())
                                                    .map(|a| {
                                                        a.iter()
                                                            .filter_map(|x| x.as_str())
                                                            .map(|s| s.to_string())
                                                            .collect()
                                                    }),
                                                in_app: fr
                                                    .get("inApp")
                                                    .and_then(|v| v.as_bool()),
                                                module: fr
                                                    .get("module")
                                                    .and_then(|v| v.as_str())
                                                    .map(|s| s.to_string()),
                                            })
                                            .collect::<Vec<_>>()
                                            .into_iter()
                                            .rev()
                                            .collect()
                                    });

                                SentryException {
                                    exception_type: exc
                                        .get("type")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    value: exc
                                        .get("value")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    module: exc
                                        .get("module")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    stacktrace: frames,
                                }
                            })
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect();
                        exceptions.extend(excs);
                    }
                }
                _ => {}
            }
        }
    }

    SentryEventDetail {
        event_id,
        title,
        message,
        platform,
        breadcrumbs,
        exceptions,
        tags,
        contexts,
    }
}

// ============================================================================
// Pattern Detection
// ============================================================================

/// Collect all searchable text from an issue + event into a single lowercased string.
fn collect_searchable_text(issue: &SentryIssueDetail, event: &SentryEventDetail) -> String {
    let mut parts: Vec<String> = Vec::new();

    parts.push(issue.title.to_lowercase());

    if let Some(culprit) = &issue.culprit {
        parts.push(culprit.to_lowercase());
    }

    if let Some(title) = &event.title {
        parts.push(title.to_lowercase());
    }
    if let Some(message) = &event.message {
        parts.push(message.to_lowercase());
    }

    for exc in &event.exceptions {
        if let Some(t) = &exc.exception_type {
            parts.push(t.to_lowercase());
        }
        if let Some(v) = &exc.value {
            parts.push(v.to_lowercase());
        }
    }

    for tag in &event.tags {
        parts.push(format!("{}={}", tag.key.to_lowercase(), tag.value.to_lowercase()));
    }

    parts.join(" ")
}

/// Return keyword matches as evidence strings.
fn find_keyword_matches(text: &str, keywords: &[&str]) -> Vec<String> {
    keywords
        .iter()
        .filter(|kw| text.contains(*kw))
        .map(|kw| format!("Keyword match: \"{}\"", kw))
        .collect()
}

/// Replace consecutive digit sequences with `?` to group similar queries.
fn normalize_query(query: &str) -> String {
    let mut result = String::with_capacity(query.len());
    let mut in_digits = false;
    for ch in query.chars() {
        if ch.is_ascii_digit() {
            if !in_digits {
                result.push('?');
                in_digits = true;
            }
        } else {
            in_digits = false;
            result.push(ch);
        }
    }
    result
}

/// Truncate a string to at most `max` bytes (byte-boundary safe for ASCII).
fn truncate_str(s: &str, max: usize) -> &str {
    if s.len() > max {
        &s[..max]
    } else {
        s
    }
}

// ── Individual detectors ────────────────────────────────────────────────────

fn detect_deadlock(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &["deadlock", "lock timeout", "lock wait timeout", "40p01"];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    let confidence = if evidence.len() >= 2 { 0.9 } else { 0.7 };
    Some(DetectedPattern {
        pattern_type: PatternType::Deadlock,
        confidence,
        evidence,
    })
}

fn detect_n_plus_one(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let kw_evidence = find_keyword_matches(&text, &["n+1", "n + 1"]);

    // Count repeated normalized DB/HTTP breadcrumb messages
    let mut query_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    for crumb in &event.breadcrumbs {
        let cat = crumb.category.as_deref().unwrap_or("").to_lowercase();
        if cat.contains("query") || cat.contains("db") || cat.contains("sql") || cat.contains("http") {
            if let Some(msg) = &crumb.message {
                let normalized = normalize_query(&msg.to_lowercase());
                let key = truncate_str(&normalized, 120).to_string();
                *query_counts.entry(key).or_insert(0) += 1;
            }
        }
    }
    let repeated_max = query_counts.values().copied().max().unwrap_or(0);

    if kw_evidence.is_empty() && repeated_max < 3 {
        return None;
    }

    let mut evidence = kw_evidence;
    if repeated_max >= 3 {
        evidence.push(format!("Repeated query pattern detected ({} times)", repeated_max));
        return Some(DetectedPattern {
            pattern_type: PatternType::NPlusOne,
            confidence: 0.85,
            evidence,
        });
    }
    Some(DetectedPattern {
        pattern_type: PatternType::NPlusOne,
        confidence: 0.6,
        evidence,
    })
}

fn detect_memory_leak(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "out of memory",
        "outofmemory",
        "oom",
        "heap exhausted",
        "java.lang.outofmemoryerror",
        "allocation failed",
        "memory limit",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    let confidence = if evidence.len() >= 2 { 0.9 } else { 0.75 };
    Some(DetectedPattern {
        pattern_type: PatternType::MemoryLeak,
        confidence,
        evidence,
    })
}

fn detect_unhandled_promise(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let kw_evidence =
        find_keyword_matches(&text, &["unhandledrejection", "unhandled promise", "unhandled rejection"]);

    let has_exception_type = event.exceptions.iter().any(|exc| {
        exc.exception_type
            .as_deref()
            .map(|t| t.to_lowercase().contains("unhandledrejection") || t.to_lowercase().contains("unhandledpromise"))
            .unwrap_or(false)
    });

    if kw_evidence.is_empty() && !has_exception_type {
        return None;
    }

    let mut evidence = kw_evidence;
    if has_exception_type {
        evidence.push("Exception type indicates unhandled promise".to_string());
    }

    let confidence = if evidence.len() >= 2 { 0.9 } else { 0.8 };
    Some(DetectedPattern {
        pattern_type: PatternType::UnhandledPromise,
        confidence,
        evidence,
    })
}

fn detect_race_condition(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "race condition",
        "concurrent modification",
        "concurrentmodificationexception",
        "data race",
        "toctou",
        "time of check",
        "stale data",
        "optimistic lock",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    let confidence = if evidence.len() >= 2 { 0.85 } else { 0.65 };
    Some(DetectedPattern {
        pattern_type: PatternType::RaceCondition,
        confidence,
        evidence,
    })
}

fn detect_connection_exhaustion(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "pool timeout",
        "too many connections",
        "connection limit",
        "emfile",
        "enfile",
        "socket limit",
        "connection pool exhausted",
        "max_connections",
        "connection refused",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    let confidence = if evidence.len() >= 2 { 0.9 } else { 0.7 };
    Some(DetectedPattern {
        pattern_type: PatternType::ConnectionExhaustion,
        confidence,
        evidence,
    })
}

fn detect_timeout_cascade(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let kw_evidence = find_keyword_matches(
        &text,
        &[
            "upstream timeout",
            "gateway timeout",
            "504",
            "request timeout",
            "read timed out",
            "connect timed out",
            "deadline exceeded",
        ],
    );

    // Count timeout-related breadcrumbs
    let timeout_crumbs = event
        .breadcrumbs
        .iter()
        .filter(|crumb| {
            let cat = crumb.category.as_deref().unwrap_or("").to_lowercase();
            let msg = crumb.message.as_deref().unwrap_or("").to_lowercase();
            (cat.contains("http") || cat.contains("query"))
                && (msg.contains("timeout") || msg.contains("timed out"))
        })
        .count();

    if kw_evidence.is_empty() && timeout_crumbs == 0 {
        return None;
    }

    let mut evidence = kw_evidence;
    if timeout_crumbs > 0 {
        evidence.push(format!("{} timeout-related breadcrumb(s) detected", timeout_crumbs));
    }

    let confidence = if timeout_crumbs >= 3 { 0.85 } else { 0.65 };
    Some(DetectedPattern {
        pattern_type: PatternType::TimeoutCascade,
        confidence,
        evidence,
    })
}

fn detect_auth_failure(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let kw_evidence = find_keyword_matches(
        &text,
        &[
            "token expired",
            "jwt expired",
            "unauthorized",
            "forbidden",
            "authentication failed",
            "invalid token",
            "access denied",
            "401",
            "403",
        ],
    );

    // Check HTTP status codes in breadcrumb data
    let has_auth_status = event.breadcrumbs.iter().any(|crumb| {
        if let Some(data) = &crumb.data {
            let status = data
                .get("status_code")
                .or_else(|| data.get("statusCode"))
                .and_then(|v| v.as_i64())
                .or_else(|| {
                    data.get("status_code")
                        .or_else(|| data.get("statusCode"))
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<i64>().ok())
                });
            matches!(status, Some(401) | Some(403))
        } else {
            false
        }
    });

    if kw_evidence.is_empty() && !has_auth_status {
        return None;
    }

    let mut evidence = kw_evidence;
    if has_auth_status {
        evidence.push("HTTP 401/403 status code found in breadcrumbs".to_string());
    }

    let confidence = if evidence.len() >= 2 { 0.9 } else { 0.7 };
    Some(DetectedPattern {
        pattern_type: PatternType::AuthFailure,
        confidence,
        evidence,
    })
}

fn detect_constraint_violation(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "unique constraint",
        "duplicate key",
        "foreign key violation",
        "check constraint",
        "serialization failure",
        "23505",
        "23503",
        "23514",
        "integrityerror",
        "constraintviolation",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    let has_pg_code = evidence.iter().any(|e| {
        e.contains("\"23505\"") || e.contains("\"23503\"")
    });
    let confidence = if has_pg_code { 0.9 } else { 0.75 };
    Some(DetectedPattern {
        pattern_type: PatternType::ConstraintViolation,
        confidence,
        evidence,
    })
}

fn detect_resource_exhaustion(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "disk full",
        "no space left",
        "enospc",
        "file descriptor",
        "emfile",
        "too many open files",
        "cpu quota",
        "resource limit",
        "ulimit",
        "resource temporarily unavailable",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    let confidence = if evidence.len() >= 2 { 0.9 } else { 0.75 };
    Some(DetectedPattern {
        pattern_type: PatternType::ResourceExhaustion,
        confidence,
        evidence,
    })
}

fn detect_stack_overflow(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "stack overflow",
        "maximum call stack size exceeded",
        "stackoverflowerror",
        "recursion depth",
        "too much recursion",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    let has_strong = evidence.iter().any(|e| {
        e.contains("\"stackoverflowerror\"") || e.contains("\"maximum call stack size exceeded\"")
    });
    let confidence = if has_strong { 0.95 } else { 0.8 };
    Some(DetectedPattern {
        pattern_type: PatternType::StackOverflow,
        confidence,
        evidence,
    })
}

// ============================================================================
// Prompt, Message Builder, and Parser
// ============================================================================

pub const SENTRY_ANALYSIS_SYSTEM_PROMPT: &str = r#"You are an expert software debugger analyzing a Sentry error event.

OUTPUT FORMAT: Respond ONLY with valid JSON matching this exact schema. No markdown, no prose outside JSON.

{
  "error_type": "The exception class or error category (e.g. TypeError, NullPointerException, DatabaseError)",
  "error_message": "The primary error message text",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "root_cause": "Your best analysis of the root cause based on the stack frames, breadcrumbs, and context",
  "suggested_fixes": ["Concrete fix #1", "Concrete fix #2"],
  "component": "The top-level component or service where the error originates",
  "confidence": "High|Medium|Low",
  "pattern_type": "The dominant error pattern if applicable (e.g. Deadlock, N+1 Query, Memory Leak, Unhandled Promise, Race Condition, etc.) or empty string",
  "user_impact": "Description of how end-users are affected",
  "breadcrumb_analysis": "Summary of what the breadcrumb trail reveals about the sequence of events leading to the error",
  "recommendations": [
    {
      "priority": "Immediate|Short-term|Long-term",
      "title": "Short title for the recommendation",
      "description": "Detailed description of what to do and why",
      "effort": "Low|Medium|High",
      "code_snippet": "Optional illustrative code fix or null"
    }
  ]
}

SEVERITY GUIDE:
- CRITICAL: data loss, security breach, or complete service outage
- HIGH: major feature broken or significant portion of users affected
- MEDIUM: degraded functionality with a workaround available
- LOW: cosmetic issue, rare edge case, or negligible user impact

ANALYSIS GUIDANCE:
- Stack frames tagged [APP] are application code — focus your root cause analysis here.
- Stack frames tagged [LIB] are library/framework code — useful for context but rarely the root cause.
- Read the breadcrumb trail chronologically to reconstruct the sequence of events before the crash.
- Use the event count (Events / Users affected) to calibrate severity: high counts indicate widespread impact.
- Use DETECTED PATTERNS (automated) as hints, but apply your own judgment — they may have false positives.
- If the exception chain has multiple exceptions, the innermost cause is usually the true root cause.

Be direct and specific. Avoid generic advice. Reference actual function names, file paths, and error messages from the provided data."#;

/// Build a structured prompt from the Sentry issue, event, and detected patterns.
pub fn build_sentry_analysis_user_prompt(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
    patterns: &[DetectedPattern],
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // === SENTRY ISSUE ===
    parts.push("=== SENTRY ISSUE ===".to_string());
    parts.push(format!("ID: {}", issue.id));
    parts.push(format!("Short ID: {}", issue.short_id));
    parts.push(format!("Title: {}", issue.title));
    parts.push(format!("Level: {}", issue.level));
    parts.push(format!("Status: {}", issue.status));
    if let Some(platform) = &issue.platform {
        parts.push(format!("Platform: {}", platform));
    }
    if let Some(culprit) = &issue.culprit {
        parts.push(format!("Culprit: {}", culprit));
    }
    if let Some(count) = &issue.count {
        parts.push(format!("Events: {}", count));
    }
    if let Some(user_count) = &issue.user_count {
        parts.push(format!("Users affected: {}", user_count));
    }
    if let Some(first_seen) = &issue.first_seen {
        parts.push(format!("First seen: {}", first_seen));
    }
    if let Some(last_seen) = &issue.last_seen {
        parts.push(format!("Last seen: {}", last_seen));
    }

    // === EXCEPTION CHAIN ===
    if !event.exceptions.is_empty() {
        parts.push(String::new());
        parts.push("=== EXCEPTION CHAIN ===".to_string());
        for (i, exc) in event.exceptions.iter().enumerate() {
            let exc_type = exc.exception_type.as_deref().unwrap_or("(unknown)");
            let exc_value = exc.value.as_deref().unwrap_or("(no message)");
            let exc_module = exc.module.as_deref().unwrap_or("(unknown module)");
            parts.push(format!("[Exception {}] {}: {} (module: {})", i + 1, exc_type, exc_value, exc_module));

            if let Some(frames) = &exc.stacktrace {
                // Show frames in reverse (innermost first)
                for frame in frames.iter().rev() {
                    let tag = if frame.in_app.unwrap_or(false) { "[APP]" } else { "[LIB]" };
                    let filename = frame.filename.as_deref().unwrap_or("?");
                    let function = frame.function.as_deref().unwrap_or("?");
                    let line = frame.line_no.map(|n| n.to_string()).unwrap_or_else(|| "?".to_string());
                    parts.push(format!("  {} {}:{} in {}", tag, filename, line, function));
                    if let Some(ctx) = &frame.context_line {
                        parts.push(format!("    > {}", ctx.trim()));
                    }
                }
            }
        }
    }

    // === BREADCRUMBS (chronological) ===
    if !event.breadcrumbs.is_empty() {
        parts.push(String::new());
        parts.push("=== BREADCRUMBS (chronological) ===".to_string());
        for crumb in &event.breadcrumbs {
            let ts = crumb.timestamp.as_deref().unwrap_or("?");
            let cat = crumb.category.as_deref().unwrap_or("?");
            let lvl = crumb.level.as_deref().unwrap_or("info");
            let msg = crumb.message.as_deref().unwrap_or("(no message)");
            parts.push(format!("[{}] [{}] [{}] {}", ts, cat, lvl, msg));
        }
    }

    // === TAGS ===
    let user_tags: Vec<&SentryTag> = event
        .tags
        .iter()
        .filter(|t| !t.key.starts_with("sentry:"))
        .collect();
    if !user_tags.is_empty() {
        parts.push(String::new());
        parts.push("=== TAGS ===".to_string());
        for tag in user_tags {
            parts.push(format!("{}: {}", tag.key, tag.value));
        }
    }

    // === RUNTIME CONTEXT ===
    if event.contexts.is_object() {
        if let Some(obj) = event.contexts.as_object() {
            if !obj.is_empty() {
                parts.push(String::new());
                parts.push("=== RUNTIME CONTEXT ===".to_string());
                for (section_name, section_val) in obj {
                    parts.push(format!("[{}]", section_name));
                    if let Some(section_obj) = section_val.as_object() {
                        for (k, v) in section_obj.iter().take(5) {
                            let val_str = match v {
                                serde_json::Value::String(s) => s.clone(),
                                other => other.to_string(),
                            };
                            parts.push(format!("  {}: {}", k, val_str));
                        }
                    }
                }
            }
        }
    }

    // === DETECTED PATTERNS (automated) ===
    if !patterns.is_empty() {
        parts.push(String::new());
        parts.push("=== DETECTED PATTERNS (automated) ===".to_string());
        for p in patterns {
            let confidence_pct = (p.confidence * 100.0).round() as u32;
            parts.push(format!("Pattern: {} ({}% confidence)", p.pattern_type, confidence_pct));
            for ev in &p.evidence {
                parts.push(format!("  Evidence: {}", ev));
            }
        }
    }

    parts.join("\n")
}

/// Build the system prompt + messages for an AI call.
pub fn build_sentry_analysis_messages(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
    patterns: &[DetectedPattern],
) -> (String, Vec<super::types::AiMessage>) {
    let system = SENTRY_ANALYSIS_SYSTEM_PROMPT.to_string();
    let user_content = build_sentry_analysis_user_prompt(issue, event, patterns);
    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_content,
    }];
    (system, messages)
}

/// Parse AI response into SentryAnalysisResult.
pub fn parse_sentry_analysis(raw: &str) -> crate::error::HadronResult<SentryAnalysisResult> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let preview = &json_str[..json_str.len().min(300)];
        crate::error::HadronError::Parse(format!(
            "Failed to parse Sentry analysis: {e}. Preview: {preview}"
        ))
    })
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/// Run all 11 pattern detectors and return matches sorted by confidence (desc).
pub fn detect_sentry_patterns(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Vec<DetectedPattern> {
    let detectors: &[fn(&SentryIssueDetail, &SentryEventDetail) -> Option<DetectedPattern>] = &[
        detect_deadlock,
        detect_n_plus_one,
        detect_memory_leak,
        detect_unhandled_promise,
        detect_race_condition,
        detect_connection_exhaustion,
        detect_timeout_cascade,
        detect_auth_failure,
        detect_constraint_violation,
        detect_resource_exhaustion,
        detect_stack_overflow,
    ];

    let mut patterns: Vec<DetectedPattern> = detectors
        .iter()
        .filter_map(|detector| detector(issue, event))
        .collect();

    patterns.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    patterns
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_event() -> serde_json::Value {
        serde_json::json!({
            "eventID": "abc123",
            "title": "TypeError: Cannot read property 'foo' of null",
            "platform": "javascript",
            "tags": [
                {"key": "browser", "value": "Chrome 120"},
                {"key": "os", "value": "Windows 10"}
            ],
            "contexts": {
                "browser": {"name": "Chrome", "version": "120"},
                "os": {"name": "Windows", "version": "10"}
            },
            "entries": [
                {
                    "type": "breadcrumbs",
                    "data": {
                        "values": [
                            {"timestamp": "2026-01-01T00:00:00Z", "category": "http", "message": "GET /api/users", "level": "info"},
                            {"timestamp": "2026-01-01T00:00:01Z", "category": "ui.click", "message": "button#submit", "level": "info"}
                        ]
                    }
                },
                {
                    "type": "exception",
                    "data": {
                        "values": [
                            {
                                "type": "TypeError",
                                "value": "Cannot read property 'foo' of null",
                                "module": "app.components.UserPanel",
                                "stacktrace": {
                                    "frames": [
                                        {"filename": "app.js", "function": "renderUser", "lineNo": 42, "inApp": true},
                                        {"filename": "react-dom.js", "function": "commitWork", "lineNo": 100, "inApp": false}
                                    ]
                                }
                            }
                        ]
                    }
                }
            ]
        })
    }

    #[test]
    fn test_normalize_sentry_event_breadcrumbs() {
        let event = normalize_sentry_event(&sample_event());
        assert_eq!(event.breadcrumbs.len(), 2);
        assert_eq!(event.breadcrumbs[0].category.as_deref(), Some("http"));
        assert_eq!(event.breadcrumbs[0].message.as_deref(), Some("GET /api/users"));
        assert_eq!(event.breadcrumbs[1].category.as_deref(), Some("ui.click"));
        assert_eq!(event.breadcrumbs[1].message.as_deref(), Some("button#submit"));
    }

    #[test]
    fn test_normalize_sentry_event_exceptions() {
        let event = normalize_sentry_event(&sample_event());
        assert_eq!(event.exceptions.len(), 1);
        let exc = &event.exceptions[0];
        assert_eq!(exc.exception_type.as_deref(), Some("TypeError"));
        assert_eq!(exc.value.as_deref(), Some("Cannot read property 'foo' of null"));
        assert_eq!(exc.module.as_deref(), Some("app.components.UserPanel"));
        let frames = exc.stacktrace.as_ref().expect("stacktrace present");
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].filename.as_deref(), Some("app.js"));
        assert_eq!(frames[0].function.as_deref(), Some("renderUser"));
        assert_eq!(frames[0].line_no, Some(42));
        assert_eq!(frames[0].in_app, Some(true));
        assert_eq!(frames[1].in_app, Some(false));
    }

    #[test]
    fn test_normalize_sentry_event_tags() {
        let event = normalize_sentry_event(&sample_event());
        assert_eq!(event.tags.len(), 2);
        assert_eq!(event.tags[0].key, "browser");
        assert_eq!(event.tags[0].value, "Chrome 120");
        assert_eq!(event.tags[1].key, "os");
        assert_eq!(event.tags[1].value, "Windows 10");
    }

    #[test]
    fn test_normalize_sentry_event_metadata() {
        let event = normalize_sentry_event(&sample_event());
        assert_eq!(event.event_id.as_deref(), Some("abc123"));
        assert_eq!(event.platform.as_deref(), Some("javascript"));
        assert_eq!(
            event.title.as_deref(),
            Some("TypeError: Cannot read property 'foo' of null")
        );
        assert!(event.contexts.get("browser").is_some());
        assert!(event.contexts.get("os").is_some());
    }

    #[test]
    fn test_normalize_empty_event() {
        let event = normalize_sentry_event(&serde_json::json!({}));
        assert!(event.event_id.is_none());
        assert!(event.title.is_none());
        assert!(event.platform.is_none());
        assert!(event.breadcrumbs.is_empty());
        assert!(event.exceptions.is_empty());
        assert!(event.tags.is_empty());
        assert!(event.contexts.is_null());
    }

    #[test]
    fn test_pattern_type_display() {
        assert_eq!(PatternType::Deadlock.to_string(), "Deadlock");
        assert_eq!(PatternType::NPlusOne.to_string(), "N+1 Query");
        assert_eq!(PatternType::MemoryLeak.to_string(), "Memory Leak");
        assert_eq!(PatternType::UnhandledPromise.to_string(), "Unhandled Promise");
        assert_eq!(PatternType::RaceCondition.to_string(), "Race Condition");
        assert_eq!(PatternType::ConnectionExhaustion.to_string(), "Connection Exhaustion");
        assert_eq!(PatternType::TimeoutCascade.to_string(), "Timeout Cascade");
        assert_eq!(PatternType::AuthFailure.to_string(), "Auth Failure");
        assert_eq!(PatternType::ConstraintViolation.to_string(), "Constraint Violation");
        assert_eq!(PatternType::ResourceExhaustion.to_string(), "Resource Exhaustion");
        assert_eq!(PatternType::StackOverflow.to_string(), "Stack Overflow");
    }

    // ── Pattern detection test helpers ────────────────────────────────────────

    fn make_issue(title: &str) -> SentryIssueDetail {
        SentryIssueDetail {
            title: title.to_string(),
            ..Default::default()
        }
    }

    fn make_event_with_exception(exc_type: &str, exc_value: &str) -> SentryEventDetail {
        SentryEventDetail {
            exceptions: vec![SentryException {
                exception_type: Some(exc_type.to_string()),
                value: Some(exc_value.to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn make_event_with_breadcrumbs(crumbs: Vec<(&str, &str)>) -> SentryEventDetail {
        SentryEventDetail {
            breadcrumbs: crumbs
                .into_iter()
                .map(|(category, message)| SentryBreadcrumb {
                    category: Some(category.to_string()),
                    message: Some(message.to_string()),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    // ── Pattern detector tests ────────────────────────────────────────────────

    #[test]
    fn test_detect_deadlock() {
        let issue = make_issue("Transaction deadlock detected");
        let event = make_event_with_exception("DatabaseError", "lock wait timeout exceeded");
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::Deadlock));
        let p = patterns.iter().find(|p| p.pattern_type == PatternType::Deadlock).unwrap();
        // 2 matches (title + exception) → confidence 0.9
        assert_eq!(p.confidence, 0.9);
    }

    #[test]
    fn test_detect_n_plus_one_keyword() {
        let issue = make_issue("N+1 query detected in UserLoader");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::NPlusOne));
    }

    #[test]
    fn test_detect_n_plus_one_repeated_queries() {
        let issue = make_issue("Slow response in UserService");
        let event = make_event_with_breadcrumbs(vec![
            ("query", "SELECT * FROM users WHERE id = 1"),
            ("query", "SELECT * FROM users WHERE id = 2"),
            ("query", "SELECT * FROM users WHERE id = 3"),
        ]);
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::NPlusOne));
        let p = patterns.iter().find(|p| p.pattern_type == PatternType::NPlusOne).unwrap();
        assert_eq!(p.confidence, 0.85);
    }

    #[test]
    fn test_detect_memory_leak() {
        let issue = make_issue("java.lang.OutOfMemoryError: heap space");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::MemoryLeak));
    }

    #[test]
    fn test_detect_unhandled_promise() {
        let issue = make_issue("Unhandled rejection");
        let event = make_event_with_exception("UnhandledRejection", "Promise rejected with no handler");
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::UnhandledPromise));
    }

    #[test]
    fn test_detect_race_condition() {
        let issue = make_issue("ConcurrentModificationException in HashMap");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::RaceCondition));
    }

    #[test]
    fn test_detect_connection_exhaustion() {
        let issue = make_issue("Connection pool exhausted - too many connections");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::ConnectionExhaustion));
        let p = patterns.iter().find(|p| p.pattern_type == PatternType::ConnectionExhaustion).unwrap();
        // "connection pool exhausted" + "too many connections" → 2 matches → 0.9
        assert_eq!(p.confidence, 0.9);
    }

    #[test]
    fn test_detect_timeout_cascade() {
        let issue = make_issue("Gateway timeout on upstream service");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::TimeoutCascade));
    }

    #[test]
    fn test_detect_auth_failure() {
        let issue = make_issue("Token expired for user session");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::AuthFailure));
    }

    #[test]
    fn test_detect_constraint_violation() {
        let issue = make_issue("IntegrityError: duplicate key value violates unique constraint");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::ConstraintViolation));
    }

    #[test]
    fn test_detect_resource_exhaustion() {
        let issue = make_issue("ENOSPC: no space left on device");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::ResourceExhaustion));
    }

    #[test]
    fn test_detect_stack_overflow() {
        let issue = make_issue("Maximum call stack size exceeded");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::StackOverflow));
        let p = patterns.iter().find(|p| p.pattern_type == PatternType::StackOverflow).unwrap();
        assert_eq!(p.confidence, 0.95);
    }

    #[test]
    fn test_no_false_positive_patterns() {
        let issue = make_issue("User successfully updated their profile");
        let event = make_event_with_exception("InfoEvent", "Profile update completed normally");
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.is_empty(), "Expected no patterns, got: {:?}", patterns);
    }

    #[test]
    fn test_patterns_sorted_by_confidence() {
        // Trigger stack overflow (0.95) + deadlock (0.7) + memory leak (0.75)
        let issue = make_issue("Maximum call stack size exceeded");
        let event = make_event_with_exception(
            "OutOfMemoryError",
            "deadlock detected while allocation failed",
        );
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.len() >= 2, "Expected at least 2 patterns");
        for window in patterns.windows(2) {
            assert!(
                window[0].confidence >= window[1].confidence,
                "Patterns not sorted: {} before {}",
                window[0].confidence,
                window[1].confidence
            );
        }
    }

    // ── Prompt / message builder / parser tests ────────────────────────────

    fn make_issue_detail(id: &str, short_id: &str, title: &str) -> SentryIssueDetail {
        SentryIssueDetail {
            id: id.to_string(),
            short_id: short_id.to_string(),
            title: title.to_string(),
            level: "error".to_string(),
            status: "unresolved".to_string(),
            count: Some("150".to_string()),
            user_count: Some(23),
            ..Default::default()
        }
    }

    fn make_event_with_breadcrumb_and_exception(
        crumb_category: &str,
        crumb_message: &str,
        exc_type: &str,
        exc_value: &str,
    ) -> SentryEventDetail {
        SentryEventDetail {
            breadcrumbs: vec![SentryBreadcrumb {
                timestamp: Some("2026-04-03T10:00:00Z".to_string()),
                category: Some(crumb_category.to_string()),
                message: Some(crumb_message.to_string()),
                level: Some("info".to_string()),
                ..Default::default()
            }],
            exceptions: vec![SentryException {
                exception_type: Some(exc_type.to_string()),
                value: Some(exc_value.to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn test_build_sentry_analysis_prompt() {
        let issue = make_issue_detail("12345", "PROJ-42", "TypeError: undefined is not a function");
        let event = make_event_with_breadcrumb_and_exception(
            "http",
            "GET /api/data",
            "TypeError",
            "undefined is not a function",
        );
        let prompt = build_sentry_analysis_user_prompt(&issue, &event, &[]);
        assert!(prompt.contains("PROJ-42"), "Should contain short_id");
        assert!(prompt.contains("TypeError"), "Should contain exception type");
        assert!(prompt.contains("GET /api/data"), "Should contain breadcrumb message");
        assert!(prompt.contains("Events: 150"), "Should contain event count");
        assert!(prompt.contains("Users affected: 23"), "Should contain user count");
    }

    #[test]
    fn test_build_sentry_analysis_messages() {
        let issue = SentryIssueDetail {
            id: "1".to_string(),
            short_id: "T-1".to_string(),
            title: "Simple error".to_string(),
            ..Default::default()
        };
        let event = SentryEventDetail::default();
        let (system, messages) = build_sentry_analysis_messages(&issue, &event, &[]);
        assert!(
            system.contains("expert software debugger"),
            "System prompt should identify the role"
        );
        assert_eq!(messages.len(), 1, "Should produce exactly one user message");
        assert_eq!(messages[0].role, "user");
    }

    #[test]
    fn test_parse_sentry_analysis_result() {
        let input = r#"{
            "errorType": "NullPointerException",
            "errorMessage": "Cannot access field on null object",
            "severity": "HIGH",
            "rootCause": "Uninitialized user object passed to render method",
            "suggestedFixes": ["Add null check before access", "Use Optional wrapper"],
            "component": "UserDashboard",
            "confidence": "High",
            "patternType": "",
            "userImpact": "Dashboard fails to load for logged-in users",
            "breadcrumbAnalysis": "User navigated to /dashboard, API call succeeded, then render crashed",
            "recommendations": [
                {
                    "priority": "Immediate",
                    "title": "Add null guard",
                    "description": "Check user != null before calling render",
                    "effort": "Low",
                    "codeSnippet": "if (user == null) return;"
                },
                {
                    "priority": "Short-term",
                    "title": "Improve API contract",
                    "description": "Ensure API never returns null user on success",
                    "effort": "Medium",
                    "codeSnippet": null
                }
            ]
        }"#;
        let result = parse_sentry_analysis(input).unwrap();
        assert_eq!(result.error_type, "NullPointerException");
        assert_eq!(result.severity, "HIGH");
        assert_eq!(result.suggested_fixes.len(), 2);
        assert_eq!(result.recommendations.len(), 2);
        assert_eq!(result.recommendations[0].effort, "Low");
    }

    #[test]
    fn test_parse_sentry_analysis_defaults() {
        let input = r#"{"errorType": "Error"}"#;
        let result = parse_sentry_analysis(input).unwrap();
        assert_eq!(result.error_type, "Error");
        assert!(result.root_cause.is_empty(), "root_cause should default to empty");
        assert!(result.suggested_fixes.is_empty(), "suggested_fixes should default to empty");
        assert!(result.recommendations.is_empty(), "recommendations should default to empty");
    }

    #[test]
    fn test_parse_sentry_analysis_with_markdown_fences() {
        let raw = "```json\n{\"errorType\": \"ValueError\"}\n```";
        let result = parse_sentry_analysis(raw).unwrap();
        assert_eq!(result.error_type, "ValueError");
    }

    #[test]
    fn test_prompt_includes_patterns() {
        let issue = make_issue_detail("99", "DB-1", "deadlock in database");
        let event = SentryEventDetail::default();
        let patterns = vec![DetectedPattern {
            pattern_type: PatternType::Deadlock,
            confidence: 0.9,
            evidence: vec!["Keyword match: \"deadlock\"".to_string()],
        }];
        let prompt = build_sentry_analysis_user_prompt(&issue, &event, &patterns);
        assert!(prompt.contains("DETECTED PATTERNS"), "Should include patterns section header");
        assert!(prompt.contains("Deadlock"), "Should include pattern name");
        assert!(prompt.contains("90%"), "Should include confidence percentage");
    }
}
