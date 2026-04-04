# Web-Desktop Parity Phase 3: Sentry Deep Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port desktop Sentry deep analysis to the web with 11 pattern detectors (7 new), a Recommendations tab, and SSE streaming.

**Architecture:** hadron-core gets a new `ai/sentry_analysis.rs` module (types, pattern detectors, prompts, parser). hadron-server gets `routes/sentry_analysis.rs` (streaming + CRUD routes) and admin Sentry config. Frontend gets a full component suite under `components/sentry/` with 7-tab detail view.

**Tech Stack:** Rust (hadron-core, Axum), React 18, TypeScript, SSE streaming, PostgreSQL (existing `analyses` table)

**Spec:** `docs/plans/2026-04-03-web-parity-phase3-design.md`

---

## File Map

### hadron-core (create)
- `hadron-web/crates/hadron-core/src/ai/sentry_analysis.rs` — Input/output types, 11 pattern detectors, system prompt, message builder, parser, event normalizer, tests

### hadron-server (create)
- `hadron-web/crates/hadron-server/src/routes/sentry_analysis.rs` — Streaming + non-streaming analyze routes, CRUD for saved analyses

### hadron-server (modify)
- `hadron-web/crates/hadron-core/src/ai/mod.rs` — Add `pub mod sentry_analysis` + re-export
- `hadron-web/crates/hadron-server/src/routes/mod.rs` — Add `mod sentry_analysis` + register routes
- `hadron-web/crates/hadron-server/src/routes/admin.rs` — Add Sentry config get/update handlers
- `hadron-web/crates/hadron-server/src/routes/integrations.rs` — Refactor Sentry browse routes to use server config
- `hadron-web/crates/hadron-server/src/db/mod.rs` — Add `insert_sentry_analysis`, `get_sentry_analyses`, `get_sentry_config` helpers

### Frontend (create)
- `hadron-web/frontend/src/components/sentry/SentryAnalyzerView.tsx` — Main orchestrator (replaces SentryPanel)
- `hadron-web/frontend/src/components/sentry/SentryIssueBrowser.tsx` — Project/issue listing
- `hadron-web/frontend/src/components/sentry/SentryIssueRow.tsx` — Expandable issue card
- `hadron-web/frontend/src/components/sentry/SentryQuickImport.tsx` — URL/ID import
- `hadron-web/frontend/src/components/sentry/SentryAnalysisHistory.tsx` — Past analyses
- `hadron-web/frontend/src/components/sentry/SentryDetailView.tsx` — 7-tab analysis report
- `hadron-web/frontend/src/components/sentry/SentryPatternCard.tsx` — Pattern display
- `hadron-web/frontend/src/components/sentry/SentryBreadcrumbTimeline.tsx` — Timeline
- `hadron-web/frontend/src/components/sentry/SentryExceptionChain.tsx` — Stack trace
- `hadron-web/frontend/src/components/sentry/SentryRuntimeContext.tsx` — Context grid
- `hadron-web/frontend/src/components/sentry/SentryUserImpact.tsx` — Impact stats
- `hadron-web/frontend/src/components/sentry/SentryRecommendations.tsx` — Prioritized fixes
- `hadron-web/frontend/src/components/sentry/sentryHelpers.ts` — Formatting utilities
- `hadron-web/frontend/src/components/admin/SentryConfigPanel.tsx` — Admin config UI

### Frontend (modify)
- `hadron-web/frontend/src/components/sentry/SentryPanel.tsx` — Replace with SentryAnalyzerView (or delete)
- `hadron-web/frontend/src/App.tsx` — Update Sentry view import
- `hadron-web/frontend/src/components/admin/AdminPanel.tsx` — Add "sentry" tab
- `hadron-web/frontend/src/services/api.ts` — Add Sentry analysis + admin config API methods

---

## Task 1: hadron-core — Sentry Analysis Types & Event Normalizer

**Files:**
- Create: `hadron-web/crates/hadron-core/src/ai/sentry_analysis.rs`
- Modify: `hadron-web/crates/hadron-core/src/ai/mod.rs`

This task creates the input/output types, the `PatternType` enum, and the event normalizer. Pattern detectors, prompts, and parser come in later tasks.

- [ ] **Step 1: Create sentry_analysis.rs with input types**

```rust
// hadron-web/crates/hadron-core/src/ai/sentry_analysis.rs

use serde::{Deserialize, Serialize};

// ── Input Types ──────────────────────────────────────────────────────────

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SentryTag {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
}

// ── Output Types ─────────────────────────────────────────────────────────

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

// ── Pattern Detection Types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPattern {
    pub pattern_type: PatternType,
    pub confidence: f32,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PatternType {
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

impl std::fmt::Display for PatternType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Deadlock => write!(f, "Deadlock"),
            Self::NPlusOne => write!(f, "N+1 Query"),
            Self::MemoryLeak => write!(f, "Memory Leak"),
            Self::UnhandledPromise => write!(f, "Unhandled Promise"),
            Self::RaceCondition => write!(f, "Race Condition"),
            Self::ConnectionExhaustion => write!(f, "Connection Exhaustion"),
            Self::TimeoutCascade => write!(f, "Timeout Cascade"),
            Self::AuthFailure => write!(f, "Authentication Failure"),
            Self::ConstraintViolation => write!(f, "Constraint Violation"),
            Self::ResourceExhaustion => write!(f, "Resource Exhaustion"),
            Self::StackOverflow => write!(f, "Stack Overflow"),
        }
    }
}
```

- [ ] **Step 2: Add event normalizer**

Append to `sentry_analysis.rs`:

```rust
// ── Event Normalization ──────────────────────────────────────────────────

/// Extract structured event data from raw Sentry event JSON.
///
/// Sentry events store breadcrumbs and exceptions inside an `entries` array
/// where each entry has a `type` field ("breadcrumbs" or "exception").
pub fn normalize_sentry_event(raw: &serde_json::Value) -> SentryEventDetail {
    let mut detail = SentryEventDetail {
        event_id: raw.get("eventID").or_else(|| raw.get("id"))
            .and_then(|v| v.as_str()).map(String::from),
        title: raw.get("title").and_then(|v| v.as_str()).map(String::from),
        message: raw.get("message").and_then(|v| v.as_str()).map(String::from),
        platform: raw.get("platform").and_then(|v| v.as_str()).map(String::from),
        contexts: raw.get("contexts").cloned().unwrap_or(serde_json::Value::Null),
        ..Default::default()
    };

    // Extract tags
    if let Some(tags_arr) = raw.get("tags").and_then(|v| v.as_array()) {
        for tag in tags_arr {
            if let (Some(key), Some(value)) = (
                tag.get("key").and_then(|v| v.as_str()),
                tag.get("value").and_then(|v| v.as_str()),
            ) {
                detail.tags.push(SentryTag {
                    key: key.to_string(),
                    value: value.to_string(),
                });
            }
        }
    }

    // Extract from entries array
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
                        // Take last 30 breadcrumbs
                        let start = values.len().saturating_sub(30);
                        for bc in &values[start..] {
                            detail.breadcrumbs.push(SentryBreadcrumb {
                                timestamp: bc.get("timestamp")
                                    .and_then(|v| v.as_str()).map(String::from),
                                category: bc.get("category")
                                    .and_then(|v| v.as_str()).map(String::from),
                                message: bc.get("message")
                                    .and_then(|v| v.as_str()).map(String::from),
                                level: bc.get("level")
                                    .and_then(|v| v.as_str()).map(String::from),
                                data: bc.get("data").cloned(),
                                breadcrumb_type: bc.get("type")
                                    .and_then(|v| v.as_str()).map(String::from),
                            });
                        }
                    }
                }
                "exception" => {
                    if let Some(values) = data
                        .and_then(|d| d.get("values"))
                        .and_then(|v| v.as_array())
                    {
                        for exc in values {
                            let frames = exc
                                .get("stacktrace")
                                .and_then(|st| st.get("frames"))
                                .and_then(|f| f.as_array())
                                .map(|frames_arr| {
                                    // Take last 30 frames
                                    let start = frames_arr.len().saturating_sub(30);
                                    frames_arr[start..]
                                        .iter()
                                        .map(|frame| SentryFrame {
                                            filename: frame.get("filename")
                                                .and_then(|v| v.as_str()).map(String::from),
                                            function: frame.get("function")
                                                .and_then(|v| v.as_str()).map(String::from),
                                            line_no: frame.get("lineNo")
                                                .and_then(|v| v.as_i64()),
                                            col_no: frame.get("colNo")
                                                .and_then(|v| v.as_i64()),
                                            context_line: frame.get("context")
                                                .and_then(|v| v.as_str()).map(String::from),
                                            pre_context: frame.get("preContext")
                                                .and_then(|v| v.as_array())
                                                .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()),
                                            post_context: frame.get("postContext")
                                                .and_then(|v| v.as_array())
                                                .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()),
                                            in_app: frame.get("inApp")
                                                .and_then(|v| v.as_bool()),
                                            module: frame.get("module")
                                                .and_then(|v| v.as_str()).map(String::from),
                                        })
                                        .collect::<Vec<_>>()
                                });

                            detail.exceptions.push(SentryException {
                                exception_type: exc.get("type")
                                    .and_then(|v| v.as_str()).map(String::from),
                                value: exc.get("value")
                                    .and_then(|v| v.as_str()).map(String::from),
                                module: exc.get("module")
                                    .and_then(|v| v.as_str()).map(String::from),
                                stacktrace: frames,
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }

    detail
}
```

