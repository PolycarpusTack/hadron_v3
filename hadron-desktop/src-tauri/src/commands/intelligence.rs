//! Intelligence Platform Commands (Gold analysis, feedback, fine-tuning export)

use super::common::DbState;
use crate::database::{AnalysisFeedback, GoldAnalysis};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Request structure for submitting feedback
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    pub analysis_id: i64,
    pub feedback_type: String,
    pub field_name: Option<String>,
    pub original_value: Option<String>,
    pub new_value: Option<String>,
    pub rating: Option<i32>,
}

/// Export result for fine-tuning data
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FineTuneExportResult {
    pub total_exported: usize,
    pub jsonl_content: String,
    pub format: String,
}

/// Export options for fine-tuning data
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub include_pending: Option<bool>,
    pub component_filter: Option<Vec<String>>,
    pub severity_filter: Option<Vec<String>>,
    pub balance_dataset: Option<bool>,
    pub max_examples: Option<usize>,
    pub test_split: Option<f32>,
}

/// Dataset statistics for export
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetStatistics {
    pub total_examples: usize,
    pub by_component: HashMap<String, usize>,
    pub by_severity: HashMap<String, usize>,
    pub verified_count: usize,
    pub pending_count: usize,
    pub avg_rating: Option<f64>,
}

/// Enhanced export result with statistics
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedExportResult {
    pub total_exported: usize,
    pub train_count: usize,
    pub test_count: usize,
    pub train_jsonl: String,
    pub test_jsonl: String,
    pub format: String,
    pub statistics: DatasetStatistics,
}

/// OpenAI fine-tuning message format
#[derive(Debug, Serialize, Deserialize)]
struct FineTuneMessage {
    role: String,
    content: String,
}

/// OpenAI fine-tuning conversation format
#[derive(Debug, Serialize, Deserialize)]
struct FineTuneConversation {
    messages: Vec<FineTuneMessage>,
}

/// Submit feedback for an analysis
#[tauri::command]
pub fn submit_analysis_feedback(
    feedback: FeedbackRequest,
    db: DbState<'_>,
) -> Result<AnalysisFeedback, String> {
    log::debug!("cmd: submit_analysis_feedback");
    log::info!(
        "Submitting {} feedback for analysis {}",
        feedback.feedback_type,
        feedback.analysis_id
    );

    let valid_types = ["accept", "reject", "edit", "rating"];
    if !valid_types.contains(&feedback.feedback_type.as_str()) {
        return Err(format!(
            "Invalid feedback type: {}. Must be one of: {:?}",
            feedback.feedback_type, valid_types
        ));
    }

    if let Some(rating) = feedback.rating {
        if !(1..=5).contains(&rating) {
            return Err("Rating must be between 1 and 5".to_string());
        }
    }

    db.submit_feedback(
        feedback.analysis_id,
        &feedback.feedback_type,
        feedback.field_name.as_deref(),
        feedback.original_value.as_deref(),
        feedback.new_value.as_deref(),
        feedback.rating,
    )
    .map_err(|e| format!("Failed to save feedback: {}", e))
}

/// Get all feedback for an analysis
#[tauri::command]
pub fn get_feedback_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<Vec<AnalysisFeedback>, String> {
    log::debug!("cmd: get_feedback_for_analysis");
    log::info!("Getting feedback for analysis {}", analysis_id);
    db.get_feedback_for_analysis(analysis_id)
        .map_err(|e| format!("Failed to get feedback: {}", e))
}

/// Promote an analysis to gold standard
#[tauri::command]
pub fn promote_to_gold(analysis_id: i64, db: DbState<'_>) -> Result<GoldAnalysis, String> {
    log::debug!("cmd: promote_to_gold");
    log::info!("Promoting analysis {} to gold standard", analysis_id);
    db.promote_to_gold(analysis_id)
        .map_err(|e| format!("Failed to promote to gold: {}", e))
}

/// Get all gold analyses
#[tauri::command]
pub fn get_gold_analyses(db: DbState<'_>) -> Result<Vec<GoldAnalysis>, String> {
    log::debug!("cmd: get_gold_analyses");
    log::info!("Getting all gold analyses");
    db.get_gold_analyses()
        .map_err(|e| format!("Failed to get gold analyses: {}", e))
}

