pub mod context;
pub mod database;
pub mod exception;
pub mod stack;

use crate::models::CrashFile;
use crate::patterns::pattern::{PatternMatchers, StringMatcher};
use regex::Regex;

/// Check if a string matcher matches a value
pub fn check_string_matcher(matcher: &StringMatcher, value: &str) -> bool {
    match matcher {
        StringMatcher::Exact(expected) => value == expected,
        StringMatcher::Contains { contains } => value.contains(contains),
        StringMatcher::Regex { regex } => Regex::new(regex)
            .map(|re| re.is_match(value))
            .unwrap_or(false),
        StringMatcher::OneOf { one_of } => one_of.iter().any(|s| value == s),
    }
}

/// Main matching function - checks all conditions
pub fn matches_pattern(crash: &CrashFile, matchers: &PatternMatchers) -> (bool, Vec<String>, f32) {
    let mut matched = Vec::new();
    let mut failed = Vec::new();
    let mut total_weight = 0.0f32;
    let mut matched_weight = 0.0f32;

    // Exception type (weight: 30%)
    if let Some(ref pattern) = matchers.exception_type {
        total_weight += 0.30;
        if exception::matches_exception_type(crash, pattern) {
            matched.push("exception_type".to_string());
            matched_weight += 0.30;
        } else {
            failed.push("exception_type");
        }
    }

    // Exception message (weight: 10%)
    if let Some(ref matcher) = matchers.exception_message {
        total_weight += 0.10;
        if exception::matches_exception_message(crash, matcher) {
            matched.push("exception_message".to_string());
            matched_weight += 0.10;
        } else {
            failed.push("exception_message");
        }
    }

    // Stack contains (weight: 25%)
    if !matchers.stack_contains.is_empty() {
        total_weight += 0.25;
        if stack::matches_stack_contains(crash, &matchers.stack_contains) {
            matched.push(format!("stack_contains: {:?}", matchers.stack_contains));
            matched_weight += 0.25;
        } else {
            failed.push("stack_contains");
        }
    }

    // Stack contains any (weight: 15%)
    if !matchers.stack_contains_any.is_empty() {
        total_weight += 0.15;
        if stack::matches_stack_contains_any(crash, &matchers.stack_contains_any) {
            matched.push("stack_contains_any".to_string());
            matched_weight += 0.15;
        } else {
            failed.push("stack_contains_any");
        }
    }

    // Stack excludes (weight: 10%)
    if !matchers.stack_excludes.is_empty() {
        total_weight += 0.10;
        if stack::matches_stack_excludes(crash, &matchers.stack_excludes) {
            matched.push("stack_excludes".to_string());
            matched_weight += 0.10;
        } else {
            failed.push("stack_excludes");
        }
    }

    // Stack top N (weight: 20%)
    if let Some(ref top_matcher) = matchers.stack_top_n {
        total_weight += 0.20;
        if stack::matches_stack_top_n(crash, top_matcher) {
            matched.push(format!("stack_top_{}", top_matcher.n));
            matched_weight += 0.20;
        } else {
            failed.push("stack_top_n");
        }
    }

    // Context (weight: 15%)
    if let Some(ref ctx_matcher) = matchers.context {
        total_weight += 0.15;
        if context::matches_context(crash, ctx_matcher) {
            matched.push("context".to_string());
            matched_weight += 0.15;
        } else {
            failed.push("context");
        }
    }

    // Database (weight: 15%)
    if let Some(ref db_matcher) = matchers.database {
        total_weight += 0.15;
        if database::matches_database(crash, db_matcher) {
            matched.push("database".to_string());
            matched_weight += 0.15;
        } else {
            failed.push("database");
        }
    }

    // Calculate confidence
    let confidence = if total_weight > 0.0 {
        matched_weight / total_weight
    } else {
        0.0
    };

    // Pattern matches if no required conditions failed
    // (all specified conditions must pass)
    let matches = failed.is_empty() && !matched.is_empty();

    (matches, matched, confidence)
}