- [ ] **Step 3: Register module in ai/mod.rs**

In `hadron-web/crates/hadron-core/src/ai/mod.rs`, add after `pub mod jira_brief;`:

```rust
pub mod sentry_analysis;
```

And add re-export:

```rust
pub use sentry_analysis::*;
```

- [ ] **Step 4: Add normalizer tests**

Append to `sentry_analysis.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn sample_raw_event() -> serde_json::Value {
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
        let raw = sample_raw_event();
        let detail = normalize_sentry_event(&raw);
        assert_eq!(detail.breadcrumbs.len(), 2);
        assert_eq!(detail.breadcrumbs[0].category.as_deref(), Some("http"));
        assert_eq!(detail.breadcrumbs[1].category.as_deref(), Some("ui.click"));
    }

    #[test]
    fn test_normalize_sentry_event_exceptions() {
        let raw = sample_raw_event();
        let detail = normalize_sentry_event(&raw);
        assert_eq!(detail.exceptions.len(), 1);
        assert_eq!(detail.exceptions[0].exception_type.as_deref(), Some("TypeError"));
        let frames = detail.exceptions[0].stacktrace.as_ref().unwrap();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].in_app, Some(true));
        assert_eq!(frames[1].in_app, Some(false));
    }

    #[test]
    fn test_normalize_sentry_event_tags() {
        let raw = sample_raw_event();
        let detail = normalize_sentry_event(&raw);
        assert_eq!(detail.tags.len(), 2);
        assert_eq!(detail.tags[0].key, "browser");
    }

    #[test]
    fn test_normalize_sentry_event_metadata() {
        let raw = sample_raw_event();
        let detail = normalize_sentry_event(&raw);
        assert_eq!(detail.event_id.as_deref(), Some("abc123"));
        assert_eq!(detail.platform.as_deref(), Some("javascript"));
        assert!(detail.contexts.get("browser").is_some());
    }

    #[test]
    fn test_normalize_empty_event() {
        let raw = serde_json::json!({});
        let detail = normalize_sentry_event(&raw);
        assert!(detail.breadcrumbs.is_empty());
        assert!(detail.exceptions.is_empty());
        assert!(detail.tags.is_empty());
        assert!(detail.event_id.is_none());
    }
}
```

- [ ] **Step 5: Verify compilation and run tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- sentry`

Expected: All 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/sentry_analysis.rs hadron-web/crates/hadron-core/src/ai/mod.rs
git commit -m "feat(core): add sentry_analysis types and event normalizer"
```

---

## Task 2: hadron-core — Pattern Detectors

**Files:**
- Modify: `hadron-web/crates/hadron-core/src/ai/sentry_analysis.rs`

Adds all 11 pattern detector functions and the orchestrator.

- [ ] **Step 1: Add helper for searching text across issue and event**

Insert before the `#[cfg(test)]` block in `sentry_analysis.rs`:

```rust
// ── Pattern Detection ────────────────────────────────────────────────────

/// Collect all searchable text from issue + event for keyword matching.
fn collect_searchable_text(issue: &SentryIssueDetail, event: &SentryEventDetail) -> String {
    let mut parts = Vec::new();
    parts.push(issue.title.to_lowercase());
    if let Some(ref c) = issue.culprit {
        parts.push(c.to_lowercase());
    }
    if let Some(ref t) = event.title {
        parts.push(t.to_lowercase());
    }
    if let Some(ref m) = event.message {
        parts.push(m.to_lowercase());
    }
    for exc in &event.exceptions {
        if let Some(ref t) = exc.exception_type {
            parts.push(t.to_lowercase());
        }
        if let Some(ref v) = exc.value {
            parts.push(v.to_lowercase());
        }
    }
    for tag in &event.tags {
        parts.push(format!("{}={}", tag.key.to_lowercase(), tag.value.to_lowercase()));
    }
    parts.join(" ")
}

/// Count keyword matches in text, returning matching keywords as evidence.
fn find_keyword_matches(text: &str, keywords: &[&str]) -> Vec<String> {
    keywords
        .iter()
        .filter(|kw| text.contains(**kw))
        .map(|kw| format!("Keyword match: \"{}\"", kw))
        .collect()
}
```

- [ ] **Step 2: Add the 4 ported detectors (deadlock, n+1, memory leak, unhandled promise)**

```rust
fn detect_deadlock(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &["deadlock", "lock timeout", "lock wait timeout", "40p01"];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::Deadlock,
        confidence: if evidence.len() >= 2 { 0.9 } else { 0.7 },
        evidence,
    })
}

fn detect_n_plus_one(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let mut evidence = Vec::new();

    // Check for keyword
    if text.contains("n+1") || text.contains("n + 1") {
        evidence.push("Keyword match: \"n+1\"".to_string());
    }

    // Check for repeated breadcrumb patterns (DB or HTTP)
    let mut query_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for bc in &event.breadcrumbs {
        let cat = bc.category.as_deref().unwrap_or("");
        if cat == "query" || cat == "http" || cat == "db" {
            // Normalize: replace numeric literals with ?
            let msg = bc.message.as_deref().unwrap_or("").to_string();
            let normalized = normalize_query(&msg);
            *query_counts.entry(normalized).or_insert(0) += 1;
        }
    }
    for (query, count) in &query_counts {
        if *count >= 3 {
            evidence.push(format!("Repeated query ({count}x): {}", truncate_str(query, 80)));
        }
    }

    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::NPlusOne,
        confidence: if query_counts.values().any(|c| *c >= 3) { 0.85 } else { 0.6 },
        evidence,
    })
}

/// Replace numeric literals in a query with `?` for grouping.
fn normalize_query(query: &str) -> String {
    let mut result = String::with_capacity(query.len());
    let mut chars = query.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            result.push('?');
            while chars.peek().is_some_and(|ch| ch.is_ascii_digit()) {
                chars.next();
            }
        } else {
            result.push(c);
        }
    }
    result
}

fn truncate_str(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        &s[..max]
    }
}

fn detect_memory_leak(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "out of memory", "outofmemory", "oom", "heap exhausted",
        "java.lang.outofmemoryerror", "allocation failed", "memory limit",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::MemoryLeak,
        confidence: if evidence.len() >= 2 { 0.9 } else { 0.75 },
        evidence,
    })
}

fn detect_unhandled_promise(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &["unhandledrejection", "unhandled promise", "unhandled rejection"];
    let mut evidence = find_keyword_matches(&text, keywords);

    // Check exception types
    for exc in &event.exceptions {
        if let Some(ref t) = exc.exception_type {
            let t_lower = t.to_lowercase();
            if t_lower.contains("unhandledrejection") || t_lower.contains("unhandledpromiserejection") {
                evidence.push(format!("Exception type: {t}"));
            }
        }
    }

    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::UnhandledPromise,
        confidence: if evidence.len() >= 2 { 0.9 } else { 0.8 },
        evidence,
    })
}
```

- [ ] **Step 3: Add the 7 new detectors**

```rust
fn detect_race_condition(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "race condition", "concurrent modification", "concurrentmodificationexception",
        "data race", "toctou", "time of check", "stale data", "optimistic lock",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::RaceCondition,
        confidence: if evidence.len() >= 2 { 0.85 } else { 0.65 },
        evidence,
    })
}

fn detect_connection_exhaustion(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "pool timeout", "too many connections", "connection limit",
        "emfile", "enfile", "socket limit", "connection pool exhausted",
        "max_connections", "connection refused",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::ConnectionExhaustion,
        confidence: if evidence.len() >= 2 { 0.9 } else { 0.7 },
        evidence,
    })
}

fn detect_timeout_cascade(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let mut evidence = Vec::new();

    let keywords = &[
        "upstream timeout", "gateway timeout", "504", "request timeout",
        "read timed out", "connect timed out", "deadline exceeded",
    ];
    evidence.extend(find_keyword_matches(&text, keywords));

    // Count timeout-related breadcrumbs
    let timeout_breadcrumbs: Vec<_> = event.breadcrumbs.iter()
        .filter(|bc| {
            let msg = bc.message.as_deref().unwrap_or("").to_lowercase();
            let cat = bc.category.as_deref().unwrap_or("");
            (cat == "http" || cat == "query") && (msg.contains("timeout") || msg.contains("timed out"))
        })
        .collect();
    if timeout_breadcrumbs.len() >= 2 {
        evidence.push(format!("{} timeout breadcrumbs detected", timeout_breadcrumbs.len()));
    }

    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::TimeoutCascade,
        confidence: if timeout_breadcrumbs.len() >= 3 { 0.85 } else { 0.65 },
        evidence,
    })
}

fn detect_auth_failure(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "token expired", "jwt expired", "unauthorized", "forbidden",
        "authentication failed", "invalid token", "access denied",
        "401", "403",
    ];
    let mut evidence = find_keyword_matches(&text, keywords);

    // Check HTTP status codes in breadcrumbs
    for bc in &event.breadcrumbs {
        if let Some(ref data) = bc.data {
            if let Some(status) = data.get("status_code").or_else(|| data.get("statusCode")) {
                let status_str = status.to_string();
                if status_str == "401" || status_str == "403" {
                    evidence.push(format!("HTTP {} in breadcrumb", status_str));
                }
            }
        }
    }

    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::AuthFailure,
        confidence: if evidence.len() >= 2 { 0.9 } else { 0.7 },
        evidence,
    })
}

fn detect_constraint_violation(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "unique constraint", "duplicate key", "foreign key violation",
        "check constraint", "serialization failure", "23505", "23503",
        "23514", "integrityerror", "constraintviolation",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::ConstraintViolation,
        confidence: if evidence.iter().any(|e| e.contains("23505") || e.contains("23503")) { 0.9 } else { 0.75 },
        evidence,
    })
}

fn detect_resource_exhaustion(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "disk full", "no space left", "enospc", "file descriptor",
        "emfile", "too many open files", "cpu quota", "resource limit",
        "ulimit", "resource temporarily unavailable",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::ResourceExhaustion,
        confidence: if evidence.len() >= 2 { 0.9 } else { 0.75 },
        evidence,
    })
}

fn detect_stack_overflow(issue: &SentryIssueDetail, event: &SentryEventDetail) -> Option<DetectedPattern> {
    let text = collect_searchable_text(issue, event);
    let keywords = &[
        "stack overflow", "maximum call stack size exceeded",
        "stackoverflowerror", "recursion depth", "too much recursion",
    ];
    let evidence = find_keyword_matches(&text, keywords);
    if evidence.is_empty() {
        return None;
    }
    Some(DetectedPattern {
        pattern_type: PatternType::StackOverflow,
        confidence: if text.contains("stackoverflowerror") || text.contains("maximum call stack") { 0.95 } else { 0.8 },
        evidence,
    })
}
```

