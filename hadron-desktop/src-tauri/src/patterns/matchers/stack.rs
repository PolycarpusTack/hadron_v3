use crate::models::{CrashFile, FrameType, StackFrame};
use crate::patterns::pattern::StackTopMatcher;

/// Check if stack contains all specified methods (in order)
pub fn matches_stack_contains(crash: &CrashFile, methods: &[String]) -> bool {
    if methods.is_empty() {
        return true;
    }

    let stack_text: String = crash
        .stack_trace
        .iter()
        .map(|f| f.method_signature.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    // All methods must appear, in order
    let mut last_pos = 0;
    for method in methods {
        if let Some(pos) = stack_text[last_pos..].find(method) {
            last_pos += pos + method.len();
        } else {
            return false;
        }
    }

    true
}

/// Check if stack contains at least one of the methods
pub fn matches_stack_contains_any(crash: &CrashFile, methods: &[String]) -> bool {
    if methods.is_empty() {
        return true;
    }

    crash
        .stack_trace
        .iter()
        .any(|frame| methods.iter().any(|m| frame.method_signature.contains(m)))
}

/// Check that stack does NOT contain any of these methods
pub fn matches_stack_excludes(crash: &CrashFile, methods: &[String]) -> bool {
    if methods.is_empty() {
        return true;
    }

    !crash
        .stack_trace
        .iter()
        .any(|frame| methods.iter().any(|m| frame.method_signature.contains(m)))
}

/// Check if top N frames contain a specific method
pub fn matches_stack_top_n(crash: &CrashFile, matcher: &StackTopMatcher) -> bool {
    crash
        .stack_trace
        .iter()
        .take(matcher.n)
        .any(|frame| frame.method_signature.contains(&matcher.contains))
}

/// Get the first application-level frame
pub fn get_first_application_frame(crash: &CrashFile) -> Option<&StackFrame> {
    crash
        .stack_trace
        .iter()
        .find(|f| matches!(f.frame_type, FrameType::Application))
}

/// Check if a specific class appears in application frames
#[allow(dead_code)]
pub fn application_frame_has_class(crash: &CrashFile, class_pattern: &str) -> bool {
    crash
        .stack_trace
        .iter()
        .filter(|f| matches!(f.frame_type, FrameType::Application))
        .any(|f| {
            f.class_name
                .as_ref()
                .map(|c| c.contains(class_pattern))
                .unwrap_or(false)
                || f.method_signature.contains(class_pattern)
        })
}
