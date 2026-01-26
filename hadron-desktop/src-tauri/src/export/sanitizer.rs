use once_cell::sync::Lazy;
use regex::Regex;

// Patterns to redact
static USERNAME_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(user|username|login):\s*\S+")
        .expect("USERNAME_PATTERN is a valid regex")
});
static PASSWORD_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(password|pwd|pass):\s*\S+")
        .expect("PASSWORD_PATTERN is a valid regex")
});
static IP_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}")
        .expect("IP_PATTERN is a valid regex")
});
static EMAIL_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
        .expect("EMAIL_PATTERN is a valid regex")
});
static PATH_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[A-Z]:\\[^\s]+|/(?:home|users|var|tmp)/[^\s]+")
        .expect("PATH_PATTERN is a valid regex")
});
static OID_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"oid\s*[=:]\s*\d+")
        .expect("OID_PATTERN is a valid regex")
});
static HASH_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"#[0-9a-fA-F]{6,}")
        .expect("HASH_PATTERN is a valid regex")
});

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
    static SQL_VALUE_PATTERN: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"'[^']*'").expect("SQL_VALUE_PATTERN is a valid regex")
    });

    // Keep structure but hide specific values
    SQL_VALUE_PATTERN.replace_all(sql, "'[VALUE]'").to_string()
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
