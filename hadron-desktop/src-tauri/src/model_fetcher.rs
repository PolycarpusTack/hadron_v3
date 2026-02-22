use reqwest::Client;
use serde::{Deserialize, Serialize};

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
        "llamacpp" => list_llamacpp_models(&client).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Test API connection by attempting to list models
pub async fn test_connection(
    provider: &str,
    api_key: &str,
) -> Result<ConnectionTestResult, String> {
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

    // Curated list of model prefixes suited for Hadron's use case
    // (crash analysis, code review, release notes — needs strong reasoning + large context).
    // This avoids showing dozens of dated variants like gpt-4-0613, gpt-4-0314, etc.
    let curated_prefixes: Vec<&str> = vec![
        "gpt-4.1",         // GPT-4.1 family (recommended)
        "gpt-4o",          // GPT-4o family (fast)
        "gpt-4-turbo",     // GPT-4 Turbo
        "gpt-5",           // Future GPT-5
        "o3",              // o3 reasoning
        "o4",              // o4 reasoning
    ];

    let filtered_models: Vec<Model> = models_response
        .data
        .into_iter()
        .filter(|m| {
            let id = m.id.to_lowercase();

            // Must match one of our curated prefixes
            let is_curated = curated_prefixes.iter().any(|prefix| id.starts_with(prefix));

            // Exclude non-chat models even if they match a prefix
            let excluded = id.contains("instruct") ||
                id.contains("embedding") ||
                id.contains("audio") ||
                id.contains("tts") ||
                id.contains("realtime") ||
                id.contains("vision") ||
                id.contains("search") ||
                id.starts_with("ft:");

            is_curated && !excluded
        })
        .map(|m| {
            let id_lower = m.id.to_lowercase();

            // Determine context window
            let context = if id_lower.starts_with("gpt-4.1") {
                Some(1047576) // 1M tokens
            } else if id_lower.starts_with("o3") || id_lower.starts_with("o4") {
                Some(200000)
            } else if id_lower.contains("gpt-4o")
                || id_lower.contains("gpt-4-turbo")
                || id_lower.contains("gpt-5")
            {
                Some(128000)
            } else {
                Some(128000) // Default for newer models
            };

            // Categorize for UI display
            let category = if id_lower.starts_with("o3") || id_lower.starts_with("o4") {
                "reasoning"
            } else if id_lower.contains("mini") || id_lower.contains("nano") {
                "fast"
            } else if id_lower.starts_with("gpt-4.1") {
                "recommended"
            } else if id_lower.contains("gpt-5") {
                "latest"
            } else if id_lower.contains("gpt-4o") {
                "fast"
            } else {
                "standard"
            };

            Model {
                id: m.id.clone(),
                label: format_openai_model_label(&m.id),
                context,
                category: Some(category.to_string()),
            }
        })
        .collect();

    // Sort: recommended first, then by name
    let mut sorted = filtered_models;
    sorted.sort_by(|a, b| {
        let cat_order = |cat: &Option<String>| match cat.as_deref() {
            Some("recommended") => 0,
            Some("latest") => 1,
            Some("reasoning") => 2,
            Some("fast") => 3,
            _ => 4,
        };
        cat_order(&a.category)
            .cmp(&cat_order(&b.category))
            .then_with(|| b.id.cmp(&a.id)) // Newer versions first (descending)
    });

    Ok(sorted)
}