/// Check if an analysis is a gold standard
#[tauri::command]
pub fn is_gold_analysis(analysis_id: i64, db: DbState<'_>) -> Result<bool, String> {
    log::debug!("cmd: is_gold_analysis");
    db.is_gold_analysis(analysis_id)
        .map_err(|e| format!("Failed to check gold status: {}", e))
}

/// Get pending gold analyses for review
#[tauri::command]
pub fn get_pending_gold_analyses(db: DbState<'_>) -> Result<Vec<GoldAnalysis>, String> {
    log::debug!("cmd: get_pending_gold_analyses");
    log::info!("Getting pending gold analyses for review");
    db.get_pending_gold_analyses()
        .map_err(|e| format!("Failed to get pending gold analyses: {}", e))
}

/// Verify a gold analysis
#[tauri::command]
pub fn verify_gold_analysis(
    gold_analysis_id: i64,
    verified_by: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: verify_gold_analysis");
    log::info!("Verifying gold analysis {}", gold_analysis_id);
    db.verify_gold_analysis(gold_analysis_id, verified_by.as_deref())
        .map_err(|e| format!("Failed to verify gold analysis: {}", e))
}

/// Reject a gold analysis
#[tauri::command]
pub fn reject_gold_analysis(
    gold_analysis_id: i64,
    verified_by: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: reject_gold_analysis");
    log::info!("Rejecting gold analysis {}", gold_analysis_id);
    db.reject_gold_analysis(gold_analysis_id, verified_by.as_deref())
        .map_err(|e| format!("Failed to reject gold analysis: {}", e))
}

/// Get rejected gold analyses for review
#[tauri::command]
pub fn get_rejected_gold_analyses(db: DbState<'_>) -> Result<Vec<GoldAnalysis>, String> {
    log::debug!("cmd: get_rejected_gold_analyses");
    db.get_gold_analyses_by_status("rejected")
        .map_err(|e| format!("Failed to get rejected gold analyses: {}", e))
}

/// Reopen a rejected gold analysis (set back to pending)
#[tauri::command]
pub fn reopen_gold_analysis(gold_analysis_id: i64, db: DbState<'_>) -> Result<(), String> {
    log::debug!("cmd: reopen_gold_analysis");
    log::info!("Reopening gold analysis {}", gold_analysis_id);
    db.reopen_gold_analysis(gold_analysis_id)
        .map_err(|e| format!("Failed to reopen gold analysis: {}", e))
}

/// Check if an analysis is eligible for auto-promotion
#[tauri::command]
pub fn check_auto_promotion_eligibility(analysis_id: i64, db: DbState<'_>) -> Result<bool, String> {
    log::debug!("cmd: check_auto_promotion_eligibility");
    db.check_auto_promotion_eligibility(analysis_id)
        .map_err(|e| format!("Failed to check auto-promotion eligibility: {}", e))
}

/// Auto-promote an analysis to gold if eligible
#[tauri::command]
pub fn auto_promote_if_eligible(analysis_id: i64, db: DbState<'_>) -> Result<bool, String> {
    log::debug!("cmd: auto_promote_if_eligible");
    log::info!(
        "Checking auto-promotion eligibility for analysis {}",
        analysis_id
    );
    db.auto_promote_if_eligible(analysis_id)
        .map_err(|e| format!("Failed to auto-promote analysis: {}", e))
}

/// Export verified gold analyses as JSONL for OpenAI fine-tuning
#[tauri::command]
pub fn export_gold_jsonl(db: DbState<'_>) -> Result<FineTuneExportResult, String> {
    log::debug!("cmd: export_gold_jsonl");
    log::info!("Exporting gold analyses to JSONL for fine-tuning");

    let gold_analyses = db
        .get_gold_analyses_for_export()
        .map_err(|e| format!("Failed to get gold analyses: {}", e))?;

    if gold_analyses.is_empty() {
        return Ok(FineTuneExportResult {
            total_exported: 0,
            jsonl_content: String::new(),
            format: "openai_chat".to_string(),
        });
    }

    let system_prompt = r#"You are a WHATS'ON broadcast management system crash analysis expert. Analyze Smalltalk crash logs and JIRA bug tickets and provide:
1. Root cause identification with specific class/method references
2. Severity assessment (critical/high/medium/low)
3. Actionable fix suggestions specific to WHATS'ON
4. Component classification (EPG, Rights, Scheduling, etc.)

Return your analysis as structured JSON with fields: error_type, severity, root_cause, suggested_fixes (array), component."#;

    let mut jsonl_lines: Vec<String> = Vec::new();

    for gold in &gold_analyses {
        let user_content = build_crash_context(gold);
        let assistant_content = build_analysis_response(gold);

        let conversation = FineTuneConversation {
            messages: vec![
                FineTuneMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                FineTuneMessage {
                    role: "user".to_string(),
                    content: user_content,
                },
                FineTuneMessage {
                    role: "assistant".to_string(),
                    content: assistant_content,
                },
            ],
        };

        let json_line = serde_json::to_string(&conversation)
            .map_err(|e| format!("Failed to serialize conversation: {}", e))?;
        jsonl_lines.push(json_line);
    }

    let jsonl_content = jsonl_lines.join("\n");

    log::info!("Exported {} gold analyses to JSONL", gold_analyses.len());

    Ok(FineTuneExportResult {
        total_exported: gold_analyses.len(),
        jsonl_content,
        format: "openai_chat".to_string(),
    })
}

