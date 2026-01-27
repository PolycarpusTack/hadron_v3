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
    log::info!("Searching JIRA issues with JQL");
    jira_service::search_jira_issues(base_url, email, api_token, jql, max_results, include_comments)
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
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.count_jira_links_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all JIRA links
#[tauri::command]
pub async fn get_all_jira_links(db: DbState<'_>) -> Result<Vec<JiraLink>, String> {
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.get_all_jira_links())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}
