//! JIRA Integration Service
//!
//! Provides JIRA ticket creation from crash analysis results.
//! Uses Basic Auth with API tokens for Atlassian Cloud.
//!
//! # Security
//! - API tokens are stored in encrypted storage via Tauri Store plugin
//! - Tokens are never logged or exposed to frontend
//! - All API calls use HTTPS

use base64::Engine;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// HTTP client with connection pooling
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build HTTP client - check TLS backend")
});

/// JIRA ticket creation request
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct JiraTicketRequest {
    pub summary: String,
    pub description: String,
    pub priority: String,
    pub labels: Vec<String>,
    pub components: Option<Vec<String>>,
}

/// JIRA ticket creation response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCreateResponse {
    pub success: bool,
    pub ticket_key: Option<String>,
    pub ticket_url: Option<String>,
    pub error: Option<String>,
}

/// JIRA connection test response
#[derive(Debug, Serialize)]
pub struct JiraTestResponse {
    pub success: bool,
    pub message: String,
    pub projects: Option<Vec<JiraProjectInfo>>,
}

/// Basic project info for connection test
#[derive(Debug, Serialize, Clone)]
pub struct JiraProjectInfo {
    pub key: String,
    pub name: String,
}

/// JIRA API error response
#[derive(Debug, Deserialize)]
struct JiraErrorResponse {
    #[serde(rename = "errorMessages")]
    error_messages: Option<Vec<String>>,
    errors: Option<serde_json::Value>,
}

/// JIRA issue creation response
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct JiraIssueResponse {
    id: String,
    key: String,
    #[serde(rename = "self")]
    self_url: String,
}

/// JIRA projects response
#[derive(Debug, Deserialize)]
struct JiraProject {
    key: String,
    name: String,
}

/// Map priority string to JIRA priority ID
fn map_priority_to_id(priority: &str) -> &str {
    match priority.to_lowercase().as_str() {
        "highest" => "1",
        "high" => "2",
        "medium" => "3",
        "low" => "4",
        "lowest" => "5",
        _ => "3", // Default to Medium
    }
}

/// Create Basic Auth header value
fn create_auth_header(email: &str, api_token: &str) -> String {
    let credentials = format!("{}:{}", email, api_token);
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
    format!("Basic {}", encoded)
}

/// Test JIRA connection by fetching projects
pub async fn test_jira_connection(
    base_url: String,
    email: String,
    api_token: String,
) -> Result<JiraTestResponse, String> {
    let base_url = base_url.trim_end_matches('/');
    let auth_header = create_auth_header(&email, &api_token);

    log::info!("Testing JIRA connection to {}", base_url);

    // Try to fetch projects as a connection test
    let response = HTTP_CLIENT
        .get(format!("{}/rest/api/3/project", base_url))
        .header("Authorization", &auth_header)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let status = response.status();

    if status.is_success() {
        let projects: Vec<JiraProject> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let project_infos: Vec<JiraProjectInfo> = projects
            .into_iter()
            .take(10) // Limit to first 10 projects
            .map(|p| JiraProjectInfo {
                key: p.key,
                name: p.name,
            })
            .collect();

        Ok(JiraTestResponse {
            success: true,
            message: format!(
                "Connected successfully. Found {} projects.",
                project_infos.len()
            ),
            projects: Some(project_infos),
        })
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        Ok(JiraTestResponse {
            success: false,
            message: "Authentication failed. Check your email and API token.".to_string(),
            projects: None,
        })
    } else if status == reqwest::StatusCode::FORBIDDEN {
        Ok(JiraTestResponse {
            success: false,
            message: "Access denied. Check your API token permissions.".to_string(),
            projects: None,
        })
    } else {
        let error_text = response.text().await.unwrap_or_default();
        Ok(JiraTestResponse {
            success: false,
            message: format!(
                "Connection failed (HTTP {}): {}",
                status.as_u16(),
                error_text
            ),
            projects: None,
        })
    }
}

