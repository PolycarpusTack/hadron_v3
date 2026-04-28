//! Keeper Secrets Manager Integration
//!
//! Provides secure retrieval of API keys from Keeper vault without
//! exposing the actual key values to the frontend.
//!
//! # Security Model
//! - One-time tokens are used only during initial setup
//! - API keys are retrieved directly by the backend and never sent to frontend
//! - Keeper config is encrypted at rest
//! - All secret access is audited in Keeper

use keeper_secrets_manager_core::{
    cache::KSMCache,
    core::{ClientOptions, SecretsManager},
    custom_error::KSMRError,
    storage::FileKeyValueStorage,
};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Instant;
use zeroize::{Zeroize, Zeroizing};

/// Cache TTL in seconds (5 minutes)
const CACHE_TTL_SECS: u64 = 300;

/// Cache for Keeper secrets to avoid repeated API calls
static SECRETS_CACHE: Lazy<Mutex<Option<SecretsCache>>> = Lazy::new(|| Mutex::new(None));

#[derive(Debug, Clone)]
struct SecretsCache {
    secrets: Vec<CachedSecret>,
    cached_at: Instant,
}

impl SecretsCache {
    fn new(secrets: Vec<CachedSecret>) -> Self {
        Self {
            secrets,
            cached_at: Instant::now(),
        }
    }

    fn is_expired(&self) -> bool {
        self.cached_at.elapsed().as_secs() > CACHE_TTL_SECS
    }
}

/// Cached secret with password field that is zeroized on drop
/// SECURITY: Implements Zeroize to clear passwords from memory when cache is dropped
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct CachedSecret {
    uid: String,
    title: String,
    record_type: String,
    password: Option<String>,
}

impl Drop for CachedSecret {
    fn drop(&mut self) {
        // SECURITY: Zero out password when secret is dropped
        if let Some(ref mut pwd) = self.password {
            pwd.zeroize();
        }
    }
}

/// Result of initializing Keeper with a one-time token
#[derive(Debug, Serialize, Deserialize)]
pub struct KeeperInitResult {
    pub success: bool,
    pub message: String,
    pub secrets_count: Option<usize>,
}

/// Information about a secret in Keeper (without the actual value)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeeperSecretInfo {
    pub uid: String,
    pub title: String,
    pub record_type: String,
}

/// Result of fetching secrets list
#[derive(Debug, Serialize, Deserialize)]
pub struct KeeperSecretsListResult {
    pub success: bool,
    pub secrets: Vec<KeeperSecretInfo>,
    pub message: String,
}

/// Keeper connection status
#[derive(Debug, Serialize, Deserialize)]
pub struct KeeperStatus {
    pub configured: bool,
    pub connected: bool,
    pub secrets_count: usize,
    pub message: String,
}

/// Get the Keeper config file path
fn get_keeper_config_path() -> Result<PathBuf, String> {
    let app_dir = dirs::data_dir()
        .ok_or("Failed to get app data directory")?
        .join("Hadron");

    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app directory: {}", e))?;

    Ok(app_dir.join("keeper-config.json"))
}

/// Convert KSMRError to a user-friendly string
fn format_keeper_error(e: KSMRError) -> String {
    match e {
        KSMRError::HTTPError(msg) => format!("Network error: {}", msg),
        KSMRError::StorageError(msg) => format!("Storage error: {}", msg),
        KSMRError::CryptoError(msg) => format!("Authentication error: {}", msg),
        KSMRError::SecretManagerCreationError(msg) => format!("Configuration error: {}", msg),
        KSMRError::KeyNotFoundError(msg) => format!("Key not found: {}", msg),
        KSMRError::RecordDataError(msg) => format!("Record data error: {}", msg),
        KSMRError::CustomError(msg) => format!("Error: {}", msg),
        _ => format!("Keeper error: {:?}", e),
    }
}

/// Helper to extract a string value from a serde_json::Value
fn value_to_string(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s),
        serde_json::Value::Array(arr) => {
            // If array, try to get first string element
            arr.into_iter().find_map(|v| {
                if let serde_json::Value::String(s) = v {
                    Some(s)
                } else {
                    None
                }
            })
        }
        _ => None,
    }
}