- [ ] **Step 4: Add the orchestrator**

```rust
/// Run all pattern detectors and return matches sorted by confidence (highest first).
pub fn detect_sentry_patterns(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
) -> Vec<DetectedPattern> {
    let detectors: Vec<fn(&SentryIssueDetail, &SentryEventDetail) -> Option<DetectedPattern>> = vec![
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
        .filter_map(|detect| detect(issue, event))
        .collect();

    patterns.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    patterns
}
```

- [ ] **Step 5: Add pattern detector tests**

Add to the `tests` module:

```rust
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
            breadcrumbs: crumbs.into_iter().map(|(cat, msg)| SentryBreadcrumb {
                category: Some(cat.to_string()),
                message: Some(msg.to_string()),
                ..Default::default()
            }).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn test_detect_deadlock() {
        let issue = make_issue("Transaction deadlock detected");
        let event = make_event_with_exception("DatabaseError", "lock wait timeout exceeded");
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::Deadlock));
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
        let crumbs = vec![
            ("query", "SELECT * FROM users WHERE id = 1"),
            ("query", "SELECT * FROM users WHERE id = 2"),
            ("query", "SELECT * FROM users WHERE id = 3"),
        ];
        let issue = make_issue("Slow page load");
        let event = make_event_with_breadcrumbs(crumbs);
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.iter().any(|p| p.pattern_type == PatternType::NPlusOne));
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
        let event = make_event_with_exception("UnhandledRejection", "Promise rejected");
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
    }

    #[test]
    fn test_no_false_positive_patterns() {
        let issue = make_issue("Button click handler logged successfully");
        let event = make_event_with_exception("InfoEvent", "User clicked save button");
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.is_empty(), "Expected no patterns for benign event, got: {:?}", patterns);
    }

    #[test]
    fn test_patterns_sorted_by_confidence() {
        // Trigger multiple patterns
        let issue = make_issue("deadlock timeout out of memory");
        let event = SentryEventDetail::default();
        let patterns = detect_sentry_patterns(&issue, &event);
        assert!(patterns.len() >= 2);
        for window in patterns.windows(2) {
            assert!(window[0].confidence >= window[1].confidence);
        }
    }
```

- [ ] **Step 6: Verify compilation and tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- sentry`

Expected: All tests pass (5 from Task 1 + 14 from Task 2 = 19 total).

- [ ] **Step 7: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/sentry_analysis.rs
git commit -m "feat(core): add 11 sentry pattern detectors with tests"
```

---

## Task 3: hadron-core — Prompt, Message Builder, and Parser

**Files:**
- Modify: `hadron-web/crates/hadron-core/src/ai/sentry_analysis.rs`

- [ ] **Step 1: Add system prompt and message builder**

Insert before the `detect_sentry_patterns` function (after the pattern detection helpers):

```rust
// ── AI Prompt & Message Builder ──────────────────────────────────────────

pub const SENTRY_ANALYSIS_SYSTEM_PROMPT: &str = r#"You are an expert software debugger analyzing a Sentry error event.
The event includes stacktrace with in-app frames marked [APP] and library frames marked [LIB], breadcrumbs showing user actions and system events, tags, and runtime context.

Analyze the error and return ONLY valid JSON with these fields:
{
  "error_type": "The specific error class/type",
  "error_message": "The error message",
  "severity": "CRITICAL or HIGH or MEDIUM or LOW",
  "root_cause": "Technical explanation of what triggered this error (2-4 sentences)",
  "suggested_fixes": ["Fix 1", "Fix 2", "Fix 3"],
  "component": "The application component/module affected",
  "confidence": "HIGH or MEDIUM or LOW",
  "pattern_type": "deadlock|n_plus_one|memory_leak|unhandled_promise|race_condition|connection_exhaustion|timeout_cascade|auth_failure|constraint_violation|resource_exhaustion|stack_overflow|generic",
  "user_impact": "Description of how this affects end users (1-2 sentences)",
  "breadcrumb_analysis": "What the breadcrumbs reveal about the sequence of events leading to the error",
  "recommendations": [
    {
      "priority": "high or medium or low",
      "title": "Short action title",
      "description": "Detailed explanation of what to do and why",
      "effort": "low or medium or high",
      "code_snippet": "Optional code example showing the fix (null if not applicable)"
    }
  ]
}

Guidelines:
- Focus on in-app frames [APP] — they are the application's code. Library frames [LIB] provide context.
- Analyze breadcrumbs chronologically — what was the user or system doing before the error?
- Use event count and affected user count to assess severity: many events + many users = higher severity.
- If pattern detectors have already identified patterns, incorporate their findings.
- Provide 3-5 recommendations, ordered by priority. Include code snippets where a concrete fix is possible.
- severity guide: CRITICAL = data loss or security issue or total outage; HIGH = major feature broken; MEDIUM = degraded but workaround exists; LOW = cosmetic or rare edge case."#;

/// Build the user prompt from normalized issue + event data.
pub fn build_sentry_analysis_user_prompt(
    issue: &SentryIssueDetail,
    event: &SentryEventDetail,
    patterns: &[DetectedPattern],
) -> String {
    let mut parts = Vec::new();

    // Issue header
    parts.push(format!(
        "=== SENTRY ISSUE ===\nID: {} ({})\nTitle: {}\nLevel: {} | Status: {} | Platform: {}\nCulprit: {}\nEvents: {} | Users affected: {}\nFirst seen: {} | Last seen: {}",
        issue.id,
        issue.short_id,
        issue.title,
        issue.level,
        issue.status,
        issue.platform.as_deref().unwrap_or("unknown"),
        issue.culprit.as_deref().unwrap_or("unknown"),
        issue.count.as_deref().unwrap_or("?"),
        issue.user_count.map(|c| c.to_string()).unwrap_or_else(|| "?".to_string()),
        issue.first_seen.as_deref().unwrap_or("?"),
        issue.last_seen.as_deref().unwrap_or("?"),
    ));

    // Exceptions
    if !event.exceptions.is_empty() {
        parts.push("\n=== EXCEPTION CHAIN ===".to_string());
        for (i, exc) in event.exceptions.iter().enumerate() {
            parts.push(format!(
                "\n--- Exception {} ---\nType: {}\nValue: {}\nModule: {}",
                i + 1,
                exc.exception_type.as_deref().unwrap_or("unknown"),
                exc.value.as_deref().unwrap_or(""),
                exc.module.as_deref().unwrap_or(""),
            ));
            if let Some(ref frames) = exc.stacktrace {
                for frame in frames.iter().rev() {
                    let tag = if frame.in_app == Some(true) { "[APP]" } else { "[LIB]" };
                    parts.push(format!(
                        "  {} {}:{} in {}",
                        tag,
                        frame.filename.as_deref().unwrap_or("?"),
                        frame.line_no.map(|l| l.to_string()).unwrap_or_else(|| "?".to_string()),
                        frame.function.as_deref().unwrap_or("?"),
                    ));
                }
            }
        }
    }

    // Breadcrumbs
    if !event.breadcrumbs.is_empty() {
        parts.push("\n=== BREADCRUMBS (chronological) ===".to_string());
        for bc in &event.breadcrumbs {
            parts.push(format!(
                "[{}] {} ({}) — {}",
                bc.timestamp.as_deref().unwrap_or("?"),
                bc.category.as_deref().unwrap_or("?"),
                bc.level.as_deref().unwrap_or("info"),
                bc.message.as_deref().unwrap_or(""),
            ));
        }
    }

    // Tags
    let user_tags: Vec<_> = event.tags.iter()
        .filter(|t| !t.key.starts_with("sentry:"))
        .collect();
    if !user_tags.is_empty() {
        parts.push("\n=== TAGS ===".to_string());
        for tag in user_tags {
            parts.push(format!("{}: {}", tag.key, tag.value));
        }
    }

    // Runtime context
    if !event.contexts.is_null() {
        parts.push("\n=== RUNTIME CONTEXT ===".to_string());
        if let Some(obj) = event.contexts.as_object() {
            for (key, val) in obj {
                if let Some(inner) = val.as_object() {
                    let summary: Vec<String> = inner.iter()
                        .take(5)
                        .filter_map(|(k, v)| v.as_str().map(|s| format!("{k}={s}")))
                        .collect();
                    if !summary.is_empty() {
                        parts.push(format!("{}: {}", key, summary.join(", ")));
                    }
                }
            }
        }
    }

    // Detected patterns
    if !patterns.is_empty() {
        parts.push("\n=== DETECTED PATTERNS (automated) ===".to_string());
        for p in patterns {
            parts.push(format!(
                "Pattern: {} (confidence: {:.0}%)\nEvidence: {}",
                p.pattern_type,
                p.confidence * 100.0,
                p.evidence.join("; "),
            ));
        }
    }

    parts.join("\n")
}

/// Build the (system_prompt, messages) tuple for AI completion.
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
```

