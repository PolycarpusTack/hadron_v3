//! Chat handlers — sessions, messages, streaming with multi-turn agent loop.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use hadron_core::error::HadronError;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tokio::sync::mpsc;

use crate::ai::{self, AiConfig, AssistantTurn, ChatMessage};
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::sse;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

/// Maximum number of tool-use iterations before forcing a final response.
const MAX_AGENT_ITERATIONS: usize = 5;

// ============================================================================
// Structured Agent State
// ============================================================================

/// Structured agent state tracking tool calls, evidence, and stopping conditions.
#[derive(Debug, Clone, Serialize)]
struct AgentState {
    /// History of tool calls made this turn
    tool_history: Vec<ToolCallRecord>,
    /// Accumulated evidence summaries from tools
    evidence: Vec<EvidenceItem>,
    /// Total chars of tool results gathered (for budget)
    evidence_tokens: usize,
    /// Number of iterations used
    iterations_used: usize,
}

#[derive(Debug, Clone, Serialize)]
struct ToolCallRecord {
    tool_name: String,
    arguments: serde_json::Value,
    result_preview: String,
    duration_ms: u64,
    success: bool,
}

#[derive(Debug, Clone, Serialize)]
struct EvidenceItem {
    source: String,
    summary: String,
    relevance: String,
    source_ids: Vec<String>,
}

impl AgentState {
    fn new() -> Self {
        Self {
            tool_history: Vec::new(),
            evidence: Vec::new(),
            evidence_tokens: 0,
            iterations_used: 0,
        }
    }

    /// Record a tool call and its result. Estimates evidence relevance.
    fn record_tool_call(
        &mut self,
        name: &str,
        args: &serde_json::Value,
        result: &str,
        duration_ms: u64,
        success: bool,
    ) {
        self.tool_history.push(ToolCallRecord {
            tool_name: name.to_string(),
            arguments: args.clone(),
            result_preview: result.chars().take(200).collect(),
            duration_ms,
            success,
        });

        self.evidence_tokens += result.len();

        // Extract evidence if the tool returned useful data
        if success && !result.is_empty() && result != "[]" && result != "{}" {
            let summary: String = result.chars().take(500).collect();
            let relevance = if result.len() > 100 { "high" } else { "medium" };

            let source_ids = extract_ids_from_json(result);

            self.evidence.push(EvidenceItem {
                source: name.to_string(),
                summary,
                relevance: relevance.to_string(),
                source_ids,
            });
        }

        self.iterations_used += 1;
    }

    /// Check if we should stop gathering evidence.
    fn should_stop(&self) -> bool {
        // Stop if we have enough evidence with at least one high-relevance item
        if self.evidence.len() >= 3
            && self.evidence.iter().any(|e| e.relevance == "high")
        {
            return true;
        }
        // Stop if we've used too many chars of tool results (budget: ~8000)
        if self.evidence_tokens > 8000 {
            return true;
        }
        // Stop if we've made duplicate tool calls (same tool + same args)
        if let Some(last) = self.tool_history.last() {
            let duplicates = self
                .tool_history
                .iter()
                .filter(|t| t.tool_name == last.tool_name && t.arguments == last.arguments)
                .count();
            if duplicates > 1 {
                return true;
            }
        }
        false
    }

}

