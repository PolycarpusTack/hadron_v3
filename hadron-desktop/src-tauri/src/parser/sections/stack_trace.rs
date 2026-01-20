use crate::models::{FrameType, StackFrame};
use crate::parser::patterns::*;

pub fn parse_stack_trace(content: &str) -> Vec<StackFrame> {
    let mut frames = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(caps) = STACK_FRAME.captures(line) {
            let frame_number: u32 = caps
                .get(1)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0);

            let method_signature = caps
                .get(2)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();

            let frame = parse_frame(frame_number, &method_signature);
            frames.push(frame);
        }
    }

    frames
}

fn parse_frame(frame_number: u32, signature: &str) -> StackFrame {
    let is_optimized = signature.starts_with("optimized");
    let is_block_closure = signature.contains("[] in");

    // Clean up signature for parsing
    let clean_sig = signature.replace("optimized ", "").replace("[] in ", "");

    let (namespace, class_name, parent_class, method_name) = extract_method_parts(&clean_sig);

    let frame_type = classify_frame(signature);

    StackFrame {
        frame_number,
        method_signature: signature.to_string(),
        class_name,
        parent_class,
        method_name,
        namespace,
        is_optimized,
        is_block_closure,
        frame_type,
    }
}

fn extract_method_parts(
    signature: &str,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    // Try to match: Namespace.Class(Parent)>>method
    if let Some(caps) = METHOD_SIGNATURE.captures(signature) {
        let namespace = caps.get(1).map(|m| m.as_str().to_string());
        let class_name = caps.get(2).map(|m| m.as_str().to_string());
        let parent_class = caps.get(3).map(|m| m.as_str().to_string());
        let method_name = caps.get(4).map(|m| m.as_str().to_string());
        return (namespace, class_name, parent_class, method_name);
    }

    // Fallback: try simple Class>>method pattern
    if let Some(idx) = signature.find(">>") {
        let class_part = &signature[..idx];
        let method_part = &signature[idx + 2..];

        // Check for namespace in class
        let (namespace, class_name) = if let Some(dot_idx) = class_part.rfind('.') {
            (
                Some(class_part[..dot_idx].to_string()),
                Some(class_part[dot_idx + 1..].to_string()),
            )
        } else {
            (None, Some(class_part.to_string()))
        };

        return (namespace, class_name, None, Some(method_part.to_string()));
    }

    (None, None, None, None)
}

fn classify_frame(signature: &str) -> FrameType {
    let sig_lower = signature.to_lowercase();

    // Error/exception handling
    if sig_lower.contains("error")
        || sig_lower.contains("exception")
        || sig_lower.contains("signal")
        || sig_lower.contains("subscriptbounds")
        || sig_lower.contains("walkback")
    {
        return FrameType::Error;
    }

    // Application code (MediaGeniX namespace)
    if signature.contains("MediaGeniX.") {
        return FrameType::Application;
    }

    // Database related
    if sig_lower.contains("exdi")
        || sig_lower.contains("oracle")
        || sig_lower.contains("postgres")
        || sig_lower.contains("database")
        || sig_lower.contains("sql")
    {
        return FrameType::Database;
    }

    // Check for other common application indicators
    if signature.starts_with("PSI")
        || signature.starts_with("BM")
        || signature.starts_with("PL")
        || signature.starts_with("WOn")
    {
        return FrameType::Application;
    }

    FrameType::Framework
}
