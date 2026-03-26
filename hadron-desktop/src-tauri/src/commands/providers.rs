//! AI provider management commands (model listing, connection testing)

use crate::keeper_service;
use crate::model_fetcher::{
    list_models as fetch_models, test_connection as test_api_connection, ConnectionTestResult,
    Model,
};
use zeroize::Zeroizing;

/// Run a closure on a dedicated OS thread outside the tokio runtime.
/// The Keeper SDK uses `reqwest::blocking` which creates its own tokio runtime,
/// conflicting with Tauri's runtime if called from `spawn_blocking`.
async fn run_keeper_off_runtime<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let result = f();
        let _ = tx.send(result);
    });
    rx.await.map_err(|_| "Keeper thread panicked".to_string())
}

/// Resolve API key from either Keeper or the provided plaintext key.
async fn resolve_api_key(api_key: String, keeper_secret_uid: Option<String>) -> Result<Zeroizing<String>, String> {
    if let Some(ref uid) = keeper_secret_uid {
        log::info!("Fetching API key from Keeper for provider operation");
        let uid = uid.clone();
        run_keeper_off_runtime(move || keeper_service::get_api_key_from_keeper(&uid)).await?
            .map_err(|e| format!("Failed to get API key from Keeper: {}", e))
    } else {
        Ok(Zeroizing::new(api_key))
    }
}

/// List available models from AI provider
#[tauri::command]
pub async fn list_models(
    provider: String,
    api_key: String,
    keeper_secret_uid: Option<String>,
) -> Result<Vec<Model>, String> {
    log::debug!("cmd: list_models");
    let api_key = resolve_api_key(api_key, keeper_secret_uid).await?;
    log::info!("Fetching models: provider={}", provider);
    let models = fetch_models(&provider, api_key.as_str()).await?;
    log::info!("Fetched {} models from {}", models.len(), provider);
    Ok(models)
}

/// Test API connection by attempting to list models
#[tauri::command]
pub async fn test_connection(
    provider: String,
    api_key: String,
    keeper_secret_uid: Option<String>,
) -> Result<ConnectionTestResult, String> {
    log::debug!("cmd: test_connection");
    let api_key = resolve_api_key(api_key, keeper_secret_uid).await?;
    log::info!("Testing connection: provider={}", provider);
    let result = test_api_connection(&provider, api_key.as_str()).await?;
    log::info!(
        "Connection test: provider={}, success={}",
        provider,
        result.success
    );
    Ok(result)
}
