use serde::{Deserialize, Serialize};
use reqwest::Client;

#[derive(Debug, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub label: String,
    pub context: Option<i32>,
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub message: String,
    pub models_count: Option<usize>,
}

/// List available models from the specified AI provider
pub async fn list_models(provider: &str, api_key: &str) -> Result<Vec<Model>, String> {
    let client = Client::new();

    match provider {
        "openai" => list_openai_models(&client, api_key).await,
        "anthropic" => list_anthropic_models(&client, api_key).await,
        "zai" => list_zai_models(&client, api_key).await,
        "ollama" => list_ollama_models(&client).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Test API connection by attempting to list models
pub async fn test_connection(provider: &str, api_key: &str) -> Result<ConnectionTestResult, String> {
    match list_models(provider, api_key).await {
        Ok(models) => Ok(ConnectionTestResult {
            success: true,
            message: format!("✅ Connection successful! Found {} models", models.len()),
            models_count: Some(models.len()),
        }),
        Err(e) => Ok(ConnectionTestResult {
            success: false,
            message: format!("❌ Connection failed: {}", e),
            models_count: None,
        }),
    }
}

async fn list_openai_models(client: &Client, api_key: &str) -> Result<Vec<Model>, String> {
    #[derive(Deserialize)]
    struct OpenAIModelsResponse {
        data: Vec<OpenAIModel>,
    }

    #[derive(Deserialize)]
    struct OpenAIModel {
        id: String,
    }

    let response = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    let models_response: OpenAIModelsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Filter to chat-capable models
    let filtered_models: Vec<Model> = models_response.data
        .into_iter()
        .filter(|m| {
            m.id.starts_with("gpt-") &&
            !m.id.contains("instruct") &&
            !m.id.contains("embedding") &&
            !m.id.contains("audio") &&
            !m.id.contains("tts") &&
            !m.id.contains("whisper")
        })
        .map(|m| {
            let context = if m.id.contains("gpt-4-turbo") || m.id.contains("gpt-5") {
                Some(128000)
            } else if m.id.contains("gpt-4") {
                Some(8192)
            } else if m.id.contains("gpt-3.5-turbo") {
                Some(16384)
            } else {
                None
            };

            Model {
                id: m.id.clone(),
                label: format_model_label(&m.id),
                context,
                category: Some("chat".to_string()),
            }
        })
        .collect();

    Ok(filtered_models)
}

async fn list_anthropic_models(client: &Client, api_key: &str) -> Result<Vec<Model>, String> {
    #[derive(Deserialize)]
    struct AnthropicModelsResponse {
        data: Vec<AnthropicModel>,
    }

    #[derive(Deserialize)]
    struct AnthropicModel {
        id: String,
        display_name: Option<String>,
    }

    let response = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {}", e))?;

    if !response.status().is_success() {
        // Anthropic might not have /models endpoint yet, return curated list
        return Ok(get_anthropic_fallback_models());
    }

    let models_response: AnthropicModelsResponse = response
        .json()
        .await
        .unwrap_or_else(|_| AnthropicModelsResponse { data: vec![] });

    if models_response.data.is_empty() {
        return Ok(get_anthropic_fallback_models());
    }

    let filtered_models: Vec<Model> = models_response.data
        .into_iter()
        .filter(|m| m.id.starts_with("claude-"))
        .map(|m| Model {
            id: m.id.clone(),
            label: m.display_name.unwrap_or_else(|| format_model_label(&m.id)),
            context: Some(200000),
            category: Some("chat".to_string()),
        })
        .collect();

    Ok(filtered_models)
}

fn get_anthropic_fallback_models() -> Vec<Model> {
    vec![
        Model {
            id: "claude-sonnet-4.5".to_string(),
            label: "Claude Sonnet 4.5".to_string(),
            context: Some(200000),
            category: Some("chat".to_string()),
        },
        Model {
            id: "claude-3-5-sonnet-20241022".to_string(),
            label: "Claude 3.5 Sonnet".to_string(),
            context: Some(200000),
            category: Some("chat".to_string()),
        },
        Model {
            id: "claude-3-opus-20240229".to_string(),
            label: "Claude 3 Opus".to_string(),
            context: Some(200000),
            category: Some("chat".to_string()),
        },
        Model {
            id: "claude-3-haiku-20240307".to_string(),
            label: "Claude 3 Haiku".to_string(),
            context: Some(200000),
            category: Some("chat".to_string()),
        },
    ]
}

async fn list_zai_models(client: &Client, api_key: &str) -> Result<Vec<Model>, String> {
    // Z.ai uses OpenAI-compatible API
    // NOTE: Z.ai endpoint inconsistency - This uses api.z.ai for model listing,
    // while ai_service.rs uses open.bigmodel.cn for chat completions. Consider
    // unifying to a single endpoint domain to reduce provider-specific surprises.
    let response = client
        .get("https://api.z.ai/api/paas/v4/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await;

    // If API call fails, return fallback list
    if response.is_err() {
        return Ok(get_zai_fallback_models());
    }

    let response = response.unwrap();
    if !response.status().is_success() {
        return Ok(get_zai_fallback_models());
    }

    // Try to parse as OpenAI-compatible response
    #[derive(Deserialize)]
    struct ModelsResponse {
        data: Vec<ModelData>,
    }

    #[derive(Deserialize)]
    struct ModelData {
        id: String,
    }

    let models_response: Result<ModelsResponse, _> = response.json().await;

    match models_response {
        Ok(resp) => {
            let filtered_models: Vec<Model> = resp.data
                .into_iter()
                .filter(|m| m.id.starts_with("glm-"))
                .map(|m| Model {
                    id: m.id.clone(),
                    label: format_model_label(&m.id),
                    context: Some(200000),
                    category: Some("chat".to_string()),
                })
                .collect();

            if filtered_models.is_empty() {
                Ok(get_zai_fallback_models())
            } else {
                Ok(filtered_models)
            }
        },
        Err(_) => Ok(get_zai_fallback_models()),
    }
}

fn get_zai_fallback_models() -> Vec<Model> {
    vec![
        Model {
            id: "glm-4.6".to_string(),
            label: "GLM-4.6".to_string(),
            context: Some(200000),
            category: Some("chat".to_string()),
        },
        Model {
            id: "glm-4".to_string(),
            label: "GLM-4".to_string(),
            context: Some(128000),
            category: Some("chat".to_string()),
        },
    ]
}

fn format_model_label(id: &str) -> String {
    // Convert model ID to friendly label
    id.replace('-', " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// -------- Ollama (local) --------
#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

async fn list_ollama_models(client: &Client) -> Result<Vec<Model>, String> {
    // Default local endpoint
    let url = "http://127.0.0.1:11434/api/tags";

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama at {}: {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama responded with status {}", resp.status()));
    }

    let body: OllamaTagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let models = body.models
        .into_iter()
        .map(|m| Model {
            id: m.name.clone(),
            label: m.name,
            context: None,
            category: Some("chat".to_string()),
        })
        .collect::<Vec<_>>();

    Ok(models)
}
