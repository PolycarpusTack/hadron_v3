//! Release notes AI generation pipeline — SSE streaming + non-streaming variants.
//!
//! Three endpoints:
//! - POST /release-notes/preview-tickets — fetch tickets without enrichment
//! - POST /release-notes/generate/stream — SSE pipeline (fetch → enrich → generate → insights → save)
//! - POST /release-notes/generate — non-streaming fallback returning JSON

use axum::{
    extract::State,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    Json,
};
use futures::{stream::Stream, StreamExt};
use hadron_core::ai::{self as ai_core, ReleaseNoteTicket, ReleaseNotesConfig};
use serde::Serialize;
use std::convert::Infallible;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::auth::AuthenticatedUser;
use crate::routes::AppError;
use crate::AppState;
use crate::{ai, db};

const ENRICHMENT_BATCH_SIZE: usize = 10;

// ============================================================================
// Progress event type
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub phase: String,
    pub progress: f64,
    pub message: String,
    pub ticket_count: Option<i32>,
    pub release_note_id: Option<i64>,
}

// ============================================================================
// Helper: build JQL from config
// ============================================================================

fn build_jql(config: &ReleaseNotesConfig, default_project: &str) -> String {
    if let Some(ref custom) = config.jql_filter {
        if !custom.is_empty() {
            return custom.clone();
        }
    }
    let project = config.project_key.as_deref().unwrap_or(default_project);
    // Sanitize: only allow alphanumeric, dash, underscore, dot — prevents JQL injection.
    let safe_project: String = project
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();
    let safe_version: String = config
        .fix_version
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.' || *c == ' ')
        .collect();
    format!(
        "project = \"{}\" AND fixVersion = \"{}\"",
        safe_project, safe_version
    )
}

// ============================================================================
// Helper: resolve style guide from DB
// ============================================================================

async fn resolve_style_guide(pool: &sqlx::PgPool) -> String {
    db::get_global_setting(pool, "release_notes_style_guide")
        .await
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| ai_core::DEFAULT_STYLE_GUIDE.to_string())
}

// ============================================================================
// Helper: build SSE response from progress channel
// ============================================================================

fn progress_stream(
    rx: mpsc::Receiver<ProgressEvent>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_default();
        Ok(Event::default().data(data))
    });
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

// ============================================================================
// Helper: run the full generate pipeline (shared by stream and non-stream)
// ============================================================================

struct GenerateResult {
    release_note_id: i64,
    ticket_count: i32,
    markdown_content: String,
}