/// List all JIRA projects (for project autocomplete)
pub async fn list_jira_projects(
    base_url: String,
    email: String,
    api_token: String,
) -> Result<Vec<JiraProjectInfo>, String> {
    let base_url = base_url.trim_end_matches('/');
    let auth_header = create_auth_header(&email, &api_token);

    log::info!("Listing JIRA projects from {}", base_url);

    let response = HTTP_CLIENT
        .get(format!("{}/rest/api/3/project", base_url))
        .header("Authorization", &auth_header)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let status = response.status();

    if status.is_success() {
        let projects: Vec<JiraProject> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(projects
            .into_iter()
            .map(|p| JiraProjectInfo { key: p.key, name: p.name })
            .collect())
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        Err("Authentication failed. Check your email and API token.".to_string())
    } else if status == reqwest::StatusCode::FORBIDDEN {
        Err("Access denied. Check your API token permissions.".to_string())
    } else {
        let error_text = response.text().await.unwrap_or_default();
        Err(format!(
            "Failed to list projects (HTTP {}): {}",
            status.as_u16(),
            error_text
        ))
    }
}

/// Create a JIRA ticket
pub async fn create_jira_ticket(
    base_url: String,
    email: String,
    api_token: String,
    project_key: String,
    issue_type: String,
    ticket: JiraTicketRequest,
) -> Result<JiraCreateResponse, String> {
    let base_url = base_url.trim_end_matches('/');
    let auth_header = create_auth_header(&email, &api_token);

    log::info!("Creating JIRA ticket in project {}", project_key);

    // Build the issue creation payload
    let payload = serde_json::json!({
        "fields": {
            "project": {
                "key": project_key
            },
            "summary": ticket.summary,
            "description": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": ticket.description
                            }
                        ]
                    }
                ]
            },
            "issuetype": {
                "name": issue_type
            },
            "priority": {
                "id": map_priority_to_id(&ticket.priority)
            },
            "labels": ticket.labels
        }
    });

    let response = HTTP_CLIENT
        .post(format!("{}/rest/api/3/issue", base_url))
        .header("Authorization", &auth_header)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();

    if status.is_success() {
        let issue: JiraIssueResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let ticket_url = format!("{}/browse/{}", base_url, issue.key);

        log::info!("JIRA ticket created: {}", issue.key);

        Ok(JiraCreateResponse {
            success: true,
            ticket_key: Some(issue.key),
            ticket_url: Some(ticket_url),
            error: None,
        })
    } else {
        let error_body = response.text().await.unwrap_or_default();

        // Try to parse JIRA error response
        let error_message =
            if let Ok(jira_error) = serde_json::from_str::<JiraErrorResponse>(&error_body) {
                if let Some(messages) = jira_error.error_messages {
                    messages.join(", ")
                } else if let Some(errors) = jira_error.errors {
                    errors.to_string()
                } else {
                    error_body.clone()
                }
            } else {
                error_body
            };

        log::error!("JIRA ticket creation failed: {}", error_message);

        Ok(JiraCreateResponse {
            success: false,
            ticket_key: None,
            ticket_url: None,
            error: Some(format!("Failed to create ticket: {}", error_message)),
        })
    }
}

// ============================================================================
// JIRA Search/Import Functionality (Phase 3)
// ============================================================================

/// JIRA search response wrapper
/// Note: /rest/api/3/search/jql returns only `issues` (no total/startAt/maxResults).
/// We default the missing fields so downstream consumers stay compatible.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSearchResponse {
    pub issues: Vec<JiraSearchIssue>,
    #[serde(default)]
    pub total: i32,
    #[serde(default)]
    pub start_at: i32,
    #[serde(default)]
    pub max_results: i32,
}

