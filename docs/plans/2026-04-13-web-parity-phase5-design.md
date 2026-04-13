# Web-Desktop Parity Phase 5: Performance Analyzer

**Date:** 2026-04-13
**Status:** Design approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`

## Overview

Port the desktop's VisualWorks performance trace analyzer to the web with hybrid approach: rule-based parsing + pattern detection (deterministic, fast) with optional AI enrichment for richer scenario narratives and recommendations. Single file analysis, results persisted in the existing `analyses` table.

## Design Decisions

1. **Hybrid approach:** Rule-based parser + pattern detection in hadron-core (no AI cost). Optional AI enrichment step generates better narrative + recommendations via SSE streaming.
2. **Storage:** Reuse `analyses` table with `analysis_type = 'performance'`. No new migration.
3. **Single file:** One trace file per analysis (no batch). Simpler, matches web patterns.
4. **File upload:** Client reads file via FileReader, sends text content as JSON body (same pattern as Code Analyzer). No multipart.
5. **Module structure:** `hadron-core::performance` as a separate module from `ai/` since the parser is rule-based. AI enrichment prompt lives in `ai/performance.rs`.

---

## 1. hadron-core — `performance` Module

### Module Structure

```
hadron-core/src/performance/
├── mod.rs           — re-exports
├── types.rs         — all data structures
├── parser.rs        — trace file parser (regex)
├── patterns.rs      — 8 pattern detectors
├── metrics.rs       — derived metrics computation
├── scenario.rs      — heuristic scenario reconstruction

hadron-core/src/ai/
├── performance.rs   — AI enrichment prompt/parser
```

### Types (`types.rs`)

```rust
pub struct PerformanceTraceResult {
    pub filename: String,
    pub user: Option<String>,
    pub timestamp: Option<String>,
    pub header: PerformanceHeader,
    pub derived: DerivedMetrics,
    pub processes: Vec<ProcessInfo>,
    pub top_methods: Vec<TopMethod>,
    pub patterns: Vec<DetectedPattern>,
    pub scenario: UserScenario,
    pub recommendations: Vec<Recommendation>,
    pub overall_severity: String,
    pub summary: String,
}

pub struct PerformanceHeader {
    pub samples: u64,
    pub avg_ms_per_sample: f64,
    pub scavenges: u64,
    pub inc_gcs: u64,
    pub stack_spills: u64,
    pub mark_stack_overflows: u64,
    pub weak_list_overflows: u64,
    pub jit_cache_spills: u64,
    pub active_time: f64,       // seconds
    pub other_processes: f64,
    pub real_time: f64,
    pub profiling_overhead: f64,
}

pub struct DerivedMetrics {
    pub cpu_utilization: f64,       // (active + other) / real * 100
    pub activity_ratio: f64,        // active / real * 100
    pub sample_density: f64,        // samples / active
    pub gc_pressure: f64,           // (scavenges + inc_gcs) / samples
}

pub struct ProcessInfo {
    pub name: String,
    pub priority: String,
    pub percentage: f64,
    pub status: String,             // normal | warning | error
}

pub struct TopMethod {
    pub method: String,
    pub category: String,           // FFI, Graphics, GC, Database, UI, Collection, Session, Other
    pub percentage: f64,
}

pub struct DetectedPattern {
    pub pattern_type: String,
    pub severity: String,           // critical | high | medium | low | info
    pub title: String,
    pub description: String,
    pub confidence: f64,            // 0.0-1.0
}

pub struct UserScenario {
    pub trigger: String,
    pub action: String,
    pub context: String,
    pub impact_percentage: f64,
    pub contributing_factors: Vec<String>,
}

pub struct Recommendation {
    pub rec_type: String,           // optimization | workaround | investigation | configuration
    pub title: String,
    pub priority: String,           // high | medium | low
    pub description: String,
    pub effort: String,             // low | medium | high
}
```

### Parser (`parser.rs`)

`pub fn parse_trace(content: &str, filename: &str) -> HadronResult<PerformanceTraceResult>`

- Extracts header stats via regex (flexible patterns for VisualWorks naming)
- Parses process distribution: `(Name) @ (Priority) (Percentage%)`
- Parses top methods by self-time (limit to 8)
- Auto-categorizes methods: FFI > Graphics > GC > Database > UI > Collection > Session > Other
- Extracts username/timestamp from filename pattern `performanceTrace_user_YYYY-MM-DD_HH-MM-SS.log`
- File size validation: reject >10MB

### Pattern Detectors (`patterns.rs`)

`pub fn detect_patterns(header: &PerformanceHeader, derived: &DerivedMetrics, processes: &[ProcessInfo], methods: &[TopMethod], content: &str) -> Vec<DetectedPattern>`

8 detectors:
1. **GC Pressure** — gc_pressure > 1.0 or scavenges > 5000 (high/medium, 90%)
2. **UI Rendering Overhead** — Graphics + UI methods > 10% CPU (high/medium, 85-92%)
3. **Database Activity** — DB methods > 5% (high/medium/low, 90%)
4. **Change Log Sync** — "ChangeLogSynchronizer" in content (high, 92%)
5. **Widget Update Cascade** — "updateWidgetsInApplications" in content (medium, 85%)
6. **Low Activity Ratio** — activity_ratio 0-25% (info, 88%)
7. **User Interaction** — "YellowButtonPressedEvent" in content (info, 95%)
8. **Elevated Idle Process** — IdleLoopProcess > 8% (warning, 90%)

### Derived Metrics (`metrics.rs`)

`pub fn compute_derived(header: &PerformanceHeader) -> DerivedMetrics`

Safe division (returns 0.0 on zero denominators).

### Scenario Reconstruction (`scenario.rs`)

`pub fn reconstruct_scenario(patterns: &[DetectedPattern], content: &str) -> UserScenario`

Rule-based heuristics combining detected patterns into a narrative.

### AI Enrichment (`ai/performance.rs`)

```rust
pub struct PerformanceEnrichment {
    pub scenario_narrative: String,
    pub recommendations: Vec<Recommendation>,
    pub summary: String,
}