async fn run_pipeline(
    state: &AppState,
    user_id: uuid::Uuid,
    config: ReleaseNotesConfig,
    progress_tx: Option<mpsc::Sender<ProgressEvent>>,
) -> Result<GenerateResult, hadron_core::error::HadronError> {
    let started = Instant::now();

    macro_rules! send_progress {
        ($phase:expr, $pct:expr, $msg:expr) => {
            if let Some(ref tx) = progress_tx {
                let _ = tx
                    .send(ProgressEvent {
                        phase: $phase.to_string(),
                        progress: $pct,
                        message: $msg.to_string(),
                        ticket_count: None,
                        release_note_id: None,
                    })
                    .await;
            }
        };
        ($phase:expr, $pct:expr, $msg:expr, ticket_count = $tc:expr) => {
            if let Some(ref tx) = progress_tx {
                let _ = tx
                    .send(ProgressEvent {
                        phase: $phase.to_string(),
                        progress: $pct,
                        message: $msg.to_string(),
                        ticket_count: Some($tc),
                        release_note_id: None,
                    })
                    .await;
            }
        };
    }

    // ------------------------------------------------------------------
    // Phase 1: Fetch tickets (0–15%)
    // ------------------------------------------------------------------
    send_progress!("fetching_tickets", 0.0, "Loading JIRA configuration…");

    let jira_config = db::get_jira_config_from_poller(&state.db).await?;

    send_progress!("fetching_tickets", 5.0, "Fetching tickets from JIRA…");

    let jql = build_jql(&config, &jira_config.project_key);
    let mut tickets =
        crate::integrations::jira::search_issues_for_release_notes(&jira_config, &jql).await?;

    let ticket_count = tickets.len() as i32;

    // Apply content-type filter (features / fixes / both).
    match &config.content_type {
        hadron_core::ai::ContentType::Features => {
            tickets.retain(|t| {
                let it = t.issue_type.to_lowercase();
                it.contains("story")
                    || it.contains("feature")
                    || it.contains("epic")
                    || it.contains("improvement")
                    || it.contains("new feature")
            });
        }
        hadron_core::ai::ContentType::Fixes => {
            tickets.retain(|t| {
                let it = t.issue_type.to_lowercase();
                it.contains("bug") || it.contains("fix") || it.contains("defect")
            });
        }
        hadron_core::ai::ContentType::Both => {} // keep all
    }

    // Apply module filter if specified.
    if let Some(ref module_filter) = config.module_filter {
        if !module_filter.is_empty() {
            tickets.retain(|t| {
                t.module_label
                    .as_ref()
                    .map(|m| module_filter.contains(m))
                    .unwrap_or(false)
            });
        }
    }

    send_progress!(
        "fetching_tickets",
        15.0,
        format!("Fetched {} tickets.", tickets.len()),
        ticket_count = ticket_count
    );

    if tickets.is_empty() {
        return Err(hadron_core::error::HadronError::validation(
            "No tickets matched the JIRA query and filters.",
        ));
    }

    // ------------------------------------------------------------------
    // Phase 2: Enrichment (15–60%)
    // ------------------------------------------------------------------
    let ai_config = super::analyses::resolve_ai_config(&state.db)
        .await
        .map_err(|e| e.0)?;

    let style_guide = resolve_style_guide(&state.db).await;

    let any_enrichment = config.enrichment.classify_modules
        || config.enrichment.generate_keywords
        || config.enrichment.rewrite_descriptions
        || config.enrichment.detect_breaking_changes;

    if any_enrichment {
        let batches: Vec<Vec<ReleaseNoteTicket>> = tickets
            .chunks(ENRICHMENT_BATCH_SIZE)
            .map(|c| c.to_vec())
            .collect();
        let total_batches = batches.len();

        for (i, batch) in batches.iter().enumerate() {
            let batch_pct = 15.0 + (45.0 * (i as f64) / total_batches.max(1) as f64);
            send_progress!(
                "enriching",
                batch_pct,
                format!("Enriching batch {} of {}…", i + 1, total_batches)
            );

            let (system, messages) = ai_core::build_enrichment_messages(batch, &style_guide);
            match ai::complete(&ai_config, messages, Some(&system)).await {
                Ok(raw) => {
                    if let Ok(enriched) = ai_core::parse_enrichment_response(&raw) {
                        for e in &enriched {
                            if let Some(ticket) = tickets.iter_mut().find(|t| t.key == e.key) {
                                if config.enrichment.classify_modules {
                                    ticket.module_label = e.module_label.clone();
                                }
                                if config.enrichment.generate_keywords {
                                    ticket.keywords = e.keywords.clone();
                                }
                                if config.enrichment.rewrite_descriptions {
                                    ticket.rewritten_description = e.rewritten_description.clone();
                                }
                                if config.enrichment.detect_breaking_changes {
                                    ticket.is_breaking_change = e.is_breaking_change;
                                }
                            }
                        }
                    }
                }
                Err(e) => tracing::warn!("Enrichment batch {} failed: {}", i + 1, e),
            }
        }
    }

    send_progress!("enriching", 60.0, "Enrichment complete.");

    // ------------------------------------------------------------------
    // Phase 3: Generation (60–85%)
    // ------------------------------------------------------------------
    send_progress!("generating", 65.0, "Generating release notes…");

    let (gen_system, gen_messages) =
        ai_core::build_generation_messages(&tickets, &config.content_type, &style_guide);

    let markdown_content =
        ai::complete(&ai_config, gen_messages, Some(&gen_system)).await?;

    send_progress!("generating", 85.0, "Generation complete.");

    // ------------------------------------------------------------------
    // Phase 4: Insights (85–90%)
    // ------------------------------------------------------------------
    send_progress!("computing_insights", 87.0, "Computing quality insights…");

    let insights = ai_core::compute_insights(&tickets);
    let insights_json = serde_json::to_value(&insights).ok();

    send_progress!("computing_insights", 90.0, "Insights computed.");

    // ------------------------------------------------------------------
    // Phase 5: Save (90–95%)
    // ------------------------------------------------------------------
    send_progress!("saving", 92.0, "Saving release note…");

    let ticket_keys: Vec<String> = tickets.iter().map(|t| t.key.clone()).collect();
    let ticket_keys_json = serde_json::to_value(&ticket_keys)
        .unwrap_or(serde_json::Value::Array(vec![]));

    let module_filter_json = config
        .module_filter
        .as_ref()
        .and_then(|mf| serde_json::to_value(mf).ok());

    let title = format!(
        "Release Notes — {} {}",
        config
            .project_key
            .as_deref()
            .unwrap_or(&jira_config.project_key),
        config.fix_version
    );

    let duration_ms = started.elapsed().as_millis() as i64;

    let release_note_id = db::insert_ai_release_note(
        &state.db,
        user_id,
        &title,
        &config.fix_version,
        &config.content_type.to_string(),
        &markdown_content,
        &ticket_keys_json,
        tickets.len() as i32,
        config.jql_filter.as_deref(),
        module_filter_json.as_ref(),
        Some(&ai_config.model),
        Some(&ai_config.provider.to_string()),
        0,    // tokens_used — not tracked at this layer
        0.0,  // cost — not tracked at this layer
        duration_ms,
        insights_json.as_ref(),
    )
    .await?;

    send_progress!("saving", 95.0, "Saved.");

    Ok(GenerateResult {
        release_note_id,
        ticket_count: tickets.len() as i32,
        markdown_content,
    })
}

