//! Report export commands

use super::common::helpers::redact_pii_basic;
use super::patterns::PatternEngineState;
use crate::export::{
    default_config_for_audience, export_report, export_report_multi, has_sensitive_content,
    sanitize_for_customer, simplify_technical_terms, ExportFormat, ReportAudience, ReportData,
    ReportSections,
};
use crate::parser::CrashFileParser;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Export configuration from frontend
#[derive(Deserialize)]
pub struct ExportRequest {
    pub crash_content: String,
    pub file_name: String,
    pub format: String,
    pub audience: Option<String>,
    pub title: Option<String>,
    pub include_sections: Option<Vec<String>>,
    pub footer_text: Option<String>,
}

/// Export response with content and suggested filename
#[derive(Serialize)]
pub struct ExportResponse {
    pub content: String,
    pub suggested_filename: String,
    pub format: String,
}

/// Result of sensitive content check
#[derive(Serialize)]
pub struct SensitiveContentResult {
    pub has_sensitive: bool,
    pub warnings: Vec<String>,
    pub detected_types: Vec<String>,
}

/// Generate a report from crash content
#[tauri::command]
pub fn generate_report(
    request: ExportRequest,
    engine: State<'_, PatternEngineState>,
) -> Result<ExportResponse, String> {
    log::info!(
        "Generating {} report for: {}",
        request.format,
        request.file_name
    );

    // Parse the crash file
    let parser = CrashFileParser::new();
    let crash = parser
        .parse_content(
            &request.crash_content,
            &request.file_name,
            request.crash_content.len() as u64,
        )
        .map_err(|e| format!("Parse error: {}", e))?;

    // Get pattern match
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let pattern_match = engine_guard.find_best_match(&crash);
    drop(engine_guard);

    // Determine audience
    let audience = match request.audience.as_deref() {
        Some("customer") => ReportAudience::Customer,
        Some("support") => ReportAudience::Support,
        Some("executive") => ReportAudience::Executive,
        _ => ReportAudience::Technical,
    };

    // Build config
    let mut config = default_config_for_audience(audience);
    config.title = request.title;

    if let Some(footer) = request.footer_text {
        config.branding.footer_text = Some(footer);
    }

    // Override sections if specified
    if let Some(sections) = request.include_sections {
        config.sections = ReportSections {
            summary: sections.contains(&"summary".to_string()),
            environment: sections.contains(&"environment".to_string()),
            exception_details: sections.contains(&"exception_details".to_string()),
            root_cause: sections.contains(&"root_cause".to_string()),
            reproduction_steps: sections.contains(&"reproduction_steps".to_string()),
            suggested_fix: sections.contains(&"suggested_fix".to_string()),
            stack_trace: sections.contains(&"stack_trace".to_string()),
            context_arguments: sections.contains(&"context_arguments".to_string()),
            database_state: sections.contains(&"database_state".to_string()),
            memory_report: sections.contains(&"memory_report".to_string()),
            system_warnings: sections.contains(&"system_warnings".to_string()),
            impact_analysis: sections.contains(&"impact_analysis".to_string()),
            test_scenarios: sections.contains(&"test_scenarios".to_string()),
            investigation_queries: sections.contains(&"investigation_queries".to_string()),
            pattern_match: sections.contains(&"pattern_match".to_string()),
        };
    }

    // Create report data
    let report_data = ReportData::from_crash(&crash, pattern_match.as_ref(), config);

    // Determine format
    let format = match request.format.to_lowercase().as_str() {
        "html" => ExportFormat::Html,
        "json" => ExportFormat::Json,
        _ => ExportFormat::Markdown,
    };

    // Generate report
    let content = export_report(&report_data, format);

    // Determine file extension
    let extension = match format {
        ExportFormat::Html => "html",
        ExportFormat::Json => "json",
        ExportFormat::Markdown => "md",
    };

    // Create suggested filename
    let base_name = std::path::Path::new(&request.file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("report");

    let suggested_filename = format!("{}_report.{}", base_name, extension);

    Ok(ExportResponse {
        content,
        suggested_filename,
        format: request.format,
    })
}

/// Get available export formats
#[tauri::command]
pub fn get_export_formats() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "markdown",
            "name": "Markdown",
            "extension": "md",
            "description": "Plain text with formatting, ideal for documentation"
        }),
        serde_json::json!({
            "id": "html",
            "name": "HTML",
            "extension": "html",
            "description": "Styled web page, can be opened in any browser"
        }),
        serde_json::json!({
            "id": "json",
            "name": "JSON",
            "extension": "json",
            "description": "Structured data, ideal for integrations"
        }),
    ]
}

/// Get available audience options
#[tauri::command]
pub fn get_audience_options() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "technical",
            "name": "Technical",
            "description": "Full details for developers"
        }),
        serde_json::json!({
            "id": "support",
            "name": "Support",
            "description": "Actionable info for support engineers"
        }),
        serde_json::json!({
            "id": "customer",
            "name": "Customer",
            "description": "Sanitized summary for end users"
        }),
        serde_json::json!({
            "id": "executive",
            "name": "Executive",
            "description": "High-level summary for management"
        }),
    ]
}