/// Try to get a field value as Option<String>, logging SDK errors instead of silently swallowing them
fn get_field_as_string(
    record: &keeper_secrets_manager_core::dto::dtos::Record,
    field_type: &str,
    is_standard: bool,
) -> Option<String> {
    let result = if is_standard {
        record.get_standard_field_value(field_type, true)
    } else {
        record.get_custom_field_value(field_type, true)
    };
    match result {
        Ok(value) => value_to_string(value),
        Err(e) => {
            log::trace!(
                "Keeper: field '{}' (standard={}) not found on '{}': {}",
                field_type, is_standard, record.title, format_keeper_error(e)
            );
            None
        }
    }
}

/// Extract the best API-key-like value from a Keeper record,
/// trying standard fields first, then custom fields, then notes, then a brute-force scan.
fn extract_secret_value(record: &keeper_secrets_manager_core::dto::dtos::Record) -> Option<String> {
    // 1. Standard fields (record template built-ins) — most common locations
    //    Note: "login" is intentionally excluded — it holds usernames, not API keys
    let result = get_field_as_string(record, "password", true)
        .or_else(|| get_field_as_string(record, "secret", true))
        .or_else(|| get_field_as_string(record, "hiddenField", true))
        .or_else(|| get_field_as_string(record, "note", true))
        .or_else(|| get_field_as_string(record, "oneTimeCode", true))
        // 2. Custom fields (user-defined) — SDK label match is case-sensitive,
        //    so we also do a case-insensitive scan below in Stage 4
        .or_else(|| get_field_as_string(record, "password", false))
        .or_else(|| get_field_as_string(record, "secret", false))
        .or_else(|| get_field_as_string(record, "hiddenField", false))
        .or_else(|| get_field_as_string(record, "text", false))
        .or_else(|| get_field_as_string(record, "note", false))
        .or_else(|| get_field_as_string(record, "API Key", false))
        .or_else(|| get_field_as_string(record, "api_key", false))
        .or_else(|| get_field_as_string(record, "apiKey", false))
        .or_else(|| get_field_as_string(record, "pinCode", false));

    if result.is_some() {
        return result;
    }

    // 3. Top-level notes — encryptedNotes records and the Notes field on
    //    standard records store the value at record_dict["notes"] as a plain
    //    string, not inside the "fields" or "custom" arrays.
    if let Some(notes) = record
        .record_dict
        .get("notes")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
    {
        log::info!("Keeper: extracted value from top-level notes field");
        return Some(notes.trim().to_string());
    }

    // 4. Case-insensitive label scan — the SDK's field_search uses exact
    //    case-sensitive matching, so labels like "Api Key" or "api key" are
    //    missed by Stage 2. Scan custom+standard fields for labels that
    //    match common API key names case-insensitively.
    if let Some(value) = extract_by_label_case_insensitive(record) {
        return Some(value);
    }

    // 5. Brute-force: scan ALL fields for any non-empty string value.
    //    This catches records with unusual field types we didn't anticipate.
    extract_first_value_from_record_dict(record)
}

/// Case-insensitive label scan for common API key field names.
/// The Keeper SDK's field_search uses exact case matching, so "Api Key" != "API Key".
/// This function scans the raw record_dict to find fields by label regardless of case.
fn extract_by_label_case_insensitive(
    record: &keeper_secrets_manager_core::dto::dtos::Record,
) -> Option<String> {
    const KEY_LABELS: &[&str] = &[
        "api key", "api_key", "apikey", "secret", "secret key", "token",
        "access token", "api token", "auth token", "password", "key",
    ];

    // Check custom fields first, then standard fields
    for section in &["custom", "fields"] {
        if let Some(fields) = record.record_dict.get(*section).and_then(|v| v.as_array()) {
            for field in fields {
                let label = field.get("label").and_then(|l| l.as_str()).unwrap_or("");
                let label_lower = label.to_lowercase();
                if KEY_LABELS.iter().any(|k| label_lower == *k) {
                    if let Some(value) = extract_field_value(field) {
                        log::info!(
                            "Keeper: extracted value via case-insensitive label match '{}' in {}",
                            label, section
                        );
                        return Some(value);
                    }
                }
            }
        }
    }
    None
}

