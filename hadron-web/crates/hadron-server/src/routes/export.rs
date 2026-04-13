//! Analysis export handlers.

use axum::extract::{Path, State};
use axum::http::header;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

pub async fn export_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<ExportRequest>,
) -> Result<impl IntoResponse, AppError> {
    let analysis = db::get_analysis_by_id(&state.db, id, user.user.id).await?;
    let audience = req.audience.as_deref().unwrap_or("technical");

    match req.format.as_str() {
        "markdown" => {
            let md = export_markdown(&analysis, audience);
            Ok((
                [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
                md,
            )
                .into_response())
        }
        "html" => {
            let html = export_html(&analysis, audience);
            Ok((
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                html,
            )
                .into_response())
        }
        "json" => {
            let json = export_json(&analysis, audience);
            Ok((
                [(header::CONTENT_TYPE, "application/json")],
                json,
            )
                .into_response())
        }
        _ => Err(AppError(hadron_core::error::HadronError::validation(
            "Invalid format. Use 'markdown', 'html', or 'json'",
        ))),
    }
}

fn export_markdown(analysis: &Analysis, audience: &str) -> String {
    let mut md = String::new();
    md.push_str(&format!("# Crash Analysis: {}\n\n", analysis.filename));

    if let Some(ref sev) = analysis.severity {
        md.push_str(&format!("**Severity:** {sev}\n\n"));
    }

    if let Some(ref et) = analysis.error_type {
        md.push_str(&format!("## Error Type\n\n{et}\n\n"));
    }

    if let Some(ref em) = analysis.error_message {
        md.push_str(&format!("## Error Message\n\n{em}\n\n"));
    }

    if audience != "executive" {
        if let Some(ref comp) = analysis.component {
            md.push_str(&format!("## Component\n\n{comp}\n\n"));
        }
    }

    if let Some(ref rc) = analysis.root_cause {
        md.push_str("## Root Cause\n\n");
        if audience == "customer" {
            md.push_str(&simplify_for_customer(rc));
        } else {
            md.push_str(rc);
        }
        md.push_str("\n\n");
    }

    if let Some(ref fixes) = analysis.suggested_fixes {
        if let Some(arr) = fixes.as_array() {
            md.push_str("## Suggested Fixes\n\n");
            for (i, fix) in arr.iter().enumerate() {
                if let Some(s) = fix.as_str() {
                    md.push_str(&format!("{}. {s}\n", i + 1));
                }
            }
            md.push('\n');
        }
    }

    if audience == "technical" || audience == "support" {
        if let Some(ref st) = analysis.stack_trace {
            md.push_str("## Stack Trace\n\n```\n");
            md.push_str(st);
            md.push_str("\n```\n\n");
        }
    }

    md.push_str(&format!(
        "---\n*Analyzed: {} | Confidence: {}*\n",
        analysis.analyzed_at,
        analysis.confidence.as_deref().unwrap_or("N/A")
    ));

    md
}

fn export_html(analysis: &Analysis, audience: &str) -> String {
    let md = export_markdown(analysis, audience);
    // Simple markdown-to-html conversion
    let mut html = String::from("<!DOCTYPE html><html><head><meta charset='utf-8'><title>Crash Analysis</title>");
    html.push_str("<style>body{font-family:system-ui;max-width:800px;margin:2em auto;padding:0 1em;color:#e2e8f0;background:#0f172a}");
    html.push_str("h1,h2{color:#f1f5f9}pre{background:#1e293b;padding:1em;border-radius:8px;overflow-x:auto}");
    html.push_str("code{color:#93c5fd}</style></head><body>");

    for line in md.lines() {
        if line.starts_with("# ") {
            html.push_str(&format!("<h1>{}</h1>", &line[2..]));
        } else if line.starts_with("## ") {
            html.push_str(&format!("<h2>{}</h2>", &line[3..]));
        } else if line.starts_with("**") && line.ends_with("**") {
            html.push_str(&format!("<p><strong>{}</strong></p>", line.trim_matches('*')));
        } else if line.starts_with("```") {
            html.push_str("<pre><code>");
        } else if line == "```" {
            html.push_str("</code></pre>");
        } else if line.starts_with("---") {
            html.push_str("<hr>");
        } else if line.starts_with('*') && line.ends_with('*') {
            html.push_str(&format!("<p><em>{}</em></p>", line.trim_matches('*')));
        } else if !line.is_empty() {
            html.push_str(&format!("<p>{line}</p>"));
        }
    }

    html.push_str("</body></html>");
    html
}

fn export_json(analysis: &Analysis, audience: &str) -> String {
    let mut obj = serde_json::json!({
        "filename": analysis.filename,
        "severity": analysis.severity,
        "errorType": analysis.error_type,
        "errorMessage": analysis.error_message,
        "rootCause": analysis.root_cause,
        "suggestedFixes": analysis.suggested_fixes,
        "confidence": analysis.confidence,
        "analyzedAt": analysis.analyzed_at,
    });

    if audience == "technical" || audience == "support" {
        obj["component"] = serde_json::json!(analysis.component);
        obj["stackTrace"] = serde_json::json!(analysis.stack_trace);
        obj["errorSignature"] = serde_json::json!(analysis.error_signature);
    }

    serde_json::to_string_pretty(&obj).unwrap_or_default()
}

fn simplify_for_customer(text: &str) -> String {
    // Remove overly technical details for customer-facing exports
    text.replace("NULL", "empty value")
        .replace("segfault", "unexpected crash")
        .replace("SIGSEGV", "memory error")
        .replace("stack overflow", "resource limit exceeded")
}

// ============================================================================
// Generic export handler
// ============================================================================

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
