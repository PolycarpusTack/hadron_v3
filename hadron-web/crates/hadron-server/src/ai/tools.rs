//! Chat tool definitions and execution.
//!
//! Provides tools the AI can call during chat: search_analyses, get_analysis_detail,
//! search_knowledge_base, search_similar_analyses.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::db;

/// A tool the AI can call.
#[derive(Debug, Clone, Serialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Result of executing a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_name: String,
    pub content: String,
}

/// Get the list of tools available during chat.
pub fn chat_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "search_analyses".to_string(),
            description: "Search the user's crash analyses by text query. Returns matching analysis summaries.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query text"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results to return (default 5)"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "get_analysis_detail".to_string(),
            description: "Get the full details of a specific analysis by ID.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "analysis_id": {
                        "type": "integer",
                        "description": "The analysis ID to retrieve"
                    }
                },
                "required": ["analysis_id"]
            }),
        },
        ToolDefinition {
            name: "search_knowledge_base".to_string(),
            description: "Search the knowledge base using hybrid semantic + keyword search. Uses pgvector similarity when embeddings are available, with OpenSearch KNN if configured. Falls back to text search. Useful for finding similar crashes, known issues, and past analyses.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Semantic search query describing the issue"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 5)"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "search_similar_analyses".to_string(),
            description: "Find analyses that are semantically similar to a given analysis ID. Useful for identifying recurring issues or duplicate crashes.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "analysis_id": {
                        "type": "integer",
                        "description": "The analysis ID to find similar analyses for"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max similar analyses to return (default 5)"
                    },
                    "threshold": {
                        "type": "number",
                        "description": "Minimum similarity score 0-1 (default 0.5)"
                    }
                },
                "required": ["analysis_id"]
            }),
        },
    ]
}

/// Execute a tool call and return the result as a string.
pub async fn execute_tool(
    pool: &PgPool,
    user_id: Uuid,
    tool_name: &str,
    args: &serde_json::Value,
) -> Result<String, String> {
    match tool_name {
        "search_analyses" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(5);

            match db::search_analyses(pool, user_id, query, limit).await {
                Ok(results) => serde_json::to_string_pretty(&results)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("Search failed: {}", e.client_message())),
            }
        }
        "get_analysis_detail" => {
            let id = args
                .get("analysis_id")
                .and_then(|v| v.as_i64())
                .ok_or("analysis_id is required")?;

            match db::get_analysis_by_id(pool, id, user_id).await {
                Ok(analysis) => serde_json::to_string_pretty(&analysis)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("Failed to get analysis: {}", e.client_message())),
            }
        }
        "search_knowledge_base" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(5);

            execute_kb_search(pool, user_id, query, limit).await
        }
        "search_similar_analyses" => {
            let analysis_id = args
                .get("analysis_id")
                .and_then(|v| v.as_i64())
                .ok_or("analysis_id is required")?;
            let limit = args
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(5);
            let threshold = args
                .get("threshold")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.5);

            execute_similar_search(pool, user_id, analysis_id, limit, threshold).await
        }
        _ => Err(format!("Unknown tool: {tool_name}")),
    }
}

// ============================================================================
// KB search: try hybrid (pgvector + FTS + RRF), fall back to FTS-only
// ============================================================================

