//! JIRA Assist Tauri commands — Sprints 1-7.
//!
//! Sprint 1: read-only DB commands (get, delete).
//! Sprint 2: AI triage. Sprint 3: investigation brief.
//! Sprint 4: duplicate detection. Sprint 5: JIRA round-trip + engineer feedback.
//!
//! NOTE: Keep ALL JIRA Assist commands in this file. Do NOT add them to
//! commands/jira.rs (deep analysis only) or commands_legacy.rs (old JIRA).

use super::common::DbState;
use crate::jira_triage::{JiraTriageRequest, JiraTriageResult};
use crate::jira_brief::{JiraBriefRequest, JiraBriefResult};
use crate::jira_poller::{PollerState, PollerStatus};
use crate::ticket_briefs::TicketBrief;
use std::sync::Arc;
use tauri_plugin_store::StoreExt;

/// Read the AI API key for the given provider from the encrypted Tauri store.
fn read_ai_api_key(app: &tauri::AppHandle, provider: &str) -> Result<String, String> {
    let store = app
        .get_store("settings.json")
        .ok_or_else(|| "Settings store not available".to_string())?;
    let key_name = format!("{}_api_key", provider.to_lowercase());
    let api_key = store
        .get(&key_name)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    if api_key.is_empty() {
        return Err(format!("No API key configured for provider '{provider}'"));
    }
    Ok(api_key)
}

const EMBEDDING_MODEL: &str = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS: u32 = 1536;

/// Build the source text for embedding from brief data.
/// Uses AI-generated fields when available, falls back to raw ticket data.
fn build_embedding_text(
    title: &str,
    brief_json: Option<&str>,
    description: &str,
) -> String {
    if let Some(json_str) = brief_json {
        if let Ok(brief) = serde_json::from_str::<serde_json::Value>(json_str) {
            let mut parts = vec![title.to_string()];

            if let Some(summary) = brief
                .get("analysis")
                .and_then(|a| a.get("plain_summary"))
                .and_then(|s| s.as_str())
            {
                parts.push(summary.to_string());
            }

            if let Some(root_cause) = brief
                .get("analysis")
                .and_then(|a| a.get("technical"))
                .and_then(|t| t.get("root_cause"))
                .and_then(|s| s.as_str())
            {
                parts.push(root_cause.to_string());
            }

            if let Some(impact) = brief
                .get("triage")
                .and_then(|t| t.get("customer_impact"))
                .and_then(|s| s.as_str())
            {
                parts.push(impact.to_string());
            }

            if parts.len() > 1 {
                return parts.join("\n\n");
            }
        }
    }

    // Fallback: title + raw description
    if description.is_empty() {
        title.to_string()
    } else {
        format!("{title}\n\n{description}")
    }
}

