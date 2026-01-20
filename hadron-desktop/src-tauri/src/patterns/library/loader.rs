use crate::patterns::pattern::CrashPattern;
use anyhow::Result;
use log::{info, warn};
use std::path::Path;

/// Load patterns from TOML files
pub fn load_patterns_from_directory(dir: &Path) -> Result<Vec<CrashPattern>> {
    let mut patterns = Vec::new();

    if !dir.exists() {
        warn!("Pattern directory does not exist: {:?}", dir);
        return Ok(patterns);
    }

    let pattern_path = dir.join("*.toml");
    let pattern_str = pattern_path.to_str().unwrap_or("");

    let toml_files = glob::glob(pattern_str)?;

    for entry in toml_files.flatten() {
        match load_patterns_from_file(&entry) {
            Ok(file_patterns) => {
                info!("Loaded {} patterns from {:?}", file_patterns.len(), entry);
                patterns.extend(file_patterns);
            }
            Err(e) => {
                warn!("Failed to load patterns from {:?}: {}", entry, e);
            }
        }
    }

    Ok(patterns)
}

/// Load patterns from a single TOML file
pub fn load_patterns_from_file(path: &Path) -> Result<Vec<CrashPattern>> {
    let content = std::fs::read_to_string(path)?;
    let parsed: PatternFile = toml::from_str(&content)?;
    Ok(parsed.patterns)
}

/// Load patterns from a TOML string
#[allow(dead_code)]
pub fn load_patterns_from_string(content: &str) -> Result<Vec<CrashPattern>> {
    let parsed: PatternFile = toml::from_str(content)?;
    Ok(parsed.patterns)
}

#[derive(Debug, serde::Deserialize)]
struct PatternFile {
    #[serde(rename = "pattern")]
    patterns: Vec<CrashPattern>,
}