/// Preview a report without saving
#[tauri::command]
pub fn preview_report(
    crash_content: String,
    file_name: String,
    format: String,
    audience: String,
    engine: State<'_, PatternEngineState>,
) -> Result<String, String> {
    let request = ExportRequest {
        crash_content,
        file_name,
        format,
        audience: Some(audience),
        title: None,
        include_sections: None,
        footer_text: None,
    };

    let response = generate_report(request, engine)?;
    Ok(response.content)
}

/// Check content for sensitive data before sending to AI
#[tauri::command]
pub fn check_sensitive_content(content: String) -> Result<SensitiveContentResult, String> {
    log::debug!(
        "Checking content for sensitive data ({} bytes)",
        content.len()
    );

    let mut warnings = Vec::new();
    let mut detected_types = Vec::new();

    use super::common::helpers::detect_pii_types;
    let pii_types = detect_pii_types(&content);
    for pii_type in &pii_types {
        detected_types.push(pii_type.to_string());
        warnings.push(match *pii_type {
            "email" => "Email addresses detected in content".to_string(),
            "ip" => "IP addresses detected in content".to_string(),
            "token" => "API tokens or keys detected in content".to_string(),
            "path" => "User directory paths detected in content".to_string(),
            _ => format!("{} detected in content", pii_type),
        });
    }

    let has_sensitive = has_sensitive_content(&content) || !detected_types.is_empty();

    if has_sensitive && warnings.is_empty() {
        warnings.push("Potentially sensitive content detected (usernames, passwords)".to_string());
        detected_types.push("credentials".to_string());
    }

    log::info!(
        "Sensitive content check: has_sensitive={}, types={:?}",
        has_sensitive,
        detected_types
    );

    Ok(SensitiveContentResult {
        has_sensitive,
        warnings,
        detected_types,
    })
}

/// Sanitize content for a specific audience
#[tauri::command]
pub fn sanitize_content(content: String, audience: String) -> Result<String, String> {
    log::debug!("Sanitizing content for audience: {}", audience);

    let sanitized = match audience.to_lowercase().as_str() {
        "customer" | "executive" => {
            // Maximum sanitization: redact PII and simplify technical terms
            let redacted = sanitize_for_customer(&content);
            simplify_technical_terms(&redacted)
        }
        "support" => {
            // Moderate sanitization: redact PII but keep technical terms
            sanitize_for_customer(&content)
        }
        _ => {
            // Minimal sanitization (including "technical"): just redact obvious PII
            redact_pii_basic(&content).into_owned()
        }
    };

    log::info!("Content sanitized for audience: {}", audience);
    Ok(sanitized)
}

/// Multi-file report export request
#[derive(Deserialize)]
pub struct MultiExportRequest {
    pub files: Vec<ExportRequest>,
    pub format: String,
    pub combined: bool,
}

/// Generate a report from multiple crash files
#[tauri::command]
pub fn generate_report_multi(
    request: MultiExportRequest,
    engine: State<'_, PatternEngineState>,
) -> Result<ExportResponse, String> {
    log::info!(
        "Generating multi-file {} report for {} files",
        request.format,
        request.files.len()
    );

    if request.files.is_empty() {
        return Err("No files provided".to_string());
    }

    // If not combined, just process first file
    if !request.combined {
        let first = request.files.into_iter().next().unwrap();
        return generate_report(first, engine);
    }

    // Parse all crash files
    let parser = CrashFileParser::new();
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    let mut report_data_list = Vec::new();
    for file in &request.files {
        let crash = parser
            .parse_content(&file.crash_content, &file.file_name, file.crash_content.len() as u64)
            .map_err(|e| format!("Parse error for {}: {}", file.file_name, e))?;

        let pattern_match = engine_guard.find_best_match(&crash);

        let audience = match file.audience.as_deref() {
            Some("customer") => ReportAudience::Customer,
            Some("support") => ReportAudience::Support,
            Some("executive") => ReportAudience::Executive,
            _ => ReportAudience::Technical,
        };

        let config = default_config_for_audience(audience);
        let report_data = ReportData::from_crash(&crash, pattern_match.as_ref(), config);
        report_data_list.push(report_data);
    }

    drop(engine_guard);

    // Determine format
    let format = match request.format.to_lowercase().as_str() {
        "html" => ExportFormat::Html,
        "json" => ExportFormat::Json,
        _ => ExportFormat::Markdown,
    };

    // Generate combined report
    let content = export_report_multi(&report_data_list, format);

    // Determine file extension
    let extension = match format {
        ExportFormat::Html => "html",
        ExportFormat::Json => "json",
        ExportFormat::Markdown => "md",
    };

    let suggested_filename = format!("combined_report_{}.{}", request.files.len(), extension);

    Ok(ExportResponse {
        content,
        suggested_filename,
        format: request.format,
    })
}
