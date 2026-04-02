//! AI service — HTTP transport for OpenAI and Anthropic APIs.
//!
//! Types and prompts come from hadron_core::ai. This module handles
//! the actual HTTP calls (reqwest) and SSE stream parsing.

pub mod tools;

// Re-export core types so existing `use crate::ai::*` imports keep working
pub use hadron_core::ai::{AiConfig, AiMessage, AiProvider};
pub use hadron_core::ai::prompts::{
    CRASH_ANALYSIS_PROMPT, CHAT_SYSTEM_PROMPT, CODE_ANALYSIS_PROMPT,
};

use hadron_core::error::{HadronError, HadronResult};
use hadron_core::models::ChatStreamEvent;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

fn api_url(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::OpenAi => "https://api.openai.com/v1/chat/completions",
        AiProvider::Anthropic => "https://api.anthropic.com/v1/messages",
    }
}

/// Non-streaming AI completion.
pub async fn complete(
    config: &AiConfig,
    messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
) -> HadronResult<String> {
    let client = Client::new();

    match config.provider {
        AiProvider::OpenAi => {
            complete_openai(&client, config, messages, system_prompt).await
        }
        AiProvider::Anthropic => {
            complete_anthropic(&client, config, messages, system_prompt).await
        }
    }
}

/// Streaming AI completion — sends tokens to the provided channel.
pub async fn stream_completion(
    config: &AiConfig,
    messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
    tx: mpsc::Sender<ChatStreamEvent>,
) -> HadronResult<String> {
    let client = Client::new();

    match config.provider {
        AiProvider::OpenAi => {
            stream_openai(&client, config, messages, system_prompt, tx).await
        }
        AiProvider::Anthropic => {
            stream_anthropic(&client, config, messages, system_prompt, tx).await
        }
    }
}

// ============================================================================
// OpenAI
// ============================================================================

#[derive(Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<AiMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiStreamChunk {
    choices: Vec<OpenAiStreamChoice>,
}

#[derive(Deserialize)]
struct OpenAiStreamChoice {
    delta: OpenAiDelta,
}

#[derive(Deserialize)]
struct OpenAiDelta {
    content: Option<String>,
}

async fn complete_openai(
    client: &Client,
    config: &AiConfig,
    mut messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
) -> HadronResult<String> {
    if let Some(sys) = system_prompt {
        messages.insert(
            0,
            AiMessage {
                role: "system".to_string(),
                content: sys.to_string(),
            },
        );
    }

    let body = OpenAiRequest {
        model: config.model.clone(),
        messages,
        stream: false,
        max_tokens: Some(4096),
    };

    let resp = client
        .post(api_url(AiProvider::OpenAi))
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| HadronError::AiService(format!("OpenAI request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(HadronError::AiService(format!(
            "OpenAI API error {status}: {text}"
        )));
    }

    let data: OpenAiResponse = resp
        .json()
        .await
        .map_err(|e| HadronError::AiService(format!("OpenAI parse error: {e}")))?;

    data.choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| HadronError::AiService("Empty response from OpenAI".into()))
}

async fn stream_openai(
    client: &Client,
    config: &AiConfig,
    mut messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
    tx: mpsc::Sender<ChatStreamEvent>,
) -> HadronResult<String> {
    if let Some(sys) = system_prompt {
        messages.insert(
            0,
            AiMessage {
                role: "system".to_string(),
                content: sys.to_string(),
            },
        );
    }

    let body = OpenAiRequest {
        model: config.model.clone(),
        messages,
        stream: true,
        max_tokens: Some(4096),
    };

    let resp = client
        .post(api_url(AiProvider::OpenAi))
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| HadronError::AiService(format!("OpenAI stream failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(HadronError::AiService(format!(
            "OpenAI API error {status}: {text}"
        )));
    }

    let mut full_content = String::new();
    let mut stream = resp.bytes_stream();

    use futures::StreamExt;
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|e| HadronError::AiService(format!("Stream read error: {e}")))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process SSE lines
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    break;
                }
                if let Ok(chunk) = serde_json::from_str::<OpenAiStreamChunk>(data) {
                    if let Some(content) = chunk
                        .choices
                        .first()
                        .and_then(|c| c.delta.content.as_ref())
                    {
                        full_content.push_str(content);
                        let _ = tx
                            .send(ChatStreamEvent::Token {
                                content: content.clone(),
                            })
                            .await;
                    }
                }
            }
        }
    }

    Ok(full_content)
}

// ============================================================================
// Anthropic
// ============================================================================

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<AiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    stream: bool,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    delta: Option<AnthropicDelta>,
}

#[derive(Deserialize)]
struct AnthropicDelta {
    text: Option<String>,
}

async fn complete_anthropic(
    client: &Client,
    config: &AiConfig,
    messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
) -> HadronResult<String> {
    let body = AnthropicRequest {
        model: config.model.clone(),
        max_tokens: 4096,
        messages,
        system: system_prompt.map(|s| s.to_string()),
        stream: false,
    };

    let resp = client
        .post(api_url(AiProvider::Anthropic))
        .header("x-api-key", &config.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| HadronError::AiService(format!("Anthropic request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(HadronError::AiService(format!(
            "Anthropic API error {status}: {text}"
        )));
    }

    let data: AnthropicResponse = resp
        .json()
        .await
        .map_err(|e| HadronError::AiService(format!("Anthropic parse error: {e}")))?;

    data.content
        .first()
        .and_then(|c| c.text.clone())
        .ok_or_else(|| HadronError::AiService("Empty response from Anthropic".into()))
}

async fn stream_anthropic(
    client: &Client,
    config: &AiConfig,
    messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
    tx: mpsc::Sender<ChatStreamEvent>,
) -> HadronResult<String> {
    let body = AnthropicRequest {
        model: config.model.clone(),
        max_tokens: 4096,
        messages,
        system: system_prompt.map(|s| s.to_string()),
        stream: true,
    };

    let resp = client
        .post(api_url(AiProvider::Anthropic))
        .header("x-api-key", &config.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| HadronError::AiService(format!("Anthropic stream failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(HadronError::AiService(format!(
            "Anthropic API error {status}: {text}"
        )));
    }

    let mut full_content = String::new();
    let mut stream = resp.bytes_stream();

    use futures::StreamExt;
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|e| HadronError::AiService(format!("Stream read error: {e}")))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.starts_with("data: ") {
                let data = &line[6..];
                if let Ok(event) = serde_json::from_str::<AnthropicStreamEvent>(data) {
                    if event.event_type == "content_block_delta" {
                        if let Some(text) =
                            event.delta.and_then(|d| d.text)
                        {
                            full_content.push_str(&text);
                            let _ = tx
                                .send(ChatStreamEvent::Token {
                                    content: text,
                                })
                                .await;
                        }
                    }
                }
            }
        }
    }

    Ok(full_content)
}
