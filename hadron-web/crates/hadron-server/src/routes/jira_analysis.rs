//! JIRA deep analysis handlers — fetch ticket, analyze, stream.
//!
//! All handlers read JIRA credentials from the server-side poller config
//! (admin-configured, encrypted at rest). Clients no longer supply credentials.

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::ai;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::integrations::jira;
use crate::sse;
use crate::AppState;

use super::AppError;

/// Empty request body — kept so handlers that accept `Json(req)` still compile
/// when clients send `{}` or no body. Credentials come from the server-side
/// poller config only; clients cannot override the AI key.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {}

/// POST /api/jira/issues/{key}/detail — fetch full ticket detail.
pub async fn fetch_issue(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let config = db::get_jira_config_from_poller(&state.db).await?;
    let detail = jira::fetch_issue_detail(&config, &key).await?;
    Ok(Json(detail))
}

/// POST /api/jira/issues/{key}/analyze — non-streaming deep analysis.
pub async fn analyze_issue(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(_req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = db::get_jira_config_from_poller(&state.db).await?;
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    let (system_prompt, messages) = hadron_core::ai::build_jira_deep_messages(&ticket);

    let raw_response = ai::complete(&ai_config, messages, Some(&system_prompt)).await?;
    let result = hadron_core::ai::parse_jira_deep_analysis(&raw_response)?;

    Ok(Json(result))
}

/// POST /api/jira/issues/{key}/analyze/stream — SSE streaming deep analysis.
pub async fn analyze_issue_stream(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(_req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = db::get_jira_config_from_poller(&state.db).await?;
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    let (system_prompt, messages) = hadron_core::ai::build_jira_deep_messages(&ticket);

    Ok(sse::stream_ai_completion(ai_config, messages, Some(system_prompt)))
}

// ============================================================================
// Triage
// ============================================================================

/// POST /api/jira/issues/{key}/triage — fast triage classification.
pub async fn triage_issue(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(_req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = db::get_jira_config_from_poller(&state.db).await?;
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    let (system_prompt, messages) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let raw_response = ai::complete(&ai_config, messages, Some(&system_prompt)).await?;
    let result = hadron_core::ai::parse_jira_triage(&raw_response)?;

    // Persist triage to DB
    let tags_json = serde_json::to_string(&result.tags).unwrap_or_default();
    let triage_json = serde_json::to_string(&result).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&result.severity),
        Some(&result.category),
        Some(&tags_json),
        Some(&triage_json),
        None, // brief_json stays as-is
    )
    .await;

    Ok(Json(result))
}

// ============================================================================
// Brief (triage + deep in parallel)
// ============================================================================

/// POST /api/jira/issues/{key}/brief — full investigation brief.
pub async fn generate_brief(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(_req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = db::get_jira_config_from_poller(&state.db).await?;
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    // Run triage + deep analysis in parallel
    let (triage_sys, triage_msgs) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let (deep_sys, deep_msgs) = hadron_core::ai::build_jira_deep_messages(&ticket);

    let ai_config2 = ai_config.clone();
    let triage_fut = async {
        let raw = ai::complete(&ai_config, triage_msgs, Some(&triage_sys)).await?;
        hadron_core::ai::parse_jira_triage(&raw)
    };
    let deep_fut = async {
        let raw = ai::complete(&ai_config2, deep_msgs, Some(&deep_sys)).await?;
        hadron_core::ai::parse_jira_deep_analysis(&raw)
    };

    let (triage, analysis) = tokio::try_join!(triage_fut, deep_fut)
        .map_err(AppError)?;

    let brief_result = hadron_core::ai::JiraBriefResult {
        triage: triage.clone(),
        analysis,
    };

    // Persist to DB
    let tags_json = serde_json::to_string(&triage.tags).unwrap_or_default();
    let triage_json = serde_json::to_string(&triage).unwrap_or_default();
    let brief_json = serde_json::to_string(&brief_result).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&triage.severity),
        Some(&triage.category),
        Some(&tags_json),
        Some(&triage_json),
        Some(&brief_json),
    )
    .await;

    // Fire-and-forget: generate embedding for similarity search
    let pool_clone = state.db.clone();
    let key_clone = key.clone();
    let title_clone = ticket.summary.clone();
    let brief_json_clone = brief_json.clone();
    let api_key_clone = ai_config.api_key.clone();
    tokio::spawn(async move {
        let embed_text = crate::db::build_ticket_embedding_text(&title_clone, "", Some(&brief_json_clone));
        match crate::integrations::embeddings::generate_embedding(&embed_text, &api_key_clone).await {
            Ok(embedding) => {
                let _ = crate::db::store_ticket_embedding(&pool_clone, &key_clone, &embedding, &embed_text).await;
                tracing::debug!("Ticket embedding generated for {key_clone}");
            }
            Err(e) => {
                tracing::warn!("Failed to generate embedding for {key_clone}: {e}");
            }
        }
    });

    Ok(Json(brief_result))
}

