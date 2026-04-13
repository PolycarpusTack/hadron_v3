# Web-Desktop Parity Phase 5: Performance Analyzer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the desktop's VisualWorks performance trace analyzer to the web with hybrid rule-based parsing + optional AI enrichment for scenario narratives and recommendations.

**Architecture:** hadron-core gets a new `performance/` module (types, regex parser, pattern detectors, metrics, scenario) plus `ai/performance.rs` (AI enrichment prompt/parser). hadron-server gets analyze routes (rule-based + AI-enriched SSE streaming) with persistence to the `analyses` table. Frontend gets a PerformanceAnalyzerView with file upload, 7 collapsible result sections, and AI narrative enrichment.

**Tech Stack:** Rust (hadron-core with regex, Axum), React 18, TypeScript, SSE streaming

**Spec:** `docs/plans/2026-04-13-web-parity-phase5-design.md`

---

## File Map

### hadron-core (create)
- `hadron-web/crates/hadron-core/src/performance/mod.rs` — module re-exports
- `hadron-web/crates/hadron-core/src/performance/types.rs` — all data structures
- `hadron-web/crates/hadron-core/src/performance/parser.rs` — trace file parser (regex)
- `hadron-web/crates/hadron-core/src/performance/patterns.rs` — 8 pattern detectors + recommendations
- `hadron-web/crates/hadron-core/src/performance/metrics.rs` — derived metrics computation
- `hadron-web/crates/hadron-core/src/performance/scenario.rs` — heuristic scenario reconstruction
- `hadron-web/crates/hadron-core/src/ai/performance.rs` — AI enrichment prompt/parser

### hadron-core (modify)
- `hadron-web/crates/hadron-core/src/lib.rs` — add `pub mod performance`
- `hadron-web/crates/hadron-core/src/ai/mod.rs` — add `pub mod performance` + re-export
- `hadron-web/crates/hadron-core/Cargo.toml` — add `regex` + `once_cell` dependencies (if not present)

### hadron-server (create)
- `hadron-web/crates/hadron-server/src/routes/performance.rs` — analyze routes + CRUD

### hadron-server (modify)
- `hadron-web/crates/hadron-server/src/routes/mod.rs` — register routes
- `hadron-web/crates/hadron-server/src/db/mod.rs` — add performance analysis DB helpers

### Frontend (create)
- `hadron-web/frontend/src/components/performance/PerformanceAnalyzerView.tsx`
- `hadron-web/frontend/src/components/performance/PerformanceFileUpload.tsx`
- `hadron-web/frontend/src/components/performance/PerformanceResults.tsx`
- `hadron-web/frontend/src/components/performance/PerformanceHeaderStats.tsx`
- `hadron-web/frontend/src/components/performance/PerformanceProcesses.tsx`
- `hadron-web/frontend/src/components/performance/PerformanceTopMethods.tsx`
- `hadron-web/frontend/src/components/performance/PerformancePatterns.tsx`
- `hadron-web/frontend/src/components/performance/PerformanceScenario.tsx`
- `hadron-web/frontend/src/components/performance/PerformanceRecommendations.tsx`
- `hadron-web/frontend/src/components/performance/performanceHelpers.ts`

### Frontend (modify)
- `hadron-web/frontend/src/services/api.ts` — types + methods
- `hadron-web/frontend/src/App.tsx` — add "performance" view

---

## Task 1: hadron-core — Performance Types

**Files:**
- Create: `hadron-web/crates/hadron-core/src/performance/mod.rs`
- Create: `hadron-web/crates/hadron-core/src/performance/types.rs`
- Modify: `hadron-web/crates/hadron-core/src/lib.rs`

- [ ] **Step 1: Create types.rs with all data structures**

Port the types from the desktop's `commands/performance.rs`. All types get `#[derive(Debug, Clone, Serialize, Deserialize, Default)]` and `#[serde(rename_all = "camelCase")]`.

Key types: `PerformanceTraceResult`, `PerformanceHeader`, `DerivedMetrics`, `ProcessInfo`, `TopMethod`, `DetectedPattern`, `UserScenario`, `Recommendation`.

The `PerformanceTraceResult` is the top-level result containing all sub-structures.

