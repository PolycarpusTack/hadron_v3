//! AI provider management commands (model listing, connection testing)

use crate::model_fetcher::{
    list_models as fetch_models, test_connection as test_api_connection, ConnectionTestResult,
    Model,
};
use zeroize::Zeroizing;

/// List available models from AI provider
#[tauri::command]
pub async fn list_models(provider: String, api_key: String) -> Result<Vec<Model>, String> {
    log::debug!("cmd: list_models");
    let api_key = Zeroizing::new(api_key);
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
) -> Result<ConnectionTestResult, String> {
    log::debug!("cmd: test_connection");
    let api_key = Zeroizing::new(api_key);
    log::info!("Testing connection: provider={}", provider);
    let result = test_api_connection(&provider, api_key.as_str()).await?;
    log::info!(
        "Connection test: provider={}, success={}",
        provider,
        result.success
    );
    Ok(result)
}
