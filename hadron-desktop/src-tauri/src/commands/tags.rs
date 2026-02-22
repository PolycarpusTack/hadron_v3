//! Tag management and auto-tagging commands

use crate::database::{Analysis, Database, Tag};
use super::common::{AutoTagSummary, DbState};
use std::collections::HashSet;
use std::sync::Arc;

// ============================================================================
// Auto-Tagging Constants and Helpers
// ============================================================================

const AUTO_TAG_LIMIT: usize = 10;

fn auto_tag_color(tag: &str) -> &'static str {
    match tag {
        "critical" => "#EF4444",
        "high" => "#F97316",
        "medium" => "#EAB308",
        "low" => "#3B82F6",
        "comprehensive" => "#10B981",
        "quick" => "#06B6D4",
        "performance" => "#F59E0B",
        "code" => "#6366F1",
        "legacy" => "#8B5CF6",
        _ => "#6B7280",
    }
}

fn push_auto_tag(tags: &mut Vec<(String, String)>, seen: &mut HashSet<String>, name: &str) {
    if tags.len() >= AUTO_TAG_LIMIT {
        return;
    }
    let normalized = name.to_lowercase();
    if seen.insert(normalized.clone()) {
        tags.push((normalized, auto_tag_color(name).to_string()));
    }
}