/// POST /api/jira/issues/{key}/brief/stream — stream deep analysis, triage runs first.
pub async fn generate_brief_stream(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(_req): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let config = db::get_jira_config_from_poller(&state.db).await?;
    let ticket = jira::fetch_issue_detail(&config, &key).await?;

    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    // Run triage first (fast, ~2-3s)
    let (triage_sys, triage_msgs) = hadron_core::ai::build_jira_triage_messages(&ticket);
    let triage_raw = ai::complete(&ai_config.clone(), triage_msgs, Some(&triage_sys)).await?;
    let triage = hadron_core::ai::parse_jira_triage(&triage_raw)?;

    // Persist triage immediately
    let tags_json = serde_json::to_string(&triage.tags).unwrap_or_default();
    let triage_json_str = serde_json::to_string(&triage).unwrap_or_default();
    let _ = crate::db::upsert_ticket_brief(
        &state.db,
        &key,
        &ticket.summary,
        Some(&triage.severity),
        Some(&triage.category),
        Some(&tags_json),
        Some(&triage_json_str),
        None,
    )
    .await;

    // Stream deep analysis
    let (deep_sys, deep_msgs) = hadron_core::ai::build_jira_deep_messages(&ticket);
    Ok(sse::stream_ai_completion(ai_config, deep_msgs, Some(deep_sys)))
}

// ============================================================================
// Briefs CRUD (persisted data)
// ============================================================================

/// GET /api/jira/briefs/{key} — load persisted brief.
pub async fn get_brief(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let brief = crate::db::get_ticket_brief(&state.db, &key).await?;
    match brief {
        Some(b) => Ok(Json(serde_json::json!(b))),
        None => Err(AppError(hadron_core::error::HadronError::not_found(
            format!("No brief found for {key}"),
        ))),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchBriefsRequest {
    pub jira_keys: Vec<String>,
}

/// POST /api/jira/briefs/batch — load multiple briefs.
pub async fn get_briefs_batch(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<BatchBriefsRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.jira_keys.len() > 200 {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "Maximum 200 keys per batch request.",
        )));
    }
    let briefs = crate::db::get_ticket_briefs_batch(&state.db, &req.jira_keys).await?;
    Ok(Json(briefs))
}