- [ ] **Step 2: Create mod.rs with re-exports**

```rust
pub mod types;
pub use types::*;
```

- [ ] **Step 3: Register in lib.rs**

Add `pub mod performance;` to `hadron-web/crates/hadron-core/src/lib.rs`.

- [ ] **Step 4: Verify and commit**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check -p hadron-core`

```bash
git add hadron-web/crates/hadron-core/src/performance/ hadron-web/crates/hadron-core/src/lib.rs
git commit -m "feat(core): add performance analyzer types"
```

---

## Task 2: hadron-core — Trace Parser

**Files:**
- Create: `hadron-web/crates/hadron-core/src/performance/parser.rs`
- Modify: `hadron-web/crates/hadron-core/src/performance/mod.rs`
- Possibly modify: `hadron-web/crates/hadron-core/Cargo.toml` (add `regex` if not present)

- [ ] **Step 1: Check if regex is already a dependency**

```bash
grep -c "regex" hadron-web/crates/hadron-core/Cargo.toml
```

If not present, add `regex = "1"` to `[dependencies]`. Also check for `once_cell` — if not present, use `std::sync::OnceLock` (stable since Rust 1.70).

- [ ] **Step 2: Create parser.rs**

Port the desktop's parser functions directly. The file should contain:

```rust
use regex::Regex;
use std::sync::OnceLock;
use crate::error::{HadronError, HadronResult};
use super::types::*;

const MAX_FILE_SIZE: usize = 10 * 1024 * 1024; // 10MB

