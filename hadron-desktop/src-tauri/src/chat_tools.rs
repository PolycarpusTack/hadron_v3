//! Chat Tool Definitions & Executor
//!
//! Defines the tools available to the Ask Hadron agent and provides
//! execution logic that maps tool calls to existing Hadron capabilities.

use crate::str_utils::floor_char_boundary;

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

use crate::database::Database;
use crate::jira_service;
use crate::rag_commands::{kb_query_internal, OpenSearchConfig};
use crate::retrieval::{hybrid_analysis, RetrievalOptions};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
}

/// JIRA credentials for chatbot tool access
#[derive(Debug, Clone)]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
    pub project_key: Option<String>,
}

/// Configuration passed to tool executor for external service access
pub struct ToolContext {
    pub db: Arc<Database>,
    pub api_key: String,
    pub provider: String,
    pub model: String,
    pub opensearch_config: Option<OpenSearchConfig>,
    pub kb_mode: String,
    pub won_version: Option<String>,
    pub customer: Option<String>,
    pub jira_config: Option<JiraConfig>,
}

// ============================================================================
// Tool Registry
// ============================================================================

pub fn get_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "search_analyses".to_string(),
            description: "Search historical crash analyses by text query. Returns matching analyses ranked by relevance.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query (e.g., 'NilReceiver PSI scheduling', 'Oracle deadlock')"
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["critical", "high", "medium", "low"],
                        "description": "Optional severity filter"
                    },
                    "date_from": {
                        "type": "string",
                        "description": "Optional inclusive start date filter (ISO-8601, e.g., '2025-01-01')"
                    },
                    "date_to": {
                        "type": "string",
                        "description": "Optional inclusive end date filter (ISO-8601, e.g., '2025-06-30')"
                    },
                    "analysis_types": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional filter by error type names (e.g., ['NilReceiver', 'Deadlock'])"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "search_kb".to_string(),
            description: "Search WHATS'ON Knowledge Base documentation and release notes. Use for questions about features, configuration, or what changed in a release.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for KB docs (e.g., 'scheduling engine conflicts', 'PSI namespace')"
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Max results to return (default 8)",
                        "default": 8
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "get_analysis_detail".to_string(),
            description: "Get full details of a specific crash analysis by its ID.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "integer",
                        "description": "The analysis ID number"
                    }
                },
                "required": ["id"]
            }),
        },
        ToolDefinition {
            name: "find_similar_crashes".to_string(),
            description: "Find crashes similar to a given analysis. Matches by error type and component.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "analysis_id": {
                        "type": "integer",
                        "description": "The analysis ID to find similar crashes for"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 5)",
                        "default": 5
                    }
                },
                "required": ["analysis_id"]
            }),
        },
        ToolDefinition {
            name: "get_crash_signature".to_string(),
            description: "Look up a crash signature by hash and get all its occurrences. Use to check if a crash is a known issue.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "hash": {
                        "type": "string",
                        "description": "The signature hash (e.g., 'a3f2b1c4d5e6')"
                    }
                },
                "required": ["hash"]
            }),
        },
        ToolDefinition {
            name: "get_top_signatures".to_string(),
            description: "Get the most frequent crash signatures. Shows recurring crash patterns.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10)",
                        "default": 10
                    },
                    "status": {
                        "type": "string",
                        "enum": ["new", "known", "investigating", "fixed", "wont_fix"],
                        "description": "Filter by signature status"
                    }
                }
            }),
        },
        ToolDefinition {
            name: "get_trend_data".to_string(),
            description: "Get crash trend analytics over a time period. Shows how many crashes occurred per day/week/month.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["day", "week", "month"],
                        "description": "Grouping period"
                    },
                    "range_days": {
                        "type": "integer",
                        "description": "Lookback window in days (default 30)",
                        "default": 30
                    }
                },
                "required": ["period"]
            }),
        },
        ToolDefinition {
            name: "get_error_patterns".to_string(),
            description: "Get the most common error types and their frequency. Useful for understanding what crashes happen most.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10)",
                        "default": 10
                    }
                }
            }),
        },
        ToolDefinition {
            name: "get_statistics".to_string(),
            description: "Get overall database statistics: total analyses, severity breakdown, favorites count.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
        },
        // --- Correlation Tools (Phase 3.1) ---
        ToolDefinition {
            name: "correlate_crash_to_jira".to_string(),
            description: "Find JIRA tickets linked to a crash analysis, or search for related tickets by error type and component.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "analysis_id": {
                        "type": "integer",
                        "description": "The analysis ID to find JIRA links for"
                    }
                },
                "required": ["analysis_id"]
            }),
        },
        ToolDefinition {
            name: "get_crash_timeline".to_string(),
            description: "Build a chronological timeline of a crash signature showing all occurrences, when they were first/last seen, and linked tickets.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "hash": {
                        "type": "string",
                        "description": "The crash signature hash to trace"
                    }
                },
                "required": ["hash"]
            }),
        },
        ToolDefinition {
            name: "compare_crashes".to_string(),
            description: "Compare two crash analyses side-by-side, showing differences in error type, root cause, component, severity, and suggested fixes.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "analysis_id_a": {
                        "type": "integer",
                        "description": "First analysis ID"
                    },
                    "analysis_id_b": {
                        "type": "integer",
                        "description": "Second analysis ID"
                    }
                },
                "required": ["analysis_id_a", "analysis_id_b"]
            }),
        },
        ToolDefinition {
            name: "get_component_health".to_string(),
            description: "Get a health summary for a specific WHATS'ON component: total crashes, severity breakdown, most common errors, trend, and linked JIRA tickets.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "component": {
                        "type": "string",
                        "description": "Component name (e.g., 'PSI', 'Scheduling', 'Oracle', 'API')"
                    }
                },
                "required": ["component"]
            }),
        },
        // --- JIRA Tools (Sprint 2) ---
        ToolDefinition {
            name: "search_jira".to_string(),
            description: "Search JIRA issues by JQL query or text. Returns matching tickets with key, summary, status, assignee, and priority.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "JQL query or text search (e.g., 'project = PSI AND status = Open', 'NilReceiver scheduling crash')"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Max results (default 5)",
                        "default": 5
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "search_gold_answers".to_string(),
            description: "Search verified gold answers from previous support investigations. These are human-verified, trustworthy Q&A pairs. Check here first before searching other sources.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query to find relevant verified answers"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "create_jira_ticket".to_string(),
            description: "Create a new JIRA ticket. Use when the user asks to file a bug or create a ticket from a crash analysis.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "project_key": {
                        "type": "string",
                        "description": "JIRA project key (e.g., 'PSI', 'WON')"
                    },
                    "summary": {
                        "type": "string",
                        "description": "Ticket summary/title"
                    },
                    "description": {
                        "type": "string",
                        "description": "Detailed ticket description"
                    },
                    "issue_type": {
                        "type": "string",
                        "enum": ["Bug", "Task", "Story"],
                        "description": "Issue type (default: Bug)"
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["Highest", "High", "Medium", "Low", "Lowest"],
                        "description": "Priority level (default: Medium)"
                    }
                },
                "required": ["project_key", "summary", "description"]
            }),
        },
        ToolDefinition {
            name: "investigate_jira_ticket".to_string(),
            description: "Run a full investigation on a JIRA ticket. Returns structured evidence: changelog, comments, worklogs, related issues, Confluence docs, attachment signals, hypotheses, and open questions. Use when a user asks to investigate or deep-dive into a ticket.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ticket_key": {
                        "type": "string",
                        "description": "The JIRA ticket key, e.g. BR-997 or SRF-1165"
                    }
                },
                "required": ["ticket_key"]
            }),
        },
        ToolDefinition {
            name: "investigate_regression_family".to_string(),
            description: "Find all related historical issues that may be siblings or predecessors of the given ticket — across the same project (90 days) and cross-project (6 months). Use when a user suspects a regression.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ticket_key": {
                        "type": "string",
                        "description": "The JIRA ticket key to find regression siblings for"
                    }
                },
                "required": ["ticket_key"]
            }),
        },
        ToolDefinition {
            name: "investigate_expected_behavior".to_string(),
            description: "Look up expected behavior and documentation for a feature or component. Searches Confluence, MOD documentation, and the WHATS'ON knowledge base.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ticket_key": {
                        "type": "string",
                        "description": "The JIRA ticket key providing context (may be empty)"
                    },
                    "query": {
                        "type": "string",
                        "description": "What to look up, e.g. 'EPG scheduling rules' or 'import pipeline'"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "investigate_customer_history".to_string(),
            description: "Retrieve all tickets reported by the same customer/reporter as the given ticket. Useful for pattern detection across a customer's issue history.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ticket_key": {
                        "type": "string",
                        "description": "The JIRA ticket key whose reporter's history to fetch"
                    }
                },
                "required": ["ticket_key"]
            }),
        },
        ToolDefinition {
            name: "search_confluence".to_string(),
            description: "Search Confluence for documentation pages. Accepts free-text queries or CQL. Returns titles, excerpts, and URLs.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query or CQL expression"
                    },
                    "space_key": {
                        "type": "string",
                        "description": "Optional Confluence space key to restrict the search"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results to return (default 10)"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "get_confluence_page".to_string(),
            description: "Fetch a specific Confluence page by its content ID. Returns title, body text, and URL.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "content_id": {
                        "type": "string",
                        "description": "The Confluence page content ID"
                    }
                },
                "required": ["content_id"]
            }),
        },
    ]
}

