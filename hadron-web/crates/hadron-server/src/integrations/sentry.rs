//! Sentry integration — fetch projects, issues, and events.

use hadron_core::error::{HadronError, HadronResult};
use hadron_core::models::{SentryConfig, SentryIssue, SentryProject};
pub async fn test_connection(config: &SentryConfig) -> HadronResult<bool> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;
    let url = format!(
        "{}/api/0/organizations/{}/",
        config.base_url.trim_end_matches('/'),
        config.organization
    );

    let resp = client
        .get(&url)
        .bearer_auth(&config.auth_token)
        .send()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    Ok(resp.status().is_success())
}

pub async fn list_projects(config: &SentryConfig) -> HadronResult<Vec<SentryProject>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;
    let url = format!(
        "{}/api/0/organizations/{}/projects/",
        config.base_url.trim_end_matches('/'),
        config.organization
    );

    let resp = client
        .get(&url)
        .bearer_auth(&config.auth_token)
        .send()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::Http(format!(
            "Sentry API error {status}: {body}"
        )));
    }

    let projects: Vec<SentryProject> = resp
        .json()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    Ok(projects)
}

pub async fn list_issues(
    config: &SentryConfig,
    project_slug: &str,
    limit: usize,
) -> HadronResult<Vec<SentryIssue>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;
    let url = format!(
        "{}/api/0/projects/{}/{}/issues/?limit={}",
        config.base_url.trim_end_matches('/'),
        config.organization,
        project_slug,
        limit
    );

    let resp = client
        .get(&url)
        .bearer_auth(&config.auth_token)
        .send()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::Http(format!(
            "Sentry API error {status}: {body}"
        )));
    }

    let issues: Vec<SentryIssue> = resp
        .json()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    Ok(issues)
}

pub async fn fetch_issue(config: &SentryConfig, issue_id: &str) -> HadronResult<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;
    let url = format!(
        "{}/api/0/issues/{}/",
        config.base_url.trim_end_matches('/'),
        issue_id
    );

    let resp = client
        .get(&url)
        .bearer_auth(&config.auth_token)
        .send()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::Http(format!(
            "Sentry API error {status}: {body}"
        )));
    }

    let issue: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    Ok(issue)
}

pub async fn fetch_latest_event(
    config: &SentryConfig,
    issue_id: &str,
) -> HadronResult<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;
    let url = format!(
        "{}/api/0/issues/{}/events/latest/",
        config.base_url.trim_end_matches('/'),
        issue_id
    );

    let resp = client
        .get(&url)
        .bearer_auth(&config.auth_token)
        .send()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::Http(format!(
            "Sentry API error {status}: {body}"
        )));
    }

    let event: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| HadronError::Http(e.to_string()))?;

    Ok(event)
}
