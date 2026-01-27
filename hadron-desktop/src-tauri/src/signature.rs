//! Crash Signature System
//!
//! Provides stable fingerprinting to identify semantically identical crashes
//! regardless of timestamp, user, or machine.

use chrono::Utc;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ============================================================================
// Models
// ============================================================================

/// A crash signature uniquely identifies a type of crash
/// Independent of when/where/who experienced it
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashSignature {
    /// Short hash (first 12 chars of SHA256)
    pub hash: String,

    /// Human-readable canonical form
    /// Format: "ExceptionType | Method1 | Method2 | Method3"
    pub canonical: String,

    /// Components used to build the signature
    pub components: SignatureComponents,

    /// Metadata
    pub first_seen: String,
    pub last_seen: String,
    pub occurrence_count: u32,

    /// Linked ticket (if known fix exists)
    pub linked_ticket: Option<String>,
    pub linked_ticket_url: Option<String>,

    /// Status of this crash type
    pub status: String,
    pub status_metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureComponents {
    /// The exception class name
    pub exception_type: String,

    /// Top N application-level method names (normalized)
    pub application_frames: Vec<String>,

    /// Primary affected module (PSI, BM, PL, WOn, EX)
    pub affected_module: Option<String>,

    /// Database backend if relevant (Oracle, PostgreSQL)
    pub database_backend: Option<String>,
}

/// Configuration for signature generation
pub struct SignatureConfig {
    /// Number of application frames to include (default: 5)
    pub max_application_frames: usize,

    /// Include database backend in signature (default: false)
    pub include_database_backend: bool,

    /// Include affected module in signature (default: true)
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

/// Result of registering a signature
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureRegistrationResult {
    pub signature: CrashSignature,
    pub is_new: bool,
    pub occurrence_count: u32,
    pub linked_ticket: Option<String>,
}

/// Summary of a crash file occurrence
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashFileSummary {
    pub id: i64,
    pub filename: String,
    pub analyzed_at: String,
    pub severity: Option<String>,
}

/// Signature with its file occurrences
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureOccurrences {
    pub signature: CrashSignature,
    pub files: Vec<CrashFileSummary>,
}

// ============================================================================
// Regex Patterns
// ============================================================================

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

// ============================================================================
// Signature Computation
// ============================================================================

/// Compute a crash signature from analysis data
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
        status_metadata: None,
    }
}

fn extract_components(
    error_type: &str,
    stack_trace: Option<&str>,
    root_cause: &str,
    config: &SignatureConfig,
) -> SignatureComponents {
    // 1. Normalize exception type
    let exception_type = normalize_exception_type(error_type);

    // 2. Extract application frames from stack trace
    let application_frames = if let Some(trace) = stack_trace {
        extract_application_frames(trace, config.max_application_frames)
    } else {
        Vec::new()
    };

    // 3. Infer affected module
    let affected_module = if config.include_module {
        infer_module(stack_trace, root_cause)
    } else {
        None
    };

    // 4. Detect database backend
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
        // Skip framework/library frames
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
    // WHATS'ON/MediaGeniX application namespaces
    let app_patterns = ["PSI", "BM", "PL", "WOn", "EX", "MediaGeniX"];

    // Exclude framework patterns
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
    // Remove "optimized [] in [] in " prefix
    let cleaned = line.replace("optimized ", "").replace("[] in ", "");

    // Extract class>>method pattern
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
        parts.push(format!("[{}]", module));
    }

    if let Some(ref db) = components.database_backend {
        parts.push(format!("[{}]", db));
    }

    parts.join(" | ")
}

fn compute_hash(canonical: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let result = hasher.finalize();
    // Take first 12 characters (6 bytes) for readability
    hex::encode(&result[..6])
}

// ============================================================================
// Database Operations
// ============================================================================

/// Find a signature by hash
pub fn find_signature_by_hash(
    conn: &Connection,
    hash: &str,
) -> rusqlite::Result<Option<CrashSignature>> {
    conn.query_row(
        "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                occurrence_count, linked_ticket_id, linked_ticket_url, status, status_metadata_json
         FROM crash_signatures WHERE hash = ?1",
        params![hash],
        |row| {
            let components_json: String = row.get(2)?;
            let components: SignatureComponents = serde_json::from_str(&components_json)
                .unwrap_or_else(|_| SignatureComponents {
                    exception_type: "Unknown".to_string(),
                    application_frames: Vec::new(),
                    affected_module: None,
                    database_backend: None,
                });

            Ok(CrashSignature {
                hash: row.get(0)?,
                canonical: row.get(1)?,
                components,
                first_seen: row.get(3)?,
                last_seen: row.get(4)?,
                occurrence_count: row.get(5)?,
                linked_ticket: row.get(6)?,
                linked_ticket_url: row.get(7)?,
                status: row.get(8)?,
                status_metadata: row.get(9)?,
            })
        },
    )
    .optional()
}

