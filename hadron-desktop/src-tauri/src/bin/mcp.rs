//! Hadron MCP Server — stdio transport for desktop.
//!
//! Usage: hadron-mcp
//!
//! Speaks JSON-RPC 2.0 over stdin/stdout (one request per line).
//! Reads from the same SQLite database as the Hadron desktop app.

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use uuid::Uuid;

use hadron_mcp::context::Role as McpRole;
use hadron_mcp::errors::{McpError, McpResult};
use hadron_mcp::schemas::{
    ReleaseNoteRecord, SentryAnalysisRecord, SimilarTicketRecord, TicketBriefRecord,
};
use hadron_mcp::tools::{default_registry, ToolRegistry};
use hadron_mcp::McpContext;

// ============================================================================
// Shared constants
// ============================================================================

/// Database path — must match hadron-desktop/src-tauri/src/database.rs::get_db_path().
fn db_path() -> std::path::PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    path.push("hadron");
    path.push("analyses.db");
    path
}

// ============================================================================
// Lightweight DB handle (read-only, separate from main app)
// ============================================================================

struct Db {
    conn: parking_lot::Mutex<rusqlite::Connection>,
}

impl Db {
    fn open() -> Result<Self, rusqlite::Error> {
        let path = db_path();
        let conn = rusqlite::Connection::open(&path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // Verify WAL is actually active
        let mode: String = conn.pragma_query_value(None, "journal_mode", |r| r.get(0))?;
        if mode != "wal" {
            eprintln!("warning: WAL mode not active (got: {})", mode);
        }
        Ok(Db { conn: parking_lot::Mutex::new(conn) })
    }

    fn conn(&self) -> parking_lot::MutexGuard<'_, rusqlite::Connection> {
        self.conn.lock()
    }
}

// ============================================================================
// Cached registry
// ============================================================================

fn registry() -> &'static ToolRegistry {
    static REG: OnceLock<ToolRegistry> = OnceLock::new();
    REG.get_or_init(default_registry)
}

// ============================================================================
// DesktopMcpContext
// ============================================================================

struct DesktopMcpContext {
    db: Arc<Db>,
}

#[async_trait]
impl McpContext for DesktopMcpContext {
    fn user_id(&self) -> Option<Uuid> {
        None
    }

    fn role(&self) -> McpRole {
        McpRole::Admin
    }

