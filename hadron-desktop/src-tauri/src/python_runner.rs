use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct PythonTranslationResult {
    pub translation: String,
}

// Note: Analysis functions removed - now handled by Rust ai_service module

/// Maximum time to wait for Python translation (5 minutes for complex code analysis)
const PYTHON_TIMEOUT_SECS: u64 = 300;

/// Maximum content size to process (1MB) - prevents memory exhaustion
const MAX_CONTENT_SIZE: usize = 1024 * 1024;

/// Run Python translation script on technical content
///
/// Security: Content is passed via stdin (not CLI args) to prevent command injection.
/// Robustness: Includes timeout and content size limits.
pub async fn run_python_translation(
    content: &str,
    api_key: &str,
    model: &str,
    provider: &str,
) -> Result<PythonTranslationResult, String> {
    // Validate content size to prevent memory exhaustion
    if content.len() > MAX_CONTENT_SIZE {
        return Err(format!(
            "Content too large: {} bytes exceeds maximum of {} bytes",
            content.len(),
            MAX_CONTENT_SIZE
        ));
    }

    // Get the Python translation script path
    let python_script = get_translation_script_path()?;

    // SECURITY: Pass credentials via stdin JSON instead of environment variables
    // Environment variables are visible in /proc/<pid>/environ and process listings
    let stdin_payload = serde_json::json!({
        "content": content,
        "api_key": api_key,
        "model": model,
        "provider": provider
    });
    let stdin_json = serde_json::to_string(&stdin_payload)
        .map_err(|e| format!("Failed to serialize stdin payload: {}", e))?;

    // Spawn Python process with stdin pipe (SECURITY: avoids command injection)
    // On Windows, use CREATE_NO_WINDOW flag to prevent a console window from appearing
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = tokio::process::Command::new("python");
    cmd.arg(python_script.to_string_lossy().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Kill child automatically if the future is dropped (e.g. on timeout)
        .kill_on_drop(true);

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Python process: {}", e))?;

    // Write JSON payload to stdin (contains content + credentials securely)
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(stdin_json.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to Python stdin: {}", e))?;
        // stdin dropped here, closing the pipe and signalling EOF to the child
    }

    // Wait for process with timeout. kill_on_drop(true) ensures the child is
    // killed if the future is cancelled when the timeout fires.
    let output = tokio::time::timeout(
        Duration::from_secs(PYTHON_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| {
        format!(
            "Python process timed out after {} seconds",
            PYTHON_TIMEOUT_SECS
        )
    })?
    .map_err(|e| format!("Python process error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // SECURITY: Log full error for debugging but return sanitized message to frontend
        log::error!("Python script failed with stderr: {}", stderr);

        // Extract only the last line (usually the actual error) and sanitize
        let sanitized_error = stderr.lines().last().unwrap_or("Unknown error").trim();

        // Remove file paths and sensitive info from error message
        let safe_error = if sanitized_error.contains("API") || sanitized_error.contains("key") {
            "Translation failed: API error (check logs for details)"
        } else if sanitized_error.contains("ModuleNotFoundError") {
            "Translation failed: Python dependency missing"
        } else if sanitized_error.contains("ConnectionError") || sanitized_error.contains("timeout")
        {
            "Translation failed: Network error"
        } else if sanitized_error.len() > 100 {
            "Translation failed: Internal error (check logs for details)"
        } else {
            sanitized_error
        };

        return Err(format!("Python script failed: {}", safe_error));
    }

    // Parse JSON output
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Extract JSON from stdout
    let json_start = stdout.find('{').ok_or("No JSON found in output")?;
    let json_end = stdout.rfind('}').ok_or("Malformed JSON in output")?;

    // SECURITY: Validate slice bounds to prevent panic
    if json_start > json_end {
        return Err("Malformed JSON: invalid bounds in output".to_string());
    }
    let json_str = &stdout[json_start..=json_end];

    serde_json::from_str(json_str).map_err(|e| format!("Failed to parse JSON: {}", e))
}

fn get_translation_script_path() -> Result<PathBuf, String> {
    // In development, use python/translate.py relative to workspace root
    // In production, use bundled resource path

    #[cfg(debug_assertions)]
    {
        // In dev mode, script is one level up from src-tauri directory
        let mut path = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?;

        // If we're in src-tauri, go up one level
        if path.ends_with("src-tauri") {
            path.pop();
        }

        path.push("python");
        path.push("translate.py");

        if !path.exists() {
            return Err(format!("Python script not found at: {:?}", path));
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
            // Standard relative path (MSI installer, some configurations)
            exe_dir.join("python").join("translate.py"),
            // Tauri 2.x _up_ path for relative resources (../python from tauri.conf.json)
            exe_dir.join("_up_").join("python").join("translate.py"),
            // Resources might be in a 'resources' subdirectory
            exe_dir.join("resources").join("python").join("translate.py"),
            // NSIS installer on Windows places files in AppData/Local
            {
                let mut appdata_path = exe_dir.to_path_buf();
                appdata_path.push("python");
                appdata_path.push("translate.py");
                appdata_path
            },
        ];

        for path in &possible_paths {
            log::debug!("Checking for Python script at: {:?}", path);
            if path.exists() {
                log::info!("Found Python script at: {:?}", path);
                return Ok(path.clone());
            }
        }

        // If not found, return error with all checked paths
        Err(format!(
            "Python script not found in bundle. Checked paths: {:?}. \
             Make sure python/ folder is included in Tauri resources and rebuild the app.",
            possible_paths
        ))
    }
}