pub fn parse_trace(content: &str, filename: &str) -> HadronResult<PerformanceTraceResult> {
    if content.len() > MAX_FILE_SIZE {
        return Err(HadronError::validation("Trace file exceeds 10MB limit"));
    }
    let lines: Vec<&str> = content.lines().collect();
    let header = parse_header(&lines);
    let derived = super::metrics::compute_derived(&header);
    let processes = parse_processes(&lines);
    let top_methods = parse_top_methods(&lines);
    let patterns = super::patterns::detect_patterns(&header, &derived, &processes, &top_methods, content);
    let scenario = super::scenario::reconstruct_scenario(&patterns, &top_methods, content);
    let recommendations = super::patterns::generate_recommendations(&patterns, &derived);
    let overall_severity = determine_severity(&patterns);
    let summary = generate_summary(&patterns, &derived);
    let (user, timestamp) = extract_metadata(filename);

    Ok(PerformanceTraceResult {
        filename: filename.to_string(),
        user, timestamp,
        header, derived, processes, top_methods,
        patterns, scenario, recommendations,
        overall_severity, summary,
    })
}
```

Port the following functions from desktop:
- `parse_header(lines)` — extracts stats via keyword matching + `extract_number`/`extract_float` regex helpers
- `parse_processes(lines)` — regex `([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(?:@\s*)?(\d+|-)\s+(\d+\.?\d*)%?`
- `parse_top_methods(lines)` — regex `(\d+\.?\d*)%?\s+(.+)`, limit to 8
- `categorize_method(method)` — keyword matching: FFI > Graphics > GC > Database > UI > Collection > Session > Other
- `extract_number(text)` — regex `[\d,]+(?:\.\d+)?`
- `extract_float(text)` — regex `\d+\.?\d*`
- `extract_metadata(filename)` — parse `performanceTrace_user_date_time.log` pattern
- `determine_severity(patterns)` — highest pattern severity
- `generate_summary(patterns, derived)` — one-line summary

Use `OnceLock<Regex>` for static regex (instead of desktop's `once_cell::sync::Lazy`):
```rust
fn num_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[\d,]+(?:\.\d+)?").unwrap())
}
```

- [ ] **Step 3: Register in mod.rs**

Add `pub mod parser;` and `pub use parser::parse_trace;`.

- [ ] **Step 4: Add tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn sample_trace() -> String {
        // Minimal VisualWorks trace content for testing
        "Samples: 1500\n\
         avg ms/sample: 2.5\n\
         Scavenges: 3000\n\
         incGC: 50\n\
         stackSpills: 2\n\
         markStackOverflows: 0\n\
         weakListOverflows: 0\n\
         jitCacheSpills: 1\n\
         active time: 3.75\n\
         other processes: 0.5\n\
         real time: 5.0\n\
         profiling overhead: 0.1\n\
         \n\
         Process              Priority  Samples\n\
         LauncherProcess      @ 50      85.5%\n\
         IdleLoopProcess      @ 10      10.2%\n\
         BackgroundProcess    @ 20      4.3%\n\
         \n\
         Totals\n\
         25.3% ExternalMethodRef>>primCallC:\n\
         15.1% GraphicsContext>>paint\n\
         8.2% PostgresSession>>execute\n\
         5.0% OrderedCollection>>do:\n".to_string()
    }

    #[test]
    fn test_parse_header_stats() {
        let result = parse_trace(&sample_trace(), "test.log").unwrap();
        assert_eq!(result.header.samples, 1500);
        assert!((result.header.avg_ms_per_sample - 2.5).abs() < 0.01);
        assert_eq!(result.header.scavenges, 3000);
        assert_eq!(result.header.inc_gcs, 50);
        assert!((result.header.active_time - 3.75).abs() < 0.01);
        assert!((result.header.real_time - 5.0).abs() < 0.01);
    }

    #[test]
    fn test_parse_processes() {
        let result = parse_trace(&sample_trace(), "test.log").unwrap();
        assert!(result.processes.len() >= 2);
        assert!(result.processes.iter().any(|p| p.name.contains("Launcher")));
    }

    #[test]
    fn test_parse_top_methods() {
        let result = parse_trace(&sample_trace(), "test.log").unwrap();
        assert!(!result.top_methods.is_empty());
        assert!(result.top_methods[0].percentage > 0.0);
        // First method should be FFI/External
        assert_eq!(result.top_methods[0].category, "FFI/External");
    }

    #[test]
    fn test_parse_empty_file() {
        let result = parse_trace("", "empty.log").unwrap();
        assert_eq!(result.header.samples, 0);
        assert!(result.processes.is_empty());
        assert!(result.top_methods.is_empty());
    }
}
```

- [ ] **Step 5: Verify and commit**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- performance`

```bash
git add hadron-web/crates/hadron-core/src/performance/parser.rs hadron-web/crates/hadron-core/src/performance/mod.rs hadron-web/crates/hadron-core/Cargo.toml
git commit -m "feat(core): add VisualWorks trace parser with regex extraction"
```

---

## Task 3: hadron-core — Patterns, Metrics, Scenario

**Files:**
- Create: `hadron-web/crates/hadron-core/src/performance/patterns.rs`
- Create: `hadron-web/crates/hadron-core/src/performance/metrics.rs`
- Create: `hadron-web/crates/hadron-core/src/performance/scenario.rs`
- Modify: `hadron-web/crates/hadron-core/src/performance/mod.rs`

- [ ] **Step 1: Create metrics.rs**

Port `calculate_derived_metrics` from desktop:
```rust
pub fn compute_derived(header: &PerformanceHeader) -> DerivedMetrics {
    let total_time = header.active_time + header.other_processes;
    let cpu_utilization = if total_time > 0.0 {
        (total_time / header.real_time.max(total_time)) * 100.0
    } else { 0.0 };
    let activity_ratio = if header.real_time > 0.0 {
        (header.active_time / header.real_time) * 100.0
    } else { 0.0 };
    let sample_density = if header.active_time > 0.0 {
        header.samples as f64 / header.active_time
    } else { 0.0 };
    let gc_pressure = if header.samples > 0 {
        (header.scavenges + header.inc_gcs) as f64 / header.samples as f64
    } else { 0.0 };
    DerivedMetrics {
        cpu_utilization: (cpu_utilization * 10.0).round() / 10.0,
        activity_ratio: (activity_ratio * 10.0).round() / 10.0,
        sample_density: (sample_density * 10.0).round() / 10.0,
        gc_pressure: (gc_pressure * 100.0).round() / 100.0,
    }
}
```

- [ ] **Step 2: Create patterns.rs**

Port `detect_patterns` (8 detectors) and `generate_recommendations` from desktop. These are pure functions operating on the parsed data — no I/O.

- [ ] **Step 3: Create scenario.rs**

Port `reconstruct_scenario` from desktop — determines trigger, action, context, impact percentage, contributing factors.

- [ ] **Step 4: Register in mod.rs**

```rust
pub mod types;
pub mod parser;
pub mod patterns;
pub mod metrics;
pub mod scenario;

pub use types::*;
pub use parser::parse_trace;
```

- [ ] **Step 5: Add tests**

In `patterns.rs`:
```rust
#[test]
fn test_detect_gc_pressure() — header with scavenges > 5000 triggers detection
#[test]
fn test_detect_database_activity() — methods with Database category > 5%
#[test]
fn test_detect_changelog_sync() — content containing "ChangeLogSynchronizer"
#[test]
fn test_no_false_positives() — clean data produces empty patterns
```

In `metrics.rs`:
```rust
#[test]
fn test_derived_metrics() — known header → expected values
#[test]
fn test_derived_metrics_zero_time() — zero real_time → no panic
```

In `scenario.rs`:
```rust
#[test]
fn test_scenario_with_changelog() — changelog pattern → correct trigger
#[test]
fn test_scenario_default() — no patterns → generic scenario
```

- [ ] **Step 6: Verify and commit**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- performance`

```bash
git add hadron-web/crates/hadron-core/src/performance/
git commit -m "feat(core): add performance pattern detectors, metrics, and scenario reconstruction"
```

---

## Task 4: hadron-core — AI Enrichment Prompt

**Files:**
- Create: `hadron-web/crates/hadron-core/src/ai/performance.rs`
- Modify: `hadron-web/crates/hadron-core/src/ai/mod.rs`

- [ ] **Step 1: Create ai/performance.rs**

```rust
use serde::{Deserialize, Serialize};
use crate::error::{HadronError, HadronResult};
use crate::performance::types::*;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceEnrichment {
    #[serde(default)]
    pub scenario_narrative: String,
    #[serde(default)]
    pub recommendations: Vec<Recommendation>,
    #[serde(default)]
    pub summary: String,
}

pub const PERFORMANCE_ENRICHMENT_PROMPT: &str = r#"You are a performance analysis expert. Given structured profiling data from a VisualWorks Smalltalk application, provide:

1. A clear, contextual narrative explaining what happened during the trace period (2-4 sentences)
2. Prioritized recommendations for improvement (3-5 items)
3. A one-sentence executive summary

Return ONLY valid JSON:
{
  "scenarioNarrative": "What happened and why...",
  "recommendations": [
    { "recType": "optimization|workaround|investigation|configuration", "title": "Short title", "priority": "high|medium|low", "description": "What to do and why", "effort": "low|medium|high" }
  ],
  "summary": "One-sentence summary"
}"#;

pub fn build_performance_enrichment_messages(
    result: &PerformanceTraceResult,
) -> (String, Vec<super::types::AiMessage>) {
    let system = PERFORMANCE_ENRICHMENT_PROMPT.to_string();

    let user_content = format!(
        "Analyze this VisualWorks performance trace:\n\n\
         File: {}\nUser: {}\n\n\
         Metrics: CPU {:.1}%, Activity {:.1}%, GC Pressure {:.2}, Samples {}\n\n\
         Detected Patterns:\n{}\n\n\
         Top Methods:\n{}\n\n\
         Current Scenario: {} → {}",
        result.filename,
        result.user.as_deref().unwrap_or("unknown"),
        result.derived.cpu_utilization,
        result.derived.activity_ratio,
        result.derived.gc_pressure,
        result.header.samples,
        result.patterns.iter()
            .map(|p| format!("- [{}] {} ({}%)", p.severity, p.title, p.confidence))
            .collect::<Vec<_>>().join("\n"),
        result.top_methods.iter().take(5)
            .map(|m| format!("- {:.1}% {} ({})", m.percentage, m.method, m.category))
            .collect::<Vec<_>>().join("\n"),
        result.scenario.trigger,
        result.scenario.action,
    );

    let messages = vec![super::types::AiMessage {
        role: "user".to_string(),
        content: user_content,
    }];
    (system, messages)
}

pub fn parse_performance_enrichment(raw: &str) -> HadronResult<PerformanceEnrichment> {
    let json_str = super::parsers::strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        let mut end = json_str.len().min(300);
        while end > 0 && !json_str.is_char_boundary(end) { end -= 1; }
        let preview = &json_str[..end];
        HadronError::Parse(format!("Failed to parse performance enrichment: {e}. Preview: {preview}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_enrichment_prompt() {
        let result = PerformanceTraceResult {
            filename: "trace.log".to_string(),
            derived: DerivedMetrics { cpu_utilization: 85.0, activity_ratio: 70.0, gc_pressure: 0.5, sample_density: 400.0 },
            header: PerformanceHeader { samples: 1500, ..Default::default() },
            scenario: UserScenario { trigger: "Application".to_string(), action: "Processing".to_string(), ..Default::default() },
            ..Default::default()
        };
        let (system, messages) = build_performance_enrichment_messages(&result);
        assert!(system.contains("performance analysis expert"));
        assert!(messages[0].content.contains("trace.log"));
        assert!(messages[0].content.contains("85.0%"));
    }

    #[test]
    fn test_parse_enrichment_response() {
        let json = r#"{"scenarioNarrative": "The system was busy", "recommendations": [{"recType": "optimization", "title": "Fix GC", "priority": "high", "description": "Reduce allocations", "effort": "medium"}], "summary": "High GC pressure detected"}"#;
        let result = parse_performance_enrichment(json).unwrap();
        assert!(!result.scenario_narrative.is_empty());
        assert_eq!(result.recommendations.len(), 1);
        assert!(!result.summary.is_empty());
    }
}
```

- [ ] **Step 2: Register in ai/mod.rs**

Add `pub mod performance;` and `pub use performance::*;` (for `PerformanceEnrichment`).

Wait — there's a naming collision since we already export `performance` from `lib.rs`. Name the AI module differently: `pub mod performance_ai;` or keep it as `performance` but only in `ai/` scope. Actually, since `ai/mod.rs` uses `pub use performance::*;`, the types from `ai::performance` would conflict with `crate::performance::*`. Better approach: don't glob-export the AI performance module. Just:

```rust
pub mod performance;
// no pub use — access as hadron_core::ai::performance::*
```

- [ ] **Step 3: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- performance
git add hadron-web/crates/hadron-core/src/ai/performance.rs hadron-web/crates/hadron-core/src/ai/mod.rs
git commit -m "feat(core): add AI performance enrichment prompt and parser"
```

---

## Task 5: hadron-server — Routes & DB Helpers

**Files:**
- Create: `hadron-web/crates/hadron-server/src/routes/performance.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`

- [ ] **Step 1: Add DB helpers**

In `db/mod.rs`:

```rust
pub async fn insert_performance_analysis(
    pool: &PgPool, user_id: Uuid, filename: &str,
    severity: Option<&str>, component: Option<&str>,
    full_data: Option<&serde_json::Value>,
) -> HadronResult<i64> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO analyses (
            user_id, filename, analysis_type, severity, component, full_data
         ) VALUES ($1, $2, 'performance', $3, $4, $5)
         RETURNING id",
    )
    .bind(user_id).bind(filename).bind(severity).bind(component).bind(full_data)
    .fetch_one(pool).await
    .map_err(|e| HadronError::database(e.to_string()))?;
    Ok(row.0)
}

