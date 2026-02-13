//! Release Notes Generator commands

use crate::database::Database;
use crate::jira_service;
use crate::release_notes_service::{self, ReleaseNotesConfig};
use std::sync::Arc;
use tauri::{AppHandle, State};

type DbState<'a> = State<'a, Arc<Database>>;

/// Full pipeline: fetch → enrich → generate → save
#[tauri::command]
pub async fn generate_release_notes(
    config: ReleaseNotesConfig,
    base_url: String,
    email: String,
    api_token: String,
    api_key: String,
    model: String,
    provider: String,
    db: DbState<'_>,
    app: AppHandle,
) -> Result<release_notes_service::ReleaseNotesResult, String> {
    log::info!(
        "Generating release notes for version {}",
        config.fix_version
    );
    release_notes_service::run_full_pipeline(
        config, &base_url, &email, &api_token, &api_key, &model, &provider, &db, &app,
    )
    .await
}

/// Dry-run: fetch and display tickets before generating
#[tauri::command]
pub async fn preview_release_notes_tickets(
    config: ReleaseNotesConfig,
    base_url: String,
    email: String,
    api_token: String,
) -> Result<Vec<release_notes_service::ReleaseNoteTicket>, String> {
    log::info!(
        "Previewing tickets for version {}",
        config.fix_version
    );
    release_notes_service::fetch_tickets_for_release(&config, &base_url, &email, &api_token).await
}

/// Populate fix version picker
#[tauri::command]
pub async fn list_jira_fix_versions(
    base_url: String,
    email: String,
    api_token: String,
    project_key: String,
) -> Result<Vec<jira_service::JiraFixVersion>, String> {
    log::info!("Listing fix versions for {}", project_key);
    jira_service::list_fix_versions(base_url, email, api_token, project_key).await
}

/// Load a saved draft
#[tauri::command]
pub async fn get_release_notes(
    id: i64,
    db: DbState<'_>,
) -> Result<Option<crate::database::ReleaseNotesDraft>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.get_release_notes(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// List drafts with pagination
#[tauri::command]
pub async fn list_release_notes(
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    db: DbState<'_>,
) -> Result<Vec<crate::database::ReleaseNotesSummary>, String> {
    let db = db.inner().clone();
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);
    tokio::task::spawn_blocking(move || {
        db.list_release_notes(status.as_deref(), limit, offset)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

/// Save human edits
#[tauri::command]
pub async fn update_release_notes_content(
    id: i64,
    content: String,
    db: DbState<'_>,
) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.update_release_notes_content(id, &content))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Move through review workflow
#[tauri::command]
pub async fn update_release_notes_status(
    id: i64,
    status: String,
    reviewed_by: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        db.update_release_notes_status(id, &status, reviewed_by.as_deref())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

/// Save checklist state
#[tauri::command]
pub async fn update_release_notes_checklist(
    id: i64,
    checklist_json: String,
    db: DbState<'_>,
) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.update_release_notes_checklist(id, &checklist_json))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Incremental update with new tickets
#[tauri::command]
pub async fn append_to_release_notes(
    id: i64,
    config: ReleaseNotesConfig,
    base_url: String,
    email: String,
    api_token: String,
    api_key: String,
    model: String,
    provider: String,
    db: DbState<'_>,
    app: AppHandle,
) -> Result<release_notes_service::ReleaseNotesResult, String> {
    let db_inner = db.inner().clone();

    // Load existing draft
    let existing = db_inner
        .get_release_notes(id)
        .map_err(|e| format!("Database error: {}", e))?
        .ok_or_else(|| "Release notes not found".to_string())?;

    let existing_keys: Vec<String> = serde_json::from_str(&existing.ticket_keys)
        .unwrap_or_default();

    // Fetch new tickets
    release_notes_service::emit_progress(
        &app,
        release_notes_service::ReleaseNotesPhase::FetchingTickets,
        5.0,
        "Fetching new tickets...",
    );
    let all_tickets =
        release_notes_service::fetch_tickets_for_release(&config, &base_url, &email, &api_token)
            .await?;

    // Filter to only new tickets
    let new_tickets: Vec<_> = all_tickets
        .into_iter()
        .filter(|t| !existing_keys.contains(&t.key))
        .collect();

    if new_tickets.is_empty() {
        return Err("No new tickets found to append.".to_string());
    }

    // Generate incremental content
    let (combined, tokens, cost) = release_notes_service::apply_incremental_update(
        &existing.markdown_content,
        &new_tickets,
        &existing_keys,
        &config,
        &api_key,
        &model,
        &provider,
    )
    .await?;

    // Update existing draft
    db_inner
        .update_release_notes_content(id, &combined)
        .map_err(|e| format!("Database error: {}", e))?;

    let mut all_keys = existing_keys;
    all_keys.extend(new_tickets.iter().map(|t| t.key.clone()));

    release_notes_service::emit_progress(
        &app,
        release_notes_service::ReleaseNotesPhase::Complete,
        100.0,
        &format!("Appended {} new tickets", new_tickets.len()),
    );

    Ok(release_notes_service::ReleaseNotesResult {
        id,
        title: existing.title,
        markdown_content: combined,
        ticket_count: all_keys.len() as i32,
        ticket_keys: all_keys,
        ai_insights: None,
        tokens_used: tokens,
        cost,
        generation_duration_ms: 0,
    })
}

/// Export as markdown/confluence/html
#[tauri::command]
pub async fn export_release_notes(
    id: i64,
    format: String,
    db: DbState<'_>,
) -> Result<String, String> {
    let db_inner = db.inner().clone();

    let draft = db_inner
        .get_release_notes(id)
        .map_err(|e| format!("Database error: {}", e))?
        .ok_or_else(|| "Release notes not found".to_string())?;

    match format.as_str() {
        "markdown" => Ok(draft.markdown_content),
        "confluence" => Ok(release_notes_service::markdown_to_confluence(
            &draft.markdown_content,
        )),
        "html" => Ok(release_notes_service::markdown_to_html(
            &draft.markdown_content,
        )),
        _ => Err(format!("Unsupported export format: {}", format)),
    }
}

/// Soft delete
#[tauri::command]
pub async fn delete_release_notes(
    id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.soft_delete_release_notes(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}
