//! OpenSearch client for knowledge base and log search.
//!
//! Supports both vector (KNN) and lexical (BM25) search, with
//! Reciprocal Rank Fusion for hybrid retrieval.

use hadron_core::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

/// OpenSearch connection config (stored per-team in DB).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSearchConfig {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub index_pattern: String,
    /// Skip TLS certificate verification. Only for development/self-signed certs.
    #[serde(default)]
    pub tls_skip_verify: bool,
}

/// A single search hit from OpenSearch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub index: String,
    pub id: String,
    pub score: Option<f64>,
    pub source: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub total: u64,
    pub hits: Vec<SearchHit>,
    pub took_ms: u64,
}

/// Request payload for OpenSearch proxy endpoint.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SearchRequest {
    pub config_id: Option<i32>,
    pub query: String,
    pub index: Option<String>,
    pub size: Option<u32>,
    pub from: Option<u32>,
}

/// Execute a search against an OpenSearch cluster.
pub async fn search(
    config: &OpenSearchConfig,
    index: &str,
    query: &serde_json::Value,
    size: u32,
    from: u32,
) -> HadronResult<SearchResponse> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(config.tls_skip_verify)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;

    let url = format!("{}/{}/_search", config.url.trim_end_matches('/'), index);

    let body = serde_json::json!({
        "query": query,
        "size": size,
        "from": from,
    });

    let mut req = client.post(&url).json(&body);

    if let (Some(user), Some(pass)) = (&config.username, &config.password) {
        req = req.basic_auth(user, Some(pass));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("OpenSearch request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "OpenSearch returned {status}: {body}"
        )));
    }

    let raw: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| HadronError::external_service(format!("Failed to parse response: {e}")))?;

    let took = raw["took"].as_u64().unwrap_or(0);
    let total = raw["hits"]["total"]["value"].as_u64().unwrap_or(0);
    let hits = raw["hits"]["hits"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|h| SearchHit {
                    index: h["_index"].as_str().unwrap_or("").to_string(),
                    id: h["_id"].as_str().unwrap_or("").to_string(),
                    score: h["_score"].as_f64(),
                    source: h["_source"].clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(SearchResponse {
        total,
        hits,
        took_ms: took,
    })
}

/// Test connectivity to an OpenSearch cluster.
pub async fn test_connection(config: &OpenSearchConfig) -> HadronResult<bool> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(config.tls_skip_verify)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;

    let mut req = client.get(&config.url);

    if let (Some(user), Some(pass)) = (&config.username, &config.password) {
        req = req.basic_auth(user, Some(pass));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("Connection failed: {e}")))?;

    Ok(resp.status().is_success())
}

/// Build a multi-match text query (BM25).
pub fn build_text_query(query: &str) -> serde_json::Value {
    serde_json::json!({
        "multi_match": {
            "query": query,
            "fields": ["text^3", "page_title^5", "content^2"],
            "type": "best_fields",
            "fuzziness": "AUTO"
        }
    })
}