/// Upsert a signature - insert new or update occurrence count
pub fn upsert_signature(conn: &Connection, signature: &CrashSignature) -> rusqlite::Result<bool> {
    // Check if exists
    if let Some(_existing) = find_signature_by_hash(conn, &signature.hash)? {
        // Update occurrence count and last_seen
        conn.execute(
            "UPDATE crash_signatures
             SET occurrence_count = occurrence_count + 1,
                 last_seen_at = ?1,
                 updated_at = datetime('now')
             WHERE hash = ?2",
            params![signature.last_seen, signature.hash],
        )?;
        Ok(false) // Not new
    } else {
        // Insert new
        let components_json =
            serde_json::to_string(&signature.components).unwrap_or_else(|_| "{}".to_string());

        conn.execute(
            "INSERT INTO crash_signatures
             (hash, canonical, components_json, first_seen_at, last_seen_at,
              occurrence_count, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                signature.hash,
                signature.canonical,
                components_json,
                signature.first_seen,
                signature.last_seen,
                signature.occurrence_count,
                signature.status
            ],
        )?;
        Ok(true) // Is new
    }
}

/// Link an analysis to a signature
pub fn link_analysis_to_signature(
    conn: &Connection,
    analysis_id: i64,
    signature_hash: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO analysis_signatures (analysis_id, signature_hash)
         VALUES (?1, ?2)",
        params![analysis_id, signature_hash],
    )?;
    Ok(())
}

/// Get all analyses linked to a signature
pub fn get_analyses_for_signature(
    conn: &Connection,
    hash: &str,
) -> rusqlite::Result<Vec<CrashFileSummary>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.filename, a.analyzed_at, a.severity
         FROM analyses a
         JOIN analysis_signatures ags ON a.id = ags.analysis_id
         WHERE ags.signature_hash = ?1
         ORDER BY a.analyzed_at DESC",
    )?;

    let results = stmt
        .query_map(params![hash], |row| {
            Ok(CrashFileSummary {
                id: row.get(0)?,
                filename: row.get(1)?,
                analyzed_at: row.get(2)?,
                severity: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

/// Get top signatures by occurrence count
pub fn get_top_signatures(
    conn: &Connection,
    limit: usize,
    status_filter: Option<&str>,
) -> rusqlite::Result<Vec<CrashSignature>> {
    let sql = if status_filter.is_some() {
        "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                occurrence_count, linked_ticket_id, linked_ticket_url, status, status_metadata_json
         FROM crash_signatures
         WHERE status = ?1
         ORDER BY occurrence_count DESC
         LIMIT ?2"
    } else {
        "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                occurrence_count, linked_ticket_id, linked_ticket_url, status, status_metadata_json
         FROM crash_signatures
         ORDER BY occurrence_count DESC
         LIMIT ?1"
    };

    let mut stmt = conn.prepare(sql)?;

    let rows: Vec<CrashSignature> = if let Some(status) = status_filter {
        stmt.query_map(params![status, limit as i64], row_to_signature)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![limit as i64], row_to_signature)?
            .collect::<Result<Vec<_>, _>>()?
    };

    Ok(rows)
}

/// Update signature status
pub fn update_signature_status(
    conn: &Connection,
    hash: &str,
    status: &str,
    metadata: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE crash_signatures
         SET status = ?1, status_metadata_json = ?2, updated_at = datetime('now')
         WHERE hash = ?3",
        params![status, metadata, hash],
    )?;
    Ok(())
}

/// Link a ticket to a signature
pub fn link_ticket_to_signature(
    conn: &Connection,
    hash: &str,
    ticket_id: &str,
    ticket_url: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE crash_signatures
         SET linked_ticket_id = ?1, linked_ticket_url = ?2, updated_at = datetime('now')
         WHERE hash = ?3",
        params![ticket_id, ticket_url, hash],
    )?;
    Ok(())
}

fn row_to_signature(row: &rusqlite::Row) -> rusqlite::Result<CrashSignature> {
    let components_json: String = row.get(2)?;
    let components: SignatureComponents =
        serde_json::from_str(&components_json).unwrap_or_else(|_| SignatureComponents {
            exception_type: "Unknown".to_string(),
            application_frames: Vec::new(),
            affected_module: None,
            database_backend: None,
        });

    Ok(CrashSignature {
        hash: row.get(0)?,
        canonical: row.get(1)?,
        components,
        first_seen: row.get(3)?,
        last_seen: row.get(4)?,
        occurrence_count: row.get(5)?,
        linked_ticket: row.get(6)?,
        linked_ticket_url: row.get(7)?,
        status: row.get(8)?,
        status_metadata: row.get(9)?,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_method_name() {
        let result = normalize_method_name(
            "optimized [] in [] in MediaGeniX.PSITxBlock>>removeTimeAllocations:",
        );
        assert_eq!(
            result,
            Some("PSITxBlock>>removeTimeAllocations:".to_string())
        );

        let result2 = normalize_method_name("OrderedCollection>>at:");
        assert_eq!(result2, Some("OrderedCollection>>at:".to_string()));
    }

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
        assert_eq!(
            infer_module(Some("PLSchedule>>test"), ""),
            Some("PL".to_string())
        );
    }
}
