# Web-Desktop Parity Phase 6: Export Improvements

**Date:** 2026-04-13
**Status:** Design approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`

## Overview

Add a generic export framework with 5 formats (Markdown, HTML, Interactive HTML, JSON, Plain Text) and a single generic export route. Frontend builds sections from displayed data, sends to the server for formatting. Existing crash export stays for backwards compat. New ExportDialog supports all features with section toggles.

## Design Decisions

1. **5 formats:** MD, HTML, Interactive HTML, JSON, TXT. Skip XLSX (add later if needed).
2. **hadron-core generators:** Pure functions in `export/` module. Testable, no I/O.
3. **Single generic route:** `POST /api/export/generic` accepts `GenericReportData` with sections from the frontend. One route for all features.
4. **Frontend builds sections:** Each feature view constructs sections from displayed data and passes to ExportDialog. Server just formats.

---

## 1. hadron-core — `export` Module

### Module Structure

```
hadron-core/src/export/
├── mod.rs         — pub fn export_report(data, format) dispatcher
├── types.rs       — GenericReportData, ReportSection, ExportFormat
├── generators.rs  — 5 generator functions
```

### Types

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericReportData {
    pub title: String,
    pub source_type: String,      // "crash", "sentry", "performance", "jira", "release_notes"
    pub audience: Option<String>,  // "technical", "support", "customer", "executive"
    pub sections: Vec<ReportSection>,
    pub footer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSection {
    pub id: String,
    pub label: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Markdown,
    Html,
    InteractiveHtml,
    Json,
    Txt,
}
```

### Generators

`pub fn export_report(data: &GenericReportData, format: ExportFormat) -> String` — dispatcher calling the appropriate generator.

5 generators:

1. **`generate_markdown`** — `# Title\n\n## Section Label\n\nContent\n\n` for each section. Footer at end.

2. **`generate_html`** — Full DOCTYPE with embedded CSS (dark theme, system fonts, max-width 900px). Each section as `<h2>` + `<div>` with pre-wrapped content.

3. **`generate_interactive_html`** — Full DOCTYPE with inline JavaScript. Tab bar at top (one button per section). Clicking tab shows/hides section content. First tab active by default. Styled with embedded CSS (dark theme, tab active state).

4. **`generate_json`** — Serialize `GenericReportData` to pretty-printed JSON.

5. **`generate_txt`** — ASCII art: `========` separators, UPPERCASE section labels, plain content, no markup.

### Tests

- `test_export_markdown` — sections rendered with headings
- `test_export_html` — contains DOCTYPE, section headings
- `test_export_interactive_html` — contains JavaScript, tab buttons
- `test_export_json` — valid JSON with sections
- `test_export_txt` — contains separators, uppercase labels
- `test_export_empty_sections` — no sections, no panic

---

## 2. hadron-server — Generic Export Route

### Route

`POST /api/export/generic`

Request body: `GenericReportData` with format field added:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericExportRequest {
    pub title: String,
    pub source_type: String,
    pub audience: Option<String>,
    pub sections: Vec<hadron_core::export::ReportSection>,
    pub footer: Option<String>,
    pub format: hadron_core::export::ExportFormat,
}
```

Handler builds `GenericReportData`, calls `hadron_core::export::export_report()`, returns with appropriate Content-Type:
- Markdown: `text/markdown`
- HTML/Interactive HTML: `text/html`
- JSON: `application/json`
- TXT: `text/plain`

Existing `POST /api/analyses/{id}/export` stays unchanged for backwards compat.

---

## 3. Frontend

### Refactored ExportDialog

Props:
```typescript
interface ExportDialogProps {
  title: string;
  sourceType: string;
  sections: ExportSection[];
  onClose: () => void;
}

interface ExportSection {
  id: string;
  label: string;
  content: string;
}
```

UI:
- 5 format buttons: Markdown | HTML | Interactive HTML | JSON | Plain Text
- Section toggles: checkbox per section (all checked by default). Unchecked sections excluded from export.
- Preview button: calls the generic route, shows formatted content
- Download button: triggers download with correct file extension

### Feature Integration

Each feature view adds an "Export" button that opens ExportDialog with sections built from the displayed data:

**SentryDetailView** — builds sections from `SentryAnalysisFullData`:
- Overview: error type, severity, root cause, fixes
- Patterns: pattern list with confidence
- Breadcrumbs: timeline as text
- Stack Trace: exception chain as text
- Context: runtime context as text
- Impact: user impact text + stats
- Recommendations: prioritized list

**PerformanceResults** — builds sections from `PerformanceTraceResult`:
- Summary: severity, summary text
- Statistics: header + derived metrics
- Processes: process table as text
- Methods: top methods as text
- Patterns: detected patterns
- Scenario: narrative
- Recommendations: list

**Crash analysis** — existing ExportDialog refactored to use new generic props (backwards compat maintained via the old route as fallback).

### API additions

```typescript
async exportGenericReport(request: GenericExportRequest): Promise<string>
```

Types: `ExportSection`, `GenericExportRequest`, `ExportFormat`

---

## 4. Implementation Order

1. hadron-core `export/` — types + 5 generators + tests
2. hadron-server — generic export route
3. Frontend — API types + refactored ExportDialog
4. Frontend — build section helpers for Sentry + Performance
5. Frontend — wire export button into feature views
6. Verification
