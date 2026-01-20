use crate::models::CrashFile;
use crate::patterns::matchers::check_string_matcher;
use crate::patterns::pattern::StringMatcher;
use regex::Regex;

/// Check if exception type matches pattern
pub fn matches_exception_type(crash: &CrashFile, pattern: &str) -> bool {
    let exception_type = &crash.exception.exception_type;

    // Try regex match first
    if let Ok(re) = Regex::new(pattern) {
        if re.is_match(exception_type) {
            return true;
        }
    }

    // Fallback to substring match
    exception_type.contains(pattern)
}

/// Check if exception message matches
pub fn matches_exception_message(crash: &CrashFile, matcher: &StringMatcher) -> bool {
    let message = &crash.exception.message;
    check_string_matcher(matcher, message)
}

/// Check if exception parameter matches
#[allow(dead_code)]
pub fn matches_exception_parameter(crash: &CrashFile, matcher: &StringMatcher) -> bool {
    if let Some(ref param) = crash.exception.parameter {
        check_string_matcher(matcher, param)
    } else {
        false
    }
}

/// Check if parameter is a number exceeding a threshold
#[allow(dead_code)]
pub fn parameter_exceeds(crash: &CrashFile, threshold: usize) -> bool {
    crash
        .exception
        .parameter
        .as_ref()
        .and_then(|p| p.parse::<usize>().ok())
        .map(|n| n > threshold)
        .unwrap_or(false)
}
