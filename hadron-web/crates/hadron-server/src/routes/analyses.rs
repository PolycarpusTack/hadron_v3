//! Analysis handlers — upload, analyze, search, embed, similar.

use axum::extract::{Multipart, Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use std::time::Instant;

use crate::ai::{self, AiConfig, AiMessage, AiProvider};
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

/// Resolve AI config: prefer request-provided key, fall back to server-side config.
pub(crate) async fn resolve_ai_config(
    pool: &sqlx::PgPool,
    api_key: Option<&str>,
    model: Option<&str>,
    provider: Option<&str>,
) -> Result<crate::ai::AiConfig, AppError> {
    if let Some(key) = api_key {
        if !key.is_empty() {
            return Ok(crate::ai::AiConfig {
                provider: AiProvider::from_str(provider.unwrap_or("openai")),
                api_key: key.to_string(),
                model: model.unwrap_or("gpt-4o").to_string(),
            });
        }
    }
    crate::db::get_server_ai_config(pool)
        .await?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::validation(
                "No AI configuration available. Ask an admin to configure API keys, or provide your own.",
            ))
        })
}

pub async fn list_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    let (data, total) =
        db::get_analyses_paginated(&state.db, user.user.id, params.limit(), params.offset())
            .await?;

    Ok(Json(PaginatedResponse {
        data,
        total,
        limit: params.limit(),
        offset: params.offset(),
    }))
}

/// Upload a file via multipart and analyze it.
pub async fn upload_and_analyze(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    let mut file_content = None;
    let mut filename = None;
    let mut api_key = None;
    let mut model = None;
    let mut provider = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError(hadron_core::error::HadronError::Validation(e.to_string())))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "file" => {
                filename = field.file_name().map(|s| s.to_string());
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| {
                        AppError(hadron_core::error::HadronError::Validation(e.to_string()))
                    })?;

                // 10 MB limit
                if bytes.len() > 10 * 1024 * 1024 {
                    return Err(AppError(hadron_core::error::HadronError::FileTooLarge {
                        size: bytes.len() as u64,
                        max: 10 * 1024 * 1024,
                    }));
                }

                file_content =
                    Some(String::from_utf8_lossy(&bytes).to_string());
            }
            "api_key" => {
                api_key = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| {
                            AppError(hadron_core::error::HadronError::Validation(e.to_string()))
                        })?,
                );
            }
            "model" => {
                model = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| {
                            AppError(hadron_core::error::HadronError::Validation(e.to_string()))
                        })?,
                );
            }
            "provider" => {
                provider = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| {
                            AppError(hadron_core::error::HadronError::Validation(e.to_string()))
                        })?,
                );
            }
            _ => {}
        }
    }

    let content = file_content
        .ok_or_else(|| AppError(hadron_core::error::HadronError::validation("No file uploaded")))?;

    let filename = filename.unwrap_or_else(|| "uploaded_file.txt".to_string());
    let model = model.unwrap_or_else(|| "gpt-4o".to_string());
    let provider_str = provider.unwrap_or_else(|| "openai".to_string());

    let ai_config = resolve_ai_config(
        &state.db,
        api_key.as_deref(),
        Some(&model),
        Some(&provider_str),
    ).await?;
    let result =
        run_analysis_with_config(&state, &user, &content, &filename, &ai_config, None).await?;

    Ok((StatusCode::CREATED, Json(result)))
}

/// Analyze content submitted as JSON (for paste/direct input).
pub async fn analyze_content(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let filename = req.filename.unwrap_or_else(|| "pasted_content.txt".to_string());
    let provider = req.provider.unwrap_or_else(|| "openai".to_string());
    let mode = req.analysis_mode.as_deref();

    let ai_config = resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        Some(&req.model),
        Some(&provider),
    ).await?;
    let result =
        run_analysis_with_config(&state, &user, &req.content, &filename, &ai_config, mode)
            .await?;

    Ok((StatusCode::CREATED, Json(result)))
}

