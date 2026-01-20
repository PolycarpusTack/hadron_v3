use crate::models::Exception;
use crate::parser::patterns::*;

pub fn parse_exception(content: &str) -> Exception {
    let mut exception_type = String::new();
    let mut message = String::new();
    let mut parameter = None;
    let mut signal_name = None;
    let mut is_resumable = false;

    for line in content.lines() {
        let line = line.trim();

        // Exception class
        if exception_type.is_empty() {
            if let Some(caps) = EXCEPTION_CLASS.captures(line) {
                exception_type = caps
                    .get(1)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
            } else if let Some(caps) = EXCEPTION_CLASS_ALT.captures(line) {
                exception_type = caps
                    .get(1)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
            }
        }

        // Message/parameter
        if line.starts_with("messageText") || line.starts_with("errorString") {
            if let Some(idx) = line.find(':') {
                message = line[idx + 1..].trim().trim_matches('\'').to_string();
            }
        }

        if line.starts_with("parameter") {
            if let Some(idx) = line.find(':') {
                parameter = Some(line[idx + 1..].trim().trim_matches('\'').to_string());
            }
        }

        // Signal name
        if let Some(caps) = SIGNAL_NAME.captures(line) {
            signal_name = caps.get(1).map(|m| m.as_str().to_string());
        }

        // Resumable flag
        if line.to_lowercase().contains("resumable") {
            is_resumable =
                line.to_lowercase().contains("true") || line.to_lowercase().contains("yes");
        }
    }

    // If we still don't have exception type, try first non-empty line
    if exception_type.is_empty() {
        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.contains(':') {
                exception_type = trimmed.to_string();
                break;
            }
        }
    }

    Exception {
        exception_type,
        message,
        parameter,
        signal_name,
        is_resumable,
    }
}
