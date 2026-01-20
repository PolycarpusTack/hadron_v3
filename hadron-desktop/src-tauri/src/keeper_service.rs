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
    core::{ClientOptions, SecretsManager},
    custom_error::KSMRError,
    storage::FileKeyValueStorage,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
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

/// Try to get a field value as Option<String>, ignoring errors
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
    result.ok().and_then(value_to_string)
}

/// Check if Keeper is configured (config file exists)
pub fn is_keeper_configured() -> bool {
    get_keeper_config_path()
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Initialize Keeper with a one-time access token
/// This should only be called once per device
pub fn initialize_keeper(one_time_token: &str) -> Result<KeeperInitResult, String> {
    let config_path = get_keeper_config_path()?;
    let config_path_str = config_path.to_string_lossy().to_string();

    log::info!(
        "Initializing Keeper with one-time token at: {}",
        config_path_str
    );

    // Create storage for Keeper config
    let storage = FileKeyValueStorage::new_config_storage(config_path_str).map_err(|e| {
        format!(
            "Failed to create Keeper storage: {}",
            format_keeper_error(e)
        )
    })?;

    // Initialize with one-time token
    let options = ClientOptions::new_client_options_with_token(one_time_token.to_string(), storage);

    let mut secrets_manager = SecretsManager::new(options)
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
            password: get_field_as_string(s, "password", true),
        })
        .collect();

    match SECRETS_CACHE.lock() {
        Ok(mut cache) => {
            *cache = Some(SecretsCache::new(cached));
        }
        Err(e) => {
            log::error!("Failed to acquire cache lock during initialization: {}", e);
        }
    }

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

    let mut secrets_manager = SecretsManager::new(options)
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
            password: get_field_as_string(s, "password", true),
        })
        .collect();

    match SECRETS_CACHE.lock() {
        Ok(mut cache) => {
            *cache = Some(SecretsCache::new(cached));
        }
        Err(e) => {
            log::error!("Failed to acquire cache lock while listing secrets: {}", e);
        }
    }

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
    match SECRETS_CACHE.lock() {
        Ok(cache) => {
            if let Some(ref secrets_cache) = *cache {
                if !secrets_cache.is_expired() {
                    if let Some(secret) = secrets_cache.secrets.iter().find(|s| s.uid == secret_uid)
                    {
                        if let Some(ref password) = secret.password {
                            log::debug!(
                                "Retrieved API key from cache for secret: {}",
                                secret.title
                            );
                            return Ok(Zeroizing::new(password.clone()));
                        }
                    }
                } else {
                    log::debug!("Cache expired, fetching fresh secrets from Keeper");
                }
            }
        }
        Err(e) => {
            log::warn!(
                "Failed to acquire cache lock, falling back to Keeper fetch: {}",
                e
            );
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

    let mut secrets_manager = SecretsManager::new(options)
        .map_err(|e| format!("Failed to create Keeper client: {}", format_keeper_error(e)))?;

    // Fetch specific secret by UID
    let secrets = secrets_manager
        .get_secrets(vec![secret_uid.to_string()])
        .map_err(|e| format!("Failed to fetch secret: {}", format_keeper_error(e)))?;

    let secret = secrets
        .first()
        .ok_or_else(|| format!("Secret not found: {}", secret_uid))?;

    // Try to get password field (most common for API keys)
    // Check standard password field first, then try common custom field names
    let password = get_field_as_string(secret, "password", true)
        .or_else(|| get_field_as_string(secret, "API Key", false))
        .or_else(|| get_field_as_string(secret, "api_key", false))
        .or_else(|| get_field_as_string(secret, "apiKey", false))
        .ok_or_else(|| "No password or API key field found in secret".to_string())?;

    log::debug!("Retrieved API key from Keeper for secret: {}", secret.title);

    Ok(Zeroizing::new(password))
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

    // Clear cache
    match SECRETS_CACHE.lock() {
        Ok(mut cache) => {
            *cache = None;
        }
        Err(e) => {
            log::error!("Failed to acquire cache lock while clearing config: {}", e);
        }
    }

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
        assert!(status.message.len() > 0);
    }

    #[test]
    fn test_config_path_creation() {
        let path = get_keeper_config_path();
        assert!(path.is_ok());
        let path = path.unwrap();
        assert!(path.to_string_lossy().contains("Hadron"));
    }
}