pub async fn get_performance_analyses(
    pool: &PgPool, user_id: Uuid, limit: i64, offset: i64,
) -> HadronResult<(Vec<serde_json::Value>, i64)> {
    // Same pattern as get_sentry_analyses but with analysis_type = 'performance'
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analyses WHERE user_id = $1 AND analysis_type = 'performance' AND deleted_at IS NULL",
    ).bind(user_id).fetch_one(pool).await.map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<(i64, String, Option<String>, Option<String>, Option<serde_json::Value>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, filename, severity, component, full_data, analyzed_at
         FROM analyses WHERE user_id = $1 AND analysis_type = 'performance' AND deleted_at IS NULL
         ORDER BY analyzed_at DESC LIMIT $2 OFFSET $3",
    ).bind(user_id).bind(limit).bind(offset).fetch_all(pool).await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let items = rows.iter().map(|r| serde_json::json!({
        "id": r.0, "filename": r.1, "severity": r.2, "component": r.3, "analyzedAt": r.5.to_rfc3339(),
    })).collect();
    Ok((items, count.0))
}
```

- [ ] **Step 2: Create routes/performance.rs**

```rust
use axum::{extract::{Path, Query, State}, response::IntoResponse, Json};
use serde::Deserialize;
use crate::auth::AuthenticatedUser;
use crate::routes::AppError;
use crate::AppState;
use crate::{ai, db};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub content: String,
    pub filename: String,
}

