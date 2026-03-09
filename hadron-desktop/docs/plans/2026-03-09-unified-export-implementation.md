# Unified Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the ExportDialog to all four analyzers (Crash, Code, Sentry, JIRA) with a file location picker and default export directory setting.

**Architecture:** New Rust command `export_generic_report` accepts named sections and renders them through dedicated generic generators (bypassing crash parser). Frontend ExportDialog is refactored from crash-specific `Analysis` prop to a generic `ExportSource` interface. A location picker (Download / Default folder / Choose) is added to the export footer, backed by a new `DEFAULT_EXPORT_DIR` setting.

**Tech Stack:** Rust (Tauri commands, serde), React/TypeScript, Tauri plugin-dialog, Tauri plugin-fs, localStorage

---

### Task 1: Rust — GenericReportData and generic generators

**Files:**
- Modify: `src-tauri/src/export/report.rs` (append after line 344)
- Modify: `src-tauri/src/export/mod.rs` (add re-export + export_generic_report fn)
- Modify: `src-tauri/src/export/generators/mod.rs` (add generic generator module)
- Create: `src-tauri/src/export/generators/generic.rs`

**Step 1: Add GenericReportData to report.rs**

Append to `src-tauri/src/export/report.rs` after line 344:

```rust
/// A named section for generic (non-crash) reports
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenericSection {
    pub id: String,
    pub label: String,
    pub content: String,
}

/// Report data for non-crash exports (code, sentry, jira)
#[derive(Debug, Clone, Serialize)]
pub struct GenericReportData {
    pub metadata: ReportMetadata,
    pub source_type: String,
    pub source_name: String,
    pub title: String,
    pub sections: Vec<GenericSection>,
    pub audience: ReportAudience,
    pub footer_text: Option<String>,
}

impl GenericReportData {
    pub fn new(
        source_type: String,
        source_name: String,
        title: String,
        sections: Vec<GenericSection>,
        audience: ReportAudience,
        footer_text: Option<String>,
    ) -> Self {
        Self {
            metadata: ReportMetadata {
                generated_at: chrono::Utc::now()
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string(),
                generator_version: env!("CARGO_PKG_VERSION").to_string(),
                report_id: uuid::Uuid::new_v4().to_string(),
            },
            source_type,
            source_name,
            title,
            sections,
            audience,
            footer_text,
        }
    }
}
```

**Step 2: Create generic generators**

Create `src-tauri/src/export/generators/generic.rs`:

```rust
use crate::export::report::GenericReportData;
use std::fmt::Write;

pub fn generate_generic_markdown(data: &GenericReportData) -> String {
    let mut md = String::new();
    writeln!(md, "# {}", data.title).unwrap();
    writeln!(md).unwrap();
    writeln!(md, "**Generated:** {}  ", data.metadata.generated_at).unwrap();
    writeln!(md, "**Report ID:** {}  ", data.metadata.report_id).unwrap();
    writeln!(md, "**Source:** {} (`{}`)  ", data.source_type, data.source_name).unwrap();
    writeln!(md).unwrap();

    for section in &data.sections {
        writeln!(md, "## {}", section.label).unwrap();
        writeln!(md).unwrap();
        writeln!(md, "{}", section.content).unwrap();
        writeln!(md).unwrap();
    }

    if let Some(ref footer) = data.footer_text {
        writeln!(md, "---").unwrap();
        writeln!(md, "*{}*", footer).unwrap();
    }
    md
}

pub fn generate_generic_html(data: &GenericReportData) -> String {
    let mut html = String::new();
    writeln!(html, "<!DOCTYPE html>").unwrap();
    writeln!(html, "<html><head><meta charset=\"utf-8\">").unwrap();
    writeln!(html, "<title>{}</title>", data.title).unwrap();
    writeln!(html, "<style>").unwrap();
    writeln!(html, "body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; background: #0f172a; color: #e2e8f0; }}").unwrap();
    writeln!(html, "h1 {{ color: #60a5fa; border-bottom: 2px solid #1e3a5f; padding-bottom: 0.5rem; }}").unwrap();
    writeln!(html, "h2 {{ color: #93c5fd; margin-top: 2rem; }}").unwrap();
    writeln!(html, ".meta {{ color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }}").unwrap();
    writeln!(html, ".section {{ background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; white-space: pre-wrap; }}").unwrap();
    writeln!(html, ".footer {{ border-top: 1px solid #334155; padding-top: 1rem; margin-top: 2rem; color: #64748b; font-style: italic; }}").unwrap();
    writeln!(html, "</style></head><body>").unwrap();
    writeln!(html, "<h1>{}</h1>", data.title).unwrap();
    writeln!(html, "<div class=\"meta\">Generated: {} &middot; Source: {} ({}) &middot; Report ID: {}</div>",
        data.metadata.generated_at, data.source_type, data.source_name, data.metadata.report_id).unwrap();

    for section in &data.sections {
        writeln!(html, "<h2>{}</h2>", section.label).unwrap();
        // Escape HTML in content, preserve newlines
        let escaped = section.content
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        writeln!(html, "<div class=\"section\">{}</div>", escaped).unwrap();
    }

    if let Some(ref footer) = data.footer_text {
        writeln!(html, "<div class=\"footer\">{}</div>", footer).unwrap();
    }
    writeln!(html, "</body></html>").unwrap();
    html
}

pub fn generate_generic_html_interactive(data: &GenericReportData) -> String {
    let mut html = String::new();
    writeln!(html, "<!DOCTYPE html>").unwrap();
    writeln!(html, "<html><head><meta charset=\"utf-8\">").unwrap();
    writeln!(html, "<title>{}</title>", data.title).unwrap();
    writeln!(html, "<style>").unwrap();
    writeln!(html, "body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; background: #0f172a; color: #e2e8f0; }}").unwrap();
    writeln!(html, "h1 {{ color: #60a5fa; border-bottom: 2px solid #1e3a5f; padding-bottom: 0.5rem; }}").unwrap();
    writeln!(html, ".meta {{ color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }}").unwrap();
    writeln!(html, ".tabs {{ display: flex; gap: 0; border-bottom: 2px solid #334155; margin-bottom: 1rem; }}").unwrap();
    writeln!(html, ".tab {{ padding: 0.75rem 1.25rem; cursor: pointer; color: #94a3b8; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; }}").unwrap();
    writeln!(html, ".tab:hover {{ color: #e2e8f0; }}").unwrap();
    writeln!(html, ".tab.active {{ color: #60a5fa; border-bottom-color: #60a5fa; }}").unwrap();
    writeln!(html, ".panel {{ display: none; background: #1e293b; border-radius: 8px; padding: 1.5rem; white-space: pre-wrap; }}").unwrap();
    writeln!(html, ".panel.active {{ display: block; }}").unwrap();
    writeln!(html, ".footer {{ border-top: 1px solid #334155; padding-top: 1rem; margin-top: 2rem; color: #64748b; font-style: italic; }}").unwrap();
    writeln!(html, "</style></head><body>").unwrap();
    writeln!(html, "<h1>{}</h1>", data.title).unwrap();
    writeln!(html, "<div class=\"meta\">Generated: {} &middot; Source: {} ({}) &middot; Report ID: {}</div>",
        data.metadata.generated_at, data.source_type, data.source_name, data.metadata.report_id).unwrap();

    // Tabs
    writeln!(html, "<div class=\"tabs\">").unwrap();
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        writeln!(html, "  <div class=\"tab{}\" onclick=\"showTab('tab{}')\">{}</div>", active, i, section.label).unwrap();
    }
    writeln!(html, "</div>").unwrap();

    // Panels
    for (i, section) in data.sections.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        let escaped = section.content
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        writeln!(html, "<div id=\"tab{}\" class=\"panel{}\">{}</div>", i, active, escaped).unwrap();
    }

    // Tab switching JS
    writeln!(html, "<script>").unwrap();
    writeln!(html, "function showTab(id) {{").unwrap();
    writeln!(html, "  document.querySelectorAll('.tab,.panel').forEach(e => e.classList.remove('active'));").unwrap();
    writeln!(html, "  document.getElementById(id).classList.add('active');").unwrap();
    writeln!(html, "  const tabs = document.querySelectorAll('.tab');").unwrap();
    writeln!(html, "  const idx = id.replace('tab','');").unwrap();
    writeln!(html, "  tabs[idx].classList.add('active');").unwrap();
    writeln!(html, "}}").unwrap();
    writeln!(html, "</script>").unwrap();

    if let Some(ref footer) = data.footer_text {
        writeln!(html, "<div class=\"footer\">{}</div>", footer).unwrap();
    }
    writeln!(html, "</body></html>").unwrap();
    html
}

pub fn generate_generic_json(data: &GenericReportData) -> String {
    serde_json::to_string_pretty(data).unwrap_or_else(|e| format!("{{\"error\": \"{}\"}}", e))
}

pub fn generate_generic_txt(data: &GenericReportData) -> String {
    let mut txt = String::new();
    let divider = "=".repeat(60);
    writeln!(txt, "{}", data.title.to_uppercase()).unwrap();
    writeln!(txt, "{}", divider).unwrap();
    writeln!(txt, "Generated: {}", data.metadata.generated_at).unwrap();
    writeln!(txt, "Source: {} ({})", data.source_type, data.source_name).unwrap();
    writeln!(txt, "Report ID: {}", data.metadata.report_id).unwrap();
    writeln!(txt).unwrap();

    for section in &data.sections {
        writeln!(txt, "{}", section.label.to_uppercase()).unwrap();
        writeln!(txt, "{}", "-".repeat(40)).unwrap();
        writeln!(txt, "{}", section.content).unwrap();
        writeln!(txt).unwrap();
    }

    if let Some(ref footer) = data.footer_text {
        writeln!(txt, "{}", divider).unwrap();
        writeln!(txt, "{}", footer).unwrap();
    }
    txt
}

/// Generic XLSX: one sheet with all sections stacked
pub fn generate_generic_xlsx(data: &GenericReportData) -> String {
    // Reuse the simple_xlsx crate pattern from the crash xlsx generator
    // For now, fall back to markdown — XLSX binary generation for generic
    // sections can be added later without changing the API contract.
    generate_generic_markdown(data)
}
```

**Step 3: Wire up generators/mod.rs**

Add to `src-tauri/src/export/generators/mod.rs`:

```rust
pub mod generic;
pub use generic::{
    generate_generic_html, generate_generic_html_interactive, generate_generic_json,
    generate_generic_markdown, generate_generic_txt, generate_generic_xlsx,
};
```

**Step 4: Add export_generic_report to export/mod.rs**

Add re-export of new types and the dispatch function:

```rust
pub use report::{GenericReportData, GenericSection};

pub fn export_generic_report(data: &GenericReportData, format: ExportFormat) -> String {
    use generators::{
        generate_generic_html, generate_generic_html_interactive, generate_generic_json,
        generate_generic_markdown, generate_generic_txt, generate_generic_xlsx,
    };
    match format {
        ExportFormat::Markdown => generate_generic_markdown(data),
        ExportFormat::Html => generate_generic_html(data),
        ExportFormat::HtmlInteractive => generate_generic_html_interactive(data),
        ExportFormat::Json => generate_generic_json(data),
        ExportFormat::Txt => generate_generic_txt(data),
        ExportFormat::Xlsx => generate_generic_xlsx(data),
    }
}
```

**Step 5: Build and verify**

Run: `cd hadron-desktop/src-tauri && cargo check 2>&1`
Expected: compiles with no new errors

**Step 6: Commit**

```bash
git add src-tauri/src/export/report.rs src-tauri/src/export/mod.rs \
       src-tauri/src/export/generators/mod.rs src-tauri/src/export/generators/generic.rs
git commit -m "feat(export): add GenericReportData and generic format generators"
```

---

### Task 2: Rust — `export_generic_report` Tauri command

**Files:**
- Modify: `src-tauri/src/commands/export.rs` (append new command)
- Modify: `src-tauri/src/main.rs` (register command)

**Step 1: Add command to commands/export.rs**

Append after `sanitize_content` (after line 298):

```rust
/// A single named section for generic export
#[derive(Deserialize)]
pub struct GenericExportSection {
    pub id: String,
    pub label: String,
    pub content: String,
}

/// Export request for non-crash analyzers (code, sentry, jira)
#[derive(Deserialize)]
pub struct GenericExportRequest {
    pub source_type: String,
    pub source_name: String,
    pub format: String,
    pub audience: Option<String>,
    pub title: Option<String>,
    pub sections: Vec<GenericExportSection>,
    pub footer_text: Option<String>,
}

/// Generate a report from pre-structured sections (non-crash analyzers)
#[tauri::command]
pub fn export_generic_report(request: GenericExportRequest) -> Result<ExportResponse, String> {
    log::debug!("cmd: export_generic_report");
    log::info!(
        "Generating generic {} report for: {} ({})",
        request.format,
        request.source_name,
        request.source_type
    );

    let audience = match request.audience.as_deref() {
        Some("customer") => crate::export::ReportAudience::Customer,
        Some("support") => crate::export::ReportAudience::Support,
        Some("executive") => crate::export::ReportAudience::Executive,
        _ => crate::export::ReportAudience::Technical,
    };

    let sections: Vec<crate::export::GenericSection> = request
        .sections
        .into_iter()
        .map(|s| crate::export::GenericSection {
            id: s.id,
            label: s.label,
            content: s.content,
        })
        .collect();

    let title = request
        .title
        .unwrap_or_else(|| format!("{} Report", request.source_type));

    let data = crate::export::GenericReportData::new(
        request.source_type.clone(),
        request.source_name.clone(),
        title,
        sections,
        audience,
        request.footer_text,
    );

    let format = match request.format.to_lowercase().as_str() {
        "html" => crate::export::ExportFormat::Html,
        "html_interactive" => crate::export::ExportFormat::HtmlInteractive,
        "json" => crate::export::ExportFormat::Json,
        "txt" | "text" => crate::export::ExportFormat::Txt,
        "xlsx" | "excel" => crate::export::ExportFormat::Xlsx,
        _ => crate::export::ExportFormat::Markdown,
    };

    let content = crate::export::export_generic_report(&data, format);

    let extension = match format {
        crate::export::ExportFormat::Html
        | crate::export::ExportFormat::HtmlInteractive => "html",
        crate::export::ExportFormat::Json => "json",
        crate::export::ExportFormat::Markdown => "md",
        crate::export::ExportFormat::Txt => "txt",
        crate::export::ExportFormat::Xlsx => "xlsx",
    };

    let base_name = request
        .source_name
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let suggested_filename = format!(
        "{}_{}_report.{}",
        base_name,
        request.source_type,
        extension
    );

    Ok(ExportResponse {
        content,
        suggested_filename,
        format: request.format,
    })
}

/// Preview a generic report without saving
#[tauri::command]
pub fn preview_generic_report(
    source_type: String,
    source_name: String,
    format: String,
    audience: String,
    title: Option<String>,
    sections: Vec<GenericExportSection>,
) -> Result<String, String> {
    log::debug!("cmd: preview_generic_report");
    let request = GenericExportRequest {
        source_type,
        source_name,
        format,
        audience: Some(audience),
        title,
        sections,
        footer_text: None,
    };
    let response = export_generic_report(request)?;
    Ok(response.content)
}
```

**Step 2: Register commands in main.rs**

In `src-tauri/src/main.rs`, add after the `commands::export::sanitize_content` line (around line 268):

```rust
            commands::export::export_generic_report,
            commands::export::preview_generic_report,
```

**Step 3: Build and verify**

Run: `cd hadron-desktop/src-tauri && cargo check 2>&1`
Expected: compiles cleanly

**Step 4: Commit**

```bash
git add src-tauri/src/commands/export.rs src-tauri/src/main.rs
git commit -m "feat(export): add export_generic_report Tauri command"
```

---

### Task 3: Frontend types and API functions

**Files:**
- Modify: `src/types/index.ts` (add ExportSource, GenericExportRequest types)
- Modify: `src/services/api.ts` (add exportGenericReport, previewGenericReport)