pub const PERFORMANCE_ENRICHMENT_PROMPT: &str = ...;

pub fn build_performance_enrichment_messages(
    result: &PerformanceTraceResult,
) -> (String, Vec<AiMessage>)

pub fn parse_performance_enrichment(raw: &str) -> HadronResult<PerformanceEnrichment>
```

Sends structured parsed data (not raw trace) to AI. Requests JSON with enhanced narrative + recommendations.

### Tests

Parser: 4 tests (header, processes, methods, empty file)
Patterns: 4 tests (gc pressure, database, changelog, no false positives)
Metrics: 2 tests (normal, zero division)
Scenario: 2 tests (changelog trigger, default)
AI enrichment: 2 tests (prompt build, response parse)
**Total: 14 tests**

---

## 2. hadron-server — Routes

### Routes (`routes/performance.rs`)

| Route | Method | Purpose |
|---|---|---|
| `POST /api/performance/analyze` | POST | Rule-based only — parse, detect, compute. Returns PerformanceTraceResult. |
| `POST /api/performance/analyze/enrich` | POST | Rule-based + AI streaming — parse first, then stream AI enrichment. Persists to analyses. |
| `GET /api/performance/analyses` | GET | List user's performance analyses |
| `GET /api/performance/analyses/{id}` | GET | Get single analysis |
| `DELETE /api/performance/analyses/{id}` | DELETE | Soft-delete |

### Request Body

```json
{ "content": "trace file text content", "filename": "performanceTrace_user_2026-01-01.log" }
```

### Analyze/Enrich SSE Flow

1. Parse trace → `PerformanceTraceResult` (instant, rule-based)
2. Send progress: `{ phase: "parsed", progress: 40, result: partial_result }`
3. Build AI enrichment messages from parsed result
4. Stream AI completion
5. On completion: merge enrichment (override scenario narrative, recommendations, summary), persist to `analyses`
6. Send completion: `{ phase: "complete", progress: 100, analysisId: id }`

### DB Helpers

- `insert_performance_analysis()` — `analysis_type = 'performance'`, full_data JSONB
- `get_performance_analyses()` — paginated, filtered by user + type
- No new migration.

---

## 3. Frontend

### Component Structure

```
frontend/src/components/performance/
├── PerformanceAnalyzerView.tsx     (orchestrator: upload → results)
├── PerformanceFileUpload.tsx       (file input + analyze button)
├── PerformanceResults.tsx          (collapsible sections container)
├── PerformanceHeaderStats.tsx      (metric cards + derived)
├── PerformanceProcesses.tsx        (process table)
├── PerformanceTopMethods.tsx       (methods table with categories)
├── PerformancePatterns.tsx         (pattern cards)
├── PerformanceScenario.tsx         (scenario narrative)
├── PerformanceRecommendations.tsx  (recommendation cards)
└── performanceHelpers.ts           (severity colors, formatters)
```

### PerformanceAnalyzerView.tsx

- Two phases: Upload | Results
- Upload: `<PerformanceFileUpload />` with "AI Enrich" toggle (default on)
- When AI enrich off: POST to `/analyze`, instant result
- When AI enrich on: SSE to `/analyze/enrich`, show progress then result
- Results: `<PerformanceResults />` with reset button
- Teal/cyan color scheme

### Result Sections (7 collapsible)

1. Summary — severity badge, one-line summary, metadata
2. Header Statistics — metric cards grid + derived metrics panel
3. Process Distribution — table with progress bars + status badges
4. Top Methods — table with category badges + percentage bars
5. Detected Patterns — severity-colored cards with confidence %
6. Scenario — trigger/impact grid + narrative block + contributing factors
7. Recommendations — type/priority/effort cards

### App.tsx

Add "performance" to View type + navigation. Render `<PerformanceAnalyzerView />`.

---

## 4. Implementation Order

1. hadron-core `performance/types.rs` — all data structures
2. hadron-core `performance/parser.rs` — trace parser + tests
3. hadron-core `performance/patterns.rs` — 8 detectors + tests
4. hadron-core `performance/metrics.rs` + `scenario.rs` — derived metrics + scenario + tests
5. hadron-core `ai/performance.rs` — enrichment prompt/parser + tests
6. hadron-server — DB helpers + routes (rule-based + AI-enriched streaming)
7. Frontend — API types + methods + helpers
8. Frontend — FileUpload + AnalyzerView orchestrator
9. Frontend — Result sub-components (7 sections)
10. Frontend — App.tsx wiring + verification