/// POST /api/performance/analyze — rule-based only
pub async fn analyze(
    _user: AuthenticatedUser,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let result = hadron_core::performance::parse_trace(&req.content, &req.filename)
        .map_err(|e| AppError(e))?;
    Ok(Json(result))
}

/// POST /api/performance/analyze/enrich — rule-based + AI streaming
pub async fn analyze_enrich(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let ai_config = crate::routes::analyses::resolve_ai_config(&state.db, None, None, None).await?;

    // Phase 1: Parse (instant)
    let mut result = hadron_core::performance::parse_trace(&req.content, &req.filename)
        .map_err(|e| AppError(e))?;

    // Phase 2: AI enrichment (non-streaming for simplicity — enrichment responses are small)
    let (system, messages) = hadron_core::ai::performance::build_performance_enrichment_messages(&result);
    if let Ok(raw) = ai::complete(&ai_config, messages, Some(&system)).await {
        if let Ok(enrichment) = hadron_core::ai::performance::parse_performance_enrichment(&raw) {
            // Override scenario narrative and recommendations with AI versions
            result.scenario.action = enrichment.scenario_narrative;
            result.recommendations = enrichment.recommendations;
            result.summary = enrichment.summary;
        }
    }

    // Phase 3: Persist
    let full_data = serde_json::to_value(&result).ok();
    let _ = db::insert_performance_analysis(
        &state.db, user.user.id, &req.filename,
        Some(&result.overall_severity),
        result.top_methods.first().map(|m| m.category.as_str()),
        full_data.as_ref(),
    ).await;

    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct AnalysesQuery { pub limit: Option<i64>, pub offset: Option<i64> }

pub async fn list_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<AnalysesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let (items, total) = db::get_performance_analyses(&state.db, user.user.id, params.limit.unwrap_or(20).min(100), params.offset.unwrap_or(0)).await?;
    Ok(Json(serde_json::json!({ "items": items, "total": total })))
}

