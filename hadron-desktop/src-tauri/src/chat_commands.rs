use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::ai_service::{
    build_assistant_tool_message, build_chat_request_anthropic,
    build_chat_request_openai, build_chat_request_with_tools_anthropic,
    build_chat_request_with_tools_openai,
    build_tool_result_messages, call_provider_chat, call_provider_quick,
    call_provider_raw_json, call_provider_streaming, extract_text_from_response,
    parse_tool_calls, response_wants_tools, ChatMessage, ChatResponse, ChatStreamEvent,
};
use crate::chat_tools::{execute_tool, get_tool_definitions, JiraConfig, ToolContext};
use crate::database::Database;
use crate::rag_commands::{kb_query_internal, rag_build_context_internal, OpenSearchConfig};

// ============================================================================
// Chat Request / Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub api_key: String,
    pub model: String,
    pub provider: String,
    pub use_rag: bool,
    pub use_kb: bool,
    pub won_version: Option<String>,
    pub customer: Option<String>,
    pub kb_mode: Option<String>,
    pub opensearch_config: Option<ChatOpenSearchConfig>,
    pub jira_base_url: Option<String>,
    pub jira_email: Option<String>,
    pub jira_api_token: Option<String>,
    pub jira_project_key: Option<String>,
    pub analysis_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ChatOpenSearchConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub use_ssl: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatContextSummary {
    pub rag_results: usize,
    pub kb_results: usize,
    pub gold_matches: usize,
    pub fts_results: usize,
}

/// Emitted via "chat-tool-use" when the agent calls a tool (for UI indicators)
#[derive(Debug, Clone, Serialize)]
pub struct ChatToolUseEvent {
    pub tool_name: String,
    pub tool_args: serde_json::Value,
    pub iteration: usize,
}

// ============================================================================
// Chat System Prompt
// ============================================================================

const CHAT_SYSTEM_PROMPT_BASE: &str = r#"You are Ask Hadron, an expert assistant for the WHATS'ON broadcast management system (MediaGeniX/Mediagenix). You help users understand crashes, debug issues, navigate documentation, and leverage historical analyses.

## Your Tools
You have tools to search and retrieve information from Hadron's databases. USE YOUR TOOLS proactively — do not guess or make up information. When a user asks about crashes, errors, documentation, trends, or statistics, call the appropriate tool first.

Tool usage strategy:
- For questions about specific crashes or errors: use `search_analyses` first, then `get_analysis_detail` for specifics
- For documentation/feature questions: use `search_kb`
- For "how many" / trend / pattern questions: use `get_trend_data`, `get_error_patterns`, or `get_statistics`
- For signature/recurring crash questions: use `get_top_signatures` or `get_crash_signature`
- For cross-referencing crashes with JIRA: use `correlate_crash_to_jira`
- For understanding crash history: use `get_crash_timeline`
- For comparing two crashes: use `compare_crashes`
- For component health assessment: use `get_component_health`
- For searching JIRA tickets: use `search_jira` with JQL or text
- For creating a bug/ticket: use `create_jira_ticket`
- You can call multiple tools in sequence to build a complete answer
- Always cite your sources (analysis IDs, KB doc titles, signature hashes, JIRA keys)

## Response Formatting
- Be concise but thorough. Default to 2-3 paragraphs unless asked for more detail.
- When presenting data from multiple sources, use **tables** for structured comparisons.
- When showing chronological data, use **timeline tables** with Date | Event | Details columns.
- When summarizing health or status, use a **structured report** with sections and severity badges.
- Always cite your sources: mention analysis IDs (e.g., "Analysis #142"), KB doc titles, signature hashes, and JIRA keys.
- If your tool searches return no results, say so honestly and suggest what the user could try.
- Format code references with backticks, use markdown headers for structure.
- Use bold for key findings: **Root Cause**, **Status**, **Severity**."#;

/// Max iterations for the agent tool-calling loop
const MAX_AGENT_ITERATIONS: usize = 5;