- [ ] **Step 2: Add parser**

```rust
/// Parse AI response JSON into SentryAnalysisResult.
pub fn parse_sentry_analysis(raw: &str) -> crate::error::HadronResult<SentryAnalysisResult> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let preview = &json_str[..json_str.len().min(300)];
        crate::error::HadronError::Parse(format!(
            "Failed to parse Sentry analysis: {e}. Preview: {preview}"
        ))
    })
}
```

- [ ] **Step 3: Add prompt and parser tests**

Add to the `tests` module:

```rust
    #[test]
    fn test_build_sentry_analysis_prompt() {
        let issue = SentryIssueDetail {
            id: "12345".to_string(),
            short_id: "PROJ-42".to_string(),
            title: "TypeError: undefined is not a function".to_string(),
            level: "error".to_string(),
            status: "unresolved".to_string(),
            count: Some("150".to_string()),
            user_count: Some(23),
            ..Default::default()
        };
        let event = SentryEventDetail {
            breadcrumbs: vec![SentryBreadcrumb {
                category: Some("http".to_string()),
                message: Some("GET /api/data".to_string()),
                ..Default::default()
            }],
            exceptions: vec![SentryException {
                exception_type: Some("TypeError".to_string()),
                value: Some("undefined is not a function".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let prompt = build_sentry_analysis_user_prompt(&issue, &event, &[]);
        assert!(prompt.contains("PROJ-42"));
        assert!(prompt.contains("TypeError"));
        assert!(prompt.contains("GET /api/data"));
        assert!(prompt.contains("Events: 150"));
        assert!(prompt.contains("Users affected: 23"));
    }

    #[test]
    fn test_build_sentry_analysis_messages() {
        let issue = SentryIssueDetail {
            title: "Test error".to_string(),
            ..Default::default()
        };
        let event = SentryEventDetail::default();
        let (system, messages) = build_sentry_analysis_messages(&issue, &event, &[]);
        assert!(system.contains("expert software debugger"));
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "user");
        assert!(messages[0].content.contains("Test error"));
    }

    #[test]
    fn test_parse_sentry_analysis_result() {
        let json = r#"{
            "error_type": "TypeError",
            "error_message": "Cannot read property 'foo'",
            "severity": "HIGH",
            "root_cause": "Null reference in user panel",
            "suggested_fixes": ["Add null check", "Use optional chaining"],
            "component": "UserPanel",
            "confidence": "HIGH",
            "pattern_type": "generic",
            "user_impact": "Users see blank screen",
            "breadcrumb_analysis": "User clicked submit before data loaded",
            "recommendations": [
                {
                    "priority": "high",
                    "title": "Add null guard",
                    "description": "Check for null before accessing property",
                    "effort": "low",
                    "code_snippet": "if (user?.foo) { ... }"
                }
            ]
        }"#;
        let result = parse_sentry_analysis(json).unwrap();
        assert_eq!(result.error_type, "TypeError");
        assert_eq!(result.severity, "HIGH");
        assert_eq!(result.suggested_fixes.len(), 2);
        assert_eq!(result.recommendations.len(), 1);
        assert_eq!(result.recommendations[0].effort, "low");
    }

    #[test]
    fn test_parse_sentry_analysis_defaults() {
        let json = r#"{"error_type": "Error"}"#;
        let result = parse_sentry_analysis(json).unwrap();
        assert_eq!(result.error_type, "Error");
        assert!(result.root_cause.is_empty());
        assert!(result.suggested_fixes.is_empty());
        assert!(result.recommendations.is_empty());
    }

    #[test]
    fn test_parse_sentry_analysis_with_markdown_fences() {
        let raw = "```json\n{\"error_type\": \"ValueError\"}\n```";
        let result = parse_sentry_analysis(raw).unwrap();
        assert_eq!(result.error_type, "ValueError");
    }

    #[test]
    fn test_prompt_includes_patterns() {
        let issue = make_issue("deadlock in database");
        let event = SentryEventDetail::default();
        let patterns = vec![DetectedPattern {
            pattern_type: PatternType::Deadlock,
            confidence: 0.9,
            evidence: vec!["Keyword match: \"deadlock\"".to_string()],
        }];
        let prompt = build_sentry_analysis_user_prompt(&issue, &event, &patterns);
        assert!(prompt.contains("DETECTED PATTERNS"));
        assert!(prompt.contains("Deadlock"));
        assert!(prompt.contains("90%"));
    }
```

- [ ] **Step 4: Verify compilation and tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- sentry`

Expected: All tests pass (19 from Tasks 1-2 + 6 from Task 3 = 25 total).

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/sentry_analysis.rs
git commit -m "feat(core): add sentry analysis prompt, message builder, and parser"
```

---

## Task 4: hadron-server — Admin Sentry Config & DB Helpers

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/admin.rs`
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add Sentry config DB helpers**

Add to `hadron-web/crates/hadron-server/src/db/mod.rs` (at the end, before any closing braces):

```rust
// ── Sentry Config ────────────────────────────────────────────────────────

/// Load Sentry config from global_settings. Returns None if not configured.
pub async fn get_sentry_config(pool: &PgPool) -> HadronResult<Option<hadron_core::models::SentryConfig>> {
    let base_url = get_global_setting(pool, "sentry_base_url").await?.unwrap_or_default();
    let organization = get_global_setting(pool, "sentry_organization").await?.unwrap_or_default();
    let encrypted_token = get_global_setting(pool, "sentry_auth_token").await?.unwrap_or_default();

    if base_url.is_empty() || organization.is_empty() || encrypted_token.is_empty() {
        return Ok(None);
    }

    let auth_token = crate::crypto::decrypt_value(&encrypted_token)?;
    if auth_token.is_empty() {
        return Ok(None);
    }

    Ok(Some(hadron_core::models::SentryConfig {
        base_url,
        auth_token,
        organization,
    }))
}

// ── Sentry Analysis Persistence ──────────────────────────────────────────

/// Insert a Sentry analysis into the analyses table with analysis_type='sentry'.
pub async fn insert_sentry_analysis(
    pool: &PgPool,
    user_id: Uuid,
    filename: &str,
    error_type: Option<&str>,
    error_message: Option<&str>,
    severity: Option<&str>,
    root_cause: Option<&str>,
    suggested_fixes: Option<&serde_json::Value>,
    confidence: Option<&str>,
    component: Option<&str>,
    full_data: Option<&serde_json::Value>,
) -> HadronResult<i64> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO analyses (
            user_id, filename, analysis_type, error_type, error_message,
            severity, root_cause, suggested_fixes, confidence, component,
            full_data
         ) VALUES ($1, $2, 'sentry', $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id",
    )
    .bind(user_id)
    .bind(filename)
    .bind(error_type)
    .bind(error_message)
    .bind(severity)
    .bind(root_cause)
    .bind(suggested_fixes)
    .bind(confidence)
    .bind(component)
    .bind(full_data)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.0)
}

/// Get paginated Sentry analyses for a user.
pub async fn get_sentry_analyses(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<serde_json::Value>, i64)> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analyses WHERE user_id = $1 AND analysis_type = 'sentry' AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<(i64, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<serde_json::Value>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, filename, error_type, severity, confidence, component, full_data, analyzed_at
         FROM analyses
         WHERE user_id = $1 AND analysis_type = 'sentry' AND deleted_at IS NULL
         ORDER BY analyzed_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let items: Vec<serde_json::Value> = rows.iter().map(|r| {
        serde_json::json!({
            "id": r.0,
            "filename": r.1,
            "errorType": r.2,
            "severity": r.3,
            "confidence": r.4,
            "component": r.5,
            "analyzedAt": r.7.to_rfc3339(),
        })
    }).collect();

    Ok((items, count.0))
}
```

