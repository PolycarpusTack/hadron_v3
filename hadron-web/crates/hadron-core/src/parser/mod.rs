pub mod signature;

use crate::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

/// Parsed crash file content ready for AI analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCrashFile {
    pub error_type: Option<String>,
    pub error_message: Option<String>,
    pub stack_trace: Option<String>,
    pub component: Option<String>,
    pub raw_content: String,
    pub file_size_bytes: u64,
}

/// Parse raw crash file content into structured fields.
///
/// Extracts error type, error message, stack trace, and component
/// from WCR-format crash logs.
pub fn parse_crash_content(content: &str) -> HadronResult<ParsedCrashFile> {
    if content.is_empty() {
        return Err(HadronError::Validation("Empty crash content".into()));
    }

    let mut error_type = None;
    let mut error_message = None;
    let mut stack_trace_lines = Vec::new();
    let mut component = None;
    let mut in_stack_trace = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // Detect error type markers
        if trimmed.starts_with("Error:") || trimmed.starts_with("Exception:") {
            let value = trimmed
                .splitn(2, ':')
                .nth(1)
                .map(|s| s.trim().to_string());
            if error_type.is_none() {
                error_type = value;
            }
        }

        // Detect error message
        if trimmed.starts_with("Message:") || trimmed.starts_with("Description:") {
            let value = trimmed
                .splitn(2, ':')
                .nth(1)
                .map(|s| s.trim().to_string());
            if error_message.is_none() {
                error_message = value;
            }
        }

        // Stack trace section
        if trimmed.contains("Stack Trace") || trimmed.contains("Traceback") {
            in_stack_trace = true;
            continue;
        }

        if in_stack_trace {
            if trimmed.is_empty() && !stack_trace_lines.is_empty() {
                in_stack_trace = false;
            } else if !trimmed.is_empty() {
                stack_trace_lines.push(line.to_string());
            }
        }

        // Detect component from namespace patterns
        if component.is_none() {
            for prefix in &["PSI", "BM", "PL", "WOn", "EX"] {
                if trimmed.contains(prefix) {
                    component = Some(prefix.to_string());
                    break;
                }
            }
        }
    }

    let stack_trace = if stack_trace_lines.is_empty() {
        None
    } else {
        Some(stack_trace_lines.join("\n"))
    };

    Ok(ParsedCrashFile {
        error_type,
        error_message,
        stack_trace,
        component,
        raw_content: content.to_string(),
        file_size_bytes: content.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_content() {
        let result = parse_crash_content("");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_basic_crash() {
        let content = "Error: SubscriptOutOfBounds\n\
                       Message: Index 5 is out of range\n\
                       Stack Trace:\n\
                       PSITxBlock>>removeTimeAllocations:\n\
                       BMProgram>>schedule\n";
        let parsed = parse_crash_content(content).unwrap();
        assert_eq!(parsed.error_type.as_deref(), Some("SubscriptOutOfBounds"));
        assert!(parsed.stack_trace.is_some());
        assert_eq!(parsed.component.as_deref(), Some("PSI"));
    }
}
