//! Sentry integration commands

use crate::sentry_service;

/// Test Sentry connection
#[tauri::command]
pub async fn test_sentry_connection(
    base_url: String,
    auth_token: String,
) -> Result<sentry_service::SentryTestResponse, String> {
    log::info!("Testing Sentry connection");
    sentry_service::test_sentry_connection(&base_url, &auth_token).await
}

/// List Sentry projects for settings dropdown
#[tauri::command]
pub async fn list_sentry_projects(
    base_url: String,
    auth_token: String,
) -> Result<Vec<sentry_service::SentryProjectInfo>, String> {
    log::info!("Listing Sentry projects");
    sentry_service::list_sentry_projects(&base_url, &auth_token).await
}

/// List issues for a Sentry project
#[tauri::command]
pub async fn list_sentry_issues(
    base_url: String,
    auth_token: String,
    org: String,
    project: String,
    query: Option<String>,
    cursor: Option<String>,
) -> Result<sentry_service::SentryIssueList, String> {
    log::info!("Listing Sentry issues for {}/{}", org, project);
    sentry_service::list_sentry_issues(
        &base_url,
        &auth_token,
        &org,
        &project,
        query.as_deref(),
        cursor.as_deref(),
    )
    .await
}

/// Fetch a single Sentry issue by ID
#[tauri::command]
pub async fn fetch_sentry_issue(
    base_url: String,
    auth_token: String,
    issue_id: String,
) -> Result<sentry_service::SentryIssue, String> {
    log::info!("Fetching Sentry issue {}", issue_id);
    sentry_service::fetch_sentry_issue(&base_url, &auth_token, &issue_id).await
}

/// Fetch latest event for a Sentry issue
#[tauri::command]
pub async fn fetch_sentry_latest_event(
    base_url: String,
    auth_token: String,
    issue_id: String,
) -> Result<sentry_service::SentryEvent, String> {
    log::info!("Fetching latest event for Sentry issue {}", issue_id);
    sentry_service::fetch_sentry_latest_event(&base_url, &auth_token, &issue_id).await
}
