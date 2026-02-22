//! Search and filtering commands

use crate::database::Analysis;
use super::common::DbState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Options for advanced filtering of analyses
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterOptions {
    /// Full-text search query
    pub search: Option<String>,
    /// Severity levels to include (e.g., ["critical", "high"])
    pub severities: Option<Vec<String>>,
    /// Analysis types to include (e.g., ["whatson", "complete", "specialized"])
    pub analysis_types: Option<Vec<String>>,
    /// Analysis modes to include (e.g., ["Quick", "Deep Scan"])
    pub analysis_modes: Option<Vec<String>>,
    /// Tag IDs to filter by
    pub tag_ids: Option<Vec<i64>>,
    /// Tag filter mode: "any" (OR) or "all" (AND)
    pub tag_mode: Option<String>,
    /// Start date (ISO 8601 format)
    pub date_from: Option<String>,
    /// End date (ISO 8601 format)
    pub date_to: Option<String>,
    /// Minimum cost
    pub cost_min: Option<f64>,
    /// Maximum cost
    pub cost_max: Option<f64>,
    /// Include archived (soft-deleted) items
    pub include_archived: Option<bool>,
    /// Sort by field
    pub sort_by: Option<String>,
    /// Sort direction: "asc" or "desc"
    pub sort_direction: Option<String>,
    /// Number of results per page
    pub page_size: Option<i64>,
    /// Page number (0-indexed)
    pub page: Option<i64>,
    /// Limit (alias for page_size)
    pub limit: Option<i64>,
    /// Offset (alias for page * page_size)
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
