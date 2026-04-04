//! Confluence Cloud REST API client.
//!
//! Supports publishing pages (create or update) to a Confluence space.

use hadron_core::error::{HadronError, HadronResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Result from a publish operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluencePageResult {
    pub id: String,
    pub url: String,
    pub created: bool,
}

/// Search response wrapper from Confluence content API.
#[derive(Debug, Deserialize)]
struct SearchResponse {
    results: Vec<ContentSummary>,
}

#[derive(Debug, Deserialize)]
struct ContentSummary {
    id: String,
    version: Option<VersionInfo>,
}

#[derive(Debug, Deserialize)]
struct VersionInfo {
    number: u32,
}

/// Response from create/update content endpoints.
#[derive(Debug, Deserialize)]
struct ContentResponse {
    id: String,
}

/// Publish a page to Confluence. Creates a new page or updates an existing one
/// if a page with the same title already exists in the given space.
pub async fn publish_page(
    base_url: &str,
    email: &str,
    api_token: &str,
    space_key: &str,
    parent_page_id: &str,
    title: &str,
    confluence_markup: &str,
) -> HadronResult<ConfluencePageResult> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::Http(format!("Failed to build HTTP client: {e}")))?;

    let wiki_base = format!("{}/wiki", base_url.trim_end_matches('/'));

    // Search for an existing page with the same title in this space.
    let search_resp = client
        .get(&format!("{}/rest/api/content", wiki_base))
        .basic_auth(email, Some(api_token))
        .query(&[("spaceKey", space_key), ("title", title), ("type", "page")])
        .send()
        .await
        .map_err(|e| HadronError::Http(format!("Confluence search failed: {e}")))?;

    if !search_resp.status().is_success() {
        let status = search_resp.status();
        let body = search_resp.text().await.unwrap_or_default();
        return Err(HadronError::Http(format!(
            "Confluence search returned {status}: {body}"
        )));
    }

    let search_data: SearchResponse = search_resp
        .json()
        .await
        .map_err(|e| HadronError::Http(format!("Failed to parse Confluence search response: {e}")))?;

    if let Some(existing) = search_data.results.into_iter().next() {
        // Update the existing page.
        let current_version = existing.version.map(|v| v.number).unwrap_or(1);
        let update_body = serde_json::json!({
            "version": { "number": current_version + 1 },
            "title": title,
            "type": "page",
            "body": {
                "wiki": {
                    "value": confluence_markup,
                    "representation": "wiki"
                }
            }
        });

        let update_resp = client
            .put(&format!("{}/rest/api/content/{}", wiki_base, existing.id))
            .basic_auth(email, Some(api_token))
            .json(&update_body)
            .send()
            .await
            .map_err(|e| HadronError::Http(format!("Confluence update failed: {e}")))?;

        if !update_resp.status().is_success() {
            let status = update_resp.status();
            let body = update_resp.text().await.unwrap_or_default();
            return Err(HadronError::Http(format!(
                "Confluence update returned {status}: {body}"
            )));
        }

        let content: ContentResponse = update_resp
            .json()
            .await
            .map_err(|e| HadronError::Http(format!("Failed to parse Confluence update response: {e}")))?;

        let url = format!("{}/spaces/{}/pages/{}", wiki_base, space_key, content.id);
        Ok(ConfluencePageResult {
            id: content.id,
            url,
            created: false,
        })
    } else {
        // Create a new page.
        let mut create_body = serde_json::json!({
            "type": "page",
            "title": title,
            "space": { "key": space_key },
            "body": {
                "wiki": {
                    "value": confluence_markup,
                    "representation": "wiki"
                }
            }
        });

        if !parent_page_id.is_empty() {
            create_body["ancestors"] = serde_json::json!([{ "id": parent_page_id }]);
        }

        let create_resp = client
            .post(&format!("{}/rest/api/content", wiki_base))
            .basic_auth(email, Some(api_token))
            .json(&create_body)
            .send()
            .await
            .map_err(|e| HadronError::Http(format!("Confluence create failed: {e}")))?;

        if !create_resp.status().is_success() {
            let status = create_resp.status();
            let body = create_resp.text().await.unwrap_or_default();
            return Err(HadronError::Http(format!(
                "Confluence create returned {status}: {body}"
            )));
        }

        let content: ContentResponse = create_resp
            .json()
            .await
            .map_err(|e| HadronError::Http(format!("Failed to parse Confluence create response: {e}")))?;

        let url = format!("{}/spaces/{}/pages/{}", wiki_base, space_key, content.id);
        Ok(ConfluencePageResult {
            id: content.id,
            url,
            created: true,
        })
    }
}
