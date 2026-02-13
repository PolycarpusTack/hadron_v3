//! Chat Tool Definitions & Executor
//!
//! Defines the tools available to the Ask Hadron agent and provides
//! execution logic that maps tool calls to existing Hadron capabilities.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

use crate::ai_service::{call_provider_quick, ChatMessage};
use crate::database::{Analysis, Database};
use crate::jira_service;
use crate::rag_commands::{kb_query_internal, OpenSearchConfig};

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
        "search_jira" => execute_search_jira(&tool_call.arguments, ctx).await,
        "create_jira_ticket" => execute_create_jira_ticket(&tool_call.arguments, ctx).await,
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

    // Generate query variants for multi-query retrieval (Phase 1.2)
    let variants = generate_query_variants(&query, &ctx.provider, &ctx.api_key, &ctx.model).await;

    // Run original + variant queries in parallel
    let mut handles = Vec::new();

    // Original query
    {
        let db = Arc::clone(&ctx.db);
        let q = query.clone();
        let sev = severity.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            db.search_analyses(&q, sev.as_deref())
        }));
    }

    // Variant queries
    for variant in &variants {
        let db = Arc::clone(&ctx.db);
        let q = variant.clone();
        let sev = severity.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            db.search_analyses(&q, sev.as_deref())
        }));
    }

    // Collect results
    let mut result_lists = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(results)) => result_lists.push(results),
            Ok(Err(e)) => log::warn!("Search variant failed: {}", e),
            Err(e) => log::warn!("Search task error: {}", e),
        }
    }

    // Merge with RRF if we have multiple result sets
    let mut results = if result_lists.len() > 1 {
        reciprocal_rank_fusion(result_lists)
    } else {
        result_lists.into_iter().next().unwrap_or_default()
    };

    if results.is_empty() {
        return Ok("No analyses found matching the query.".to_string());
    }

    // Apply feedback-based boosting: re-rank results using accept/reject signals
    let ids: Vec<i64> = results.iter().map(|a| a.id).collect();
    let db_clone = Arc::clone(&ctx.db);
    if let Ok(feedback_scores) = tokio::task::spawn_blocking(move || {
        db_clone.get_feedback_scores_for_analyses(&ids)
    })
    .await
    .unwrap_or_else(|_| Ok(HashMap::new()))
    {
        if !feedback_scores.is_empty() {
            // Assign each result an ordinal score, then apply multiplier, then re-sort
            let n = results.len() as f64;
            let mut scored: Vec<(Analysis, f64)> = results
                .into_iter()
                .enumerate()
                .map(|(i, a)| {
                    let base = n - i as f64; // higher = better rank
                    let mult = feedback_scores.get(&a.id).copied().unwrap_or(1.0);
                    (a, base * mult)
                })
                .collect();
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            results = scored.into_iter().map(|(a, _)| a).collect();
        }
    }

    let variant_note = if !variants.is_empty() {
        format!(" (searched with {} query variants)", variants.len() + 1)
    } else {
        String::new()
    };

    let mut output = format!("Found {} analyses{}:\n\n", results.len().min(10), variant_note);
    for analysis in results.iter().take(10) {
        output.push_str(&format!(
            "**Analysis #{}** — {} ({})\n- Error: {}\n- Root Cause: {}\n- Component: {}\n- Date: {}\n\n",
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

    let result = kb_query_internal(
        query,
        &ctx.kb_mode,
        ctx.opensearch_config.clone(),
        ctx.won_version.clone(),
        ctx.customer.clone(),
        5,
        &ctx.api_key,
    )
    .await
    .map_err(|e| format!("KB search error: {}", e))?;

    let total = result.kb_results.len() + result.release_note_results.len();
    if total == 0 {
        return Ok("No Knowledge Base documents found matching the query.".to_string());
    }

    let mut output = format!("Found {} KB documents:\n\n", total);
    for item in &result.kb_results {
        output.push_str(&format!(
            "**{}** (v{}, {})\n{}\n\n",
            item.page_title,
            item.won_version,
            item.source_type,
            truncate(&item.text, 300),
        ));
    }
    for item in &result.release_note_results {
        output.push_str(&format!(
            "**Release Note: {}** (v{})\n{}\n\n",
            item.page_title,
            item.won_version,
            truncate(&item.text, 300),
        ));
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
        "**Analysis #{}**: {}\n\n\
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

    // If the query doesn't look like JQL (no operators), wrap it as a text search
    let jql = if query.contains('=') || query.contains("ORDER BY") || query.starts_with("project") {
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
            "| {} | {} | {} | {} | {} | {} |\n",
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
// Multi-Query Retrieval with RRF (Phase 1.2)
// ============================================================================

const VARIANT_SYSTEM_PROMPT: &str = r#"Generate 2 alternative search queries for finding relevant crash analyses and documentation. Be diverse in phrasing — use synonyms, rephrase, and vary specificity. Output ONLY a JSON array of 2 strings, nothing else. Example: ["query one", "query two"]"#;

/// Generate search query variants using a quick LLM call
async fn generate_query_variants(
    query: &str,
    provider: &str,
    api_key: &str,
    model: &str,
) -> Vec<String> {
    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: format!("Generate 2 search query variants for: \"{}\"", query),
    }];

    match call_provider_quick(provider, &messages, VARIANT_SYSTEM_PROMPT, api_key, model, 200).await {
        Ok(response) => {
            let response = response.trim();
            // Try to parse as JSON array
            if let Ok(variants) = serde_json::from_str::<Vec<String>>(response) {
                log::info!("Generated {} query variants for: \"{}\"", variants.len(), &query[..query.len().min(50)]);
                return variants;
            }
            // Fallback: try to extract quoted strings
            log::warn!("Failed to parse query variants as JSON, using original query only");
            Vec::new()
        }
        Err(e) => {
            log::warn!("Query variant generation failed: {}", e);
            Vec::new()
        }
    }
}

/// Merge search results from multiple queries using Reciprocal Rank Fusion.
/// k=60 is the standard RRF constant.
fn reciprocal_rank_fusion(result_lists: Vec<Vec<Analysis>>) -> Vec<Analysis> {
    const K: f64 = 60.0;

    let mut scores: HashMap<i64, f64> = HashMap::new();
    let mut analysis_map: HashMap<i64, Analysis> = HashMap::new();

    for results in &result_lists {
        for (rank, analysis) in results.iter().enumerate() {
            let rrf_score = 1.0 / (K + rank as f64 + 1.0);
            *scores.entry(analysis.id).or_insert(0.0) += rrf_score;
            analysis_map.entry(analysis.id).or_insert_with(|| analysis.clone());
        }
    }

    // Sort by RRF score descending
    let mut scored: Vec<(i64, f64)> = scores.into_iter().collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    scored
        .into_iter()
        .filter_map(|(id, _)| analysis_map.remove(&id))
        .collect()
}

// ============================================================================
// Helpers
// ============================================================================

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}
