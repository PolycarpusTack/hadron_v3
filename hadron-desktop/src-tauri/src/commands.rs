use crate::database::{Analysis, Translation, Database};
use crate::python_runner::run_python_translation;
use crate::model_fetcher::{list_models as fetch_models, test_connection as test_api_connection, Model, ConnectionTestResult};
use crate::ai_service;
use crate::ai_service::translate_ollama;
use crate::keeper_service;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;
use zeroize::Zeroizing;

/// Maximum file size for crash log analysis (10 MB)
/// Prevents memory exhaustion from maliciously large files
const MAX_CRASH_LOG_SIZE_BYTES: u64 = 10 * 1024 * 1024;

/// Maximum content size for translation (1 MB)
const MAX_TRANSLATION_CONTENT_SIZE: usize = 1024 * 1024;

/// Maximum content size for pasted logs (5 MB)
const MAX_PASTED_LOG_SIZE: usize = 5 * 1024 * 1024;

// PERFORMANCE: Pre-compiled regexes for PII redaction (compiled once, reused forever)
// This provides ~10x speedup vs compiling on every call
static EMAIL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap()
});
static IPV4_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b\d{1,3}(?:\.\d{1,3}){3}\b").unwrap()
});
static TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\bsk-[A-Za-z0-9]{10,}\b").unwrap()
});
static WIN_PATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)C:\\Users\\[^\\\s]+").unwrap()
});
static UNIX_HOME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"/home/[^/\s]+").unwrap()
});

fn redact_pii_basic(text: &str) -> String {
    // Basic, fast regex-based redaction for common PII patterns.
    // Uses pre-compiled regexes for performance.
    let mut redacted = text.to_string();

    // Email addresses
    redacted = EMAIL_RE
        .replace_all(&redacted, "[REDACTED_EMAIL]")
        .to_string();

    // IPv4 addresses
    redacted = IPV4_RE
        .replace_all(&redacted, "[REDACTED_IP]")
        .to_string();

    // Token-like strings (e.g., sk-... keys)
    redacted = TOKEN_RE
        .replace_all(&redacted, "[REDACTED_TOKEN]")
        .to_string();

    // Windows user paths: C:\Users\Name\
    redacted = WIN_PATH_RE
        .replace_all(&redacted, "C:\\Users\\[REDACTED_USER]")
        .to_string();

    // Unix home paths: /home/name/
    redacted = UNIX_HOME_RE
        .replace_all(&redacted, "/home/[REDACTED_USER]")
        .to_string();

    redacted
}

#[cfg(test)]
mod tests {
    use super::redact_pii_basic;

    #[test]
    fn redacts_emails() {
        let input = "Contact john.doe@example.com for details.";
        let output = redact_pii_basic(input);
        assert!(!output.contains("john.doe@example.com"));
        assert!(output.contains("[REDACTED_EMAIL]"));
    }

    #[test]
    fn redacts_ipv4_addresses() {
        let input = "Server at 192.168.1.10 responded with error.";
        let output = redact_pii_basic(input);
        assert!(!output.contains("192.168.1.10"));
        assert!(output.contains("[REDACTED_IP]"));
    }

    #[test]
    fn redacts_tokens() {
        let input = "API key: sk-abcdefghijklmnop123456";
        let output = redact_pii_basic(input);
        assert!(!output.contains("sk-abcdefghijklmnop123456"));
        assert!(output.contains("[REDACTED_TOKEN]"));
    }

    #[test]
    fn redacts_user_paths() {
        let input = "Path C:\\Users\\Alice\\Documents and /home/bob/projects";
        let output = redact_pii_basic(input);
        assert!(!output.contains("C:\\Users\\Alice"));
        assert!(!output.contains("/home/bob"));
        assert!(output.contains("C:\\Users\\[REDACTED_USER]"));
        assert!(output.contains("/home/[REDACTED_USER]"));
    }

