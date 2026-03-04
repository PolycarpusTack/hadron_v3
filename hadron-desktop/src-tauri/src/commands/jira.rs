//! JIRA integration commands

use crate::jira_service;
use super::common::DbState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// JIRA link record for analysis-ticket relationships
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraLink {
    pub id: i64,
    pub analysis_id: i64,
    pub jira_key: String,
    pub jira_url: Option<String>,
    pub link_type: String,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Test JIRA connection
#[tauri::command]
pub async fn test_jira_connection(
    base_url: String,
    email: String,
    api_token: String,
) -> Result<jira_service::JiraTestResponse, String> {
    log::debug!("cmd: test_jira_connection");
    log::info!("Testing JIRA connection");
    jira_service::test_jira_connection(base_url, email, api_token).await
}

/// List JIRA projects for autocomplete
#[tauri::command]
pub async fn list_jira_projects(
    base_url: String,
    email: String,
    api_token: String,
) -> Result<Vec<jira_service::JiraProjectInfo>, String> {
    log::debug!("cmd: list_jira_projects");
    log::info!("Listing JIRA projects");
    jira_service::list_jira_projects(base_url, email, api_token).await
}

/// Create JIRA ticket from crash analysis
#[tauri::command]
pub async fn create_jira_ticket(
    base_url: String,
    email: String,
    api_token: String,
    project_key: String,
    issue_type: String,
    ticket: jira_service::JiraTicketRequest,
) -> Result<jira_service::JiraCreateResponse, String> {
    log::debug!("cmd: create_jira_ticket");
    log::info!("Creating JIRA ticket");
    jira_service::create_jira_ticket(base_url, email, api_token, project_key, issue_type, ticket)
        .await
}

/// Search JIRA issues using JQL
#[tauri::command]
pub async fn search_jira_issues(
    base_url: String,
    email: String,
    api_token: String,
    jql: String,
    max_results: i32,
    include_comments: bool,
) -> Result<jira_service::JiraSearchResponse, String> {
    log::debug!("cmd: search_jira_issues");
    log::info!("Searching JIRA issues with JQL");
    jira_service::search_jira_issues(base_url, email, api_token, jql, max_results, include_comments)
        .await
}

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

/// Link a JIRA ticket to an analysis
#[tauri::command]
pub async fn link_jira_to_analysis(
    analysis_id: i64,
    jira_key: String,
    jira_url: Option<String>,
    link_type: Option<String>,
    status: Option<String>,
    summary: Option<String>,
    db: DbState<'_>,
) -> Result<JiraLink, String> {
    log::debug!("cmd: link_jira_to_analysis");
    let db = Arc::clone(&db);
    let link_type = link_type.unwrap_or_else(|| "related".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        db.link_jira_to_analysis(
            analysis_id,
            &jira_key,
            jira_url.as_deref(),
            &link_type,
            status.as_deref(),
            summary.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

/// Unlink a JIRA ticket from an analysis
#[tauri::command]
pub async fn unlink_jira_from_analysis(link_id: i64, db: DbState<'_>) -> Result<(), String> {
    log::debug!("cmd: unlink_jira_from_analysis");
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.unlink_jira_from_analysis(link_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all JIRA links for an analysis
#[tauri::command]
pub async fn get_jira_links_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<Vec<JiraLink>, String> {
    log::debug!("cmd: get_jira_links_for_analysis");
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.get_jira_links_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all analyses linked to a JIRA ticket
#[tauri::command]
pub async fn get_analyses_for_jira_ticket(
    jira_key: String,
    db: DbState<'_>,
) -> Result<Vec<i64>, String> {
    log::debug!("cmd: get_analyses_for_jira_ticket");
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.get_analyses_for_jira_ticket(&jira_key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Update JIRA link metadata (status, summary)
#[tauri::command]
pub async fn update_jira_link_metadata(
    link_id: i64,
    status: Option<String>,
    summary: Option<String>,
    db: DbState<'_>,
) -> Result<JiraLink, String> {
    log::debug!("cmd: update_jira_link_metadata");
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || {
        db.update_jira_link_metadata(link_id, status.as_deref(), summary.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

/// Count JIRA links for an analysis
#[tauri::command]
pub async fn count_jira_links_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<i64, String> {
    log::debug!("cmd: count_jira_links_for_analysis");
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.count_jira_links_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all JIRA links
#[tauri::command]
pub async fn get_all_jira_links(db: DbState<'_>) -> Result<Vec<JiraLink>, String> {
    log::debug!("cmd: get_all_jira_links");
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.get_all_jira_links())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
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

        let full_data = serde_json::to_string(&result_for_db)
            .map_err(|e| format!("Serialization error: {}", e))?;

        let suggested_fixes_json = serde_json::to_string(
            &result_for_db
                .recommended_actions
                .iter()
                .map(|a| format!("[{}] {}", a.priority, a.action))
                .collect::<Vec<_>>()
        ).unwrap_or_else(|_| "[]".to_string());

        let now = chrono::Utc::now().to_rfc3339();

        let analysis = Analysis {
            id: 0,
            filename: jira_key_db,
            file_size_kb: 0.0,
            error_type: result_for_db.technical.error_type.clone(),
            error_message: Some(result_for_db.plain_summary.clone()),
            severity: result_for_db.technical.severity_estimate.clone(),
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