- [ ] **Step 2: Add admin Sentry config routes**

Add to `hadron-web/crates/hadron-server/src/routes/admin.rs`:

```rust
// ── Sentry Config ────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentryConfigStatus {
    pub base_url: String,
    pub organization: String,
    pub has_auth_token: bool,
    pub configured: bool,
}

pub async fn get_sentry_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    let base_url = db::get_global_setting(&state.db, "sentry_base_url")
        .await?
        .unwrap_or_default();
    let organization = db::get_global_setting(&state.db, "sentry_organization")
        .await?
        .unwrap_or_default();
    let token = db::get_global_setting(&state.db, "sentry_auth_token")
        .await?
        .unwrap_or_default();

    Ok(Json(SentryConfigStatus {
        configured: !base_url.is_empty() && !organization.is_empty() && !token.is_empty(),
        base_url,
        organization,
        has_auth_token: !token.is_empty(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSentryConfigRequest {
    pub base_url: Option<String>,
    pub organization: Option<String>,
    pub auth_token: Option<String>,
}

pub async fn update_sentry_config(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateSentryConfigRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    if let Some(ref url) = req.base_url {
        db::set_global_setting(&state.db, "sentry_base_url", url, user.user.id).await?;
    }
    if let Some(ref org) = req.organization {
        db::set_global_setting(&state.db, "sentry_organization", org, user.user.id).await?;
    }
    if let Some(ref token) = req.auth_token {
        let encrypted = crate::crypto::encrypt_value(token)?;
        db::set_global_setting(&state.db, "sentry_auth_token", &encrypted, user.user.id).await?;
    }

    let _ = db::write_audit_log(
        &state.db,
        user.user.id,
        "admin.sentry_config_updated",
        "global_settings",
        None,
        &serde_json::json!({
            "base_url_changed": req.base_url.is_some(),
            "organization_changed": req.organization.is_some(),
            "auth_token_changed": req.auth_token.is_some(),
        }),
        None,
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 3: Register admin Sentry routes in mod.rs**

In `hadron-web/crates/hadron-server/src/routes/mod.rs`, add to the `api_router()` function alongside the existing admin routes:

```rust
// Sentry admin config
.route("/admin/sentry", get(admin::get_sentry_config))
.route("/admin/sentry", put(admin::update_sentry_config))
```

- [ ] **Step 4: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

Expected: Compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/admin.rs hadron-web/crates/hadron-server/src/db/mod.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add admin Sentry config routes and DB helpers"
```

---

## Task 5: hadron-server — Refactor Browse Routes to Use Server Config

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/integrations.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Refactor sentry_projects to use server config**

In `integrations.rs`, replace the existing `sentry_projects` handler:

```rust
pub async fn sentry_projects(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation(
            "Sentry is not configured. Ask an admin to configure it.",
        )))?;
    let projects = sentry::list_projects(&config)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(projects))
}
```

- [ ] **Step 2: Refactor sentry_issues to use server config**

Replace the existing `sentry_issues` handler (remove the `Json(config)` extractor):

```rust
pub async fn sentry_issues(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<SentryIssuesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation(
            "Sentry is not configured. Ask an admin to configure it.",
        )))?;
    let issues = sentry::list_issues(&config, &params.project, params.limit.unwrap_or(25))
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(issues))
}
```

- [ ] **Step 3: Refactor sentry_event to use server config**

```rust
pub async fn sentry_event(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation(
            "Sentry is not configured. Ask an admin to configure it.",
        )))?;
    let event = sentry::fetch_latest_event(&config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(event))
}
```

- [ ] **Step 4: Add fetch single issue route**

```rust
pub async fn sentry_issue(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation(
            "Sentry is not configured. Ask an admin to configure it.",
        )))?;
    let issue = sentry::fetch_issue(&config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(issue))
}
```

Note: If `sentry::fetch_issue` doesn't exist in the integrations module, add it following the pattern of `fetch_latest_event` — calling `GET /api/0/issues/{id}/`.

- [ ] **Step 5: Keep sentry_test unchanged** (it accepts config in body for admin setup)

No changes needed — `sentry_test` keeps accepting `Json(config)` since the admin uses it with candidate credentials before saving.

- [ ] **Step 6: Update route registrations in mod.rs**

Update the Sentry route registrations to use `State(state)` (no longer need JSON body for browse routes). The routes should now be:

```rust
// Sentry integration
.route("/sentry/test", post(integrations::sentry_test))
.route("/sentry/projects", get(integrations::sentry_projects))
.route("/sentry/issues", get(integrations::sentry_issues))
.route("/sentry/issues/{id}", get(integrations::sentry_issue))
.route("/sentry/issues/{id}/event", get(integrations::sentry_event))
```

- [ ] **Step 7: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

Expected: Compiles cleanly. If `sentry::fetch_issue` doesn't exist, you'll need to add it to the integrations module (see step 4 note).

- [ ] **Step 8: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/integrations.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "refactor(server): sentry browse routes use server-side config"
```

---

## Task 6: hadron-server — Sentry Analysis Routes

**Files:**
- Create: `hadron-web/crates/hadron-server/src/routes/sentry_analysis.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Create sentry_analysis route file with streaming analysis**

```rust
// hadron-web/crates/hadron-server/src/routes/sentry_analysis.rs

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use hadron_core::ai::{
    self as ai_core, SentryAnalysisResult, SentryIssueDetail,
};
use serde::Deserialize;

use crate::routes::AppError;
use crate::middleware::AuthenticatedUser;
use crate::AppState;
use crate::{ai, db, sse};

/// Streaming Sentry analysis via SSE.
pub async fn analyze_issue_stream(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // 1. Load configs
    let sentry_config = db::get_sentry_config(&state.db)
        .await?
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation(
            "Sentry is not configured. Ask an admin to configure it.",
        )))?;

    let ai_config = crate::routes::analyses::resolve_ai_config(
        &state.db, None, None, None,
    ).await?;

    // 2. Fetch issue + event from Sentry
    let issue_json = crate::integrations::sentry::fetch_issue(&sentry_config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;
    let event_json = crate::integrations::sentry::fetch_latest_event(&sentry_config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;

    // 3. Normalize
    let issue: SentryIssueDetail = serde_json::from_value(issue_json.clone())
        .unwrap_or_default();
    let event = ai_core::normalize_sentry_event(&event_json);

    // 4. Detect patterns
    let patterns = ai_core::detect_sentry_patterns(&issue, &event);

    // 5. Build messages
    let (system_prompt, messages) = ai_core::build_sentry_analysis_messages(
        &issue, &event, &patterns,
    );

    // 6. Spawn persistence task after stream completes
    let db_pool = state.db.clone();
    let user_id = user.user.id;
    let issue_for_persist = issue.clone();
    let event_for_persist = event.clone();
    let patterns_for_persist = patterns.clone();

    // Use manual streaming to capture the full response for persistence
    let (tx, rx) = tokio::sync::mpsc::channel::<hadron_core::models::ChatStreamEvent>(100);

    tokio::spawn(async move {
        let result = ai::stream_completion(
            &ai_config,
            messages,
            Some(&system_prompt),
            tx.clone(),
        )
        .await;

        match result {
            Ok(full_text) => {
                // Parse and persist
                if let Ok(analysis_result) = ai_core::parse_sentry_analysis(&full_text) {
                    let full_data = serde_json::json!({
                        "issue": issue_for_persist,
                        "event": event_for_persist,
                        "patterns": patterns_for_persist,
                        "aiResult": analysis_result,
                    });
                    let fixes_json = serde_json::to_value(&analysis_result.suggested_fixes).ok();
                    let filename = if issue_for_persist.short_id.is_empty() {
                        format!("sentry-{}", issue_for_persist.id)
                    } else {
                        issue_for_persist.short_id.clone()
                    };
                    let _ = db::insert_sentry_analysis(
                        &db_pool,
                        user_id,
                        &filename,
                        Some(&analysis_result.error_type),
                        Some(&analysis_result.error_message),
                        Some(&analysis_result.severity),
                        Some(&analysis_result.root_cause),
                        fixes_json.as_ref(),
                        Some(&analysis_result.confidence),
                        Some(&analysis_result.component),
                        Some(&full_data),
                    )
                    .await;
                }

                let _ = tx
                    .send(hadron_core::models::ChatStreamEvent::Done {
                        session_id: String::new(),
                    })
                    .await;
            }
            Err(e) => {
                let _ = tx
                    .send(hadron_core::models::ChatStreamEvent::Error {
                        message: e.client_message(),
                    })
                    .await;
            }
        }
    });

    Ok(sse::stream_response(rx))
}

/// Non-streaming Sentry analysis.
pub async fn analyze_issue(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let sentry_config = db::get_sentry_config(&state.db)
        .await?
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation(
            "Sentry is not configured.",
        )))?;

    let ai_config = crate::routes::analyses::resolve_ai_config(
        &state.db, None, None, None,
    ).await?;

    let issue_json = crate::integrations::sentry::fetch_issue(&sentry_config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;
    let event_json = crate::integrations::sentry::fetch_latest_event(&sentry_config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;

    let issue: SentryIssueDetail = serde_json::from_value(issue_json.clone())
        .unwrap_or_default();
    let event = ai_core::normalize_sentry_event(&event_json);
    let patterns = ai_core::detect_sentry_patterns(&issue, &event);
    let (system_prompt, messages) = ai_core::build_sentry_analysis_messages(
        &issue, &event, &patterns,
    );

    let raw_response = ai::complete(&ai_config, messages, Some(&system_prompt)).await?;
    let analysis_result = ai_core::parse_sentry_analysis(&raw_response)?;

    // Persist
    let full_data = serde_json::json!({
        "issue": issue,
        "event": event,
        "patterns": patterns,
        "aiResult": analysis_result,
    });
    let fixes_json = serde_json::to_value(&analysis_result.suggested_fixes).ok();
    let filename = if issue.short_id.is_empty() {
        format!("sentry-{}", issue.id)
    } else {
        issue.short_id.clone()
    };
    let id = db::insert_sentry_analysis(
        &state.db,
        user.user.id,
        &filename,
        Some(&analysis_result.error_type),
        Some(&analysis_result.error_message),
        Some(&analysis_result.severity),
        Some(&analysis_result.root_cause),
        fixes_json.as_ref(),
        Some(&analysis_result.confidence),
        Some(&analysis_result.component),
        Some(&full_data),
    )
    .await?;

    Ok(Json(serde_json::json!({
        "id": id,
        "result": analysis_result,
    })))
}

/// List user's Sentry analyses.
#[derive(Deserialize)]
pub struct SentryAnalysesQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<SentryAnalysesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);
    let (items, total) = db::get_sentry_analyses(&state.db, user.user.id, limit, offset).await?;
    Ok(Json(serde_json::json!({
        "items": items,
        "total": total,
    })))
}

/// Get a single Sentry analysis by ID.
pub async fn get_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let analysis = db::get_analysis_by_id(&state.db, id, user.user.id).await?;
    Ok(Json(analysis))
}

/// Soft-delete a Sentry analysis.
pub async fn delete_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    db::delete_analysis(&state.db, id, user.user.id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Register routes in mod.rs**

Add `mod sentry_analysis;` to the module declarations in `routes/mod.rs`, and add routes to `api_router()`:

```rust
// Sentry analysis
.route("/sentry/issues/{id}/analyze/stream", post(sentry_analysis::analyze_issue_stream))
.route("/sentry/issues/{id}/analyze", post(sentry_analysis::analyze_issue))
.route("/sentry/analyses", get(sentry_analysis::list_analyses))
.route("/sentry/analyses/{id}", get(sentry_analysis::get_analysis))
.route("/sentry/analyses/{id}", delete(sentry_analysis::delete_analysis))
```

- [ ] **Step 3: Verify compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

Expected: Compiles cleanly. If there are any missing imports or function references (like `fetch_issue` in the sentry integration), add them following existing patterns.

- [ ] **Step 4: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/sentry_analysis.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add Sentry analysis streaming and CRUD routes"
```

