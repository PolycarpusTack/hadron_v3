//! Bulk operations for analyses and translations

use super::common::DbState;
use serde::Serialize;
use std::sync::Arc;

/// Result of a bulk operation
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkOperationResult {
    pub success_count: usize,
    pub total_requested: usize,
}

/// Delete multiple analyses in a single operation
#[tauri::command]
pub async fn bulk_delete_analyses(
    ids: Vec<i64>,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = ids.len();
    let db = Arc::clone(&db);

    let deleted = tauri::async_runtime::spawn_blocking(move || db.bulk_delete_analyses(&ids))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Bulk deleted {} of {} analyses", deleted, total);
    Ok(BulkOperationResult {
        success_count: deleted,
        total_requested: total,
    })
}

/// Delete multiple translations in a single operation
#[tauri::command]
pub async fn bulk_delete_translations(
    ids: Vec<i64>,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = ids.len();
    let db = Arc::clone(&db);

    let deleted = tauri::async_runtime::spawn_blocking(move || db.bulk_delete_translations(&ids))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Bulk deleted {} of {} translations", deleted, total);
    Ok(BulkOperationResult {
        success_count: deleted,
        total_requested: total,
    })
}

/// Add a tag to multiple analyses
#[tauri::command]
pub async fn bulk_add_tag_to_analyses(
    analysis_ids: Vec<i64>,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = analysis_ids.len();
    let db = Arc::clone(&db);

    let added = tauri::async_runtime::spawn_blocking(move || {
        db.bulk_add_tag_to_analyses(&analysis_ids, tag_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Bulk added tag {} to {} of {} analyses",
        tag_id,
        added,
        total
    );
    Ok(BulkOperationResult {
        success_count: added,
        total_requested: total,
    })
}

/// Remove a tag from multiple analyses
#[tauri::command]
pub async fn bulk_remove_tag_from_analyses(
    analysis_ids: Vec<i64>,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = analysis_ids.len();
    let db = Arc::clone(&db);

    let removed = tauri::async_runtime::spawn_blocking(move || {
        db.bulk_remove_tag_from_analyses(&analysis_ids, tag_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Bulk removed tag {} from {} of {} analyses",
        tag_id,
        removed,
        total
    );
    Ok(BulkOperationResult {
        success_count: removed,
        total_requested: total,
    })
}

/// Set favorite status for multiple analyses
#[tauri::command]
pub async fn bulk_set_favorite_analyses(
    analysis_ids: Vec<i64>,
    favorite: bool,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = analysis_ids.len();
    let db = Arc::clone(&db);

    let updated = tauri::async_runtime::spawn_blocking(move || {
        db.bulk_set_favorite_analyses(&analysis_ids, favorite)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Bulk set favorite={} for {} of {} analyses",
        favorite,
        updated,
        total
    );
    Ok(BulkOperationResult {
        success_count: updated,
        total_requested: total,
    })
}

/// Set favorite status for multiple translations
#[tauri::command]
pub async fn bulk_set_favorite_translations(
    translation_ids: Vec<i64>,
    favorite: bool,
    db: DbState<'_>,
) -> Result<BulkOperationResult, String> {
    let total = translation_ids.len();
    let db = Arc::clone(&db);

    let updated = tauri::async_runtime::spawn_blocking(move || {
        db.bulk_set_favorite_translations(&translation_ids, favorite)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Bulk set favorite={} for {} of {} translations",
        favorite,
        updated,
        total
    );
    Ok(BulkOperationResult {
        success_count: updated,
        total_requested: total,
    })
}