fn collect_auto_tags(analysis: &Analysis) -> Vec<(String, String)> {
    let mut tags: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Severity
    if !analysis.severity.is_empty() {
        push_auto_tag(&mut tags, &mut seen, analysis.severity.to_lowercase().as_str());
    }

    // Analysis type
    let analysis_type = analysis.analysis_type.to_lowercase();
    let type_tag = match analysis_type.as_str() {
        "whatson" | "comprehensive" => "comprehensive",
        "quick" => "quick",
        "performance" => "performance",
        "code" => "code",
        "complete" | "specialized" => "legacy",
        _ => analysis_type.as_str(),
    };
    if !type_tag.is_empty() {
        push_auto_tag(&mut tags, &mut seen, type_tag);
    }

    // Large file indicators
    if analysis.file_size_kb >= 2048.0 {
        push_auto_tag(&mut tags, &mut seen, "huge-log");
    } else if analysis.file_size_kb >= 512.0 {
        push_auto_tag(&mut tags, &mut seen, "large-log");
    }

    // Build searchable text
    let mut text = String::new();
    text.push_str(&analysis.error_type);
    text.push(' ');
    if let Some(err) = &analysis.error_message {
        text.push_str(err);
        text.push(' ');
    }
    if let Some(component) = &analysis.component {
        text.push_str(component);
        text.push(' ');
    }
    if let Some(stack) = &analysis.stack_trace {
        text.push_str(stack);
        text.push(' ');
    }
    text.push_str(&analysis.root_cause);

    let text_lower = text.to_lowercase();

    // Namespace prefixes
    for (prefix, tag) in [
        ("psi.", "psi"),
        ("bm.", "bm"),
        ("pl.", "pl"),
        ("won.", "won"),
        ("ex.", "ex"),
        ("core.", "core"),
    ] {
        if text_lower.contains(prefix) {
            push_auto_tag(&mut tags, &mut seen, tag);
        }
    }

    // Error patterns
    let error_type_lower = analysis.error_type.to_lowercase();
    if error_type_lower.contains("messagenotunderstood")
        || text_lower.contains("message not understood")
        || text_lower.contains("does not understand")
    {
        push_auto_tag(&mut tags, &mut seen, "message-not-understood");
    }
    if error_type_lower.contains("subscript")
        || text_lower.contains("out of bounds")
        || text_lower.contains("bounds")
    {
        push_auto_tag(&mut tags, &mut seen, "out-of-bounds");
    }
    if text_lower.contains("nil receiver") || text_lower.contains("nil object") {
        push_auto_tag(&mut tags, &mut seen, "nil-receiver");
    }

    // Keyword tags
    if text_lower.contains("oracle") {
        push_auto_tag(&mut tags, &mut seen, "oracle");
        push_auto_tag(&mut tags, &mut seen, "database");
    }
    if text_lower.contains("postgres") || text_lower.contains("psql") {
        push_auto_tag(&mut tags, &mut seen, "postgresql");
        push_auto_tag(&mut tags, &mut seen, "database");
    }
    if text_lower.contains("database") || text_lower.contains(" sql ") {
        push_auto_tag(&mut tags, &mut seen, "database");
    }
    if text_lower.contains("deadlock") {
        push_auto_tag(&mut tags, &mut seen, "deadlock");
        push_auto_tag(&mut tags, &mut seen, "locking");
    }
    if text_lower.contains("timeout") || text_lower.contains("timed out") {
        push_auto_tag(&mut tags, &mut seen, "timeout");
    }
    if text_lower.contains("out of memory")
        || text_lower.contains("memory")
        || text_lower.contains("heap")
    {
        push_auto_tag(&mut tags, &mut seen, "memory");
    }
    if text_lower.contains("gc") || text_lower.contains("garbage") {
        push_auto_tag(&mut tags, &mut seen, "gc");
    }
    if text_lower.contains("stack trace")
        || text_lower.contains("stacktrace")
        || text_lower.contains("walkback")
    {
        push_auto_tag(&mut tags, &mut seen, "stack-trace");
    }
    if text_lower.contains("socket")
        || text_lower.contains("network")
        || text_lower.contains("http")
    {
        push_auto_tag(&mut tags, &mut seen, "network");
    }
    if text_lower.contains("permission") || text_lower.contains("denied") {
        push_auto_tag(&mut tags, &mut seen, "permission");
    }
    if text_lower.contains("auth")
        || text_lower.contains("unauthorized")
        || text_lower.contains("token")
    {
        push_auto_tag(&mut tags, &mut seen, "auth");
    }
    if text_lower.contains("serialize") || text_lower.contains("deserial") {
        push_auto_tag(&mut tags, &mut seen, "serialization");
    }
    if text_lower.contains("thread") || text_lower.contains("process") {
        push_auto_tag(&mut tags, &mut seen, "threading");
    }
    if text_lower.contains("concurren") {
        push_auto_tag(&mut tags, &mut seen, "concurrency");
    }
    if text_lower.contains("lock") || text_lower.contains("mutex") {
        push_auto_tag(&mut tags, &mut seen, "locking");
    }
    if text_lower.contains(" ui ") || text_lower.contains("window") || text_lower.contains("view ") {
        push_auto_tag(&mut tags, &mut seen, "ui");
    }

    tags
}

pub(crate) fn apply_auto_tags(db: &Database, analysis: &Analysis) -> Result<(), String> {
    let tags = collect_auto_tags(analysis);
    if tags.is_empty() {
        return Ok(());
    }
    for (name, color) in tags {
        let tag_id = db
            .get_or_create_tag_id(&name, &color)
            .map_err(|e| format!("Failed to get/create tag '{}': {}", name, e))?;
        db.add_tag_to_analysis(analysis.id, tag_id)
            .map_err(|e| format!("Failed to add tag '{}' to analysis: {}", name, e))?;
    }
    Ok(())
}

// ============================================================================
// Tag Management Commands
// ============================================================================

/// Create a new tag
#[tauri::command]
pub async fn create_tag(name: String, color: String, db: DbState<'_>) -> Result<Tag, String> {
    log::debug!("cmd: create_tag");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.create_tag(&name, &color))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Update an existing tag