// ============================================================================
// Handler: preview tickets (no enrichment)
// ============================================================================

/// POST /api/release-notes/preview-tickets
///
/// Returns the raw ticket list that matches the JQL/config.
/// No AI calls are made — useful for confirming ticket scope before generation.
pub async fn preview_tickets(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(config): Json<ReleaseNotesConfig>,
) -> Result<impl IntoResponse, AppError> {
    let jira_config = db::get_jira_config_from_poller(&state.db).await?;
    let jql = build_jql(&config, &jira_config.project_key);
    let tickets =
        crate::integrations::jira::search_issues_for_release_notes(&jira_config, &jql).await?;
    Ok(Json(tickets))
}

// ============================================================================
// Handler: SSE streaming generation pipeline
// ============================================================================

/// POST /api/release-notes/generate/stream
///
/// Runs the full pipeline (fetch → enrich → generate → insights → save) and
/// streams `ProgressEvent` JSON objects as SSE.
pub async fn generate_stream(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(config): Json<ReleaseNotesConfig>,
) -> impl IntoResponse {
    let (tx, rx) = mpsc::channel::<ProgressEvent>(64);
    let tx_clone = tx.clone();
    let user_id = user.user.id;

    tokio::spawn(async move {
        match run_pipeline(&state, user_id, config, Some(tx_clone.clone())).await {
            Ok(result) => {
                let _ = tx_clone
                    .send(ProgressEvent {
                        phase: "complete".to_string(),
                        progress: 100.0,
                        message: "Release note generated successfully.".to_string(),
                        ticket_count: Some(result.ticket_count),
                        release_note_id: Some(result.release_note_id),
                    })
                    .await;
            }
            Err(e) => {
                let _ = tx_clone
                    .send(ProgressEvent {
                        phase: "error".to_string(),
                        progress: 0.0,
                        message: e.client_message(),
                        ticket_count: None,
                        release_note_id: None,
                    })
                    .await;
            }
        }
    });

    progress_stream(rx)
}

// ============================================================================
// Handler: non-streaming generation (JSON response)
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResponse {
    pub release_note_id: i64,
    pub ticket_count: i32,
    pub markdown_content: String,
}

/// POST /api/release-notes/generate
///
/// Non-streaming fallback: runs the full pipeline synchronously and returns the
/// generated release note as JSON.
pub async fn generate(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(config): Json<ReleaseNotesConfig>,
) -> Result<impl IntoResponse, AppError> {
    let result = run_pipeline(&state, user.user.id, config, None)
        .await
        .map_err(AppError)?;

    Ok(Json(GenerateResponse {
        release_note_id: result.release_note_id,
        ticket_count: result.ticket_count,
        markdown_content: result.markdown_content,
    }))
}
