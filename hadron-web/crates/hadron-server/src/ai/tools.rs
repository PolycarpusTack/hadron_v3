//! Chat tool definitions and execution.
//!
//! Provides tools the AI can call during chat: search_analyses, get_analysis_detail,
//! search_knowledge_base, search_similar_analyses, get_top_signatures, get_trend_data,
//! get_error_patterns, search_jira, search_gold_answers, compare_analyses.

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
        // --- New tools for operational reasoning ---
        ToolDefinition {
            name: "get_top_signatures".to_string(),
            description: "Get the most frequently occurring crash signatures. Useful for identifying recurring issues and their current status.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max signatures to return (default 10)"
                    },
                    "status": {
                        "type": "string",
                        "description": "Filter by status: new, investigating, fix_in_progress, fixed, wont_fix, duplicate (optional)"
                    }
                }
            }),
        },
        ToolDefinition {
            name: "get_trend_data".to_string(),
            description: "Get analysis trend data grouped by day or week. Shows how many analyses were performed over time and severity distribution. Useful for spotting increases in errors.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Number of days to look back (default 30)"
                    },
                    "group_by": {
                        "type": "string",
                        "description": "'day' or 'week' (default 'day')"
                    }
                }
            }),
        },
        ToolDefinition {
            name: "get_error_patterns".to_string(),
            description: "Get the most common error types and components across all analyses. Useful for identifying systemic issues.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Look-back period in days (default 30)"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max patterns to return (default 10)"
                    }
                }
            }),
        },
        ToolDefinition {
            name: "search_jira".to_string(),
            description: "Search JIRA tickets by free-text query within the configured project.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Free-text search terms"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10)"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "search_gold_answers".to_string(),
            description: "Search gold-standard (verified correct) analyses. These are human-verified analyses that serve as reference answers. Use when you want to check if a similar issue has been expertly diagnosed before.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
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
            name: "compare_analyses".to_string(),
            description: "Compare two analyses side by side to identify similarities and differences. Useful for determining if two crashes have the same root cause.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "analysis_id_1": {
                        "type": "integer",
                        "description": "First analysis ID"
                    },
                    "analysis_id_2": {
                        "type": "integer",
                        "description": "Second analysis ID"
                    }
                },
                "required": ["analysis_id_1", "analysis_id_2"]
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
        "get_top_signatures" => {
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(10);
            let status = args.get("status").and_then(|v| v.as_str()).map(|s| s.to_string());

            let rows = if let Some(ref s) = status {
                sqlx::query_as::<_, (String, String, i32, String, String)>(
                    "SELECT hash, canonical, occurrence_count, status, last_seen_at::text \
                     FROM crash_signatures WHERE status = $1 \
                     ORDER BY occurrence_count DESC LIMIT $2",
                )
                .bind(s)
                .bind(limit)
                .fetch_all(pool)
                .await
            } else {
                sqlx::query_as::<_, (String, String, i32, String, String)>(
                    "SELECT hash, canonical, occurrence_count, status, last_seen_at::text \
                     FROM crash_signatures \
                     ORDER BY occurrence_count DESC LIMIT $1",
                )
                .bind(limit)
                .fetch_all(pool)
                .await
            };

            match rows {
                Ok(rows) => {
                    let results: Vec<serde_json::Value> = rows
                        .into_iter()
                        .map(|(hash, canonical, count, status, last_seen)| {
                            serde_json::json!({
                                "hash": hash,
                                "signature": canonical,
                                "occurrence_count": count,
                                "status": status,
                                "last_seen": last_seen,
                            })
                        })
                        .collect();
                    serde_json::to_string_pretty(&results).map_err(|e| e.to_string())
                }
                Err(e) => Err(format!("Failed to query signatures: {e}")),
            }
        }

        "get_trend_data" => {
            let days = args.get("days").and_then(|v| v.as_i64()).unwrap_or(30);
            let group_by = args
                .get("group_by")
                .and_then(|v| v.as_str())
                .unwrap_or("day");
            // date_trunc requires a literal string; these are hardcoded so no injection risk
            let trunc = if group_by == "week" { "week" } else { "day" };

            let sql = format!(
                "SELECT date_trunc('{trunc}', created_at)::date::text AS period, \
                 COUNT(*) AS total, \
                 COUNT(*) FILTER (WHERE severity = 'CRITICAL') AS critical, \
                 COUNT(*) FILTER (WHERE severity = 'HIGH') AS high, \
                 COUNT(*) FILTER (WHERE severity = 'MEDIUM') AS medium, \
                 COUNT(*) FILTER (WHERE severity = 'LOW') AS low \
                 FROM analyses \
                 WHERE created_at >= now() - $1 * interval '1 day' \
                 AND user_id = $2 \
                 GROUP BY period ORDER BY period",
            );

            let rows = sqlx::query_as::<_, (String, i64, Option<i64>, Option<i64>, Option<i64>, Option<i64>)>(&sql)
            .bind(days)
            .bind(user_id)
            .fetch_all(pool)
            .await;

            match rows {
                Ok(rows) => {
                    let results: Vec<serde_json::Value> = rows
                        .into_iter()
                        .map(|(period, total, critical, high, medium, low)| {
                            serde_json::json!({
                                "period": period,
                                "total": total,
                                "critical": critical.unwrap_or(0),
                                "high": high.unwrap_or(0),
                                "medium": medium.unwrap_or(0),
                                "low": low.unwrap_or(0),
                            })
                        })
                        .collect();
                    serde_json::to_string_pretty(&results).map_err(|e| e.to_string())
                }
                Err(e) => Err(format!("Failed to query trends: {e}")),
            }
        }

        "get_error_patterns" => {
            let days = args.get("days").and_then(|v| v.as_i64()).unwrap_or(30);
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(10);

            let rows = sqlx::query_as::<_, (Option<String>, Option<String>, i64)>(
                "SELECT error_type, component, COUNT(*) AS cnt \
                 FROM analyses \
                 WHERE created_at >= now() - $1 * interval '1 day' \
                 AND user_id = $3 \
                 GROUP BY error_type, component \
                 ORDER BY cnt DESC \
                 LIMIT $2",
            )
            .bind(days)
            .bind(limit)
            .bind(user_id)
            .fetch_all(pool)
            .await;

            match rows {
                Ok(rows) => {
                    let results: Vec<serde_json::Value> = rows
                        .into_iter()
                        .map(|(error_type, component, cnt)| {
                            serde_json::json!({
                                "error_type": error_type.unwrap_or_else(|| "unknown".to_string()),
                                "component": component.unwrap_or_else(|| "unknown".to_string()),
                                "count": cnt,
                            })
                        })
                        .collect();
                    serde_json::to_string_pretty(&results).map_err(|e| e.to_string())
                }
                Err(e) => Err(format!("Failed to query error patterns: {e}")),
            }
        }

        "search_jira" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(10) as u32;

            // Try to get JIRA config from poller settings
            let jira_config = match db::get_jira_config_from_poller(pool).await {
                Ok(cfg) => cfg,
                Err(_) => {
                    return Ok(
                        "JIRA is not configured on this server. Ask an admin to set up JIRA credentials in the admin panel."
                            .to_string(),
                    );
                }
            };

            // User-supplied JQL is never forwarded — same rule as
            // `routes/integrations::jira_search`. The tool always runs as a
            // free-text search scoped to the configured project.
            let result =
                crate::integrations::jira::search_issues(&jira_config, None, Some(query), limit)
                    .await;

            match result {
                Ok(resp) => serde_json::to_string_pretty(&resp)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("JIRA search failed: {}", e.client_message())),
            }
        }

        "search_gold_answers" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(5);

            let rows = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>, Option<String>, f64, String)>(
                "SELECT a.id, a.filename, a.error_type, a.root_cause, a.component, \
                        g.quality_score, a.created_at::text \
                 FROM gold_analyses g \
                 JOIN analyses a ON a.id = g.analysis_id \
                 WHERE a.filename ILIKE '%' || $1 || '%' \
                    OR a.error_type ILIKE '%' || $1 || '%' \
                    OR a.root_cause ILIKE '%' || $1 || '%' \
                    OR a.component ILIKE '%' || $1 || '%' \
                 ORDER BY g.quality_score DESC \
                 LIMIT $2",
            )
            .bind(query)
            .bind(limit)
            .fetch_all(pool)
            .await;

            match rows {
                Ok(rows) => {
                    let results: Vec<serde_json::Value> = rows
                        .into_iter()
                        .map(|(id, filename, error_type, root_cause, component, score, created)| {
                            serde_json::json!({
                                "analysis_id": id,
                                "filename": filename,
                                "error_type": error_type,
                                "root_cause": root_cause,
                                "component": component,
                                "quality_score": score,
                                "created_at": created,
                                "is_gold_standard": true,
                            })
                        })
                        .collect();
                    if results.is_empty() {
                        Ok("No gold-standard analyses found matching that query.".to_string())
                    } else {
                        serde_json::to_string_pretty(&results).map_err(|e| e.to_string())
                    }
                }
                Err(e) => Err(format!("Failed to search gold analyses: {e}")),
            }
        }

        "compare_analyses" => {
            let id1 = args
                .get("analysis_id_1")
                .and_then(|v| v.as_i64())
                .ok_or("analysis_id_1 is required")?;
            let id2 = args
                .get("analysis_id_2")
                .and_then(|v| v.as_i64())
                .ok_or("analysis_id_2 is required")?;

            let a1 = db::get_analysis_by_id(pool, id1, user_id)
                .await
                .map_err(|e| format!("Analysis {} not found: {}", id1, e.client_message()))?;
            let a2 = db::get_analysis_by_id(pool, id2, user_id)
                .await
                .map_err(|e| format!("Analysis {} not found: {}", id2, e.client_message()))?;

            let comparison = serde_json::json!({
                "analysis_1": {
                    "id": a1.id,
                    "filename": a1.filename,
                    "error_type": a1.error_type,
                    "error_message": a1.error_message,
                    "severity": a1.severity,
                    "component": a1.component,
                    "root_cause": a1.root_cause,
                    "confidence": a1.confidence,
                    "created_at": a1.created_at.to_string(),
                },
                "analysis_2": {
                    "id": a2.id,
                    "filename": a2.filename,
                    "error_type": a2.error_type,
                    "error_message": a2.error_message,
                    "severity": a2.severity,
                    "component": a2.component,
                    "root_cause": a2.root_cause,
                    "confidence": a2.confidence,
                    "created_at": a2.created_at.to_string(),
                },
                "same_error_type": a1.error_type == a2.error_type,
                "same_component": a1.component == a2.component,
                "same_severity": a1.severity == a2.severity,
            });

            serde_json::to_string_pretty(&comparison).map_err(|e| e.to_string())
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

        // Local hybrid: pgvector + FTS, RRF-merged. Tenant-scoped to the
        // calling user (F1 from 2026-04-20 security audit).
        let vector_rows = db::vector_search(
            pool,
            &embedding,
            limit,
            Some("analysis"),
            Some(user_id),
        )
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