/// Shared analysis logic for both upload and paste paths.
async fn run_analysis_with_config(
    state: &AppState,
    user: &AuthenticatedUser,
    content: &str,
    filename: &str,
    ai_config: &AiConfig,
    _analysis_mode: Option<&str>,
) -> Result<AnalysisResponse, AppError> {
    let start = Instant::now();

    // Parse crash file
    let parsed = hadron_core::parser::parse_crash_content(content)?;

    // Select analysis strategy
    let file_size_kb = parsed.file_size_bytes as f64 / 1024.0;
    let strategy = hadron_core::analysis::select_strategy(
        file_size_kb,
        &hadron_core::analysis::TokenBudgetConfig::default(),
    );

    // Prepare content for AI — extract evidence for large files
    let ai_content = match strategy {
        hadron_core::analysis::AnalysisStrategy::Quick => content.to_string(),
        _ => {
            let evidence = hadron_core::evidence::extract_evidence(content)?;
            evidence.to_prompt_text()
        }
    };

    let prompt = format!(
        "Analyze this crash log:\n\n{ai_content}"
    );

    // Code review analyses now use a dedicated route; crash analysis is the default here.
    let system_prompt = ai::CRASH_ANALYSIS_PROMPT;

    let ai_response = ai::complete(
        ai_config,
        vec![AiMessage {
            role: "user".to_string(),
            content: prompt,
        }],
        Some(system_prompt),
    )
    .await?;

    // Parse AI response into structured fields
    let ai_parsed = hadron_core::ai_response::parse_analysis_response(&ai_response);

    let duration_ms = start.elapsed().as_millis() as i64;

    let response = AnalysisResponse {
        id: 0, // Will be set after DB insert
        error_type: ai_parsed.error_type.or(parsed.error_type),
        error_message: ai_parsed.error_message.or(parsed.error_message),
        severity: ai_parsed.severity,
        root_cause: ai_parsed.root_cause,
        suggested_fixes: ai_parsed.suggested_fixes,
        confidence: ai_parsed.confidence,
        component: ai_parsed.component.or(parsed.component),
        tokens_used: None,
        cost: None,
        duration_ms: Some(duration_ms),
    };

    let analysis_data = serde_json::to_value(&response).unwrap_or_default();

    // Store in database
    let id = db::insert_analysis(
        &state.db,
        user.user.id,
        &response,
        filename,
        Some(file_size_kb),
        Some(&analysis_data),
    )
    .await?;

    // Compute and store crash signature (fire-and-forget)
    if let Some(ref error_type) = response.error_type {
        let sig_config = hadron_core::parser::signature::SignatureConfig::default();
        let root_cause = response.root_cause.as_deref().unwrap_or("");
        let stack_trace: Option<&str> = None; // Stack trace is in raw content, not in response
        let sig = hadron_core::parser::signature::compute_signature(
            error_type,
            stack_trace,
            root_cause,
            &sig_config,
        );
        let _ = db::upsert_crash_signature(&state.db, &sig).await;
        let _ = db::link_analysis_signature(&state.db, id, &sig.hash).await;
    }

    // Audit log
    let _ = db::write_audit_log(
        &state.db,
        user.user.id,
        "analysis.create",
        "analysis",
        Some(&id.to_string()),
        &serde_json::json!({ "filename": filename, "model": &ai_config.model, "provider": format!("{:?}", ai_config.provider) }),
        None,
    )
    .await;

    // Fire-and-forget: generate embedding in background
    let pool_clone = state.db.clone();
    let api_key_clone = ai_config.api_key.clone();
    let response_clone = response.clone();
    let final_id = id;
    tokio::spawn(async move {
        let embed_text = build_embedding_text_from_response(&response_clone);
        if !embed_text.is_empty() {
            match crate::integrations::embeddings::generate_embedding(&embed_text, &api_key_clone).await {
                Ok(embedding) => {
                    let _ = db::store_embedding(&pool_clone, final_id, "analysis", &embedding, &embed_text, None).await;
                    tracing::debug!("Embedding generated for analysis {final_id}");
                }
                Err(e) => {
                    tracing::warn!("Failed to generate embedding for analysis {final_id}: {e}");
                }
            }
        }
    });

    Ok(AnalysisResponse { id, ..response })
}

pub async fn get_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let analysis = db::get_analysis_by_id(&state.db, id, user.user.id).await?;
    Ok(Json(analysis))
}

pub async fn delete_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    db::delete_analysis(&state.db, id, user.user.id).await?;
    if let Err(e) = db::write_audit_log(
        &state.db,
        user.user.id,
        "analysis_deleted",
        "analysis",
        Some(&id.to_string()),
        &serde_json::json!({}),
        None,
    )
    .await
    {
        tracing::error!("Failed to write audit log for analysis deletion: {e}");
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn toggle_favorite(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let is_favorite = db::toggle_favorite(&state.db, id, user.user.id).await?;
    Ok(Json(serde_json::json!({ "isFavorite": is_favorite })))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
    limit: Option<i64>,
}

pub async fn search_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(query): Json<SearchQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = query.limit.unwrap_or(50).min(200);
    let results = db::search_analyses(&state.db, user.user.id, &query.q, limit).await?;
    Ok(Json(results))
}

// ============================================================================
// Embedding / RAG handlers
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedRequest {
    api_key: String,
}