    async fn get_ticket_brief(&self, jira_key: &str) -> McpResult<Option<TicketBriefRecord>> {
        let db = self.db.clone();
        let key = jira_key.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = db.conn();
            let mut stmt = conn
                .prepare(
                    "SELECT jira_key, title, severity, category, tags, triage_json, brief_json,
                            posted_to_jira, posted_at, updated_at
                     FROM ticket_briefs WHERE jira_key = ?1",
                )
                .map_err(McpError::internal)?;

            let row = stmt
                .query_row(rusqlite::params![key], |row| {
                    Ok(TicketBriefRecord {
                        jira_key: row.get(0)?,
                        summary: row.get(1)?,
                        severity: row.get(2)?,
                        category: row.get(3)?,
                        tags: row
                            .get::<_, Option<String>>(4)?
                            .and_then(|t| serde_json::from_str(&t).ok())
                            .unwrap_or_default(),
                        customer_impact: row
                            .get::<_, Option<String>>(5)?
                            .and_then(|j| serde_json::from_str::<Value>(&j).ok())
                            .and_then(|v| v.get("customer_impact")?.as_str().map(String::from)),
                        brief_json: row
                            .get::<_, Option<String>>(6)?
                            .and_then(|j| serde_json::from_str(&j).ok()),
                        // index 7 = posted_to_jira (bool), not needed in output
                        posted_to_jira_at: row
                            .get::<_, Option<String>>(8)?
                            .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
                        updated_at: row
                            .get::<_, String>(9)?
                            .parse::<DateTime<Utc>>()
                            .unwrap_or_else(|_| Utc::now()),
                    })
                })
                .ok();

            Ok(row)
        })
        .await
        .map_err(McpError::internal)?
    }

    async fn search_ticket_briefs(
        &self,
        query: &str,
        severity: Option<&str>,
        category: Option<&str>,
        limit: usize,
    ) -> McpResult<Vec<TicketBriefRecord>> {
        let db = self.db.clone();
        let q = format!("%{}%", query);
        let sev = severity.map(String::from);
        let cat = category.map(String::from);
        tokio::task::spawn_blocking(move || {
            let conn = db.conn();
            let mut stmt = conn
                .prepare(
                    "SELECT jira_key, title, severity, category, tags, brief_json, posted_at, updated_at
                     FROM ticket_briefs
                     WHERE (title LIKE ?1 OR brief_json LIKE ?1)
                       AND (?2 IS NULL OR severity = ?2)
                       AND (?3 IS NULL OR category = ?3)
                     ORDER BY updated_at DESC LIMIT ?4",
                )
                .map_err(McpError::internal)?;

            let rows = stmt
                .query_map(rusqlite::params![q, sev, cat, limit as i64], |row| {
                    Ok(TicketBriefRecord {
                        jira_key: row.get(0)?,
                        summary: row.get(1)?,
                        severity: row.get(2)?,
                        category: row.get(3)?,
                        tags: row.get::<_, Option<String>>(4)?
                            .and_then(|t| serde_json::from_str(&t).ok())
                            .unwrap_or_default(),
                        customer_impact: None,
                        brief_json: row.get::<_, Option<String>>(5)?
                            .and_then(|j| serde_json::from_str(&j).ok()),
                        posted_to_jira_at: row.get::<_, Option<String>>(6)?
                            .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
                        updated_at: row.get::<_, String>(7)?
                            .parse::<DateTime<Utc>>()
                            .unwrap_or_else(|_| Utc::now()),
                    })
                })
                .map_err(McpError::internal)?
                .filter_map(|r| r.ok())
                .collect();

            Ok(rows)
        })
        .await
        .map_err(McpError::internal)?
    }

    async fn find_similar_tickets(
        &self,
        jira_key: Option<&str>,
        _text: Option<&str>,
        threshold: f32,
        limit: usize,
    ) -> McpResult<Vec<SimilarTicketRecord>> {
        let key = match jira_key {
            Some(k) => k.to_string(),
            None => return Ok(vec![]),
        };
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db.conn();

            let embedding: Option<Vec<u8>> = conn
                .query_row(
                    "SELECT embedding FROM ticket_embeddings WHERE jira_key = ?1",
                    rusqlite::params![key],
                    |row| row.get(0),
                )
                .ok();

            let embedding = match embedding {
                Some(bytes) => bytes_to_f64_vec(&bytes)?,
                None => return Ok(vec![]),
            };

            let mut stmt = conn
                .prepare(
                    "SELECT te.jira_key, te.embedding, tb.title, tb.severity, tb.category
                     FROM ticket_embeddings te
                     LEFT JOIN ticket_briefs tb ON te.jira_key = tb.jira_key
                     WHERE te.jira_key != ?1",
                )
                .map_err(McpError::internal)?;

            let mut results: Vec<SimilarTicketRecord> = stmt
                .query_map(rusqlite::params![key], |row| {
                    let other_key: String = row.get(0)?;
                    let other_bytes: Vec<u8> = row.get(1)?;
                    let title: Option<String> = row.get(2)?;
                    let severity: Option<String> = row.get(3)?;
                    let category: Option<String> = row.get(4)?;
                    Ok((other_key, other_bytes, title, severity, category))
                })
                .map_err(McpError::internal)?
                .filter_map(|r| r.ok())
                .filter_map(|(other_key, other_bytes, title, severity, category)| {
                    let other_emb = bytes_to_f64_vec(&other_bytes).ok()?;
                    let sim = cosine_similarity(&embedding, &other_emb);
                    if sim >= threshold as f64 {
                        Some(SimilarTicketRecord {
                            jira_key: other_key,
                            summary: title,
                            severity,
                            category,
                            similarity: sim as f32,
                        })
                    } else {
                        None
                    }
                })
                .collect();

            results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap());
            results.truncate(limit);
            Ok(results)
        })
        .await
        .map_err(McpError::internal)?
    }

    // Desktop doesn't persist Sentry analyses the same way — return explicit error
    async fn search_sentry_analyses(
        &self,
        _query: &str,
        _pattern: Option<&str>,
        _limit: usize,
    ) -> McpResult<Vec<SentryAnalysisRecord>> {
        Err(McpError::NotSupported(
            "Sentry analysis search is not available in the desktop MCP context".into(),
        ))
    }

    async fn get_sentry_analysis(&self, _id: i64) -> McpResult<Option<SentryAnalysisRecord>> {
        Err(McpError::NotSupported(
            "Sentry analysis lookup is not available in the desktop MCP context".into(),
        ))
    }

    async fn list_fix_versions(&self, _project_key: &str) -> McpResult<Vec<String>> {
        Err(McpError::NotSupported(
            "list_fix_versions requires JIRA credentials (configure in Hadron desktop)".into(),
        ))
    }

    async fn get_release_notes(
        &self,
        fix_version: Option<&str>,
        note_id: Option<i64>,
    ) -> McpResult<Option<ReleaseNoteRecord>> {
        let db = self.db.clone();
        let fv = fix_version.map(String::from);
        tokio::task::spawn_blocking(move || {
            let conn = db.conn();
            if let Some(id) = note_id {
                let r = conn
                    .query_row(
                        "SELECT id, fix_version, title, status, markdown_content, published_at, updated_at
                         FROM release_notes WHERE id = ?1 AND deleted_at IS NULL",
                        rusqlite::params![id],
                        |row| map_release_note_row(row),
                    )
                    .ok();
                return Ok(r);
            }
            if let Some(version) = fv {
                let r = conn
                    .query_row(
                        "SELECT id, fix_version, title, status, markdown_content, published_at, updated_at
                         FROM release_notes WHERE fix_version = ?1 AND deleted_at IS NULL
                         ORDER BY updated_at DESC LIMIT 1",
                        rusqlite::params![version],
                        |row| map_release_note_row(row),
                    )
                    .ok();
                return Ok(r);
            }
            Ok(None)
        })
        .await
        .map_err(McpError::internal)?
    }

    async fn hybrid_search(
        &self,
        query: &str,
        _sources: &[&str],
        limit: usize,
    ) -> McpResult<Value> {
        let db = self.db.clone();
        let q = query.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = db.conn();
            let mut stmt = conn
                .prepare(
                    "SELECT id, filename, error_type, severity
                     FROM analyses
                     WHERE filename LIKE ?1 OR error_type LIKE ?1 OR error_message LIKE ?1
                     ORDER BY analyzed_at DESC LIMIT ?2",
                )
                .map_err(McpError::internal)?;

            let pattern = format!("%{}%", q);
            let results: Vec<Value> = stmt
                .query_map(rusqlite::params![pattern, limit as i64], |row| {
                    Ok(json!({
                        "id": row.get::<_, i64>(0)?,
                        "filename": row.get::<_, String>(1)?,
                        "error_type": row.get::<_, Option<String>>(2)?,
                        "severity": row.get::<_, Option<String>>(3)?,
                        "source": "fts",
                    }))
                })
                .map_err(McpError::internal)?
                .filter_map(|r| r.ok())
                .collect();

            let count = results.len();
            Ok(json!({ "query": q, "results": results, "count": count }))
        })
        .await
        .map_err(McpError::internal)?
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Convert a BLOB of LE f64 bytes to a Vec<f64>.
/// Returns an error if the byte length is not a multiple of 8.
fn bytes_to_f64_vec(bytes: &[u8]) -> McpResult<Vec<f64>> {
    if bytes.len() % 8 != 0 {
        return Err(McpError::Internal(format!(
            "corrupted embedding: {} bytes is not a multiple of 8",
            bytes.len()
        )));
    }
    Ok(bytes
        .chunks_exact(8)
        .map(|chunk| f64::from_le_bytes(chunk.try_into().unwrap()))
        .collect())
}

fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 { 0.0 } else { dot / denom }
}

/// Map a release_notes row to ReleaseNoteRecord. Column order must match SELECT.
fn map_release_note_row(row: &rusqlite::Row) -> rusqlite::Result<ReleaseNoteRecord> {
    // SELECT id(0), fix_version(1), title(2), status(3), markdown_content(4), published_at(5), updated_at(6)
    Ok(ReleaseNoteRecord {
        id: row.get(0)?,
        fix_version: row.get(1)?,
        title: row.get(2)?,
        status: row.get::<_, String>(3)?,
        content_markdown: row.get(4)?,
        published_at: row.get::<_, Option<String>>(5)?
            .and_then(|s| s.parse::<DateTime<Utc>>().ok()),
        updated_at: row.get::<_, String>(6)?
            .parse::<DateTime<Utc>>()
            .unwrap_or_else(|_| Utc::now()),
    })
}

// ============================================================================
// JSON-RPC over stdio
// ============================================================================

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

impl JsonRpcResponse {
    fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }
    fn err(id: Value, code: i64, message: String) -> Self {
        Self { jsonrpc: "2.0", id, result: None, error: Some(JsonRpcError { code, message }) }
    }
    fn from_mcp_err(id: Value, e: McpError) -> Self {
        Self::err(id, e.jsonrpc_code(), e.client_message().to_string())
    }
}