/// Simple extraction of "id": NNN patterns from JSON text.
fn extract_ids_from_json(json_str: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for part in json_str.split("\"id\"") {
        if let Some(rest) = part.strip_prefix(':') {
            let trimmed = rest.trim();
            if let Some(num_end) = trimmed.find(|c: char| !c.is_ascii_digit()) {
                let num = &trimmed[..num_end];
                if !num.is_empty() {
                    ids.push(num.to_string());
                }
            }
        }
    }
    ids.truncate(10);
    ids
}

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
            // Verify the session belongs to this user (single targeted query, not O(n) scan)
            if !db::verify_session_ownership(&state.db, &id, user.user.id)
                .await
                .map_err(AppError::from)?
            {
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

    // AI config is always admin-configured server-side — no per-request keys.
    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    // Convert incoming flat messages (role + content) into the canonical
    // ChatMessage shape. Persisted chat history doesn't carry tool-call turns,
    // so we only see user/assistant prose from past rounds — which is fine:
    // the agent loop builds up tool-call turns only within the current round-trip.
    let chat_messages: Vec<ChatMessage> = req
        .messages
        .iter()
        .map(|m| match m.role.as_str() {
            "system" => ChatMessage::System(m.content.clone()),
            "assistant" => ChatMessage::Assistant {
                text: Some(m.content.clone()),
                tool_calls: Vec::new(),
            },
            _ => ChatMessage::User(m.content.clone()),
        })
        .collect();

    // Tool descriptions are conveyed through the provider's native tool API,
    // not through the system prompt. The prompt only carries behavioural guidance.
    let system_prompt = format!(
        "{}\n\nGuidelines:\n\
         - Use tools to gather evidence before answering. Don't guess when you can search.\n\
         - Stop searching once you have sufficient evidence to answer confidently.\n\
         - When providing your final answer, cite sources (analysis IDs, document titles) when available.\n\
         - If evidence is insufficient after searching, say so honestly rather than speculating.\n\
         - You can use up to {} tools per conversation turn.",
        ai::CHAT_SYSTEM_PROMPT,
        MAX_AGENT_ITERATIONS
    );

    // Spawn the agent loop
    let pool = state.db.clone();
    let sid = session_id.clone();
    let user_id = user.user.id;

    tokio::spawn(async move {
        let result = run_agent_loop(
            &ai_config,
            chat_messages,
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

/// Multi-turn agent loop using provider-native tool calling.
///
/// Each round calls the model with the current conversation history and the
/// full tool catalogue. If the model asks for tool calls, we execute them,
/// append the structured assistant + tool-result turns, and loop. If the
/// model emits prose instead, that's the final answer — we stream it to the
/// client and return. If we hit `MAX_AGENT_ITERATIONS`, we make one more
/// streaming call with no tools offered, forcing the model to synthesise.
///
/// Tool calls arrive as typed `tool_calls` / `tool_use` fields from the
/// provider APIs — never as free-text JSON — so prompt-injected strings
/// cannot forge a tool invocation.
async fn run_agent_loop(
    ai_config: &AiConfig,
    initial_messages: Vec<ChatMessage>,
    system_prompt: &str,
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
    session_id: &str,
    tx: &mpsc::Sender<ChatStreamEvent>,
) -> Result<(), HadronError> {
    let mut messages = initial_messages;
    let mut state = AgentState::new();
    let tools = crate::ai::tools::chat_tools();

    for _iteration in 0..MAX_AGENT_ITERATIONS {
        let turn = ai::complete_with_tools(
            ai_config,
            &messages,
            Some(system_prompt),
            &tools,
        )
        .await?;

        match turn {
            AssistantTurn::Message(text) => {
                // Final response. Fake-stream the pre-computed text so the
                // client still sees Token events for smooth rendering.
                stream_text_as_tokens(&text, tx).await;
                let _ = tx
                    .send(ChatStreamEvent::Done {
                        session_id: session_id.to_string(),
                    })
                    .await;
                if let Err(e) =
                    db::save_chat_message(pool, session_id, "assistant", &text).await
                {
                    tracing::warn!("Failed to persist assistant chat message: {e}");
                }
                return Ok(());
            }
            AssistantTurn::ToolCalls { text, calls } => {
                // Persist the assistant turn (with structured tool calls)
                // so the next round has the correct history shape.
                messages.push(ChatMessage::Assistant {
                    text: text.clone(),
                    tool_calls: calls.clone(),
                });

                let mut executed_any = false;
                for call in calls {
                    let _ = tx
                        .send(ChatStreamEvent::ToolUse {
                            tool_name: call.name.clone(),
                            args: serde_json::to_string(&call.arguments).unwrap_or_default(),
                        })
                        .await;

                    let start = Instant::now();
                    let tool_result = crate::ai::tools::execute_tool(
                        pool,
                        user_id,
                        &call.name,
                        &call.arguments,
                    )
                    .await
                    .unwrap_or_else(|e| format!("Tool error: {e}"));
                    let duration_ms = start.elapsed().as_millis() as u64;

                    state.record_tool_call(
                        &call.name,
                        &call.arguments,
                        &tool_result,
                        duration_ms,
                        !tool_result.starts_with("Tool error:"),
                    );
                    executed_any = true;

                    let _ = tx
                        .send(ChatStreamEvent::ToolResult {
                            tool_name: call.name.clone(),
                            content: tool_result.clone(),
                        })
                        .await;

                    tracing::debug!(
                        "Agent iteration {}: tool '{}' ({}ms), evidence: {} items, {} chars",
                        state.iterations_used,
                        call.name,
                        duration_ms,
                        state.evidence.len(),
                        state.evidence_tokens,
                    );

                    messages.push(ChatMessage::ToolResult {
                        tool_call_id: call.id,
                        content: tool_result,
                    });
                }

                if executed_any && state.should_stop() {
                    tracing::debug!(
                        "Agent stopping early: evidence sufficient after {} tools",
                        state.iterations_used
                    );
                    break;
                }
            }
        }
    }

    // Synthesis round: no tools offered, force a text response.
    let final_response = ai::stream_final_response(
        ai_config,
        &messages,
        Some(system_prompt),
        tx.clone(),
    )
    .await?;

    let _ = tx
        .send(ChatStreamEvent::Done {
            session_id: session_id.to_string(),
        })
        .await;
    if let Err(e) =
        db::save_chat_message(pool, session_id, "assistant", &final_response).await
    {
        tracing::warn!("Failed to persist assistant chat message: {e}");
    }

    Ok(())
}

/// Stream pre-computed text as individual token events for smooth client-side rendering.
async fn stream_text_as_tokens(text: &str, tx: &mpsc::Sender<ChatStreamEvent>) {
    // Send in chunks of ~40 chars for a smooth streaming effect
    let mut chars = text.chars().peekable();
    let mut chunk = String::with_capacity(40);

    while chars.peek().is_some() {
        chunk.clear();
        for _ in 0..40 {
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
            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        }
    }
}