// ============================================================================
// Tool Executor
// ============================================================================

pub async fn execute_tool(
    tool_call: &ParsedToolCall,
    ctx: &ToolContext,
) -> ToolResult {
    let result = match tool_call.name.as_str() {
        "search_analyses" => execute_search_analyses(&tool_call.arguments, ctx).await,
        "search_kb" => execute_search_kb(&tool_call.arguments, ctx).await,
        "get_analysis_detail" => execute_get_analysis_detail(&tool_call.arguments, ctx).await,
        "find_similar_crashes" => execute_find_similar_crashes(&tool_call.arguments, ctx).await,
        "get_crash_signature" => execute_get_crash_signature(&tool_call.arguments, ctx).await,
        "get_top_signatures" => execute_get_top_signatures(&tool_call.arguments, ctx).await,
        "get_trend_data" => execute_get_trend_data(&tool_call.arguments, ctx).await,
        "get_error_patterns" => execute_get_error_patterns(&tool_call.arguments, ctx).await,
        "get_statistics" => execute_get_statistics(ctx).await,
        "correlate_crash_to_jira" => execute_correlate_crash_to_jira(&tool_call.arguments, ctx).await,
        "get_crash_timeline" => execute_get_crash_timeline(&tool_call.arguments, ctx).await,
        "compare_crashes" => execute_compare_crashes(&tool_call.arguments, ctx).await,
        "get_component_health" => execute_get_component_health(&tool_call.arguments, ctx).await,
        "search_gold_answers" => execute_search_gold_answers(&tool_call.arguments, ctx).await,
        "search_jira" => execute_search_jira(&tool_call.arguments, ctx).await,
        "create_jira_ticket" => execute_create_jira_ticket(&tool_call.arguments, ctx).await,
        "investigate_jira_ticket" => execute_investigate_ticket(&tool_call.arguments, ctx).await,
        "investigate_regression_family" => execute_investigate_regression(&tool_call.arguments, ctx).await,
        "investigate_expected_behavior" => execute_investigate_expected(&tool_call.arguments, ctx).await,
        "investigate_customer_history" => execute_investigate_customer(&tool_call.arguments, ctx).await,
        "search_confluence" => execute_search_confluence(&tool_call.arguments, ctx).await,
        "get_confluence_page" => execute_get_confluence_page(&tool_call.arguments, ctx).await,
        _ => Err(format!("Unknown tool: {}", tool_call.name)),
    };

    match result {
        Ok(content) => ToolResult {
            tool_use_id: tool_call.id.clone(),
            content,
            is_error: false,
        },
        Err(e) => ToolResult {
            tool_use_id: tool_call.id.clone(),
            content: format!("Error: {}", e),
            is_error: true,
        },
    }
}

