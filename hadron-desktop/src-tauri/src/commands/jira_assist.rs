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

    // Capture fields needed for the DB upsert after request is consumed
    let jira_key = request.jira_key.clone();
    let title    = request.title.clone();

    let result = crate::jira_brief::run_jira_brief(request).await?;

    // Serialize for storage
    let db = Arc::clone(&db);
    let result_clone = result.clone();
    let tags_json = serde_json::to_string(&result_clone.triage.tags)
        .unwrap_or_else(|_| "[]".to_string());
    let triage_json = serde_json::to_string(&result_clone.triage)
        .map_err(|e| format!("Serialization error (triage): {}", e))?;
    let brief_json = serde_json::to_string(&result_clone)
        .map_err(|e| format!("Serialization error (brief): {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let brief = TicketBrief {
            jira_key: jira_key.clone(),
            title,
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

    Ok(result)
}
