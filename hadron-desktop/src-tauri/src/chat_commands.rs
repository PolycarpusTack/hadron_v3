use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener};
use zeroize::Zeroizing;

use crate::ai_service::{
    build_assistant_tool_message, build_chat_request_anthropic,
    build_chat_request_openai, build_chat_request_with_tools_anthropic,
    build_chat_request_with_tools_openai,
    build_tool_result_messages, call_provider_chat,
    call_provider_raw_json, call_provider_streaming, extract_text_from_response,
    parse_tool_calls, response_wants_tools, ChatMessage, ChatResponse, ChatStreamEvent,
};
use crate::chat_tools::{execute_tool, get_tool_definitions, JiraConfig, ToolContext};
use crate::database::Database;
use crate::keeper_service;
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
    pub request_id: Option<String>,
    /// If set, resolve the API key from Keeper instead of using `api_key` directly.
    pub keeper_secret_uid: Option<String>,
    /// Cheaper model for internal LLM calls (query planning, variant generation, tool decisions).
    /// If not set, the main `model` is used for everything.
    pub auxiliary_model: Option<String>,
    // Retrieval filters (PR1) — deserialized from frontend, read via serde
    #[allow(dead_code)]
    pub date_from: Option<String>,
    #[allow(dead_code)]
    pub date_to: Option<String>,
    #[allow(dead_code)]
    pub analysis_types: Option<Vec<String>>,
    /// Verbosity control: "concise" or "detailed". None = default behavior.
    pub verbosity: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Emitted via "chat-diagnostics" with retrieval pipeline telemetry
#[derive(Debug, Clone, Serialize)]
pub struct ChatDiagnosticsEvent {
    pub tools_used: Vec<String>,
    pub total_tool_calls: usize,
    pub retrieval_latency_ms: u64,
    pub evidence_sufficient: bool,
    pub evidence_confidence: f64,
    pub evidence_reason: String,
    pub rewritten_query: Option<String>,
    /// Number of citations in the response that could not be validated against tool results
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid_citation_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    // Phase 7: enriched diagnostics
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tool_traces: Vec<ToolTraceEvent>,
    pub total_tokens: i32,
    pub total_cost: f64,
}

