use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct PythonTranslationResult {
    pub translation: String,
}

// Note: Analysis functions removed - now handled by Rust ai_service module

/// Run Python translation script on technical content
pub async fn run_python_translation(
    content: &str,
    api_key: &str,
    model: &str,
    provider: &str,
) -> Result<PythonTranslationResult, String> {
    // Get the Python translation script path
    let python_script = get_translation_script_path()?;

    // Set environment variables for AI provider and API key
    let output = Command::new("python")
        .arg(&python_script.to_string_lossy().to_string())
        .arg(content)
        .env("AI_API_KEY", api_key)
        .env("AI_MODEL", model)
        .env("AI_PROVIDER", provider)
        .output()
        .map_err(|e| format!("Failed to run Python: {}", e))?;

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
