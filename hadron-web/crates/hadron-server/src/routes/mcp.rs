//! MCP (Model Context Protocol) endpoint — JSON-RPC 2.0 over HTTP.
//!
//! Guarded by `HADRON_MCP_ENABLED=true` (default: false).
//! Auth: reuses JWT middleware. WebMcpContext delegates to existing `db::` functions.

use std::sync::OnceLock;

use async_trait::async_trait;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use hadron_mcp::context::Role as McpRole;
use hadron_mcp::errors::{McpError, McpResult};
use hadron_mcp::schemas::{
    ReleaseNoteRecord, SentryAnalysisRecord, SimilarTicketRecord, TicketBriefRecord,
};
use hadron_mcp::tools::{default_registry, ToolRegistry};
use hadron_mcp::McpContext;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::AppState;

// ============================================================================
// Cached registry (built once, shared across requests)
// ============================================================================

fn registry() -> &'static ToolRegistry {
    static REG: OnceLock<ToolRegistry> = OnceLock::new();
    REG.get_or_init(default_registry)
}

// ============================================================================
// JSON-RPC 2.0 envelope
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcResponse {
    fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }
    fn err(id: Value, code: i64, message: String) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError { code, message, data: None }),
        }
    }
    fn from_mcp_err(id: Value, e: McpError) -> Self {
        Self::err(id, e.jsonrpc_code(), e.client_message().to_string())
    }
}

// ============================================================================
// WebMcpContext
// ============================================================================

pub struct WebMcpContext {
    pub pool: sqlx::PgPool,
    pub user_id: Uuid,
    pub role: hadron_core::models::Role,
}

impl WebMcpContext {
    fn map_role(role: hadron_core::models::Role) -> McpRole {
        match role {
            hadron_core::models::Role::Analyst => McpRole::Analyst,
            hadron_core::models::Role::Lead => McpRole::Lead,
            hadron_core::models::Role::Admin => McpRole::Admin,
        }
    }
}

#[async_trait]
impl McpContext for WebMcpContext {
    fn user_id(&self) -> Option<Uuid> {
        Some(self.user_id)
    }

    fn role(&self) -> McpRole {
        Self::map_role(self.role)
    }

    async fn get_ticket_brief(&self, jira_key: &str) -> McpResult<Option<TicketBriefRecord>> {
        let row = db::get_ticket_brief(&self.pool, jira_key)
            .await
            .map_err(McpError::internal)?;

        Ok(row.map(|r| TicketBriefRecord {
            jira_key: r.jira_key,
            summary: Some(r.title),
            severity: r.severity,
            category: r.category,
            tags: r
                .tags
                .map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default(),
            customer_impact: r
                .triage_json
                .as_deref()
                .and_then(|j| serde_json::from_str::<Value>(j).ok())
                .and_then(|v| v.get("customer_impact")?.as_str().map(String::from)),
            brief_json: r
                .brief_json
                .and_then(|j| serde_json::from_str(&j).ok()),
            posted_to_jira_at: r.posted_at,
            updated_at: r.updated_at,
        }))
    }

    async fn search_ticket_briefs(
        &self,
        query: &str,
        severity: Option<&str>,
        category: Option<&str>,
        limit: usize,
    ) -> McpResult<Vec<TicketBriefRecord>> {
        let rows = db::search_ticket_briefs(
            &self.pool, query, severity, category, limit as i64,
        )
        .await
        .map_err(McpError::internal)?;

        Ok(rows
            .into_iter()
            .map(|r| TicketBriefRecord {
                jira_key: r.jira_key,
                summary: Some(r.title),
                severity: r.severity,
                category: r.category,
                tags: r.tags
                    .map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
                    .unwrap_or_default(),
                customer_impact: None,
                brief_json: r.brief_json.and_then(|j| serde_json::from_str(&j).ok()),
                posted_to_jira_at: r.posted_at,
                updated_at: r.updated_at,
            })
            .collect())
    }