/// Emitted via "chat-tool-use" when the agent calls a tool (for UI indicators)
#[derive(Debug, Clone, Serialize)]
pub struct ChatToolUseEvent {
    pub tool_name: String,
    pub tool_args: serde_json::Value,
    pub iteration: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Per-tool trace for the diagnostics panel
#[derive(Debug, Clone, Serialize)]
pub struct ToolTraceEvent {
    pub name: String,
    pub args: serde_json::Value,
    pub result_preview: String,  // first 200 chars of result content
    pub duration_ms: u64,
}

/// Emitted via "chat-final-content" with post-processed citations after streaming completes
#[derive(Debug, Clone, Serialize)]
pub struct ChatFinalContentEvent {
    pub content: String,
    pub references: Vec<crate::retrieval::citation::NumberedReference>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

// ============================================================================
// Chat System Prompt
// ============================================================================

const CHAT_SYSTEM_PROMPT_BASE: &str = r#"You are Ask Hadron, an expert regarding the Mediagenix WHATS'ON broadcast management software, its customer-agnostic general BASE implementation, as well as specific customer implementation customizations. You help users understand crashes, debug issues, navigate documentation, and leverage historical analyses.

## Your Tools
You have tools to search and retrieve information from Hadron's databases. USE YOUR TOOLS proactively — do not guess or make up information. When a user asks about crashes, errors, documentation, trends, or statistics, call the appropriate tool first.

Tool usage strategy:
- For documentation/feature questions: use `search_kb` — this searches the Knowledge Base documentation, BASE release notes, AND customer-specific release notes in parallel
- For questions about specific crashes or errors: use `search_analyses` first, then `get_analysis_detail` for specifics
- For "how many" / trend / pattern questions: use `get_trend_data`, `get_error_patterns`, or `get_statistics`
- For signature/recurring crash questions: use `get_top_signatures` or `get_crash_signature`
- For cross-referencing crashes with JIRA: use `correlate_crash_to_jira`
- For understanding crash history: use `get_crash_timeline`
- For comparing two crashes: use `compare_crashes`
- For component health assessment: use `get_component_health`
- For searching JIRA tickets: use `search_jira` with JQL or text
- For creating a bug/ticket: use `create_jira_ticket`
- You can call multiple tools in sequence to build a complete answer
- Always cite your sources (analysis IDs, KB doc titles/URLs, signature hashes, JIRA keys)

## Understanding Source Types
When `search_kb` returns results, they come in three categories:
- **Knowledge Base (KB)**: General BASE documentation for a specific WON release version. Describes features, configuration, and behavior of the standard product.
- **Base Release Notes**: Incremental overview of changes, new features, and bug fixes for each WON release version across the general product.
- **Customer Release Notes**: Customer-specific changes, customizations, and fixes for individual customer implementations (e.g., VRT, BBC, Disney Plus, DPG).

Each documentation extract is tagged with `<documentation>` XML tags containing `<url>`, `<source>`, `<won_version>`, `<customer>`, and `<extract>` fields.

## Response Structure
When answering questions that involve both BASE and customer-specific information:

1. **First**, summarize relevant information from the BASE documentation and release notes.
2. **Then**, if a customer context is active and customer-specific release notes were found, add a separate section titled `#### [Customer Name]` summarizing customer-specific findings.
3. If no documentation was found for the customer, explicitly state: "No customer-specific documentation was available for [customer]."
4. For every factual claim, append the source URL in square brackets, e.g., `[http://example.com/page]`.

## Response Formatting
- Be concise but thorough. Default to 2-3 paragraphs unless asked for more detail.
- When presenting data from multiple sources, use **tables** for structured comparisons.
- When showing chronological data, use **timeline tables** with Date | Event | Details columns.
- When summarizing health or status, use a **structured report** with sections and severity badges.
- Before generating an answer, check the relevance of each documentation extract — not all may be relevant to the question asked.
- Base your response ONLY on retrieved documentation extracts and tool results. Do not make up information not present in the retrieved data.
- If your tool searches return no results, say so honestly and suggest what the user could try.
- Format code references with backticks, use markdown headers for structure.
- Use bold for key findings: **Root Cause**, **Status**, **Severity**."#;

/// Max iterations for the agent tool-calling loop
const MAX_AGENT_ITERATIONS: usize = 5;

// ============================================================================
// Dual Synthesis: BASE + Customer
// ============================================================================

/// Extra instructions appended to the system prompt for BASE-only synthesis.
const BASE_SYNTHESIS_ADDENDUM: &str = "\n\n## Synthesis Scope: BASE Implementation Only\n\
    For this response, focus ONLY on the BASE documentation and BASE release notes.\n\
    Do NOT include or reference customer-specific release notes — that will be handled in a separate section.\n\
    Provide a comprehensive answer based on the general WHATS'ON implementation.";

/// Build a focused system prompt for customer-only synthesis.
fn build_customer_synthesis_prompt(customer_name: &str, customer_xml: &str) -> String {
    format!(
        "You are Ask Hadron, an expert on WHATS'ON customer-specific implementations by Mediagenix.\n\
        \n\
        Based ONLY on the customer-specific release notes provided below, summarize what is specific \
        to {customer}'s implementation that is relevant to the user's question.\n\
        \n\
        ## Rules\n\
        1. Start your response with `#### {customer}`\n\
        2. Base your response ONLY on the customer-specific sources provided below. Do not make up information.\n\
        3. For every factual claim, append the source URL in square brackets immediately after the claim.\n\
        4. If no relevant customer-specific documentation was found in the sources below, respond with exactly:\n\
           \"#### {customer}\\nNo customer-specific documentation was available for {customer}.\"\n\
        5. Be detailed and include all relevant customer-specific information found.\n\
        6. Do not repeat general BASE documentation — focus only on what is specific or different for {customer}.\
        {sources}",
        customer = customer_name,
        sources = customer_xml,
    )
}

/// Check if any search_kb tool result contains customer-specific release notes.
fn has_customer_kb_content(
    tool_results: &[crate::chat_tools::ToolResult],
    tool_names: &[String],
) -> bool {
    tool_results.iter().enumerate().any(|(i, r)| {
        tool_names
            .get(i)
            .map_or(false, |n| n == "search_kb")
            && !r.is_error
            && r.content.contains("### Customer-Specific Release Notes")
    })
}

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
// Tauri Commands
// ============================================================================

/// Run a closure on a dedicated OS thread outside the tokio runtime.
/// Needed because the Keeper SDK uses `reqwest::blocking` internally.
async fn run_off_runtime<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let result = f();
        let _ = tx.send(result);
    });
    rx.await.map_err(|_| "Keeper task was cancelled".to_string())
}