pub async fn get_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let analysis = db::get_analysis_by_id(&state.db, id, user.user.id).await?;
    Ok(Json(analysis))
}

pub async fn delete_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    db::delete_analysis(&state.db, id, user.user.id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
```

Note: The enrichment is done non-streaming (single `ai::complete` call) since the enrichment response is small. This is simpler than SSE and still gives AI-enhanced results. If the user just wants rule-based results, they use `/analyze` (instant).

- [ ] **Step 3: Register routes**

In `routes/mod.rs`:
```rust
mod performance;
// ...
.route("/performance/analyze", post(performance::analyze))
.route("/performance/analyze/enrich", post(performance::analyze_enrich))
.route("/performance/analyses", get(performance::list_analyses))
.route("/performance/analyses/{id}", get(performance::get_analysis))
.route("/performance/analyses/{id}", delete(performance::delete_analysis))
```

- [ ] **Step 4: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check
git add hadron-web/crates/hadron-server/src/routes/performance.rs hadron-web/crates/hadron-server/src/routes/mod.rs hadron-web/crates/hadron-server/src/db/mod.rs
git commit -m "feat(server): add performance analyzer routes and DB helpers"
```

---

## Task 6: Frontend — API Types & Methods

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`

- [ ] **Step 1: Add types**

```typescript
// ── Performance Analyzer Types ────────────────────────────────────────

export interface PerformanceTraceResult {
  filename: string;
  user: string | null;
  timestamp: string | null;
  header: PerformanceHeader;
  derived: DerivedMetrics;
  processes: ProcessInfo[];
  topMethods: TopMethod[];
  patterns: PerfDetectedPattern[];
  scenario: UserScenario;
  recommendations: PerfRecommendation[];
  overallSeverity: string;
  summary: string;
}

export interface PerformanceHeader {
  samples: number; avgMsPerSample: number;
  scavenges: number; incGcs: number;
  stackSpills: number; markStackOverflows: number;
  weakListOverflows: number; jitCacheSpills: number;
  activeTime: number; otherProcesses: number;
  realTime: number; profilingOverhead: number;
}

export interface DerivedMetrics {
  cpuUtilization: number; activityRatio: number;
  sampleDensity: number; gcPressure: number;
}

export interface ProcessInfo {
  name: string; priority: string;
  percentage: number; status: string;
}

export interface TopMethod {
  method: string; category: string; percentage: number;
}

export interface PerfDetectedPattern {
  patternType: string; severity: string;
  title: string; description: string; confidence: number;
}

export interface UserScenario {
  trigger: string; action: string; context: string;
  impactPercentage: number; contributingFactors: string[];
}

export interface PerfRecommendation {
  recType: string; title: string; priority: string;
  description: string; effort: string;
}

export interface PerformanceAnalysisSummary {
  id: number; filename: string; severity: string | null;
  component: string | null; analyzedAt: string;
}
```

- [ ] **Step 2: Add API methods**

```typescript
  async analyzePerformanceTrace(content: string, filename: string): Promise<PerformanceTraceResult> {
    return this.request('/performance/analyze', 'POST', { content, filename });
  }

  async analyzePerformanceTraceEnriched(content: string, filename: string): Promise<PerformanceTraceResult> {
    return this.request('/performance/analyze/enrich', 'POST', { content, filename });
  }

  async getPerformanceAnalyses(limit?: number, offset?: number): Promise<{ items: PerformanceAnalysisSummary[]; total: number }> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    return this.request(`/performance/analyses?${params}`);
  }

  async getPerformanceAnalysis(id: number): Promise<unknown> {
    return this.request(`/performance/analyses/${id}`);
  }

  async deletePerformanceAnalysis(id: number): Promise<void> {
    await this.request(`/performance/analyses/${id}`, 'DELETE');
  }
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts
git commit -m "feat(frontend): add performance analyzer types and API methods"
```

---

## Task 7: Frontend — Helper Utilities & File Upload

**Files:**
- Create: `hadron-web/frontend/src/components/performance/performanceHelpers.ts`
- Create: `hadron-web/frontend/src/components/performance/PerformanceFileUpload.tsx`

- [ ] **Step 1: Create performanceHelpers.ts**

```typescript
export function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-600 text-white';
    case 'high': return 'bg-red-100 text-red-800';
    case 'medium': return 'bg-yellow-100 text-yellow-800';
    case 'low': return 'bg-green-100 text-green-800';
    case 'info': return 'bg-blue-100 text-blue-800';
    case 'warning': return 'bg-amber-100 text-amber-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getMethodBarColor(percentage: number): string {
  if (percentage >= 20) return 'bg-red-500';
  if (percentage >= 10) return 'bg-orange-500';
  if (percentage >= 5) return 'bg-yellow-500';
  return 'bg-blue-500';
}

