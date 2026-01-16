//! JIRA Integration Service
//!
//! Provides JIRA ticket creation from crash analysis results.
//! Uses Basic Auth with API tokens for Atlassian Cloud.
//!
//! # Security
//! - API tokens are stored in encrypted storage via Tauri Store plugin
//! - Tokens are never logged or exposed to frontend
//! - All API calls use HTTPS

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use once_cell::sync::Lazy;
use base64::Engine;

/// HTTP client with connection pooling
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| Client::new())
});

/// Cached JIRA configuration
static JIRA_CONFIG_CACHE: Lazy<Mutex<Option<JiraConfigCache>>> = Lazy::new(|| Mutex::new(None));

#[derive(Clone)]
struct JiraConfigCache {
    base_url: String,
    email: String,
    api_token: String,
    project_key: String,
    issue_type: String,
}

/// JIRA ticket creation request
#[derive(Debug, Deserialize)]
pub struct JiraTicketRequest {
    pub summary: String,
    pub description: String,
    pub priority: String,
    pub labels: Vec<String>,
    pub components: Option<Vec<String>>,
}

/// JIRA ticket creation response
#[derive(Debug, Serialize)]
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

/// Load JIRA configuration from Tauri Store
/// This should be called from the frontend to populate the cache
pub async fn load_jira_config(
    base_url: String,
    email: String,
    api_token: String,
    project_key: String,
    issue_type: String,
) -> Result<(), String> {
    let config = JiraConfigCache {
        base_url: base_url.trim_end_matches('/').to_string(),
        email,
        api_token,
        project_key,
        issue_type,
    };

    let mut cache = JIRA_CONFIG_CACHE.lock().map_err(|e| format!("Lock error: {}", e))?;
    *cache = Some(config);

    log::info!("JIRA configuration loaded");
    Ok(())
}

/// Clear cached JIRA configuration
pub fn clear_jira_config() {
    if let Ok(mut cache) = JIRA_CONFIG_CACHE.lock() {
        *cache = None;
        log::info!("JIRA configuration cleared");
    }
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
            message: format!("Connected successfully. Found {} projects.", project_infos.len()),
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
            message: format!("Connection failed (HTTP {}): {}", status.as_u16(), error_text),
            projects: None,
        })
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
        let error_message = if let Ok(jira_error) = serde_json::from_str::<JiraErrorResponse>(&error_body) {
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
