//! Chat handlers — sessions, messages, streaming with multi-turn agent loop.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use hadron_core::error::HadronError;
use serde::{Deserialize, Serialize};
use std::time::Instant;
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

    /// Build the synthesis context for the final AI response.
    fn build_synthesis_context(&self) -> String {
        if self.evidence.is_empty() {
            return String::new();
        }

        let mut ctx = format!(
            "\n\n<evidence_summary>\nTools used: {}\nEvidence items gathered: {}\n\n",
            self.tool_history
                .iter()
                .map(|t| t.tool_name.as_str())
                .collect::<Vec<_>>()
                .join(", "),
            self.evidence.len(),
        );

        for (i, ev) in self.evidence.iter().enumerate() {
            ctx.push_str(&format!(
                "Source {}: {} [{}]\n{}\n\n",
                i + 1,
                ev.source,
                ev.relevance,
                ev.summary
            ));
        }

        ctx.push_str("</evidence_summary>");
        ctx
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
         Do not include any other text when using a tool — just the JSON block.\n\n\
         Guidelines:\n\
         - Use tools to gather evidence before answering. Don't guess when you can search.\n\
         - Stop searching once you have sufficient evidence to answer confidently.\n\
         - When providing your final answer, cite sources (analysis IDs, document titles) when available.\n\
         - If evidence is insufficient after searching, say so honestly rather than speculating.\n\
         - You can use up to {} tools per conversation turn.",
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
/// then streams the final response. Uses `AgentState` to track evidence
/// and determine when to stop gathering data.
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
    let mut state = AgentState::new();

    for _iteration in 0..MAX_AGENT_ITERATIONS {
        // Non-streaming call to get full response (need structured output for tool parsing)
        let response =
            ai::complete(ai_config, messages.clone(), Some(system_prompt)).await?;

        // Check if the AI wants to use a tool
        let tool_call = extract_tool_call(&response);

        if let Some(tool) = tool_call {
            // Check evidence sufficiency BEFORE executing another tool
            if state.should_stop() {
                tracing::debug!(
                    "Agent stopping early: evidence sufficient after {} tools",
                    state.iterations_used
                );
                break; // Fall through to synthesis
            }

            // Notify client about tool use
            let _ = tx
                .send(ChatStreamEvent::ToolUse {
                    tool_name: tool.name.clone(),
                    args: serde_json::to_string(&tool.arguments).unwrap_or_default(),
                })
                .await;

            // Execute with timing
            let start = Instant::now();
            let tool_result = crate::ai::tools::execute_tool(
                pool,
                user_id,
                &tool.name,
                &tool.arguments,
            )
            .await
            .unwrap_or_else(|e| format!("Tool error: {e}"));
            let duration_ms = start.elapsed().as_millis() as u64;

            // Record in agent state
            state.record_tool_call(
                &tool.name,
                &tool.arguments,
                &tool_result,
                duration_ms,
                !tool_result.starts_with("Tool error:"),
            );

            // Notify client about tool result
            let _ = tx
                .send(ChatStreamEvent::ToolResult {
                    tool_name: tool.name.clone(),
                    content: tool_result.clone(),
                })
                .await;

            // Feed the assistant's tool-calling message + tool result back
            messages.push(AiMessage {
                role: "assistant".to_string(),
                content: response,
            });

            // Build a structured tool result message
            let guidance = if state.should_stop() {
                "You now have sufficient evidence. Please provide your final comprehensive response."
            } else {
                "You may use another tool if needed, or provide your final response if you have enough information."
            };
            let result_msg = format!(
                "<tool_result name=\"{}\" iteration=\"{}\" evidence_count=\"{}\">\n{}\n</tool_result>\n\n{}",
                tool.name,
                state.iterations_used,
                state.evidence.len(),
                tool_result,
                guidance,
            );

            messages.push(AiMessage {
                role: "user".to_string(),
                content: result_msg,
            });

            tracing::debug!(
                "Agent loop iteration {}: tool '{}' executed ({}ms), evidence: {} items, {} chars",
                state.iterations_used,
                tool.name,
                duration_ms,
                state.evidence.len(),
                state.evidence_tokens,
            );
        } else {
            // No tool call — this is the final response. Stream it.
            stream_text_as_tokens(&response, tx).await;

            let _ = tx
                .send(ChatStreamEvent::Done {
                    session_id: session_id.to_string(),
                })
                .await;

            let _ =
                db::save_chat_message(pool, session_id, "assistant", &response).await;

            return Ok(());
        }
    }

    // Max iterations or evidence sufficient — synthesize final response.
    // Append synthesis context to the last message so we never create two
    // consecutive user messages (which Anthropic rejects).
    let synthesis = state.build_synthesis_context();
    if let Some(last) = messages.last_mut() {
        if last.role == "user" {
            last.content.push_str(&format!(
                "\n\nPlease provide your final comprehensive response based on the evidence gathered.{}",
                synthesis
            ));
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

    let _ =
        db::save_chat_message(pool, session_id, "assistant", &final_response).await;

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
