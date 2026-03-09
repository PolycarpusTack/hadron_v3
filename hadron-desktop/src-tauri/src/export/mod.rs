pub mod generators;
pub mod report;
pub mod sanitizer;

pub use report::{GenericReportData, GenericSection, ReportAudience, ReportConfig, ReportData, ReportSections};
pub use sanitizer::{has_sensitive_content, sanitize_for_customer, simplify_technical_terms};

use generators::{
    generate_html, generate_html_interactive, generate_json, generate_markdown, generate_txt,
    generate_xlsx,
};

/// Export format options
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Markdown,
    Html,
    HtmlInteractive,
    Json,
    Txt,
    Xlsx,
}

/// Export a report to the specified format
pub fn export_report(data: &ReportData, format: ExportFormat) -> String {
    match format {
        ExportFormat::Markdown => generate_markdown(data),
        ExportFormat::Html => generate_html(data),
        ExportFormat::HtmlInteractive => generate_html_interactive(data),
        ExportFormat::Json => generate_json(data),
        ExportFormat::Txt => generate_txt(data),
        ExportFormat::Xlsx => generate_xlsx(data),
    }
}

/// Export a generic report to the specified format
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

/// Create a default report configuration for a specific audience
pub fn default_config_for_audience(audience: ReportAudience) -> ReportConfig {
    let sections = match audience {
        ReportAudience::Customer => ReportSections::customer_safe(),
        ReportAudience::Executive => ReportSections::summary_only(),
        _ => ReportSections::all(),
    };

    ReportConfig {
        audience,
        sections,
        ..ReportConfig::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::report::{CrashFileSummary, ReportMetadata};

    fn create_test_data() -> ReportData {
        ReportData {
            metadata: ReportMetadata {
                generated_at: "2024-01-15 10:30:00".to_string(),
                generator_version: "1.0.0".to_string(),
                report_id: "test-123".to_string(),
            },
            crash: CrashFileSummary {
                file_name: "test.txt".to_string(),
                timestamp: Some("2024-01-15 10:00:00".to_string()),
                user: Some("testuser".to_string()),
                site: Some("TestSite".to_string()),
                version: Some("1.0.0".to_string()),
                build: Some("12345".to_string()),
                computer: Some("TESTPC".to_string()),
                exception_type: "SubscriptOutOfBoundsError".to_string(),
                exception_message: "index 5 is out of bounds".to_string(),
                exception_parameter: None,
                stack_trace: vec![],
                stack_trace_truncated: false,
                open_windows: vec![],
                has_active_transaction: false,
                memory_warning: None,
                database_backend: Some("PostgreSQL".to_string()),
            },
            pattern_match: None,
            config: ReportConfig::default(),
        }
    }

    #[test]
    fn test_export_markdown() {
        let data = create_test_data();
        let result = export_report(&data, ExportFormat::Markdown);

        assert!(result.contains("# Crash Analysis Report"));
        assert!(result.contains("test.txt"));
    }

    #[test]
    fn test_export_html() {
        let data = create_test_data();
        let result = export_report(&data, ExportFormat::Html);

        assert!(result.contains("<!DOCTYPE html>"));
        assert!(result.contains("test.txt"));
    }

    #[test]
    fn test_export_json() {
        let data = create_test_data();
        let result = export_report(&data, ExportFormat::Json);

        assert!(result.contains("\"report_id\""));
        assert!(result.contains("test-123"));
    }

    #[test]
    fn test_export_txt() {
        let data = create_test_data();
        let result = export_report(&data, ExportFormat::Txt);

        assert!(result.contains("test.txt"));
    }

    #[test]
    fn test_customer_config() {
        let config = default_config_for_audience(ReportAudience::Customer);

        assert_eq!(config.audience, ReportAudience::Customer);
        assert!(!config.sections.stack_trace); // No stack trace for customers
        assert!(!config.sections.exception_details); // No raw exception for customers
        assert!(config.sections.summary); // Summary is included
    }
}
