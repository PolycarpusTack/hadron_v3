# Web-Desktop Parity — Phase 1a: Code Analyzer

**Date:** 2026-04-02
**Status:** Approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`
**Depends on:** Phase 0 (complete)

Port the desktop Code Analyzer to hadron-web — a 6-tab AI-powered code review feature.

---

## Backend

### hadron-core Updates

**Update `ai/parsers.rs`** — replace the Phase 0 placeholder types with the desktop's richer schema:

```rust
// Top-level result
pub struct CodeAnalysisResult {
    pub summary: String,
    pub issues: Vec<CodeIssue>,
    pub walkthrough: Vec<WalkthroughSection>,
    pub optimized_code: Option<String>,        // was nested struct
    pub quality_scores: CodeQualityScores,
    pub glossary: Vec<GlossaryTerm>,
}

pub struct CodeIssue {
    pub id: u32,
    pub severity: String,       // critical|high|medium|low
    pub category: String,       // security|performance|error|best-practice
    pub line: u32,
    pub title: String,
    pub description: String,
    pub technical: String,      // NEW
    pub fix: String,            // NEW
    pub complexity: String,     // NEW
    pub impact: String,         // NEW
}

pub struct WalkthroughSection {
    pub lines: String,                         // e.g. "1-10"
    pub title: String,
    pub code: String,
    pub what_it_does: String,
    pub why_it_matters: String,
    pub evidence: String,
    pub dependencies: Vec<CodeDependency>,
    pub impact: String,
    pub testability: String,
    pub eli5: String,
    pub quality: String,
}

pub struct CodeDependency {
    pub name: String,
    pub dep_type: String,       // import|variable|function|table
    pub note: String,
}

pub struct CodeQualityScores {
    pub overall: u8,
    pub security: u8,           // was readability
    pub performance: u8,
    pub maintainability: u8,    // was reliability
    pub best_practices: u8,     // NEW, replaces old security field
}

// GlossaryTerm stays the same (term + definition)
```

All fields use `#[serde(default)]` for resilience against missing AI output. Scores clamped to 0-100.

**Update `ai/prompts.rs`** — replace `CODE_ANALYSIS_PROMPT` with the desktop's full prompt (from `code-analysis.ts:buildCodeAnalysisPrompt`). Keep `build_code_analysis_messages()` but update it to take `filename` too.

**Add `ai/detect_language.rs`** — port of desktop's `detectLanguage.ts`:
- `detect_language(code: &str, filename: &str) -> String`
- Extension lookup (sql, tsx, jsx, ts, js, st, py, rs, go, java, xml, html, css, json, yaml, md, rb)
- Pattern-based fallback (SQL patterns, React imports, Python defs, Rust fn/let, Go func/package, XML tags, Smalltalk pipe syntax)
- Default: `"plaintext"`

### hadron-server Routes

**`POST /api/code-analysis`** (non-streaming):
- Request: `{ code: String, language?: String, filename?: String }`
- Auto-detects language if not provided (using hadron-core `detect_language`)
- Uses `resolve_ai_config()` pattern from Phase 0 (server key or per-request key)
- Builds prompt via `build_code_analysis_messages()`
- Calls `ai::complete()`, parses response via `parse_code_analysis()`
- Returns `CodeAnalysisResult` as JSON
- Rejects input >512KB (returns 413)

**`POST /api/code-analysis/stream`** (SSE):
- Same request format
- Uses `sse::stream_ai_completion()` helper from Phase 0
- Frontend accumulates tokens, parses JSON on completion

New route file: `routes/code_analysis.rs`

---

## Frontend

### Route & Navigation

- New route: `/code-analyzer`
- Add to sidebar navigation (available to all roles)

### Components

```
components/code-analyzer/
  CodeAnalyzerView.tsx      — orchestrator
  detectLanguage.ts         — language detection (port)
  constants.ts              — MAX_FILE_SIZE, LANGUAGE_EXTENSIONS
  tabs/
    OverviewTab.tsx
    WalkthroughTab.tsx
    IssuesTab.tsx
    OptimizedTab.tsx
    QualityTab.tsx
    LearnTab.tsx
  shared/
    SeverityBadge.tsx
    CategoryBadge.tsx
    QualityGauge.tsx
```

### CodeAnalyzerView (orchestrator)

State:
- `code: string` — input textarea value
- `filename: string` — optional filename input
- `language: string` — auto-detected, overridable via dropdown
- `activeTab` — one of: overview, walkthrough, issues, optimized, quality, learn
- `result: CodeAnalysisResult | null` — parsed analysis result
- Uses `useAiStream()` hook for streaming

