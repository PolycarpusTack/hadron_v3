//! Pattern matching commands

use crate::models::CrashFile;
use crate::parser::CrashFileParser;
use crate::patterns::{create_pattern_engine, CrashPattern, PatternEngine, PatternMatchResult};
use serde::Serialize;
use std::sync::RwLock;
use tauri::State;
use tokio::fs as async_fs;

/// Managed state for pattern engine
pub struct PatternEngineState(pub RwLock<PatternEngine>);

/// Summary of a pattern for listing
#[derive(Serialize)]
pub struct PatternSummary {
    pub id: String,
    pub name: String,
    pub category: String,
    pub enabled: bool,
    pub priority: u32,
}

/// Parse a crash file from disk path
#[tauri::command]
pub async fn parse_crash_file(path: String) -> Result<CrashFile, String> {
    log::debug!("cmd: parse_crash_file");
    // SECURITY: Validate path to prevent path traversal attacks
    if path.contains("..") {
        log::warn!("Path traversal attempt in parse_crash_file: {}", path);
        return Err("Invalid file path: path traversal not allowed".to_string());
    }

    // Canonicalize path to resolve symlinks and validate existence
    let canonical_path = async_fs::canonicalize(&path).await.map_err(|e| {
        log::error!("Failed to canonicalize path '{}': {}", path, e);
        "Invalid file path: file not found or inaccessible".to_string()
    })?;

    // Block access to sensitive system directories
    let path_str = canonical_path.to_string_lossy();
    let path_str_lower = path_str.to_lowercase();

    // Unix sensitive directories
    let blocked_unix = [
        "/etc", "/var", "/usr", "/bin", "/sbin", "/root", "/sys", "/proc",
    ];
    for prefix in &blocked_unix {
        if path_str.starts_with(prefix) {
            log::warn!(
                "Blocked access to system directory in parse_crash_file: {}",
                prefix
            );
            return Err(format!("Access denied: cannot read files from {}", prefix));
        }
    }

    // Windows sensitive directories
    let blocked_windows = [
        "c:\\windows",
        "c:\\program files",
        "c:\\programdata",
        "c:/windows",
        "c:/program files",
        "c:/programdata",
    ];
    for prefix in &blocked_windows {
        if path_str_lower.starts_with(prefix) {
            log::warn!("Blocked access to Windows system directory in parse_crash_file");
            return Err("Access denied: cannot read files from system directories".to_string());
        }
    }

    log::info!("Parsing crash file: {}", path);
    let parser = CrashFileParser::new();
    parser
        .parse_file(&canonical_path)
        .await
        .map_err(|e| format!("Parse error: {}", e))
}

/// Parse crash file content directly (for pasted content)
#[tauri::command]
pub fn parse_crash_content(content: String, file_name: String) -> Result<CrashFile, String> {
    log::debug!("cmd: parse_crash_content");
    log::info!("Parsing crash content: {}", file_name);
    let parser = CrashFileParser::new();
    parser
        .parse_content(&content, &file_name, content.len() as u64)
        .map_err(|e| format!("Parse error: {}", e))
}

/// Parse multiple crash files in batch
#[tauri::command]
pub async fn parse_crash_files_batch(
    paths: Vec<String>,
) -> Result<Vec<(String, Result<CrashFile, String>)>, String> {
    log::debug!("cmd: parse_crash_files_batch");
    log::info!("Parsing {} crash files in batch", paths.len());
    let parser = CrashFileParser::new();
    let mut results = Vec::new();

    for path in paths {
        let result = validate_and_parse_file(&parser, &path).await;
        results.push((path, result));
    }

    Ok(results)
}

/// Helper function to validate path and parse crash file
async fn validate_and_parse_file(
    parser: &CrashFileParser,
    path: &str,
) -> Result<CrashFile, String> {
    // Check for path traversal
    if path.contains("..") {
        log::warn!("Path traversal attempt in batch parse: {}", path);
        return Err("Invalid file path: path traversal not allowed".to_string());
    }

    // Canonicalize path
    let canonical_path = async_fs::canonicalize(path)
        .await
        .map_err(|_| "Invalid file path: file not found or inaccessible".to_string())?;

    // Block sensitive directories
    let path_str = canonical_path.to_string_lossy();
    let path_str_lower = path_str.to_lowercase();

    let blocked_unix = [
        "/etc", "/var", "/usr", "/bin", "/sbin", "/root", "/sys", "/proc",
    ];
    for prefix in &blocked_unix {
        if path_str.starts_with(prefix) {
            return Err(format!("Access denied: cannot read files from {}", prefix));
        }
    }

    let blocked_windows = [
        "c:\\windows",
        "c:\\program files",
        "c:\\programdata",
        "c:/windows",
        "c:/program files",
        "c:/programdata",
    ];
    for prefix in &blocked_windows {
        if path_str_lower.starts_with(prefix) {
            return Err("Access denied: cannot read files from system directories".to_string());
        }
    }

    parser
        .parse_file(&canonical_path)
        .await
        .map_err(|e| format!("Parse error: {}", e))
}

/// Find all matching patterns for a parsed crash file
#[tauri::command]
pub fn match_patterns(
    crash: CrashFile,
    engine: State<'_, PatternEngineState>,
) -> Result<Vec<PatternMatchResult>, String> {
    log::debug!("cmd: match_patterns");
    log::debug!("Matching patterns for crash file");
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let results = engine_guard.find_matches(&crash);
    drop(engine_guard);
    Ok(results)
}