async fn execute_kb_search(
    pool: &PgPool,
    user_id: Uuid,
    query: &str,
    limit: i64,
) -> Result<String, String> {
    use hadron_core::retrieval::types::{SearchHit, SearchSource};

    // Try to generate a query embedding for hybrid search
    let embedding_result = match db::get_server_ai_config(pool).await {
        Ok(Some(config)) => {
            crate::integrations::embeddings::generate_embedding_with_retry(
                query,
                &config.api_key,
                3,
            )
            .await
            .ok()
        }
        _ => None,
    };

    if let Some(embedding) = embedding_result {
        // Try OpenSearch first if configured
        let os_config = load_opensearch_config(pool).await;

        if let Some(os_cfg) = os_config {
            // Hybrid OpenSearch: text + KNN
            let text_query = crate::integrations::opensearch::build_text_query(query);
            let index = os_cfg.index_pattern.clone();

            let text_resp = crate::integrations::opensearch::search(
                &os_cfg,
                &index,
                &text_query,
                limit as u32,
                0,
            )
            .await
            .unwrap_or_else(|_| crate::integrations::opensearch::SearchResponse {
                total: 0,
                hits: vec![],
                took_ms: 0,
            });

            let knn_resp = crate::integrations::opensearch::search_knn(
                &os_cfg,
                &index,
                &embedding,
                limit as usize,
            )
            .await
            .unwrap_or_else(|_| crate::integrations::opensearch::SearchResponse {
                total: 0,
                hits: vec![],
                took_ms: 0,
            });

            let text_hits: Vec<SearchHit> = text_resp
                .hits
                .into_iter()
                .map(|h| {
                    let title = h.source["page_title"]
                        .as_str()
                        .or_else(|| h.source["title"].as_str())
                        .unwrap_or("")
                        .to_string();
                    let content = h.source["text"]
                        .as_str()
                        .or_else(|| h.source["content"].as_str())
                        .unwrap_or("")
                        .to_string();
                    SearchHit {
                        id: format!("{}:{}", h.index, h.id),
                        title,
                        content,
                        score: h.score.unwrap_or(0.0),
                        source: SearchSource::OpenSearchText,
                        metadata: HashMap::new(),
                    }
                })
                .collect();

            let knn_hits: Vec<SearchHit> = knn_resp
                .hits
                .into_iter()
                .map(|h| {
                    let title = h.source["page_title"]
                        .as_str()
                        .or_else(|| h.source["title"].as_str())
                        .unwrap_or("")
                        .to_string();
                    let content = h.source["text"]
                        .as_str()
                        .or_else(|| h.source["content"].as_str())
                        .unwrap_or("")
                        .to_string();
                    SearchHit {
                        id: format!("{}:{}", h.index, h.id),
                        title,
                        content,
                        score: h.score.unwrap_or(0.0),
                        source: SearchSource::OpenSearchKnn,
                        metadata: HashMap::new(),
                    }
                })
                .collect();

            if !text_hits.is_empty() || !knn_hits.is_empty() {
                let merged = hadron_core::retrieval::rrf::reciprocal_rank_fusion(
                    vec![text_hits, knn_hits],
                    60,
                );
                let trimmed: Vec<_> = merged.into_iter().take(limit as usize).collect();
                return serde_json::to_string_pretty(&trimmed).map_err(|e| e.to_string());
            }
            // Fall through to local hybrid if OpenSearch returned nothing
        }

        // Local hybrid: pgvector + FTS, RRF-merged
        let vector_rows = db::vector_search(pool, &embedding, limit, Some("analysis"))
            .await
            .unwrap_or_default();

        let fts_rows = db::search_analyses(pool, user_id, query, limit)
            .await
            .unwrap_or_default();

        let vector_hits: Vec<SearchHit> = vector_rows
            .into_iter()
            .map(|(source_id, _, content, _)| SearchHit {
                id: source_id.to_string(),
                title: String::new(),
                content,
                score: 0.0,
                source: SearchSource::PgVector,
                metadata: HashMap::new(),
            })
            .collect();

        let fts_hits: Vec<SearchHit> = fts_rows
            .into_iter()
            .map(|a| SearchHit {
                id: a.id.to_string(),
                title: a.filename.clone(),
                content: a.error_type.unwrap_or_default(),
                score: 0.0,
                source: SearchSource::PostgresFts,
                metadata: HashMap::new(),
            })
            .collect();

        if !vector_hits.is_empty() || !fts_hits.is_empty() {
            let merged = hadron_core::retrieval::rrf::reciprocal_rank_fusion(
                vec![vector_hits, fts_hits],
                60,
            );
            let trimmed: Vec<_> = merged.into_iter().take(limit as usize).collect();
            return serde_json::to_string_pretty(&trimmed).map_err(|e| e.to_string());
        }
    }

    // Fallback: FTS-only (no embedding available or all hybrid paths returned empty)
    match db::search_analyses(pool, user_id, query, limit).await {
        Ok(results) => serde_json::to_string_pretty(&results).map_err(|e| e.to_string()),
        Err(e) => Err(format!("Knowledge base search failed: {}", e.client_message())),
    }
}

// ============================================================================
// Similar analyses search via stored embedding
// ============================================================================

async fn execute_similar_search(
    pool: &PgPool,
    user_id: Uuid,
    analysis_id: i64,
    limit: i64,
    threshold: f64,
) -> Result<String, String> {
    // Verify ownership
    match db::get_analysis_by_id(pool, analysis_id, user_id).await {
        Err(e) => return Err(format!("Analysis not found: {}", e.client_message())),
        Ok(_) => {}
    }

    let embedding = match db::get_embedding(pool, analysis_id, "analysis").await {
        Ok(Some(e)) => e,
        Ok(None) => {
            return Err(format!(
                "No embedding found for analysis {analysis_id}. Generate one via /api/analyses/{analysis_id}/embed first."
            ));
        }
        Err(e) => return Err(format!("Failed to load embedding: {}", e.client_message())),
    };

    match db::find_similar_analyses(pool, &embedding, limit, threshold, Some(analysis_id)).await {
        Ok(results) => serde_json::to_string_pretty(&results).map_err(|e| e.to_string()),
        Err(e) => Err(format!("Similarity search failed: {}", e.client_message())),
    }
}

// ============================================================================
// Load OpenSearch config from DB (best-effort)
// ============================================================================

async fn load_opensearch_config(
    pool: &PgPool,
) -> Option<crate::integrations::opensearch::OpenSearchConfig> {
    sqlx::query_as::<_, (String, Option<String>, Option<String>, String)>(
        "SELECT url, credentials->>'username', credentials->>'password', index_pattern
         FROM opensearch_configs
         ORDER BY is_default DESC, id ASC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|(url, username, password, index_pattern)| {
        crate::integrations::opensearch::OpenSearchConfig {
            url,
            username,
            password,
            index_pattern,
            tls_skip_verify: false,
        }
    })
}
