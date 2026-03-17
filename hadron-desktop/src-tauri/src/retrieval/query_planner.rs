//! Query Rewrite + Bounded Decomposition
//!
//! Improves multi-turn retrieval by rewriting follow-ups as standalone queries,
//! and decomposing compound questions into max 2 sub-queries.

use serde::{Deserialize, Serialize};

use crate::ai_service::{call_provider_quick, ChatMessage};
use crate::str_utils::floor_char_boundary;

/// Maximum number of sub-queries to prevent explosion
const MAX_SUB_QUERIES: usize = 2;

/// A planned retrieval strategy for a user query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalPlan {
    /// The rewritten standalone query
    pub rewritten: String,
    /// Sub-queries for compound questions (max MAX_SUB_QUERIES)
    pub sub_queries: Vec<SubQuery>,
}

/// A sub-query with routing hints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubQuery {
    /// The search query text
    pub query: String,
    /// Suggested tool to use (e.g., "search_analyses", "search_kb")
    pub tool: String,
    /// Optional filters
    #[serde(default)]
    pub filters: serde_json::Value,
}

const PLANNER_SYSTEM_PROMPT: &str = r#"You are a retrieval query planner for a crash analysis system. Given a conversation and a latest query, produce a JSON object with:
- "rewritten": The latest query rewritten as a standalone search query (incorporating conversation context).
- "sub_queries": An array of 0-2 sub-queries if the question is compound. Each has "query" (string), "tool" (one of: "search_analyses", "search_kb", "search_jira", "get_trend_data"), and optional "filters" (object).

Rules:
- If the query is already standalone, set "rewritten" to the original query.
- Only decompose if the question clearly asks about 2+ different things.
- Keep sub_queries to at most 2.
- Output ONLY valid JSON, no markdown, no explanation.

Example output:
{"rewritten": "NilReceiver crashes in PSI scheduling module", "sub_queries": [{"query": "NilReceiver PSI scheduling crash", "tool": "search_analyses"}, {"query": "PSI scheduling module configuration", "tool": "search_kb"}]}"#;

/// Plan retrieval for a user query: rewrite follow-ups and decompose compound questions.
///
/// Returns the original query unchanged if planning fails or is unnecessary.
pub async fn plan_retrieval(
    messages: &[ChatMessage],
    latest_query: &str,
    provider: &str,
    api_key: &str,
    model: &str,
) -> RetrievalPlan {
    let default = RetrievalPlan {
        rewritten: latest_query.to_string(),
        sub_queries: Vec::new(),
    };

    // Only plan when there's conversation history or the query looks compound
    let user_count = messages.iter().filter(|m| m.role == "user").count();
    let looks_compound = latest_query.contains(" and ")
        || latest_query.contains(" also ")
        || latest_query.matches('?').count() > 1;

    if user_count <= 1 && !looks_compound {
        return default;
    }

    // Build condensed conversation context (last 6 messages)
    let recent: Vec<String> = messages
        .iter()
        .rev()
        .take(6)
        .rev()
        .map(|m| format!("{}: {}", m.role, &m.content[..floor_char_boundary(&m.content, 200)]))
        .collect();

    let planner_input = vec![ChatMessage {
        role: "user".to_string(),
        content: format!(
            "Conversation:\n{}\n\nLatest query: \"{}\"",
            recent.join("\n"),
            latest_query
        ),
    }];

    match call_provider_quick(provider, &planner_input, PLANNER_SYSTEM_PROMPT, api_key, model, 300)
        .await
    {
        Ok(response) => {
            let response = response.trim();
            match serde_json::from_str::<RetrievalPlan>(response) {
                Ok(mut plan) => {
                    // Enforce bounds
                    plan.sub_queries.truncate(MAX_SUB_QUERIES);
                    if plan.rewritten.is_empty() {
                        plan.rewritten = latest_query.to_string();
                    }
                    log::info!(
                        "Query planned: \"{}\" -> \"{}\" ({} sub-queries)",
                        &latest_query[..floor_char_boundary(latest_query, 60)],
                        &plan.rewritten[..floor_char_boundary(&plan.rewritten, 60)],
                        plan.sub_queries.len()
                    );
                    plan
                }
                Err(e) => {
                    log::warn!("Failed to parse retrieval plan: {}", e);
                    default
                }
            }
        }
        Err(e) => {
            log::warn!("Query planning failed: {}", e);
            default
        }
    }
}