#[allow(dead_code)]
fn build_chat_system_prompt(
    rag_context: Option<&str>,
    kb_context: Option<&str>,
    gold_context: Option<&str>,
    fts_context: Option<&str>,
) -> String {
    let mut prompt = CHAT_SYSTEM_PROMPT_BASE.to_string();

    let has_context = rag_context.is_some()
        || kb_context.is_some()
        || gold_context.is_some()
        || fts_context.is_some();

    if has_context {
        prompt.push_str("\n\n## Retrieved Context\n");
        prompt.push_str("Use the following retrieved context to inform your answer. Cite sources when relevant.\n");
    }

    if let Some(kb) = kb_context {
        if !kb.is_empty() {
            prompt.push_str("\n### Knowledge Base Documentation\n");
            prompt.push_str(kb);
        }
    }

    if let Some(rag) = rag_context {
        if !rag.is_empty() {
            prompt.push_str("\n### Similar Historical Analyses\n");
            prompt.push_str(rag);
        }
    }

    if let Some(gold) = gold_context {
        if !gold.is_empty() {
            prompt.push_str("\n### Verified Expert Analyses (Gold Standard)\n");
            prompt.push_str(gold);
        }
    }

    if let Some(fts) = fts_context {
        if !fts.is_empty() {
            prompt.push_str("\n### Related Analyses (Full-Text Search)\n");
            prompt.push_str(fts);
        }
    }

    prompt
}

// ============================================================================
// Context Retrieval Helpers
// ============================================================================

#[allow(dead_code)]
async fn retrieve_rag_context(
    query: &str,
    api_key: &str,
) -> (String, usize, usize) {
    match rag_build_context_internal(query, None, None, 5, api_key).await {
        Ok(ctx) => {
            let gold_count = ctx.gold_matches.len();
            let rag_count = ctx.similar_analyses.len();
            let mut text = String::new();

            for case in &ctx.gold_matches {
                text.push_str(&format!(
                    "<verified_analysis citation=\"{}\" score=\"{:.2}\" component=\"{}\">\n",
                    case.citation_id,
                    case.similarity_score,
                    case.component.as_deref().unwrap_or("unknown")
                ));
                text.push_str(&format!("Root Cause: {}\n", case.root_cause));
                if !case.suggested_fixes.is_empty() {
                    text.push_str(&format!("Fixes: {}\n", case.suggested_fixes.join("; ")));
                }
                text.push_str("</verified_analysis>\n\n");
            }

            for case in &ctx.similar_analyses {
                text.push_str(&format!(
                    "<similar_case citation=\"{}\" score=\"{:.2}\" component=\"{}\">\n",
                    case.citation_id,
                    case.similarity_score,
                    case.component.as_deref().unwrap_or("unknown")
                ));
                text.push_str(&format!("Root Cause: {}\n", case.root_cause));
                if !case.suggested_fixes.is_empty() {
                    text.push_str(&format!("Fixes: {}\n", case.suggested_fixes.join("; ")));
                }
                text.push_str("</similar_case>\n\n");
            }

            (text, rag_count, gold_count)
        }
        Err(e) => {
            log::warn!("RAG context retrieval failed: {}", e);
            (String::new(), 0, 0)
        }
    }
}

#[allow(dead_code)]
async fn retrieve_kb_context(
    query: &str,
    mode: &str,
    opensearch_config: Option<OpenSearchConfig>,
    won_version: Option<String>,
    customer: Option<String>,
    api_key: &str,
) -> (String, usize) {
    match kb_query_internal(query, mode, opensearch_config, won_version, customer, 5, api_key).await
    {
        Ok(ctx) => {
            let count = ctx.kb_results.len() + ctx.release_note_results.len();
            let mut text = String::new();

            for item in &ctx.kb_results {
                text.push_str(&format!(
                    "<documentation title=\"{}\" version=\"{}\" source=\"{}\">\n",
                    item.page_title, item.won_version, item.source_type
                ));
                text.push_str(&item.text);
                text.push_str("\n</documentation>\n\n");
            }

            for item in &ctx.release_note_results {
                text.push_str(&format!(
                    "<release_note title=\"{}\" version=\"{}\" customer=\"{}\">\n",
                    item.page_title, item.won_version, item.customer
                ));
                text.push_str(&item.text);
                text.push_str("\n</release_note>\n\n");
            }

            (text, count)
        }
        Err(e) => {
            log::warn!("KB context retrieval failed: {}", e);
            (String::new(), 0)
        }
    }
}

