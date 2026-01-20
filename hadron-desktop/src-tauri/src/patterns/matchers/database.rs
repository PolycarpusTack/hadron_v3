use crate::models::CrashFile;
use crate::patterns::matchers::check_string_matcher;
use crate::patterns::pattern::DatabaseMatcher;

/// Check if database state matches conditions
pub fn matches_database(crash: &CrashFile, matcher: &DatabaseMatcher) -> bool {
    let db = &crash.database;

    // Check active transaction
    if let Some(should_have) = matcher.has_active_transaction {
        if db.has_active_transaction != should_have {
            return false;
        }
    }

    // Check backend
    if let Some(ref expected_backend) = matcher.backend {
        let detected_backend = detect_backend(crash);
        if !detected_backend.eq_ignore_ascii_case(expected_backend) {
            return false;
        }
    }

    // Check error contains
    if let Some(ref error_pattern) = matcher.error_contains {
        let error_text = format!(
            "{} {}",
            crash.exception.exception_type, crash.exception.message
        );
        if !error_text
            .to_lowercase()
            .contains(&error_pattern.to_lowercase())
        {
            return false;
        }
    }

    // Check prepared statement
    if let Some(ref stmt_matcher) = matcher.prepared_statement {
        let has_match = db.sessions.iter().any(|s| {
            s.prepared_statement
                .as_ref()
                .map(|ps| check_string_matcher(stmt_matcher, ps))
                .unwrap_or(false)
        });
        if !has_match {
            return false;
        }
    }

    true
}

/// Detect database backend from crash data
pub fn detect_backend(crash: &CrashFile) -> String {
    // Check environment
    if crash.environment.oracle_server.is_some() {
        return "oracle".to_string();
    }
    if crash.environment.postgres_version.is_some() {
        return "postgresql".to_string();
    }

    // Check error message
    let error_text = format!(
        "{} {}",
        crash.exception.exception_type, crash.exception.message
    )
    .to_lowercase();

    if error_text.contains("postgres") || error_text.contains("libpq") {
        return "postgresql".to_string();
    }
    if error_text.contains("oracle") || error_text.contains("ora-") {
        return "oracle".to_string();
    }

    // Check stack
    for frame in &crash.stack_trace {
        let sig = frame.method_signature.to_lowercase();
        if sig.contains("postgres") {
            return "postgresql".to_string();
        }
        if sig.contains("oracle") || sig.contains("exdi") {
            return "oracle".to_string();
        }
    }

    "unknown".to_string()
}

/// Check if crash is a prepared statement error
#[allow(dead_code)]
pub fn is_prepared_statement_error(crash: &CrashFile) -> bool {
    let error_text = format!(
        "{} {}",
        crash.exception.exception_type, crash.exception.message
    );
    error_text.contains("prepared statement") && error_text.contains("does not exist")
}

/// Extract prepared statement name from error
pub fn extract_prepared_statement_name(crash: &CrashFile) -> Option<String> {
    let re = regex::Regex::new(r#"prepared statement\s+['"]([\w\d]+)['"]"#).ok()?;
    let error_text = format!(
        "{} {}",
        crash.exception.exception_type, crash.exception.message
    );
    re.captures(&error_text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}