// ============================================================================
// Individual Tool Handlers
// ============================================================================

async fn execute_search_analyses(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let query = args["query"]
        .as_str()
        .ok_or("Missing 'query' parameter")?
        .to_string();
    let severity = args["severity"].as_str().map(|s| s.to_string());
    let date_from = args["date_from"].as_str().map(|s| s.to_string());
    let date_to = args["date_to"].as_str().map(|s| s.to_string());
    let analysis_types: Option<Vec<String>> = args["analysis_types"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

    let options = RetrievalOptions {
        query: query.clone(),
        top_k: 10,
        severity,
        date_from,
        date_to,
        analysis_types,
        ..Default::default()
    };

    let results = hybrid_analysis::search(
        &ctx.db,
        &options,
        &ctx.provider,
        &ctx.api_key,
        &ctx.model,
    )
    .await;

    if results.is_empty() {
        return Ok("No analyses found matching the query.".to_string());
    }

    let mut output = format!("Found {} analyses:\n\n", results.len().min(10));
    for analysis in results.iter().take(10) {
        output.push_str(&format!(
            "**[Analysis #{}](hadron://analysis/{})** — {} ({})\n- Error: {}\n- Root Cause: {}\n- Component: {}\n- Date: {}\n\n",
            analysis.id,
            analysis.id,
            analysis.filename,
            analysis.severity,
            analysis.error_type,
            truncate(&analysis.root_cause, 200),
            analysis.component.as_deref().unwrap_or("unknown"),
            analysis.analyzed_at,
        ));
    }

    Ok(output)
}

async fn execute_search_kb(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let query = args["query"]
        .as_str()
        .ok_or("Missing 'query' parameter")?;
    let top_k = args["top_k"].as_u64().unwrap_or(8) as usize;

    let result = kb_query_internal(
        query,
        &ctx.kb_mode,
        ctx.opensearch_config.clone(),
        ctx.won_version.clone(),
        ctx.customer.clone(),
        top_k,
        &ctx.api_key,
    )
    .await
    .map_err(|e| format!("KB search error: {}", e))?;

    let total = result.kb_results.len()
        + result.base_rn_results.len()
        + result.customer_rn_results.len();
    if total == 0 {
        return Ok("No Knowledge Base documents found matching the query.".to_string());
    }

    let mut output = format!("Found {} documents ({} KB docs, {} base release notes, {} customer release notes):\n\n",
        total, result.kb_results.len(), result.base_rn_results.len(), result.customer_rn_results.len());

    // Format KB documentation results with XML-style tags for structured extraction
    if !result.kb_results.is_empty() {
        output.push_str("### BASE Documentation\n\n");
        for item in &result.kb_results {
            output.push_str("<documentation>\n");
            if item.link.is_empty() {
                output.push_str(&format!("  <url></url>\n"));
            } else {
                output.push_str(&format!("  <url>{}</url>\n", item.link));
            }
            output.push_str("  <source>Knowledge Base</source>\n");
            output.push_str(&format!("  <won_version>{}</won_version>\n", item.won_version));
            output.push_str(&format!(
                "  <page_title>{}</page_title>\n",
                item.page_title
            ));
            output.push_str(&format!(
                "  <extract>{}</extract>\n",
                truncate(&item.text, 1200)
            ));
            output.push_str("</documentation>\n\n");
        }
    }

    // Format base release notes
    if !result.base_rn_results.is_empty() {
        output.push_str("### BASE Release Notes\n\n");
        for item in &result.base_rn_results {
            output.push_str("<documentation>\n");
            if item.link.is_empty() {
                output.push_str(&format!("  <url></url>\n"));
            } else {
                output.push_str(&format!("  <url>{}</url>\n", item.link));
            }
            output.push_str("  <source>Base Release Notes</source>\n");
            output.push_str(&format!("  <won_version>{}</won_version>\n", item.won_version));
            output.push_str(&format!(
                "  <page_title>{}</page_title>\n",
                item.page_title
            ));
            output.push_str(&format!(
                "  <extract>{}</extract>\n",
                truncate(&item.text, 1200)
            ));
            output.push_str("</documentation>\n\n");
        }
    }

    // Format customer-specific release notes
    if !result.customer_rn_results.is_empty() {
        output.push_str(&format!(
            "### Customer-Specific Release Notes ({})\n\n",
            result.customer_rn_results.first().map(|r| r.customer.as_str()).unwrap_or("unknown")
        ));
        for item in &result.customer_rn_results {
            output.push_str("<documentation>\n");
            if item.link.is_empty() {
                output.push_str(&format!("  <url></url>\n"));
            } else {
                output.push_str(&format!("  <url>{}</url>\n", item.link));
            }
            output.push_str("  <source>Customer Release Notes</source>\n");
            output.push_str(&format!("  <won_version>{}</won_version>\n", item.won_version));
            output.push_str(&format!("  <customer>{}</customer>\n", item.customer));
            output.push_str(&format!(
                "  <page_title>{}</page_title>\n",
                item.page_title
            ));
            output.push_str(&format!(
                "  <extract>{}</extract>\n",
                truncate(&item.text, 1200)
            ));
            output.push_str("</documentation>\n\n");
        }
    }

    // Fallback: if the new separated fields are empty but legacy release_note_results
    // has data (e.g., from Python fallback), format those too
    if result.base_rn_results.is_empty()
        && result.customer_rn_results.is_empty()
        && !result.release_note_results.is_empty()
    {
        output.push_str("### Release Notes\n\n");
        for item in &result.release_note_results {
            output.push_str("<documentation>\n");
            if item.link.is_empty() {
                output.push_str(&format!("  <url></url>\n"));
            } else {
                output.push_str(&format!("  <url>{}</url>\n", item.link));
            }
            output.push_str(&format!("  <source>{}</source>\n", item.source_type));
            output.push_str(&format!("  <won_version>{}</won_version>\n", item.won_version));
            if !item.customer.is_empty() {
                output.push_str(&format!("  <customer>{}</customer>\n", item.customer));
            }
            output.push_str(&format!(
                "  <page_title>{}</page_title>\n",
                item.page_title
            ));
            output.push_str(&format!(
                "  <extract>{}</extract>\n",
                truncate(&item.text, 1200)
            ));
            output.push_str("</documentation>\n\n");
        }
    }

    Ok(output)
}

async fn execute_get_analysis_detail(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let id = args["id"]
        .as_i64()
        .ok_or("Missing 'id' parameter")?;

    let db = Arc::clone(&ctx.db);
    let analysis = tokio::task::spawn_blocking(move || db.get_analysis_by_id(id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    let fixes: Vec<String> = serde_json::from_str(&analysis.suggested_fixes).unwrap_or_default();

    Ok(format!(
        "**[Analysis #{}](hadron://analysis/{})**: {}\n\n\
         - **Error Type**: {}\n\
         - **Error Message**: {}\n\
         - **Severity**: {}\n\
         - **Component**: {}\n\
         - **Root Cause**: {}\n\
         - **Suggested Fixes**:\n{}\n\
         - **Confidence**: {}\n\
         - **Date**: {}\n\
         - **Model**: {} ({})\n\
         - **Type**: {}",
        analysis.id,
        analysis.id,
        analysis.filename,
        analysis.error_type,
        analysis.error_message.as_deref().unwrap_or("N/A"),
        analysis.severity,
        analysis.component.as_deref().unwrap_or("unknown"),
        analysis.root_cause,
        fixes.iter().enumerate().map(|(i, f)| format!("  {}. {}", i + 1, f)).collect::<Vec<_>>().join("\n"),
        analysis.confidence.as_deref().unwrap_or("N/A"),
        analysis.analyzed_at,
        analysis.ai_model,
        analysis.ai_provider.as_deref().unwrap_or("unknown"),
        analysis.analysis_type,
    ))
}

async fn execute_find_similar_crashes(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let analysis_id = args["analysis_id"]
        .as_i64()
        .ok_or("Missing 'analysis_id' parameter")?;
    let limit = args["limit"].as_i64().unwrap_or(5) as i32;

    let db = Arc::clone(&ctx.db);
    let results = tokio::task::spawn_blocking(move || {
        db.get_similar_analyses(analysis_id, limit)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    if results.is_empty() {
        return Ok("No similar crashes found.".to_string());
    }

    let mut output = format!("Found {} similar crashes:\n\n", results.len());
    for a in &results {
        output.push_str(&format!(
            "- **#{}** {} ({}) — {}: {}\n",
            a.id, a.filename, a.severity, a.error_type,
            truncate(&a.root_cause, 100),
        ));
    }

    Ok(output)
}

async fn execute_get_crash_signature(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let hash = args["hash"]
        .as_str()
        .ok_or("Missing 'hash' parameter")?
        .to_string();

    let db = Arc::clone(&ctx.db);
    let db2 = Arc::clone(&ctx.db);
    let hash2 = hash.clone();

    let sig = tokio::task::spawn_blocking(move || db.find_signature_by_hash(&hash))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    match sig {
        Some(sig) => {
            let files = tokio::task::spawn_blocking(move || {
                db2.get_analyses_for_signature(&hash2)
            })
            .await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| format!("Database error: {}", e))?;

            let mut output = format!(
                "**Signature**: `{}`\n\
                 - **Canonical**: {}\n\
                 - **Status**: {}\n\
                 - **Occurrences**: {}\n\
                 - **First seen**: {}\n\
                 - **Last seen**: {}\n",
                sig.hash, sig.canonical, sig.status, sig.occurrence_count,
                sig.first_seen, sig.last_seen,
            );

            if let Some(ticket) = &sig.linked_ticket {
                output.push_str(&format!("- **Linked Ticket**: {}\n", ticket));
            }

            if !files.is_empty() {
                output.push_str(&format!("\n**Affected files** ({}):\n", files.len()));
                for f in files.iter().take(10) {
                    output.push_str(&format!(
                        "  - #{} {} ({}) — {}\n",
                        f.id, f.filename, f.severity.as_deref().unwrap_or("?"), f.analyzed_at
                    ));
                }
            }

            Ok(output)
        }
        None => Ok(format!("No signature found with hash '{}'.", hash2)),
    }
}

async fn execute_get_top_signatures(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let limit = args["limit"].as_u64().unwrap_or(10) as usize;
    let status = args["status"].as_str().map(|s| s.to_string());

    let db = Arc::clone(&ctx.db);
    let sigs = tokio::task::spawn_blocking(move || {
        db.get_top_signatures(limit, status.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    if sigs.is_empty() {
        return Ok("No crash signatures found.".to_string());
    }

    let mut output = format!("Top {} crash signatures:\n\n", sigs.len());
    output.push_str("| # | Hash | Canonical | Occurrences | Status | Ticket |\n");
    output.push_str("|---|------|-----------|-------------|--------|--------|\n");
    for (i, sig) in sigs.iter().enumerate() {
        output.push_str(&format!(
            "| {} | `{}` | {} | {} | {} | {} |\n",
            i + 1,
            sig.hash,
            truncate(&sig.canonical, 40),
            sig.occurrence_count,
            sig.status,
            sig.linked_ticket.as_deref().unwrap_or("-"),
        ));
    }

    Ok(output)
}

async fn execute_get_trend_data(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let period = args["period"]
        .as_str()
        .ok_or("Missing 'period' parameter")?
        .to_string();
    let range_days = args["range_days"].as_i64().unwrap_or(30) as i32;

    let db = Arc::clone(&ctx.db);
    let period_clone = period.clone();
    let trends = tokio::task::spawn_blocking(move || db.get_trend_data(&period_clone, range_days))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    if trends.is_empty() {
        return Ok(format!("No data for the last {} days.", range_days));
    }

    let mut output = format!("Crash trends (last {} days, grouped by {}):\n\n", range_days, period);
    output.push_str("| Period | Total | Critical | High | Medium | Low |\n");
    output.push_str("|--------|-------|----------|------|--------|-----|\n");
    for t in &trends {
        output.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} |\n",
            t.period, t.total, t.critical_count, t.high_count, t.medium_count, t.low_count,
        ));
    }

    let total: i32 = trends.iter().map(|t| t.total).sum();
    let critical: i32 = trends.iter().map(|t| t.critical_count).sum();
    output.push_str(&format!(
        "\n**Summary**: {} total crashes, {} critical.",
        total, critical,
    ));

    Ok(output)
}

async fn execute_get_error_patterns(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let limit = args["limit"].as_i64().unwrap_or(10) as i32;

    let db = Arc::clone(&ctx.db);
    let patterns = tokio::task::spawn_blocking(move || db.get_top_error_patterns(limit))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    if patterns.is_empty() {
        return Ok("No error patterns found.".to_string());
    }

    let mut output = format!("Top {} error patterns:\n\n", patterns.len());
    output.push_str("| # | Error Type | Component | Count |\n");
    output.push_str("|---|-----------|-----------|-------|\n");
    for (i, p) in patterns.iter().enumerate() {
        output.push_str(&format!(
            "| {} | {} | {} | {} |\n",
            i + 1,
            p.error_type,
            p.component.as_deref().unwrap_or("-"),
            p.count,
        ));
    }

    Ok(output)
}

async fn execute_get_statistics(ctx: &ToolContext) -> Result<String, String> {
    let db = Arc::clone(&ctx.db);
    let stats = tokio::task::spawn_blocking(move || db.get_statistics())
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    Ok(format!(
        "Database Statistics:\n\n```json\n{}\n```",
        serde_json::to_string_pretty(&stats).unwrap_or_else(|_| stats.to_string())
    ))
}

// ============================================================================
// Correlation Tool Handlers (Phase 3.1)
// ============================================================================

async fn execute_correlate_crash_to_jira(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let analysis_id = args["analysis_id"]
        .as_i64()
        .ok_or("Missing 'analysis_id' parameter")?;

    let db = Arc::clone(&ctx.db);
    let db2 = Arc::clone(&ctx.db);
    let aid = analysis_id;

    // Get JIRA links for this analysis
    let jira_links = tokio::task::spawn_blocking(move || db.get_jira_links_for_analysis(aid))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    // Also get the analysis to show context
    let analysis = tokio::task::spawn_blocking(move || db2.get_analysis_by_id(analysis_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    let mut output = format!(
        "**Analysis #{}** — {} ({}, {})\n\n",
        analysis.id, analysis.filename, analysis.error_type,
        analysis.component.as_deref().unwrap_or("unknown"),
    );

    if jira_links.is_empty() {
        output.push_str("No JIRA tickets linked to this analysis.\n");
    } else {
        output.push_str(&format!("**Linked JIRA Tickets** ({}):\n\n", jira_links.len()));
        output.push_str("| Key | Summary | Status | Priority | Link Type |\n");
        output.push_str("|-----|---------|--------|----------|----------|\n");
        for link in &jira_links {
            output.push_str(&format!(
                "| {} | {} | {} | {} | {} |\n",
                link.jira_key,
                link.jira_summary.as_deref().unwrap_or("-"),
                link.jira_status.as_deref().unwrap_or("-"),
                link.jira_priority.as_deref().unwrap_or("-"),
                link.link_type,
            ));
        }
    }

    Ok(output)
}

async fn execute_get_crash_timeline(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let hash = args["hash"]
        .as_str()
        .ok_or("Missing 'hash' parameter")?
        .to_string();

    let db = Arc::clone(&ctx.db);
    let db2 = Arc::clone(&ctx.db);
    let hash2 = hash.clone();

    // Get signature info
    let sig = tokio::task::spawn_blocking(move || db.find_signature_by_hash(&hash))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    let sig = match sig {
        Some(s) => s,
        None => return Ok(format!("No signature found with hash '{}'.", hash2)),
    };

    // Get all analyses for this signature
    let files = tokio::task::spawn_blocking(move || db2.get_analyses_for_signature(&hash2))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Database error: {}", e))?;

    let mut output = format!(
        "## Crash Timeline: `{}`\n\n**Canonical**: {}\n**Status**: {}\n**Total occurrences**: {}\n\n",
        sig.hash,
        sig.canonical,
        sig.status,
        sig.occurrence_count,
    );

    if let Some(ticket) = &sig.linked_ticket {
        output.push_str(&format!("**Linked Ticket**: {}\n\n", ticket));
    }

    output.push_str("### Chronological Timeline\n\n");
    output.push_str("| Date | Event | Details |\n");
    output.push_str("|------|-------|--------|\n");

    // First seen
    output.push_str(&format!(
        "| {} | First seen | Signature registered |\n",
        sig.first_seen
    ));

    // Each occurrence
    for f in &files {
        output.push_str(&format!(
            "| {} | Analysis #{} | {} ({}) |\n",
            f.analyzed_at, f.id, f.filename,
            f.severity.as_deref().unwrap_or("?"),
        ));
    }

    // Last seen
    if sig.last_seen != sig.first_seen {
        output.push_str(&format!(
            "| {} | Last seen | Most recent occurrence |\n",
            sig.last_seen
        ));
    }

    Ok(output)
}

async fn execute_compare_crashes(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let id_a = args["analysis_id_a"]
        .as_i64()
        .ok_or("Missing 'analysis_id_a' parameter")?;
    let id_b = args["analysis_id_b"]
        .as_i64()
        .ok_or("Missing 'analysis_id_b' parameter")?;

    let db_a = Arc::clone(&ctx.db);
    let db_b = Arc::clone(&ctx.db);

    let (analysis_a, analysis_b) = tokio::try_join!(
        async {
            tokio::task::spawn_blocking(move || db_a.get_analysis_by_id(id_a))
                .await
                .map_err(|e| format!("Task error: {}", e))?
                .map_err(|e| format!("Database error: {}", e))
        },
        async {
            tokio::task::spawn_blocking(move || db_b.get_analysis_by_id(id_b))
                .await
                .map_err(|e| format!("Task error: {}", e))?
                .map_err(|e| format!("Database error: {}", e))
        }
    )?;

    let fixes_a: Vec<String> =
        serde_json::from_str(&analysis_a.suggested_fixes).unwrap_or_default();
    let fixes_b: Vec<String> =
        serde_json::from_str(&analysis_b.suggested_fixes).unwrap_or_default();

    let same_or_diff = |a: &str, b: &str| -> &'static str {
        if a == b { "Same" } else { "**Different**" }
    };

    let mut output = format!(
        "## Comparison: Analysis #{} vs #{}\n\n",
        analysis_a.id, analysis_b.id
    );

    output.push_str("| Attribute | Analysis A | Analysis B | Match |\n");
    output.push_str("|-----------|-----------|-----------|-------|\n");
    output.push_str(&format!(
        "| **File** | {} | {} | {} |\n",
        analysis_a.filename, analysis_b.filename,
        same_or_diff(&analysis_a.filename, &analysis_b.filename),
    ));
    output.push_str(&format!(
        "| **Error Type** | {} | {} | {} |\n",
        analysis_a.error_type, analysis_b.error_type,
        same_or_diff(&analysis_a.error_type, &analysis_b.error_type),
    ));
    output.push_str(&format!(
        "| **Severity** | {} | {} | {} |\n",
        analysis_a.severity, analysis_b.severity,
        same_or_diff(&analysis_a.severity, &analysis_b.severity),
    ));
    let comp_a = analysis_a.component.as_deref().unwrap_or("unknown");
    let comp_b = analysis_b.component.as_deref().unwrap_or("unknown");
    output.push_str(&format!(
        "| **Component** | {} | {} | {} |\n",
        comp_a, comp_b, same_or_diff(comp_a, comp_b),
    ));
    output.push_str(&format!(
        "| **Type** | {} | {} | {} |\n",
        analysis_a.analysis_type, analysis_b.analysis_type,
        same_or_diff(&analysis_a.analysis_type, &analysis_b.analysis_type),
    ));
    output.push_str(&format!(
        "| **Date** | {} | {} | |\n",
        analysis_a.analyzed_at, analysis_b.analyzed_at,
    ));

    output.push_str(&format!(
        "\n**Root Cause A**: {}\n\n**Root Cause B**: {}\n",
        truncate(&analysis_a.root_cause, 300),
        truncate(&analysis_b.root_cause, 300),
    ));

    if !fixes_a.is_empty() || !fixes_b.is_empty() {
        output.push_str("\n**Fixes A**:\n");
        for (i, f) in fixes_a.iter().enumerate() {
            output.push_str(&format!("  {}. {}\n", i + 1, f));
        }
        output.push_str("\n**Fixes B**:\n");
        for (i, f) in fixes_b.iter().enumerate() {
            output.push_str(&format!("  {}. {}\n", i + 1, f));
        }
    }

    Ok(output)
}

async fn execute_get_component_health(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let component = args["component"]
        .as_str()
        .ok_or("Missing 'component' parameter")?
        .to_string();

    // Search for all analyses matching this component
    let db = Arc::clone(&ctx.db);
    let comp_query = component.clone();
    let analyses = tokio::task::spawn_blocking(move || {
        db.search_analyses(&comp_query, None)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    // Filter to analyses that actually match the component
    let component_lower = component.to_lowercase();
    let matching: Vec<_> = analyses
        .iter()
        .filter(|a| {
            a.component
                .as_deref()
                .map(|c| c.to_lowercase().contains(&component_lower))
                .unwrap_or(false)
                || a.error_type.to_lowercase().contains(&component_lower)
                || a.root_cause.to_lowercase().contains(&component_lower)
        })
        .collect();

    if matching.is_empty() {
        return Ok(format!(
            "No analyses found related to component '{}'.",
            component
        ));
    }

    // Compute severity breakdown
    let mut critical = 0;
    let mut high = 0;
    let mut medium = 0;
    let mut low = 0;
    let mut error_types: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for a in &matching {
        match a.severity.to_lowercase().as_str() {
            "critical" => critical += 1,
            "high" => high += 1,
            "medium" => medium += 1,
            _ => low += 1,
        }
        *error_types.entry(a.error_type.clone()).or_insert(0) += 1;
    }

    let mut output = format!(
        "## Component Health: {}\n\n**Total Crashes**: {}\n\n",
        component, matching.len()
    );

    output.push_str("### Severity Breakdown\n");
    output.push_str(&format!(
        "| Critical | High | Medium | Low |\n|----------|------|--------|-----|\n| {} | {} | {} | {} |\n\n",
        critical, high, medium, low
    ));

    // Top error types
    let mut error_sorted: Vec<_> = error_types.into_iter().collect();
    error_sorted.sort_by(|a, b| b.1.cmp(&a.1));

    output.push_str("### Top Error Types\n");
    for (error, count) in error_sorted.iter().take(5) {
        output.push_str(&format!("- **{}**: {} occurrences\n", error, count));
    }

    // Most recent crashes
    output.push_str(&format!(
        "\n### Recent Crashes (last {})\n",
        matching.len().min(5)
    ));
    for a in matching.iter().take(5) {
        output.push_str(&format!(
            "- **#{}** {} ({}) — {} — {}\n",
            a.id,
            a.filename,
            a.severity,
            a.error_type,
            truncate(&a.root_cause, 80),
        ));
    }

    Ok(output)
}

// ============================================================================
// Gold Answer Tool Handlers (Ask Hadron 2.0)
// ============================================================================

async fn execute_search_gold_answers(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let query = args["query"].as_str().ok_or("Missing 'query'")?;
    let results = ctx
        .db
        .search_gold_answers(query, 5)
        .map_err(|e| e.to_string())?;

    if results.is_empty() {
        return Ok("No verified gold answers found for this query.".to_string());
    }

    let mut output = format!("Found {} verified gold answer(s):\n\n", results.len());
    for ga in &results {
        output.push_str(&format!(
            "**[Gold Answer #{}]** ({})\n- **Q:** {}\n- **A:** {}\n- Tags: {}\n\n",
            ga.id,
            ga.created_at,
            if ga.question.len() > 200 {
                let end = floor_char_boundary(&ga.question, 200);
                format!("{}...", &ga.question[..end])
            } else {
                ga.question.clone()
            },
            if ga.answer.len() > 500 {
                let end = floor_char_boundary(&ga.answer, 500);
                format!("{}...", &ga.answer[..end])
            } else {
                ga.answer.clone()
            },
            ga.tags.as_deref().unwrap_or("none"),
        ));
    }
    Ok(output)
}

// ============================================================================
// JIRA Tool Handlers (Sprint 2)
// ============================================================================

async fn execute_search_jira(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let jira = ctx
        .jira_config
        .as_ref()
        .ok_or("JIRA is not configured. Please set up JIRA credentials in Settings.")?;

    let query = args["query"]
        .as_str()
        .ok_or("Missing 'query' parameter")?
        .to_string();
    let max_results = args["max_results"].as_i64().unwrap_or(5) as i32;

    // Detect bare JIRA ticket keys (e.g. "MGX-56673") — full-text search returns 0 results
    // for exact keys; they require `key =` lookup.
    let looks_like_ticket_key = {
        let trimmed = query.trim();
        if !trimmed.contains(' ') {
            if let Some(dash_pos) = trimmed.find('-') {
                let project = &trimmed[..dash_pos];
                let number = &trimmed[dash_pos + 1..];
                !project.is_empty()
                    && project.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                    && project.chars().next().map_or(false, |c| c.is_ascii_uppercase())
                    && !number.is_empty()
                    && number.chars().all(|c| c.is_ascii_digit())
            } else {
                false
            }
        } else {
            false
        }
    };
    let jql = if looks_like_ticket_key {
        format!("key = \"{}\" ORDER BY updated DESC", query.trim())
    } else if query.contains('=') || query.contains("ORDER BY") || query.starts_with("project") {
        query.clone()
    } else {
        format!("text ~ \"{}\" ORDER BY updated DESC", query.replace('"', "\\\""))
    };

    let result = jira_service::search_jira_issues(
        jira.base_url.clone(),
        jira.email.clone(),
        jira.api_token.clone(),
        jql,
        max_results,
        false, // don't include comments for search results
    )
    .await
    .map_err(|e| format!("JIRA search failed: {}", e))?;

    if result.issues.is_empty() {
        return Ok(format!("No JIRA issues found matching '{}'.", query));
    }

    let mut output = format!("Found {} JIRA issues:\n\n", result.issues.len());
    output.push_str("| Key | Summary | Status | Priority | Assignee | Type |\n");
    output.push_str("|-----|---------|--------|----------|----------|------|\n");

    for issue in &result.issues {
        let assignee = issue
            .fields
            .assignee
            .as_ref()
            .map(|a| a.display_name.as_str())
            .unwrap_or("Unassigned");
        let priority = issue
            .fields
            .priority
            .as_ref()
            .map(|p| p.name.as_str())
            .unwrap_or("-");

        output.push_str(&format!(
            "| [{}]({}/browse/{}) | {} | {} | {} | {} | {} |\n",
            issue.key,
            jira.base_url.trim_end_matches('/'),
            issue.key,
            truncate(&issue.fields.summary, 60),
            issue.fields.status.name,
            priority,
            assignee,
            issue.fields.issuetype.name,
        ));
    }

    Ok(output)
}

async fn execute_create_jira_ticket(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let jira = ctx
        .jira_config
        .as_ref()
        .ok_or("JIRA is not configured. Please set up JIRA credentials in Settings.")?;

    let project_key = args["project_key"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| jira.project_key.clone())
        .ok_or("Missing 'project_key' parameter and no default JIRA project configured")?;
    let summary = args["summary"]
        .as_str()
        .ok_or("Missing 'summary' parameter")?
        .to_string();
    let description = args["description"]
        .as_str()
        .ok_or("Missing 'description' parameter")?
        .to_string();
    let issue_type = args["issue_type"]
        .as_str()
        .unwrap_or("Bug")
        .to_string();
    let priority = args["priority"]
        .as_str()
        .unwrap_or("Medium")
        .to_string();

    let ticket = jira_service::JiraTicketRequest {
        summary: summary.clone(),
        description: description.clone(),
        priority,
        labels: vec!["hadron-created".to_string()],
        components: None,
    };

    let result = jira_service::create_jira_ticket(
        jira.base_url.clone(),
        jira.email.clone(),
        jira.api_token.clone(),
        project_key.clone(),
        issue_type,
        ticket,
    )
    .await
    .map_err(|e| format!("JIRA ticket creation failed: {}", e))?;

    if result.success {
        let key = result.ticket_key.unwrap_or_default();
        let url = result.ticket_url.unwrap_or_default();
        Ok(format!(
            "JIRA ticket created successfully!\n\n- **Key**: {}\n- **URL**: {}\n- **Summary**: {}",
            key, url, summary
        ))
    } else {
        Err(result.error.unwrap_or_else(|| "Unknown error creating JIRA ticket".to_string()))
    }
}

// ============================================================================
// Investigation Tool Handlers
// ============================================================================

fn jira_config_to_investigation(ctx: &ToolContext) -> Option<hadron_investigation::atlassian::InvestigationConfig> {
    let jira = ctx.jira_config.as_ref()?;
    Some(hadron_investigation::atlassian::InvestigationConfig {
        jira_base_url: jira.base_url.clone(),
        jira_email: jira.email.clone(),
        jira_api_token: jira.api_token.clone(),
        confluence_base_url: None,
        confluence_email: None,
        confluence_api_token: None,
        whatson_kb_url: None,
        mod_docs_homepage_id: None,
        mod_docs_space_path: None,
    })
}

async fn execute_investigate_ticket(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let key = args["ticket_key"].as_str().ok_or("Missing ticket_key")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let dossier = hadron_investigation::investigate_ticket(config, &key)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&dossier).map_err(|e| e.to_string())
}

async fn execute_investigate_regression(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let key = args["ticket_key"].as_str().ok_or("Missing ticket_key")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let dossier = hadron_investigation::investigate_regression_family(config, &key)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&dossier).map_err(|e| e.to_string())
}

async fn execute_investigate_expected(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let key = args["ticket_key"].as_str().unwrap_or("").to_string();
    let query = args["query"].as_str().ok_or("Missing query")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let dossier = hadron_investigation::investigate_expected_behavior(config, &key, &query)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&dossier).map_err(|e| e.to_string())
}

async fn execute_investigate_customer(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let key = args["ticket_key"].as_str().ok_or("Missing ticket_key")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let dossier = hadron_investigation::investigate_customer_history(config, &key)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&dossier).map_err(|e| e.to_string())
}

async fn execute_search_confluence(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let query = args["query"].as_str().ok_or("Missing query")?.to_string();
    let space_key = args["space_key"].as_str().map(String::from);
    let limit = args["limit"].as_u64().unwrap_or(10) as u32;
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let client = hadron_investigation::atlassian::AtlassianClient::new(config);
    let cql = if let Some(space) = space_key.filter(|s| !s.is_empty()) {
        format!("space = \"{}\" AND text ~ \"{}\"", space, query.replace('"', "'"))
    } else {
        format!("text ~ \"{}\"", query.replace('"', "'"))
    };
    let docs = hadron_investigation::atlassian::confluence::search_confluence(&client, &cql, limit)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&docs).map_err(|e| e.to_string())
}

async fn execute_get_confluence_page(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let id = args["content_id"].as_str().ok_or("Missing content_id")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let client = hadron_investigation::atlassian::AtlassianClient::new(config);
    let doc = hadron_investigation::atlassian::confluence::get_confluence_content(&client, &id)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&doc).map_err(|e| e.to_string())
}

// ============================================================================
// Helpers
// ============================================================================

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        let end = floor_char_boundary(s, max_len);
        format!("{}...", &s[..end])
    }
}