Behavior:
- Textarea for code input with drag-and-drop file support (`<input type="file">` fallback, no Tauri dialog)
- Language auto-detect on code change (debounced) + manual dropdown (16 languages)
- "Analyze" button triggers `streamAi("/code-analysis/stream", { code, language, filename })`
- While streaming: show loading spinner + raw text accumulation
- On stream completion: parse JSON from `content`, set `result`
- On parse error: show raw text with error message
- File size warning: >200KB shows confirm dialog, >512KB blocks with error
- "Clear" button resets all state
- All 6 tabs mounted with CSS visibility (preserve filter state across tab switches)

### Tab Components

Port directly from desktop with same props and behavior:

- **OverviewTab**: summary text, critical issue count, quality gauge for each metric, click-to-navigate to issues
- **IssuesTab**: expandable issue cards, severity filter dropdown, category filter dropdown, severity-based default sort, copy fix button
- **WalkthroughTab**: collapsible sections with all 10 fields (code, whatItDoes, whyItMatters, evidence, dependencies list, impact, testability, eli5, quality)
- **OptimizedTab**: code block with copy button, or "No improvements suggested" placeholder
- **QualityTab**: large overall score gauge, 4 metric progress bars, issue breakdown cards (clickable to filter issues tab)
- **LearnTab**: glossary list (term + definition), dynamic "Next Steps" based on issue count

### Shared Components

- **SeverityBadge**: `critical`=red, `high`=orange, `medium`=yellow, `low`=blue
- **CategoryBadge**: `security`=red, `performance`=amber, `error`=rose, `best-practice`=sky
- **QualityGauge**: SVG circular gauge, 0-100, color-coded (red < 40 < yellow < 70 < green)

### TypeScript Types

```typescript
interface CodeAnalysisResult {
  summary: string;
  issues: CodeIssue[];
  walkthrough: WalkthroughSection[];
  optimizedCode: string | null;
  qualityScores: CodeQualityScores;
  glossary: GlossaryTerm[];
}

interface CodeIssue {
  id: number;
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "performance" | "error" | "best-practice";
  line: number;
  title: string;
  description: string;
  technical: string;
  fix: string;
  complexity: string;
  impact: string;
}

interface WalkthroughSection {
  lines: string;
  title: string;
  code: string;
  whatItDoes: string;
  whyItMatters: string;
  evidence: string;
  dependencies: CodeDependency[];
  impact: string;
  testability: string;
  eli5: string;
  quality: string;
}

interface CodeDependency {
  name: string;
  type: string;
  note: string;
}

interface CodeQualityScores {
  overall: number;
  security: number;
  performance: number;
  maintainability: number;
  bestPractices: number;
}

interface GlossaryTerm {
  term: string;
  definition: string;
}
```

These match the desktop types exactly.

---

## API Endpoints Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/code-analysis` | Any role | Non-streaming code analysis |
| POST | `/api/code-analysis/stream` | Any role | SSE streaming code analysis |

---

## File Summary

### New files

| File | Purpose |
|------|---------|
| `crates/hadron-core/src/ai/detect_language.rs` | Heuristic language detection |
| `crates/hadron-server/src/routes/code_analysis.rs` | Code analysis route handlers |
| `frontend/src/components/code-analyzer/CodeAnalyzerView.tsx` | Orchestrator component |
| `frontend/src/components/code-analyzer/detectLanguage.ts` | Frontend language detection |
| `frontend/src/components/code-analyzer/constants.ts` | File size limits, language map |
| `frontend/src/components/code-analyzer/tabs/OverviewTab.tsx` | Overview tab |
| `frontend/src/components/code-analyzer/tabs/WalkthroughTab.tsx` | Walkthrough tab |
| `frontend/src/components/code-analyzer/tabs/IssuesTab.tsx` | Issues tab |
| `frontend/src/components/code-analyzer/tabs/OptimizedTab.tsx` | Optimized code tab |
| `frontend/src/components/code-analyzer/tabs/QualityTab.tsx` | Quality scores tab |
| `frontend/src/components/code-analyzer/tabs/LearnTab.tsx` | Glossary + next steps tab |
| `frontend/src/components/code-analyzer/shared/SeverityBadge.tsx` | Severity badge |
| `frontend/src/components/code-analyzer/shared/CategoryBadge.tsx` | Category badge |
| `frontend/src/components/code-analyzer/shared/QualityGauge.tsx` | SVG quality gauge |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-core/src/ai/mod.rs` | Add `pub mod detect_language` |
| `crates/hadron-core/src/ai/parsers.rs` | Replace types with desktop-matching schema |
| `crates/hadron-core/src/ai/prompts.rs` | Replace `CODE_ANALYSIS_PROMPT` with desktop's full prompt |
| `crates/hadron-server/src/routes/mod.rs` | Add `mod code_analysis` + routes |
| `frontend/src/App.tsx` (or router) | Add `/code-analyzer` route |
| `frontend/src/services/api.ts` | Add `CodeAnalysisResult` types |
