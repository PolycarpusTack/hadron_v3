//! Chat tool definitions and execution.
//!
//! Provides tools the AI can call during chat: search_analyses, get_analysis_detail,
//! search_knowledge_base.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db;

/// A tool the AI can call.
#[derive(Debug, Clone, Serialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Result of executing a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_name: String,
    pub content: String,
}

/// Get the list of tools available during chat.
pub fn chat_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "search_analyses".to_string(),
            description: "Search the user's crash analyses by text query. Returns matching analysis summaries.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query text"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results to return (default 5)"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "get_analysis_detail".to_string(),
            description: "Get the full details of a specific analysis by ID.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "analysis_id": {
                        "type": "integer",
                        "description": "The analysis ID to retrieve"
                    }
                },
                "required": ["analysis_id"]
            }),
        },
        ToolDefinition {
            name: "search_knowledge_base".to_string(),
            description: "Search the knowledge base of past analyses using semantic similarity. Useful for finding similar crashes.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Semantic search query describing the issue"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 5)"
                    }
                },
                "required": ["query"]
            }),
        },
    ]
}

/// Execute a tool call and return the result as a string.
pub async fn execute_tool(
    pool: &PgPool,
    user_id: Uuid,
    tool_name: &str,
    args: &serde_json::Value,
) -> Result<String, String> {
    match tool_name {
        "search_analyses" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(5);

            match db::search_analyses(pool, user_id, query, limit).await {
                Ok(results) => serde_json::to_string_pretty(&results)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("Search failed: {}", e.client_message())),
            }
        }
        "get_analysis_detail" => {
            let id = args
                .get("analysis_id")
                .and_then(|v| v.as_i64())
                .ok_or("analysis_id is required")?;

            match db::get_analysis_by_id(pool, id, user_id).await {
                Ok(analysis) => serde_json::to_string_pretty(&analysis)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("Failed to get analysis: {}", e.client_message())),
            }
        }
        "search_knowledge_base" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(5);

            // Use text search as a fallback since we don't have an embedding for the query
            match db::search_analyses(pool, user_id, query, limit).await {
                Ok(results) => serde_json::to_string_pretty(&results)
                    .map_err(|e| e.to_string()),
                Err(e) => Err(format!("Knowledge base search failed: {}", e.client_message())),
            }
        }
        _ => Err(format!("Unknown tool: {tool_name}")),
    }
}
