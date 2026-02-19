//! Keeper integration commands
//!
//! The Keeper SDK uses `reqwest::blocking` internally, which creates its own
//! tokio runtime. This conflicts with Tauri's async tokio runtime if called
//! from `spawn_blocking` (still inside the runtime context). To avoid the
//! "Cannot drop a runtime in a context where blocking is not allowed" panic,
//! all Keeper SDK calls are dispatched on a plain OS thread via
//! `std::thread::spawn`, completely outside tokio.

use crate::keeper_service;
use tokio::sync::oneshot;

/// Run a closure on a dedicated OS thread outside the tokio runtime.
/// Returns the closure's result via a oneshot channel.
async fn run_off_runtime<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = oneshot::channel();
    std::thread::spawn(move || {
        let result = f();
        let _ = tx.send(result);
    });
    rx.await.map_err(|_| "Keeper task was cancelled".to_string())
}

/// Initialize Keeper with one-time access token
///
/// The token can include a region prefix (e.g., "US:TOKEN") or be a plain token.
/// If no prefix is present, `hostname` must be provided (e.g., "keepersecurity.com").
#[tauri::command]
pub async fn initialize_keeper(
    token: String,
    hostname: Option<String>,
) -> Result<keeper_service::KeeperInitResult, String> {
    log::info!("Initializing Keeper with one-time token");
    run_off_runtime(move || {
        keeper_service::initialize_keeper(&token, hostname.as_deref())
    })
    .await?
}

/// List secrets from Keeper vault
#[tauri::command]
pub async fn list_keeper_secrets() -> Result<keeper_service::KeeperSecretsListResult, String> {
    log::info!("Listing Keeper secrets");
    run_off_runtime(keeper_service::list_keeper_secrets).await?
}

/// Get Keeper status
#[tauri::command]
pub async fn get_keeper_status() -> Result<keeper_service::KeeperStatus, String> {
    // get_keeper_status internally calls list_keeper_secrets which uses the SDK,
    // so it must also run off the tokio runtime.
    run_off_runtime(|| Ok(keeper_service::get_keeper_status())).await?
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
    run_off_runtime(keeper_service::list_keeper_secrets).await?
}