    async fn find_similar_tickets(
        &self,
        jira_key: Option<&str>,
        text: Option<&str>,
        threshold: f32,
        limit: usize,
    ) -> McpResult<Vec<SimilarTicketRecord>> {
        // Get or generate embedding
        let embedding = if let Some(key) = jira_key {
            let source_id = db::jira_key_to_source_id(key);
            match db::get_embedding(&self.pool, source_id, "ticket")
                .await
                .map_err(McpError::internal)?
            {
                Some(e) => e,
                None => return Ok(vec![]),
            }
        } else if let Some(t) = text {
            // Generate embedding on the fly from text
            let ai_config = crate::routes::analyses::resolve_ai_config(&self.pool)
                .await
                .map_err(|e| McpError::Internal(e.0.to_string()))?;

            crate::integrations::embeddings::generate_embedding_with_retry(
                t, &ai_config.api_key, 3,
            )
            .await
            .map_err(McpError::internal)?
        } else {
            return Ok(vec![]);
        };

        let exclude = jira_key.unwrap_or("");
        let matches = db::find_similar_tickets(
            &self.pool, &embedding, exclude, threshold as f64, limit as i64,
        )
        .await
        .map_err(McpError::internal)?;

        Ok(matches
            .into_iter()
            .map(|m| SimilarTicketRecord {
                jira_key: m.jira_key,
                summary: Some(m.title),
                severity: m.severity,
                category: m.category,
                similarity: m.similarity as f32,
            })
            .collect())
    }

    // Scoped to analysis_type='sentry' via dedicated DB function
    async fn search_sentry_analyses(
        &self,
        query: &str,
        _pattern: Option<&str>,
        limit: usize,
    ) -> McpResult<Vec<SentryAnalysisRecord>> {
        let rows = db::search_analyses_by_type(
            &self.pool, self.user_id, "sentry", query, limit as i64,
        )
        .await
        .map_err(McpError::internal)?;

        Ok(rows
            .into_iter()
            .map(|a| SentryAnalysisRecord {
                id: a.id,
                issue_id: Some(a.filename.clone()),
                title: a.error_type.clone(),
                patterns: vec![],
                summary: a.severity.clone(),
                created_at: a.analyzed_at,
                payload: None,
            })
            .collect())
    }

    // Scoped to analysis_type='sentry' — won't return crash/performance analyses
    async fn get_sentry_analysis(&self, id: i64) -> McpResult<Option<SentryAnalysisRecord>> {
        let row = db::get_analysis_by_id_and_type(
            &self.pool, id, self.user_id, "sentry",
        )
        .await
        .map_err(McpError::internal)?;

        Ok(row.map(|r| SentryAnalysisRecord {
            id: r.id,
            issue_id: Some(r.filename.clone()),
            title: r.error_type.clone(),
            patterns: vec![],
            summary: r.severity.clone(),
            created_at: r.analyzed_at,
            payload: r.full_data,
        }))
    }

    async fn list_fix_versions(&self, project_key: &str) -> McpResult<Vec<String>> {
        let mut config = db::get_jira_config_from_poller(&self.pool)
            .await
            .map_err(McpError::internal)?;
        config.project_key = project_key.to_string();

        let versions = crate::integrations::jira::list_fix_versions(&config, project_key)
            .await
            .map_err(McpError::internal)?;

        Ok(versions.into_iter().map(|v| v.name).collect())
    }

    // Critical fix #1: use i64 directly, no Uuid conversion
    async fn get_release_notes(
        &self,
        fix_version: Option<&str>,
        note_id: Option<i64>,
    ) -> McpResult<Option<ReleaseNoteRecord>> {
        if let Some(version) = fix_version {
            let note = db::get_release_note_by_version(&self.pool, self.user_id, version)
                .await
                .map_err(McpError::internal)?;

            Ok(note.map(|n| ReleaseNoteRecord {
                id: n.id,
                fix_version: n.version,
                title: Some(n.title),
                status: n.status.unwrap_or_else(|| "draft".into()),
                content_markdown: n.markdown_content.or(Some(n.content)),
                published_at: n.published_at,
                updated_at: n.updated_at,
            }))
        } else if let Some(id) = note_id {
            match db::get_release_note(&self.pool, id, self.user_id).await {
                Ok(note) => Ok(Some(ReleaseNoteRecord {
                    id: note.id,
                    fix_version: note.version,
                    title: Some(note.title),
                    status: note.status.unwrap_or_else(|| "draft".into()),
                    content_markdown: note.markdown_content.or(Some(note.content)),
                    published_at: note.published_at,
                    updated_at: note.updated_at,
                })),
                Err(e) if e.to_string().contains("not found") => Ok(None),
                Err(e) => Err(McpError::internal(e)),
            }
        } else {
            Ok(None)
        }
    }

