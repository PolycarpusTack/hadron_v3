//! JIRA Assist Tauri commands.
//!
//! Sprint 1: read-only DB commands (get, delete).
//! Sprint 2+: triage, brief generation, and post-to-JIRA commands added here.
//!
//! NOTE: Keep ALL JIRA Assist commands in this file. Do NOT add them to
//! commands/jira.rs (deep analysis only) or commands_legacy.rs (old JIRA).

use super::common::DbState;
use crate::jira_triage::{JiraTriageRequest, JiraTriageResult};
use crate::jira_brief::{JiraBriefRequest, JiraBriefResult};
use crate::ticket_briefs::TicketBrief;
use std::sync::Arc;

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
    request: JiraTriageRequest,
    db: DbState<'_>,
) -> Result<JiraTriageResult, String> {
    log::debug!("cmd: triage_jira_ticket key={}", request.jira_key);

    // Capture fields needed after request is moved into run_jira_triage
    let jira_key = request.jira_key.clone();
    let title = request.title.clone();

    let result = crate::jira_triage::run_jira_triage(request).await?;

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
    request: JiraBriefRequest,
    db: DbState<'_>,
) -> Result<JiraBriefResult, String> {
    log::debug!("cmd: generate_ticket_brief key={}", request.jira_key);

    // Capture fields needed for the DB upsert and embedding after request is consumed
    let jira_key    = request.jira_key.clone();
    let title       = request.title.clone();
    let api_key     = request.api_key.clone();
    let description = request.description.clone();

    let result = crate::jira_brief::run_jira_brief(request).await?;

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
