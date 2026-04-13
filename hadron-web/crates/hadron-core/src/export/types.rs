use serde::{Deserialize, Serialize};

// ============================================================================
// Export Types
// ============================================================================

/// A complete report ready for export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericReportData {
    pub title: String,
    pub source_type: String,
    pub audience: Option<String>,
    pub sections: Vec<ReportSection>,
    pub footer: Option<String>,
}

/// A single section within a report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSection {
    pub id: String,
    pub label: String,
    pub content: String,
}

/// Supported export formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Markdown,
    Html,
    InteractiveHtml,
    Json,
    Txt,
}

impl ExportFormat {
    /// Returns the MIME content-type for this format.
    pub fn content_type(&self) -> &'static str {
        match self {
            ExportFormat::Markdown => "text/markdown; charset=utf-8",
            ExportFormat::Html => "text/html; charset=utf-8",
            ExportFormat::InteractiveHtml => "text/html; charset=utf-8",
            ExportFormat::Json => "application/json; charset=utf-8",
            ExportFormat::Txt => "text/plain; charset=utf-8",
        }
    }

    /// Returns the file extension (without leading dot) for this format.
    pub fn extension(&self) -> &'static str {
        match self {
            ExportFormat::Markdown => "md",
            ExportFormat::Html => "html",
            ExportFormat::InteractiveHtml => "html",
            ExportFormat::Json => "json",
            ExportFormat::Txt => "txt",
        }
    }
}