    async fn hybrid_search(
        &self,
        query: &str,
        _sources: &[&str],
        limit: usize,
    ) -> McpResult<Value> {
        let ai_config = crate::routes::analyses::resolve_ai_config(&self.pool)
            .await
            .map_err(|e| McpError::Internal(e.0.to_string()))?;

        let embedding = crate::integrations::embeddings::generate_embedding_with_retry(
            query, &ai_config.api_key, 3,
        )
        .await
        .map_err(McpError::internal)?;

        // Tenant-scope the user's own analyses; leave ticket / release_note
        // sources unscoped because they are shared by product design.
        // Fixes F2 from the 2026-04-20 security audit (hybrid_search cross-
        // tenant leak). Previously `vector_search(.., None)` returned every
        // user's embeddings across every source type.
        let mut vector_rows = db::vector_search(
            &self.pool,
            &embedding,
            limit as i64,
            Some("analysis"),
            Some(self.user_id),
        )
        .await
        .unwrap_or_default();
        for shared_source in ["ticket", "release_note"] {
            let mut extra = db::vector_search(
                &self.pool,
                &embedding,
                limit as i64,
                Some(shared_source),
                None,
            )
            .await
            .unwrap_or_default();
            vector_rows.append(&mut extra);
        }
        vector_rows.sort_by(|a, b| {
            a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal)
        });
        vector_rows.truncate(limit);

        let fts_rows = db::search_analyses(&self.pool, self.user_id, query, limit as i64)
            .await
            .unwrap_or_default();

        let results: Vec<Value> = vector_rows
            .into_iter()
            .map(|(id, source_type, content, distance)| {
                json!({
                    "id": id,
                    "source_type": source_type,
                    "content": content,
                    "score": 1.0 - distance,
                    "source": "vector",
                })
            })
            .chain(fts_rows.into_iter().map(|a| {
                json!({
                    "id": a.id,
                    "title": a.filename,
                    "error_type": a.error_type,
                    "severity": a.severity,
                    "source": "fts",
                })
            }))
            .take(limit)
            .collect();

        let count = results.len();
        Ok(json!({ "query": query, "results": results, "count": count }))
    }
}

// ============================================================================
// Input schemas for tools/list (static, built once)
// ============================================================================