**Step 1: Add types to types/index.ts**

After the existing `ExportResponse` interface (around line 392):

```typescript
/** A section for generic (non-crash) export */
export interface ExportSection {
  id: string;
  label: string;
  content: string;
}

/** Data source for the unified ExportDialog */
export interface ExportSource {
  sourceType: "crash" | "code" | "sentry" | "jira";
  sourceName: string;
  defaultTitle: string;
  sections: (ExportSection & { defaultOn: boolean })[];
}

/** Request for non-crash generic export */
export interface GenericExportRequest {
  source_type: string;
  source_name: string;
  format: string;
  audience?: ReportAudience;
  title?: string;
  sections: ExportSection[];
  footer_text?: string;
}
```

**Step 2: Add API functions to services/api.ts**

After the existing `previewReport` function:

```typescript
export async function exportGenericReport(
  request: GenericExportRequest
): Promise<ExportResponse> {
  return await invoke<ExportResponse>("export_generic_report", { request });
}

export async function previewGenericReport(
  sourceType: string,
  sourceName: string,
  format: string,
  audience: ReportAudience,
  title: string | undefined,
  sections: ExportSection[]
): Promise<string> {
  return await invoke<string>("preview_generic_report", {
    sourceType,
    sourceName,
    format,
    audience,
    title: title ?? null,
    sections,
  });
}
```

Add the new type imports at the top of api.ts where other types are imported:

```typescript
import type { ..., ExportSection, GenericExportRequest } from "../types";
```

**Step 3: Verify frontend builds**

Run: `cd hadron-desktop && npm run build 2>&1`
Expected: builds cleanly

**Step 4: Commit**

```bash
git add src/types/index.ts src/services/api.ts
git commit -m "feat(export): add ExportSource types and generic export API functions"
```

---

### Task 4: Refactor ExportDialog to ExportSource

**Files:**
- Modify: `src/components/ExportDialog.tsx`

This is the core refactor. The dialog changes from crash-specific `Analysis` prop to the generic `ExportSource` interface. The crash-specific content assembly moves to the caller (Task 5).

**Step 1: Update props and section handling**

Change the props interface (line 26-30):

```typescript
interface ExportDialogProps {
  source: ExportSource;
  isOpen: boolean;
  onClose: () => void;
}
```

Remove the hardcoded `SECTION_OPTIONS` (lines 125-135) and derive sections from `source.sections`.

Remove the `crashContent` state and the `useEffect` that builds it (lines 154-172).

Replace `selectedSections` initialization to use `source.sections.filter(s => s.defaultOn).map(s => s.id)`.

**Step 2: Update preview to use generic API**

Replace `loadPreview` to call `previewGenericReport` instead of `previewReport`:

```typescript
const loadPreview = useCallback(async () => {
  const activeSections = source.sections.filter(s => selectedSections.includes(s.id));
  if (activeSections.length === 0) return;
  if (!PREVIEWABLE_FORMATS.has(previewFormat)) return;

  setIsLoadingPreview(true);
  try {
    if (source.sourceType === "crash") {
      // Crash uses original preview path (crash parser)
      const crashContent = activeSections.map(s => s.content).join("\n\n");
      const previewContent = await previewReport(
        crashContent,
        source.sourceName,
        previewFormat,
        selectedAudience
      );
      setPreview(previewContent);
    } else {
      const previewContent = await previewGenericReport(
        source.sourceType,
        source.sourceName,
        previewFormat,
        selectedAudience,
        customTitle || source.defaultTitle,
        activeSections.map(({ id, label, content }) => ({ id, label, content }))
      );
      setPreview(previewContent);
    }
  } catch (error) {
    logger.error("Preview failed", { error });
    setPreview(`Preview failed: ${error}`);
  } finally {
    setIsLoadingPreview(false);
  }
}, [source, selectedSections, previewFormat, selectedAudience, customTitle]);
```

**Step 3: Update handleExport to use generic API for non-crash**

```typescript
const handleExport = async () => {
  if (selectedFormats.length === 0) return;
  setIsExporting(true);
  setExportMessage(null);

  try {
    const activeSections = source.sections.filter(s => selectedSections.includes(s.id));
    const results: ExportResponse[] = [];

    for (const fmt of selectedFormats) {
      if (source.sourceType === "crash") {
        const crashContent = activeSections.map(s => s.content).join("\n\n");
        const result = await invoke<ExportResponse>("generate_report", {
          request: {
            crash_content: crashContent,
            file_name: source.sourceName,
            format: fmt,
            audience: selectedAudience,
            title: customTitle || undefined,
            include_sections: selectedSections.length > 0 ? selectedSections : undefined,
            footer_text: footerText || undefined,
          },
        });
        results.push(result);
      } else {
        const result = await exportGenericReport({
          source_type: source.sourceType,
          source_name: source.sourceName,
          format: fmt,
          audience: selectedAudience,
          title: customTitle || source.defaultTitle,
          sections: activeSections.map(({ id, label, content }) => ({ id, label, content })),
          footer_text: footerText || undefined,
        });
        results.push(result);
      }
    }

    for (const result of results) {
      await saveFile(result);
    }

    setExportMessage(`Successfully exported ${results.length} file(s)`);
    setTimeout(() => onClose(), 1500);
  } catch (error) {
    logger.error("Export failed", { error });
    setExportMessage(`Export failed: ${error}`);
  } finally {
    setIsExporting(false);
  }
};
```

**Step 4: Update section toggles in JSX**

