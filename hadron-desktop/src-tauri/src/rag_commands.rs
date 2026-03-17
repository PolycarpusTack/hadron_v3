use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

// ============================================================================
// RAG Command Structures
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct RAGQueryRequest {
    pub query: String,
    pub component: Option<String>,
    pub severity: Option<String>,
    pub top_k: Option<usize>,
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RAGQueryResult {
    pub id: String,
    pub content: String,
    pub score: f64,
    pub metadata: RAGChunkMetadata,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RAGChunkMetadata {
    pub component: Option<String>,
    pub severity: Option<String>,
    pub error_type: Option<String>,
    pub version: Option<String>,
    pub source_type: Option<String>,
    pub source_id: Option<i64>,
    pub is_gold: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RAGIndexRequest {
    pub analysis: serde_json::Value,
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RAGIndexResponse {
    pub indexed: usize,
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RAGContextRequest {
    pub query: String,
    pub component: Option<String>,
    pub severity: Option<String>,
    pub top_k: Option<usize>,
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SimilarCase {
    pub analysis_id: i64,
    pub similarity_score: f64,
    pub root_cause: String,
    pub suggested_fixes: Vec<String>,
    pub is_gold: bool,
    pub citation_id: String,
    pub component: Option<String>,
    pub severity: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RAGContext {
    pub similar_analyses: Vec<SimilarCase>,
    pub gold_matches: Vec<SimilarCase>,
    pub confidence_boost: f64,
    pub retrieval_time_ms: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RAGStatsResponse {
    pub total_chunks: usize,
    pub total_analyses: usize,
    pub gold_analyses: usize,
    pub storage_path: String,
}

// ============================================================================
// Knowledge Base RAG Structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenSearchConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub use_ssl: bool,
    /// Set to false to accept self-signed/invalid TLS certs (local dev only).
    /// Defaults to true (verify certs) when not specified in stored config.
    #[serde(default = "default_verify_certs")]
    pub verify_certs: bool,
}

fn default_verify_certs() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KBQueryRequest {
    pub query: String,
    pub mode: String, // "remote" | "local"
    pub opensearch_config: Option<OpenSearchConfig>,
    pub won_version: Option<String>,
    pub customer: Option<String>,
    pub use_kb: Option<bool>,
    pub use_base_rns: Option<bool>,
    pub use_customer_rns: Option<bool>,
    pub top_k: Option<usize>,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KBResultItem {
    pub text: String,
    pub link: String,
    pub page_title: String,
    pub won_version: String,
    pub customer: String,
    pub score: f64,
    pub source_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KBContext {
    pub kb_results: Vec<KBResultItem>,
    /// Combined release note results (base + customer) for backward compat
    pub release_note_results: Vec<KBResultItem>,
    /// Base release note results only (general WON implementation)
    #[serde(default)]
    pub base_rn_results: Vec<KBResultItem>,
    /// Customer-specific release note results
    #[serde(default)]
    pub customer_rn_results: Vec<KBResultItem>,
    pub retrieval_time_ms: Option<i64>,
    pub source_mode: String,
}

impl Default for KBContext {
    fn default() -> Self {
        Self {
            kb_results: Vec::new(),
            release_note_results: Vec::new(),
            base_rn_results: Vec::new(),
            customer_rn_results: Vec::new(),
            retrieval_time_ms: None,
            source_mode: "remote".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KBTestResponse {
    pub success: bool,
    pub message: String,
    pub available_indices: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KBImportRequest {
    pub root_path: String,
    pub won_version: String,
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KBImportResponse {
    pub indexed_chunks: usize,
    pub won_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KBStatsResponse {
    pub total_chunks: usize,
    pub indexed_versions: Vec<String>,
    pub storage_path: String,
}

// ============================================================================
// Configuration Constants
// ============================================================================

/// Maximum time to wait for RAG operations (30 seconds)
const RAG_TIMEOUT_SECS: u64 = 30;

/// Maximum query size (10KB)
const MAX_QUERY_SIZE: usize = 10 * 1024;

/// Maximum analysis payload size (1MB)
const MAX_ANALYSIS_SIZE: usize = 1024 * 1024;

// ============================================================================
// Tauri Commands
// ============================================================================

/// Query the RAG vector store for similar analyses
///
/// Security: API key passed via stdin, timeout enforced
#[tauri::command]
pub async fn rag_query(request: RAGQueryRequest) -> Result<Vec<RAGQueryResult>, String> {
    log::debug!("cmd: rag_query");
    // Validate query size
    if request.query.len() > MAX_QUERY_SIZE {
        return Err(format!(
            "Query too large: {} bytes exceeds maximum of {} bytes",
            request.query.len(),
            MAX_QUERY_SIZE
        ));
    }

    // Build input JSON for CLI
    let input = serde_json::json!({
        "query": request.query,
        "component": request.component,
        "severity": request.severity,
        "top_k": request.top_k.unwrap_or(5),
    });

    // Execute RAG query command
    let results = run_rag_cli_command("query", &input, &request.api_key).await?;

    // Parse results
    serde_json::from_value(results).map_err(|e| format!("Failed to parse query results: {}", e))
}

/// Index an analysis into the RAG vector store
///
/// Security: API key passed via stdin, size limits enforced
#[tauri::command]
pub async fn rag_index_analysis(request: RAGIndexRequest) -> Result<RAGIndexResponse, String> {
    log::debug!("cmd: rag_index_analysis");
    // Validate analysis size
    let analysis_str = serde_json::to_string(&request.analysis)
        .map_err(|e| format!("Failed to serialize analysis: {}", e))?;

    if analysis_str.len() > MAX_ANALYSIS_SIZE {
        return Err(format!(
            "Analysis too large: {} bytes exceeds maximum of {} bytes",
            analysis_str.len(),
            MAX_ANALYSIS_SIZE
        ));
    }

    // Execute RAG index command
    let result = run_rag_cli_command("index", &request.analysis, &request.api_key).await?;

    // Parse response
    serde_json::from_value(result).map_err(|e| format!("Failed to parse index response: {}", e))
}

/// Build RAG context for enhanced analysis
///
/// Security: API key passed via stdin, timeout enforced
#[tauri::command]
pub async fn rag_build_context(request: RAGContextRequest) -> Result<RAGContext, String> {
    log::debug!("cmd: rag_build_context");
    // Validate query size
    if request.query.len() > MAX_QUERY_SIZE {
        return Err(format!(
            "Query too large: {} bytes exceeds maximum of {} bytes",
            request.query.len(),
            MAX_QUERY_SIZE
        ));
    }

    // Build input JSON for CLI
    let input = serde_json::json!({
        "query": request.query,
        "component": request.component,
        "severity": request.severity,
        "top_k": request.top_k.unwrap_or(5),
    });

    // Execute RAG context command
    let context = run_rag_cli_command("context", &input, &request.api_key).await?;

    // Parse context
    serde_json::from_value(context).map_err(|e| format!("Failed to parse RAG context: {}", e))
}

/// Get RAG store statistics
///
/// Security: Read-only operation, no API key required
#[tauri::command]
pub async fn rag_get_stats() -> Result<RAGStatsResponse, String> {
    log::debug!("cmd: rag_get_stats");
    // Get storage path for stats response
    let storage_path = get_rag_storage_path()?;

    Ok(RAGStatsResponse {
        total_chunks: 0, // Will be populated when we add stats to CLI
        total_analyses: 0,
        gold_analyses: 0,
        storage_path: storage_path.to_string_lossy().to_string(),
    })
}

// ============================================================================
// Knowledge Base Tauri Commands
// ============================================================================

/// Query the KB/Release Notes (remote OpenSearch or local ChromaDB)
#[tauri::command]
pub async fn kb_query(request: KBQueryRequest) -> Result<KBContext, String> {
    log::debug!("cmd: kb_query");
    if request.query.len() > MAX_QUERY_SIZE {
        return Err(format!(
            "Query too large: {} bytes exceeds maximum of {} bytes",
            request.query.len(),
            MAX_QUERY_SIZE
        ));
    }

    let mut input = serde_json::json!({
        "query": request.query,
        "mode": request.mode,
        "won_version": request.won_version,
        "customer": request.customer,
        "use_kb": request.use_kb.unwrap_or(true),
        "use_base_rns": request.use_base_rns.unwrap_or(false),
        "use_customer_rns": request.use_customer_rns.unwrap_or(false),
        "top_k": request.top_k.unwrap_or(5),
    });

    if let Some(ref config) = request.opensearch_config {
        input["opensearch_host"] = serde_json::json!(config.host);
        input["opensearch_port"] = serde_json::json!(config.port);
        input["opensearch_user"] = serde_json::json!(config.username);
        input["opensearch_pass"] = serde_json::json!(config.password);
        input["opensearch_ssl"] = serde_json::json!(config.use_ssl);
    }

    let result = run_rag_cli_command("kb-query", &input, &request.api_key).await?;
    serde_json::from_value(result).map_err(|e| format!("Failed to parse KB query results: {}", e))
}

/// Test OpenSearch connectivity
#[tauri::command]
pub async fn kb_test_connection(config: OpenSearchConfig, api_key: String) -> Result<KBTestResponse, String> {
    log::debug!("cmd: kb_test_connection");
    let input = serde_json::json!({
        "host": config.host,
        "port": config.port,
        "username": config.username,
        "password": config.password,
        "use_ssl": config.use_ssl,
    });

    let result = run_rag_cli_command("kb-test", &input, &api_key).await?;
    serde_json::from_value(result).map_err(|e| format!("Failed to parse KB test response: {}", e))
}

/// List available KB indices from OpenSearch
#[tauri::command]
pub async fn kb_list_indices(config: OpenSearchConfig, api_key: String) -> Result<Vec<String>, String> {
    log::debug!("cmd: kb_list_indices");
    let input = serde_json::json!({
        "host": config.host,
        "port": config.port,
        "username": config.username,
        "password": config.password,
        "use_ssl": config.use_ssl,
    });

    let result = run_rag_cli_command("kb-indices", &input, &api_key).await?;
    serde_json::from_value(result).map_err(|e| format!("Failed to parse KB indices: {}", e))
}

/// Import local KB HTML files into ChromaDB
#[tauri::command]
pub async fn kb_import_docs(request: KBImportRequest) -> Result<KBImportResponse, String> {
    log::debug!("cmd: kb_import_docs");
    let input = serde_json::json!({
        "root_path": request.root_path,
        "won_version": request.won_version,
    });

    let result = run_rag_cli_command("kb-import", &input, &request.api_key).await?;
    serde_json::from_value(result).map_err(|e| format!("Failed to parse KB import response: {}", e))
}

/// Get local KB store statistics
#[tauri::command]
pub async fn kb_get_stats() -> Result<KBStatsResponse, String> {
    log::debug!("cmd: kb_get_stats");
    // kb-stats doesn't need an API key but we pass empty string
    let input = serde_json::json!({});
    let result = run_rag_cli_command("kb-stats", &input, "").await?;
    serde_json::from_value(result).map_err(|e| format!("Failed to parse KB stats: {}", e))
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/// Execute a RAG CLI command with timeout and error handling
///
/// Security: API key passed via stdin, not CLI args or env vars
async fn run_rag_cli_command(
    command: &str,
    input: &serde_json::Value,
    api_key: &str,
) -> Result<serde_json::Value, String> {
    // Verify CLI script exists before proceeding
    let _cli_script = get_rag_cli_path()?;

    // SECURITY: Pass API key via stdin payload, not environment
    let stdin_payload = serde_json::json!({
        "input": input,
        "api_key": api_key,
    });

    let stdin_json = serde_json::to_string(&stdin_payload)
        .map_err(|e| format!("Failed to serialize stdin payload: {}", e))?;

    // Build command arguments
    // On Windows, use CREATE_NO_WINDOW flag to prevent a console window from appearing
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new("python");
    cmd.arg("-m")
        .arg("python.rag.cli")
        .arg(command)
        .arg("--input")
        .arg("-") // Read from stdin
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    // Set working directory to project root
    if let Ok(project_root) = get_project_root() {
        cmd.current_dir(project_root);
    }

    // Spawn process
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn RAG CLI process: {}", e))?;

    // Write stdin payload
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(stdin_json.as_bytes())
            .map_err(|e| format!("Failed to write to RAG CLI stdin: {}", e))?;
        // stdin dropped here, closing pipe
    }

    // Wait for process with timeout
    let output = tokio::task::spawn_blocking(move || {
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    return child.wait_with_output();
                }
                Ok(None) => {
                    if start.elapsed() > Duration::from_secs(RAG_TIMEOUT_SECS) {
                        let _ = child.kill();
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            format!("RAG CLI timed out after {} seconds", RAG_TIMEOUT_SECS),
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(e),
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("RAG CLI process error: {}", e))?;

    // Check exit status
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("RAG CLI failed with stderr: {}", stderr);

        // Sanitize error for frontend
        let sanitized_error = stderr.lines().last().unwrap_or("Unknown error").trim();
        return Err(format!("RAG CLI failed: {}", sanitized_error));
    }

    // Parse JSON output
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Extract JSON from stdout
    let json_start = stdout.find('{').ok_or("No JSON found in RAG CLI output")?;
    let json_end = stdout
        .rfind('}')
        .ok_or("Malformed JSON in RAG CLI output")?;

    if json_start > json_end {
        return Err("Malformed JSON: invalid bounds in RAG CLI output".to_string());
    }

    let json_str = &stdout[json_start..=json_end];

    serde_json::from_str(json_str).map_err(|e| format!("Failed to parse RAG CLI JSON: {}", e))
}

/// Get path to RAG CLI script
fn get_rag_cli_path() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        // In dev mode, script is in python/rag/cli.py
        let mut path = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?;

        // If we're in src-tauri, go up one level
        if path.ends_with("src-tauri") {
            path.pop();
        }

        path.push("python");
        path.push("rag");
        path.push("cli.py");

        if !path.exists() {
            return Err(format!("RAG CLI script not found at: {:?}", path));
        }

        Ok(path)
    }

    #[cfg(not(debug_assertions))]
    {
        // In production, look for script in multiple possible locations
        // Tauri 2.x bundles resources differently based on installer type and platform
        let exe_path =
            std::env::current_exe().map_err(|e| format!("Failed to get executable path: {}", e))?;

        let exe_dir = exe_path.parent()
            .ok_or_else(|| "Failed to get executable directory".to_string())?;

        // Try multiple possible resource locations
        let possible_paths = [
            // Standard relative path
            exe_dir.join("python").join("rag").join("cli.py"),
            // Tauri 2.x _up_ path for relative resources
            exe_dir.join("_up_").join("python").join("rag").join("cli.py"),
            // Resources subdirectory
            exe_dir.join("resources").join("python").join("rag").join("cli.py"),
        ];

        for path in &possible_paths {
            log::debug!("Checking for RAG CLI script at: {:?}", path);
            if path.exists() {
                log::info!("Found RAG CLI script at: {:?}", path);
                return Ok(path.clone());
            }
        }

        Err(format!(
            "RAG CLI script not found in bundle. Checked paths: {:?}",
            possible_paths
        ))
    }
}

/// Get project root directory
fn get_project_root() -> Result<PathBuf, String> {
    let mut path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?;

    // If we're in src-tauri, go up one level
    if path.ends_with("src-tauri") {
        path.pop();
    }

    Ok(path)
}

/// Get RAG storage path
fn get_rag_storage_path() -> Result<PathBuf, String> {
    let mut path = get_project_root()?;
    path.push("python");
    path.push("rag");
    path.push("chroma_data");
    Ok(path)
}

// ============================================================================
// Internal API (for use by other Rust modules)
// ============================================================================

/// Build RAG context for enhanced analysis (internal use)
///
/// This is the internal API for building RAG context, used by commands.rs
/// to enhance AI analysis with similar historical cases.
///
/// # Arguments
/// * `query` - Natural language query (crash log excerpt)
/// * `component` - Optional component filter
/// * `severity` - Optional severity filter
/// * `top_k` - Number of results to return
/// * `api_key` - OpenAI API key for embeddings
pub async fn rag_build_context_internal(
    query: &str,
    component: Option<String>,
    severity: Option<String>,
    top_k: usize,
    api_key: &str,
) -> Result<RAGContext, String> {
    // Validate query size
    if query.len() > MAX_QUERY_SIZE {
        return Err(format!(
            "Query too large: {} bytes exceeds maximum of {} bytes",
            query.len(),
            MAX_QUERY_SIZE
        ));
    }

    // Build input JSON for CLI
    let input = serde_json::json!({
        "query": query,
        "component": component,
        "severity": severity,
        "top_k": top_k,
    });

    // Execute RAG context command
    let context = run_rag_cli_command("context", &input, api_key).await?;

    // Parse context
    serde_json::from_value(context).map_err(|e| format!("Failed to parse RAG context: {}", e))
}

/// Query KB/Release Notes for domain knowledge (internal use)
///
/// Called by commands_legacy.rs to retrieve domain knowledge for analysis enrichment.
/// Routes: `mode == "remote"` uses native Rust HTTP calls, `mode == "local"` uses Python subprocess.
pub async fn kb_query_internal(
    query: &str,
    mode: &str,
    opensearch_config: Option<OpenSearchConfig>,
    won_version: Option<String>,
    customer: Option<String>,
    top_k: usize,
    api_key: &str,
) -> Result<KBContext, String> {
    if query.len() > MAX_QUERY_SIZE {
        return Err(format!(
            "Query too large: {} bytes exceeds maximum of {} bytes",
            query.len(),
            MAX_QUERY_SIZE
        ));
    }

    // Native Rust path for remote mode (no Python subprocess needed)
    if mode == "remote" {
        if let Some(ref config) = opensearch_config {
            return crate::retrieval::hybrid_kb::query_kb_native(
                config,
                query,
                won_version.as_deref(),
                customer.as_deref(),
                top_k,
                api_key,
            )
            .await;
        }
        // Fall through to Python path if no config
        log::warn!("Remote mode requested but no OpenSearch config; falling back to Python");
    }

    // Python subprocess fallback (local ChromaDB mode or missing config)
    let mut input = serde_json::json!({
        "query": query,
        "mode": mode,
        "won_version": won_version,
        "customer": customer,
        "use_kb": true,
        "use_base_rns": false,
        "use_customer_rns": customer.is_some(),
        "top_k": top_k,
    });

    if let Some(ref config) = opensearch_config {
        input["opensearch_host"] = serde_json::json!(config.host);
        input["opensearch_port"] = serde_json::json!(config.port);
        input["opensearch_user"] = serde_json::json!(config.username);
        input["opensearch_pass"] = serde_json::json!(config.password);
        input["opensearch_ssl"] = serde_json::json!(config.use_ssl);
    }

    let result = run_rag_cli_command("kb-query", &input, api_key).await?;
    serde_json::from_value(result).map_err(|e| format!("Failed to parse KB context: {}", e))
}
