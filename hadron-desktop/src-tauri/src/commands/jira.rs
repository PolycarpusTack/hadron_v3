//! JIRA integration commands — new/migrated commands only.
//!
//! NOTE: Legacy JIRA commands (test_jira_connection, list_jira_projects,
//! create_jira_ticket, search_jira_issues, link_jira_to_analysis, etc.)
//! remain in commands_legacy.rs until a full migration is done.

use super::common::DbState;
use crate::jira_service;
use std::sync::Arc;

/// Fetch the next page of JIRA issues using a cursor token
#[tauri::command]
pub async fn search_jira_issues_next_page(
    base_url: String,
    email: String,
    api_token: String,
    jql: String,
    max_results: i32,
    include_comments: bool,
    next_page_token: String,
) -> Result<jira_service::JiraSearchResponse, String> {
    log::debug!("cmd: search_jira_issues_next_page");
    jira_service::search_jira_issues_page_cursor(
        base_url,
        email,
        api_token,
        jql,
        Some(next_page_token),
        max_results,
        include_comments,
    )
    .await
}

/// Deep JIRA analysis — JIRA-specific prompt + structured JSON output stored in DB
#[tauri::command]
pub async fn analyze_jira_ticket_deep(
    request: crate::jira_deep_analysis::JiraDeepRequest,
    db: DbState<'_>,
) -> Result<serde_json::Value, String> {
    log::debug!("cmd: analyze_jira_ticket_deep key={}", request.jira_key);

    // Clone fields needed after request is moved into run_jira_deep_analysis
    let jira_key = request.jira_key.clone();
    let model = request.model.clone();
    let provider = request.provider.clone();

    let result = crate::jira_deep_analysis::run_jira_deep_analysis(request).await?;

    // Persist to DB using the existing analyses table
    let db = Arc::clone(&db);
    let result_for_db = result.clone();
    let jira_key_db = jira_key.clone();
    let model_db = model.clone();
    let provider_db = provider.clone();

    let analysis_id = tauri::async_runtime::spawn_blocking(move || {
        use crate::database::Analysis;

        // Remove any previous jira_deep analysis for this ticket to avoid duplicates
        db.delete_analyses_by_filename_and_type(&jira_key_db, "jira_deep")
            .map_err(|e| format!("Database error: {}", e))?;

        let full_data = serde_json::to_string(&result_for_db)
            .map_err(|e| format!("Serialization error: {}", e))?;

        let suggested_fixes_json = serde_json::to_string(
            &result_for_db
                .recommended_actions
                .iter()
                .map(|a| format!("[{}] {}", a.priority, a.action))
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|_| "[]".to_string());

        let now = chrono::Utc::now().to_rfc3339();

        let analysis = Analysis {
            id: 0,
            filename: jira_key_db,
            file_size_kb: 0.0,
            error_type: result_for_db.technical.error_type.clone(),
            error_message: Some(result_for_db.plain_summary.clone()),
            severity: result_for_db.technical.severity_estimate.to_uppercase(),
            component: None,
            stack_trace: None,
            root_cause: result_for_db.technical.root_cause.clone(),
            suggested_fixes: suggested_fixes_json,
            confidence: Some(result_for_db.technical.confidence.clone()),
            analyzed_at: now,
            ai_model: model_db,
            ai_provider: Some(provider_db),
            tokens_used: 0,
            cost: 0.0,
            was_truncated: false,
            full_data: Some(full_data),
            is_favorite: false,
            last_viewed_at: None,
            view_count: 0,
            analysis_duration_ms: None,
            analysis_type: "jira_deep".to_string(),
        };

        db.insert_analysis(&analysis)
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    Ok(serde_json::json!({
        "id": analysis_id,
        "result": result,
    }))
}
