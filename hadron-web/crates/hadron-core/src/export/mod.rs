pub mod generators;
pub mod types;

pub use types::*;

/// Render `data` into the requested `format`, returning the result as a `String`.
pub fn export_report(data: &GenericReportData, format: ExportFormat) -> String {
    match format {
        ExportFormat::Markdown => generators::generate_markdown(data),
        ExportFormat::Html => generators::generate_html(data),
        ExportFormat::InteractiveHtml => generators::generate_interactive_html(data),
        ExportFormat::Json => generators::generate_json(data),
        ExportFormat::Txt => generators::generate_txt(data),
    }
}