---

## Task 7: Frontend — API Service & Types

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`

- [ ] **Step 1: Add Sentry analysis TypeScript types**

Add near the existing Sentry types or JIRA types section in `api.ts`:

```typescript
// ── Sentry Analysis Types ─────────────────────────────────────────────

export interface SentryConfigStatus {
  baseUrl: string;
  organization: string;
  hasAuthToken: boolean;
  configured: boolean;
}

export interface UpdateSentryConfigRequest {
  baseUrl?: string;
  organization?: string;
  authToken?: string;
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
}

export interface SentryIssue {
  id: string;
  title: string;
  culprit: string | null;
  level: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  status: string;
  shortId?: string;
  platform?: string | null;
  userCount?: number | null;
  permalink?: string | null;
}

export interface SentryAnalysisSummary {
  id: number;
  filename: string;
  errorType: string | null;
  severity: string | null;
  confidence: string | null;
  component: string | null;
  analyzedAt: string;
}

export interface SentryAnalysisResult {
  errorType: string;
  errorMessage: string;
  severity: string;
  rootCause: string;
  suggestedFixes: string[];
  component: string;
  confidence: string;
  patternType: string;
  userImpact: string;
  breadcrumbAnalysis: string;
  recommendations: SentryRecommendation[];
}

export interface SentryRecommendation {
  priority: string;
  title: string;
  description: string;
  effort: string;
  codeSnippet: string | null;
}

export interface DetectedPattern {
  patternType: string;
  confidence: number;
  evidence: string[];
}

export interface SentryAnalysisFullData {
  issue: SentryIssue;
  event: {
    breadcrumbs: SentryBreadcrumb[];
    exceptions: SentryException[];
    tags: SentryTag[];
    contexts: Record<string, unknown>;
  };
  patterns: DetectedPattern[];
  aiResult: SentryAnalysisResult;
}

export interface SentryBreadcrumb {
  timestamp: string | null;
  category: string | null;
  message: string | null;
  level: string | null;
  data: Record<string, unknown> | null;
  type: string | null;
}

export interface SentryException {
  type: string | null;
  value: string | null;
  module: string | null;
  stacktrace: SentryFrame[] | null;
}

export interface SentryFrame {
  filename: string | null;
  function: string | null;
  lineNo: number | null;
  colNo: number | null;
  contextLine: string | null;
  inApp: boolean | null;
  module: string | null;
}

