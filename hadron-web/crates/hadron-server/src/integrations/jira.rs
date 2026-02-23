//! Jira Cloud REST API client.
//!
//! Supports ticket creation, search (JQL), and commenting.

use hadron_core::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

/// Jira connection config (stored per-team in DB).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
    pub project_key: String,
}

/// Request to create a Jira issue.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CreateTicketRequest {
    pub config_id: Option<i32>,
    pub summary: String,
    pub description: String,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
    pub issue_type: Option<String>,
    pub analysis_id: Option<i64>,
}

/// Response after creating a Jira issue.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTicketResponse {
    pub key: String,
    pub url: String,
    pub id: String,
}

/// Jira issue summary from search results.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub priority: Option<String>,
    pub issue_type: String,
    pub assignee: Option<String>,
    pub created: String,
    pub updated: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSearchResponse {
    pub issues: Vec<JiraIssue>,
    pub total: u64,
}

/// Search request payload.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SearchRequest {
    pub config_id: Option<i32>,
    pub jql: Option<String>,
    pub text: Option<String>,
    pub max_results: Option<u32>,
}

/// Create a Jira issue via REST API v3.
pub async fn create_ticket(
    config: &JiraConfig,
    req: &CreateTicketRequest,
) -> HadronResult<CreateTicketResponse> {
    let client = build_client()?;

    let issue_type = req.issue_type.as_deref().unwrap_or("Bug");
    let priority = req.priority.as_deref().unwrap_or("Medium");

    let mut fields = serde_json::json!({
        "project": { "key": &config.project_key },
        "summary": &req.summary,
        "description": {
            "type": "doc",
            "version": 1,
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": &req.description }]
            }]
        },
        "issuetype": { "name": issue_type },
        "priority": { "name": capitalize(priority) },
    });

    if let Some(labels) = &req.labels {
        fields["labels"] = serde_json::json!(labels);
    }

    let url = format!("{}/rest/api/3/issue", config.base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .json(&serde_json::json!({ "fields": fields }))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("Jira request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "Jira returned {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| HadronError::external_service(format!("Failed to parse response: {e}")))?;

    let key = data["key"].as_str().unwrap_or("").to_string();
    let id = data["id"].as_str().unwrap_or("").to_string();
    let browse_url = format!(
        "{}/browse/{}",
        config.base_url.trim_end_matches('/'),
        key
    );

    Ok(CreateTicketResponse {
        key,
        url: browse_url,
        id,
    })
}

/// Search Jira issues via JQL or text query.
pub async fn search_issues(
    config: &JiraConfig,
    jql: Option<&str>,
    text: Option<&str>,
    max_results: u32,
) -> HadronResult<JiraSearchResponse> {
    let client = build_client()?;

    // Sanitize project key — must be alphanumeric + dash/underscore only
    let sanitized_key: String = config
        .project_key
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    let jql_query = if let Some(jql) = jql {
        jql.to_string()
    } else if let Some(text) = text {
        // Escape JQL special characters in text search
        let escaped_text = text
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\'', "\\\\'");
        format!(
            "project = \"{}\" AND text ~ \"{}\" ORDER BY updated DESC",
            sanitized_key, escaped_text
        )
    } else {
        format!(
            "project = \"{}\" ORDER BY updated DESC",
            sanitized_key
        )
    };

    let url = format!(
        "{}/rest/api/3/search/jql",
        config.base_url.trim_end_matches('/')
    );

    let resp = client
        .post(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .json(&serde_json::json!({
            "jql": jql_query,
            "maxResults": max_results,
            "fields": ["summary", "status", "priority", "issuetype", "assignee", "created", "updated"]
        }))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("Jira search failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "Jira returned {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| HadronError::external_service(format!("Failed to parse response: {e}")))?;

    let total = data["total"].as_u64().unwrap_or(0);
    let issues = data["issues"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|issue| {
                    let fields = &issue["fields"];
                    let key = issue["key"].as_str().unwrap_or("").to_string();
                    JiraIssue {
                        url: format!(
                            "{}/browse/{}",
                            config.base_url.trim_end_matches('/'),
                            key
                        ),
                        key,
                        summary: fields["summary"].as_str().unwrap_or("").to_string(),
                        status: fields["status"]["name"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        priority: fields["priority"]["name"].as_str().map(|s| s.to_string()),
                        issue_type: fields["issuetype"]["name"]
                            .as_str()
                            .unwrap_or("Bug")
                            .to_string(),
                        assignee: fields["assignee"]["displayName"]
                            .as_str()
                            .map(|s| s.to_string()),
                        created: fields["created"].as_str().unwrap_or("").to_string(),
                        updated: fields["updated"].as_str().unwrap_or("").to_string(),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(JiraSearchResponse { issues, total })
}

/// Test connectivity to a Jira instance.
pub async fn test_connection(config: &JiraConfig) -> HadronResult<bool> {
    let client = build_client()?;

    let url = format!(
        "{}/rest/api/3/myself",
        config.base_url.trim_end_matches('/')
    );

    let resp = client
        .get(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("Connection failed: {e}")))?;

    Ok(resp.status().is_success())
}

fn build_client() -> HadronResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
        None => String::new(),
    }
}
