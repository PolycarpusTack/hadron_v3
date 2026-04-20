//! Hybrid search routes — local pgvector+FTS and OpenSearch KB search.
//!
//! Provides 4 endpoints:
//!   POST /api/search/hybrid           — pgvector + PostgreSQL FTS, RRF-merged
//!   POST /api/search/knowledge-base   — OpenSearch text + KNN, RRF-merged
//!   POST /api/admin/embeddings/backfill — admin: embed unembedded analyses
//!   GET  /api/admin/embeddings/status  — admin: embedding coverage report

use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use std::collections::HashMap;
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::AppState;
use hadron_core::retrieval::types::{SearchHit, SearchSource};

use super::AppError;

// ============================================================================
// Request / response types
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HybridSearchRequest {
    pub query: String,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KBSearchRequest {
    pub query: String,
    pub limit: Option<i64>,
    /// Optional customer identifier used to resolve index names.
    pub customer: Option<String>,
}

// ============================================================================
// Helper: build embedding text used for auto-embedding newly saved analyses.
// ============================================================================

/// Fire-and-forget background task that generates and stores an embedding for
/// a newly-created analysis row.
///
/// `owner_user_id` must be the owner of the analysis row; it is persisted on
/// the embedding so tenant-scoped vector_search can filter to the caller.
pub fn spawn_embed_analysis(pool: sqlx::PgPool, id: i64, owner_user_id: Uuid, text: String) {
    tokio::spawn(async move {
        let ai_config = match db::get_server_ai_config(&pool).await {
            Ok(Some(c)) => c,
            Ok(None) => {
                tracing::debug!("Auto-embed skipped for analysis {id}: no AI config");
                return;
            }
            Err(e) => {
                tracing::warn!("Auto-embed failed to load AI config for analysis {id}: {e}");
                return;
            }
        };
        match crate::integrations::embeddings::generate_embedding_with_retry(
            &text,
            &ai_config.api_key,
            3,
        )
        .await
        {
            Ok(embedding) => {
                if let Err(e) = db::store_embedding(
                    &pool,
                    id,
                    "analysis",
                    &embedding,
                    &text,
                    None,
                    Some(owner_user_id),
                )
                .await
                {
                    tracing::warn!("Auto-embed store failed for analysis {id}: {e}");
                } else {
                    tracing::debug!("Auto-embed stored for analysis {id}");
                }
            }
            Err(e) => tracing::warn!("Auto-embed failed for analysis {id}: {e}"),
        }
    });
}

// ============================================================================
// A) Local hybrid search: pgvector + PostgreSQL FTS, merged with RRF
// ============================================================================

pub async fn search_hybrid(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<HybridSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let limit = req.limit.unwrap_or(10).min(50);

    // 1. Resolve AI config for embedding
    let ai_config =
        crate::routes::analyses::resolve_ai_config(&state.db).await?;

    // 2. Generate query embedding
    let embedding = crate::integrations::embeddings::generate_embedding_with_retry(
        &req.query,
        &ai_config.api_key,
        3,
    )
    .await
    .map_err(|e| AppError(e))?;

    // 3. pgvector search (returns (source_id, source_type, content, distance))
    //    Tenant-scoped: only the caller's own analyses (F1 from 2026-04-20 audit).
    let vector_rows = db::vector_search(
        &state.db,
        &embedding,
        limit,
        Some("analysis"),
        Some(user.user.id),
    )
    .await
    .unwrap_or_default();

    // 4. PostgreSQL FTS search
    let fts_rows = db::search_analyses(&state.db, user.user.id, &req.query, limit)
        .await
        .unwrap_or_default();

    // 5. Convert to Vec<SearchHit>
    let vector_hits: Vec<SearchHit> = vector_rows
        .into_iter()
        .map(|(source_id, _source_type, content, _distance)| SearchHit {
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
        .map(|a| {
            let mut meta = HashMap::new();
            if let Some(ref et) = a.error_type {
                meta.insert("error_type".to_string(), et.clone());
            }
            if let Some(ref sev) = a.severity {
                meta.insert("severity".to_string(), sev.clone());
            }
            SearchHit {
                id: a.id.to_string(),
                title: a.filename.clone(),
                content: a.error_type.unwrap_or_default(),
                score: 0.0,
                source: SearchSource::PostgresFts,
                metadata: meta,
            }
        })
        .collect();

    // 6. RRF merge
    let merged =
        hadron_core::retrieval::rrf::reciprocal_rank_fusion(vec![vector_hits, fts_hits], 60);

    // 7. Trim to limit and return
    let results: Vec<&SearchHit> = merged.iter().take(limit as usize).collect();
    Ok(Json(serde_json::json!({ "results": results, "total": merged.len() })))
}

// ============================================================================
// B) Knowledge-base search: OpenSearch text + KNN, merged with RRF
// ============================================================================

pub async fn search_knowledge_base(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<KBSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let limit = req.limit.unwrap_or(10).min(50);

    // 1. Load the first active OpenSearch config from the DB
    let os_config_opt: Option<crate::integrations::opensearch::OpenSearchConfig> =
        sqlx::query_as::<_, (String, Option<String>, Option<String>, String)>(
            "SELECT url, credentials->>'username', credentials->>'password', index_pattern
             FROM opensearch_configs
             ORDER BY is_default DESC, id ASC
             LIMIT 1",
        )
        .fetch_optional(&state.db)
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
        });

    let os_config = match os_config_opt {
        Some(c) => c,
        None => {
            return Err(AppError(hadron_core::error::HadronError::validation(
                "No OpenSearch configuration found. Ask an admin to configure OpenSearch.",
            )));
        }
    };

    // 2. Resolve customer index if provided
    let index = if let Some(ref customer) = req.customer {
        let indices =
            hadron_core::retrieval::customer_mappings::get_customer_indices(customer);
        indices.map(|i| i.kb_index).unwrap_or_else(|| os_config.index_pattern.clone())
    } else {
        os_config.index_pattern.clone()
    };

    // 3. Resolve AI config for embedding
    let ai_config =
        crate::routes::analyses::resolve_ai_config(&state.db).await?;

    // 4. Generate query embedding
    let embedding = crate::integrations::embeddings::generate_embedding_with_retry(
        &req.query,
        &ai_config.api_key,
        3,
    )
    .await
    .map_err(|e| AppError(e))?;

    // 5. OpenSearch text search (BM25)
    let text_query = crate::integrations::opensearch::build_text_query(&req.query);
    let text_resp = crate::integrations::opensearch::search(
        &os_config,
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

    // 6. OpenSearch KNN search
    let knn_resp =
        crate::integrations::opensearch::search_knn(&os_config, &index, &embedding, limit as usize)
            .await
            .unwrap_or_else(|_| crate::integrations::opensearch::SearchResponse {
                total: 0,
                hits: vec![],
                took_ms: 0,
            });

    // 7. Convert to SearchHit and RRF merge
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

    let merged =
        hadron_core::retrieval::rrf::reciprocal_rank_fusion(vec![text_hits, knn_hits], 60);

    let results: Vec<&SearchHit> = merged.iter().take(limit as usize).collect();
    Ok(Json(serde_json::json!({ "results": results, "total": merged.len() })))
}

// ============================================================================
// C) Admin: backfill embeddings for analyses that don't have one yet
// ============================================================================

pub async fn backfill_embeddings(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    crate::middleware::require_role(&user, hadron_core::models::Role::Admin)
        .map_err(|_| AppError(hadron_core::error::HadronError::forbidden("Admin only")))?;

    let ai_config =
        crate::routes::analyses::resolve_ai_config(&state.db).await?;

    let unembedded = db::get_unembedded_analyses(&state.db, 100).await?;

    let mut processed = 0usize;
    let mut errors = 0usize;

    for (id, owner_user_id, error_type, root_cause, component) in &unembedded {
        let text = format!(
            "{} {} {}",
            error_type.as_deref().unwrap_or(""),
            root_cause.as_deref().unwrap_or(""),
            component.as_deref().unwrap_or(""),
        )
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

        if text.is_empty() {
            continue;
        }

        match crate::integrations::embeddings::generate_embedding_with_retry(
            &text,
            &ai_config.api_key,
            3,
        )
        .await
        {
            Ok(embedding) => {
                if let Err(e) = db::store_embedding(
                    &state.db,
                    *id,
                    "analysis",
                    &embedding,
                    &text,
                    None,
                    Some(*owner_user_id),
                )
                .await
                {
                    tracing::warn!("Backfill store failed for {id}: {e}");
                    errors += 1;
                } else {
                    processed += 1;
                }
            }
            Err(e) => {
                tracing::warn!("Backfill embed failed for {id}: {e}");
                errors += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "processed": processed,
        "skipped": unembedded.len() - processed - errors,
        "errors": errors,
    })))
}

// ============================================================================
// D) Admin: embedding coverage status
// ============================================================================

pub async fn embeddings_status(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    crate::middleware::require_role(&user, hadron_core::models::Role::Admin)
        .map_err(|_| AppError(hadron_core::error::HadronError::forbidden("Admin only")))?;
    let (total, embedded) = db::get_embedding_coverage(&state.db).await?;
    let coverage = if total > 0 {
        (embedded as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    Ok(Json(serde_json::json!({
        "totalAnalyses": total,
        "embedded": embedded,
        "coverage": (coverage * 10.0).round() / 10.0,
    })))
}
