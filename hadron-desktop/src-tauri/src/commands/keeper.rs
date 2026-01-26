//! Keeper integration commands

use crate::keeper_service;

/// Initialize Keeper with one-time access token
#[tauri::command]
pub async fn initialize_keeper(token: String) -> Result<keeper_service::KeeperInitResult, String> {
    log::info!("Initializing Keeper with one-time token");
    // Keeper SDK may perform blocking I/O - run in blocking thread pool
    let token_clone = token.clone();
    tauri::async_runtime::spawn_blocking(move || keeper_service::initialize_keeper(token_clone))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// List secrets from Keeper vault
#[tauri::command]
pub async fn list_keeper_secrets() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::info!("Listing Keeper secrets");
    // Keeper SDK may perform blocking I/O - run in blocking thread pool
    tauri::async_runtime::spawn_blocking(keeper_service::list_keeper_secrets)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// Get Keeper status
#[tauri::command]
pub async fn get_keeper_status() -> Result<keeper_service::KeeperStatus, String> {
    keeper_service::get_keeper_status()
}

/// Clear Keeper configuration
#[tauri::command]
pub async fn clear_keeper_config() -> Result<(), String> {
    log::info!("Clearing Keeper configuration");
    keeper_service::clear_keeper_config()
}

/// Test Keeper connection
#[tauri::command]
pub async fn test_keeper_connection() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::info!("Testing Keeper connection");
    // Keeper SDK may perform blocking I/O - run in blocking thread pool
    tauri::async_runtime::spawn_blocking(keeper_service::list_keeper_secrets)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}