export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'FFI/External': 'bg-purple-100 text-purple-800',
    'Graphics': 'bg-pink-100 text-pink-800',
    'GC': 'bg-red-100 text-red-800',
    'Database': 'bg-blue-100 text-blue-800',
    'UI Rendering': 'bg-orange-100 text-orange-800',
    'Collection': 'bg-green-100 text-green-800',
    'Session': 'bg-cyan-100 text-cyan-800',
    'Other': 'bg-gray-100 text-gray-600',
  };
  return colors[category] || colors['Other'];
}

export function getRecTypeIcon(recType: string): string {
  const icons: Record<string, string> = {
    optimization: '\u2699\uFE0F',
    workaround: '\u{1F527}',
    investigation: '\u{1F50D}',
    configuration: '\u2699\uFE0F',
    documentation: '\u{1F4DD}',
  };
  return icons[recType] || '\u{1F4CB}';
}

export function formatSeconds(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  return `${(seconds / 60).toFixed(1)}min`;
}
```

- [ ] **Step 2: Create PerformanceFileUpload.tsx (~80 lines)**

Props: `{ onAnalyze: (content: string, filename: string) => void; loading: boolean }`

UI:
- File input accepting .log and .txt
- Shows filename + size when selected
- "Analyze" button (teal-600) — reads file via FileReader, calls `onAnalyze(text, file.name)`
- File size validation (<10MB) client-side

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/performance/
git commit -m "feat(frontend): add performance helpers and file upload component"
```