/// Fetch a stored ticket brief by JIRA key.
/// Returns null if no brief has been generated for this ticket yet.
#[tauri::command]
pub async fn get_ticket_brief(
    jira_key: String,
    db: DbState<'_>,
) -> Result<Option<TicketBrief>, String> {
    log::debug!("cmd: get_ticket_brief key={}", jira_key);
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.get_ticket_brief(&jira_key)
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Fetch multiple ticket briefs by JIRA keys in a single query.
/// Returns only keys that have a stored brief.
#[tauri::command]
pub async fn get_ticket_briefs_batch(
    jira_keys: Vec<String>,
    db: DbState<'_>,
) -> Result<Vec<TicketBrief>, String> {
    log::debug!("cmd: get_ticket_briefs_batch count={}", jira_keys.len());
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.get_ticket_briefs_batch(&jira_keys)
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Fetch all ticket briefs for the history view.
#[tauri::command]
pub async fn get_all_ticket_briefs(
    db: DbState<'_>,
) -> Result<Vec<TicketBrief>, String> {
    log::debug!("cmd: get_all_ticket_briefs");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.get_all_ticket_briefs()
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Delete a ticket brief and its embeddings from the database.
#[tauri::command]
pub async fn delete_ticket_brief(
    jira_key: String,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: delete_ticket_brief key={}", jira_key);
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.delete_ticket_brief(&jira_key)
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Triage a JIRA ticket with AI — classify severity, category, customer impact, and tags.
/// Upserts the result into ticket_briefs so it persists across sessions.
#[tauri::command]
pub async fn triage_jira_ticket(
    app: tauri::AppHandle,
    request: JiraTriageRequest,
    db: DbState<'_>,
) -> Result<JiraTriageResult, String> {
    log::debug!("cmd: triage_jira_ticket key={}", request.jira_key);

    let api_key = read_ai_api_key(&app, &request.provider)?;

    // Capture fields needed after request is moved into run_jira_triage
    let jira_key = request.jira_key.clone();
    let title = request.title.clone();

    let result = crate::jira_triage::run_jira_triage(request, &api_key).await?;

    // Persist to ticket_briefs (upsert — creates row if absent, updates if present)
    let db = Arc::clone(&db);
    let result_clone = result.clone();
    let tags_json = serde_json::to_string(&result_clone.tags)
        .unwrap_or_else(|_| "[]".to_string());
    let triage_json = serde_json::to_string(&result_clone)
        .map_err(|e| format!("Serialization error: {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let brief = TicketBrief {
            jira_key: jira_key.clone(),
            title,
            customer: None,
            severity: Some(result_clone.severity.clone()),
            category: Some(result_clone.category.clone()),
            tags: Some(tags_json),
            triage_json: Some(triage_json),
            brief_json: None,
            posted_to_jira: false,
            posted_at: None,
            engineer_rating: None,
            engineer_notes: None,
            // created_at / updated_at are set by the DB DEFAULT — use empty placeholder
            created_at: String::new(),
            updated_at: String::new(),
        };
        db.upsert_ticket_brief(&brief)
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    Ok(result)
}

/// Generate a full investigation brief — runs triage + deep analysis in parallel.
/// Persists the combined result as `brief_json` in `ticket_briefs`, and also
/// syncs the triage fields (severity, category, tags, triage_json).
#[tauri::command]
pub async fn generate_ticket_brief(
    app: tauri::AppHandle,
    request: JiraBriefRequest,
    db: DbState<'_>,
) -> Result<JiraBriefResult, String> {
    log::debug!("cmd: generate_ticket_brief key={}", request.jira_key);

    let api_key = read_ai_api_key(&app, &request.provider)?;

    // Capture fields needed for the DB upsert and embedding after request is consumed
    let jira_key    = request.jira_key.clone();
    let title       = request.title.clone();
    let description = request.description.clone();

    let result = crate::jira_brief::run_jira_brief(request, &api_key).await?;

    // Serialize for storage
    let db = Arc::clone(&db);
    let embed_db = Arc::clone(&db); // second clone for fire-and-forget embedding
    let result_clone = result.clone();
    let tags_json = serde_json::to_string(&result_clone.triage.tags)
        .unwrap_or_else(|_| "[]".to_string());
    let triage_json = serde_json::to_string(&result_clone.triage)
        .map_err(|e| format!("Serialization error (triage): {}", e))?;
    let brief_json = serde_json::to_string(&result_clone)
        .map_err(|e| format!("Serialization error (brief): {}", e))?;

    let brief_json_clone = brief_json.clone();
    let jira_key_clone = jira_key.clone();
    let title_clone = title.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let brief = TicketBrief {
            jira_key: jira_key_clone,
            title: title_clone,
            customer:       None,
            severity:       Some(result_clone.triage.severity.clone()),
            category:       Some(result_clone.triage.category.clone()),
            tags:           Some(tags_json),
            triage_json:    Some(triage_json),
            brief_json:     Some(brief_json),
            posted_to_jira: false,
            posted_at:      None,
            engineer_rating: None,
            engineer_notes:  None,
            created_at:     String::new(),
            updated_at:     String::new(),
        };
        db.upsert_ticket_brief(&brief)
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Fire-and-forget: generate and store embedding for this ticket.
    // Runs concurrently — the command returns the brief immediately.
    {
        let embed_key = jira_key;
        let embed_title = title;
        tokio::spawn(async move {
            let source_text = build_embedding_text(&embed_title, Some(&brief_json_clone), &description);
            match crate::retrieval::opensearch::get_embedding(
                &source_text,
                &api_key,
                EMBEDDING_MODEL,
                EMBEDDING_DIMENSIONS,
            )
            .await
            {
                Ok(embedding) => {
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        if let Err(e) = embed_db.upsert_ticket_embedding(&embed_key, &embedding, &source_text) {
                            log::warn!("Failed to store embedding for {}: {e}", embed_key);
                        }
                    })
                    .await;
                }
                Err(e) => {
                    log::warn!("Failed to generate embedding for {embed_key}: {e}");
                }
            }
        });
    }

    Ok(result)
}

/// Find tickets similar to the given ticket using embedding cosine similarity.
/// If the ticket has no embedding yet, generates one on the fly.
#[tauri::command]
pub async fn find_similar_tickets(
    jira_key: String,
    title: String,
    description: String,
    api_key: String,
    threshold: Option<f64>,
    limit: Option<usize>,
    db: DbState<'_>,
) -> Result<Vec<crate::ticket_embeddings::SimilarTicketMatch>, String> {
    log::debug!("cmd: find_similar_tickets key={jira_key}");

    let threshold = threshold.unwrap_or(0.65);
    let limit = limit.unwrap_or(5);
    let db = Arc::clone(&db);

    // 1. Check if we already have an embedding; if not, generate one
    let db2 = Arc::clone(&db);
    let jira_key2 = jira_key.clone();
    let has_emb = tauri::async_runtime::spawn_blocking(move || {
        db2.has_ticket_embedding(&jira_key2)
            .map_err(|e| format!("Database error: {e}"))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    if !has_emb {
        // Build source text from existing brief if available, else title+description
        let db3 = Arc::clone(&db);
        let jira_key3 = jira_key.clone();
        let brief_json = tauri::async_runtime::spawn_blocking(move || {
            db3.get_ticket_brief(&jira_key3)
                .map_err(|e| format!("Database error: {e}"))
        })
        .await
        .map_err(|e| format!("Task error: {e}"))??
        .and_then(|b| b.brief_json);

        let source_text = build_embedding_text(&title, brief_json.as_deref(), &description);

        let embedding = crate::retrieval::opensearch::get_embedding(
            &source_text,
            &api_key,
            EMBEDDING_MODEL,
            EMBEDDING_DIMENSIONS,
        )
        .await
        .map_err(|e| format!("Embedding generation failed: {e}"))?;

        let db4 = Arc::clone(&db);
        let jira_key4 = jira_key.clone();
        tauri::async_runtime::spawn_blocking(move || {
            db4.upsert_ticket_embedding(&jira_key4, &embedding, &source_text)
                .map_err(|e| format!("Database error: {e}"))
        })
        .await
        .map_err(|e| format!("Task error: {e}"))??;
    }

    // 2. Fetch the embedding
    let db5 = Arc::clone(&db);
    let jira_key5 = jira_key.clone();
    let query_embedding = tauri::async_runtime::spawn_blocking(move || {
        db5.get_ticket_embedding(&jira_key5)
            .map_err(|e| format!("Database error: {e}"))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??
    .ok_or_else(|| "Embedding not found after generation".to_string())?;

    // 3. Search
    let db6 = Arc::clone(&db);
    let jira_key6 = jira_key.clone();
    let results = tauri::async_runtime::spawn_blocking(move || {
        db6.find_similar_tickets(&query_embedding, &jira_key6, threshold, limit)
            .map_err(|e| format!("Database error: {e}"))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    Ok(results)
}

// ── Sprint 5: JIRA Round-Trip ──────────────────────────────────────────────

/// Format a JiraBriefResult as condensed JIRA wiki markup for posting as a comment.
fn format_brief_as_jira_markup(jira_key: &str, result: &JiraBriefResult) -> String {
    let mut lines: Vec<String> = Vec::new();

    lines.push(format!("h3. Hadron Investigation Brief — {jira_key}"));
    lines.push(String::new());

    // Triage line
    lines.push(format!(
        "*Severity:* {} | *Category:* {} | *Confidence:* {}",
        result.triage.severity, result.triage.category, result.triage.confidence
    ));
    lines.push(String::new());

    // Summary
    lines.push("h4. Summary".to_string());
    lines.push(result.analysis.plain_summary.clone());
    lines.push(String::new());

    // Root cause
    lines.push("h4. Root Cause".to_string());
    lines.push(result.analysis.technical.root_cause.clone());
    lines.push(String::new());

    // Top 3 recommended actions
    let actions: Vec<_> = result.analysis.recommended_actions.iter().take(3).collect();
    if !actions.is_empty() {
        lines.push("h4. Recommended Actions".to_string());
        for action in &actions {
            lines.push(format!(
                "* *[{}]* {} — _{}_",
                action.priority, action.action, action.rationale
            ));
        }
        lines.push(String::new());
    }

    // Risk one-liner
    lines.push(format!(
        "*Risk:* {} blast radius, {} urgency. {}",
        result.analysis.risk.blast_radius,
        result.analysis.risk.urgency,
        result.analysis.risk.do_nothing_risk
    ));
    lines.push(String::new());

    // Footer
    lines.push("----".to_string());
    lines.push("_Generated by Hadron JIRA Assist_".to_string());

    lines.join("\n")
}

/// Post a condensed investigation brief to JIRA as a comment.
/// Updates ticket_briefs.posted_to_jira and posted_at on success.
#[tauri::command]
pub async fn post_brief_to_jira(
    jira_key: String,
    brief_json: String,
    base_url: String,
    email: String,
    api_token: String,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: post_brief_to_jira key={jira_key}");

    let result: JiraBriefResult = serde_json::from_str(&brief_json)
        .map_err(|e| format!("Failed to parse brief JSON: {e}"))?;

    let comment = format_brief_as_jira_markup(&jira_key, &result);

    crate::jira_service::post_jira_comment(&base_url, &email, &api_token, &jira_key, &comment).await?;

    let db = Arc::clone(&db);
    let jira_key2 = jira_key.clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.mark_posted_to_jira(&jira_key2)
            .map_err(|e| format!("Database error: {e}"))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    Ok(())
}

/// Submit engineer feedback (star rating + notes) for a ticket brief.
#[tauri::command]
pub async fn submit_engineer_feedback(
    jira_key: String,
    rating: Option<i64>,
    notes: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: submit_engineer_feedback key={jira_key} rating={rating:?}");

    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.update_engineer_feedback(&jira_key, rating, notes)
            .map_err(|e| format!("Database error: {e}"))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    Ok(())
}

// ── Sprint 7: Background Poller Commands ─────────────────────────────────────

/// Start the background poller. Restarts if already running.
#[tauri::command]
pub async fn start_poller(
    app: tauri::AppHandle,
    db: DbState<'_>,
    poller: tauri::State<'_, PollerState>,
) -> Result<(), String> {
    log::debug!("cmd: start_poller");
    let db = Arc::clone(&db);
    crate::jira_poller::start_poller(app, db, &poller);
    Ok(())
}

/// Stop the background poller.
#[tauri::command]
pub async fn stop_poller(
    poller: tauri::State<'_, PollerState>,
) -> Result<(), String> {
    log::debug!("cmd: stop_poller");
    crate::jira_poller::stop_poller(&poller);
    Ok(())
}

/// Get current poller status.
#[tauri::command]
pub async fn get_poller_status(
    app: tauri::AppHandle,
    poller: tauri::State<'_, PollerState>,
) -> Result<PollerStatus, String> {
    log::debug!("cmd: get_poller_status");
    Ok(crate::jira_poller::get_poller_status(&poller, &app))
}