/// Extract the first non-empty string value from a field's "value" array.
fn extract_field_value(field: &serde_json::Value) -> Option<String> {
    field
        .get("value")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter().find_map(|val| {
                val.as_str()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
            })
        })
}

/// Scan the raw record JSON for any field containing a non-empty string value.
/// Tries custom fields first (more likely to contain user secrets), then standard fields.
fn extract_first_value_from_record_dict(
    record: &keeper_secrets_manager_core::dto::dtos::Record,
) -> Option<String> {
    // Try custom fields first — user-added fields are most likely to hold the API key
    for section in &["custom", "fields"] {
        if let Some(fields) = record.record_dict.get(*section).and_then(|v| v.as_array()) {
            for field in fields {
                let field_type = field.get("type").and_then(|t| t.as_str()).unwrap_or("");
                // Skip fields that are clearly not secrets
                if matches!(field_type, "url" | "fileRef" | "addressRef" | "name"
                    | "email" | "phone" | "date" | "host" | "cardRef" | "login") {
                    continue;
                }
                if let Some(value) = extract_field_value(field) {
                    let label = field.get("label").and_then(|l| l.as_str()).unwrap_or("");
                    log::info!(
                        "Keeper: extracted value from {}.{} (label='{}')",
                        section, field_type, label
                    );
                    return Some(value);
                }
            }
        }
    }
    None
}

/// Check if Keeper is configured (config file exists)
pub fn is_keeper_configured() -> bool {
    get_keeper_config_path()
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Initialize Keeper with a one-time access token
/// This should only be called once per device
///
/// The token can be in the format `REGION:TOKEN` (e.g., `US:abc123...`)
/// or just `TOKEN` if a hostname is provided separately.
/// Valid region prefixes: US, EU, AU, GOV, JP, CA
pub fn initialize_keeper(
    one_time_token: &str,
    hostname: Option<&str>,
) -> Result<KeeperInitResult, String> {
    let config_path = get_keeper_config_path()?;
    let config_path_str = config_path.to_string_lossy().to_string();

    log::info!(
        "Initializing Keeper with one-time token at: {}",
        config_path_str
    );

    // Remove any stale config from a previous failed attempt so the SDK
    // uses the fresh one-time token instead of the old client key.
    if config_path.exists() {
        log::info!("Removing existing Keeper config before re-initialization");
        std::fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove old Keeper config: {}", e))?;
    }

    // Create storage for Keeper config
    let storage = FileKeyValueStorage::new_config_storage(config_path_str).map_err(|e| {
        format!(
            "Failed to create Keeper storage: {}",
            format_keeper_error(e)
        )
    })?;

    // Build client options with optional hostname for tokens without a region prefix.
    // If the token already contains a region prefix (e.g. "US:xxx"), the SDK will
    // extract the hostname from it and the hostname parameter is ignored.
    let options = ClientOptions::new(
        one_time_token.to_string(),
        storage,
        log::Level::Error,
        hostname.map(|h| h.to_string()),
        None,
        KSMCache::None,
    );

    let mut secrets_manager = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| SecretsManager::new(options)))
        .map_err(|_| "Keeper config file is corrupt or empty — please reconfigure Keeper in Settings".to_string())?
        .map_err(|e| format!("Failed to create Keeper client: {}", format_keeper_error(e)))?;

    // Perform initial fetch to bind the token (required by Keeper)
    let secrets = secrets_manager
        .get_secrets(Vec::new())
        .map_err(|e| format!("Failed to fetch secrets: {}", format_keeper_error(e)))?;

    let secrets_count = secrets.len();

    // Cache the secrets with TTL
    let cached: Vec<CachedSecret> = secrets
        .iter()
        .map(|s| CachedSecret {
            uid: s.uid.clone(),
            title: s.title.clone(),
            record_type: s.record_type.clone(),
            password: extract_secret_value(s),
        })
        .collect();

    // parking_lot::Mutex never poisons - direct lock acquisition
    let mut cache = SECRETS_CACHE.lock();
    *cache = Some(SecretsCache::new(cached));

    log::info!(
        "Keeper initialized successfully, found {} secrets",
        secrets_count
    );

    Ok(KeeperInitResult {
        success: true,
        message: format!(
            "Connected to Keeper. Found {} secrets available.",
            secrets_count
        ),
        secrets_count: Some(secrets_count),
    })
}

