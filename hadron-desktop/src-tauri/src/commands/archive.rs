//! Archive system commands

use crate::database::Analysis;
use crate::error::CommandResult;
use super::bulk_ops::BulkOperationResult;
use super::common::DbState;
use std::sync::Arc;

/// Archive an analysis (soft delete)
#[tauri::command]
pub async fn archive_analysis(id: i64, db: DbState<'_>) -> CommandResult<()> {
    log::debug!("cmd: archive_analysis");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.archive_analysis(id)).await??;
    log::info!("Archived analysis id={}", id);
    Ok(())
}

/// Restore an archived analysis
#[tauri::command]
pub async fn restore_analysis(id: i64, db: DbState<'_>) -> CommandResult<()> {
    log::debug!("cmd: restore_analysis");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.restore_analysis(id)).await??;
    log::info!("Restored analysis id={}", id);
    Ok(())
}

/// Get all archived analyses
#[tauri::command]
pub async fn get_archived_analyses(db: DbState<'_>) -> CommandResult<Vec<Analysis>> {
    log::debug!("cmd: get_archived_analyses");
    let db = Arc::clone(&db);
    let analyses = tauri::async_runtime::spawn_blocking(move || db.get_archived_analyses()).await??;
    log::info!("Retrieved {} archived analyses", analyses.len());
    Ok(analyses)
}

/// Permanently delete an analysis
#[tauri::command]
pub async fn permanently_delete_analysis(id: i64, db: DbState<'_>) -> CommandResult<()> {
    log::debug!("cmd: permanently_delete_analysis");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.permanently_delete_analysis(id)).await??;
    log::info!("Permanently deleted analysis id={}", id);
    Ok(())
}

/// Bulk archive analyses
#[tauri::command]
pub async fn bulk_archive_analyses(
    ids: Vec<i64>,
    db: DbState<'_>,
) -> CommandResult<BulkOperationResult> {
    log::debug!("cmd: bulk_archive_analyses");
    let total = ids.len();
    let db = Arc::clone(&db);
    let archived = tauri::async_runtime::spawn_blocking(move || db.bulk_archive_analyses(&ids)).await??;
    log::info!("Bulk archived {} of {} analyses", archived, total);
    Ok(BulkOperationResult {
        success_count: archived,
        total_requested: total,
    })
}

/// Archive a translation (soft delete)
#[tauri::command]
pub async fn archive_translation(id: i64, db: DbState<'_>) -> CommandResult<()> {
    log::debug!("cmd: archive_translation");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.archive_translation(id)).await??;
    log::info!("Archived translation id={}", id);
    Ok(())
}

/// Restore an archived translation
#[tauri::command]
pub async fn restore_translation(id: i64, db: DbState<'_>) -> CommandResult<()> {
    log::debug!("cmd: restore_translation");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.restore_translation(id)).await??;
    log::info!("Restored translation id={}", id);
    Ok(())
}
