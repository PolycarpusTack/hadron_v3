//! Chat handlers — sessions, messages, streaming with multi-turn agent loop.

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

/// Maximum number of tool-use iterations before forcing a final response.
const MAX_AGENT_ITERATIONS: usize = 5;

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
            resolve_ai_config(&state.db).await?
        }
    } else {
        resolve_ai_config(&state.db).await?
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
        "{}\n\nYou have access to these tools:\n{}\n\n\
         To use a tool, respond with ONLY a JSON block: {{\"tool_use\": {{\"name\": \"tool_name\", \"arguments\": {{...}}}}}}\n\
         Do not include any other text when using a tool — just the JSON block.\n\
         After receiving tool results, you may use another tool or provide your final response to the user.\n\
         You can use up to {} tools per conversation turn.",
        ai::CHAT_SYSTEM_PROMPT,
        tool_descriptions.join("\n"),
        MAX_AGENT_ITERATIONS
    );

    // Spawn the agent loop
    let pool = state.db.clone();
    let sid = session_id.clone();
    let user_id = user.user.id;

    tokio::spawn(async move {
        let result = run_agent_loop(
            &ai_config,
            ai_messages,
            &system_prompt,
            &pool,
            user_id,
            &sid,
            &tx,
        )
        .await;

        if let Err(e) = result {
            let _ = tx
                .send(ChatStreamEvent::Error {
                    message: e.client_message(),
                })
                .await;
        }
    });

    Ok(sse::stream_response(rx))
}

/// Multi-turn agent loop: calls the AI, executes tools, feeds results back,
/// then streams the final response.
async fn run_agent_loop(
    ai_config: &AiConfig,
    initial_messages: Vec<AiMessage>,
    system_prompt: &str,
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
    session_id: &str,
    tx: &mpsc::Sender<ChatStreamEvent>,
) -> Result<(), HadronError> {
    let mut messages = initial_messages;

    for iteration in 0..MAX_AGENT_ITERATIONS {
        // Non-streaming call to get full response (need structured output for tool parsing)
        let response = ai::complete(ai_config, messages.clone(), Some(system_prompt)).await?;

        // Check if the AI wants to use a tool
        let tool_call = extract_tool_call(&response);

        if let Some(tool) = tool_call {
            // Notify client about tool use
            let _ = tx
                .send(ChatStreamEvent::ToolUse {
                    tool_name: tool.name.clone(),
                    args: serde_json::to_string(&tool.arguments).unwrap_or_default(),
                })
                .await;

            // Execute the tool
            let tool_result = crate::ai::tools::execute_tool(
                pool,
                user_id,
                &tool.name,
                &tool.arguments,
            )
            .await
            .unwrap_or_else(|e| format!("Tool error: {e}"));

            // Notify client about tool result
            let _ = tx
                .send(ChatStreamEvent::ToolResult {
                    tool_name: tool.name.clone(),
                    content: tool_result.clone(),
                })
                .await;

            // Feed the assistant's tool-calling message + tool result back into the conversation
            messages.push(AiMessage {
                role: "assistant".to_string(),
                content: response,
            });
            messages.push(AiMessage {
                role: "user".to_string(),
                content: format!(
                    "Tool result from '{}':\n\n{}\n\nPlease continue. You may use another tool or provide your final response.",
                    tool.name, tool_result
                ),
            });

            tracing::debug!(
                "Agent loop iteration {}: tool '{}' executed, continuing",
                iteration + 1,
                tool.name
            );

            // Continue the loop — next iteration will call the AI again with the tool result
        } else {
            // No tool call — this is the final response.
            // Stream it token-by-token to the client for a nice UX.
            // We already have the full text from the non-streaming call,
            // so we simulate streaming by chunking it.
            stream_text_as_tokens(&response, tx).await;

            let _ = tx
                .send(ChatStreamEvent::Done {
                    session_id: session_id.to_string(),
                })
                .await;

            // Save the final response
            let _ = db::save_chat_message(pool, session_id, "assistant", &response).await;

            return Ok(());
        }
    }

    // Max iterations reached — nudge the AI to synthesise using what it already has.
    // Append to the last user message (which already contains the most recent tool result)
    // so we never create two consecutive user messages, which Anthropic rejects.
    if let Some(last) = messages.last_mut() {
        if last.role == "user" {
            last.content.push_str("\n\nYou have used all available tool calls. Please provide your final comprehensive response to the user based on all the information gathered.");
        }
    }

    // Final streaming call
    let final_response = ai::stream_completion(
        ai_config,
        messages,
        Some(system_prompt),
        tx.clone(),
    )
    .await?;

    let _ = tx
        .send(ChatStreamEvent::Done {
            session_id: session_id.to_string(),
        })
        .await;

    let _ = db::save_chat_message(pool, session_id, "assistant", &final_response).await;

    Ok(())
}

/// Stream pre-computed text as individual token events for smooth client-side rendering.
async fn stream_text_as_tokens(text: &str, tx: &mpsc::Sender<ChatStreamEvent>) {
    // Send in chunks of ~20 chars for a smooth streaming effect
    let mut chars = text.chars().peekable();
    let mut chunk = String::with_capacity(20);

    while chars.peek().is_some() {
        chunk.clear();
        for _ in 0..20 {
            if let Some(c) = chars.next() {
                chunk.push(c);
            } else {
                break;
            }
        }
        if !chunk.is_empty() {
            if tx
                .send(ChatStreamEvent::Token {
                    content: chunk.clone(),
                })
                .await
                .is_err()
            {
                // Receiver dropped — client disconnected; stop streaming.
                return;
            }
            // Small delay between chunks for smooth rendering
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    }
}


async fn resolve_ai_config(pool: &sqlx::PgPool) -> Result<AiConfig, AppError> {
    db::get_server_ai_config(pool)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| {
            AppError(HadronError::validation(
                "No AI configuration available. Ask an admin to configure API keys, or provide your own.",
            ))
        })
}

#[derive(Deserialize)]
struct ToolCallRequest {
    name: String,
    arguments: serde_json::Value,
}

fn extract_tool_call(content: &str) -> Option<ToolCallRequest> {
    // Tool calls must start at the beginning of the response (after trimming whitespace).
    // This prevents false positives from tool results echoed in the conversation history.
    let trimmed = content.trim();
    if !trimmed.starts_with("{\"tool_use\"") {
        return None;
    }

    // Find the matching closing brace on the trimmed string
    let mut depth = 0;
    let mut end = 0;
    for (i, ch) in trimmed.char_indices() {
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
        let json_str = &trimmed[..end];
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(tool_use) = val.get("tool_use") {
                let name = tool_use.get("name")?.as_str()?.to_string();
                let arguments = tool_use
                    .get("arguments")
                    .cloned()
                    .unwrap_or(serde_json::json!({}));
                return Some(ToolCallRequest { name, arguments });
            }
        }
    }
    None
}
