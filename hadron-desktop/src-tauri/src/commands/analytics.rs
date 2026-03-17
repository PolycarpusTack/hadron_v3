//! Analytics and similar crash detection commands

use crate::database::{Analysis, DashboardStats, ErrorPatternCount, TrendDataPoint};
use super::common::DbState;
use std::sync::Arc;

/// Get similar analyses based on error signature
#[tauri::command]
pub async fn get_similar_analyses(
    analysis_id: i64,
    limit: Option<i32>,
    db: DbState<'_>,
) -> Result<Vec<Analysis>, String> {
    log::debug!("cmd: get_similar_analyses");
    let db = Arc::clone(&db);
    let limit = limit.unwrap_or(10);

    let analyses =
        tauri::async_runtime::spawn_blocking(move || db.get_similar_analyses(analysis_id, limit))
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Found {} similar analyses for id={}",
        analyses.len(),
        analysis_id
    );
    Ok(analyses)
}

/// Count similar analyses for an analysis
#[tauri::command]
pub async fn count_similar_analyses(analysis_id: i64, db: DbState<'_>) -> Result<i32, String> {
    log::debug!("cmd: count_similar_analyses");
    let db = Arc::clone(&db);

    let count =
        tauri::async_runtime::spawn_blocking(move || db.count_similar_analyses(analysis_id))
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| format!("Database error: {}", e))?;

    Ok(count)
}

/// Get trend data for analytics
#[tauri::command]
pub async fn get_trend_data(
    period: String,
    range_days: i32,
    db: DbState<'_>,
) -> Result<Vec<TrendDataPoint>, String> {
    log::debug!("cmd: get_trend_data");
    let db = Arc::clone(&db);
    let period_clone = period.clone();

    let data =
        tauri::async_runtime::spawn_blocking(move || db.get_trend_data(&period_clone, range_days))
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Retrieved {} trend data points for period={}, range={}d",
        data.len(),
        period,
        range_days
    );
    Ok(data)
}

/// Get dashboard statistics (scan counts + gold pipeline)
#[tauri::command]
pub async fn get_dashboard_stats(db: DbState<'_>) -> Result<DashboardStats, String> {
    log::debug!("cmd: get_dashboard_stats");
    let db = Arc::clone(&db);

    tauri::async_runtime::spawn_blocking(move || db.get_dashboard_stats())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get top error patterns
#[tauri::command]
pub async fn get_top_error_patterns(
    limit: Option<i32>,
    db: DbState<'_>,
) -> Result<Vec<ErrorPatternCount>, String> {
    log::debug!("cmd: get_top_error_patterns");
    let db = Arc::clone(&db);
    let limit = limit.unwrap_or(10);

    let patterns = tauri::async_runtime::spawn_blocking(move || db.get_top_error_patterns(limit))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Retrieved {} top error patterns", patterns.len());
    Ok(patterns)
}