Replace the hardcoded SECTION_OPTIONS render with dynamic sections from `source.sections`:

```tsx
{source.sections.map((section) => (
  <label
    key={section.id}
    className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-900/50 cursor-pointer"
  >
    <input
      type="checkbox"
      checked={selectedSections.includes(section.id)}
      onChange={() => toggleSection(section.id)}
      className="w-4 h-4 rounded"
    />
    <span className="text-sm">{section.label}</span>
  </label>
))}
```

**Step 5: Update the header subtitle**

Change the subtitle from `analysis.filename` to `source.sourceName`.

**Step 6: Verify frontend builds**

Run: `cd hadron-desktop && npm run build 2>&1`

**Step 7: Commit**

```bash
git add src/components/ExportDialog.tsx
git commit -m "refactor(export): make ExportDialog generic with ExportSource"
```

---

### Task 5: Update Crash Analyzer to use ExportSource

**Files:**
- Modify: `src/components/AnalysisDetailView.tsx`

**Step 1: Build ExportSource from Analysis**

Find the `ExportDialog` usage (around line 574) and the existing state. Replace:

```tsx
const [showExport, setShowExport] = useState(false);
```

Add a helper function that builds `ExportSource` from `Analysis`:

```typescript
function buildCrashExportSource(analysis: Analysis): ExportSource {
  return {
    sourceType: "crash",
    sourceName: analysis.filename,
    defaultTitle: "Crash Analysis Report",
    sections: [
      {
        id: "summary",
        label: "Summary",
        content: [
          `Error Type: ${analysis.error_type}`,
          `Severity: ${analysis.severity}`,
          analysis.error_message ? `Error Message: ${analysis.error_message}` : "",
          analysis.component ? `Component: ${analysis.component}` : "",
        ].filter(Boolean).join("\n"),
        defaultOn: true,
      },
      {
        id: "environment",
        label: "Environment",
        content: analysis.filename,
        defaultOn: true,
      },
      {
        id: "exception_details",
        label: "Exception Details",
        content: [
          `Type: ${analysis.error_type}`,
          analysis.error_message ? `Message: ${analysis.error_message}` : "",
        ].filter(Boolean).join("\n"),
        defaultOn: true,
      },
      {
        id: "root_cause",
        label: "Root Cause",
        content: analysis.root_cause || "Not available",
        defaultOn: true,
      },
      {
        id: "suggested_fix",
        label: "Suggested Fixes",
        content: analysis.suggested_fixes?.map((f, i) => `${i + 1}. ${f}`).join("\n") || "None",
        defaultOn: true,
      },
      {
        id: "stack_trace",
        label: "Stack Trace",
        content: analysis.stack_trace || "",
        defaultOn: false,
      },
      {
        id: "reproduction_steps",
        label: "Reproduction Steps",
        content: "",
        defaultOn: false,
      },
      {
        id: "impact_analysis",
        label: "Impact Analysis",
        content: "",
        defaultOn: false,
      },
      {
        id: "pattern_match",
        label: "Pattern Match",
        content: "",
        defaultOn: false,
      },
    ].filter(s => s.content.trim().length > 0),
  };
}
```

**Step 2: Update ExportDialog render**

Replace:
```tsx
<ExportDialog analysis={analysis} isOpen={showExport} onClose={() => setShowExport(false)} />
```

With:
```tsx
<ExportDialog source={buildCrashExportSource(analysis)} isOpen={showExport} onClose={() => setShowExport(false)} />
```

**Step 3: Update imports**

Add `ExportSource` to the imports from types.

**Step 4: Verify frontend builds + smoke test crash export**

Run: `cd hadron-desktop && npm run build 2>&1`

**Step 5: Commit**

```bash
git add src/components/AnalysisDetailView.tsx
git commit -m "refactor(export): wire AnalysisDetailView to ExportSource"
```

---

### Task 6: Add export to Code Analyzer

**Files:**
- Modify: `src/components/code-analyzer/CodeAnalyzerView.tsx`

**Step 1: Add ExportDialog import and state**

Add imports for `ExportDialog` and `ExportSource`. Add state:

```typescript
const [showExport, setShowExport] = useState(false);
```

**Step 2: Build ExportSource from CodeAnalysisResult**

```typescript
function buildCodeExportSource(
  result: CodeAnalysisResult,
  filename: string,
  language: string
): ExportSource {
  const sections: ExportSource["sections"] = [
    {
      id: "summary",
      label: "Summary",
      content: result.summary,
      defaultOn: true,
    },
    {
      id: "quality",
      label: "Quality Scores",
      content: [
        `Overall: ${result.qualityScores.overall}/100`,
        `Security: ${result.qualityScores.security}/100`,
        `Performance: ${result.qualityScores.performance}/100`,
        `Maintainability: ${result.qualityScores.maintainability}/100`,
        `Best Practices: ${result.qualityScores.bestPractices}/100`,
      ].join("\n"),
      defaultOn: true,
    },
    {
      id: "issues",
      label: "Issues",
      content: result.issues.length > 0
        ? result.issues
            .map(
              (issue) =>
                `[${issue.severity.toUpperCase()}] ${issue.title} (line ${issue.line})\n  ${issue.description}\n  Fix: ${issue.fix}`
            )
            .join("\n\n")
        : "No issues found.",
      defaultOn: true,
    },
    {
      id: "walkthrough",
      label: "Code Walkthrough",
      content: result.walkthrough
        .map(
          (section) =>
            `### ${section.code}\n${section.whatItDoes}\n\nWhy it matters: ${section.whyItMatters}`
        )
        .join("\n\n"),
      defaultOn: false,
    },
  ];

  if (result.optimizedCode) {
    sections.push({
      id: "optimized",
      label: "Optimized Code",
      content: `\`\`\`${language}\n${result.optimizedCode}\n\`\`\``,
      defaultOn: false,
    });
  }

  if (result.glossary && result.glossary.length > 0) {
    sections.push({
      id: "glossary",
      label: "Glossary",
      content: result.glossary.map((g) => `**${g.term}**: ${g.definition}`).join("\n"),
      defaultOn: false,
    });
  }

  return {
    sourceType: "code",
    sourceName: filename,
    defaultTitle: `Code Analysis: ${filename}`,
    sections,
  };
}
```

**Step 3: Add Export button to the action bar**

In the action bar area (around line 320-327), add next to "New Analysis":

```tsx
<Button
  variant="secondary"
  onClick={() => setShowExport(true)}
  icon={<Download />}