#[allow(dead_code)]
fn retrieve_fts_context(db: &Database, query: &str) -> (String, usize) {
    match db.search_analyses(query, None) {
        Ok(analyses) => {
            let count = analyses.len().min(5);
            let mut text = String::new();

            for analysis in analyses.iter().take(5) {
                text.push_str(&format!(
                    "<analysis id=\"{}\" filename=\"{}\" severity=\"{}\" type=\"{}\">\n",
                    analysis.id, analysis.filename, analysis.severity, analysis.analysis_type
                ));
                text.push_str(&format!("Root Cause: {}\n", analysis.root_cause));
                if let Some(ref err_msg) = analysis.error_message {
                    text.push_str(&format!("Error: {}\n", err_msg));
                }
                text.push_str("</analysis>\n\n");
            }

            (text, count)
        }
        Err(e) => {
            log::warn!("FTS search failed: {}", e);
            (String::new(), 0)
        }
    }
}

// ============================================================================
// Query Rewriting (Level 1.1)
// ============================================================================

const REWRITE_SYSTEM_PROMPT: &str = r#"You are a search query optimizer. Your job is to rewrite a follow-up question from a conversation into a standalone search query that captures the full intent.

Rules:
- Output ONLY the rewritten query, nothing else
- Incorporate relevant context from the conversation history
- Make the query self-contained (someone with no context should understand what is being searched for)
- Keep it concise (under 100 words)
- If the message is already a standalone question, return it unchanged
- Preserve technical terms, error names, component names, JIRA keys exactly as written"#;

