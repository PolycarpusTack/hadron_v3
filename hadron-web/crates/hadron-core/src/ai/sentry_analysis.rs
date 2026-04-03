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
}
