//! Heuristic language detection from file extension and code patterns.

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

static LANGUAGE_EXTENSIONS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("sql", "SQL");
    m.insert("tsx", "React");
    m.insert("jsx", "React");
    m.insert("ts", "TypeScript");
    m.insert("js", "JavaScript");
    m.insert("st", "Smalltalk");
    m.insert("py", "Python");
    m.insert("rs", "Rust");
    m.insert("go", "Go");
    m.insert("java", "Java");
    m.insert("xml", "XML");
    m.insert("html", "HTML");
    m.insert("css", "CSS");
    m.insert("json", "JSON");
    m.insert("yaml", "YAML");
    m.insert("yml", "YAML");
    m.insert("md", "Markdown");
    m.insert("rb", "Ruby");
    m
});

/// Detect the programming language from a filename and/or code content.
///
/// Priority: file extension > pattern-based detection > "Plaintext"
pub fn detect_language(code: &str, filename: &str) -> String {
    // Check file extension first
    if let Some(ext) = filename.rsplit('.').next() {
        let lower = ext.to_lowercase();
        if lower != filename.to_lowercase() {
            // Only use extension if the filename actually had a dot
            if let Some(lang) = LANGUAGE_EXTENSIONS.get(lower.as_str()) {
                return lang.to_string();
            }
        }
    }

    // Pattern-based detection
    if Regex::new(r"(?i)SELECT\s+.+\s+FROM\s+").unwrap().is_match(code) {
        return "SQL".to_string();
    }
    if Regex::new(r#"(?i)import\s+React|from\s+['"]react['"]"#).unwrap().is_match(code) {
        return "React".to_string();
    }
    if Regex::new(r"(?i)def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import").unwrap().is_match(code) {
        return "Python".to_string();
    }
    if Regex::new(r"(?i)\|\s*\w+\s*\||\w+\s*>>\s*\w+|ifTrue:|ifFalse:").unwrap().is_match(code) {
        return "Smalltalk".to_string();
    }
    if Regex::new(r"(?i)fn\s+\w+|let\s+mut|impl\s+").unwrap().is_match(code) {
        return "Rust".to_string();
    }
    if Regex::new(r"(?i)func\s+\w+|package\s+main").unwrap().is_match(code) {
        return "Go".to_string();
    }
    if Regex::new(r"(?i)<\w+[^>]*>|</\w+>").unwrap().is_match(code) {
        return "XML".to_string();
    }

    "Plaintext".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_by_extension() {
        assert_eq!(detect_language("", "main.rs"), "Rust");
        assert_eq!(detect_language("", "app.tsx"), "React");
        assert_eq!(detect_language("", "query.sql"), "SQL");
        assert_eq!(detect_language("", "script.py"), "Python");
    }

    #[test]
    fn test_detect_by_pattern() {
        assert_eq!(detect_language("SELECT id FROM users WHERE active = 1", ""), "SQL");
        assert_eq!(detect_language("import React from 'react'", ""), "React");
        assert_eq!(detect_language("def hello():\n    pass", ""), "Python");
        assert_eq!(detect_language("fn main() { println!(\"hi\"); }", ""), "Rust");
        assert_eq!(detect_language("func main() { fmt.Println() }", ""), "Go");
    }

    #[test]
    fn test_detect_fallback() {
        assert_eq!(detect_language("just some text", ""), "Plaintext");
        assert_eq!(detect_language("", ""), "Plaintext");
    }

    #[test]
    fn test_extension_takes_priority() {
        assert_eq!(detect_language("SELECT * FROM table", "script.py"), "Python");
    }
}