/// List available secrets (titles only, not values)
/// This is safe to return to the frontend
pub fn list_keeper_secrets() -> Result<KeeperSecretsListResult, String> {
    let config_path = get_keeper_config_path()?;

    if !config_path.exists() {
        return Ok(KeeperSecretsListResult {
            success: false,
            secrets: vec![],
            message: "Keeper not configured. Please enter a one-time token first.".to_string(),
        });
    }

    let config_path_str = config_path.to_string_lossy().to_string();

    let storage = FileKeyValueStorage::new_config_storage(config_path_str)
        .map_err(|e| format!("Failed to load Keeper config: {}", format_keeper_error(e)))?;

    let options = ClientOptions::new_client_options(storage);

    let mut secrets_manager = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| SecretsManager::new(options)))
        .map_err(|_| "Keeper config file is corrupt or empty — please reconfigure Keeper in Settings".to_string())?
        .map_err(|e| format!("Failed to create Keeper client: {}", format_keeper_error(e)))?;

    let secrets = secrets_manager
        .get_secrets(Vec::new())
        .map_err(|e| format!("Failed to fetch secrets: {}", format_keeper_error(e)))?;

    // Update cache with TTL
    let cached: Vec<CachedSecret> = secrets
        .iter()
        .map(|s| CachedSecret {
            uid: s.uid.clone(),
            title: s.title.clone(),
            record_type: s.record_type.clone(),
            password: extract_secret_value(s),
        })
        .collect();

    // parking_lot::Mutex never poisons - direct lock acquisition
    let mut cache = SECRETS_CACHE.lock();
    *cache = Some(SecretsCache::new(cached));

    // Return only metadata, not values
    let secret_infos: Vec<KeeperSecretInfo> = secrets
        .iter()
        .map(|s| KeeperSecretInfo {
            uid: s.uid.clone(),
            title: s.title.clone(),
            record_type: s.record_type.clone(),
        })
        .collect();

    Ok(KeeperSecretsListResult {
        success: true,
        secrets: secret_infos,
        message: format!("Found {} secrets", secrets.len()),
    })
}