/// DELETE /api/jira/briefs/{key} — delete a brief.
pub async fn delete_brief(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    crate::db::delete_ticket_brief(&state.db, &key).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ============================================================================
// Similar Tickets (embeddings)
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarTicketsRequest {
    pub threshold: Option<f64>,
    pub limit: Option<i64>,
}

/// POST /api/jira/issues/{key}/similar — find similar tickets via embeddings.
pub async fn find_similar_tickets(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<SimilarTicketsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let threshold = req.threshold.unwrap_or(0.65);
    let limit = req.limit.unwrap_or(5).min(20);

    // Load the brief to build embedding text
    let brief_row = crate::db::get_ticket_brief(&state.db, &key).await?;

    let title = brief_row.as_ref().map(|b| b.title.as_str()).unwrap_or(&key);
    let brief_json = brief_row.as_ref().and_then(|b| b.brief_json.as_deref());

    // Get or generate embedding
    let embed_text = crate::db::build_ticket_embedding_text(title, "", brief_json);

    // Resolve AI config for embedding API call (uses OpenAI)
    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    let embedding = crate::integrations::embeddings::generate_embedding(
        &embed_text,
        &ai_config.api_key,
    )
    .await?;

    // Store embedding for future searches (fire-and-forget pattern)
    let pool_clone = state.db.clone();
    let key_clone = key.clone();
    let embed_clone = embedding.clone();
    let text_clone = embed_text.clone();
    tokio::spawn(async move {
        let _ = crate::db::store_ticket_embedding(
            &pool_clone,
            &key_clone,
            &embed_clone,
            &text_clone,
        )
        .await;
    });

    let similar = crate::db::find_similar_tickets(
        &state.db,
        &embedding,
        &key,
        threshold,
        limit,
    )
    .await?;

    Ok(Json(similar))
}

// ============================================================================
// Post Brief to JIRA — two-step preview / confirm (F12, 2026-04-20 audit)
// ============================================================================
//
// Posting AI-authored content to JIRA is a write to an external shared
// surface. Combined with the prompt-injection risk on ingested ticket
// content (F11), a single-click "post brief" flow lets a lead
// inadvertently publish injected output to a real JIRA comment visible
// to every ticket watcher.
//
// We require a two-step flow: the caller must POST to the `/preview`
// endpoint first, which returns the markup and a SHA-256 content hash.
// The confirm POST must echo that hash back; if the stored brief
// changes between preview and confirm (regenerated, mutated by the
// poller, etc.) the hashes stop matching and the confirm fails.
// This keeps the decision to publish bound to a piece of content the
// caller actually saw — no state or session store needed.

use sha2::{Digest, Sha256};

async fn load_brief_markup(pool: &sqlx::PgPool, key: &str) -> Result<String, AppError> {
    let brief_row = crate::db::get_ticket_brief(pool, key)
        .await?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::not_found(format!(
                "No brief found for {key}"
            )))
        })?;

    let brief_json_str = brief_row.brief_json.ok_or_else(|| {
        AppError(hadron_core::error::HadronError::Validation(
            "Brief has no analysis data. Generate a brief first.".to_string(),
        ))
    })?;

    let brief: hadron_core::ai::JiraBriefResult =
        serde_json::from_str(&brief_json_str).map_err(|e| {
            AppError(hadron_core::error::HadronError::Parse(format!(
                "Failed to parse stored brief: {e}"
            )))
        })?;

    Ok(jira::format_brief_as_jira_markup(&brief, key))
}

fn content_hash(markup: &str) -> String {
    let digest = Sha256::digest(markup.as_bytes());
    hex::encode(digest)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmPostBriefRequest {
    /// SHA-256 hex digest of the markup returned by the matching /preview
    /// call. If this does not match the current brief's markup the
    /// request is rejected so a stale preview can't ship out-of-date
    /// content and a direct confirm without a preview is impossible.
    pub confirm_content_hash: String,
}

/// POST /api/jira/issues/{key}/post-brief/preview — render the brief markup
/// and return a content hash the caller must echo back on confirm.
pub async fn preview_brief_for_jira(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let markup = load_brief_markup(&state.db, &key).await?;
    let hash = content_hash(&markup);
    Ok(Json(serde_json::json!({
        "jiraKey": key,
        "markup": markup,
        "contentHash": hash,
    })))
}

/// POST /api/jira/issues/{key}/post-brief — confirm and post the brief as
/// a JIRA comment. Body must include `{ "confirmContentHash": "..." }`
/// matching the most recent `/preview` response for the same key.
pub async fn post_brief_to_jira(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<ConfirmPostBriefRequest>,
) -> Result<impl IntoResponse, AppError> {
    let markup = load_brief_markup(&state.db, &key).await?;
    let current_hash = content_hash(&markup);

    // Constant-time-ish check isn't critical here (the hash isn't a
    // secret) but we do want to be strict about case and whitespace.
    if req.confirm_content_hash.trim().eq_ignore_ascii_case(&current_hash) {
        // ok
    } else {
        return Err(AppError(hadron_core::error::HadronError::Validation(
            "Brief content hash mismatch — preview again and re-confirm."
                .to_string(),
        )));
    }

    let config = db::get_jira_config_from_poller(&state.db).await?;
    jira::post_jira_comment(&config, &key, &markup).await?;

    crate::db::mark_posted_to_jira(&state.db, &key).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ============================================================================
// Engineer Feedback
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    pub rating: Option<i16>,
    pub notes: Option<String>,
}

/// PUT /api/jira/briefs/{key}/feedback — update engineer rating and notes.
pub async fn submit_feedback(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<FeedbackRequest>,
) -> Result<impl IntoResponse, AppError> {
    crate::db::update_engineer_feedback(
        &state.db,
        &key,
        req.rating,
        req.notes.as_deref(),
    )
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}
