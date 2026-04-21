//! Database and file information commands

use super::common::{validate_file_path, DbState};
use serde::Serialize;
use std::sync::Arc;
use tokio::fs as async_fs;

/// Database information for admin panel
#[derive(Serialize)]
pub struct DatabaseInfo {
    pub schema_version: i32,
    pub analyses_count: i64,
    pub translations_count: i64,
    pub favorites_count: i64,
    pub needs_migration: bool,
    pub database_size_bytes: Option<u64>,
    pub last_analysis_at: Option<String>,
}

/// Get database admin information
#[tauri::command]
pub async fn get_database_info(db: DbState<'_>) -> Result<DatabaseInfo, String> {
    log::debug!("cmd: get_database_info");
    log::debug!("Getting database info");

    let database_size_bytes =
        if let Some(db_path) = dirs::data_dir().map(|p| p.join("hadron").join("analyses.db")) {
            async_fs::metadata(&db_path).await.ok().map(|m| m.len())
        } else {
            None
        };

    let db_clone = Arc::clone(&db);
    let db_result = tauri::async_runtime::spawn_blocking(move || {
        let schema_version = db_clone
            .get_schema_version()
            .map_err(|e| format!("Failed to get schema version: {}", e))?;

        const EXPECTED_SCHEMA_VERSION: i32 = 5;
        let needs_migration = schema_version < EXPECTED_SCHEMA_VERSION;

        let analyses_count = db_clone
            .get_analyses_count()
            .map_err(|e| format!("Failed to get analyses count: {}", e))?;

        let translations_count = db_clone
            .get_translations_count()
            .map_err(|e| format!("Failed to get translations count: {}", e))?;

        let stats = db_clone
            .get_statistics()
            .map_err(|e| format!("Failed to get statistics: {}", e))?;
        let favorites_count = stats
            .get("favorite_count")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let last_analysis_at = db_clone
            .get_recent(1)
            .ok()
            .and_then(|v| v.into_iter().next())
            .map(|a| a.analyzed_at);

        log::info!(
            "Database info: version={}, analyses={}, translations={}",
            schema_version,
            analyses_count,
            translations_count
        );

        Ok::<_, String>((
            schema_version,
            analyses_count,
            translations_count,
            favorites_count,
            needs_migration,
            last_analysis_at,
        ))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let (
        schema_version,
        analyses_count,
        translations_count,
        favorites_count,
        needs_migration,
        last_analysis_at,
    ) = db_result;

    Ok(DatabaseInfo {
        schema_version,
        analyses_count,
        translations_count,
        favorites_count,
        needs_migration,
        database_size_bytes,
        last_analysis_at,
    })
}

/// Get file stats (size) for a file path
/// SECURITY: Uses path validation to prevent access to sensitive system files
#[tauri::command]
pub async fn get_file_stats(path: String) -> Result<serde_json::Value, String> {
    log::debug!("cmd: get_file_stats");
    let canonical_path = validate_file_path(&path, u64::MAX).await?;

    let metadata = async_fs::metadata(&canonical_path).await.map_err(|e| {
        log::error!(
            "Failed to get file stats for '{}': {}",
            canonical_path.display(),
            e
        );
        "Failed to access file: permission denied or file not found".to_string()
    })?;

    Ok(serde_json::json!({
        "size": metadata.len()
    }))
}

/// Get the current crash log directory path
#[tauri::command]
pub fn get_crash_log_dir() -> Result<String, String> {
    Ok(crate::crash_handler::get_crash_log_dir()
        .to_string_lossy()
        .to_string())
}

/// Set a custom crash log directory, or pass empty string to reset to default
#[tauri::command]
pub fn set_crash_log_dir(dir: String) -> Result<String, String> {
    crate::crash_handler::set_crash_log_dir(&dir).map(|p| p.to_string_lossy().to_string())
}

/// Read the stability-mode toggle (see `stability.rs` for what it changes).
#[tauri::command]
pub fn get_stability_mode() -> bool {
    crate::stability::is_enabled()
}

/// Enable or disable stability mode. Writes %APPDATA%/hadron/stability.json
/// synchronously so the value survives a crash-and-auto-restart cycle.
#[tauri::command]
pub fn set_stability_mode(enabled: bool) -> Result<bool, String> {
    crate::stability::set_enabled(enabled)?;
    Ok(enabled)
}