>
  Export
</Button>
```

Add `Download` to the lucide-react imports.

**Step 4: Add ExportDialog render**

At the bottom of the component JSX, before the closing fragment:

```tsx
{result && (
  <ExportDialog
    source={buildCodeExportSource(result, codeInput.filename, codeInput.language)}
    isOpen={showExport}
    onClose={() => setShowExport(false)}
  />
)}
```

**Step 5: Verify frontend builds**

Run: `cd hadron-desktop && npm run build 2>&1`

**Step 6: Commit**

```bash
git add src/components/code-analyzer/CodeAnalyzerView.tsx
git commit -m "feat(export): add full export to Code Analyzer"
```

---

### Task 7: Add export to Sentry Analyzer

**Files:**
- Modify: `src/components/sentry/SentryDetailView.tsx`

**Step 1: Add ExportDialog import and state**

Add imports for `ExportDialog`, `ExportSource`. Add state:

```typescript
const [showExport, setShowExport] = useState(false);
```

**Step 2: Build ExportSource from Sentry analysis**

Use the existing `parseSentryFullData` function output and the `Analysis` object:

```typescript
function buildSentryExportSource(analysis: Analysis): ExportSource {
  const fullData = analysis.full_data ? JSON.parse(analysis.full_data) : {};
  const aiResult = fullData.ai_result || {};
  const sections: ExportSource["sections"] = [
    {
      id: "summary",
      label: "Summary",
      content: [
        `Error Type: ${analysis.error_type}`,
        `Severity: ${analysis.severity}`,
        analysis.error_message ? `Error Message: ${analysis.error_message}` : "",
        analysis.component ? `Component: ${analysis.component}` : "",
        fullData.sentry_permalink ? `Sentry: ${fullData.sentry_permalink}` : "",
      ].filter(Boolean).join("\n"),
      defaultOn: true,
    },
    {
      id: "root_cause",
      label: "Root Cause",
      content: analysis.root_cause || "Not available",
      defaultOn: true,
    },
    {
      id: "suggested_fixes",
      label: "Suggested Fixes",
      content: analysis.suggested_fixes?.map((f, i) => `${i + 1}. ${f}`).join("\n") || "None",
      defaultOn: true,
    },
  ];

  if (aiResult.user_impact) {
    sections.push({
      id: "user_impact",
      label: "User Impact",
      content: aiResult.user_impact,
      defaultOn: true,
    });
  }

  if (aiResult.breadcrumb_analysis) {
    sections.push({
      id: "breadcrumbs",
      label: "Breadcrumb Analysis",
      content: aiResult.breadcrumb_analysis,
      defaultOn: true,
    });
  }

  if (analysis.stack_trace) {
    sections.push({
      id: "stack_trace",
      label: "Stack Trace",
      content: analysis.stack_trace,
      defaultOn: false,
    });
  }

  const patterns = fullData.detected_patterns;
  if (patterns && patterns.length > 0) {
    sections.push({
      id: "patterns",
      label: "Detected Patterns",
      content: patterns
        .map((p: { patternType: string; confidence: number; evidence: string }) =>
          `${p.patternType} (${(p.confidence * 100).toFixed(0)}%): ${p.evidence}`
        )
        .join("\n"),
      defaultOn: false,
    });
  }

  return {
    sourceType: "sentry",
    sourceName: analysis.filename,
    defaultTitle: `Sentry Analysis: ${analysis.filename}`,
    sections,
  };
}
```

**Step 3: Add "Export Options" button alongside existing buttons**

Next to the existing "Export Markdown" button (around line 293), add:

```tsx
<Button
  onClick={() => setShowExport(true)}
  icon={<Download />}
>
  Export Options
</Button>
```

Keep the existing "Copy Report" and "Export Markdown" quick buttons.

**Step 4: Add ExportDialog render**

```tsx
<ExportDialog
  source={buildSentryExportSource(analysis)}
  isOpen={showExport}
  onClose={() => setShowExport(false)}