    #[test]
    fn leaves_text_without_pii_unchanged() {
        let input = "Simple message without any obvious PII.";
        let output = redact_pii_basic(input);
        assert_eq!(input, output);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisRequest {
    pub file_path: String,
    pub api_key: String,
    pub model: String,
    pub provider: String,
    pub analysis_type: String, // "complete" or "specialized"
    pub redact_pii: Option<bool>,
    /// Optional Keeper secret UID - if provided, API key is fetched from Keeper
    /// instead of using the api_key field directly
    pub keeper_secret_uid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisResponse {
    pub id: i64,
    pub filename: String,
    pub error_type: String,
    pub severity: String,
    pub root_cause: String,
    pub suggested_fixes: Vec<String>,
    pub analyzed_at: String,
    pub cost: f64,
}

/// Analyze a crash log file using Rust AI service
#[tauri::command]
pub async fn analyze_crash_log(
    request: AnalysisRequest,
    db: State<'_, Database>,
) -> Result<AnalysisResponse, String> {
    log::info!("Starting crash analysis: file={}, provider={}, model={}, type={}",
        request.file_path, request.provider, request.model, request.analysis_type);

    // SECURITY: Validate file path to prevent path traversal attacks
    let file_path = std::path::Path::new(&request.file_path);
    let canonical_path = std::fs::canonicalize(file_path)
        .map_err(|e| {
            // SECURITY: Log full error but don't expose path details to frontend
            log::error!("Failed to canonicalize path '{}': {}", request.file_path, e);
            "Invalid file path: file not found or inaccessible".to_string()
        })?;

    // Block paths containing traversal patterns
    let path_str = canonical_path.to_string_lossy();
    if path_str.contains("..") {
        return Err("Invalid file path: path traversal not allowed".to_string());
    }

    // Block access to sensitive system directories
    let blocked_prefixes = ["/etc", "/var", "/usr", "/bin", "/sbin", "/root", "/sys", "/proc"];
    for prefix in &blocked_prefixes {
        if path_str.starts_with(prefix) {
            return Err(format!("Access denied: cannot read files from {}", prefix));
        }
    }

    // SECURITY: Validate file size before reading to prevent memory exhaustion
    let file_metadata = std::fs::metadata(&canonical_path)
        .map_err(|e| {
            log::error!("Failed to get metadata for '{}': {}", path_str, e);
            "Failed to access file: permission denied or file not found".to_string()
        })?;

    if file_metadata.len() > MAX_CRASH_LOG_SIZE_BYTES {
        return Err(format!(
            "File too large: {} bytes exceeds maximum of {} bytes (10 MB). Please use a smaller log file.",
            file_metadata.len(),
            MAX_CRASH_LOG_SIZE_BYTES
        ));
    }

    // Read crash log file (size already validated, path already canonicalized)
    let mut crash_content = std::fs::read_to_string(&canonical_path)
        .map_err(|e| {
            log::error!("Failed to read file '{}': {}", path_str, e);
            "Failed to read file: check file permissions".to_string()
        })?;

    // Optionally redact PII before sending to AI providers
    if request.redact_pii.unwrap_or(false) {
        crash_content = redact_pii_basic(&crash_content);
    }

    // Resolve API key - prefer Keeper if configured
    // SECURITY: Wrap in Zeroizing to ensure key is cleared from memory after use
    let api_key: Zeroizing<String> = if let Some(ref keeper_uid) = request.keeper_secret_uid {
        log::info!("Fetching API key from Keeper for analysis");
        // keeper_service already returns Zeroizing<String>
        keeper_service::get_api_key_from_keeper(keeper_uid)
            .map_err(|e| format!("Failed to get API key from Keeper: {}", e))?
    } else {
        Zeroizing::new(request.api_key.clone())
    };

    // Call Rust AI service
    let result = ai_service::analyze_crash_log(
        &crash_content,
        api_key.as_str(),
        &request.model,
        &request.provider,
        &request.analysis_type
    ).await.map_err(|e| {
        log::error!("AI analysis failed: file={}, error={}", request.file_path, e);
        format!("AI analysis failed: {}", e)
    })?;

    log::debug!("AI analysis completed successfully: file={}", request.file_path);

    // Get file size (reuse already-fetched metadata)
    let file_size_kb = file_metadata.len() as f64 / 1024.0;

    // Create analysis with all new fields
    let analysis = Analysis {
        id: 0,
        filename: PathBuf::from(&request.file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown.txt")
            .to_string(),
        file_size_kb,
        error_type: result.error_type.clone(),
        error_message: result.error_message.clone(),
        severity: result.severity.to_uppercase(),
        component: result.component.clone(),
        stack_trace: result.stack_trace.clone(),
        root_cause: result.root_cause.clone(),
        suggested_fixes: serde_json::to_string(&result.suggested_fixes).unwrap_or_else(|e| {
            log::warn!("Failed to serialize suggested_fixes: {}", e);
            "[]".to_string()
        }),
        confidence: Some(result.confidence.to_uppercase()),
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        ai_model: request.model.clone(),
        ai_provider: Some(request.provider.clone()),
        tokens_used: result.tokens_used,
        cost: result.cost,
        was_truncated: result.was_truncated.unwrap_or(false),
        full_data: Some(serde_json::to_string(&result).unwrap_or_else(|e| {
            log::warn!("Failed to serialize full analysis result: {}", e);
            "{}".to_string()
        })),
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms: result.analysis_duration_ms,
        analysis_type: request.analysis_type.clone(),
    };

    // Save to database
    let id = db
        .insert_analysis(&analysis)
        .map_err(|e| {
            log::error!("Database insert failed: file={}, error={}", request.file_path, e);
            format!("Database error: {}", e)
        })?;

    log::info!("Analysis completed successfully: id={}, file={}, provider={}, cost={}",
        id, request.file_path, request.provider, analysis.cost);

    Ok(AnalysisResponse {
        id,
        filename: analysis.filename,
        error_type: analysis.error_type,
        severity: analysis.severity,
        root_cause: analysis.root_cause,
        suggested_fixes: result.suggested_fixes,
        analyzed_at: analysis.analyzed_at,
        cost: analysis.cost,
    })
}

/// Translate technical content to plain language
#[tauri::command]
pub async fn translate_content(
    content: String,
    api_key: String,
    model: String,
    provider: String,
    redact_pii: Option<bool>,
    db: State<'_, Database>,
) -> Result<String, String> {
    // SECURITY: Wrap API key in Zeroizing to ensure it's cleared from memory after use
    let api_key = Zeroizing::new(api_key);

    // SECURITY: Validate content size to prevent memory exhaustion
    if content.len() > MAX_TRANSLATION_CONTENT_SIZE {
        return Err(format!(
            "Content too large: {} bytes exceeds maximum of {} bytes (1 MB)",
            content.len(),
            MAX_TRANSLATION_CONTENT_SIZE
        ));
    }

    log::info!("Starting translation: provider={}, model={}", provider, model);

    // Optionally redact PII in free-form content before sending to AI
    let content_for_ai = if redact_pii.unwrap_or(false) {
        redact_pii_basic(&content)
    } else {
        content.clone()
    };

    // For Ollama, use Rust-native translation (no Python needed)
    let translation_text = if provider.to_lowercase() == "ollama" {
        translate_ollama(&content_for_ai, &model)
            .await
            .map_err(|e| {
                log::error!("Ollama translation failed: error={}", e);
                format!("Ollama translation failed: {}", e)
            })?
    } else {
        // Run Python translation for cloud providers
        let result = run_python_translation(&content_for_ai, api_key.as_str(), &model, &provider)
            .await
            .map_err(|e| {
                log::error!("Translation failed: error={}", e);
                format!("Translation failed: {}", e)
            })?;
        result.translation.clone()
    };

    log::info!("Translation completed successfully: provider={}", provider);

    // Save translation to database
    let translation = Translation {
        id: 0,
        input_content: content,
        translation: translation_text.clone(),
        translated_at: chrono::Utc::now().to_rfc3339(),
        ai_model: model,
        ai_provider: provider.clone(),
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
    };

    let id = db
        .insert_translation(&translation)
        .map_err(|e| {
            log::error!("Database insert failed for translation: error={}", e);
            format!("Database error: {}", e)
        })?;

    log::info!("Translation saved to database: id={}, provider={}", id, provider);

    Ok(translation_text)
}

/// Get all analyses from history (with default pagination)
#[tauri::command]
pub async fn get_all_analyses(db: State<'_, Database>) -> Result<Vec<Analysis>, String> {
    db.get_all_analyses()
        .map_err(|e| format!("Database error: {}", e))
}

/// Get analyses with pagination
/// - limit: Number of results to return (-1 for unlimited)
/// - offset: Number of results to skip
#[tauri::command]
pub async fn get_analyses_paginated(
    limit: Option<i64>,
    offset: Option<i64>,
    db: State<'_, Database>,
) -> Result<Vec<Analysis>, String> {
    db.get_analyses_paginated(limit, offset)
        .map_err(|e| format!("Database error: {}", e))
}

/// Get total count of analyses (for pagination UI)
#[tauri::command]
pub async fn get_analyses_count(db: State<'_, Database>) -> Result<i64, String> {
    db.get_analyses_count()
        .map_err(|e| format!("Database error: {}", e))
}

/// Get a specific analysis by ID
#[tauri::command]
pub async fn get_analysis_by_id(id: i64, db: State<'_, Database>) -> Result<Analysis, String> {
    db.get_analysis_by_id(id)
        .map_err(|e| format!("Database error: {}", e))
}

/// Delete an analysis
#[tauri::command]
pub async fn delete_analysis(id: i64, db: State<'_, Database>) -> Result<(), String> {
    db.delete_analysis(id)
        .map_err(|e| format!("Database error: {}", e))
}

/// Export analysis to Markdown
#[tauri::command]
pub async fn export_analysis(id: i64, db: State<'_, Database>) -> Result<String, String> {
    let analysis = db
        .get_analysis_by_id(id)
        .map_err(|e| format!("Database error: {}", e))?;

    let fixes: Vec<String> = serde_json::from_str(&analysis.suggested_fixes).unwrap_or_else(|e| {
        log::warn!("Failed to deserialize suggested_fixes for analysis {}: {}", id, e);
        vec!["(Unable to parse suggested fixes)".to_string()]
    });

    let markdown = format!(
        "# Crash Analysis Report\n\n\
         **File**: {}\n\
         **Error Type**: {}\n\
         **Severity**: {}\n\
         **Analyzed**: {}\n\n\
         ## Root Cause\n\n{}\n\n\
         ## Suggested Fixes\n\n{}\n\n\
         ---\n\
         Generated by Hadron - Smalltalk Crash Analyzer\n",
        analysis.filename,
        analysis.error_type,
        analysis.severity,
        analysis.analyzed_at,
        analysis.root_cause,
        fixes
            .iter()
            .enumerate()
            .map(|(i, fix)| format!("{}. {}", i + 1, fix))
            .collect::<Vec<_>>()
            .join("\n")
    );

    Ok(markdown)
}

/// Full-text search analyses using FTS5
#[tauri::command]
pub async fn search_analyses(
    query: String,
    severity_filter: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<Analysis>, String> {
    db.search_analyses(&query, severity_filter.as_deref())
        .map_err(|e| format!("Search error: {}", e))
}

/// Toggle favorite status for an analysis
#[tauri::command]
pub async fn toggle_favorite(id: i64, db: State<'_, Database>) -> Result<bool, String> {
    db.toggle_favorite(id)
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all favorite analyses
#[tauri::command]
pub async fn get_favorites(db: State<'_, Database>) -> Result<Vec<Analysis>, String> {
    db.get_favorites()
        .map_err(|e| format!("Database error: {}", e))
}

/// Get recently viewed analyses
#[tauri::command]
pub async fn get_recent(limit: Option<i64>, db: State<'_, Database>) -> Result<Vec<Analysis>, String> {
    db.get_recent(limit.unwrap_or(10))
        .map_err(|e| format!("Database error: {}", e))
}

/// Get database statistics
#[tauri::command]
pub async fn get_database_statistics(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    db.get_statistics()
        .map_err(|e| format!("Database error: {}", e))
}

/// Optimize FTS5 index
#[tauri::command]
pub async fn optimize_fts_index(db: State<'_, Database>) -> Result<(), String> {
    db.optimize_fts()
        .map_err(|e| format!("Database error: {}", e))
}

/// Run database integrity check
#[tauri::command]
pub async fn check_database_integrity(db: State<'_, Database>) -> Result<bool, String> {
    db.integrity_check()
        .map_err(|e| format!("Database error: {}", e))
}

/// Compact database (VACUUM)
#[tauri::command]
pub async fn compact_database(db: State<'_, Database>) -> Result<(), String> {
    db.compact()
        .map_err(|e| format!("Database error: {}", e))
}

/// Checkpoint WAL file
#[tauri::command]
pub async fn checkpoint_wal(db: State<'_, Database>) -> Result<(), String> {
    db.checkpoint_wal()
        .map_err(|e| format!("Database error: {}", e))
}

/// Get all translations from history
#[tauri::command]
pub async fn get_all_translations(db: State<'_, Database>) -> Result<Vec<Translation>, String> {
    db.get_all_translations()
        .map_err(|e| format!("Database error: {}", e))
}

/// Get a specific translation by ID
#[tauri::command]
pub async fn get_translation_by_id(id: i64, db: State<'_, Database>) -> Result<Translation, String> {
    db.get_translation_by_id(id)
        .map_err(|e| format!("Database error: {}", e))
}

/// Delete a translation
#[tauri::command]
pub async fn delete_translation(id: i64, db: State<'_, Database>) -> Result<(), String> {
    db.delete_translation(id)
        .map_err(|e| format!("Database error: {}", e))
}

/// Toggle favorite status for a translation
#[tauri::command]
pub async fn toggle_translation_favorite(id: i64, db: State<'_, Database>) -> Result<bool, String> {
    db.toggle_translation_favorite(id)
        .map_err(|e| format!("Database error: {}", e))
}

/// List available models from AI provider
#[tauri::command]
pub async fn list_models(provider: String, api_key: String) -> Result<Vec<Model>, String> {
    // SECURITY: Wrap API key in Zeroizing to ensure it's cleared from memory after use
    let api_key = Zeroizing::new(api_key);

    log::info!("Fetching models: provider={}", provider);

    let models = fetch_models(&provider, api_key.as_str()).await?;

    log::info!("Fetched {} models from {}", models.len(), provider);
    Ok(models)
}

/// Test API connection by attempting to list models
#[tauri::command]
pub async fn test_connection(provider: String, api_key: String) -> Result<ConnectionTestResult, String> {
    // SECURITY: Wrap API key in Zeroizing to ensure it's cleared from memory after use
    let api_key = Zeroizing::new(api_key);

    log::info!("Testing connection: provider={}", provider);

    let result = test_api_connection(&provider, api_key.as_str()).await?;

    log::info!("Connection test: provider={}, success={}", provider, result.success);
    Ok(result)
}

/// Save analysis result to database (called from TypeScript after AI analysis)
#[tauri::command]
pub async fn save_analysis(
    file_path: String,
    error_type: String,
    error_message: Option<String>,
    severity: String,
    component: Option<String>,
    stack_trace: Option<String>,
    root_cause: String,
    suggested_fixes: Vec<String>,
    confidence: String,
    model: String,
    provider: String,
    tokens_used: i32,
    cost: f64,
    was_truncated: bool,
    analysis_duration_ms: Option<i32>,
    analysis_type: String,
    db: State<'_, Database>,
) -> Result<i64, String> {
    log::info!("Saving analysis to database: file={}, provider={}", file_path, provider);

    // Get file size
    let file_size_kb = std::fs::metadata(&file_path)
        .map(|m| m.len() as f64 / 1024.0)
        .unwrap_or(0.0);

    let analysis = Analysis {
        id: 0,
        filename: PathBuf::from(&file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown.txt")
            .to_string(),
        file_size_kb,
        error_type,
        error_message,
        severity: severity.to_uppercase(),
        component,
        stack_trace,
        root_cause,
        suggested_fixes: serde_json::to_string(&suggested_fixes).unwrap_or_else(|e| {
            log::warn!("Failed to serialize suggested_fixes in save_analysis: {}", e);
            "[]".to_string()
        }),
        confidence: Some(confidence.to_uppercase()),
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        ai_model: model,
        ai_provider: Some(provider),
        tokens_used,
        cost,
        was_truncated,
        full_data: None,
        is_favorite: false,
        last_viewed_at: None,
        view_count: 0,
        analysis_duration_ms,
        analysis_type,
    };

    let id = db
        .insert_analysis(&analysis)
        .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Analysis saved: id={}", id);
    Ok(id)
}

/// Save pasted log text to a temporary file
#[tauri::command]
pub async fn save_pasted_log(content: String) -> Result<String, String> {
    use std::io::Write;
    use std::fs::File;
    use std::env;

    // SECURITY: Validate content size to prevent memory exhaustion
    if content.len() > MAX_PASTED_LOG_SIZE {
        return Err(format!(
            "Pasted content too large: {} bytes exceeds maximum of {} bytes (5 MB)",
            content.len(),
            MAX_PASTED_LOG_SIZE
        ));
    }

    // Create temp file path
    let temp_dir = env::temp_dir();
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("pasted_log_{}.txt", timestamp);
    let file_path = temp_dir.join(filename);

    // Write content to temp file
    let mut file = File::create(&file_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write to temp file: {}", e))?;

    log::info!("Saved pasted log to temp file: {:?}", file_path);

    Ok(file_path.to_string_lossy().to_string())
}

// ============================================================================
// Keeper Secrets Manager Commands
// ============================================================================

/// Initialize Keeper with a one-time access token
/// This binds the token to this device and enables secure API key retrieval
#[tauri::command]
pub async fn initialize_keeper(token: String) -> Result<keeper_service::KeeperInitResult, String> {
    log::info!("Initializing Keeper connection");
    keeper_service::initialize_keeper(&token)
}

/// List available secrets from Keeper (metadata only, not values)
/// Safe to return to frontend - only shows titles and UIDs
#[tauri::command]
pub async fn list_keeper_secrets() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::debug!("Listing Keeper secrets");
    keeper_service::list_keeper_secrets()
}

/// Get Keeper connection status
#[tauri::command]
pub async fn get_keeper_status() -> Result<keeper_service::KeeperStatus, String> {
    log::debug!("Getting Keeper status");
    Ok(keeper_service::get_keeper_status())
}

/// Clear Keeper configuration (disconnect)
#[tauri::command]
pub async fn clear_keeper_config() -> Result<(), String> {
    log::info!("Clearing Keeper configuration");
    keeper_service::clear_keeper_config()
}

/// Test Keeper connection by attempting to list secrets
#[tauri::command]
pub async fn test_keeper_connection() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::info!("Testing Keeper connection");
    keeper_service::list_keeper_secrets()
}