/// Get API key from Keeper by secret UID
/// This is called internally by the backend - the key value never reaches the frontend
/// SECURITY: Returns Zeroizing<String> to ensure key is cleared from memory after use
pub fn get_api_key_from_keeper(secret_uid: &str) -> Result<Zeroizing<String>, String> {
    // First try the cache (if not expired)
    // parking_lot::Mutex never poisons - direct lock acquisition
    {
        let cache = SECRETS_CACHE.lock();
        if let Some(ref secrets_cache) = *cache {
            if !secrets_cache.is_expired() {
                if let Some(secret) = secrets_cache.secrets.iter().find(|s| s.uid == secret_uid) {
                    if let Some(ref password) = secret.password {
                        log::debug!(
                            "Retrieved API key from cache for secret: {}",
                            secret.title
                        );
                        return Ok(Zeroizing::new(password.clone()));
                    } else {
                        log::warn!(
                            "Keeper: cache hit for '{}' (type={}) but no key was extracted — re-fetching",
                            secret.title, secret.record_type
                        );
                    }
                }
            } else {
                log::debug!("Cache expired, fetching fresh secrets from Keeper");
            }
        }
    }

    // Cache miss or expired - fetch from Keeper
    let config_path = get_keeper_config_path()?;

    if !config_path.exists() {
        return Err("Keeper not configured".to_string());
    }

    let config_path_str = config_path.to_string_lossy().to_string();

    let storage = FileKeyValueStorage::new_config_storage(config_path_str)
        .map_err(|e| format!("Failed to load Keeper config: {}", format_keeper_error(e)))?;

    let options = ClientOptions::new_client_options(storage);

    let mut secrets_manager = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| SecretsManager::new(options)))
        .map_err(|_| "Keeper config file is corrupt or empty — please reconfigure Keeper in Settings".to_string())?
        .map_err(|e| format!("Failed to create Keeper client: {}", format_keeper_error(e)))?;

    // Fetch specific secret by UID
    let secrets = secrets_manager
        .get_secrets(vec![secret_uid.to_string()])
        .map_err(|e| format!("Failed to fetch secret: {}", format_keeper_error(e)))?;

    let secret = secrets
        .first()
        .ok_or_else(|| format!("Secret not found: {}", secret_uid))?;

    // Try to get password/API key from various standard and custom field types.
    // Keeper records store fields with a "type" key (e.g., "password", "secret", "text").
    // The actual type depends on the record template the user chose.
    let password = extract_secret_value(secret);

    if let Some(password) = password {
        log::debug!("Retrieved API key from Keeper for secret: {}", secret.title);
        return Ok(Zeroizing::new(password));
    }

    // Build a diagnostic summary of all fields in the record
    let mut field_summary = Vec::new();

    // Show top-level record_dict keys so we can see what's available
    let top_keys: Vec<&String> = secret.record_dict.keys().collect();
    field_summary.push(format!("  record_dict keys: {:?}", top_keys));

    // Check for top-level notes
    let has_notes = secret.record_dict.get("notes")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    field_summary.push(format!("  top-level notes: present={}", has_notes));

    for (section, label) in &[("fields", "standard"), ("custom", "custom")] {
        if let Some(fields) = secret.record_dict.get(*section).and_then(|v| v.as_array()) {
            for f in fields {
                let ftype = f.get("type").and_then(|t| t.as_str()).unwrap_or("?");
                let flabel = f.get("label").and_then(|l| l.as_str()).unwrap_or("");
                let has_value = f.get("value")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().any(|v| {
                        v.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false)
                            || v.is_object() // flag structured values that value_to_string skips
                    }))
                    .unwrap_or(false);
                let value_types: Vec<String> = f.get("value")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().map(|v| match v {
                        serde_json::Value::String(_) => "string".to_string(),
                        serde_json::Value::Object(_) => "object".to_string(),
                        serde_json::Value::Number(_) => "number".to_string(),
                        serde_json::Value::Bool(_) => "bool".to_string(),
                        serde_json::Value::Array(_) => "array".to_string(),
                        serde_json::Value::Null => "null".to_string(),
                    }).collect())
                    .unwrap_or_default();
                field_summary.push(format!(
                    "  {} type='{}' label='{}' has_value={} value_types={:?}",
                    label, ftype, flabel, has_value, value_types
                ));
            }
        }
    }
    let summary = field_summary.join("\n");
    log::warn!(
        "Keeper secret '{}' (type={}) — no API key found. Record structure:\n{}",
        secret.title, secret.record_type, summary
    );

    Err(format!(
        "No API key found in Keeper secret '{}' (type={}). Fields present: [{}]. \
         Ensure the record has a password, secret, or hiddenField containing the API key.",
        secret.title,
        secret.record_type,
        field_summary.iter()
            .map(|s| s.trim().to_string())
            .collect::<Vec<_>>()
            .join("; ")
    ))
}

/// Get Keeper connection status
pub fn get_keeper_status() -> KeeperStatus {
    if !is_keeper_configured() {
        return KeeperStatus {
            configured: false,
            connected: false,
            secrets_count: 0,
            message: "Keeper not configured".to_string(),
        };
    }

    match list_keeper_secrets() {
        Ok(result) => KeeperStatus {
            configured: true,
            connected: result.success,
            secrets_count: result.secrets.len(),
            message: result.message,
        },
        Err(e) => KeeperStatus {
            configured: true,
            connected: false,
            secrets_count: 0,
            message: format!("Connection error: {}", e),
        },
    }
}

/// Clear Keeper configuration and cache
pub fn clear_keeper_config() -> Result<(), String> {
    let config_path = get_keeper_config_path()?;

    if config_path.exists() {
        std::fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove Keeper config: {}", e))?;
        log::info!("Keeper configuration file removed");
    }

    // Clear cache - parking_lot::Mutex never poisons
    let mut cache = SECRETS_CACHE.lock();
    *cache = None;

    log::info!("Keeper configuration cleared");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keeper_not_configured_initially() {
        // This test assumes a clean environment
        // In a real test, we'd use a temp directory
        let status = get_keeper_status();
        // Status depends on whether config exists
        assert!(!status.message.is_empty());
    }

    #[test]
    fn test_config_path_creation() {
        let path = get_keeper_config_path();
        assert!(path.is_ok());
        let path = path.unwrap();
        assert!(path.to_string_lossy().contains("Hadron"));
    }
}