export interface SentryTag {
  key: string;
  value: string;
}
```

- [ ] **Step 2: Add API methods to ApiClient class**

Add these methods to the `ApiClient` class:

```typescript
  // ── Sentry Admin Config ─────────────────────────────────────────

  async getSentryConfigStatus(): Promise<SentryConfigStatus> {
    return this.request<SentryConfigStatus>('/admin/sentry');
  }

  async updateSentryConfig(config: UpdateSentryConfigRequest): Promise<void> {
    await this.request('/admin/sentry', {
      method: 'PUT',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  }

  async testSentryConnection(config: { baseUrl: string; authToken: string; organization: string }): Promise<{ connected: boolean }> {
    return this.request('/sentry/test', {
      method: 'POST',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  }

  // ── Sentry Browse ───────────────────────────────────────────────

  async getSentryProjects(): Promise<SentryProject[]> {
    return this.request<SentryProject[]>('/sentry/projects');
  }

  async getSentryIssues(project: string, limit?: number): Promise<SentryIssue[]> {
    const params = new URLSearchParams({ project });
    if (limit) params.set('limit', String(limit));
    return this.request<SentryIssue[]>(`/sentry/issues?${params}`);
  }

  async getSentryIssue(issueId: string): Promise<SentryIssue> {
    return this.request<SentryIssue>(`/sentry/issues/${encodeURIComponent(issueId)}`);
  }

  async getSentryEvent(issueId: string): Promise<unknown> {
    return this.request(`/sentry/issues/${encodeURIComponent(issueId)}/event`);
  }

  // ── Sentry Analysis ────────────────────────────────────────────

  async analyzeSentryIssue(issueId: string): Promise<{ id: number; result: SentryAnalysisResult }> {
    return this.request(`/sentry/issues/${encodeURIComponent(issueId)}/analyze`, {
      method: 'POST',
      headers: await this.headers(),
    });
  }

  async getSentryAnalyses(limit?: number, offset?: number): Promise<{ items: SentryAnalysisSummary[]; total: number }> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    return this.request(`/sentry/analyses?${params}`);
  }

  async getSentryAnalysis(id: number): Promise<unknown> {
    return this.request(`/sentry/analyses/${id}`);
  }

  async deleteSentryAnalysis(id: number): Promise<void> {
    await this.request(`/sentry/analyses/${id}`, { method: 'DELETE', headers: await this.headers() });
  }
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts
git commit -m "feat(frontend): add Sentry analysis types and API methods"
```

---

## Task 8: Frontend — Helper Utilities & Admin Config Panel

**Files:**
- Create: `hadron-web/frontend/src/components/sentry/sentryHelpers.ts`
- Create: `hadron-web/frontend/src/components/admin/SentryConfigPanel.tsx`
- Modify: `hadron-web/frontend/src/components/admin/AdminPanel.tsx`

- [ ] **Step 1: Create sentryHelpers.ts**

```typescript
// hadron-web/frontend/src/components/sentry/sentryHelpers.ts

export function getLevelColor(level: string): string {
  switch (level) {
    case 'fatal': return 'bg-purple-100 text-purple-800';
    case 'error': return 'bg-red-100 text-red-800';
    case 'warning': return 'bg-yellow-100 text-yellow-800';
    case 'info': return 'bg-blue-100 text-blue-800';
    case 'debug': return 'bg-gray-100 text-gray-600';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'resolved': return 'bg-green-100 text-green-800';
    case 'ignored': return 'bg-gray-100 text-gray-500';
    case 'unresolved': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getSeverityColor(severity: string | null): string {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL': return 'bg-purple-100 text-purple-800';
    case 'HIGH': return 'bg-red-100 text-red-800';
    case 'MEDIUM': return 'bg-yellow-100 text-yellow-800';
    case 'LOW': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getEffortColor(effort: string): string {
  switch (effort) {
    case 'low': return 'bg-green-100 text-green-800';
    case 'medium': return 'bg-yellow-100 text-yellow-800';
    case 'high': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'high': return 'text-red-600';
    case 'medium': return 'text-yellow-600';
    case 'low': return 'text-green-600';
    default: return 'text-gray-600';
  }
}

export function formatCount(count: string | number | null): string {
  if (count === null || count === undefined) return '0';
  const n = typeof count === 'string' ? parseInt(count, 10) : count;
  if (isNaN(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  return `${diffMon}mo ago`;
}

export function getPatternIcon(patternType: string): string {
  switch (patternType) {
    case 'deadlock': return '\u{1F512}';
    case 'n_plus_one': return '\u{1F504}';
    case 'memory_leak': return '\u{1F4A7}';
    case 'unhandled_promise': return '\u{26A0}';
    case 'race_condition': return '\u{1F3C1}';
    case 'connection_exhaustion': return '\u{1F50C}';
    case 'timeout_cascade': return '\u{23F1}';
    case 'auth_failure': return '\u{1F510}';
    case 'constraint_violation': return '\u{1F6AB}';
    case 'resource_exhaustion': return '\u{1F4C9}';
    case 'stack_overflow': return '\u{1F4DA}';
    default: return '\u{1F50D}';
  }
}

export function getPatternLabel(patternType: string): string {
  switch (patternType) {
    case 'deadlock': return 'Deadlock';
    case 'n_plus_one': return 'N+1 Query';
    case 'memory_leak': return 'Memory Leak';
    case 'unhandled_promise': return 'Unhandled Promise';
    case 'race_condition': return 'Race Condition';
    case 'connection_exhaustion': return 'Connection Exhaustion';
    case 'timeout_cascade': return 'Timeout Cascade';
    case 'auth_failure': return 'Auth Failure';
    case 'constraint_violation': return 'Constraint Violation';
    case 'resource_exhaustion': return 'Resource Exhaustion';
    case 'stack_overflow': return 'Stack Overflow';
    default: return 'Generic';
  }
}
```

- [ ] **Step 2: Create SentryConfigPanel.tsx**

```typescript
// hadron-web/frontend/src/components/admin/SentryConfigPanel.tsx

import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

export function SentryConfigPanel() {
  const [baseUrl, setBaseUrl] = useState('');
  const [organization, setOrganization] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [configured, setConfigured] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const status = await api.getSentryConfigStatus();
      setBaseUrl(status.baseUrl);
      setOrganization(status.organization);
      setHasToken(status.hasAuthToken);
      setConfigured(status.configured);
    } catch {
      // Not configured yet
    }
  }

  async function handleSave() {
    setLoading(true);
    try {
      const update: Record<string, string> = {};
      if (baseUrl) update.baseUrl = baseUrl;
      if (organization) update.organization = organization;
      if (authToken) update.authToken = authToken;
      await api.updateSentryConfig(update);
      setAuthToken('');
      await loadConfig();
      setTestResult('Configuration saved.');
    } catch (e: unknown) {
      setTestResult(`Save failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleTest() {
    if (!baseUrl || !organization) {
      setTestResult('Base URL and Organization are required.');
      return;
    }
    setLoading(true);
    try {
      const token = authToken || '(stored)';
      const result = await api.testSentryConnection({
        baseUrl,
        authToken: authToken || '',
        organization,
      });
      setTestResult(result.connected ? 'Connection successful!' : 'Connection failed.');
    } catch (e: unknown) {
      setTestResult(`Test failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Sentry Configuration</h3>
      <p className="text-sm text-gray-500">
        Configure your Sentry connection for deep analysis of error events.
        {configured && <span className="ml-2 text-green-600 font-medium">Configured</span>}
      </p>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://sentry.io"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Organization Slug</label>
          <input
            type="text"
            value={organization}
            onChange={e => setOrganization(e.target.value)}
            placeholder="my-org"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Auth Token</label>
          <input
            type="password"
            value={authToken}
            onChange={e => setAuthToken(e.target.value)}
            placeholder={hasToken ? '(stored — enter new to replace)' : 'sntrys_...'}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={loading}
          className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={handleTest}
          disabled={loading}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50"
        >
          Test Connection
        </button>
      </div>

      {testResult && (
        <p className={`text-sm ${testResult.includes('successful') || testResult.includes('saved') ? 'text-green-600' : 'text-red-600'}`}>
          {testResult}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add "sentry" tab to AdminPanel.tsx**

In `AdminPanel.tsx`, add `"sentry"` to the `AdminTab` type union and add the tab button and conditional render. Follow the existing pattern — add `| "sentry"` to the type, add a tab button labeled "Sentry", and render `<SentryConfigPanel />` when active.

Import: `import { SentryConfigPanel } from './SentryConfigPanel';`

Add to the tab list: `{ key: "sentry", label: "Sentry" }`

Add conditional render: `{activeTab === "sentry" && <SentryConfigPanel />}`

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/sentry/sentryHelpers.ts hadron-web/frontend/src/components/admin/SentryConfigPanel.tsx hadron-web/frontend/src/components/admin/AdminPanel.tsx
git commit -m "feat(frontend): add Sentry config panel and helper utilities"
```

---

## Task 9: Frontend — SentryAnalyzerView (Main Orchestrator)

**Files:**
- Create: `hadron-web/frontend/src/components/sentry/SentryAnalyzerView.tsx`
- Delete/replace: `hadron-web/frontend/src/components/sentry/SentryPanel.tsx`
- Modify: `hadron-web/frontend/src/App.tsx`

- [ ] **Step 1: Create SentryAnalyzerView.tsx**

This is the main orchestrator — tabs, config check, analysis orchestration, and navigation to the detail view. Follow the pattern from `CodeAnalyzerView.tsx` (3 tabs + streaming). Due to its size (~200-250 lines), the full component code should be written following these specs:

**State:**
- `activeTab`: 'browse' | 'import' | 'history'
- `configured`: boolean (from `/admin/sentry` status check)
- `loading`: boolean
- `analyzing`: boolean
- `error`: string | null
- `analysisResult`: full analysis data (from streaming or history click)
- `showDetail`: boolean

**On mount:** Call `api.getSentryConfigStatus()` — if not configured, show a message linking to admin panel.

**Three tabs:**
1. Browse Issues → `<SentryIssueBrowser onAnalyze={handleAnalyze} />`
2. Quick Import → `<SentryQuickImport onAnalyze={handleAnalyze} />`
3. Analysis History → `<SentryAnalysisHistory onView={handleViewAnalysis} />`

**`handleAnalyze(issueId: string):`**
1. Set `analyzing = true`
2. Use `useAiStream` hook to stream from `/sentry/issues/${issueId}/analyze/stream`
3. On completion: parse the accumulated content as `SentryAnalysisResult`
4. Fetch the full analysis data (including patterns, event data) from the analyses list
5. Set `showDetail = true`

**`handleViewAnalysis(id: number):`**
1. Fetch analysis by ID: `api.getSentryAnalysis(id)`
2. Parse `full_data` JSON
3. Set `showDetail = true`

**When `showDetail` is true:** Render `<SentryDetailView data={...} onBack={() => setShowDetail(false)} />`

- [ ] **Step 2: Update App.tsx to use SentryAnalyzerView**

Replace the SentryPanel import and render:

```typescript
import { SentryAnalyzerView } from './components/sentry/SentryAnalyzerView';
// ...
{activeView === "sentry" && <SentryAnalyzerView />}
```

Remove the old SentryPanel import.

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/sentry/SentryAnalyzerView.tsx hadron-web/frontend/src/App.tsx
git commit -m "feat(frontend): add SentryAnalyzerView orchestrator, replace SentryPanel"
```

---

## Task 10: Frontend — SentryIssueBrowser & SentryIssueRow

**Files:**
- Create: `hadron-web/frontend/src/components/sentry/SentryIssueBrowser.tsx`
- Create: `hadron-web/frontend/src/components/sentry/SentryIssueRow.tsx`

- [ ] **Step 1: Create SentryIssueRow.tsx**

Component showing a single Sentry issue in a collapsed/expanded card:

**Props:** `{ issue: SentryIssue; onAnalyze: (id: string) => void }`

**Collapsed view:** Title, level badge (use `getLevelColor`), platform, status badge (use `getStatusColor`), event count (use `formatCount`), user count, relative time (use `formatRelativeTime`)

**Expanded view (toggle on click):** Short ID, Issue ID, first seen, last seen dates

**Actions:** "Analyze" button (emerald, calls `onAnalyze(issue.id)`), "View in Sentry" external link (if `issue.permalink`)

~80-120 lines.

- [ ] **Step 2: Create SentryIssueBrowser.tsx**

**Props:** `{ onAnalyze: (issueId: string) => void }`

**State:** `projects`, `selectedProject`, `issues`, `statusFilter`, `searchQuery`, `loading`

**On mount:** Load projects via `api.getSentryProjects()`

**UI:**
- Project dropdown
- Status filter (all / unresolved / resolved / ignored)
- Search input (debounced 400ms)
- Issue list → `SentryIssueRow` components
- "Load Issues" button or auto-load on project change

~150-200 lines.

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/sentry/SentryIssueBrowser.tsx hadron-web/frontend/src/components/sentry/SentryIssueRow.tsx
git commit -m "feat(frontend): add SentryIssueBrowser and SentryIssueRow"
```

---

## Task 11: Frontend — SentryQuickImport & SentryAnalysisHistory

**Files:**
- Create: `hadron-web/frontend/src/components/sentry/SentryQuickImport.tsx`
- Create: `hadron-web/frontend/src/components/sentry/SentryAnalysisHistory.tsx`

- [ ] **Step 1: Create SentryQuickImport.tsx**

**Props:** `{ onAnalyze: (issueId: string) => void }`

**Input:** Text field accepting numeric ID, short ID (PROJ-123), or full Sentry URL

**Parse logic:**
- Full URL: extract issue ID from `/issues/(\d+)/`
- Short ID: pass through (server resolves)
- Numeric: pass through

**Flow:** Enter → fetch issue via `api.getSentryIssue(parsed)` → show preview as `SentryIssueRow` → user clicks Analyze

~80-100 lines.

- [ ] **Step 2: Create SentryAnalysisHistory.tsx**

**Props:** `{ onView: (id: number) => void }`

**State:** `analyses`, `loading`, `searchQuery`

**On mount:** Load via `api.getSentryAnalyses()`

**UI:**
- Search bar (debounced 300ms, client-side filter on filename/errorType)
- List items: severity badge (`getSeverityColor`), error type, filename (short ID), analyzed date (`formatRelativeTime`)
- Click → calls `onView(analysis.id)`
- Delete button (calls `api.deleteSentryAnalysis(id)`, refreshes list)

~120-150 lines.

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/sentry/SentryQuickImport.tsx hadron-web/frontend/src/components/sentry/SentryAnalysisHistory.tsx
git commit -m "feat(frontend): add SentryQuickImport and SentryAnalysisHistory"
```

---

## Task 12: Frontend — SentryDetailView (7-Tab Report)

**Files:**
- Create: `hadron-web/frontend/src/components/sentry/SentryDetailView.tsx`

- [ ] **Step 1: Create SentryDetailView.tsx**

This is the main analysis report component. It renders 7 tabs using the parsed `full_data` from the analysis.

**Props:**
```typescript
interface SentryDetailViewProps {
  data: SentryAnalysisFullData;
  onBack: () => void;
}
```

**State:** `activeTab` (0-6)

**Header:** Back button, issue title, severity badge, "View in Sentry" link, "Copy Report" button

**7 tabs:** Overview | Patterns | Breadcrumbs | Stack Trace | Context | Impact | Recommendations

Each tab renders the corresponding sub-component:
1. **Overview (inline):** Error type, severity badge, root cause (text block), component, confidence badge, suggested fixes list
2. **Patterns:** `<SentryPatternCard patterns={data.patterns} aiPatternType={data.aiResult.patternType} />`
3. **Breadcrumbs:** `<SentryBreadcrumbTimeline breadcrumbs={data.event.breadcrumbs} />`
4. **Stack Trace:** `<SentryExceptionChain exceptions={data.event.exceptions} />`
5. **Context:** `<SentryRuntimeContext contexts={data.event.contexts} tags={data.event.tags} />`
6. **Impact:** `<SentryUserImpact issue={data.issue} userImpact={data.aiResult.userImpact} />`
7. **Recommendations:** `<SentryRecommendations recommendations={data.aiResult.recommendations} />`

~200-250 lines.

- [ ] **Step 2: Commit**

```bash
git add hadron-web/frontend/src/components/sentry/SentryDetailView.tsx
git commit -m "feat(frontend): add SentryDetailView with 7-tab layout"
```

---

## Task 13: Frontend — Detail Sub-Components (Part 1)

**Files:**
- Create: `hadron-web/frontend/src/components/sentry/SentryPatternCard.tsx`
- Create: `hadron-web/frontend/src/components/sentry/SentryBreadcrumbTimeline.tsx`
- Create: `hadron-web/frontend/src/components/sentry/SentryExceptionChain.tsx`

- [ ] **Step 1: Create SentryPatternCard.tsx**

**Props:** `{ patterns: DetectedPattern[]; aiPatternType: string }`

**UI:**
- If no patterns and aiPatternType is 'generic': show "No specific patterns detected" message
- AI classification card: emerald if specific pattern, blue if generic — shows pattern name and icon
- For each detected pattern: card with icon (`getPatternIcon`), name (`getPatternLabel`), confidence bar (percentage), evidence bullet list
- Remediation suggestions per pattern type (hardcoded guidance)

~120-160 lines.

- [ ] **Step 2: Create SentryBreadcrumbTimeline.tsx**

**Props:** `{ breadcrumbs: SentryBreadcrumb[] }`

**UI:**
- Vertical timeline with left-side line
- Each breadcrumb: colored dot (based on level), timestamp, category badge, message
- Category icon mapping: "http" → Globe, "query"/"db" → Database, "ui.click" → Mouse, default → Terminal (use text labels or simple SVG)
- Last breadcrumb highlighted in red (error point)
- Max 30 items (already bounded by normalizer)

~100-130 lines.

- [ ] **Step 3: Create SentryExceptionChain.tsx**

**Props:** `{ exceptions: SentryException[] }`

**UI:**
- Expandable cards (first expanded by default)
- Each exception: header (type, module), value text, frame count
- Frame table: APP/LIB badge (green/gray), function name, filename, line number
- Frames in reverse order (most recent first)

~100-140 lines.

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/sentry/SentryPatternCard.tsx hadron-web/frontend/src/components/sentry/SentryBreadcrumbTimeline.tsx hadron-web/frontend/src/components/sentry/SentryExceptionChain.tsx
git commit -m "feat(frontend): add pattern, breadcrumb, and exception detail components"
```

---

## Task 14: Frontend — Detail Sub-Components (Part 2)

**Files:**
- Create: `hadron-web/frontend/src/components/sentry/SentryRuntimeContext.tsx`
- Create: `hadron-web/frontend/src/components/sentry/SentryUserImpact.tsx`
- Create: `hadron-web/frontend/src/components/sentry/SentryRecommendations.tsx`

- [ ] **Step 1: Create SentryRuntimeContext.tsx**

**Props:** `{ contexts: Record<string, unknown>; tags: SentryTag[] }`

**UI:**
- Grid of context sections: OS, Browser, Device, Runtime (2-column grid)
- Each section: title, key-value pairs from the contexts object
- Tag list below: exclude `sentry:*` internal tags, show as pills

~80-100 lines.

- [ ] **Step 2: Create SentryUserImpact.tsx**

**Props:** `{ issue: SentryIssue; userImpact: string }`

**UI:**
- AI user impact assessment text block
- Stats grid (2x2): Total Events (`formatCount(issue.count)`), Affected Users (`formatCount(issue.userCount)`), First Seen (`formatRelativeTime(issue.firstSeen)`), Days Active (calculated from firstSeen to now)

~60-80 lines.

- [ ] **Step 3: Create SentryRecommendations.tsx**

**Props:** `{ recommendations: SentryRecommendation[] }`

**UI:**
- Priority-ordered cards (already sorted by AI)
- Each card: priority indicator (colored dot via `getPriorityColor`), title, description, effort badge (`getEffortColor`)
- If `codeSnippet` is non-null: render in a `<pre>` code block with copy button

~80-120 lines.

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/sentry/SentryRuntimeContext.tsx hadron-web/frontend/src/components/sentry/SentryUserImpact.tsx hadron-web/frontend/src/components/sentry/SentryRecommendations.tsx
git commit -m "feat(frontend): add context, impact, and recommendations components"
```

---

## Task 15: Integration Verification & Cleanup

**Files:**
- Possibly modify: various files for compilation fixes

- [ ] **Step 1: Verify backend compilation**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`

Fix any compilation errors.

- [ ] **Step 2: Run hadron-core tests**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- sentry`

Expected: All 25 sentry tests pass.

- [ ] **Step 3: Verify frontend build**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web/frontend && npm run build`

Fix any TypeScript errors.

- [ ] **Step 4: Delete old SentryPanel.tsx if still present**

If `SentryPanel.tsx` still exists and is no longer imported, delete it.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(web): complete Sentry deep analysis (Phase 3)"
```

---

## Summary

| Task | Component | Est. Steps |
|------|-----------|-----------|
| 1 | hadron-core types + normalizer | 6 |
| 2 | hadron-core pattern detectors | 7 |
| 3 | hadron-core prompt + parser | 5 |
| 4 | hadron-server admin config + DB | 5 |
| 5 | hadron-server refactor browse routes | 8 |
| 6 | hadron-server analysis routes | 4 |
| 7 | Frontend API types + methods | 3 |
| 8 | Frontend helpers + admin panel | 4 |
| 9 | Frontend SentryAnalyzerView | 3 |
| 10 | Frontend IssueBrowser + IssueRow | 3 |
| 11 | Frontend QuickImport + History | 3 |
| 12 | Frontend DetailView (7 tabs) | 2 |
| 13 | Frontend sub-components pt1 | 4 |
| 14 | Frontend sub-components pt2 | 4 |
| 15 | Integration verification | 5 |
| **Total** | | **66 steps** |