---

## Task 8: Frontend — PerformanceAnalyzerView & Result Components

**Files:**
- Create: `hadron-web/frontend/src/components/performance/PerformanceAnalyzerView.tsx`
- Create: `hadron-web/frontend/src/components/performance/PerformanceResults.tsx`
- Create: `hadron-web/frontend/src/components/performance/PerformanceHeaderStats.tsx`
- Create: `hadron-web/frontend/src/components/performance/PerformanceProcesses.tsx`
- Create: `hadron-web/frontend/src/components/performance/PerformanceTopMethods.tsx`
- Create: `hadron-web/frontend/src/components/performance/PerformancePatterns.tsx`
- Create: `hadron-web/frontend/src/components/performance/PerformanceScenario.tsx`
- Create: `hadron-web/frontend/src/components/performance/PerformanceRecommendations.tsx`

- [ ] **Step 1: Create PerformanceAnalyzerView.tsx (~150 lines)**

Orchestrator with two phases (upload → results):
- "AI Enrich" checkbox (default on) — determines endpoint
- Upload: `<PerformanceFileUpload onAnalyze={handleAnalyze} loading={loading} />`
- Results: `<PerformanceResults result={...} />` + "New Analysis" reset button
- Error display
- Teal color scheme

`handleAnalyze`: if AI enrich, call `api.analyzePerformanceTraceEnriched(content, filename)`, else `api.analyzePerformanceTrace(content, filename)`.

- [ ] **Step 2: Create PerformanceResults.tsx (~80 lines)**

Container with 7 collapsible sections. Each section has a header (clickable to toggle) and content.

- [ ] **Step 3: Create sub-components**

Each ~60-100 lines:
- `PerformanceHeaderStats` — 4 primary metric cards (Samples, Real Time, Active Time, GC Events) + 4 secondary (spills/overflows) + 4 derived metrics (CPU%, Activity%, Sample Density, GC Pressure)
- `PerformanceProcesses` — table with progress bars and status badges
- `PerformanceTopMethods` — table with category badges and percentage bars
- `PerformancePatterns` — severity-colored cards with confidence percentages
- `PerformanceScenario` — trigger/impact grid, narrative block, contributing factors
- `PerformanceRecommendations` — cards with type icon, priority badge, effort estimate

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/performance/
git commit -m "feat(frontend): add PerformanceAnalyzerView with all result sub-components"
```

---

## Task 9: Frontend — App.tsx Wiring & Verification

**Files:**
- Modify: `hadron-web/frontend/src/App.tsx`

- [ ] **Step 1: Wire into App.tsx**

Add "performance" to the View type union. Add navigation entry: `{ key: "performance", label: "Performance" }`. Add conditional render: `{activeView === "performance" && <PerformanceAnalyzerView />}`.

Import: `import { PerformanceAnalyzerView } from './components/performance/PerformanceAnalyzerView';`

- [ ] **Step 2: Verify backend**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- performance
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check
```

- [ ] **Step 3: Verify frontend**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web/frontend && npx tsc --noEmit && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/App.tsx
git commit -m "feat(frontend): wire PerformanceAnalyzerView into app navigation"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | hadron-core | Performance types |
| 2 | hadron-core | Trace parser (regex) + tests |
| 3 | hadron-core | Pattern detectors, metrics, scenario + tests |
| 4 | hadron-core | AI enrichment prompt/parser + tests |
| 5 | hadron-server | Routes + DB helpers |
| 6 | Frontend | API types + methods |
| 7 | Frontend | Helpers + file upload |
| 8 | Frontend | AnalyzerView + 7 result sub-components |
| 9 | Frontend | App.tsx wiring + verification |