/// JIRA issue from search results (full detail)
#[derive(Debug, Serialize, Deserialize)]
pub struct JiraSearchIssue {
    pub id: String,
    pub key: String,
    #[serde(rename = "self")]
    pub self_url: String,
    pub fields: JiraIssueFields,
}

/// JIRA issue fields
#[derive(Debug, Serialize, Deserialize)]
pub struct JiraIssueFields {
    pub summary: String,
    pub description: Option<serde_json::Value>,
    pub status: JiraStatus,
    pub priority: Option<JiraPriority>,
    pub issuetype: JiraIssueType,
    pub assignee: Option<JiraUser>,
    pub reporter: Option<JiraUser>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub components: Vec<JiraComponent>,
    pub created: String,
    pub updated: String,
    pub resolutiondate: Option<String>,
    pub resolution: Option<JiraResolution>,
    #[serde(default)]
    pub issuelinks: Vec<JiraIssueLink>,
    pub comment: Option<JiraCommentContainer>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraStatus {
    pub name: String,
    #[serde(rename = "statusCategory")]
    pub status_category: Option<JiraStatusCategory>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraStatusCategory {
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraPriority {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraIssueType {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraUser {
    pub display_name: String,
    pub email_address: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraComponent {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraResolution {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraIssueLink {
    #[serde(rename = "type")]
    pub link_type: JiraLinkType,
    #[serde(rename = "inwardIssue")]
    pub inward_issue: Option<JiraLinkedIssue>,
    #[serde(rename = "outwardIssue")]
    pub outward_issue: Option<JiraLinkedIssue>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraLinkType {
    pub name: String,
    pub inward: String,
    pub outward: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraLinkedIssue {
    pub key: String,
    pub fields: Option<JiraLinkedIssueFields>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraLinkedIssueFields {
    pub summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraCommentContainer {
    pub comments: Vec<JiraComment>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraComment {
    pub id: String,
    pub author: JiraCommentAuthor,
    pub body: serde_json::Value,
    pub created: String,
    pub updated: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCommentAuthor {
    pub display_name: String,
}

/// Search JIRA issues using JQL
pub async fn search_jira_issues(
    base_url: String,
    email: String,
    api_token: String,
    jql: String,
    max_results: i32,
    include_comments: bool,
) -> Result<JiraSearchResponse, String> {
    let base_url = base_url.trim_end_matches('/');
    let auth_header = create_auth_header(&email, &api_token);

    log::info!("Searching JIRA issues with JQL: {}", jql);

    // Build fields to expand
    let mut fields = vec![
        "summary", "description", "status", "priority", "issuetype",
        "assignee", "reporter", "labels", "components", "created",
        "updated", "resolutiondate", "resolution", "issuelinks",
    ];

    if include_comments {
        fields.push("comment");
    }

    // Build POST body for /rest/api/3/search/jql (replaces removed GET /rest/api/3/search)
    let url = format!("{}/rest/api/3/search/jql", base_url);

    let body = serde_json::json!({
        "jql": jql,
        "maxResults": max_results,
        "fields": fields,
    });

    let response = HTTP_CLIENT
        .post(&url)
        .header("Authorization", &auth_header)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    let status = response.status();

    if status.is_success() {
        let mut search_result: JiraSearchResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse search response: {}", e))?;

        // The /rest/api/3/search/jql endpoint doesn't return total — backfill it
        if search_result.total == 0 && !search_result.issues.is_empty() {
            search_result.total = search_result.issues.len() as i32;
        }

        log::info!(
            "JIRA search returned {} issues",
            search_result.issues.len()
        );

        Ok(search_result)
    } else if status == reqwest::StatusCode::BAD_REQUEST {
        let error_body = response.text().await.unwrap_or_default();
        Err(format!("Invalid JQL query: {}", error_body))
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        Err("Authentication failed. Check your credentials.".to_string())
    } else {
        let error_body = response.text().await.unwrap_or_default();
        Err(format!("Search failed (HTTP {}): {}", status.as_u16(), error_body))
    }
}
