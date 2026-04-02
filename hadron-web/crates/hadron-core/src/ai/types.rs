//! Transport-agnostic AI types shared between hadron-core and hadron-server.

use serde::{Deserialize, Serialize};

/// AI provider selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiProvider {
    OpenAi,
    Anthropic,
}

impl AiProvider {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "anthropic" | "claude" => AiProvider::Anthropic,
            _ => AiProvider::OpenAi,
        }
    }
}

impl std::fmt::Display for AiProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AiProvider::OpenAi => write!(f, "openai"),
            AiProvider::Anthropic => write!(f, "anthropic"),
        }
    }
}

/// A message in an AI conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

/// Configuration for an AI API call.
#[derive(Debug, Clone)]
pub struct AiConfig {
    pub provider: AiProvider,
    pub api_key: String,
    pub model: String,
}
