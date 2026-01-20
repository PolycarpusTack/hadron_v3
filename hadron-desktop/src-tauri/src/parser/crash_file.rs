use std::collections::HashMap;
use std::path::Path;

use crate::models::*;
use crate::parser::error::{ParseError, ParseResult};
use crate::parser::patterns::detect_section;
use crate::parser::sections::*;

/// Main crash file parser
pub struct CrashFileParser {
    /// Whether to preserve raw walkback text
    preserve_walkback: bool,
}

impl Default for CrashFileParser {
    fn default() -> Self {
        Self::new()
    }
}

impl CrashFileParser {
    pub fn new() -> Self {
        Self {
            preserve_walkback: true,
        }
    }

    #[allow(dead_code)]
    pub fn with_walkback(mut self, preserve: bool) -> Self {
        self.preserve_walkback = preserve;
        self
    }

    /// Parse a crash file from disk
    pub async fn parse_file(&self, path: &Path) -> ParseResult<CrashFile> {
        let content = tokio::fs::read_to_string(path).await?;
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        let metadata = tokio::fs::metadata(path).await?;

        self.parse_content(&content, &file_name, metadata.len())
    }

    /// Parse crash file content directly
    pub fn parse_content(
        &self,
        content: &str,
        file_name: &str,
        file_size: u64,
    ) -> ParseResult<CrashFile> {
        if content.trim().is_empty() {
            return Err(ParseError::EmptyFile);
        }

        // Split content into sections
        let sections = self.split_sections(content);

        // Parse header from beginning of file
        let header = parse_header(content, file_name, file_size);

        // Parse each section
        let environment = sections
            .get("environment")
            .map(|s| parse_environment(s))
            .unwrap_or_default();

        let exception = sections
            .get("exception")
            .map(|s| parse_exception(s))
            .unwrap_or_default();

        let stack_trace = sections
            .get("stack_trace")
            .map(|s| parse_stack_trace(s))
            .unwrap_or_default();

        let context = sections.get("context").map(|s| parse_context(s));

        let windows = sections
            .get("windows")
            .map(|s| parse_windows(s))
            .unwrap_or_default();

        let quiescent = sections
            .get("quiescent")
            .map(|s| parse_quiescent_processes(s))
            .unwrap_or_default();

        let suspended = sections
            .get("suspended")
            .map(|s| parse_suspended_processes(s))
            .unwrap_or_default();

        let connections = sections
            .get("db_connections")
            .map(|s| parse_db_connections(s))
            .unwrap_or_default();

        let sessions = sections
            .get("db_sessions")
            .map(|s| parse_db_sessions(s))
            .unwrap_or_default();

        let has_active_transaction = connections.iter().any(|c| c.has_transaction);
        let active_transaction_count = connections.iter().filter(|c| c.has_transaction).count();

        let memory = sections
            .get("memory")
            .map(|s| parse_memory(s))
            .unwrap_or_default();

        let command_line = sections.get("command_line").cloned();

        let raw_walkback = if self.preserve_walkback {
            sections.get("walkback").cloned()
        } else {
            None
        };

        // Extract active process from stack trace context or dedicated section
        let active_process = sections
            .get("active_process")
            .and_then(|s| parse_active_process(s));

        Ok(CrashFile {
            header,
            environment,
            exception,
            active_process,
            stack_trace,
            context,
            windows,
            processes: ProcessLists {
                quiescent,
                suspended,
            },
            database: DatabaseState {
                connections,
                sessions,
                has_active_transaction,
                active_transaction_count,
            },
            memory,
            command_line,
            raw_walkback,
        })
    }

    /// Split the file into named sections
    fn split_sections(&self, content: &str) -> HashMap<String, String> {
        let mut sections: HashMap<String, String> = HashMap::new();
        let mut current_section = String::new();
        let mut current_content = String::new();

        for line in content.lines() {
            // Check if this line starts a new section
            if let Some(section_name) = detect_section(line) {
                // Save previous section
                if !current_section.is_empty() && !current_content.is_empty() {
                    let key = self.normalize_section_name(&current_section);
                    sections.insert(key, current_content.trim().to_string());
                }
                current_section = section_name.to_string();
                current_content.clear();
            } else {
                current_content.push_str(line);
                current_content.push('\n');
            }
        }

        // Don't forget the last section
        if !current_section.is_empty() && !current_content.is_empty() {
            let key = self.normalize_section_name(&current_section);
            sections.insert(key, current_content.trim().to_string());
        }

        // Also try to extract sections if no clear headers found
        if sections.is_empty() || !sections.contains_key("exception") {
            self.extract_sections_heuristically(content, &mut sections);
        }

        sections
    }

    fn normalize_section_name(&self, name: &str) -> String {
        let lower = name.to_lowercase();

        if lower.contains("exception") {
            return "exception".to_string();
        }
        if lower.contains("environment") || lower.contains("system info") {
            return "environment".to_string();
        }
        if lower.contains("stack") && !lower.contains("context") {
            return "stack_trace".to_string();
        }
        if lower.contains("context") || lower.contains("argument") {
            return "context".to_string();
        }
        if lower.contains("window") {
            return "windows".to_string();
        }
        if lower.contains("quiescent") {
            return "quiescent".to_string();
        }
        if lower.contains("suspended") {
            return "suspended".to_string();
        }
        if lower.contains("database") && lower.contains("connection") {
            return "db_connections".to_string();
        }
        if lower.contains("database") && lower.contains("session") {
            return "db_sessions".to_string();
        }
        if lower.contains("memory") {
            return "memory".to_string();
        }
        if lower.contains("command") {
            return "command_line".to_string();
        }
        if lower.contains("walkback") {
            return "walkback".to_string();
        }
        if lower.contains("active process") {
            return "active_process".to_string();
        }

        lower.replace(' ', "_")
    }

    /// Fallback: try to find sections without clear headers
    fn extract_sections_heuristically(
        &self,
        content: &str,
        sections: &mut HashMap<String, String>,
    ) {
        // Look for exception pattern anywhere
        if !sections.contains_key("exception") {
            for line in content.lines() {
                if line.contains("Unhandled exception")
                    || line.contains("Exception Class")
                    || line.contains("Error:")
                {
                    // Take this line and following context
                    let idx = content.find(line).unwrap_or(0);
                    let exception_content: String = content[idx..]
                        .lines()
                        .take(10)
                        .collect::<Vec<_>>()
                        .join("\n");
                    sections.insert("exception".to_string(), exception_content);
                    break;
                }
            }
        }

        // Look for stack trace pattern (numbered frames)
        if !sections.contains_key("stack_trace") {
            let mut stack_lines = Vec::new();
            for line in content.lines() {
                if line.trim().starts_with('[') && line.contains(']') {
                    stack_lines.push(line);
                }
            }
            if !stack_lines.is_empty() {
                sections.insert("stack_trace".to_string(), stack_lines.join("\n"));
            }
        }
    }
}

fn parse_active_process(content: &str) -> Option<ActiveProcess> {
    let mut name = None;
    let mut priority = None;
    let mut hash = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // First non-empty line is usually the process name
        if name.is_none() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            name = Some(parts[0].trim_matches('\'').to_string());
            priority = parts.get(1).map(|s| s.to_string());
            hash = parts
                .iter()
                .find(|s| s.starts_with('#'))
                .map(|s| s.to_string());
            break;
        }
    }

    name.map(|n| ActiveProcess {
        name: n,
        priority,
        hash,
    })
}