/// Find the best matching pattern for a parsed crash file
#[tauri::command]
pub fn get_best_pattern_match(
    crash: CrashFile,
    engine: State<'_, PatternEngineState>,
) -> Result<Option<PatternMatchResult>, String> {
    log::debug!("cmd: get_best_pattern_match");
    log::debug!("Finding best pattern match");
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let result = engine_guard.find_best_match(&crash);
    drop(engine_guard);
    Ok(result)
}

/// List all available patterns
#[tauri::command]
pub fn list_patterns(engine: State<'_, PatternEngineState>) -> Result<Vec<PatternSummary>, String> {
    log::debug!("cmd: list_patterns");
    log::debug!("Listing all patterns");
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let summaries: Vec<PatternSummary> = engine_guard
        .patterns()
        .iter()
        .map(|p| PatternSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            category: format!("{:?}", p.category),
            enabled: p.enabled,
            priority: p.priority,
        })
        .collect();
    drop(engine_guard);
    Ok(summaries)
}

/// Get a specific pattern by ID
#[tauri::command]
pub fn get_pattern_by_id(
    id: String,
    engine: State<'_, PatternEngineState>,
) -> Result<Option<CrashPattern>, String> {
    log::debug!("cmd: get_pattern_by_id");
    log::debug!("Getting pattern by ID: {}", id);
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let pattern = engine_guard.get_pattern(&id).cloned();
    drop(engine_guard);
    Ok(pattern)
}

/// Reload patterns from disk (including custom patterns)
#[tauri::command]
pub fn reload_patterns(
    custom_dir: Option<String>,
    engine: State<'_, PatternEngineState>,
) -> Result<usize, String> {
    log::debug!("cmd: reload_patterns");
    log::info!("Reloading patterns (custom_dir: {:?})", custom_dir);
    // Create new engine OUTSIDE the lock to minimize hold time
    let new_engine = create_pattern_engine(
        custom_dir
            .as_ref()
            .map(|s| std::path::Path::new(s.as_str())),
    );
    let count = new_engine.patterns().len();

    let mut state = engine
        .0
        .write()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    *state = new_engine;
    drop(state);

    log::info!("Loaded {} patterns", count);
    Ok(count)
}

/// Quick match: parse content and match patterns in one call
#[tauri::command]
pub fn quick_pattern_match(
    content: String,
    file_name: String,
    engine: State<'_, PatternEngineState>,
) -> Result<Option<PatternMatchResult>, String> {
    log::debug!("cmd: quick_pattern_match");
    log::info!("Quick pattern match for: {}", file_name);

    // Parse the crash file OUTSIDE the lock
    let parser = CrashFileParser::new();
    let crash = parser
        .parse_content(&content, &file_name, content.len() as u64)
        .map_err(|e| format!("Parse error: {}", e))?;

    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;
    let result = engine_guard.find_best_match(&crash);
    drop(engine_guard);
    Ok(result)
}

/// Get patterns by category
#[tauri::command]
pub fn get_patterns_by_category(
    category: String,
    engine: State<'_, PatternEngineState>,
) -> Result<Vec<CrashPattern>, String> {
    log::debug!("cmd: get_patterns_by_category");
    log::debug!("Getting patterns for category: {}", category);
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    let patterns: Vec<CrashPattern> = engine_guard
        .patterns()
        .iter()
        .filter(|p| format!("{:?}", p.category).to_lowercase() == category.to_lowercase())
        .cloned()
        .collect();

    drop(engine_guard);
    Ok(patterns)
}

/// Get patterns by tag
#[tauri::command]
pub fn get_patterns_by_tag(
    tag: String,
    engine: State<'_, PatternEngineState>,
) -> Result<Vec<CrashPattern>, String> {
    log::debug!("cmd: get_patterns_by_tag");
    log::debug!("Getting patterns for tag: {}", tag);
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    let patterns: Vec<CrashPattern> = engine_guard
        .patterns()
        .iter()
        .filter(|p| p.tags.iter().any(|t| t.to_lowercase() == tag.to_lowercase()))
        .cloned()
        .collect();

    drop(engine_guard);
    Ok(patterns)
}

/// Get all pattern tags
#[tauri::command]
pub fn get_pattern_tags(engine: State<'_, PatternEngineState>) -> Result<Vec<String>, String> {
    log::debug!("cmd: get_pattern_tags");
    log::debug!("Getting all pattern tags");
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    let mut tags: Vec<String> = engine_guard
        .patterns()
        .iter()
        .flat_map(|p| p.tags.iter())
        .cloned()
        .collect();

    tags.sort();
    tags.dedup();

    drop(engine_guard);
    Ok(tags)
}

/// Get all pattern categories
#[tauri::command]
pub fn get_pattern_categories(engine: State<'_, PatternEngineState>) -> Result<Vec<String>, String> {
    log::debug!("cmd: get_pattern_categories");
    log::debug!("Getting all pattern categories");
    let engine_guard = engine
        .0
        .read()
        .map_err(|e| format!("Pattern engine lock poisoned: {}", e))?;

    let mut categories: Vec<String> = engine_guard
        .patterns()
        .iter()
        .map(|p| format!("{:?}", p.category))
        .collect();

    categories.sort();
    categories.dedup();

    drop(engine_guard);
    Ok(categories)
}
