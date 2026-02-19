//! Notes system commands

use crate::database::AnalysisNote;
use crate::error::CommandResult;
use super::common::DbState;
use std::sync::Arc;

/// Add a note to an analysis
#[tauri::command]
pub async fn add_note_to_analysis(
    analysis_id: i64,
    content: String,
    db: DbState<'_>,
) -> CommandResult<AnalysisNote> {
    let db = Arc::clone(&db);
    let note = tauri::async_runtime::spawn_blocking(move || db.add_note(analysis_id, &content)).await??;
    log::info!("Added note id={} to analysis id={}", note.id, analysis_id);
    Ok(note)
}

/// Update a note
#[tauri::command]
pub async fn update_note(
    id: i64,
    content: String,
    db: DbState<'_>,
) -> CommandResult<AnalysisNote> {
    let db = Arc::clone(&db);
    let note = tauri::async_runtime::spawn_blocking(move || db.update_note(id, &content)).await??;
    log::info!("Updated note id={}", id);
    Ok(note)
}

/// Delete a note
#[tauri::command]
pub async fn delete_note(id: i64, db: DbState<'_>) -> CommandResult<()> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.delete_note(id)).await??;
    log::info!("Deleted note id={}", id);
    Ok(())
}

/// Get all notes for an analysis
#[tauri::command]
pub async fn get_notes_for_analysis(
    analysis_id: i64,
    db: DbState<'_>,
) -> CommandResult<Vec<AnalysisNote>> {
    let db = Arc::clone(&db);
    let notes =
        tauri::async_runtime::spawn_blocking(move || db.get_notes_for_analysis(analysis_id)).await??;
    log::info!(
        "Retrieved {} notes for analysis id={}",
        notes.len(),
        analysis_id
    );
    Ok(notes)
}

/// Get note count for an analysis
#[tauri::command]
pub async fn get_note_count(analysis_id: i64, db: DbState<'_>) -> CommandResult<i32> {
    let db = Arc::clone(&db);
    Ok(tauri::async_runtime::spawn_blocking(move || db.get_note_count(analysis_id)).await??)
}

/// Check if an analysis has any notes
#[tauri::command]
pub async fn analysis_has_notes(analysis_id: i64, db: DbState<'_>) -> CommandResult<bool> {
    let db = Arc::clone(&db);
    Ok(tauri::async_runtime::spawn_blocking(move || db.analysis_has_notes(analysis_id)).await??)
}