/// Rewrite a follow-up question into a standalone search query using conversation context.
/// Only activates when there are prior turns. Returns the original query on failure.
async fn rewrite_query_for_retrieval(
    messages: &[ChatMessage],
    latest_query: &str,
    provider: &str,
    api_key: &str,
    model: &str,
) -> String {
    // Only rewrite when there's conversation history (>1 user message)
    let user_message_count = messages.iter().filter(|m| m.role == "user").count();
    if user_message_count <= 1 {
        return latest_query.to_string();
    }

    // Build a condensed conversation summary (last 3 turns = 6 messages max)
    let recent: Vec<ChatMessage> = messages
        .iter()
        .rev()
        .take(6)
        .rev()
        .cloned()
        .collect();

    // Add the rewrite instruction as the final user message
    let rewrite_request = vec![ChatMessage {
        role: "user".to_string(),
        content: format!(
            "Conversation so far:\n{}\n\nRewrite this latest question as a standalone search query:\n\"{}\"",
            recent.iter().map(|m| format!("{}: {}", m.role, m.content)).collect::<Vec<_>>().join("\n"),
            latest_query,
        ),
    }];

    match call_provider_quick(provider, &rewrite_request, REWRITE_SYSTEM_PROMPT, api_key, model, 150).await {
        Ok(rewritten) => {
            let rewritten = rewritten.trim().trim_matches('"').to_string();
            if rewritten.is_empty() {
                latest_query.to_string()
            } else {
                log::info!(
                    "Query rewritten: \"{}\" -> \"{}\"",
                    &latest_query[..latest_query.len().min(80)],
                    &rewritten[..rewritten.len().min(80)]
                );
                rewritten
            }
        }
        Err(e) => {
            log::warn!("Query rewriting failed, using original: {}", e);
            latest_query.to_string()
        }
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    db: tauri::State<'_, Arc<Database>>,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    // Extract the latest user message as retrieval query
    let query = request
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    if query.is_empty() {
        return Err("No user message provided".to_string());
    }

    // Rewrite follow-up questions into standalone search queries (Level 1.1)
    let rewritten_query = rewrite_query_for_retrieval(
        &request.messages,
        &query,
        &request.provider,
        &request.api_key,
        &request.model,
    )
    .await;

    // --- Build tool context for the agent ---
    let os_config = request.opensearch_config.map(|c| OpenSearchConfig {
        host: c.host,
        port: c.port,
        username: c.username,
        password: c.password,
        use_ssl: c.use_ssl,
    });

    // Build JIRA config if credentials are provided
    let jira_config = match (&request.jira_base_url, &request.jira_email, &request.jira_api_token) {
        (Some(base_url), Some(email), Some(token)) if !base_url.is_empty() && !token.is_empty() => {
            Some(JiraConfig {
                base_url: base_url.clone(),
                email: email.clone(),
                api_token: token.clone(),
                project_key: request.jira_project_key.clone(),
            })
        }
        _ => None,
    };

    let tool_ctx = ToolContext {
        db: Arc::clone(&db),
        api_key: request.api_key.clone(),
        provider: request.provider.clone(),
        model: request.model.clone(),
        opensearch_config: os_config,
        kb_mode: request.kb_mode.clone().unwrap_or_else(|| "remote".to_string()),
        won_version: request.won_version.clone(),
        customer: request.customer.clone(),
        jira_config,
    };

    // --- Determine available tools based on user toggles ---
    let all_tools = get_tool_definitions();
    let use_rag = request.use_rag;
    let has_jira = tool_ctx.jira_config.is_some();
    let tools: Vec<_> = all_tools
        .into_iter()
        .filter(|t| {
            match t.name.as_str() {
                // KB tool only available when use_kb is enabled
                "search_kb" => request.use_kb,
                // RAG-powered tools gated on use_rag
                "search_analyses" | "find_similar_crashes" | "get_analysis_detail" => use_rag,
                // JIRA tools only available when JIRA is configured
                "search_jira" | "create_jira_ticket" => has_jira,
                // All other tools (stats, signatures, trends) are always available
                _ => true,
            }
        })
        .collect();

    // --- Build system prompt ---
    // The agent system prompt is simpler now — no pre-fetched context blocks.
    // The LLM decides what to search via tool calls.
    let mut system_prompt = CHAT_SYSTEM_PROMPT_BASE.to_string();

    // If an analysis is selected, load it and prepend as context
    if let Some(analysis_id) = request.analysis_id {
        let db_clone = Arc::clone(&db);
        match tokio::task::spawn_blocking(move || db_clone.get_analysis_by_id(analysis_id))
            .await
        {
            Ok(Ok(analysis)) => {
                let fixes: Vec<String> = serde_json::from_str(&analysis.suggested_fixes)
                    .unwrap_or_default();
                system_prompt.push_str(&format!(
                    "\n\n## Currently Selected Analysis\n\
                     The user is viewing this analysis. Answer questions in its context.\n\
                     <current_analysis id=\"{}\" filename=\"{}\" severity=\"{}\" type=\"{}\">\n\
                     Error: {}\n\
                     Component: {}\n\
                     Root Cause: {}\n\
                     Suggested Fixes: {}\n\
                     Stack Trace: {}\n\
                     </current_analysis>",
                    analysis.id,
                    analysis.filename,
                    analysis.severity,
                    analysis.error_type,
                    analysis.error_message.as_deref().unwrap_or("N/A"),
                    analysis.component.as_deref().unwrap_or("unknown"),
                    analysis.root_cause,
                    fixes.join("; "),
                    analysis.stack_trace.as_deref().unwrap_or("N/A"),
                ));
                log::info!("Loaded analysis #{} as chat context", analysis_id);
            }
            Ok(Err(e)) => {
                log::warn!("Failed to load analysis #{}: {}", analysis_id, e);
            }
            Err(e) => {
                log::warn!("Task error loading analysis #{}: {}", analysis_id, e);
            }
        }
    }

    // --- Build initial message history as serde_json::Value ---
    let mut agent_messages: Vec<serde_json::Value> = request
        .messages
        .iter()
        .map(|m| json!({"role": m.role, "content": m.content}))
        .collect();

    // If query was rewritten, replace the last user message content so the LLM
    // sees the standalone version (better for tool-call reasoning)
    if rewritten_query != query {
        if let Some(last) = agent_messages.last_mut() {
            if last["role"].as_str() == Some("user") {
                last["content"] = json!(rewritten_query);
            }
        }
    }

    // --- Agent loop: LLM → tool calls → execute → loop ---
    let mut total_tool_calls = 0usize;
    let mut context_summary = ChatContextSummary {
        rag_results: 0,
        kb_results: 0,
        gold_matches: 0,
        fts_results: 0,
    };

    for iteration in 0..MAX_AGENT_ITERATIONS {
        log::info!("Agent loop iteration {} (tools called so far: {})", iteration, total_tool_calls);

        // Build request with tool definitions
        let request_body = match request.provider.as_str() {
            "anthropic" => build_chat_request_with_tools_anthropic(
                &agent_messages,
                &tools,
                &system_prompt,
                &request.model,
                4000,
            ),
            "llamacpp" => build_chat_request_with_tools_openai(
                &agent_messages,
                &tools,
                &system_prompt,
                &request.model,
                4000,
            ),
            _ => build_chat_request_with_tools_openai(
                &agent_messages,
                &tools,
                &system_prompt,
                &request.model,
                4000,
            ),
        };

        // Call LLM (non-streaming — we need the full response to check for tool calls)
        let response = call_provider_raw_json(
            &request.provider,
            request_body,
            &request.api_key,
        )
        .await?;

        // Check if the LLM wants to call tools
        if !response_wants_tools(&response, &request.provider) {
            let _ = app.emit("chat-context", &context_summary);

            // If no tool calls happened at all (first iteration), just chunk-emit
            // the existing response — no need for a second API call.
            if total_tool_calls == 0 {
                let final_text = extract_text_from_response(&response, &request.provider);
                emit_text_as_stream(&app, &final_text);
                let est_tokens = (final_text.len() as f64 / 4.0) as i32;
                return Ok(ChatResponse {
                    content: final_text,
                    tokens_used: est_tokens,
                    cost: 0.0,
                });
            }

            // Tools were called — make a true streaming request without tool
            // definitions so the user sees token-by-token output.
            let stream_body = build_streaming_request(
                &agent_messages,
                &system_prompt,
                &request.provider,
                &request.model,
            );

            let stream_result = call_provider_streaming(
                &app,
                &request.provider,
                stream_body,
                &request.api_key,
            )
            .await;

            return match stream_result {
                Ok(resp) => Ok(resp),
                Err(e) => {
                    // Fallback: emit the non-streaming text if streaming fails
                    log::warn!("Streaming failed, falling back: {}", e);
                    let final_text = extract_text_from_response(&response, &request.provider);
                    emit_text_as_stream(&app, &final_text);
                    let est_tokens = (final_text.len() as f64 / 4.0) as i32;
                    Ok(ChatResponse {
                        content: final_text,
                        tokens_used: est_tokens,
                        cost: 0.0,
                    })
                }
            };
        }

        // --- Tool calls detected — execute them ---
        let tool_calls = parse_tool_calls(&response, &request.provider);

        if tool_calls.is_empty() {
            // Unexpected: response_wants_tools was true but no parseable calls
            let final_text = extract_text_from_response(&response, &request.provider);
            let _ = app.emit("chat-context", context_summary);
            emit_text_as_stream(&app, &final_text);

            let est_tokens = (final_text.len() as f64 / 4.0) as i32;
            return Ok(ChatResponse {
                content: final_text,
                tokens_used: est_tokens,
                cost: 0.0,
            });
        }

        // Emit tool use events for frontend indicators
        for tc in &tool_calls {
            let _ = app.emit(
                "chat-tool-use",
                ChatToolUseEvent {
                    tool_name: tc.name.clone(),
                    tool_args: tc.arguments.clone(),
                    iteration,
                },
            );
            log::info!("Agent calling tool: {}({})", tc.name, tc.arguments);

            // Track context summary counts
            match tc.name.as_str() {
                "search_analyses" | "find_similar_crashes" | "get_analysis_detail" => {
                    context_summary.fts_results += 1;
                }
                "search_kb" => {
                    context_summary.kb_results += 1;
                }
                "get_top_signatures" | "get_crash_signature" => {
                    context_summary.rag_results += 1;
                }
                _ => {}
            }
        }

        // Execute all tool calls
        let mut results = Vec::new();
        for tc in &tool_calls {
            let result = execute_tool(tc, &tool_ctx).await;
            results.push(result);
            total_tool_calls += 1;
        }

        // Append the assistant's tool-calling message to the conversation
        let assistant_msg = build_assistant_tool_message(&response, &request.provider);
        agent_messages.push(assistant_msg);

        // Append tool results to the conversation
        let result_msgs = build_tool_result_messages(&results, &request.provider);
        agent_messages.extend(result_msgs);
    }

    // --- Max iterations reached — get a final response via true streaming ---
    log::warn!("Agent loop hit max iterations ({}), requesting final answer with streaming", MAX_AGENT_ITERATIONS);

    let _ = app.emit("chat-context", &context_summary);

    let stream_body = build_streaming_request(
        &agent_messages,
        &system_prompt,
        &request.provider,
        &request.model,
    );

    let stream_result = call_provider_streaming(
        &app,
        &request.provider,
        stream_body,
        &request.api_key,
    )
    .await;

    match stream_result {
        Ok(resp) => Ok(resp),
        Err(e) => {
            // Fallback: non-streaming
            log::warn!("Streaming failed, falling back: {}", e);
            let final_body = match request.provider.as_str() {
                "anthropic" => build_chat_request_anthropic(
                    &request.messages,
                    &system_prompt,
                    &request.model,
                    4000,
                    false,
                ),
                _ => build_chat_request_openai(
                    &request.messages,
                    &system_prompt,
                    &request.model,
                    4000,
                    false,
                ),
            };
            let final_response = call_provider_chat(&request.provider, final_body, &request.api_key).await?;
            emit_text_as_stream(&app, &final_response.content);
            Ok(final_response)
        }
    }
}

// ============================================================================
// Chat Feedback (Phase 4.2)
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ChatFeedbackRequest {
    pub session_id: String,
    pub message_id: String,
    pub rating: String,
    pub comment: Option<String>,
    pub tools_used: Option<Vec<String>>,
    pub query: Option<String>,
}

#[tauri::command]
pub async fn chat_submit_feedback(
    db: tauri::State<'_, Arc<Database>>,
    request: ChatFeedbackRequest,
) -> Result<(), String> {
    let tools_json = request
        .tools_used
        .map(|t| serde_json::to_string(&t).unwrap_or_default());

    let log_session = request.session_id.clone();
    let log_msg = request.message_id.clone();
    let log_rating = request.rating.clone();

    let db = Arc::clone(&db);
    tokio::task::spawn_blocking(move || {
        db.save_chat_feedback(
            &request.session_id,
            &request.message_id,
            &request.rating,
            request.comment.as_deref(),
            tools_json.as_deref(),
            None, // sources_cited — can be populated later
            request.query.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!(
        "Chat feedback stored: {} - {} ({})",
        log_session, log_msg, log_rating
    );

    Ok(())
}

// ============================================================================
// Chat Session Commands (Sprint 6)
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct SaveChatSessionRequest {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<SaveChatMessageItem>,
}

#[derive(Debug, Deserialize)]
pub struct SaveChatMessageItem {
    pub id: String,
    pub role: String,
    pub content: String,
    pub sources_json: Option<String>,
    pub timestamp: i64,
}

#[tauri::command]
pub async fn chat_save_session(
    db: tauri::State<'_, Arc<Database>>,
    request: SaveChatSessionRequest,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    let req = request;
    tokio::task::spawn_blocking(move || {
        db.save_chat_session(&req.id, &req.title, req.created_at, req.updated_at)?;
        for msg in &req.messages {
            db.save_chat_message(
                &msg.id,
                &req.id,
                &msg.role,
                &msg.content,
                msg.sources_json.as_deref(),
                msg.timestamp,
            )?;
        }
        Ok::<(), rusqlite::Error>(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn chat_list_sessions(
    db: tauri::State<'_, Arc<Database>>,
) -> Result<Vec<crate::database::ChatSessionRecord>, String> {
    let db = Arc::clone(&db);
    tokio::task::spawn_blocking(move || db.get_chat_sessions())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn chat_get_messages(
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
) -> Result<Vec<crate::database::ChatMessageRecord>, String> {
    let db = Arc::clone(&db);
    tokio::task::spawn_blocking(move || db.get_chat_messages(&session_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn chat_delete_session(
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    tokio::task::spawn_blocking(move || db.delete_chat_session(&session_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn chat_rename_session(
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    tokio::task::spawn_blocking(move || db.update_chat_session_title(&session_id, &title))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

/// Build a streaming request body from JSON agent messages (no tools).
/// Filters out tool-related messages that providers don't accept in plain chat.
fn build_streaming_request(
    agent_messages: &[serde_json::Value],
    system_prompt: &str,
    provider: &str,
    model: &str,
) -> serde_json::Value {
    // Filter to user/assistant messages only (strip tool_use and tool results)
    let clean_messages: Vec<serde_json::Value> = agent_messages
        .iter()
        .filter(|m| {
            let role = m["role"].as_str().unwrap_or("");
            role == "user" || role == "assistant"
        })
        .map(|m| {
            // Ensure assistant messages have plain string content (strip tool_calls)
            if m["role"].as_str() == Some("assistant") {
                if let Some(content) = m["content"].as_str() {
                    json!({"role": "assistant", "content": content})
                } else {
                    // If content is array (Anthropic tool_use blocks), extract text
                    if let Some(blocks) = m["content"].as_array() {
                        let text: String = blocks
                            .iter()
                            .filter(|b| b["type"].as_str() == Some("text"))
                            .filter_map(|b| b["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n");
                        if text.is_empty() {
                            json!({"role": "assistant", "content": "I used tools to gather information. Let me summarize my findings."})
                        } else {
                            json!({"role": "assistant", "content": text})
                        }
                    } else {
                        json!({"role": "assistant", "content": ""})
                    }
                }
            } else {
                m.clone()
            }
        })
        .collect();

    match provider {
        "anthropic" => json!({
            "model": model,
            "max_tokens": 4000,
            "system": system_prompt,
            "stream": true,
            "messages": clean_messages,
        }),
        _ => {
            let mut messages = vec![json!({"role": "system", "content": system_prompt})];
            messages.extend(clean_messages);
            json!({
                "model": model,
                "max_tokens": 4000,
                "stream": true,
                "messages": messages,
            })
        }
    }
}

/// Emit text content as chunked stream events for smooth frontend rendering.
fn emit_text_as_stream(app: &AppHandle, text: &str) {
    // Emit in ~80 char chunks for a streaming feel
    const CHUNK_SIZE: usize = 80;
    let chars: Vec<char> = text.chars().collect();

    for chunk in chars.chunks(CHUNK_SIZE) {
        let token: String = chunk.iter().collect();
        let _ = app.emit(
            "chat-stream",
            ChatStreamEvent {
                token,
                done: false,
                error: None,
            },
        );
    }

    // Signal completion
    let _ = app.emit(
        "chat-stream",
        ChatStreamEvent {
            token: String::new(),
            done: true,
            error: None,
        },
    );
}
