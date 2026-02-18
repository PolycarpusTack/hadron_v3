//! Native OpenSearch Client + OpenAI Embedding Call
//!
//! Wraps `reqwest::Client` for HTTP calls to OpenSearch and OpenAI embeddings API.
//! Replaces the Python subprocess for remote KB search.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::rag_commands::OpenSearchConfig;

// ============================================================================
// OpenSearch Client
// ============================================================================

pub struct OpenSearchClient {
    client: Client,
    base_url: String,
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
pub struct OpenSearchResponse {
    pub hits: OpenSearchHits,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct OpenSearchHits {
    pub total: OpenSearchTotal,
    pub hits: Vec<OpenSearchHit>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct OpenSearchTotal {
    pub value: u64,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct OpenSearchHit {
    #[serde(rename = "_index")]
    pub index: String,
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "_score")]
    pub score: Option<f64>,
    #[serde(rename = "_source")]
    pub source: serde_json::Value,
}

impl OpenSearchClient {
    pub fn new(config: &OpenSearchConfig) -> Self {
        let scheme = if config.use_ssl { "https" } else { "http" };
        let base_url = format!("{}://{}:{}", scheme, config.host, config.port);

        let client = Client::builder()
            .danger_accept_invalid_certs(true) // Allow self-signed certs
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            client,
            base_url,
            username: config.username.clone(),
            password: config.password.clone(),
        }
    }

    /// Check if an index exists. Returns true if HEAD returns 200.
    pub async fn index_exists(&self, index: &str) -> bool {
        let url = format!("{}/{}", self.base_url, index);
        match self
            .client
            .head(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
        {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// Execute a search query against an index.
    pub async fn search(
        &self,
        index: &str,
        body: &serde_json::Value,
    ) -> Result<OpenSearchResponse, String> {
        let url = format!("{}/{}/_search", self.base_url, index);
        let resp = self
            .client
            .post(&url)
            .basic_auth(&self.username, Some(&self.password))
            .json(body)
            .send()
            .await
            .map_err(|e| format!("OpenSearch request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("OpenSearch returned {}: {}", status, text));
        }

        resp.json::<OpenSearchResponse>()
            .await
            .map_err(|e| format!("Failed to parse OpenSearch response: {}", e))
    }
}

// ============================================================================
// OpenAI Embeddings
// ============================================================================

/// Default embedding model matching the KB indexer
pub const KB_EMBEDDING_MODEL: &str = "text-embedding-3-large";
/// Dimension count for text-embedding-3-large
pub const KB_EMBEDDING_DIMENSIONS: u32 = 3072;

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: String,
    dimensions: u32,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f64>,
}

/// Generate an embedding vector for a single text using the OpenAI embeddings API.
/// If a cache is provided, checks it first and stores the result after a successful API call.
pub async fn get_embedding(
    text: &str,
    api_key: &str,
    model: &str,
    dimensions: u32,
) -> Result<Vec<f64>, String> {
    get_embedding_cached(text, api_key, model, dimensions, None).await
}

/// Generate an embedding vector with optional cache support.
pub async fn get_embedding_cached(
    text: &str,
    api_key: &str,
    model: &str,
    dimensions: u32,
    cache: Option<&super::cache::EmbeddingCache>,
) -> Result<Vec<f64>, String> {
    // Check cache first
    if let Some(cache) = cache {
        if let Some(embedding) = cache.get(text) {
            log::debug!("Embedding cache hit for query: {}...", &text[..text.len().min(50)]);
            return Ok(embedding);
        }
    }

    let client = Client::new();
    let body = EmbeddingRequest {
        model: model.to_string(),
        input: text.to_string(),
        dimensions,
    };

    let resp = client
        .post("https://api.openai.com/v1/embeddings")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Embedding API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Embedding API returned {}: {}", status, text));
    }

    let parsed: EmbeddingResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse embedding response: {}", e))?;

    let embedding = parsed
        .data
        .into_iter()
        .next()
        .map(|d| d.embedding)
        .ok_or_else(|| "No embedding data returned".to_string())?;

    // Store in cache
    if let Some(cache) = cache {
        cache.put(text.to_string(), embedding.clone());
    }

    Ok(embedding)
}

// ============================================================================
// OpenSearch Query Builders
// ============================================================================

/// Build a KNN (vector) query body for OpenSearch.
///
/// When `version_range` is provided, adds a `won_version_for_sorting` range
/// filter matching the reference chatbot's query pattern.
pub fn build_knn_query(vector: &[f64], k: usize) -> serde_json::Value {
    build_knn_query_filtered(vector, k, None, None)
}

/// Build a KNN query with optional WON version range filtering.
///
/// Matches the reference chatbot's query pattern:
/// ```json
/// { "knn": { "embedding": { "vector": [...], "k": 8,
///     "filter": { "bool": { "must": { "range": {
///         "won_version_for_sorting": { "gte": "...", "lte": "..." }
/// }}}} }}}
/// ```
pub fn build_knn_query_filtered(
    vector: &[f64],
    k: usize,
    version_min: Option<&str>,
    version_max: Option<&str>,
) -> serde_json::Value {
    let mut knn_body = json!({
        "vector": vector,
        "k": k
    });

    // Add version range filter if specified
    if version_min.is_some() || version_max.is_some() {
        let mut range = json!({});
        if let Some(min) = version_min {
            range["gte"] = json!(min);
        }
        if let Some(max) = version_max {
            range["lte"] = json!(max);
        }
        knn_body["filter"] = json!({
            "bool": {
                "must": {
                    "range": {
                        "won_version_for_sorting": range
                    }
                }
            }
        });
    }

    json!({
        "size": k,
        "query": {
            "knn": {
                "embedding": knn_body
            }
        }
    })
}

/// Build a text match query for lexical/BM25 search.
pub fn build_text_query(query: &str, k: usize) -> serde_json::Value {
    json!({
        "size": k,
        "query": {
            "multi_match": {
                "query": query,
                "fields": ["text^3", "page_title^5", "content^2"],
                "fuzziness": "AUTO",
                "type": "best_fields"
            }
        }
    })
}
