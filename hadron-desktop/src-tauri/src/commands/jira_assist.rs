//! JIRA Assist Tauri commands.
//!
//! Sprint 1: read-only DB commands (get, delete).
//! Sprint 2+: triage, brief generation, and post-to-JIRA commands added here.
//!
//! NOTE: Keep ALL JIRA Assist commands in this file. Do NOT add them to
//! commands/jira.rs (deep analysis only) or commands_legacy.rs (old JIRA).

use super::common::DbState;
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
