# Unified Export & File Location Picker

**Date:** 2026-03-09
**Status:** Approved
**Target Version:** 4.4.x

## Goal

Extend the existing ExportDialog (currently crash-only) to all four analyzers (Crash, Code, Sentry, JIRA). Add a file location picker to the export flow and a default export directory setting.

## Approach

Hybrid: new lightweight Rust command `export_generic_report` accepts pre-structured sections and feeds them to existing generators (MD, HTML, Interactive HTML, JSON, TXT, XLSX). The crash-specific export path stays untouched.

## Section 1: Rust Backend — `export_generic_report`

New command in `commands/export.rs`:

```rust
struct GenericExportRequest {
    source_type: String,        // "crash", "code", "sentry", "jira"
    source_name: String,        // filename/ticket key for suggested filename
    format: String,
    audience: Option<String>,
    title: Option<String>,
    sections: Vec<ReportSection>,
    footer_text: Option<String>,
}

struct ReportSection {
    id: String,
    label: String,
    content: String,
}
```

Bypasses crash parser. Builds `ReportData` directly from provided sections, dispatches to existing format generators. Existing crash export commands remain unchanged.

## Section 2: Frontend — Unified ExportDialog

Refactor `ExportDialog.tsx` props from `{ analysis: Analysis }` to:

```typescript
interface ExportSource {
  sourceType: "crash" | "code" | "sentry" | "jira";
  sourceName: string;
  defaultTitle: string;
  sections: { id: string; label: string; content: string; defaultOn: boolean }[];
}
```

Each analyzer builds an `ExportSource` before opening the dialog:
- **Crash Analyzer**: error_type, root_cause, stack_trace, severity, etc.
- **Code Analyzer**: overview, issues, walkthrough, optimized code, quality scores
- **Sentry Analyzer**: summary, patterns, breadcrumbs, stack trace, context
- **JIRA Analyzer**: triage, brief summary, root cause, actions, risk assessment

Section toggles in the left panel dynamically reflect the source. Format selection, audience, preview, title/footer stay the same.

`AnalysisDetailView.tsx` updated to build `ExportSource` from `Analysis` — functionally identical to today.

## Section 3: File Location Picker in Export Dialog

Segmented control in the export dialog footer with three options:
1. **"Download"** — current blob download behavior (default if no export dir set)
2. **"Default folder"** — saves to configured default export dir (greyed out if not set)
3. **"Choose..."** — opens Tauri `save` dialog per-export

"Default folder" and "Choose..." use `writeTextFile`/`writeBinaryFile` from `@tauri-apps/plugin-fs`.

## Section 4: Default Export Location in Settings

- New `STORAGE_KEYS.DEFAULT_EXPORT_DIR` in `config.ts`
- Added to Preferences card in `SettingsPanel.tsx`
- UI: label + read-only path + folder picker button + clear button
- Pattern matches Crash Log Directory setting (`tauriOpen({ directory: true })`)
- Stored in localStorage
- ExportDialog reads on mount; pre-selects "Default folder" if set, else "Download"

## Files to Create/Modify

### Rust
- `src-tauri/src/commands/export.rs` — add `GenericExportRequest`, `ReportSection`, `export_generic_report` command
- `src-tauri/src/export/mod.rs` — add `ReportData::from_sections()` builder
- `src-tauri/src/main.rs` — register new command

### Frontend
- `src/components/ExportDialog.tsx` — refactor to `ExportSource`, add location picker
- `src/components/AnalysisDetailView.tsx` — build `ExportSource` from `Analysis`
- `src/components/code-analyzer/CodeAnalyzerView.tsx` — add Export button + build `ExportSource`
- `src/components/sentry/SentryDetailView.tsx` — replace markdown-only with full ExportDialog
- `src/components/jira/JiraTicketAnalyzer.tsx` — add Export button + build `ExportSource`
- `src/utils/config.ts` — add `DEFAULT_EXPORT_DIR` storage key
- `src/components/SettingsPanel.tsx` — add default export location setting
- `src/services/api.ts` — add `exportGenericReport()` API function
- `src/types/index.ts` — add `ExportSource`, `GenericExportRequest` types

## Constraints

- No IPC signature changes to existing commands
- Crash Analyzer export must remain functionally identical
- All 6 formats available for all analyzers
- Sentry "Copy Report" and "Export Markdown" quick buttons can stay alongside the new "Export Options" button