/>
```

**Step 5: Verify frontend builds**

Run: `cd hadron-desktop && npm run build 2>&1`

**Step 6: Commit**

```bash
git add src/components/sentry/SentryDetailView.tsx
git commit -m "feat(export): add full export to Sentry Analyzer"
```

---

### Task 8: Add export to JIRA Analyzer

**Files:**
- Modify: `src/components/jira/JiraTicketAnalyzer.tsx`

**Step 1: Add ExportDialog import and state**

Add imports for `ExportDialog`, `ExportSource`. Add state:

```typescript
const [showExport, setShowExport] = useState(false);
```

**Step 2: Build ExportSource from JIRA data**

This function uses whichever data is available (triage, brief, deep analysis):

```typescript
function buildJiraExportSource(
  issue: NormalizedIssue,
  triageResult: JiraTriageResult | null,
  briefResult: JiraBriefResult | null,
  deepResult: JiraDeepResult | null
): ExportSource {
  const sections: ExportSource["sections"] = [];

  // Always include issue summary
  sections.push({
    id: "ticket",
    label: "Ticket Summary",
    content: [
      `Key: ${issue.key}`,
      `Title: ${issue.summary}`,
      `Priority: ${issue.priority || "Unset"}`,
      `Status: ${issue.status || "Unknown"}`,
      issue.components?.length ? `Components: ${issue.components.join(", ")}` : "",
      issue.labels?.length ? `Labels: ${issue.labels.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    defaultOn: true,
  });

  // Triage data
  const triage = briefResult?.triage || triageResult;
  if (triage) {
    sections.push({
      id: "triage",
      label: "Triage",
      content: [
        `Severity: ${triage.severity}`,
        `Category: ${triage.category}`,
        triage.tags?.length ? `Tags: ${triage.tags.join(", ")}` : "",
        triage.customer_impact ? `Customer Impact: ${triage.customer_impact}` : "",
      ].filter(Boolean).join("\n"),
      defaultOn: true,
    });
  }

  // Brief / deep analysis
  const analysis = briefResult?.analysis || deepResult;
  if (analysis) {
    sections.push({
      id: "analysis_summary",
      label: "Analysis Summary",
      content: analysis.plain_summary || "",
      defaultOn: true,
    });

    if (analysis.technical) {
      sections.push({
        id: "technical",
        label: "Technical Analysis",
        content: [
          analysis.technical.error_type ? `Error Type: ${analysis.technical.error_type}` : "",
          analysis.technical.root_cause ? `Root Cause: ${analysis.technical.root_cause}` : "",
          analysis.technical.affected_areas?.length
            ? `Affected Areas: ${analysis.technical.affected_areas.join(", ")}`
            : "",
        ].filter(Boolean).join("\n"),
        defaultOn: true,
      });
    }

    if (analysis.recommended_actions?.length) {
      sections.push({
        id: "actions",
        label: "Recommended Actions",
        content: analysis.recommended_actions
          .map(
            (a: { action: string; priority: string; rationale?: string }, i: number) =>
              `${i + 1}. [${a.priority}] ${a.action}${a.rationale ? ` — ${a.rationale}` : ""}`
          )
          .join("\n"),
        defaultOn: true,
      });
    }

    if (analysis.risk) {
      sections.push({
        id: "risk",
        label: "Risk & Impact",
        content: typeof analysis.risk === "string" ? analysis.risk : JSON.stringify(analysis.risk, null, 2),
        defaultOn: false,
      });
    }

    if (analysis.open_questions?.length) {
      sections.push({
        id: "questions",
        label: "Open Questions",
        content: analysis.open_questions.map((q: string, i: number) => `${i + 1}. ${q}`).join("\n"),
        defaultOn: false,
      });
    }
  }

  return {
    sourceType: "jira",
    sourceName: issue.key,
    defaultTitle: `JIRA Analysis: ${issue.key}`,
    sections,
  };
}
```

**Step 3: Add Export button to action bar**

In the action bar (around line 529-578), add after the existing buttons — only enabled when at least triage data exists:

```tsx
<Button
  variant="secondary"
  onClick={() => setShowExport(true)}
  disabled={!triageResult && !briefResult && !deepResult}
  icon={<Download />}
>
  Export
</Button>
```

Add `Download` to the lucide-react imports.

**Step 4: Add ExportDialog render**

```tsx
{issue && (
  <ExportDialog
    source={buildJiraExportSource(issue, triageResult, briefResult, deepResult?.result ?? null)}
    isOpen={showExport}
    onClose={() => setShowExport(false)}
  />
)}
```

**Step 5: Verify frontend builds**

Run: `cd hadron-desktop && npm run build 2>&1`

**Step 6: Commit**

```bash
git add src/components/jira/JiraTicketAnalyzer.tsx
git commit -m "feat(export): add full export to JIRA Analyzer"
```

---

### Task 9: Default Export Location setting

**Files:**
- Modify: `src/utils/config.ts` (add storage key)
- Modify: `src/components/SettingsPanel.tsx` (add export dir setting)

**Step 1: Add storage key**

In `src/utils/config.ts`, add to the `STORAGE_KEYS` object (in App preferences section):

```typescript
  DEFAULT_EXPORT_DIR: "default_export_dir",
```

**Step 2: Add export directory setting to SettingsPanel.tsx**

In the Preferences card section, add a new row similar to the Crash Log Directory pattern. Find the Preferences card (search for "Preferences" heading) and add after the existing preference items:

```tsx
{/* Default Export Location */}
<div className="flex items-center justify-between">
  <div>
    <p className="font-medium">Default Export Location</p>
    <p className="text-sm text-gray-400">
      {defaultExportDir || "Not set — exports download to browser default"}
    </p>
  </div>
  <div className="flex items-center gap-2">
    <button
      onClick={async () => {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, title: "Select Default Export Directory" });
        if (selected) {
          localStorage.setItem(STORAGE_KEYS.DEFAULT_EXPORT_DIR, selected as string);
          setDefaultExportDir(selected as string);
        }
      }}
      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
    >
      Choose Folder
    </button>
    {defaultExportDir && (
      <button
        onClick={() => {
          localStorage.removeItem(STORAGE_KEYS.DEFAULT_EXPORT_DIR);
          setDefaultExportDir("");
        }}
        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition text-red-400"
      >
        Clear
      </button>
    )}
  </div>
</div>
```

Add state at the top of the component:

```typescript
const [defaultExportDir, setDefaultExportDir] = useState(
  () => localStorage.getItem(STORAGE_KEYS.DEFAULT_EXPORT_DIR) || ""
);
```

**Step 3: Verify frontend builds**

Run: `cd hadron-desktop && npm run build 2>&1`

**Step 4: Commit**

```bash
git add src/utils/config.ts src/components/SettingsPanel.tsx
git commit -m "feat(settings): add default export location preference"
```

---

### Task 10: File location picker in ExportDialog

**Files:**
- Modify: `src/components/ExportDialog.tsx`

**Step 1: Add save location state and imports**

Add imports:

```typescript
import { save as tauriSave } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeBinaryFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { STORAGE_KEYS } from "../utils/config";
```

Add state:

```typescript
const defaultExportDir = localStorage.getItem(STORAGE_KEYS.DEFAULT_EXPORT_DIR) || "";
const [saveLocation, setSaveLocation] = useState<"download" | "default" | "choose">(
  defaultExportDir ? "default" : "download"
);
```

**Step 2: Replace downloadFile with saveFile**

Replace `downloadFile` and `triggerDownload` with a unified `saveFile` function:

```typescript
const saveFile = async (result: ExportResponse) => {
  const formatDef = FORMAT_OPTIONS.find((f) => f.id === result.format);
  const isBinary = formatDef?.isBinary ?? false;

  if (saveLocation === "download") {
    // Existing browser-style download
    if (isBinary) {
      const binaryString = atob(result.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      triggerDownload(blob, result.suggested_filename);
    } else {
      const mimeTypes: Record<string, string> = {
        html: "text/html",
        html_interactive: "text/html",
        json: "application/json",
        markdown: "text/markdown",
        txt: "text/plain",
      };
      const blob = new Blob([result.content], {
        type: mimeTypes[result.format] || "text/plain",
      });
      triggerDownload(blob, result.suggested_filename);
    }
    return;
  }

  let filePath: string | null = null;

  if (saveLocation === "default" && defaultExportDir) {
    filePath = await join(defaultExportDir, result.suggested_filename);
  } else if (saveLocation === "choose") {
    const ext = result.suggested_filename.split(".").pop() || "md";
    filePath = await tauriSave({
      defaultPath: result.suggested_filename,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
  }

  if (!filePath) return;

  if (isBinary) {
    const binaryString = atob(result.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    await writeBinaryFile(filePath, bytes);
  } else {
    await writeTextFile(filePath, result.content);
  }
};
```

Keep the existing `triggerDownload` for the "download" path.

**Step 3: Add save location picker to the footer**

In the footer area (around line 492-528), add the segmented control before the Cancel/Export buttons:

```tsx
{/* Save Location */}
<div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1">
  <button
    onClick={() => setSaveLocation("download")}
    className={`px-3 py-1.5 text-xs rounded-md transition ${
      saveLocation === "download"
        ? "bg-blue-500/30 text-blue-400"
        : "text-gray-400 hover:text-gray-300"
    }`}
  >
    Download
  </button>
  <button
    onClick={() => setSaveLocation("default")}
    disabled={!defaultExportDir}
    title={defaultExportDir || "Set in Settings → Preferences"}
    className={`px-3 py-1.5 text-xs rounded-md transition ${
      saveLocation === "default"
        ? "bg-blue-500/30 text-blue-400"
        : defaultExportDir
          ? "text-gray-400 hover:text-gray-300"
          : "text-gray-600 cursor-not-allowed"
    }`}
  >
    Default Folder
  </button>
  <button
    onClick={() => setSaveLocation("choose")}
    className={`px-3 py-1.5 text-xs rounded-md transition ${
      saveLocation === "choose"
        ? "bg-blue-500/30 text-blue-400"
        : "text-gray-400 hover:text-gray-300"
    }`}
  >
    Choose…
  </button>
</div>
```

**Step 4: Verify frontend builds**

Run: `cd hadron-desktop && npm run build 2>&1`

**Step 5: Commit**

```bash
git add src/components/ExportDialog.tsx
git commit -m "feat(export): add file location picker (download/default/choose)"
```

---

### Task 11: Final build verification and cleanup

**Files:** All modified files

**Step 1: Cargo check**

Run: `cd hadron-desktop/src-tauri && cargo check 2>&1`
Expected: compiles cleanly

**Step 2: Frontend build**

Run: `cd hadron-desktop && npm run build 2>&1`
Expected: builds cleanly

**Step 3: Run existing tests**

Run: `cd hadron-desktop/src-tauri && cargo test 2>&1`
Expected: all existing tests pass

Run: `cd hadron-desktop && npx vitest run 2>&1`
Expected: existing tests pass

**Step 4: Commit design doc + plan**

```bash
git add docs/plans/2026-03-09-unified-export-design.md docs/plans/2026-03-09-unified-export-implementation.md
git commit -m "docs: unified export design and implementation plan"
```
