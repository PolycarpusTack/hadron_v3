//! Search and filtering commands

use crate::database::Analysis;
use super::common::DbState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Options for advanced filtering of analyses
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterOptions {
    pub search: Option<String>,
    pub severities: Option<Vec<String>>,
    pub analysis_types: Option<Vec<String>>,
    pub analysis_modes: Option<Vec<String>>,
    pub tag_ids: Option<Vec<i64>>,
    pub tag_mode: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub cost_min: Option<f64>,
    pub cost_max: Option<f64>,
    pub include_archived: Option<bool>,
    pub favorites_only: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Result container with pagination metadata
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredResults<T> {
    pub items: Vec<T>,
    pub total_count: i64,
    pub page: i64,
    pub page_size: i64,
    pub has_more: bool,
}

/// Full-text search analyses using FTS5
#[tauri::command]
pub async fn search_analyses(
    query: String,
    severity_filter: Option<String>,
    db: DbState<'_>,
) -> Result<Vec<Analysis>, String> {
    log::debug!("cmd: search_analyses");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.search_analyses(&query, severity_filter.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Search error: {}", e))
}

/// Get analyses with advanced filtering
#[tauri::command]
pub async fn get_analyses_filtered(
    options: AdvancedFilterOptions,
    db: DbState<'_>,
) -> Result<FilteredResults<Analysis>, String> {
    log::debug!("cmd: get_analyses_filtered");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_analyses_filtered(&options))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}