#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    db: tauri::State<'_, Arc<Database>>,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    log::debug!("cmd: chat_send");
    let request_id = request.request_id.clone();
    let chat_start = std::time::Instant::now();

    // Set up cancellation: listen for "chat-cancel" events matching our request_id
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancelled_clone = Arc::clone(&cancelled);
    let cancel_rid = request_id.clone();
    let cancel_listener = app.listen("chat-cancel", move |event| {
        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            if let Some(rid) = payload.get("request_id").and_then(|v| v.as_str()) {
                if cancel_rid.as_deref() == Some(rid) {
                    cancelled_clone.store(true, Ordering::Relaxed);
                    log::info!("Chat request cancelled: {}", rid);
                }
            }
        }
    });

    // Resolve API key: prefer Keeper secret, fall back to the direct key
    let resolved_api_key: Zeroizing<String> = if let Some(ref keeper_uid) = request.keeper_secret_uid {
        let uid = keeper_uid.clone();
        run_off_runtime(move || keeper_service::get_api_key_from_keeper(&uid)).await??
    } else {
        Zeroizing::new(request.api_key.clone())
    };

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

    // Auxiliary model: use cheaper model for internal LLM calls if configured
    let aux_model = request.auxiliary_model.as_deref().unwrap_or(&request.model);

    // Query planning: rewrite follow-ups + bounded decomposition (PR6)
    let retrieval_plan = crate::retrieval::query_planner::plan_retrieval(
        &request.messages,
        &query,
        &request.provider,
        &resolved_api_key,
        aux_model,
    )
    .await;
    let rewritten_query = retrieval_plan.rewritten.clone();

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
        api_key: resolved_api_key.to_string(),
        provider: request.provider.clone(),
        model: aux_model.to_string(),
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

    // Append citation format instructions (PR7)
    system_prompt.push_str(crate::retrieval::citation::CITATION_INSTRUCTIONS);

    // Verbosity control (Ask Hadron 2.0)
    match request.verbosity.as_deref() {
        Some("concise") => {
            system_prompt.push_str("\n\nIMPORTANT: Be brief and concise. Answer in 2-3 sentences maximum unless the user explicitly asks for more detail.");
        }
        Some("detailed") => {
            system_prompt.push_str("\n\nProvide a thorough, detailed response. Include all relevant details, examples, source citations, and explain the reasoning.");
        }
        _ => {} // Default behavior
    }

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

    // Inject sub-query hints from query planner (PR6)
    if !retrieval_plan.sub_queries.is_empty() {
        system_prompt.push_str("\n\n## Retrieval Hints\nThe query planner suggests these searches:\n");
        for sq in &retrieval_plan.sub_queries {
            system_prompt.push_str(&format!(
                "- Tool `{}`: \"{}\"\n",
                sq.tool, sq.query
            ));
        }
        system_prompt.push_str("Use these as guidance for your tool calls, but you may adapt as needed.\n");
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

    // Save clean conversation messages for synthesis calls. The agent loop will
    // append tool_use/tool_result artifacts to agent_messages which confuse the
    // synthesis LLM (especially for OpenAI where role:"tool" messages get dropped).
    // Synthesis uses the reference chatbot pattern: [system+docs, history, query].
    let synthesis_messages = agent_messages.clone();

    // --- Agent loop: LLM → tool calls → execute → loop ---
    let mut total_tool_calls = 0usize;
    let mut all_tool_results: Vec<crate::chat_tools::ToolResult> = Vec::new();
    let mut all_tool_names: Vec<String> = Vec::new();
    let mut all_tool_traces: Vec<ToolTraceEvent> = Vec::new();
    let mut context_summary = ChatContextSummary {
        rag_results: 0,
        kb_results: 0,
        gold_matches: 0,
        fts_results: 0,
        request_id: request_id.clone(),
    };

    for iteration in 0..MAX_AGENT_ITERATIONS {
        // Check for cancellation between iterations
        if cancelled.load(Ordering::Relaxed) {
            app.unlisten(cancel_listener);
            return Err("Request cancelled by user".to_string());
        }

        log::info!("Agent loop iteration {} (tools called so far: {})", iteration, total_tool_calls);

        // Build request with tool definitions (use auxiliary model for tool decisions)
        let request_body = match request.provider.as_str() {
            "anthropic" => build_chat_request_with_tools_anthropic(
                &agent_messages,
                &tools,
                &system_prompt,
                aux_model,
                4000,
            ),
            "llamacpp" => build_chat_request_with_tools_openai(
                &agent_messages,
                &tools,
                &system_prompt,
                aux_model,
                4000,
            ),
            _ => build_chat_request_with_tools_openai(
                &agent_messages,
                &tools,
                &system_prompt,
                aux_model,
                4000,
            ),
        };

        // Call LLM (non-streaming — we need the full response to check for tool calls)
        let response = call_provider_raw_json(
            &request.provider,
            request_body,
            &resolved_api_key,
        )
        .await?;

        // Check if the LLM wants to call tools
        if !response_wants_tools(&response, &request.provider) {
            let _ = app.emit("chat-context", &context_summary);

            // If no tool calls happened at all (first iteration), just chunk-emit
            // the existing response — no need for a second API call.
            if total_tool_calls == 0 {
                let final_text = extract_text_from_response(&response, &request.provider);
                emit_text_as_stream(&app, &final_text, request_id.as_deref()).await;
                let est_tokens = (final_text.len() as f64 / 4.0) as i32;
                app.unlisten(cancel_listener);
                return Ok(ChatResponse {
                    content: final_text,
                    tokens_used: est_tokens,
                    cost: 0.0,
                });
            }

            // Evidence sufficiency gate: check if tool results are sufficient
            let evidence = crate::retrieval::evidence_gate::assess_evidence(
                &all_tool_results,
                &all_tool_names,
            );
            log::info!(
                "Evidence assessment: sufficient={}, confidence={:.2}, reason={}",
                evidence.sufficient, evidence.confidence, evidence.reason
            );

            // Emit diagnostics event
            let unique_tools: Vec<String> = {
                let mut t = all_tool_names.clone();
                t.sort();
                t.dedup();
                t
            };
            let _ = app.emit("chat-diagnostics", ChatDiagnosticsEvent {
                tools_used: unique_tools,
                total_tool_calls,
                retrieval_latency_ms: chat_start.elapsed().as_millis() as u64,
                evidence_sufficient: evidence.sufficient,
                evidence_confidence: evidence.confidence,
                evidence_reason: evidence.reason.clone(),
                rewritten_query: if rewritten_query != query {
                    Some(rewritten_query.clone())
                } else {
                    None
                },
                invalid_citation_count: None, // Set after synthesis
                request_id: request_id.clone(),
                tool_traces: all_tool_traces.clone(),
                total_tokens: 0, // Updated after synthesis
                total_cost: 0.0,
            });

            // Build base system prompt with evidence assessment
            let base_system_prompt = if !evidence.sufficient && total_tool_calls > 0 {
                format!(
                    "{}\n\n## Evidence Assessment\n{}",
                    system_prompt,
                    crate::retrieval::evidence_gate::INSUFFICIENT_EVIDENCE_INSTRUCTION
                )
            } else {
                system_prompt.clone()
            };

            // Check if dual synthesis is needed (customer RN data present)
            let customer_name = request.customer.as_deref().unwrap_or("");
            let use_dual = !customer_name.is_empty()
                && has_customer_kb_content(&all_tool_results, &all_tool_names);

            let (final_content, final_tokens, final_cost) = if use_dual {
                // --- DUAL SYNTHESIS: separate BASE and CUSTOMER calls ---
                log::info!("Dual synthesis mode: BASE + customer '{}'", customer_name);

                let (base_xml, customer_xml) =
                    crate::retrieval::citation::build_partitioned_xml_sources(
                        &all_tool_results,
                        &all_tool_names,
                    );

                // BASE synthesis call
                log::info!("Dual synthesis: base_xml={} chars, customer_xml={} chars", base_xml.len(), customer_xml.len());
                let mut base_prompt = base_system_prompt.clone();
                if !base_xml.is_empty() {
                    base_prompt.push_str(&base_xml);
                    base_prompt.push_str(crate::retrieval::citation::ANSWER_GENERATION_RULES);
                    base_prompt.push_str(BASE_SYNTHESIS_ADDENDUM);
                }

                // Use clean conversation history (not agent_messages with tool-call
                // artifacts) — retrieved context is in the system prompt XML,
                // matching the reference chatbot pattern: [system+docs, history, query].
                let base_body = build_streaming_request(
                    &synthesis_messages,
                    &base_prompt,
                    &request.provider,
                    &request.model,
                    0.0,
                );
                let base_result = call_provider_streaming(
                    &app,
                    &request.provider,
                    base_body,
                    &resolved_api_key,
                    request_id.as_deref(),
                )
                .await;

                let (base_content, base_tokens, base_cost) = match base_result {
                    Ok(resp) => (resp.content, resp.tokens_used, resp.cost),
                    Err(e) => {
                        app.unlisten(cancel_listener);
                        return Err(format!("BASE synthesis failed: {}", e));
                    }
                };

                // Emit separator between base and customer streaming
                let _ = app.emit(
                    "chat-stream",
                    ChatStreamEvent {
                        token: "\n\n".to_string(),
                        done: false,
                        error: None,
                        request_id: request_id.clone(),
                    },
                );

                // CUSTOMER synthesis call
                let customer_prompt =
                    build_customer_synthesis_prompt(customer_name, &customer_xml);
                let customer_body = build_streaming_request(
                    &synthesis_messages,
                    &customer_prompt,
                    &request.provider,
                    &request.model,
                    0.0,
                );
                let customer_result = call_provider_streaming(
                    &app,
                    &request.provider,
                    customer_body,
                    &resolved_api_key,
                    request_id.as_deref(),
                )
                .await;

                let (customer_content, cust_tokens, cust_cost) = match customer_result {
                    Ok(resp) => (resp.content, resp.tokens_used, resp.cost),
                    Err(e) => {
                        log::warn!("Customer synthesis failed, using fallback: {}", e);
                        let fallback = format!(
                            "\n\n#### {}\nNo customer-specific documentation was available for {}.",
                            customer_name, customer_name
                        );
                        emit_text_as_stream(&app, &fallback, request_id.as_deref()).await;
                        (fallback, 0, 0.0)
                    }
                };

                let combined = format!("{}\n\n{}", base_content, customer_content);
                (combined, base_tokens + cust_tokens, base_cost + cust_cost)
            } else {
                // --- SINGLE SYNTHESIS: standard path ---
                let mut final_system_prompt = base_system_prompt;
                let source_xml = crate::retrieval::citation::restructure_tool_results_as_xml(
                    &all_tool_results,
                    &all_tool_names,
                );
                if !source_xml.is_empty() {
                    log::info!("Synthesis: injecting {} chars of XML sources into system prompt", source_xml.len());
                    final_system_prompt.push_str(&source_xml);
                    final_system_prompt
                        .push_str(crate::retrieval::citation::ANSWER_GENERATION_RULES);
                } else {
                    log::warn!("Synthesis: no XML sources to inject — all tool results were empty or errors");
                }

                let stream_body = build_streaming_request(
                    &synthesis_messages,
                    &final_system_prompt,
                    &request.provider,
                    &request.model,
                    0.0,
                );
                let stream_result = call_provider_streaming(
                    &app,
                    &request.provider,
                    stream_body,
                    &resolved_api_key,
                    request_id.as_deref(),
                )
                .await;

                match stream_result {
                    Ok(resp) => (resp.content, resp.tokens_used, resp.cost),
                    Err(e) => {
                        // Fallback: emit the non-streaming text if streaming fails
                        log::warn!("Streaming failed, falling back: {}", e);
                        let final_text =
                            extract_text_from_response(&response, &request.provider);
                        emit_text_as_stream(&app, &final_text, request_id.as_deref()).await;
                        let est_tokens = (final_text.len() as f64 / 4.0) as i32;
                        app.unlisten(cancel_listener);
                        return Ok(ChatResponse {
                            content: final_text,
                            tokens_used: est_tokens,
                            cost: 0.0,
                        });
                    }
                }
            };

            // Post-process citations on the final (possibly combined) content
            let url_title_map =
                crate::retrieval::citation::build_url_title_map(&all_tool_results);
            let processed = crate::retrieval::citation::postprocess_citations(
                &final_content,
                &url_title_map,
            );

            // Validate citations against tool results
            let citations =
                crate::retrieval::citation::extract_citations(&processed.content);
            let invalid = crate::retrieval::citation::validate_citations(
                &citations,
                &all_tool_results,
            );
            if !invalid.is_empty() {
                log::warn!(
                    "Citation validation: {} of {} citations invalid",
                    invalid.len(),
                    citations.len()
                );
                for ic in &invalid {
                    log::warn!("  Invalid citation: {}", ic.reason);
                }
            }

            // Emit post-processed content if citations were transformed
            if !processed.references.is_empty() {
                let _ = app.emit(
                    "chat-final-content",
                    ChatFinalContentEvent {
                        content: processed.content.clone(),
                        references: processed.references,
                        request_id: request_id.clone(),
                    },
                );
            }

            app.unlisten(cancel_listener);
            return Ok(ChatResponse {
                content: processed.content,
                tokens_used: final_tokens,
                cost: final_cost,
            });

        }

        // --- Tool calls detected — execute them ---
        let tool_calls = parse_tool_calls(&response, &request.provider);

        if tool_calls.is_empty() {
            // Unexpected: response_wants_tools was true but no parseable calls
            let final_text = extract_text_from_response(&response, &request.provider);
            let _ = app.emit("chat-context", context_summary);
            emit_text_as_stream(&app, &final_text, request_id.as_deref()).await;

            let est_tokens = (final_text.len() as f64 / 4.0) as i32;
            app.unlisten(cancel_listener);
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
                    request_id: request_id.clone(),
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

        // Execute all tool calls in parallel with timing
        let tool_futures: Vec<_> = tool_calls
            .iter()
            .map(|tc| {
                let ctx = &tool_ctx;
                async move {
                    let start = std::time::Instant::now();
                    let result = execute_tool(tc, ctx).await;
                    let duration_ms = start.elapsed().as_millis() as u64;
                    (result, duration_ms)
                }
            })
            .collect();
        let timed_results: Vec<_> = futures::future::join_all(tool_futures).await;
        let mut iteration_results: Vec<crate::chat_tools::ToolResult> = Vec::new();
        for (tc, (result, duration_ms)) in tool_calls.iter().zip(timed_results.into_iter()) {
            // Build trace
            let preview = if result.content.len() > 200 {
                format!("{}...", &result.content[..200])
            } else {
                result.content.clone()
            };
            all_tool_traces.push(ToolTraceEvent {
                name: tc.name.clone(),
                args: tc.arguments.clone(),
                result_preview: preview,
                duration_ms,
            });
            iteration_results.push(result.clone());
            all_tool_results.push(result);
            all_tool_names.push(tc.name.clone());
            total_tool_calls += 1;
        }

        // Append the assistant's tool-calling message to the conversation
        let assistant_msg = build_assistant_tool_message(&response, &request.provider);
        agent_messages.push(assistant_msg);

        // Append tool results to the conversation
        let result_msgs = build_tool_result_messages(&iteration_results, &request.provider);
        agent_messages.extend(result_msgs);
    }

    // --- Max iterations reached — get a final response via true streaming ---
    log::warn!("Agent loop hit max iterations ({}), requesting final answer with streaming", MAX_AGENT_ITERATIONS);

    let _ = app.emit("chat-context", &context_summary);

    // Evidence gate for max-iterations path
    let evidence = crate::retrieval::evidence_gate::assess_evidence(
        &all_tool_results,
        &all_tool_names,
    );
    let base_system_prompt_b = if !evidence.sufficient && total_tool_calls > 0 {
        format!(
            "{}\n\n## Evidence Assessment\n{}",
            system_prompt,
            crate::retrieval::evidence_gate::INSUFFICIENT_EVIDENCE_INSTRUCTION
        )
    } else {
        system_prompt.clone()
    };

    // Emit diagnostics for max-iterations path
    let unique_tools_b: Vec<String> = {
        let mut t = all_tool_names.clone();
        t.sort();
        t.dedup();
        t
    };
    let _ = app.emit("chat-diagnostics", ChatDiagnosticsEvent {
        tools_used: unique_tools_b,
        total_tool_calls,
        retrieval_latency_ms: chat_start.elapsed().as_millis() as u64,
        evidence_sufficient: evidence.sufficient,
        evidence_confidence: evidence.confidence,
        evidence_reason: evidence.reason.clone(),
        rewritten_query: if rewritten_query != query {
            Some(rewritten_query.clone())
        } else {
            None
        },
        invalid_citation_count: None,
        request_id: request_id.clone(),
        tool_traces: all_tool_traces,
        total_tokens: 0,
        total_cost: 0.0,
    });

    // Check if dual synthesis is needed (customer RN data present)
    let customer_name_b = request.customer.as_deref().unwrap_or("");
    let use_dual_b = !customer_name_b.is_empty()
        && has_customer_kb_content(&all_tool_results, &all_tool_names);

    let (final_content_b, final_tokens_b, final_cost_b) = if use_dual_b {
        // --- DUAL SYNTHESIS (max-iterations path): separate BASE + CUSTOMER calls ---
        log::info!(
            "Max-iter dual synthesis: BASE + customer '{}'",
            customer_name_b
        );

        let (base_xml, customer_xml) =
            crate::retrieval::citation::build_partitioned_xml_sources(
                &all_tool_results,
                &all_tool_names,
            );

        // BASE synthesis call
        let mut base_prompt = base_system_prompt_b.clone();
        if !base_xml.is_empty() {
            base_prompt.push_str(&base_xml);
            base_prompt.push_str(crate::retrieval::citation::ANSWER_GENERATION_RULES);
            base_prompt.push_str(BASE_SYNTHESIS_ADDENDUM);
        }

        // Use clean conversation history — retrieved context is in the system
        // prompt XML, matching the reference chatbot pattern.
        let base_body = build_streaming_request(
            &synthesis_messages,
            &base_prompt,
            &request.provider,
            &request.model,
            0.0,
        );
        let base_result = call_provider_streaming(
            &app,
            &request.provider,
            base_body,
            &resolved_api_key,
            request_id.as_deref(),
        )
        .await;

        let (base_content, base_tokens, base_cost) = match base_result {
            Ok(resp) => (resp.content, resp.tokens_used, resp.cost),
            Err(e) => {
                app.unlisten(cancel_listener);
                return Err(format!("BASE synthesis failed: {}", e));
            }
        };

        // Emit separator between base and customer streaming
        let _ = app.emit(
            "chat-stream",
            ChatStreamEvent {
                token: "\n\n".to_string(),
                done: false,
                error: None,
                request_id: request_id.clone(),
            },
        );

        // CUSTOMER synthesis call
        let customer_prompt =
            build_customer_synthesis_prompt(customer_name_b, &customer_xml);
        let customer_body = build_streaming_request(
            &synthesis_messages,
            &customer_prompt,
            &request.provider,
            &request.model,
            0.0,
        );
        let customer_result = call_provider_streaming(
            &app,
            &request.provider,
            customer_body,
            &resolved_api_key,
            request_id.as_deref(),
        )
        .await;

        let (customer_content, cust_tokens, cust_cost) = match customer_result {
            Ok(resp) => (resp.content, resp.tokens_used, resp.cost),
            Err(e) => {
                log::warn!("Customer synthesis failed, using fallback: {}", e);
                let fallback = format!(
                    "\n\n#### {}\nNo customer-specific documentation was available for {}.",
                    customer_name_b, customer_name_b
                );
                emit_text_as_stream(&app, &fallback, request_id.as_deref()).await;
                (fallback, 0, 0.0)
            }
        };

        let combined = format!("{}\n\n{}", base_content, customer_content);
        (combined, base_tokens + cust_tokens, base_cost + cust_cost)
    } else {
        // --- SINGLE SYNTHESIS (max-iterations path): standard path ---
        let mut final_system_prompt = base_system_prompt_b;
        let source_xml = crate::retrieval::citation::restructure_tool_results_as_xml(
            &all_tool_results,
            &all_tool_names,
        );
        if !source_xml.is_empty() {
            log::info!("Synthesis (max-iter): injecting {} chars of XML sources into system prompt", source_xml.len());
            final_system_prompt.push_str(&source_xml);
            final_system_prompt
                .push_str(crate::retrieval::citation::ANSWER_GENERATION_RULES);
        } else {
            log::warn!("Synthesis (max-iter): no XML sources to inject — all tool results were empty or errors");
        }

        // Use clean conversation history — retrieved context is in the system
        // prompt XML, matching the reference chatbot pattern.
        let stream_body = build_streaming_request(
            &synthesis_messages,
            &final_system_prompt,
            &request.provider,
            &request.model,
            0.0,
        );
        let stream_result = call_provider_streaming(
            &app,
            &request.provider,
            stream_body,
            &resolved_api_key,
            request_id.as_deref(),
        )
        .await;

        match stream_result {
            Ok(resp) => (resp.content, resp.tokens_used, resp.cost),
            Err(e) => {
                // Fallback: non-streaming — use enriched system prompt with XML
                // sources (not base system_prompt which lacks tool results).
                log::warn!("Streaming failed, falling back: {}", e);
                let final_body = match request.provider.as_str() {
                    "anthropic" => build_chat_request_anthropic(
                        &request.messages,
                        &final_system_prompt,
                        &request.model,
                        4000,
                        false,
                    ),
                    _ => build_chat_request_openai(
                        &request.messages,
                        &final_system_prompt,
                        &request.model,
                        4000,
                        false,
                    ),
                };
                let final_response =
                    call_provider_chat(&request.provider, final_body, &resolved_api_key)
                        .await?;
                emit_text_as_stream(
                    &app,
                    &final_response.content,
                    request_id.as_deref(),
                )
                .await;
                (
                    final_response.content,
                    final_response.tokens_used,
                    final_response.cost,
                )
            }
        }
    };

    // Post-process citations on the final (possibly combined) content
    let url_title_map =
        crate::retrieval::citation::build_url_title_map(&all_tool_results);
    let processed = crate::retrieval::citation::postprocess_citations(
        &final_content_b,
        &url_title_map,
    );

    if !processed.references.is_empty() {
        let _ = app.emit(
            "chat-final-content",
            ChatFinalContentEvent {
                content: processed.content.clone(),
                references: processed.references,
                request_id: request_id.clone(),
            },
        );
    }

    app.unlisten(cancel_listener);
    Ok(ChatResponse {
        content: processed.content,
        tokens_used: final_tokens_b,
        cost: final_cost_b,
    })
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
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn chat_submit_feedback(
    db: tauri::State<'_, Arc<Database>>,
    request: ChatFeedbackRequest,
) -> Result<(), String> {
    log::debug!("cmd: chat_submit_feedback");
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
            request.reason.as_deref(),
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
// Chat Feedback Delete (Unrate)
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ChatDeleteFeedbackRequest {
    pub session_id: String,
    pub message_id: String,
}

#[tauri::command]
pub async fn chat_delete_feedback(
    db: tauri::State<'_, Arc<Database>>,
    request: ChatDeleteFeedbackRequest,
) -> Result<(), String> {
    log::debug!("cmd: chat_delete_feedback");
    let log_session = request.session_id.clone();
    let log_msg = request.message_id.clone();

    let db = Arc::clone(&db);
    tokio::task::spawn_blocking(move || {
        db.delete_chat_feedback(&request.session_id, &request.message_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    log::info!("Chat feedback deleted: {} - {}", log_session, log_msg);

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
    log::debug!("cmd: chat_save_session");
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
    log::debug!("cmd: chat_list_sessions");
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
    log::debug!("cmd: chat_get_messages");
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
    log::debug!("cmd: chat_delete_session");
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
    log::debug!("cmd: chat_rename_session");
    let db = Arc::clone(&db);
    tokio::task::spawn_blocking(move || db.update_chat_session_title(&session_id, &title))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))
}

// ============================================================================
// Chat Session Metadata Commands (Ask Hadron 2.0)
// ============================================================================

#[tauri::command]
pub async fn chat_star_session(
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
    starred: bool,
) -> Result<(), String> {
    log::debug!("cmd: chat_star_session");
    db.star_chat_session(&session_id, starred)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_tag_session(
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
    tags: String,
) -> Result<(), String> {
    log::debug!("cmd: chat_tag_session");
    db.tag_chat_session(&session_id, &tags)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_update_session_metadata(
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
    customer: Option<String>,
    won_version: Option<String>,
) -> Result<(), String> {
    log::debug!("cmd: chat_update_session_metadata");
    db.update_chat_session_metadata(
        &session_id,
        customer.as_deref(),
        won_version.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Build a streaming request body for the synthesis LLM call.
///
/// Callers should pass clean conversation messages (e.g. `request.messages`)
/// rather than `agent_messages` which contain tool_use/tool_result artifacts.
/// Retrieved context should be injected via the system prompt as XML sources,
/// following the reference chatbot pattern: `[system+docs, history, query]`.
///
/// This function still filters out any tool-role messages as a safety net.
fn build_streaming_request(
    messages: &[serde_json::Value],
    system_prompt: &str,
    provider: &str,
    model: &str,
    temperature: f64,
) -> serde_json::Value {
    // Filter to user/assistant messages only, stripping any tool artifacts.
    // With clean request.messages this is mostly a no-op safety net.
    let clean_messages: Vec<serde_json::Value> = messages
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
                } else if let Some(blocks) = m["content"].as_array() {
                    let text: String = blocks
                        .iter()
                        .filter(|b| b["type"].as_str() == Some("text"))
                        .filter_map(|b| b["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("\n");
                    if text.is_empty() {
                        json!({"role": "assistant", "content": ""})
                    } else {
                        json!({"role": "assistant", "content": text})
                    }
                } else {
                    json!({"role": "assistant", "content": ""})
                }
            } else {
                m.clone()
            }
        })
        .filter(|m| {
            // Drop empty assistant messages that would confuse the LLM
            !(m["role"].as_str() == Some("assistant")
                && m["content"].as_str().map_or(true, |c| c.is_empty()))
        })
        .collect();

    match provider {
        "anthropic" => json!({
            "model": model,
            "max_tokens": 4000,
            "system": system_prompt,
            "stream": true,
            "temperature": temperature,
            "messages": clean_messages,
        }),
        _ => {
            let mut messages = vec![json!({"role": "system", "content": system_prompt})];
            messages.extend(clean_messages);
            json!({
                "model": model,
                "max_tokens": 4000,
                "stream": true,
                "temperature": temperature,
                "messages": messages,
            })
        }
    }
}

/// Emit text content as chunked stream events for smooth frontend rendering.
/// Async to avoid blocking the Tokio runtime with a tight emit loop.
async fn emit_text_as_stream(app: &AppHandle, text: &str, request_id: Option<&str>) {
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
                request_id: request_id.map(|s| s.to_string()),
            },
        );
        // Yield to the runtime between chunks to avoid blocking
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }

    // Signal completion
    let _ = app.emit(
        "chat-stream",
        ChatStreamEvent {
            token: String::new(),
            done: true,
            error: None,
            request_id: request_id.map(|s| s.to_string()),
        },
    );
}

// ============================================================================
// Retrieval Eval Command
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct RunEvalRequest {
    pub queries: Vec<crate::retrieval::eval::EvalQuery>,
    pub k: Option<usize>,
}

/// Run a set of retrieval evaluation queries and return metrics summary.
/// This is a developer/QA tool — not exposed in the main UI.
#[tauri::command]
pub async fn run_retrieval_eval(
    db: tauri::State<'_, Arc<Database>>,
    request: RunEvalRequest,
) -> Result<serde_json::Value, String> {
    log::debug!("cmd: run_retrieval_eval");
    use crate::retrieval::eval;
    use crate::retrieval::hybrid_analysis;
    use crate::retrieval::RetrievalOptions;

    let k = request.k.unwrap_or(5);
    let mut results = Vec::new();

    for eq in &request.queries {
        let start = std::time::Instant::now();

        // Run analysis search (the primary retrieval path)
        let options = RetrievalOptions {
            query: eq.query.clone(),
            top_k: k,
            ..Default::default()
        };

        let analyses = hybrid_analysis::search(
            &db,
            &options,
            "openai",  // provider (not used for retrieval itself)
            "",        // api_key (not needed for FTS-only search)
            "gpt-4o",  // model (not used for FTS-only search)
        )
        .await;

        let latency_ms = start.elapsed().as_millis() as u64;

        let retrieved_ids: Vec<String> = analyses
            .iter()
            .map(|a| a.id.to_string())
            .collect();

        let result = eval::compute_metrics(
            &eq.query,
            eq.label.as_deref(),
            &retrieved_ids,
            &eq.relevant_ids,
            latency_ms,
            k,
        );

        results.push(result);
    }

    let summary = eval::summarize(results);
    serde_json::to_value(&summary).map_err(|e| format!("Serialization error: {}", e))
}