/// Input schemas for tools/list (matches web surface).
fn tool_input_schemas() -> &'static serde_json::Map<String, Value> {
    static SCHEMAS: OnceLock<serde_json::Map<String, Value>> = OnceLock::new();
    SCHEMAS.get_or_init(|| {
        serde_json::Map::from_iter([
            ("get_ticket_brief".into(), json!({
                "type": "object",
                "properties": { "jira_key": { "type": "string" } },
                "required": ["jira_key"]
            })),
            ("search_ticket_briefs".into(), json!({
                "type": "object",
                "properties": { "query": { "type": "string" }, "severity": { "type": "string" }, "category": { "type": "string" }, "limit": { "type": "integer", "default": 10, "maximum": 100 } },
                "required": ["query"]
            })),
            ("find_similar_tickets".into(), json!({
                "type": "object",
                "properties": { "jira_key": { "type": "string" }, "text": { "type": "string" }, "threshold": { "type": "number", "default": 0.65 }, "limit": { "type": "integer", "default": 10, "maximum": 100 } }
            })),
            ("search_sentry_analyses".into(), json!({
                "type": "object",
                "properties": { "query": { "type": "string" }, "pattern": { "type": "string" }, "limit": { "type": "integer", "default": 10, "maximum": 100 } },
                "required": ["query"]
            })),
            ("get_sentry_analysis".into(), json!({
                "type": "object",
                "properties": { "analysis_id": { "type": "integer" } },
                "required": ["analysis_id"]
            })),
            ("list_fix_versions".into(), json!({
                "type": "object",
                "properties": { "project_key": { "type": "string" } },
                "required": ["project_key"]
            })),
            ("get_release_notes".into(), json!({
                "type": "object",
                "properties": { "fix_version": { "type": "string" }, "note_id": { "type": "integer" } }
            })),
            ("hybrid_search".into(), json!({
                "type": "object",
                "properties": { "query": { "type": "string" }, "sources": { "type": "array", "items": { "type": "string" } }, "limit": { "type": "integer", "default": 10, "maximum": 100 } },
                "required": ["query"]
            })),
        ])
    })
}

async fn handle_request(ctx: &DesktopMcpContext, req: JsonRpcRequest) -> JsonRpcResponse {
    if req.jsonrpc != "2.0" {
        return JsonRpcResponse::err(req.id, -32600, "Invalid Request".into());
    }

    let reg = registry();
    let schemas = tool_input_schemas();

    match req.method.as_str() {
        "initialize" => JsonRpcResponse::ok(
            req.id,
            json!({
                "protocolVersion": "2025-03-26",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "hadron-desktop", "version": env!("CARGO_PKG_VERSION") },
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
            JsonRpcResponse::ok(req.id, json!({ "tools": tools }))
        }

        "tools/call" => {
            let tool_name = req.params.get("name").and_then(|v| v.as_str());
            let args = req.params.get("arguments").cloned().unwrap_or(json!({}));

            match tool_name {
                Some(name) => match reg.call(name, ctx, args).await {
                    Ok(result) => JsonRpcResponse::ok(
                        req.id,
                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&result)
                                    .unwrap_or_else(|_| result.to_string()),
                            }],
                        }),
                    ),
                    Err(McpError::NotFound) => JsonRpcResponse::ok(
                        req.id,
                        json!({
                            "content": [{ "type": "text", "text": "Not found" }],
                            "isError": true,
                        }),
                    ),
                    Err(e) => JsonRpcResponse::from_mcp_err(req.id, e),
                },
                None => JsonRpcResponse::err(req.id, -32602, "Missing params.name".into()),
            }
        }

        _ => JsonRpcResponse::err(req.id, -32601, format!("Method not found: {}", req.method)),
    }
}

#[tokio::main]
async fn main() {
    let db = match Db::open() {
        Ok(db) => Arc::new(db),
        Err(e) => {
            let err = json!({
                "jsonrpc": "2.0", "id": null,
                "error": { "code": -32000, "message": format!("Failed to open database: {e}") },
            });
            // Startup error — sync write is fine here (no runtime yet)
            let _ = eprintln!("{}", err);
            std::process::exit(1);
        }
    };

    let ctx = DesktopMcpContext { db };

    // Fully async stdin + stdout — no blocking syscalls on tokio workers
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    let mut stdout = tokio::io::stdout();

    loop {
        let line = match lines.next_line().await {
            Ok(Some(l)) => l,
            Ok(None) => break, // EOF — parent closed stdin
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let req: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let err = JsonRpcResponse::err(Value::Null, -32700, format!("Parse error: {e}"));
                let mut msg = serde_json::to_string(&err).unwrap();
                msg.push('\n');
                let _ = stdout.write_all(msg.as_bytes()).await;
                let _ = stdout.flush().await;
                continue;
            }
        };

        let response = handle_request(&ctx, req).await;
        let mut msg = serde_json::to_string(&response).unwrap();
        msg.push('\n');
        let _ = stdout.write_all(msg.as_bytes()).await;
        let _ = stdout.flush().await;
    }
}