/// Format OpenAI model ID to friendly label with category hint
fn format_openai_model_label(id: &str) -> String {
    let id_lower = id.to_lowercase();

    let suffix = if id_lower.starts_with("o3") || id_lower.starts_with("o4") {
        if id_lower.contains("mini") { " (Reasoning/Cheap)" } else { " (Reasoning)" }
    } else if id_lower.starts_with("gpt-4.1") {
        if id_lower.contains("nano") {
            " (Cheapest)"
        } else if id_lower.contains("mini") {
            " (Fast)"
        } else {
            " (Recommended)"
        }
    } else if id_lower.contains("gpt-4o-mini") {
        " (Fast/Cheap)"
    } else if id_lower.contains("gpt-4o") {
        " (Fast)"
    } else if id_lower.contains("gpt-4-turbo") {
        " (Standard)"
    } else if id_lower.contains("gpt-5") {
        " (Latest)"
    } else {
        ""
    };

    format!("{}{}", format_model_label(id), suffix)
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

    // Curated Anthropic model prefixes suited for Hadron
    let curated_prefixes: Vec<&str> = vec![
        "claude-sonnet-4",
        "claude-opus-4",
        "claude-3-5-sonnet",
        "claude-3-5-haiku",
        "claude-3-opus",
        "claude-3-haiku",
    ];

    let mut filtered_models: Vec<Model> = models_response
        .data
        .into_iter()
        .filter(|m| {
            curated_prefixes.iter().any(|prefix| m.id.starts_with(prefix))
        })
        .map(|m| {
            let category = if m.id.contains("haiku") {
                "fast"
            } else if m.id.starts_with("claude-sonnet-4") && !m.id.contains("4.5") {
                "recommended"
            } else if m.id.contains("opus") {
                "reasoning"
            } else {
                "standard"
            };
            Model {
                label: m.display_name.unwrap_or_else(|| format_model_label(&m.id)),
                id: m.id,
                context: Some(200000),
                category: Some(category.to_string()),
            }
        })
        .collect();

    // Sort: recommended first
    filtered_models.sort_by(|a, b| {
        let cat_order = |cat: &Option<String>| match cat.as_deref() {
            Some("recommended") => 0,
            Some("latest") => 1,
            Some("reasoning") => 2,
            Some("fast") => 3,
            _ => 4,
        };
        cat_order(&a.category).cmp(&cat_order(&b.category))
    });

    if filtered_models.is_empty() {
        return Ok(get_anthropic_fallback_models());
    }

    Ok(filtered_models)
}

fn get_anthropic_fallback_models() -> Vec<Model> {
    vec![
        Model {
            id: "claude-sonnet-4-20250514".to_string(),
            label: "Claude Sonnet 4 (Recommended)".to_string(),
            context: Some(200000),
            category: Some("recommended".to_string()),
        },
        Model {
            id: "claude-sonnet-4-5-20250514".to_string(),
            label: "Claude Sonnet 4.5".to_string(),
            context: Some(200000),
            category: Some("latest".to_string()),
        },
        Model {
            id: "claude-opus-4-20250514".to_string(),
            label: "Claude Opus 4".to_string(),
            context: Some(200000),
            category: Some("reasoning".to_string()),
        },
        Model {
            id: "claude-3-5-sonnet-20241022".to_string(),
            label: "Claude 3.5 Sonnet".to_string(),
            context: Some(200000),
            category: Some("standard".to_string()),
        },
        Model {
            id: "claude-3-5-haiku-20241022".to_string(),
            label: "Claude 3.5 Haiku (Fast/Cheap)".to_string(),
            context: Some(200000),
            category: Some("fast".to_string()),
        },
        Model {
            id: "claude-3-opus-20240229".to_string(),
            label: "Claude 3 Opus".to_string(),
            context: Some(200000),
            category: Some("standard".to_string()),
        },
        Model {
            id: "claude-3-haiku-20240307".to_string(),
            label: "Claude 3 Haiku (Fast/Cheap)".to_string(),
            context: Some(200000),
            category: Some("fast".to_string()),
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

    // If API call fails or returns error status, use fallback list
    let response = match response {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(get_zai_fallback_models()),
    };

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
            let filtered_models: Vec<Model> = resp
                .data
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
        }
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

// -------- llama.cpp (local) --------
#[derive(Deserialize)]
struct LlamaCppModelsResponse {
    data: Vec<LlamaCppModel>,
}

#[derive(Deserialize)]
struct LlamaCppModel {
    id: String,
}

async fn list_llamacpp_models(client: &Client) -> Result<Vec<Model>, String> {
    // llama-server exposes an OpenAI-compatible /v1/models endpoint
    let url = "http://127.0.0.1:8080/v1/models";

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to llama-server at {}: {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!("llama-server responded with status {}", resp.status()));
    }

    let body: LlamaCppModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse llama-server response: {}", e))?;

    let models = body
        .data
        .into_iter()
        .map(|m| Model {
            id: m.id.clone(),
            label: format_model_label(&m.id),
            context: None,
            category: Some("chat".to_string()),
        })
        .collect::<Vec<_>>();

    Ok(models)
}