fn build_crash_context(gold: &crate::database::GoldAnalysisExport) -> String {
    let mut context = String::new();
    context.push_str(&format!("Error Signature: {}\n", gold.error_signature));

    if let Some(error_type) = &gold.source_error_type {
        context.push_str(&format!("Error Type: {}\n", error_type));
    }

    if let Some(error_message) = &gold.source_error_message {
        context.push_str(&format!("Error Message: {}\n", error_message));
    }

    if let Some(stack_trace) = &gold.source_stack_trace {
        context.push_str(&format!("\nStack Trace:\n{}\n", stack_trace));
    }

    if let Some(full_data) = &gold.source_full_data {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(full_data) {
            if let Some(exception) = data.get("exception_details") {
                if let Some(exception_str) = exception.as_str() {
                    context.push_str(&format!("\nException Details:\n{}\n", exception_str));
                }
            }
            if let Some(env) = data.get("environment") {
                if let Some(env_obj) = env.as_object() {
                    context.push_str("\nEnvironment:\n");
                    for (key, value) in env_obj {
                        if let Some(v) = value.as_str() {
                            context.push_str(&format!("  {}: {}\n", key, v));
                        }
                    }
                }
            }
        }
    }

    context
}

fn build_analysis_response(gold: &crate::database::GoldAnalysisExport) -> String {
    let fixes: Vec<String> = serde_json::from_str(&gold.suggested_fixes)
        .unwrap_or_else(|_| vec![gold.suggested_fixes.clone()]);

    let response = serde_json::json!({
        "error_type": gold.error_signature.split("::").next().unwrap_or(&gold.error_signature),
        "severity": gold.severity.as_deref().unwrap_or("medium"),
        "root_cause": gold.root_cause,
        "suggested_fixes": fixes,
        "component": gold.component.as_deref().unwrap_or("Unknown")
    });

    serde_json::to_string_pretty(&response).unwrap_or_else(|_| gold.root_cause.clone())
}

/// Count verified gold analyses available for export
#[tauri::command]
pub fn count_gold_for_export(db: DbState<'_>) -> Result<i64, String> {
    log::debug!("cmd: count_gold_for_export");
    db.count_verified_gold_analyses()
        .map_err(|e| format!("Failed to count gold analyses: {}", e))
}

/// Get export statistics
#[tauri::command]
pub fn get_export_statistics(db: DbState<'_>) -> Result<DatasetStatistics, String> {
    log::debug!("cmd: get_export_statistics");
    let gold_analyses = db
        .get_gold_analyses_for_export()
        .map_err(|e| format!("Failed to get gold analyses: {}", e))?;

    let mut by_component: HashMap<String, usize> = HashMap::new();
    let mut by_severity: HashMap<String, usize> = HashMap::new();
    let mut verified_count = 0;
    let pending_count = 0;

    for gold in &gold_analyses {
        let component = gold.component.clone().unwrap_or_else(|| "Unknown".to_string());
        *by_component.entry(component).or_insert(0) += 1;

        let severity = gold.severity.clone().unwrap_or_else(|| "Unknown".to_string());
        *by_severity.entry(severity).or_insert(0) += 1;

        verified_count += 1;
    }

    Ok(DatasetStatistics {
        total_examples: gold_analyses.len(),
        by_component,
        by_severity,
        verified_count,
        pending_count,
        avg_rating: None,
    })
}
