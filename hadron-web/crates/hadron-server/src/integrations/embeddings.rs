//! Embedding generation via OpenAI text-embedding-3-small.
//!
//! Generates 1536-dimensional embeddings for pgvector similarity search.

use hadron_core::error::{HadronError, HadronResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};

const EMBEDDING_MODEL: &str = "text-embedding-3-small";
const EMBEDDING_URL: &str = "https://api.openai.com/v1/embeddings";

/// Generate an embedding vector for the given text.
pub async fn generate_embedding(text: &str, api_key: &str) -> HadronResult<Vec<f32>> {
    let client = Client::new();

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