#[tauri::command]
pub async fn update_tag(
    id: i64,
    name: Option<String>,
    color: Option<String>,
    db: DbState<'_>,
) -> Result<Tag, String> {
    log::debug!("cmd: update_tag");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.update_tag(id, name.as_deref(), color.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

/// Delete a tag (cascades to remove from all analyses and translations)
#[tauri::command]
pub async fn delete_tag(id: i64, db: DbState<'_>) -> Result<(), String> {
    log::debug!("cmd: delete_tag");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.delete_tag(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all tags ordered by usage
#[tauri::command]
pub async fn get_all_tags(db: DbState<'_>) -> Result<Vec<Tag>, String> {
    log::debug!("cmd: get_all_tags");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_all_tags())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Add a tag to an analysis
#[tauri::command]
pub async fn add_tag_to_analysis(
    analysis_id: i64,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: add_tag_to_analysis");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.add_tag_to_analysis(analysis_id, tag_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Remove a tag from an analysis
#[tauri::command]
pub async fn remove_tag_from_analysis(
    analysis_id: i64,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: remove_tag_from_analysis");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.remove_tag_from_analysis(analysis_id, tag_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all tags for a specific analysis
#[tauri::command]
pub async fn get_tags_for_analysis(analysis_id: i64, db: DbState<'_>) -> Result<Vec<Tag>, String> {
    log::debug!("cmd: get_tags_for_analysis");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_tags_for_analysis(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Add a tag to a translation
#[tauri::command]
pub async fn add_tag_to_translation(
    translation_id: i64,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: add_tag_to_translation");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.add_tag_to_translation(translation_id, tag_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Remove a tag from a translation
#[tauri::command]
pub async fn remove_tag_from_translation(
    translation_id: i64,
    tag_id: i64,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: remove_tag_from_translation");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.remove_tag_from_translation(translation_id, tag_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

/// Get all tags for a specific translation
#[tauri::command]
pub async fn get_tags_for_translation(
    translation_id: i64,
    db: DbState<'_>,
) -> Result<Vec<Tag>, String> {
    log::debug!("cmd: get_tags_for_translation");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.get_tags_for_translation(translation_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Auto-tag analyses using deterministic rules
/// - limit: Optional maximum number of analyses to process (None = all)
#[tauri::command]
pub async fn auto_tag_analyses(
    limit: Option<i64>,
    db: DbState<'_>,
) -> Result<AutoTagSummary, String> {
    log::debug!("cmd: auto_tag_analyses");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        const PAGE_SIZE: i64 = 200;
        let max_to_process = limit.unwrap_or(-1);
        let mut offset: i64 = 0;
        let mut scanned: i64 = 0;
        let mut tagged: i64 = 0;
        let mut skipped: i64 = 0;
        let mut failed: i64 = 0;

        loop {
            let analyses = db
                .get_analyses_paginated(Some(PAGE_SIZE), Some(offset))
                .map_err(|e| format!("Database error: {}", e))?;

            if analyses.is_empty() {
                break;
            }

            for analysis in analyses {
                if max_to_process >= 0 && scanned >= max_to_process {
                    return Ok(AutoTagSummary {
                        scanned,
                        tagged,
                        skipped,
                        failed,
                    });
                }

                scanned += 1;

                match db.analysis_has_tags(analysis.id) {
                    Ok(true) => {
                        skipped += 1;
                        continue;
                    }
                    Ok(false) => {}
                    Err(e) => {
                        failed += 1;
                        log::warn!(
                            "Auto-tagging skipped analysis {} (tag check failed): {}",
                            analysis.id,
                            e
                        );
                        continue;
                    }
                }

                if let Err(e) = apply_auto_tags(&db, &analysis) {
                    failed += 1;
                    log::warn!("Auto-tagging failed for analysis {}: {}", analysis.id, e);
                } else {
                    tagged += 1;
                }
            }

            offset += PAGE_SIZE;
        }

        Ok(AutoTagSummary {
            scanned,
            tagged,
            skipped,
            failed,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Count analyses without any tags (used for auto-tag preview)
#[tauri::command]
pub async fn count_analyses_without_tags(db: DbState<'_>) -> Result<i64, String> {
    log::debug!("cmd: count_analyses_without_tags");
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.count_analyses_without_tags())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}