fn tool_input_schemas() -> &'static serde_json::Map<String, Value> {
    static SCHEMAS: OnceLock<serde_json::Map<String, Value>> = OnceLock::new();
    SCHEMAS.get_or_init(|| {
        let s = serde_json::Map::from_iter([
            ("get_ticket_brief".into(), json!({
                "type": "object",
                "properties": { "jira_key": { "type": "string", "description": "JIRA issue key (e.g. PROJ-1234)" } },
                "required": ["jira_key"]
            })),
            ("search_ticket_briefs".into(), json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search text" },
                    "severity": { "type": "string" },
                    "category": { "type": "string" },
                    "limit": { "type": "integer", "default": 10, "maximum": 100 }
                },
                "required": ["query"]
            })),
            ("find_similar_tickets".into(), json!({
                "type": "object",
                "properties": {
                    "jira_key": { "type": "string", "description": "Find tickets similar to this key" },
                    "text": { "type": "string", "description": "Or find tickets similar to this text" },
                    "threshold": { "type": "number", "default": 0.65, "minimum": 0, "maximum": 1 },
                    "limit": { "type": "integer", "default": 10, "maximum": 100 }
                }
            })),
            ("search_sentry_analyses".into(), json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search text" },
                    "pattern": { "type": "string", "description": "Filter by pattern (e.g. deadlock, n_plus_one)" },
                    "limit": { "type": "integer", "default": 10, "maximum": 100 }
                },
                "required": ["query"]
            })),
            ("get_sentry_analysis".into(), json!({
                "type": "object",
                "properties": { "analysis_id": { "type": "integer", "description": "Analysis database ID" } },
                "required": ["analysis_id"]
            })),
            ("list_fix_versions".into(), json!({
                "type": "object",
                "properties": { "project_key": { "type": "string", "description": "JIRA project key" } },
                "required": ["project_key"]
            })),
            ("get_release_notes".into(), json!({
                "type": "object",
                "properties": {
                    "fix_version": { "type": "string", "description": "JIRA fix version name" },
                    "note_id": { "type": "integer", "description": "Release note database ID" }
                }
            })),
            ("hybrid_search".into(), json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search text" },
                    "sources": { "type": "array", "items": { "type": "string" }, "default": ["briefs","sentry","release_notes"] },
                    "limit": { "type": "integer", "default": 10, "maximum": 100 }
                },
                "required": ["query"]
            })),
        ]);
        s
    })
}

// ============================================================================
// JSON-RPC handler
// ============================================================================

pub async fn handle_mcp(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    if req.jsonrpc != "2.0" {
        return (
            StatusCode::OK,
            Json(JsonRpcResponse::err(req.id, -32600, "Invalid Request: expected jsonrpc 2.0".into())),
        );
    }

    let ctx = WebMcpContext {
        pool: state.db.clone(),
        user_id: user.user.id,
        role: user.user.role,
    };

    let reg = registry();
    let schemas = tool_input_schemas();

    let response = match req.method.as_str() {
        "initialize" => JsonRpcResponse::ok(
            req.id.clone(),
            json!({
                "protocolVersion": "2025-03-26",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "hadron", "version": env!("CARGO_PKG_VERSION") },
            }),
        ),

        "tools/list" => {
            let tools: Vec<Value> = reg
                .names()
                .map(|name| {
                    let desc = reg.get(name).unwrap();
                    let schema = schemas.get(name).cloned().unwrap_or(json!({"type": "object"}));
                    json!({ "name": name, "description": desc.description, "inputSchema": schema })
                })
                .collect();
            JsonRpcResponse::ok(req.id.clone(), json!({ "tools": tools }))
        }

        "tools/call" => {
            let tool_name = req.params.get("name").and_then(|v| v.as_str());
            let args = req.params.get("arguments").cloned().unwrap_or(json!({}));

            match tool_name {
                Some(name) => match reg.call(name, &ctx, args).await {
                    Ok(result) => JsonRpcResponse::ok(
                        req.id.clone(),
                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&result)
                                    .unwrap_or_else(|_| result.to_string()),
                            }],
                        }),
                    ),
                    Err(McpError::NotFound) => JsonRpcResponse::ok(
                        req.id.clone(),
                        json!({
                            "content": [{ "type": "text", "text": "Not found" }],
                            "isError": true,
                        }),
                    ),
                    Err(e) => JsonRpcResponse::from_mcp_err(req.id.clone(), e),
                },
                None => JsonRpcResponse::err(req.id.clone(), -32602, "Missing params.name".into()),
            }
        }

        _ => JsonRpcResponse::err(req.id.clone(), -32601, format!("Method not found: {}", req.method)),
    };

    (StatusCode::OK, Json(response))
}

/// Returns true if MCP is enabled via env var.
pub fn is_enabled() -> bool {
    std::env::var("HADRON_MCP_ENABLED")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

/// Well-known MCP discovery endpoint (no auth required).
/// Intentionally omits tool list — use authenticated tools/list for that.
pub async fn well_known_mcp() -> impl IntoResponse {
    Json(json!({
        "name": "hadron",
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": "mcp",
        "protocolVersion": "2025-03-26",
        "endpoint": "/api/mcp",
        "auth": "bearer",
    }))
}
