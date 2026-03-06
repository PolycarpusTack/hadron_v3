//! JIRA integration commands — CRUD, search, linking, and deep analysis.

use super::common::DbState;
use crate::database::{Analysis, JiraLink};
use crate::jira_service;
use serde::Deserialize;
use std::sync::Arc;

// ============================================================================
// JIRA Core Commands (migrated from commands_legacy.rs)
// ============================================================================

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

/// Post a comment to a JIRA issue
#[tauri::command]
pub async fn post_jira_comment(
    base_url: String,
    email: String,
    api_token: String,
    issue_key: String,
    comment_body: String,
) -> Result<(), String> {
    log::debug!("cmd: post_jira_comment");
    log::info!("Posting comment to JIRA issue {}", issue_key);
    jira_service::post_jira_comment(&base_url, &email, &api_token, &issue_key, &comment_body).await
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

// ============================================================================
// JIRA Ticket Linking Commands (migrated from commands_legacy.rs)
// ============================================================================

/// Link request from frontend
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkJiraTicketRequest {
    pub analysis_id: i64,
    pub jira_key: String,
    pub jira_url: Option<String>,
    pub jira_summary: Option<String>,
    pub jira_status: Option<String>,
    pub jira_priority: Option<String>,
    pub link_type: Option<String>,
    pub notes: Option<String>,
}

/// Link a JIRA ticket to an analysis
#[tauri::command]
pub async fn link_jira_to_analysis(
    request: LinkJiraTicketRequest,
    db: DbState<'_>,
) -> Result<JiraLink, String> {
    log::debug!("cmd: link_jira_to_analysis");
    log::info!(
        "Linking JIRA {} to analysis {}",
        request.jira_key,
        request.analysis_id
    );

    let db_clone = Arc::clone(&db);
    let analysis_id = request.analysis_id;

    tauri::async_runtime::spawn_blocking(move || {
        let link_type = request.link_type.as_deref().unwrap_or("related");

        db_clone
            .link_jira_ticket(
                analysis_id,
                &request.jira_key,
                request.jira_url.as_deref(),
                request.jira_summary.as_deref(),
                request.jira_status.as_deref(),
                request.jira_priority.as_deref(),
                link_type,
                request.notes.as_deref(),
            )
            .map_err(|e| format!("Failed to link JIRA ticket: {}", e))?;

        db_clone
            .get_jira_links_for_analysis(analysis_id)
            .map_err(|e| format!("Failed to get link: {}", e))?
            .into_iter()
            .find(|l| l.jira_key == request.jira_key)
            .ok_or_else(|| "Link not found after creation".to_string())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Unlink a JIRA ticket from an analysis
#[tauri::command]
pub async fn unlink_jira_from_analysis(
    analysis_id: i64,
    jira_key: String,
    db: DbState<'_>,
) -> Result<bool, String> {
    log::debug!("cmd: unlink_jira_from_analysis");
    log::info!("Unlinking JIRA {} from analysis {}", jira_key, analysis_id);

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.unlink_jira_ticket(analysis_id, &jira_key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to unlink JIRA ticket: {}", e))
}

/// Get all JIRA links for an analysis
#[tauri::command]
pub async fn get_jira_links_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<Vec<JiraLink>, String> {
    log::debug!("cmd: get_jira_links_for_analysis");
    log::debug!("Getting JIRA links for analysis {}", analysis_id);

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.get_jira_links_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to get JIRA links: {}", e))
}

/// Get all analyses linked to a specific JIRA ticket
#[tauri::command]
pub async fn get_analyses_for_jira_ticket(
    jira_key: String,
    db: DbState<'_>,
) -> Result<Vec<(Analysis, JiraLink)>, String> {
    log::debug!("cmd: get_analyses_for_jira_ticket");
    log::debug!("Getting analyses linked to JIRA {}", jira_key);

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.get_analyses_for_jira_ticket(&jira_key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to get analyses for JIRA ticket: {}", e))
}

/// Update JIRA ticket metadata in all links (e.g., after status change)
#[tauri::command]
pub async fn update_jira_link_metadata(
    jira_key: String,
    jira_summary: Option<String>,
    jira_status: Option<String>,
    jira_priority: Option<String>,
    db: DbState<'_>,
) -> Result<usize, String> {
    log::debug!("cmd: update_jira_link_metadata");
    log::info!("Updating JIRA {} metadata in links", jira_key);

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || {
        db_clone.update_jira_link_metadata(
            &jira_key,
            jira_summary.as_deref(),
            jira_status.as_deref(),
            jira_priority.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to update JIRA link metadata: {}", e))
}

/// Count JIRA links for an analysis
#[tauri::command]
pub async fn count_jira_links_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> Result<i64, String> {
    log::debug!("cmd: count_jira_links_for_analysis");
    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.count_jira_links_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to count JIRA links: {}", e))
}

/// Get all JIRA links across all analyses (for sync service)
#[tauri::command]
pub async fn get_all_jira_links(db: DbState<'_>) -> Result<Vec<JiraLink>, String> {
    log::debug!("cmd: get_all_jira_links");
    log::debug!("Getting all JIRA links for sync");

    let db_clone = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db_clone.get_all_jira_links())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Failed to get all JIRA links: {}", e))
}
