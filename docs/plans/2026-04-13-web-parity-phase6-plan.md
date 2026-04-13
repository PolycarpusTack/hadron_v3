# Web-Desktop Parity Phase 6: Export Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic export framework with 5 formats and section toggles, usable across all feature views.

**Architecture:** hadron-core gets `export/` module with types and 5 pure generator functions. hadron-server gets a single `POST /api/export/generic` route. Frontend refactors ExportDialog with format selection + section toggles, wired into Sentry and Performance views.

**Tech Stack:** Rust (hadron-core), Axum, React 18, TypeScript

**Spec:** `docs/plans/2026-04-13-web-parity-phase6-design.md`

---

## File Map

### hadron-core (create)
- `hadron-web/crates/hadron-core/src/export/mod.rs` — dispatcher
- `hadron-web/crates/hadron-core/src/export/types.rs` — data structures
- `hadron-web/crates/hadron-core/src/export/generators.rs` — 5 format generators

### hadron-core (modify)
- `hadron-web/crates/hadron-core/src/lib.rs` — add `pub mod export`

### hadron-server (modify)
- `hadron-web/crates/hadron-server/src/routes/export.rs` — add generic export handler
- `hadron-web/crates/hadron-server/src/routes/mod.rs` — register route

### Frontend (modify)
- `hadron-web/frontend/src/components/export/ExportDialog.tsx` — refactor with new formats + section toggles
- `hadron-web/frontend/src/services/api.ts` — add types + method
- `hadron-web/frontend/src/components/sentry/SentryDetailView.tsx` — add export button
- `hadron-web/frontend/src/components/performance/PerformanceResults.tsx` — add export button

---

## Task 1: hadron-core — Export Types & Generators

**Files:**
- Create: `hadron-web/crates/hadron-core/src/export/mod.rs`
- Create: `hadron-web/crates/hadron-core/src/export/types.rs`
- Create: `hadron-web/crates/hadron-core/src/export/generators.rs`
- Modify: `hadron-web/crates/hadron-core/src/lib.rs`

- [ ] **Step 1: Create types.rs**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericReportData {
    pub title: String,
    pub source_type: String,
    pub audience: Option<String>,
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

impl ExportFormat {
    pub fn content_type(&self) -> &'static str {
        match self {
            Self::Markdown => "text/markdown; charset=utf-8",
            Self::Html | Self::InteractiveHtml => "text/html; charset=utf-8",
            Self::Json => "application/json; charset=utf-8",
            Self::Txt => "text/plain; charset=utf-8",
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Html | Self::InteractiveHtml => "html",
            Self::Json => "json",
            Self::Txt => "txt",
        }
    }
}
```

- [ ] **Step 2: Create generators.rs**

5 pure generator functions. Each takes `&GenericReportData` and returns `String`.

```rust
use super::types::*;

pub fn generate_markdown(data: &GenericReportData) -> String {
    let mut out = format!("# {}\n\n", data.title);
    for section in &data.sections {
        out.push_str(&format!("## {}\n\n{}\n\n", section.label, section.content));
    }
    if let Some(ref footer) = data.footer {
        out.push_str(&format!("---\n\n_{}_\n", footer));
    }
    out
}

pub fn generate_html(data: &GenericReportData) -> String {
    let mut html = String::from(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">\n\
         <style>\n\
         body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; background: #1e293b; color: #e2e8f0; }\n\
         h1 { color: #38bdf8; border-bottom: 2px solid #334155; padding-bottom: 0.5rem; }\n\
         h2 { color: #94a3b8; margin-top: 2rem; }\n\
         .section { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 1rem 1.5rem; margin: 1rem 0; }\n\
         .section pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }\n\
         .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #334155; color: #64748b; font-size: 0.875rem; }\n\
         </style>\n</head><body>\n",
    );
    html.push_str(&format!("<h1>{}</h1>\n", escape_html(&data.title)));
    for section in &data.sections {
        html.push_str(&format!(
            "<h2>{}</h2>\n<div class=\"section\"><pre>{}</pre></div>\n",
            escape_html(&section.label),
            escape_html(&section.content),
        ));
    }
    if let Some(ref footer) = data.footer {
        html.push_str(&format!("<div class=\"footer\">{}</div>\n", escape_html(footer)));
    }
    html.push_str("</body></html>");
    html
}

