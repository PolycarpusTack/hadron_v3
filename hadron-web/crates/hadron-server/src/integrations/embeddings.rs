//! Embedding generation via OpenAI text-embedding-3-small.
//!
//! Generates 1536-dimensional embeddings for pgvector similarity search.

use hadron_core::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

const EMBEDDING_MODEL: &str = "text-embedding-3-small";
const EMBEDDING_URL: &str = "https://api.openai.com/v1/embeddings";

/// Generate an embedding vector for the given text.
pub async fn generate_embedding(text: &str, api_key: &str) -> HadronResult<Vec<f32>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HadronError::external_service(format!("HTTP client error: {e}")))?;

    let body = EmbeddingRequest {
        input: text.to_string(),
        model: EMBEDDING_MODEL.to_string(),
    };

    let resp = client
        .post(EMBEDDING_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("Embedding request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status.as_u16() == 429 {
            return Err(HadronError::RateLimited);
        }
        return Err(HadronError::external_service(format!(
            "Embedding API error {status}: {text}"
        )));
    }

    let data: EmbeddingResponse = resp
        .json()
        .await
        .map_err(|e| HadronError::external_service(format!("Embedding parse error: {e}")))?;

    data.data
        .into_iter()
        .next()
        .map(|e| e.embedding)
        .ok_or_else(|| HadronError::external_service("Empty embedding response"))
}

/// Generate an embedding with exponential-backoff retry.
///
/// Retries on any error (including rate-limits). Delays: 1 s, 2 s, 4 s, …
/// `max_retries` is the total number of attempts (not additional retries).
pub async fn generate_embedding_with_retry(
    text: &str,
    api_key: &str,
    max_retries: usize,
) -> HadronResult<Vec<f32>> {
    let mut last_err = String::new();
    for attempt in 0..max_retries {
        match generate_embedding(text, api_key).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = e.to_string();
                if attempt < max_retries - 1 {
                    let delay = std::time::Duration::from_secs(1u64 << attempt); // 1s, 2s, 4s…
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }
    Err(HadronError::external_service(format!(
        "Embedding failed after {max_retries} attempt(s): {last_err}"
    )))
}

/// Generate embeddings for a batch of texts, collecting all results.
///
/// Uses `generate_embedding_with_retry` for each item. Returns results in
/// input order; the first error encountered aborts the batch.
pub async fn generate_embeddings_batch(
    texts: &[&str],
    api_key: &str,
    max_retries: usize,
) -> HadronResult<Vec<Vec<f32>>> {
    let mut results = Vec::with_capacity(texts.len());
    for text in texts {
        let embedding = generate_embedding_with_retry(text, api_key, max_retries).await?;
        results.push(embedding);
    }
    Ok(results)
}

#[derive(Serialize)]
struct EmbeddingRequest {
    input: String,
    model: String,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}