pub async fn embed_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<EmbedRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Verify ownership
    let analysis = db::get_analysis_by_id(&state.db, id, user.user.id).await?;

    // Build embedding text from analysis fields
    let embed_text = build_embedding_text(&analysis);

    let embedding =
        crate::integrations::embeddings::generate_embedding(&embed_text, &req.api_key).await?;

    let embed_id = db::store_embedding(
        &state.db,
        id,
        "analysis",
        &embedding,
        &embed_text,
        None,
    )
    .await?;

    Ok(Json(serde_json::json!({ "embeddingId": embed_id })))
}

pub async fn similar_analyses(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(params): Query<SimilarParams>,
) -> Result<impl IntoResponse, AppError> {
    // Verify ownership
    let _analysis = db::get_analysis_by_id(&state.db, id, user.user.id).await?;

    let embedding = db::get_embedding(&state.db, id, "analysis").await?;
    let embedding = embedding.ok_or_else(|| {
        AppError(hadron_core::error::HadronError::NotFound(
            "No embedding found for this analysis. Generate one first.".to_string(),
        ))
    })?;

    let limit = params.limit.unwrap_or(5).min(20);
    let threshold = params.threshold.unwrap_or(0.5);

    let similar =
        db::find_similar_analyses(&state.db, &embedding, limit, threshold, Some(id)).await?;

    Ok(Json(similar))
}

#[derive(Deserialize)]
pub struct SimilarParams {
    limit: Option<i64>,
    threshold: Option<f64>,
}

fn build_embedding_text(analysis: &Analysis) -> String {
    let mut parts = Vec::new();
    if let Some(ref et) = analysis.error_type {
        parts.push(format!("Error: {et}"));
    }
    if let Some(ref em) = analysis.error_message {
        parts.push(format!("Message: {em}"));
    }
    if let Some(ref c) = analysis.component {
        parts.push(format!("Component: {c}"));
    }
    if let Some(ref rc) = analysis.root_cause {
        parts.push(format!("Root cause: {rc}"));
    }
    parts.push(format!("File: {}", analysis.filename));
    parts.join("\n")
}

fn build_embedding_text_from_response(response: &AnalysisResponse) -> String {
    let mut parts = Vec::new();
    if let Some(ref et) = response.error_type {
        parts.push(format!("Error: {et}"));
    }
    if let Some(ref em) = response.error_message {
        parts.push(format!("Message: {em}"));
    }
    if let Some(ref c) = response.component {
        parts.push(format!("Component: {c}"));
    }
    if let Some(ref rc) = response.root_cause {
        parts.push(format!("Root cause: {rc}"));
    }
    parts.join("\n")
}

// ============================================================================
// Archive & Restore
// ============================================================================

pub async fn list_archived(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    let (data, total) =
        db::get_archived_analyses(&state.db, user.user.id, params.limit(), params.offset())
            .await?;

    Ok(Json(PaginatedResponse {
        data,
        total,
        limit: params.limit(),
        offset: params.offset(),
    }))
}

pub async fn restore_analysis(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    db::restore_analysis(&state.db, id, user.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn permanent_delete(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    use crate::middleware::require_role;
    require_role(&user, hadron_core::models::Role::Lead)?;
    db::permanent_delete_analysis(&state.db, id, user.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Advanced Search
// ============================================================================

pub async fn advanced_search(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<AdvancedSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let (data, total) =
        db::advanced_search_analyses(&state.db, user.user.id, &req).await?;

    let limit = req.limit.unwrap_or(50).min(200);
    let offset = req.offset.unwrap_or(0).max(0);

    Ok(Json(PaginatedResponse {
        data,
        total,
        limit,
        offset,
    }))
}

// ============================================================================
// Bulk Operations
// ============================================================================

pub async fn bulk_operation(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<BulkRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.ids.is_empty() {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "No analysis IDs provided",
        )));
    }
    if req.ids.len() > 100 {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "Maximum 100 IDs per bulk operation",
        )));
    }

    let affected = match req.operation.as_str() {
        "archive" => db::bulk_archive(&state.db, &req.ids, user.user.id).await?,
        "restore" => db::bulk_restore(&state.db, &req.ids, user.user.id).await?,
        "favorite" => db::bulk_set_favorite(&state.db, &req.ids, user.user.id, true).await?,
        "unfavorite" => db::bulk_set_favorite(&state.db, &req.ids, user.user.id, false).await?,
        "tag" => {
            let tag_ids = req.tag_ids.as_deref().unwrap_or(&[]);
            if tag_ids.is_empty() {
                return Err(AppError(hadron_core::error::HadronError::validation(
                    "tagIds required for tag operation",
                )));
            }
            db::bulk_add_tags(&state.db, &req.ids, user.user.id, tag_ids).await?
        }
        _ => {
            return Err(AppError(hadron_core::error::HadronError::validation(
                "Invalid operation. Use: archive, restore, favorite, unfavorite, tag",
            )));
        }
    };

    Ok(Json(BulkResult { affected }))
}