pub fn generate_interactive_html(data: &GenericReportData) -> String {
    let mut html = String::from(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">\n\
         <style>\n\
         body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 1rem; background: #0f172a; color: #e2e8f0; }\n\
         h1 { color: #38bdf8; }\n\
         .tabs { display: flex; gap: 4px; border-bottom: 2px solid #334155; margin: 1rem 0; flex-wrap: wrap; }\n\
         .tab { padding: 8px 16px; cursor: pointer; background: #1e293b; border: 1px solid #334155; border-bottom: none; border-radius: 6px 6px 0 0; color: #94a3b8; }\n\
         .tab.active { background: #334155; color: #38bdf8; font-weight: 600; }\n\
         .panel { display: none; background: #1e293b; border: 1px solid #334155; border-top: none; padding: 1.5rem; border-radius: 0 0 8px 8px; }\n\
         .panel.active { display: block; }\n\
         .panel pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }\n\
         .footer { margin-top: 2rem; color: #64748b; font-size: 0.875rem; }\n\
         </style>\n</head><body>\n",
    );
    html.push_str(&format!("<h1>{}</h1>\n<div class=\"tabs\">\n", escape_html(&data.title)));
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        html.push_str(&format!(
            "  <div class=\"tab{}\" onclick=\"switchTab('{}')\">{}</div>\n",
            active, section.id, escape_html(&section.label),
        ));
    }
    html.push_str("</div>\n");
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        html.push_str(&format!(
            "<div id=\"panel-{}\" class=\"panel{}\">\n  <pre>{}</pre>\n</div>\n",
            section.id, active, escape_html(&section.content),
        ));
    }
    if let Some(ref footer) = data.footer {
        html.push_str(&format!("<div class=\"footer\">{}</div>\n", escape_html(footer)));
    }
    html.push_str("<script>\nfunction switchTab(id) {\n\
         document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));\n\
         document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));\n\
         event.target.classList.add('active');\n\
         document.getElementById('panel-' + id).classList.add('active');\n\
         }\n</script>\n</body></html>");
    html
}

pub fn generate_json(data: &GenericReportData) -> String {
    serde_json::to_string_pretty(data).unwrap_or_else(|_| "{}".to_string())
}

