//! Crash Signature System
//!
//! Stable fingerprinting to identify semantically identical crashes
//! regardless of timestamp, user, or machine.
//!
//! Extracted from hadron-desktop, database-agnostic.

use crate::models::{CrashSignature, SignatureComponents};
use chrono::Utc;
use once_cell::sync::Lazy;
use regex::Regex;
use sha2::{Digest, Sha256};

/// Configuration for signature generation.
pub struct SignatureConfig {
    pub max_application_frames: usize,
    pub include_database_backend: bool,
    pub include_module: bool,
}

impl Default for SignatureConfig {
    fn default() -> Self {
        Self {
            max_application_frames: 5,
            include_database_backend: false,
            include_module: true,
        }
    }
}

static METHOD_EXTRACTOR: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?:MediaGeniX\.)?(\w+(?:>>\w+[:\w]*)?)")
        .expect("METHOD_EXTRACTOR is a valid regex pattern")
});

static ORACLE_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(oracle|ora-\d+|exdi.*oracle)")
        .expect("ORACLE_PATTERN is a valid regex pattern")
});

static POSTGRES_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(postgres|libpq|prepared statement|pgconn)")
        .expect("POSTGRES_PATTERN is a valid regex pattern")
});

/// Compute a crash signature from analysis data.
pub fn compute_signature(
    error_type: &str,
    stack_trace: Option<&str>,
    root_cause: &str,
    config: &SignatureConfig,
) -> CrashSignature {
    let components = extract_components(error_type, stack_trace, root_cause, config);
    let canonical = build_canonical_string(&components);
    let hash = compute_hash(&canonical);
    let now = Utc::now().to_rfc3339();

    CrashSignature {
        hash,
        canonical,
        components,
        first_seen: now.clone(),
        last_seen: now,
        occurrence_count: 1,
        linked_ticket: None,
        linked_ticket_url: None,
        status: "new".to_string(),
    }
}

fn extract_components(
    error_type: &str,
    stack_trace: Option<&str>,
    root_cause: &str,
    config: &SignatureConfig,
) -> SignatureComponents {
    let exception_type = normalize_exception_type(error_type);

    let application_frames = if let Some(trace) = stack_trace {
        extract_application_frames(trace, config.max_application_frames)
    } else {
        Vec::new()
    };

    let affected_module = if config.include_module {
        infer_module(stack_trace, root_cause)
    } else {
        None
    };

    let database_backend = if config.include_database_backend {
        detect_database_backend(stack_trace, root_cause)
    } else {
        None
    };

    SignatureComponents {
        exception_type,
        application_frames,
        affected_module,
        database_backend,
    }
}

fn normalize_exception_type(raw: &str) -> String {
    raw.trim()
        .replace("MediaGeniX.", "")
        .replace("Smalltalk.", "")
        .to_string()
}

fn extract_application_frames(trace: &str, max_frames: usize) -> Vec<String> {
    let mut frames = Vec::new();

    for line in trace.lines() {
        if is_application_frame(line) {
            if let Some(normalized) = normalize_method_name(line) {
                frames.push(normalized);
                if frames.len() >= max_frames {
                    break;
                }
            }
        }
    }

    frames
}

fn is_application_frame(line: &str) -> bool {
    let app_patterns = ["PSI", "BM", "PL", "WOn", "EX", "MediaGeniX"];
    let framework_patterns = [
        "VisualWorks",
        "Smalltalk",
        "Kernel",
        "Collections",
        "UIBuilder",
        "ValueModel",
        "ApplicationModel",
    ];

    let is_app = app_patterns.iter().any(|p| line.contains(p));
    let is_framework = framework_patterns.iter().any(|p| line.contains(p));

    is_app && !is_framework
}

fn normalize_method_name(line: &str) -> Option<String> {
    let cleaned = line.replace("optimized ", "").replace("[] in ", "");

    if let Some(caps) = METHOD_EXTRACTOR.captures(&cleaned) {
        caps.get(1).map(|m| m.as_str().to_string())
    } else {
        cleaned.split_whitespace().last().map(|s| s.to_string())
    }
}

fn infer_module(stack_trace: Option<&str>, root_cause: &str) -> Option<String> {
    let text = format!("{} {}", stack_trace.unwrap_or(""), root_cause);

    if text.contains("PSI") {
        return Some("PSI".to_string());
    }
    if text.contains("BM") && !text.contains("BMI") {
        return Some("BM".to_string());
    }
    if text.contains("PL") {
        return Some("PL".to_string());
    }
    if text.contains("WOn") {
        return Some("WOn".to_string());
    }
    if text.contains("EX") {
        return Some("EX".to_string());
    }

    None
}

fn detect_database_backend(stack_trace: Option<&str>, root_cause: &str) -> Option<String> {
    let text = format!("{} {}", stack_trace.unwrap_or(""), root_cause);

    if POSTGRES_PATTERN.is_match(&text) {
        return Some("PostgreSQL".to_string());
    }
    if ORACLE_PATTERN.is_match(&text) {
        return Some("Oracle".to_string());
    }

    None
}

fn build_canonical_string(components: &SignatureComponents) -> String {
    let mut parts = vec![components.exception_type.clone()];
    parts.extend(components.application_frames.clone());

    if let Some(ref module) = components.affected_module {
        parts.push(format!("[{module}]"));
    }

    if let Some(ref db) = components.database_backend {
        parts.push(format!("[{db}]"));
    }

    parts.join(" | ")
}

fn compute_hash(canonical: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..6])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signature_stability() {
        let config = SignatureConfig::default();

        let sig1 = compute_signature(
            "SubscriptOutOfBounds",
            Some("PSITxBlock>>removeTimeAllocations:\nBMProgram>>doSomething"),
            "Index 5 out of bounds",
            &config,
        );

        let sig2 = compute_signature(
            "SubscriptOutOfBounds",
            Some("PSITxBlock>>removeTimeAllocations:\nBMProgram>>doSomething"),
            "Index 5 out of bounds",
            &config,
        );

        assert_eq!(sig1.hash, sig2.hash);
        assert_eq!(sig1.canonical, sig2.canonical);
    }

    #[test]
    fn test_module_inference() {
        assert_eq!(
            infer_module(Some("PSITxBlock>>test"), ""),
            Some("PSI".to_string())
        );
        assert_eq!(
            infer_module(Some("BMBreak>>test"), ""),
            Some("BM".to_string())
        );
    }

    #[test]
    fn test_normalize_method_name() {
        let result = normalize_method_name(
            "optimized [] in [] in MediaGeniX.PSITxBlock>>removeTimeAllocations:",
        );
        assert_eq!(
            result,
            Some("PSITxBlock>>removeTimeAllocations:".to_string())
        );
    }
}
