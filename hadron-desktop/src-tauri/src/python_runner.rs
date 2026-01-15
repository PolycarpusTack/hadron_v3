use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize)]
pub struct PythonTranslationResult {
    pub translation: String,
}

// Note: Analysis functions removed - now handled by Rust ai_service module

/// Maximum time to wait for Python translation (2 minutes)
const PYTHON_TIMEOUT_SECS: u64 = 120;

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

    // Spawn Python process with stdin pipe (SECURITY: avoids command injection)
    let mut child = Command::new("python")
        .arg(&python_script.to_string_lossy().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("AI_API_KEY", api_key)
        .env("AI_MODEL", model)
        .env("AI_PROVIDER", provider)
        .spawn()
        .map_err(|e| format!("Failed to spawn Python process: {}", e))?;

    // Write content to stdin (safe from injection)
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write to Python stdin: {}", e))?;
        // stdin is dropped here, closing the pipe
    }

    // Wait for process with timeout
    let output = tokio::task::spawn_blocking(move || {
        // Use wait_with_output but with a timeout mechanism
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    // Process finished, get output
                    return child.wait_with_output();
                }
                Ok(None) => {
                    // Still running, check timeout
                    if start.elapsed() > Duration::from_secs(PYTHON_TIMEOUT_SECS) {
                        let _ = child.kill();
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            format!("Python process timed out after {} seconds", PYTHON_TIMEOUT_SECS),
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
    .map_err(|e| format!("Python process error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python script failed: {}", stderr));
    }

    // Parse JSON output
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Extract JSON from stdout
    let json_start = stdout.find('{').ok_or("No JSON found in output")?;
    let json_end = stdout.rfind('}').ok_or("Malformed JSON in output")?;
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
        // In production, look for script relative to executable
        let mut path = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;

        // Remove executable name to get directory
        path.pop();

        // Add python subfolder
        path.push("python");
        path.push("translate.py");

        if !path.exists() {
            return Err(format!(
                "Python script not found in bundle at: {:?}. Make sure python/ folder is included in Tauri resources.",
                path
            ));
        }

        Ok(path)
    }
}
