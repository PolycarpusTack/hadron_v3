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

/// Jira fix version (release version) metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraFixVersion {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub released: bool,
    pub release_date: Option<String>,
}

/// List all fix versions for a Jira project.
pub async fn list_fix_versions(
    config: &JiraConfig,
    project_key: &str,
) -> HadronResult<Vec<JiraFixVersion>> {
    let client = build_client()?;

    let url = format!(
        "{}/rest/api/3/project/{}/versions",
        config.base_url.trim_end_matches('/'),
        project_key
    );

    let resp = client
        .get(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("JIRA versions request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "JIRA returned {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| HadronError::external_service(format!("Failed to parse JIRA versions response: {e}")))?;

    let versions = data
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|v| JiraFixVersion {
                    id: v["id"].as_str().unwrap_or("").to_string(),
                    name: v["name"].as_str().unwrap_or("").to_string(),
                    released: v["released"].as_bool().unwrap_or(false),
                    release_date: v["releaseDate"].as_str().map(|s| s.to_string()),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(versions)
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

/// Fetch full issue detail including description and comments.
pub async fn fetch_issue_detail(
    config: &JiraConfig,
    key: &str,
) -> HadronResult<hadron_core::ai::jira_analysis::JiraTicketDetail> {
    let client = build_client()?;

    // Validate key format (PROJ-123)
    if !key.chars().all(|c| c.is_alphanumeric() || c == '-') {
        return Err(HadronError::Validation(format!("Invalid JIRA key: {key}")));
    }

    let url = format!(
        "{}/rest/api/3/issue/{}?fields=summary,description,status,priority,issuetype,components,labels,comment",
        config.base_url.trim_end_matches('/'),
        key
    );

    let resp = client
        .get(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("JIRA fetch failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "JIRA returned {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| HadronError::external_service(format!("Failed to parse JIRA response: {e}")))?;

    let fields = &data["fields"];

    let description = extract_adf_text(&fields["description"]);

    let comments: Vec<String> = fields["comment"]["comments"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|c| extract_adf_text(&c["body"]))
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let components: Vec<String> = fields["components"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c["name"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let labels: Vec<String> = fields["labels"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|l| l.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let browse_url = format!(
        "{}/browse/{}",
        config.base_url.trim_end_matches('/'),
        key
    );

    Ok(hadron_core::ai::jira_analysis::JiraTicketDetail {
        key: key.to_string(),
        summary: fields["summary"].as_str().unwrap_or("").to_string(),
        description,
        issue_type: fields["issuetype"]["name"].as_str().unwrap_or("Bug").to_string(),
        priority: fields["priority"]["name"].as_str().map(|s| s.to_string()),
        status: fields["status"]["name"].as_str().unwrap_or("").to_string(),
        components,
        labels,
        comments,
        url: browse_url,
    })
}

/// Extract plain text from JIRA's Atlassian Document Format (ADF).
///
/// ADF is a nested JSON structure. This does a simple recursive text extraction.
/// Falls back to treating the value as a plain string if it's not ADF.
fn extract_adf_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(obj) => {
            // ADF document: { "type": "doc", "content": [...] }
            if let Some(content) = obj.get("content") {
                extract_adf_content(content)
            } else if let Some(text) = obj.get("text") {
                text.as_str().unwrap_or("").to_string()
            } else {
                String::new()
            }
        }
        serde_json::Value::Null => String::new(),
        _ => value.to_string(),
    }
}

/// Post a comment to a JIRA issue.
pub async fn post_jira_comment(
    config: &JiraConfig,
    key: &str,
    body: &str,
) -> HadronResult<()> {
    let client = build_client()?;

    // Validate key
    if !key.chars().all(|c| c.is_alphanumeric() || c == '-') {
        return Err(HadronError::Validation(format!("Invalid JIRA key: {key}")));
    }

    // Use API v2 for comment posting (v3 uses ADF which is more complex)
    let url = format!(
        "{}/rest/api/2/issue/{}/comment",
        config.base_url.trim_end_matches('/'),
        key
    );

    let resp = client
        .post(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .json(&serde_json::json!({ "body": body }))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("JIRA comment failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "JIRA comment returned {status}: {text}"
        )));
    }

    Ok(())
}

/// Format a JiraBriefResult as JIRA wiki markup for posting as a comment.
pub fn format_brief_as_jira_markup(
    brief: &hadron_core::ai::JiraBriefResult,
    jira_key: &str,
) -> String {
    let triage = &brief.triage;
    let analysis = &brief.analysis;

    let mut lines = vec![
        format!("h3. Hadron Investigation Brief — {jira_key}"),
        String::new(),
        format!(
            "*Severity:* {} | *Category:* {} | *Confidence:* {}",
            triage.severity, triage.category, triage.confidence
        ),
    ];

    // Summary
    if !analysis.plain_summary.is_empty() {
        lines.push(String::new());
        lines.push("h4. Summary".to_string());
        lines.push(analysis.plain_summary.clone());
    }

    // Root Cause
    if !analysis.technical.root_cause.is_empty() {
        lines.push(String::new());
        lines.push("h4. Root Cause".to_string());
        lines.push(analysis.technical.root_cause.clone());
    }

    // Recommended Actions
    if !analysis.recommended_actions.is_empty() {
        lines.push(String::new());
        lines.push("h4. Recommended Actions".to_string());
        for action in &analysis.recommended_actions {
            lines.push(format!(
                "* *[{}]* {} — _{}_",
                action.priority, action.action, action.rationale
            ));
        }
    }

    // Risk
    lines.push(String::new());
    lines.push(format!(
        "*Risk:* {} blast radius, {} urgency. {}",
        analysis.risk.blast_radius,
        analysis.risk.urgency,
        analysis.risk.do_nothing_risk
    ));

    // Footer
    lines.push(String::new());
    lines.push("----".to_string());
    lines.push("_Generated by Hadron JIRA Assist_".to_string());

    lines.join("\n")
}

/// Search JIRA issues for release notes generation, returning typed `ReleaseNoteTicket` values.
///
/// Requests extra fields (description, components, labels) and paginates up to 500 tickets.
pub async fn search_issues_for_release_notes(
    config: &JiraConfig,
    jql: &str,
) -> HadronResult<Vec<hadron_core::ai::ReleaseNoteTicket>> {
    let client = build_client()?;
    let max_per_page: u32 = 50;
    let cap: u32 = 500;
    let mut start_at: u32 = 0;
    let mut all_tickets: Vec<hadron_core::ai::ReleaseNoteTicket> = Vec::new();

    let url = format!(
        "{}/rest/api/3/search/jql",
        config.base_url.trim_end_matches('/')
    );

    loop {
        let resp = client
            .post(&url)
            .basic_auth(&config.email, Some(&config.api_token))
            .json(&serde_json::json!({
                "jql": jql,
                "startAt": start_at,
                "maxResults": max_per_page,
                "fields": [
                    "summary",
                    "status",
                    "priority",
                    "issuetype",
                    "description",
                    "components",
                    "labels"
                ]
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

        let total = data["total"].as_u64().unwrap_or(0) as u32;
        let issues = data["issues"].as_array().cloned().unwrap_or_default();

        if issues.is_empty() {
            break;
        }

        for issue in &issues {
            let fields = &issue["fields"];
            let key = issue["key"].as_str().unwrap_or("").to_string();

            let description = {
                let raw = &fields["description"];
                if raw.is_null() {
                    None
                } else {
                    let text = extract_adf_text(raw);
                    if text.is_empty() { None } else { Some(text) }
                }
            };

            let components: Vec<String> = fields["components"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|c| c["name"].as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let labels: Vec<String> = fields["labels"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|l| l.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            all_tickets.push(hadron_core::ai::ReleaseNoteTicket {
                key,
                summary: fields["summary"].as_str().unwrap_or("").to_string(),
                description,
                issue_type: fields["issuetype"]["name"]
                    .as_str()
                    .unwrap_or("Bug")
                    .to_string(),
                priority: fields["priority"]["name"]
                    .as_str()
                    .unwrap_or("Medium")
                    .to_string(),
                status: fields["status"]["name"].as_str().unwrap_or("").to_string(),
                components,
                labels,
                ..Default::default()
            });
        }

        start_at += issues.len() as u32;

        if start_at >= total || start_at >= cap {
            break;
        }
    }

    Ok(all_tickets)
}

fn extract_adf_content(content: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(arr) = content.as_array() {
        for node in arr {
            let node_type = node["type"].as_str().unwrap_or("");
            match node_type {
                "text" => {
                    if let Some(text) = node["text"].as_str() {
                        parts.push(text.to_string());
                    }
                }
                "hardBreak" => parts.push("\n".to_string()),
                "paragraph" | "heading" | "blockquote" | "listItem" | "tableCell" => {
                    if let Some(inner) = node.get("content") {
                        let text = extract_adf_content(inner);
                        if !text.is_empty() {
                            parts.push(text);
                        }
                    }
                    if node_type == "paragraph" || node_type == "heading" {
                        parts.push("\n".to_string());
                    }
                }
                "bulletList" | "orderedList" | "table" | "tableRow" => {
                    if let Some(inner) = node.get("content") {
                        let text = extract_adf_content(inner);
                        if !text.is_empty() {
                            parts.push(text);
                        }
                    }
                }
                "codeBlock" => {
                    if let Some(inner) = node.get("content") {
                        let text = extract_adf_content(inner);
                        if !text.is_empty() {
                            parts.push(format!("\n```\n{}\n```\n", text));
                        }
                    }
                }
                _ => {
                    // Unknown node type — try extracting content recursively
                    if let Some(inner) = node.get("content") {
                        let text = extract_adf_content(inner);
                        if !text.is_empty() {
                            parts.push(text);
                        }
                    }
                }
            }
        }
    }
    parts.join("")
}
