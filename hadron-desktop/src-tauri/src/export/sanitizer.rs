use lazy_static::lazy_static;
use regex::Regex;

lazy_static! {
    // Patterns to redact
    static ref USERNAME_PATTERN: Regex = Regex::new(r"(?i)(user|username|login):\s*\S+").unwrap();
    static ref PASSWORD_PATTERN: Regex = Regex::new(r"(?i)(password|pwd|pass):\s*\S+").unwrap();
    static ref IP_PATTERN: Regex = Regex::new(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}").unwrap();
    static ref EMAIL_PATTERN: Regex = Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap();
    static ref PATH_PATTERN: Regex = Regex::new(r"[A-Z]:\\[^\s]+|/(?:home|users|var|tmp)/[^\s]+").unwrap();
    static ref OID_PATTERN: Regex = Regex::new(r"oid\s*[=:]\s*\d+").unwrap();
    static ref HASH_PATTERN: Regex = Regex::new(r"#[0-9a-fA-F]{6,}").unwrap();
}

/// Sanitize content for customer-facing reports
pub fn sanitize_for_customer(text: &str) -> String {
    let mut result = text.to_string();

    // Redact potentially sensitive information
    result = USERNAME_PATTERN
        .replace_all(&result, "$1: [REDACTED]")
        .to_string();
    result = PASSWORD_PATTERN
        .replace_all(&result, "$1: [REDACTED]")
        .to_string();
    result = IP_PATTERN.replace_all(&result, "[IP_REDACTED]").to_string();
    result = EMAIL_PATTERN
        .replace_all(&result, "[EMAIL_REDACTED]")
        .to_string();
    result = PATH_PATTERN
        .replace_all(&result, "[PATH_REDACTED]")
        .to_string();
    result = OID_PATTERN
        .replace_all(&result, "oid: [REDACTED]")
        .to_string();
    result = HASH_PATTERN.replace_all(&result, "#[HASH]").to_string();

    result
}

/// Remove technical jargon for non-technical audiences
pub fn simplify_technical_terms(text: &str) -> String {
    let replacements = [
        ("SubscriptOutOfBoundsError", "list access error"),
        ("SubscriptOutOfBounds", "list access error"),
        ("MessageNotUnderstood", "operation error"),
        ("OrderedCollection", "list"),
        ("Dictionary", "lookup table"),
        ("nil", "empty value"),
        ("UndefinedObject", "missing value"),
        ("transaction", "pending changes"),
        ("rollback", "undo changes"),
        ("deadlock", "operation conflict"),
        ("stack trace", "error location"),
    ];

    let mut result = text.to_string();
    for (from, to) in replacements {
        result = result.replace(from, to);
    }
    result
}

/// Sanitize SQL queries (remove table names, values)
#[allow(dead_code)]
pub fn sanitize_sql(sql: &str) -> String {
    let result = Regex::new(r"'[^']*'")
        .unwrap()
        .replace_all(sql, "'[VALUE]'");

    // Keep structure but hide specific values
    result.to_string()
}

/// Check if content contains potentially sensitive data
pub fn has_sensitive_content(text: &str) -> bool {
    USERNAME_PATTERN.is_match(text)
        || PASSWORD_PATTERN.is_match(text)
        || EMAIL_PATTERN.is_match(text)
        || IP_PATTERN.is_match(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_username() {
        let input = "User: john.doe logged in";
        let result = sanitize_for_customer(input);
        assert!(!result.contains("john.doe"));
        assert!(result.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_ip() {
        let input = "Connected to 192.168.1.100";
        let result = sanitize_for_customer(input);
        assert!(!result.contains("192.168.1.100"));
    }

    #[test]
    fn test_simplify_terms() {
        let input = "SubscriptOutOfBoundsError in OrderedCollection";
        let result = simplify_technical_terms(input);
        assert!(result.contains("list access error"));
        assert!(result.contains("list"));
    }
}
