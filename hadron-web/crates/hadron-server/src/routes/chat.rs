//! Chat handlers — sessions, messages, streaming.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use hadron_core::error::HadronError;
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::ai::{self, AiConfig, AiMessage, AiProvider};
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::sse;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

pub async fn list_chat_sessions(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let sessions = db::get_chat_sessions(&state.db, user.user.id).await?;
    Ok(Json(sessions))
}

#[derive(Deserialize)]
pub struct CreateSessionRequest {
    title: Option<String>,
}

pub async fn create_chat_session(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<impl IntoResponse, AppError> {
    let title = req.title.as_deref().unwrap_or("New Chat");
    let session = db::create_chat_session(&state.db, user.user.id, title).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

pub async fn get_chat_messages(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let messages = db::get_chat_messages(&state.db, &id, user.user.id).await?;
    Ok(Json(messages))
}

pub async fn chat_send(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Create or use existing session (verify ownership for existing sessions)
    let session_id = match req.session_id {
        Some(id) => {
            // Verify the session belongs to this user
            let sessions = db::get_chat_sessions(&state.db, user.user.id).await?;
            if !sessions.iter().any(|s| s.id == id) {
                return Err(AppError(HadronError::forbidden(
                    "Chat session not found or not owned by you",
                )));
            }
            id
        }
        None => {
            let title = req
                .messages
                .first()
                .map(|m| {
                    let t = &m.content;
                    if t.len() > 50 {
                        // Find valid UTF-8 char boundary to avoid panic on multi-byte chars
                        let mut end = 50;
                        while end > 0 && !t.is_char_boundary(end) {
                            end -= 1;
                        }
                        format!("{}...", &t[..end])
                    } else {
                        t.clone()
                    }
                })
                .unwrap_or_else(|| "New Chat".to_string());
            let session =
                db::create_chat_session(&state.db, user.user.id, &title).await?;
            session.id
        }
    };

    // Save user message
    if let Some(last_msg) = req.messages.last() {
        db::save_chat_message(&state.db, &session_id, &last_msg.role, &last_msg.content).await?;
    }

    // Create SSE channel
    let (tx, rx) = mpsc::channel::<ChatStreamEvent>(100);

    // Build AI config — prefer request key, fall back to server-side config
    let ai_config = if let Some(ref key) = req.api_key {
        if !key.is_empty() {
            AiConfig {
                provider: AiProvider::from_str(req.provider.as_deref().unwrap_or("openai")),
                api_key: key.clone(),
                model: req.model.unwrap_or_else(|| "gpt-4o".to_string()),
            }
        } else {
            db::get_server_ai_config(&state.db)
                .await
                .map_err(AppError::from)?
                .ok_or_else(|| AppError(HadronError::validation(
                    "No AI configuration available. Ask an admin to configure API keys, or provide your own.",
                )))?
        }
    } else {
        db::get_server_ai_config(&state.db)
            .await
            .map_err(AppError::from)?
            .ok_or_else(|| AppError(HadronError::validation(
                "No AI configuration available. Ask an admin to configure API keys, or provide your own.",
            )))?
    };

    // Convert messages
    let ai_messages: Vec<AiMessage> = req
        .messages
        .iter()
        .map(|m| AiMessage {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect();

    // Build system prompt with tool awareness
    let tools = crate::ai::tools::chat_tools();
    let tool_descriptions: Vec<String> = tools
        .iter()
        .map(|t| format!("- {}: {}", t.name, t.description))
        .collect();
    let system_prompt = format!(
        "{}\n\nYou have access to these tools:\n{}\n\nTo use a tool, respond with a JSON block: {{\"tool_use\": {{\"name\": \"tool_name\", \"arguments\": {{...}}}}}}.\nAfter receiving tool results, incorporate them into your response to the user.",
        ai::CHAT_SYSTEM_PROMPT,
        tool_descriptions.join("\n")
    );

    // Spawn streaming AI call
    let pool = state.db.clone();
    let sid = session_id.clone();
    let tx_clone = tx.clone();
    let user_id = user.user.id;

    tokio::spawn(async move {
        match ai::stream_completion(&ai_config, ai_messages, Some(&system_prompt), tx_clone.clone())
            .await
        {
            Ok(full_content) => {
                // Check if the response contains a tool_use request
                if let Some(tool_call) = extract_tool_call(&full_content) {
                    let _ = tx_clone
                        .send(ChatStreamEvent::ToolUse {
                            tool_name: tool_call.name.clone(),
                            args: serde_json::to_string(&tool_call.arguments).unwrap_or_default(),
                        })
                        .await;

                    // Execute the tool
                    let tool_result = crate::ai::tools::execute_tool(
                        &pool,
                        user_id,
                        &tool_call.name,
                        &tool_call.arguments,
                    )
                    .await
                    .unwrap_or_else(|e| format!("Tool error: {e}"));

                    let _ = tx_clone
                        .send(ChatStreamEvent::ToolResult {
                            tool_name: tool_call.name,
                            content: tool_result,
                        })
                        .await;
                }

                let _ = tx_clone
                    .send(ChatStreamEvent::Done {
                        session_id: sid.clone(),
                    })
                    .await;

                // Save assistant response
                let _ = db::save_chat_message(&pool, &sid, "assistant", &full_content).await;
            }
            Err(e) => {
                let _ = tx_clone
                    .send(ChatStreamEvent::Error {
                        message: e.client_message(),
                    })
                    .await;
            }
        }
    });

    Ok(sse::stream_response(rx))
}

#[derive(Deserialize)]
struct ToolCallRequest {
    name: String,
    arguments: serde_json::Value,
}

fn extract_tool_call(content: &str) -> Option<ToolCallRequest> {
    // Look for {"tool_use": {...}} pattern in the response
    if let Some(start) = content.find("{\"tool_use\"") {
        let remaining = &content[start..];
        // Find the matching closing brace
        let mut depth = 0;
        let mut end = 0;
        for (i, ch) in remaining.char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        if end > 0 {
            let json_str = &remaining[..end];
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(tool_use) = val.get("tool_use") {
                    let name = tool_use.get("name")?.as_str()?.to_string();
                    let arguments = tool_use.get("arguments").cloned().unwrap_or(serde_json::json!({}));
                    return Some(ToolCallRequest { name, arguments });
                }
            }
        }
    }
    None
}