pub fn generate_txt(data: &GenericReportData) -> String {
    let separator = "=".repeat(60);
    let mut out = format!("{}\n  {}\n{}\n\n", separator, data.title.to_uppercase(), separator);
    for section in &data.sections {
        out.push_str(&format!(
            "{}\n  {}\n{}\n\n{}\n\n",
            "-".repeat(40),
            section.label.to_uppercase(),
            "-".repeat(40),
            section.content,
        ));
    }
    if let Some(ref footer) = data.footer {
        out.push_str(&format!("{}\n{}\n", separator, footer));
    }
    out
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
```

- [ ] **Step 3: Create mod.rs**

```rust
pub mod types;
pub mod generators;

pub use types::*;

pub fn export_report(data: &GenericReportData, format: ExportFormat) -> String {
    match format {
        ExportFormat::Markdown => generators::generate_markdown(data),
        ExportFormat::Html => generators::generate_html(data),
        ExportFormat::InteractiveHtml => generators::generate_interactive_html(data),
        ExportFormat::Json => generators::generate_json(data),
        ExportFormat::Txt => generators::generate_txt(data),
    }
}
```

- [ ] **Step 4: Register in lib.rs**

Add `pub mod export;` to `hadron-web/crates/hadron-core/src/lib.rs`.

- [ ] **Step 5: Add tests**

In `generators.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn sample_data() -> GenericReportData {
        GenericReportData {
            title: "Test Report".to_string(),
            source_type: "test".to_string(),
            audience: Some("technical".to_string()),
            sections: vec![
                ReportSection { id: "overview".to_string(), label: "Overview".to_string(), content: "This is the overview.".to_string() },
                ReportSection { id: "details".to_string(), label: "Details".to_string(), content: "These are details.".to_string() },
            ],
            footer: Some("Generated by Hadron".to_string()),
        }
    }

    #[test]
    fn test_export_markdown() {
        let out = generate_markdown(&sample_data());
        assert!(out.contains("# Test Report"));
        assert!(out.contains("## Overview"));
        assert!(out.contains("This is the overview."));
        assert!(out.contains("Generated by Hadron"));
    }

    #[test]
    fn test_export_html() {
        let out = generate_html(&sample_data());
        assert!(out.contains("<!DOCTYPE html>"));
        assert!(out.contains("Test Report"));
        assert!(out.contains("Overview"));
    }

    #[test]
    fn test_export_interactive_html() {
        let out = generate_interactive_html(&sample_data());
        assert!(out.contains("switchTab"));
        assert!(out.contains("panel-overview"));
        assert!(out.contains("panel-details"));
    }

    #[test]
    fn test_export_json() {
        let out = generate_json(&sample_data());
        let parsed: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["title"], "Test Report");
        assert_eq!(parsed["sections"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_export_txt() {
        let out = generate_txt(&sample_data());
        assert!(out.contains("TEST REPORT"));
        assert!(out.contains("OVERVIEW"));
        assert!(out.contains("This is the overview."));
    }

    #[test]
    fn test_export_empty_sections() {
        let data = GenericReportData {
            title: "Empty".to_string(),
            source_type: "test".to_string(),
            audience: None,
            sections: vec![],
            footer: None,
        };
        // All formats should handle empty sections without panic
        let _ = generate_markdown(&data);
        let _ = generate_html(&data);
        let _ = generate_interactive_html(&data);
        let _ = generate_json(&data);
        let _ = generate_txt(&data);
    }

    #[test]
    fn test_html_escaping() {
        let data = GenericReportData {
            title: "Test <script>alert('xss')</script>".to_string(),
            source_type: "test".to_string(),
            audience: None,
            sections: vec![ReportSection {
                id: "xss".to_string(),
                label: "XSS Test".to_string(),
                content: "<b>bold</b> & \"quotes\"".to_string(),
            }],
            footer: None,
        };
        let out = generate_html(&data);
        assert!(!out.contains("<script>"));
        assert!(out.contains("&lt;script&gt;"));
        assert!(out.contains("&amp;"));
    }
}
```

- [ ] **Step 6: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- export
git add hadron-web/crates/hadron-core/src/export/ hadron-web/crates/hadron-core/src/lib.rs
git commit -m "feat(core): add generic export framework with 5 format generators"
```

---

## Task 2: hadron-server — Generic Export Route

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/export.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add generic export handler**

Read `export.rs` first. Add alongside the existing crash export handler:

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

pub async fn export_generic(
    _user: AuthenticatedUser,
    Json(req): Json<GenericExportRequest>,
) -> Result<impl IntoResponse, AppError> {
    let data = hadron_core::export::GenericReportData {
        title: req.title,
        source_type: req.source_type,
        audience: req.audience,
        sections: req.sections,
        footer: req.footer,
    };
    let content = hadron_core::export::export_report(&data, req.format);
    let content_type = req.format.content_type();
    Ok(([(axum::http::header::CONTENT_TYPE, content_type)], content))
}
```

- [ ] **Step 2: Register route**

In `routes/mod.rs`:
```rust
.route("/export/generic", post(export::export_generic))
```

- [ ] **Step 3: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check
git add hadron-web/crates/hadron-server/src/routes/export.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add generic export route for all features"
```

---

## Task 3: Frontend — API Types, Refactored ExportDialog, Feature Wiring

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`
- Modify: `hadron-web/frontend/src/components/export/ExportDialog.tsx`
- Modify: `hadron-web/frontend/src/components/sentry/SentryDetailView.tsx`
- Modify: `hadron-web/frontend/src/components/performance/PerformanceResults.tsx`

- [ ] **Step 1: Add types and method to api.ts**

```typescript
export interface ExportSection {
  id: string;
  label: string;
  content: string;
}

export type ExportFormat = 'markdown' | 'html' | 'interactive_html' | 'json' | 'txt';

export interface GenericExportRequest {
  title: string;
  sourceType: string;
  audience?: string;
  sections: ExportSection[];
  footer?: string;
  format: ExportFormat;
}

// Method on ApiClient:
async exportGenericReport(request: GenericExportRequest): Promise<string> {
  // Returns raw text, so use fetch directly (not this.request which parses JSON)
  const token = ...;
  const resp = await fetch(`${baseUrl}/export/generic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(request),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.text();
}
```

- [ ] **Step 2: Refactor ExportDialog.tsx**

Read the current file first. Refactor to accept generic props:

```typescript
interface ExportDialogProps {
  title: string;
  sourceType: string;
  sections: ExportSection[];
  onClose: () => void;
  // Keep backwards compat: optional analysisId for old crash export
  analysisId?: number;
  filename?: string;
}
```

UI changes:
- 5 format buttons (add Interactive HTML + Plain Text)
- Section toggles: checkboxes for each section (all checked by default)
- Preview: calls `api.exportGenericReport(...)` with selected format + checked sections
- Download: same call, creates Blob + download link with correct extension

The old crash-specific export can fall back to the existing `/analyses/{id}/export` route when `analysisId` is provided, or use the new generic route.

- [ ] **Step 3: Add export to SentryDetailView**

Read `SentryDetailView.tsx`. Add an "Export" button in the header. When clicked, build sections from `data`:

```typescript
function buildExportSections(): ExportSection[] {
  return [
    { id: 'overview', label: 'Overview', content: `Error: ${data.aiResult.errorType}\nSeverity: ${data.aiResult.severity}\n\nRoot Cause:\n${data.aiResult.rootCause}\n\nSuggested Fixes:\n${data.aiResult.suggestedFixes.map((f, i) => `${i+1}. ${f}`).join('\n')}` },
    { id: 'patterns', label: 'Patterns', content: data.patterns.map(p => `[${p.patternType}] ${p.confidence}% - ${p.evidence.join('; ')}`).join('\n') || 'No patterns detected' },
    { id: 'breadcrumbs', label: 'Breadcrumbs', content: data.event.breadcrumbs.map(b => `[${b.timestamp || '?'}] ${b.category || '?'} - ${b.message || ''}`).join('\n') || 'No breadcrumbs' },
    { id: 'stacktrace', label: 'Stack Trace', content: data.event.exceptions.map(e => `${e.type}: ${e.value}\n${(e.stacktrace || []).map(f => `  ${f.inApp ? '[APP]' : '[LIB]'} ${f.function || '?'} (${f.filename || '?'}:${f.lineNo || '?'})`).join('\n')}`).join('\n\n') || 'No exceptions' },
    { id: 'context', label: 'Context', content: JSON.stringify(data.event.contexts, null, 2) },
    { id: 'impact', label: 'Impact', content: data.aiResult.userImpact },
    { id: 'recommendations', label: 'Recommendations', content: data.aiResult.recommendations.map(r => `[${r.priority}] ${r.title}\n${r.description}`).join('\n\n') || 'No recommendations' },
  ];
}
```

Add state `showExport` and render `<ExportDialog ... />` when true.

- [ ] **Step 4: Add export to PerformanceResults**

Similar pattern — build sections from the `PerformanceTraceResult`:

```typescript
function buildExportSections(): ExportSection[] {
  return [
    { id: 'summary', label: 'Summary', content: `Severity: ${result.overallSeverity}\n${result.summary}` },
    { id: 'stats', label: 'Statistics', content: `CPU: ${result.derived.cpuUtilization}%\nActivity: ${result.derived.activityRatio}%\nGC Pressure: ${result.derived.gcPressure}\nSamples: ${result.header.samples}` },
    { id: 'processes', label: 'Processes', content: result.processes.map(p => `${p.name} @ ${p.priority}: ${p.percentage}%`).join('\n') },
    { id: 'methods', label: 'Top Methods', content: result.topMethods.map(m => `${m.percentage}% ${m.method} (${m.category})`).join('\n') },
    { id: 'patterns', label: 'Patterns', content: result.patterns.map(p => `[${p.severity}] ${p.title} (${p.confidence}%)\n${p.description}`).join('\n\n') || 'No patterns' },
    { id: 'scenario', label: 'Scenario', content: `Trigger: ${result.scenario.trigger}\nAction: ${result.scenario.action}\nContext: ${result.scenario.context}\n\nFactors:\n${result.scenario.contributingFactors.map(f => `- ${f}`).join('\n')}` },
    { id: 'recommendations', label: 'Recommendations', content: result.recommendations.map(r => `[${r.priority}] ${r.title}\n${r.description}`).join('\n\n') },
  ];
}
```

- [ ] **Step 5: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts hadron-web/frontend/src/components/export/ExportDialog.tsx hadron-web/frontend/src/components/sentry/SentryDetailView.tsx hadron-web/frontend/src/components/performance/PerformanceResults.tsx
git commit -m "feat(frontend): refactor ExportDialog with 5 formats, wire into Sentry and Performance"
```

---

## Task 4: Verification

- [ ] **Step 1:** `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- export`
- [ ] **Step 2:** `cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check`
- [ ] **Step 3:** `cd /mnt/c/Projects/Hadron_v3/hadron-web/frontend && npx tsc --noEmit && npx vite build`
- [ ] **Step 4:** Fix any issues, commit

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | hadron-core | Export types + 5 generators + 7 tests |
| 2 | hadron-server | Generic export route |
| 3 | Frontend | API types, refactored ExportDialog, Sentry + Performance wiring |
| 4 | Verification | Tests, build |
