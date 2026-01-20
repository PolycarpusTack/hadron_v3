# WHATS'ON Crash Analyzer - Addendum Implementation Plan

## Document Purpose

This document is an **AI-friendly development plan** for implementing advanced crash analysis features in a Rust/Tauri desktop application. It is designed to be consumed by AI coding assistants (Claude, GPT-4, Copilot) to generate implementation code.

**Current Stack:**
- Backend: Rust (2021 edition)
- Frontend: React + TypeScript
- Desktop Framework: Tauri 1.x
- Database: SQLite (with planned PostgreSQL migration)
- AI Integration: Claude API / OpenAI API

**Prerequisites:**
- Existing crash file parser that produces structured `CrashFile` data
- Basic analysis UI with tabs (Overview, Stack Trace, Context, etc.)
- SQLite database for storing analyses

---

# PHASE 1: CRASH SIGNATURES & DEDUPLICATION

## EPIC 1.1: Crash Signature System

### Goal
Implement a stable fingerprinting system that identifies semantically identical crashes regardless of timestamp, user, or machine.

---

### TASK 1.1.1: Signature Data Model

#### SUBTASK 1.1.1.1: Define Signature Structs

**File:** `src/models/signature.rs`

```rust
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

/// A crash signature uniquely identifies a type of crash
/// Independent of when/where/who experienced it
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashSignature {
    /// Short hash (first 12 chars of SHA256)
    pub hash: String,
    
    /// Human-readable canonical form
    /// Format: "ExceptionType | Method1 | Method2 | Method3"
    pub canonical: String,
    
    /// Components used to build the signature
    pub components: SignatureComponents,
    
    /// Metadata
    pub first_seen: chrono::DateTime<chrono::Utc>,
    pub last_seen: chrono::DateTime<chrono::Utc>,
    pub occurrence_count: u32,
    
    /// Linked ticket (if known fix exists)
    pub linked_ticket: Option<String>,
    
    /// Status of this crash type
    pub status: SignatureStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureComponents {
    /// The exception class name
    pub exception_type: String,
    
    /// Top N application-level method names (normalized)
    pub application_frames: Vec<String>,
    
    /// Primary affected module (PSI, BM, PL, WOn, EX)
    pub affected_module: Option<String>,
    
    /// Database backend if relevant (Oracle, PostgreSQL)
    pub database_backend: Option<DatabaseBackend>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SignatureStatus {
    /// New, not yet investigated
    New,
    /// Under investigation
    Investigating,
    /// Fix in progress
    FixInProgress,
    /// Fixed in a specific version
    Fixed { version: String },
    /// Won't fix (by design or too complex)
    WontFix,
    /// Duplicate of another signature
    Duplicate { primary_hash: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DatabaseBackend {
    Oracle,
    PostgreSQL,
    Unknown,
}

impl std::fmt::Display for DatabaseBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DatabaseBackend::Oracle => write!(f, "Oracle"),
            DatabaseBackend::PostgreSQL => write!(f, "PostgreSQL"),
            DatabaseBackend::Unknown => write!(f, "Unknown"),
        }
    }
}
```

**AI Implementation Notes:**
- The `hash` field should be URL-safe (alphanumeric only)
- `canonical` is for human display, `hash` is for lookups
- `occurrence_count` increments each time we see this signature

---

#### SUBTASK 1.1.1.2: Signature Computation Algorithm

**File:** `src/analyzer/signature.rs`

```rust
use crate::models::{CrashFile, CrashSignature, SignatureComponents, DatabaseBackend};
use crate::parser::FrameType;
use sha2::{Sha256, Digest};
use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    /// Extract method name from full signature
    /// "MediaGeniX.PSITxBlock>>removeTimeAllocations:" -> "PSITxBlock>>removeTimeAllocations:"
    static ref METHOD_EXTRACTOR: Regex = Regex::new(
        r"(?:MediaGeniX\.)?(\w+(?:>>\w+[:\w]*)?)"
    ).unwrap();
    
    /// Detect Oracle indicators
    static ref ORACLE_PATTERN: Regex = Regex::new(
        r"(?i)(oracle|ora-\d+|exdi.*oracle)"
    ).unwrap();
    
    /// Detect PostgreSQL indicators  
    static ref POSTGRES_PATTERN: Regex = Regex::new(
        r"(?i)(postgres|libpq|prepared statement|pgconn)"
    ).unwrap();
}

/// Configuration for signature generation
pub struct SignatureConfig {
    /// Number of application frames to include (default: 5)
    pub max_application_frames: usize,
    
    /// Include database backend in signature (default: false)
    /// Set to true if same bug behaves differently across DBs
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

/// Compute a crash signature from parsed crash data
pub fn compute_signature(crash: &CrashFile, config: &SignatureConfig) -> CrashSignature {
    let components = extract_components(crash, config);
    let canonical = build_canonical_string(&components);
    let hash = compute_hash(&canonical);
    
    CrashSignature {
        hash,
        canonical,
        components,
        first_seen: chrono::Utc::now(),
        last_seen: chrono::Utc::now(),
        occurrence_count: 1,
        linked_ticket: None,
        status: SignatureStatus::New,
    }
}

fn extract_components(crash: &CrashFile, config: &SignatureConfig) -> SignatureComponents {
    // 1. Exception type (normalized)
    let exception_type = normalize_exception_type(&crash.exception.exception_type);
    
    // 2. Application frames (skip Error and Framework frames)
    let application_frames: Vec<String> = crash.stack_trace
        .iter()
        .filter(|frame| matches!(frame.frame_type, FrameType::Application))
        .take(config.max_application_frames)
        .map(|frame| normalize_method_name(&frame.method_signature))
        .collect();
    
    // 3. Affected module (infer from first application frame)
    let affected_module = if config.include_module {
        infer_module(&crash.stack_trace)
    } else {
        None
    };
    
    // 4. Database backend (if relevant)
    let database_backend = if config.include_database_backend {
        detect_database_backend(crash)
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
    // Remove common prefixes/suffixes, keep core error name
    raw.trim()
        .replace("MediaGeniX.", "")
        .replace("Smalltalk.", "")
        .to_string()
}

fn normalize_method_name(signature: &str) -> String {
    // Extract core method reference
    // "optimized [] in [] in MediaGeniX.PSITxBlock>>removeTimeAllocations:"
    // -> "PSITxBlock>>removeTimeAllocations:"
    
    // Remove "optimized [] in [] in " prefix
    let cleaned = signature
        .replace("optimized ", "")
        .replace("[] in ", "");
    
    // Extract class>>method pattern
    if let Some(caps) = METHOD_EXTRACTOR.captures(&cleaned) {
        caps.get(1).map(|m| m.as_str().to_string()).unwrap_or(cleaned)
    } else {
        cleaned.split_whitespace().last().unwrap_or(&cleaned).to_string()
    }
}

fn infer_module(stack_trace: &[StackFrame]) -> Option<String> {
    for frame in stack_trace {
        if matches!(frame.frame_type, FrameType::Application) {
            let sig = &frame.method_signature;
            if sig.contains("PSI") { return Some("PSI".to_string()); }
            if sig.contains("BM") && !sig.contains("BMI") { return Some("BM".to_string()); }
            if sig.contains("PL") { return Some("PL".to_string()); }
            if sig.contains("WOn") { return Some("WOn".to_string()); }
            if sig.contains("EX") { return Some("EX".to_string()); }
        }
    }
    None
}

fn detect_database_backend(crash: &CrashFile) -> Option<DatabaseBackend> {
    // Check environment
    if let Some(ref server) = crash.environment.oracle_server {
        if !server.is_empty() {
            return Some(DatabaseBackend::Oracle);
        }
    }
    
    // Check exception and stack for hints
    let full_text = format!(
        "{} {} {:?}",
        crash.exception.exception_type,
        crash.exception.message,
        crash.stack_trace.iter().map(|f| &f.method_signature).collect::<Vec<_>>()
    );
    
    if POSTGRES_PATTERN.is_match(&full_text) {
        return Some(DatabaseBackend::PostgreSQL);
    }
    if ORACLE_PATTERN.is_match(&full_text) {
        return Some(DatabaseBackend::Oracle);
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

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_normalize_method_name() {
        assert_eq!(
            normalize_method_name("optimized [] in [] in MediaGeniX.PSITxBlock>>removeTimeAllocations:"),
            "PSITxBlock>>removeTimeAllocations:"
        );
        
        assert_eq!(
            normalize_method_name("OrderedCollection>>at:"),
            "OrderedCollection>>at:"
        );
    }
    
    #[test]
    fn test_signature_stability() {
        // Same crash data should always produce same signature
        let config = SignatureConfig::default();
        let crash1 = create_test_crash();
        let crash2 = create_test_crash();
        
        let sig1 = compute_signature(&crash1, &config);
        let sig2 = compute_signature(&crash2, &config);
        
        assert_eq!(sig1.hash, sig2.hash);
    }
}
```

**AI Implementation Notes:**
- Signature hash must be deterministic - same input = same output
- Method normalization is critical for matching across slight variations
- Module inference uses simple substring matching on namespace prefixes
- Database detection looks at both environment fields and error messages

---

### TASK 1.1.2: Database Schema for Signatures

#### SUBTASK 1.1.2.1: SQLite Schema (Current)

**File:** `src/db/migrations/003_signatures.sql`

```sql
-- Crash Signatures table
-- Stores unique crash types across all analyzed files
CREATE TABLE IF NOT EXISTS crash_signatures (
    -- Primary key: the signature hash
    hash TEXT PRIMARY KEY,
    
    -- Human-readable canonical form
    canonical TEXT NOT NULL,
    
    -- Component data (JSON)
    components_json TEXT NOT NULL,
    
    -- Timestamps
    first_seen_at TEXT NOT NULL,  -- ISO 8601
    last_seen_at TEXT NOT NULL,   -- ISO 8601
    
    -- Occurrence tracking
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    
    -- Ticket linking
    linked_ticket_system TEXT,  -- 'jira', 'servicenow', etc.
    linked_ticket_id TEXT,
    linked_ticket_url TEXT,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'new',  -- new, investigating, fix_in_progress, fixed, wont_fix, duplicate
    status_metadata_json TEXT,  -- e.g., {"version": "2024r4"} for fixed status
    
    -- Notes
    notes TEXT,
    
    -- Audit
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_signatures_status ON crash_signatures(status);

-- Index for ticket lookup
CREATE INDEX IF NOT EXISTS idx_signatures_ticket ON crash_signatures(linked_ticket_system, linked_ticket_id);


-- Junction table: which crash files have which signatures
CREATE TABLE IF NOT EXISTS crash_file_signatures (
    crash_file_id TEXT NOT NULL REFERENCES crash_files(id) ON DELETE CASCADE,
    signature_hash TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
    
    -- When this occurrence was recorded
    matched_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    PRIMARY KEY (crash_file_id, signature_hash)
);

-- Index for finding all files with a signature
CREATE INDEX IF NOT EXISTS idx_file_signatures_hash ON crash_file_signatures(signature_hash);


-- Signature relationships (for duplicate tracking)
CREATE TABLE IF NOT EXISTS signature_relationships (
    from_hash TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
    to_hash TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
    relationship TEXT NOT NULL,  -- 'duplicate_of', 'related_to', 'superseded_by'
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    PRIMARY KEY (from_hash, to_hash, relationship)
);
```

**AI Implementation Notes:**
- SQLite uses TEXT for dates (ISO 8601 format)
- JSON stored as TEXT, parsed in Rust with serde_json
- Foreign key constraints require `PRAGMA foreign_keys = ON;`
- Indexes optimize common query patterns

---

#### SUBTASK 1.1.2.2: PostgreSQL Schema (Future Migration)

**File:** `migrations/postgres/003_signatures.sql`

```sql
-- PostgreSQL version with proper types
CREATE TABLE IF NOT EXISTS crash_signatures (
    hash VARCHAR(12) PRIMARY KEY,
    canonical TEXT NOT NULL,
    components JSONB NOT NULL,
    
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    
    linked_ticket_system VARCHAR(50),
    linked_ticket_id VARCHAR(100),
    linked_ticket_url TEXT,
    
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    status_metadata JSONB,
    
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Use GIN index for JSONB queries
CREATE INDEX idx_signatures_components ON crash_signatures USING GIN (components);

-- Partial index for active signatures only
CREATE INDEX idx_signatures_active ON crash_signatures(status) 
    WHERE status NOT IN ('fixed', 'wont_fix');

CREATE TABLE IF NOT EXISTS crash_file_signatures (
    crash_file_id UUID NOT NULL REFERENCES crash_files(id) ON DELETE CASCADE,
    signature_hash VARCHAR(12) NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
    matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (crash_file_id, signature_hash)
);

CREATE TABLE IF NOT EXISTS signature_relationships (
    from_hash VARCHAR(12) NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
    to_hash VARCHAR(12) NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
    relationship VARCHAR(20) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (from_hash, to_hash, relationship)
);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signatures_updated_at
    BEFORE UPDATE ON crash_signatures
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

**AI Implementation Notes:**
- PostgreSQL uses JSONB for efficient JSON querying
- TIMESTAMPTZ handles timezone-aware timestamps
- GIN index enables fast JSON field queries
- Trigger auto-updates `updated_at` column

---

#### SUBTASK 1.1.2.3: Database Abstraction Layer

**File:** `src/db/signature_repo.rs`

```rust
use crate::models::{CrashSignature, SignatureStatus};
use rusqlite::{Connection, params};
use anyhow::Result;

pub struct SignatureRepository<'a> {
    conn: &'a Connection,
}

impl<'a> SignatureRepository<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
    
    /// Find a signature by hash, returns None if not found
    pub fn find_by_hash(&self, hash: &str) -> Result<Option<CrashSignature>> {
        let mut stmt = self.conn.prepare(
            "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                    occurrence_count, linked_ticket_id, status, status_metadata_json
             FROM crash_signatures WHERE hash = ?"
        )?;
        
        let result = stmt.query_row(params![hash], |row| {
            Ok(Self::row_to_signature(row)?)
        }).optional()?;
        
        Ok(result)
    }
    
    /// Insert a new signature or update occurrence count if exists
    pub fn upsert(&self, signature: &CrashSignature) -> Result<UpsertResult> {
        // Check if exists
        if let Some(existing) = self.find_by_hash(&signature.hash)? {
            // Update occurrence count and last_seen
            self.conn.execute(
                "UPDATE crash_signatures 
                 SET occurrence_count = occurrence_count + 1,
                     last_seen_at = ?,
                     updated_at = datetime('now')
                 WHERE hash = ?",
                params![
                    signature.last_seen.to_rfc3339(),
                    signature.hash
                ]
            )?;
            
            Ok(UpsertResult::Updated { 
                previous_count: existing.occurrence_count,
                new_count: existing.occurrence_count + 1,
            })
        } else {
            // Insert new
            let components_json = serde_json::to_string(&signature.components)?;
            
            self.conn.execute(
                "INSERT INTO crash_signatures 
                 (hash, canonical, components_json, first_seen_at, last_seen_at, 
                  occurrence_count, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                params![
                    signature.hash,
                    signature.canonical,
                    components_json,
                    signature.first_seen.to_rfc3339(),
                    signature.last_seen.to_rfc3339(),
                    signature.occurrence_count,
                    status_to_string(&signature.status)
                ]
            )?;
            
            Ok(UpsertResult::Inserted)
        }
    }
    
    /// Link a crash file to a signature
    pub fn link_crash_file(&self, crash_file_id: &str, signature_hash: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO crash_file_signatures (crash_file_id, signature_hash)
             VALUES (?, ?)",
            params![crash_file_id, signature_hash]
        )?;
        Ok(())
    }
    
    /// Get all crash files with a given signature
    pub fn get_files_for_signature(&self, hash: &str) -> Result<Vec<CrashFileSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT cf.id, cf.file_name, cf.crash_timestamp, cf.user_name, cf.site
             FROM crash_files cf
             JOIN crash_file_signatures cfs ON cf.id = cfs.crash_file_id
             WHERE cfs.signature_hash = ?
             ORDER BY cf.crash_timestamp DESC"
        )?;
        
        let results = stmt.query_map(params![hash], |row| {
            Ok(CrashFileSummary {
                id: row.get(0)?,
                file_name: row.get(1)?,
                timestamp: row.get(2)?,
                user: row.get(3)?,
                site: row.get(4)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(results)
    }
    
    /// Find similar signatures (same exception type)
    pub fn find_similar(&self, signature: &CrashSignature, limit: usize) -> Result<Vec<CrashSignature>> {
        let mut stmt = self.conn.prepare(
            "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                    occurrence_count, linked_ticket_id, status, status_metadata_json
             FROM crash_signatures 
             WHERE hash != ? 
               AND json_extract(components_json, '$.exception_type') = ?
             ORDER BY occurrence_count DESC
             LIMIT ?"
        )?;
        
        let results = stmt.query_map(
            params![
                signature.hash,
                signature.components.exception_type,
                limit as i64
            ],
            |row| Ok(Self::row_to_signature(row)?)
        )?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(results)
    }
    
    /// Get top signatures by occurrence count
    pub fn get_top_signatures(&self, limit: usize, status_filter: Option<&str>) -> Result<Vec<CrashSignature>> {
        let sql = match status_filter {
            Some(_) => 
                "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                        occurrence_count, linked_ticket_id, status, status_metadata_json
                 FROM crash_signatures 
                 WHERE status = ?
                 ORDER BY occurrence_count DESC
                 LIMIT ?",
            None =>
                "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                        occurrence_count, linked_ticket_id, status, status_metadata_json
                 FROM crash_signatures 
                 ORDER BY occurrence_count DESC
                 LIMIT ?"
        };
        
        let mut stmt = self.conn.prepare(sql)?;
        
        let results = match status_filter {
            Some(status) => stmt.query_map(params![status, limit as i64], |row| {
                Ok(Self::row_to_signature(row)?)
            })?,
            None => stmt.query_map(params![limit as i64], |row| {
                Ok(Self::row_to_signature(row)?)
            })?,
        }.collect::<Result<Vec<_>, _>>()?;
        
        Ok(results)
    }
    
    /// Update signature status
    pub fn update_status(&self, hash: &str, status: &SignatureStatus) -> Result<()> {
        let status_str = status_to_string(status);
        let metadata = match status {
            SignatureStatus::Fixed { version } => 
                Some(serde_json::json!({"version": version}).to_string()),
            SignatureStatus::Duplicate { primary_hash } =>
                Some(serde_json::json!({"primary_hash": primary_hash}).to_string()),
            _ => None
        };
        
        self.conn.execute(
            "UPDATE crash_signatures 
             SET status = ?, status_metadata_json = ?, updated_at = datetime('now')
             WHERE hash = ?",
            params![status_str, metadata, hash]
        )?;
        
        Ok(())
    }
    
    /// Link a Jira ticket to a signature
    pub fn link_ticket(&self, hash: &str, system: &str, ticket_id: &str, url: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE crash_signatures 
             SET linked_ticket_system = ?, linked_ticket_id = ?, linked_ticket_url = ?,
                 updated_at = datetime('now')
             WHERE hash = ?",
            params![system, ticket_id, url, hash]
        )?;
        
        Ok(())
    }
    
    // Helper to convert row to struct
    fn row_to_signature(row: &rusqlite::Row) -> rusqlite::Result<CrashSignature> {
        let components_json: String = row.get(2)?;
        let components = serde_json::from_str(&components_json)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(
                2, rusqlite::types::Type::Text, Box::new(e)
            ))?;
        
        let status_str: String = row.get(7)?;
        let status_metadata: Option<String> = row.get(8)?;
        let status = string_to_status(&status_str, status_metadata.as_deref());
        
        Ok(CrashSignature {
            hash: row.get(0)?,
            canonical: row.get(1)?,
            components,
            first_seen: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(3)?)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::Utc::now()),
            last_seen: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::Utc::now()),
            occurrence_count: row.get(5)?,
            linked_ticket: row.get(6)?,
            status,
        })
    }
}

#[derive(Debug)]
pub enum UpsertResult {
    Inserted,
    Updated { previous_count: u32, new_count: u32 },
}

#[derive(Debug, Clone, Serialize)]
pub struct CrashFileSummary {
    pub id: String,
    pub file_name: String,
    pub timestamp: Option<String>,
    pub user: Option<String>,
    pub site: Option<String>,
}

fn status_to_string(status: &SignatureStatus) -> String {
    match status {
        SignatureStatus::New => "new".to_string(),
        SignatureStatus::Investigating => "investigating".to_string(),
        SignatureStatus::FixInProgress => "fix_in_progress".to_string(),
        SignatureStatus::Fixed { .. } => "fixed".to_string(),
        SignatureStatus::WontFix => "wont_fix".to_string(),
        SignatureStatus::Duplicate { .. } => "duplicate".to_string(),
    }
}

fn string_to_status(s: &str, metadata: Option<&str>) -> SignatureStatus {
    match s {
        "new" => SignatureStatus::New,
        "investigating" => SignatureStatus::Investigating,
        "fix_in_progress" => SignatureStatus::FixInProgress,
        "fixed" => {
            let version = metadata
                .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                .and_then(|v| v.get("version").and_then(|v| v.as_str()).map(String::from))
                .unwrap_or_default();
            SignatureStatus::Fixed { version }
        },
        "wont_fix" => SignatureStatus::WontFix,
        "duplicate" => {
            let primary_hash = metadata
                .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                .and_then(|v| v.get("primary_hash").and_then(|v| v.as_str()).map(String::from))
                .unwrap_or_default();
            SignatureStatus::Duplicate { primary_hash }
        },
        _ => SignatureStatus::New,
    }
}
```

**AI Implementation Notes:**
- Uses rusqlite for SQLite interactions
- JSON stored as TEXT, deserialized with serde_json
- Upsert pattern: check exists, then update or insert
- Error handling with anyhow for easy propagation

---

### TASK 1.1.3: Tauri Commands for Signatures

#### SUBTASK 1.1.3.1: Command Implementations

**File:** `src/commands/signature_commands.rs`

```rust
use crate::analyzer::signature::{compute_signature, SignatureConfig};
use crate::db::SignatureRepository;
use crate::models::{CrashFile, CrashSignature, SignatureStatus};
use tauri::State;

/// Compute signature for a crash file (does not persist)
#[tauri::command]
pub fn compute_crash_signature(crash: CrashFile) -> Result<CrashSignature, String> {
    let config = SignatureConfig::default();
    Ok(compute_signature(&crash, &config))
}

/// Compute and persist signature, linking to crash file
#[tauri::command]
pub async fn register_crash_signature(
    crash_file_id: String,
    crash: CrashFile,
    db: State<'_, Database>,
) -> Result<SignatureRegistrationResult, String> {
    let config = SignatureConfig::default();
    let signature = compute_signature(&crash, &config);
    
    let conn = db.get_connection().map_err(|e| e.to_string())?;
    let repo = SignatureRepository::new(&conn);
    
    // Upsert signature
    let upsert_result = repo.upsert(&signature).map_err(|e| e.to_string())?;
    
    // Link crash file to signature
    repo.link_crash_file(&crash_file_id, &signature.hash).map_err(|e| e.to_string())?;
    
    // Check if this is a known issue
    let linked_ticket = repo.find_by_hash(&signature.hash)
        .map_err(|e| e.to_string())?
        .and_then(|s| s.linked_ticket);
    
    Ok(SignatureRegistrationResult {
        signature,
        is_new: matches!(upsert_result, UpsertResult::Inserted),
        occurrence_count: match upsert_result {
            UpsertResult::Inserted => 1,
            UpsertResult::Updated { new_count, .. } => new_count,
        },
        linked_ticket,
    })
}

/// Get all files that share a signature
#[tauri::command]
pub async fn get_signature_occurrences(
    hash: String,
    db: State<'_, Database>,
) -> Result<SignatureOccurrences, String> {
    let conn = db.get_connection().map_err(|e| e.to_string())?;
    let repo = SignatureRepository::new(&conn);
    
    let signature = repo.find_by_hash(&hash)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Signature not found".to_string())?;
    
    let files = repo.get_files_for_signature(&hash).map_err(|e| e.to_string())?;
    
    Ok(SignatureOccurrences {
        signature,
        files,
    })
}

/// Find signatures similar to a given one
#[tauri::command]
pub async fn find_similar_signatures(
    hash: String,
    limit: Option<usize>,
    db: State<'_, Database>,
) -> Result<Vec<CrashSignature>, String> {
    let conn = db.get_connection().map_err(|e| e.to_string())?;
    let repo = SignatureRepository::new(&conn);
    
    let signature = repo.find_by_hash(&hash)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Signature not found".to_string())?;
    
    repo.find_similar(&signature, limit.unwrap_or(10))
        .map_err(|e| e.to_string())
}

/// Get top signatures by occurrence
#[tauri::command]
pub async fn get_top_signatures(
    limit: Option<usize>,
    status: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<CrashSignature>, String> {
    let conn = db.get_connection().map_err(|e| e.to_string())?;
    let repo = SignatureRepository::new(&conn);
    
    repo.get_top_signatures(limit.unwrap_or(20), status.as_deref())
        .map_err(|e| e.to_string())
}

/// Update signature status
#[tauri::command]
pub async fn update_signature_status(
    hash: String,
    status: String,
    version: Option<String>,
    primary_hash: Option<String>,
    db: State<'_, Database>,
) -> Result<(), String> {
    let status = match status.as_str() {
        "new" => SignatureStatus::New,
        "investigating" => SignatureStatus::Investigating,
        "fix_in_progress" => SignatureStatus::FixInProgress,
        "fixed" => SignatureStatus::Fixed { 
            version: version.unwrap_or_default() 
        },
        "wont_fix" => SignatureStatus::WontFix,
        "duplicate" => SignatureStatus::Duplicate { 
            primary_hash: primary_hash.unwrap_or_default() 
        },
        _ => return Err("Invalid status".to_string()),
    };
    
    let conn = db.get_connection().map_err(|e| e.to_string())?;
    let repo = SignatureRepository::new(&conn);
    
    repo.update_status(&hash, &status).map_err(|e| e.to_string())
}

/// Link a Jira ticket to a signature
#[tauri::command]
pub async fn link_ticket_to_signature(
    hash: String,
    ticket_system: String,
    ticket_id: String,
    ticket_url: Option<String>,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.get_connection().map_err(|e| e.to_string())?;
    let repo = SignatureRepository::new(&conn);
    
    repo.link_ticket(&hash, &ticket_system, &ticket_id, ticket_url.as_deref())
        .map_err(|e| e.to_string())
}

// Response types
#[derive(Debug, Clone, Serialize)]
pub struct SignatureRegistrationResult {
    pub signature: CrashSignature,
    pub is_new: bool,
    pub occurrence_count: u32,
    pub linked_ticket: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SignatureOccurrences {
    pub signature: CrashSignature,
    pub files: Vec<CrashFileSummary>,
}
```

**AI Implementation Notes:**
- Commands are async for database operations
- State injection via Tauri's State wrapper
- All errors converted to String for Tauri IPC
- Response types derive Serialize for JSON transport

---

### TASK 1.1.4: Frontend Signature Components

#### SUBTASK 1.1.4.1: TypeScript Types

**File:** `src/types/signature.ts`

```typescript
export interface CrashSignature {
  hash: string;
  canonical: string;
  components: SignatureComponents;
  firstSeen: string;  // ISO 8601
  lastSeen: string;
  occurrenceCount: number;
  linkedTicket?: string;
  status: SignatureStatus;
}

export interface SignatureComponents {
  exceptionType: string;
  applicationFrames: string[];
  affectedModule?: string;
  databaseBackend?: 'Oracle' | 'PostgreSQL' | 'Unknown';
}

export type SignatureStatus = 
  | { type: 'new' }
  | { type: 'investigating' }
  | { type: 'fixInProgress' }
  | { type: 'fixed'; version: string }
  | { type: 'wontFix' }
  | { type: 'duplicate'; primaryHash: string };

export interface SignatureRegistrationResult {
  signature: CrashSignature;
  isNew: boolean;
  occurrenceCount: number;
  linkedTicket?: string;
}

export interface SignatureOccurrences {
  signature: CrashSignature;
  files: CrashFileSummary[];
}

export interface CrashFileSummary {
  id: string;
  fileName: string;
  timestamp?: string;
  user?: string;
  site?: string;
}
```

---

#### SUBTASK 1.1.4.2: Signature Display Component

**File:** `src/components/SignatureBadge.tsx`

```tsx
import React from 'react';
import { CrashSignature, SignatureStatus } from '../types/signature';

interface SignatureBadgeProps {
  signature: CrashSignature;
  showOccurrences?: boolean;
  onClick?: () => void;
}

export const SignatureBadge: React.FC<SignatureBadgeProps> = ({
  signature,
  showOccurrences = true,
  onClick,
}) => {
  const statusColors: Record<string, string> = {
    new: 'bg-gray-100 text-gray-800 border-gray-300',
    investigating: 'bg-blue-100 text-blue-800 border-blue-300',
    fixInProgress: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    fixed: 'bg-green-100 text-green-800 border-green-300',
    wontFix: 'bg-gray-100 text-gray-500 border-gray-300',
    duplicate: 'bg-purple-100 text-purple-800 border-purple-300',
  };

  const statusType = typeof signature.status === 'object' 
    ? signature.status.type 
    : signature.status;

  return (
    <div 
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer
        hover:shadow-md transition-shadow ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {/* Hash badge */}
      <code className="text-xs font-mono bg-slate-200 px-1.5 py-0.5 rounded">
        {signature.hash}
      </code>
      
      {/* Status indicator */}
      <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[statusType]}`}>
        {formatStatus(signature.status)}
      </span>
      
      {/* Occurrence count */}
      {showOccurrences && signature.occurrenceCount > 1 && (
        <span className="text-xs text-slate-600 flex items-center gap-1">
          <RepeatIcon className="w-3 h-3" />
          {signature.occurrenceCount}x
        </span>
      )}
      
      {/* Linked ticket */}
      {signature.linkedTicket && (
        <span className="text-xs text-blue-600 flex items-center gap-1">
          <TicketIcon className="w-3 h-3" />
          {signature.linkedTicket}
        </span>
      )}
    </div>
  );
};

function formatStatus(status: SignatureStatus): string {
  if (typeof status === 'string') return status;
  switch (status.type) {
    case 'new': return 'New';
    case 'investigating': return 'Investigating';
    case 'fixInProgress': return 'Fix in Progress';
    case 'fixed': return `Fixed (${status.version})`;
    case 'wontFix': return "Won't Fix";
    case 'duplicate': return 'Duplicate';
    default: return 'Unknown';
  }
}

// Simple icon components
const RepeatIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

const TicketIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
    <path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" />
  </svg>
);
```

---

#### SUBTASK 1.1.4.3: Signature List View

**File:** `src/components/SignatureListView.tsx`

```tsx
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { CrashSignature, SignatureOccurrences } from '../types/signature';
import { SignatureBadge } from './SignatureBadge';

interface SignatureListViewProps {
  onSelectSignature?: (hash: string) => void;
}

export const SignatureListView: React.FC<SignatureListViewProps> = ({
  onSelectSignature,
}) => {
  const [signatures, setSignatures] = useState<CrashSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [selectedSignature, setSelectedSignature] = useState<SignatureOccurrences | null>(null);

  useEffect(() => {
    loadSignatures();
  }, [filter]);

  const loadSignatures = async () => {
    setLoading(true);
    try {
      const status = filter === 'all' ? undefined : filter;
      const result = await invoke<CrashSignature[]>('get_top_signatures', {
        limit: 50,
        status,
      });
      setSignatures(result);
    } catch (error) {
      console.error('Failed to load signatures:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSignature = async (hash: string) => {
    try {
      const occurrences = await invoke<SignatureOccurrences>('get_signature_occurrences', {
        hash,
      });
      setSelectedSignature(occurrences);
      onSelectSignature?.(hash);
    } catch (error) {
      console.error('Failed to load signature occurrences:', error);
    }
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Signature List */}
      <div className="w-1/2 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Crash Signatures</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-1.5 border rounded-lg text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="investigating">Investigating</option>
            <option value="fix_in_progress">Fix in Progress</option>
            <option value="fixed">Fixed</option>
          </select>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {signatures.map((sig) => (
              <div
                key={sig.hash}
                className={`p-3 border rounded-lg cursor-pointer transition-colors
                  ${selectedSignature?.signature.hash === sig.hash
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-400'
                  }`}
                onClick={() => handleSelectSignature(sig.hash)}
              >
                <div className="flex items-start justify-between mb-2">
                  <SignatureBadge signature={sig} />
                </div>
                <p className="text-sm text-slate-600 font-mono truncate">
                  {sig.canonical}
                </p>
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                  <span>First seen: {formatDate(sig.firstSeen)}</span>
                  <span>Last seen: {formatDate(sig.lastSeen)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Occurrence Details */}
      <div className="w-1/2 border-l pl-4">
        {selectedSignature ? (
          <SignatureDetailPanel
            occurrences={selectedSignature}
            onRefresh={() => handleSelectSignature(selectedSignature.signature.hash)}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400">
            Select a signature to view details
          </div>
        )}
      </div>
    </div>
  );
};

interface SignatureDetailPanelProps {
  occurrences: SignatureOccurrences;
  onRefresh: () => void;
}

const SignatureDetailPanel: React.FC<SignatureDetailPanelProps> = ({
  occurrences,
  onRefresh,
}) => {
  const { signature, files } = occurrences;
  const [updating, setUpdating] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true);
    try {
      await invoke('update_signature_status', {
        hash: signature.hash,
        status: newStatus,
      });
      onRefresh();
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setUpdating(false);
    }
  };

  const handleLinkTicket = async () => {
    const ticketId = window.prompt('Enter Jira ticket ID (e.g., PROJ-123):');
    if (!ticketId) return;

    try {
      await invoke('link_ticket_to_signature', {
        hash: signature.hash,
        ticketSystem: 'jira',
        ticketId,
        ticketUrl: `https://jira.example.com/browse/${ticketId}`,
      });
      onRefresh();
    } catch (error) {
      console.error('Failed to link ticket:', error);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Signature Details</h3>
        <code className="block p-3 bg-slate-100 rounded-lg text-sm font-mono break-all">
          {signature.canonical}
        </code>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-600">Status:</span>
        <select
          value={typeof signature.status === 'object' ? signature.status.type : signature.status}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={updating}
          className="px-2 py-1 border rounded text-sm"
        >
          <option value="new">New</option>
          <option value="investigating">Investigating</option>
          <option value="fix_in_progress">Fix in Progress</option>
          <option value="fixed">Fixed</option>
          <option value="wont_fix">Won't Fix</option>
        </select>

        <button
          onClick={handleLinkTicket}
          className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200"
        >
          {signature.linkedTicket ? `Linked: ${signature.linkedTicket}` : 'Link Ticket'}
        </button>
      </div>

      <div>
        <h4 className="font-medium mb-2">
          Occurrences ({files.length})
        </h4>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="p-2 bg-slate-50 rounded border border-slate-200 text-sm"
            >
              <div className="font-medium">{file.fileName}</div>
              <div className="text-slate-500 text-xs mt-1">
                {file.user && <span>User: {file.user}</span>}
                {file.site && <span className="ml-3">Site: {file.site}</span>}
                {file.timestamp && <span className="ml-3">{formatDate(file.timestamp)}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="font-medium mb-2">Components</h4>
        <dl className="text-sm space-y-1">
          <div className="flex">
            <dt className="text-slate-500 w-32">Exception:</dt>
            <dd className="font-mono">{signature.components.exceptionType}</dd>
          </div>
          {signature.components.affectedModule && (
            <div className="flex">
              <dt className="text-slate-500 w-32">Module:</dt>
              <dd>{signature.components.affectedModule}</dd>
            </div>
          )}
          {signature.components.databaseBackend && (
            <div className="flex">
              <dt className="text-slate-500 w-32">Database:</dt>
              <dd>{signature.components.databaseBackend}</dd>
            </div>
          )}
          <div className="flex">
            <dt className="text-slate-500 w-32">Stack Frames:</dt>
            <dd className="font-mono text-xs">
              {signature.components.applicationFrames.join(' → ')}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
```

**AI Implementation Notes:**
- Uses Tauri's invoke for IPC with Rust backend
- Filter by status persisted in component state
- Detail panel allows status updates and ticket linking
- Occurrence list shows crash file history

---

# PHASE 2: INTENT RECONSTRUCTION & EXECUTION CONTEXT

## EPIC 2.1: Execution Context Analysis

### Goal
Automatically infer what the user or system was trying to do when the crash occurred, based on available signals in the crash data.

---

### TASK 2.1.1: Intent Classification Model

#### SUBTASK 2.1.1.1: Define Intent Types

**File:** `src/models/intent.rs`

```rust
use serde::{Deserialize, Serialize};

/// The reconstructed execution context at crash time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionContext {
    /// How was the operation triggered?
    pub trigger_type: TriggerType,
    
    /// What feature/module area?
    pub feature_area: FeatureArea,
    
    /// Was this a read or write operation?
    pub operation_type: OperationType,
    
    /// User-visible or headless background?
    pub visibility: OperationVisibility,
    
    /// Confidence in this classification (0.0 - 1.0)
    pub confidence: f32,
    
    /// Evidence used for classification
    pub evidence: Vec<IntentEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TriggerType {
    /// User interaction via GUI
    UserInterface,
    
    /// REST/SOAP API call
    ApiCall,
    
    /// Background worker/scheduler
    BackgroundJob,
    
    /// System event (startup, timer, etc.)
    SystemEvent,
    
    /// Data import process
    Import,
    
    /// Data export process
    Export,
    
    /// Unknown trigger
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FeatureArea {
    /// Continuity Planner module
    ContinuityPlanning,
    
    /// Break Editor
    BreakManagement,
    
    /// Schedule management (versions, locking)
    ScheduleManagement,
    
    /// Program/content browser
    ContentManagement,
    
    /// Playlist generation/export
    PlaylistExport,
    
    /// EPG export
    EpgExport,
    
    /// Data import (schedule, contracts, etc.)
    DataImport,
    
    /// Reporting
    Reporting,
    
    /// System administration
    Administration,
    
    /// Media/asset management
    MediaManagement,
    
    /// Commercial/sales operations
    CommercialOperations,
    
    /// API/Integration layer
    Integration,
    
    /// Core framework (not feature-specific)
    Framework,
    
    /// Unknown area
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OperationType {
    /// Reading/querying data
    Read,
    
    /// Creating new data
    Create,
    
    /// Modifying existing data
    Update,
    
    /// Deleting data
    Delete,
    
    /// Complex transaction (multiple ops)
    Transaction,
    
    /// Unknown
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OperationVisibility {
    /// User can see what's happening
    UserVisible,
    
    /// Running without user visibility
    Headless,
    
    /// Mixed (started visible, doing background work)
    Mixed,
    
    /// Unknown
    Unknown,
}

/// Evidence supporting intent classification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentEvidence {
    /// What type of evidence
    pub evidence_type: String,  // "window_model", "process_name", "command_class", etc.
    
    /// The raw value
    pub value: String,
    
    /// How it influenced classification
    pub interpretation: String,
}
```

---

#### SUBTASK 2.1.1.2: Intent Classifier Implementation

**File:** `src/analyzer/intent.rs`

```rust
use crate::models::{
    CrashFile, ExecutionContext, TriggerType, FeatureArea, 
    OperationType, OperationVisibility, IntentEvidence,
};
use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    // Window model patterns
    static ref CONTINUITY_PATTERN: Regex = Regex::new(r"(?i)(continuity|planner)").unwrap();
    static ref BREAK_PATTERN: Regex = Regex::new(r"(?i)(break|editor|commercial)").unwrap();
    static ref SCHEDULE_PATTERN: Regex = Regex::new(r"(?i)(schedule|version)").unwrap();
    static ref PLAYLIST_PATTERN: Regex = Regex::new(r"(?i)(playlist|export|automation)").unwrap();
    static ref EPG_PATTERN: Regex = Regex::new(r"(?i)(epg|programme.?guide)").unwrap();
    static ref IMPORT_PATTERN: Regex = Regex::new(r"(?i)(import|ingest)").unwrap();
    static ref REPORT_PATTERN: Regex = Regex::new(r"(?i)(report|analysis)").unwrap();
    static ref MEDIA_PATTERN: Regex = Regex::new(r"(?i)(media|asset|material)").unwrap();
    static ref ADMIN_PATTERN: Regex = Regex::new(r"(?i)(admin|config|setting)").unwrap();
    
    // Process/trigger patterns
    static ref REST_PATTERN: Regex = Regex::new(r"(?i)(rest|http|api|handler)").unwrap();
    static ref WORKER_PATTERN: Regex = Regex::new(r"(?i)(worker|job|scheduler|background)").unwrap();
    static ref COMMAND_PATTERN: Regex = Regex::new(r"(?i)(command|action|request)").unwrap();
    
    // Operation type patterns
    static ref WRITE_PATTERN: Regex = Regex::new(r"(?i)(save|update|insert|delete|remove|create|add)").unwrap();
    static ref READ_PATTERN: Regex = Regex::new(r"(?i)(get|fetch|load|find|search|query|select)").unwrap();
}

/// Classify the execution context from crash data
pub fn classify_execution_context(crash: &CrashFile) -> ExecutionContext {
    let mut evidence = Vec::new();
    let mut confidence_factors = Vec::new();
    
    // 1. Determine trigger type
    let (trigger_type, trigger_evidence, trigger_confidence) = classify_trigger(crash);
    evidence.extend(trigger_evidence);
    confidence_factors.push(trigger_confidence);
    
    // 2. Determine feature area
    let (feature_area, feature_evidence, feature_confidence) = classify_feature_area(crash);
    evidence.extend(feature_evidence);
    confidence_factors.push(feature_confidence);
    
    // 3. Determine operation type
    let (operation_type, op_evidence, op_confidence) = classify_operation_type(crash);
    evidence.extend(op_evidence);
    confidence_factors.push(op_confidence);
    
    // 4. Determine visibility
    let (visibility, vis_evidence, vis_confidence) = classify_visibility(crash);
    evidence.extend(vis_evidence);
    confidence_factors.push(vis_confidence);
    
    // Calculate overall confidence
    let confidence = confidence_factors.iter().sum::<f32>() / confidence_factors.len() as f32;
    
    ExecutionContext {
        trigger_type,
        feature_area,
        operation_type,
        visibility,
        confidence,
        evidence,
    }
}

fn classify_trigger(crash: &CrashFile) -> (TriggerType, Vec<IntentEvidence>, f32) {
    let mut evidence = Vec::new();
    
    // Check process name
    if let Some(ref process) = crash.active_process {
        let name = &process.name;
        
        if REST_PATTERN.is_match(name) {
            evidence.push(IntentEvidence {
                evidence_type: "process_name".to_string(),
                value: name.clone(),
                interpretation: "REST/API handler process".to_string(),
            });
            return (TriggerType::ApiCall, evidence, 0.9);
        }
        
        if WORKER_PATTERN.is_match(name) {
            evidence.push(IntentEvidence {
                evidence_type: "process_name".to_string(),
                value: name.clone(),
                interpretation: "Background worker process".to_string(),
            });
            return (TriggerType::BackgroundJob, evidence, 0.9);
        }
        
        if name.contains("Launcher") || name.contains("UI") {
            evidence.push(IntentEvidence {
                evidence_type: "process_name".to_string(),
                value: name.clone(),
                interpretation: "User interface process".to_string(),
            });
            return (TriggerType::UserInterface, evidence, 0.8);
        }
    }
    
    // Check stack trace for REST handlers
    for frame in &crash.stack_trace {
        if REST_PATTERN.is_match(&frame.method_signature) {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: frame.method_signature.clone(),
                interpretation: "REST handler in stack".to_string(),
            });
            return (TriggerType::ApiCall, evidence, 0.8);
        }
        
        if frame.method_signature.contains("MAFCommand") {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: frame.method_signature.clone(),
                interpretation: "MAF Command pattern indicates user action".to_string(),
            });
            return (TriggerType::UserInterface, evidence, 0.85);
        }
    }
    
    // Check for open windows (implies UI)
    if !crash.windows.is_empty() {
        evidence.push(IntentEvidence {
            evidence_type: "open_windows".to_string(),
            value: format!("{} windows open", crash.windows.len()),
            interpretation: "Open windows suggest UI interaction".to_string(),
        });
        return (TriggerType::UserInterface, evidence, 0.7);
    }
    
    // Check for import/export patterns in stack
    for frame in &crash.stack_trace {
        if IMPORT_PATTERN.is_match(&frame.method_signature) {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: frame.method_signature.clone(),
                interpretation: "Import operation in stack".to_string(),
            });
            return (TriggerType::Import, evidence, 0.8);
        }
        
        if frame.method_signature.contains("Export") || 
           frame.method_signature.contains("Playlist") {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: frame.method_signature.clone(),
                interpretation: "Export operation in stack".to_string(),
            });
            return (TriggerType::Export, evidence, 0.8);
        }
    }
    
    (TriggerType::Unknown, evidence, 0.3)
}

fn classify_feature_area(crash: &CrashFile) -> (FeatureArea, Vec<IntentEvidence>, f32) {
    let mut evidence = Vec::new();
    
    // Check open windows
    for window in &crash.windows {
        let model = &window.model;
        let title = &window.title;
        
        if CONTINUITY_PATTERN.is_match(model) || CONTINUITY_PATTERN.is_match(title) {
            evidence.push(IntentEvidence {
                evidence_type: "window_model".to_string(),
                value: model.clone(),
                interpretation: "Continuity Planner window".to_string(),
            });
            return (FeatureArea::ContinuityPlanning, evidence, 0.95);
        }
        
        if BREAK_PATTERN.is_match(model) || BREAK_PATTERN.is_match(title) {
            evidence.push(IntentEvidence {
                evidence_type: "window_model".to_string(),
                value: model.clone(),
                interpretation: "Break Editor window".to_string(),
            });
            return (FeatureArea::BreakManagement, evidence, 0.95);
        }
        
        if PLAYLIST_PATTERN.is_match(model) || PLAYLIST_PATTERN.is_match(title) {
            evidence.push(IntentEvidence {
                evidence_type: "window_model".to_string(),
                value: model.clone(),
                interpretation: "Playlist/Export window".to_string(),
            });
            return (FeatureArea::PlaylistExport, evidence, 0.95);
        }
        
        if EPG_PATTERN.is_match(model) || EPG_PATTERN.is_match(title) {
            evidence.push(IntentEvidence {
                evidence_type: "window_model".to_string(),
                value: model.clone(),
                interpretation: "EPG window".to_string(),
            });
            return (FeatureArea::EpgExport, evidence, 0.95);
        }
        
        if REPORT_PATTERN.is_match(model) || REPORT_PATTERN.is_match(title) {
            evidence.push(IntentEvidence {
                evidence_type: "window_model".to_string(),
                value: model.clone(),
                interpretation: "Report window".to_string(),
            });
            return (FeatureArea::Reporting, evidence, 0.95);
        }
    }
    
    // Check stack trace for module indicators
    for frame in &crash.stack_trace {
        let sig = &frame.method_signature;
        
        // PSI layer - scheduling
        if sig.contains("PSITxBlock") || sig.contains("PSISchedule") {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: sig.clone(),
                interpretation: "PSI scheduling layer".to_string(),
            });
            
            // More specific detection
            if sig.contains("Continuity") || sig.contains("MakeContinuous") {
                return (FeatureArea::ContinuityPlanning, evidence, 0.9);
            }
            return (FeatureArea::ScheduleManagement, evidence, 0.7);
        }
        
        // BM layer - business model
        if sig.contains("BMBreak") || sig.contains("BMSpot") {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: sig.clone(),
                interpretation: "BM commercial layer".to_string(),
            });
            return (FeatureArea::BreakManagement, evidence, 0.85);
        }
        
        if sig.contains("BMProgram") || sig.contains("BMEpisode") {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: sig.clone(),
                interpretation: "BM content layer".to_string(),
            });
            return (FeatureArea::ContentManagement, evidence, 0.85);
        }
        
        // PL layer - planning
        if sig.contains("PL") && (sig.contains("Plan") || sig.contains("Acquisition")) {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: sig.clone(),
                interpretation: "PL planning layer".to_string(),
            });
            return (FeatureArea::ContinuityPlanning, evidence, 0.8);
        }
        
        // EX layer - export
        if sig.contains("EX") || sig.contains("Playlist") || sig.contains("Export") {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: sig.clone(),
                interpretation: "EX export layer".to_string(),
            });
            return (FeatureArea::PlaylistExport, evidence, 0.8);
        }
    }
    
    (FeatureArea::Unknown, evidence, 0.3)
}

fn classify_operation_type(crash: &CrashFile) -> (OperationType, Vec<IntentEvidence>, f32) {
    let mut evidence = Vec::new();
    
    // Check database state
    if crash.database.has_active_transaction {
        evidence.push(IntentEvidence {
            evidence_type: "database_state".to_string(),
            value: "Active transaction".to_string(),
            interpretation: "Write operation in progress".to_string(),
        });
        
        // Check SQL for more specific operation
        for session in &crash.database.sessions {
            let query = &session.query;
            if query.starts_with("UPDATE") {
                return (OperationType::Update, evidence, 0.95);
            }
            if query.starts_with("INSERT") {
                return (OperationType::Create, evidence, 0.95);
            }
            if query.starts_with("DELETE") {
                return (OperationType::Delete, evidence, 0.95);
            }
        }
        
        return (OperationType::Transaction, evidence, 0.8);
    }
    
    // Check stack trace for operation hints
    for frame in &crash.stack_trace {
        let sig = &frame.method_signature.to_lowercase();
        
        if WRITE_PATTERN.is_match(sig) {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: frame.method_signature.clone(),
                interpretation: "Write operation method".to_string(),
            });
            return (OperationType::Update, evidence, 0.7);
        }
        
        if READ_PATTERN.is_match(sig) {
            evidence.push(IntentEvidence {
                evidence_type: "stack_frame".to_string(),
                value: frame.method_signature.clone(),
                interpretation: "Read operation method".to_string(),
            });
            return (OperationType::Read, evidence, 0.7);
        }
    }
    
    (OperationType::Unknown, evidence, 0.3)
}

fn classify_visibility(crash: &CrashFile) -> (OperationVisibility, Vec<IntentEvidence>, f32) {
    let mut evidence = Vec::new();
    
    // Check for open windows
    let has_windows = !crash.windows.is_empty();
    let has_launcher = crash.windows.iter().any(|w| w.model.contains("Launcher"));
    
    if has_windows {
        evidence.push(IntentEvidence {
            evidence_type: "open_windows".to_string(),
            value: format!("{} windows", crash.windows.len()),
            interpretation: "User has visible windows".to_string(),
        });
        
        if has_launcher {
            return (OperationVisibility::UserVisible, evidence, 0.9);
        }
        
        // Check if any non-launcher windows
        let has_feature_windows = crash.windows.iter()
            .any(|w| !w.model.contains("Launcher"));
        
        if has_feature_windows {
            return (OperationVisibility::UserVisible, evidence, 0.85);
        }
        
        return (OperationVisibility::Mixed, evidence, 0.6);
    }
    
    // No windows = headless
    evidence.push(IntentEvidence {
        evidence_type: "open_windows".to_string(),
        value: "No windows".to_string(),
        interpretation: "No visible UI".to_string(),
    });
    
    (OperationVisibility::Headless, evidence, 0.8)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_continuity_planner_detection() {
        let mut crash = create_test_crash();
        crash.windows.push(OpenWindow {
            id: 1,
            title: "Sat 17/01/2026 : MTV North [Continuity plan]".to_string(),
            model: "PLContinuityPlannerMTV".to_string(),
        });
        
        let context = classify_execution_context(&crash);
        assert_eq!(context.feature_area, FeatureArea::ContinuityPlanning);
        assert!(context.confidence > 0.8);
    }
}
```

**AI Implementation Notes:**
- Classifier uses regex patterns and keyword matching
- Multiple evidence sources improve confidence
- Returns confidence scores to indicate certainty
- Evidence list enables explainability in UI

---

### TASK 2.1.2: Integration with Analysis Pipeline

#### SUBTASK 2.1.2.1: Update Analysis Result Model

**File:** `src/models/analysis.rs` (additions)

```rust
use crate::models::{CrashSignature, ExecutionContext};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    // ... existing fields ...
    
    /// Computed crash signature
    pub signature: CrashSignature,
    
    /// Reconstructed execution context
    pub execution_context: ExecutionContext,
    
    // ... rest of fields ...
}
```

---

#### SUBTASK 2.1.2.2: Update Analyzer to Include Context

**File:** `src/analyzer/mod.rs` (update)

```rust
use crate::analyzer::signature::{compute_signature, SignatureConfig};
use crate::analyzer::intent::classify_execution_context;

impl CrashAnalyzer {
    pub async fn analyze(&self, crash: &CrashFile) -> Result<AnalysisResult> {
        // 1. Compute signature
        let signature = compute_signature(crash, &SignatureConfig::default());
        
        // 2. Classify execution context
        let execution_context = classify_execution_context(crash);
        
        // 3. Run AI analysis (include context in prompt)
        let ai_analysis = self.run_ai_analysis(crash, &signature, &execution_context).await?;
        
        // 4. Combine results
        Ok(AnalysisResult {
            signature,
            execution_context,
            // ... map ai_analysis fields ...
        })
    }
}
```

---

# PHASE 3: DATA INTEGRITY ANALYSIS

## EPIC 3.1: Invariant Detection

### Goal
Automatically detect when crash data reveals broken domain invariants (data consistency violations) vs pure code bugs.

---

### TASK 3.1.1: Invariant Rules Engine

#### SUBTASK 3.1.1.1: Define Invariant Types

**File:** `src/analyzer/invariants.rs`

```rust
use serde::{Deserialize, Serialize};
use crate::models::CrashFile;

/// A detected invariant violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvariantViolation {
    /// Type of invariant violated
    pub invariant_type: InvariantType,
    
    /// Human-readable description
    pub description: String,
    
    /// Severity of the violation
    pub severity: ViolationSeverity,
    
    /// Evidence supporting the detection
    pub evidence: InvariantEvidence,
    
    /// Is this the root cause of the crash?
    pub is_crash_cause: bool,
    
    /// Recommendations for fixing the data
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum InvariantType {
    /// Collection sizes don't match when they should
    CollectionSizeMismatch {
        collection_a: String,
        count_a: usize,
        collection_b: String,
        count_b: usize,
    },
    
    /// Null/nil value where not allowed
    UnexpectedNull {
        field: String,
        context: String,
    },
    
    /// Foreign key reference to non-existent object
    BrokenReference {
        source_class: String,
        target_class: String,
        reference_id: String,
    },
    
    /// Duplicate where uniqueness expected
    DuplicateViolation {
        entity: String,
        key: String,
    },
    
    /// Value outside allowed range
    RangeViolation {
        field: String,
        value: String,
        allowed_range: String,
    },
    
    /// State transition that shouldn't be possible
    InvalidStateTransition {
        entity: String,
        from_state: String,
        to_state: String,
    },
    
    /// Circular reference detected
    CircularReference {
        entities: Vec<String>,
    },
    
    /// Temporal inconsistency (end before start, etc.)
    TemporalViolation {
        description: String,
    },
    
    /// Generic/other
    Other {
        name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ViolationSeverity {
    /// Data is corrupt, will crash again
    Critical,
    
    /// Data is inconsistent, may cause issues
    High,
    
    /// Data is suspicious, worth investigating
    Medium,
    
    /// Minor inconsistency, low impact
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvariantEvidence {
    /// Source of the evidence
    pub source: String,
    
    /// Raw values observed
    pub observed_values: Vec<(String, String)>,
    
    /// What values were expected
    pub expected_condition: String,
}

/// Analyze crash data for invariant violations
pub fn detect_invariant_violations(crash: &CrashFile) -> Vec<InvariantViolation> {
    let mut violations = Vec::new();
    
    // Run all detection rules
    violations.extend(detect_collection_mismatches(crash));
    violations.extend(detect_null_violations(crash));
    violations.extend(detect_temporal_violations(crash));
    violations.extend(detect_reference_violations(crash));
    
    // Mark which violation likely caused the crash
    mark_crash_cause(&mut violations, crash);
    
    violations
}

fn detect_collection_mismatches(crash: &CrashFile) -> Vec<InvariantViolation> {
    let mut violations = Vec::new();
    
    // Check context arguments for collection mismatches
    if let Some(ref context) = crash.context {
        // Look for receiver collection vs iteration index
        if let Some(ref receiver) = context.receiver {
            if let Some(size) = receiver.collection_size {
                // Check if exception parameter is an index exceeding size
                if let Some(ref param) = crash.exception.parameter {
                    if let Ok(index) = param.parse::<usize>() {
                        if index > size {
                            violations.push(InvariantViolation {
                                invariant_type: InvariantType::CollectionSizeMismatch {
                                    collection_a: receiver.class_name.clone(),
                                    count_a: size,
                                    collection_b: "requested index".to_string(),
                                    count_b: index,
                                },
                                description: format!(
                                    "Collection {} has {} items but code tried to access index {}",
                                    receiver.class_name, size, index
                                ),
                                severity: ViolationSeverity::Critical,
                                evidence: InvariantEvidence {
                                    source: "context.receiver".to_string(),
                                    observed_values: vec![
                                        ("collection_size".to_string(), size.to_string()),
                                        ("requested_index".to_string(), index.to_string()),
                                    ],
                                    expected_condition: format!("index < {}", size),
                                },
                                is_crash_cause: true,
                                recommendations: vec![
                                    "Check why the source data has fewer items than expected".to_string(),
                                    "Verify data synchronization between related entities".to_string(),
                                    "Add bounds checking in code as defensive measure".to_string(),
                                ],
                            });
                        }
                    }
                }
            }
        }
        
        // Look for related objects with mismatched counts
        let mut counts_by_type: std::collections::HashMap<String, Vec<(String, usize)>> = 
            std::collections::HashMap::new();
        
        for obj in &context.related_objects {
            // Extract count-like properties
            for (key, value) in &obj.properties {
                if key.to_lowercase().contains("count") || 
                   key.to_lowercase().contains("size") ||
                   key.to_lowercase().contains("length") {
                    if let Some(count) = value.as_u64() {
                        counts_by_type
                            .entry(obj.class_name.clone())
                            .or_default()
                            .push((key.clone(), count as usize));
                    }
                }
            }
        }
        
        // Check for segment/duration mismatches (specific to WHATS'ON)
        let segment_count = context.related_objects.iter()
            .find(|o| o.class_name.contains("TimeAllocation"))
            .and_then(|o| o.properties.get("count"))
            .and_then(|v| v.as_u64())
            .map(|v| v as usize);
        
        let duration_count = context.related_objects.iter()
            .find(|o| o.class_name.contains("SegmentDuration"))
            .and_then(|o| o.properties.get("durationCount"))
            .and_then(|v| v.as_u64())
            .map(|v| v as usize);
        
        if let (Some(seg), Some(dur)) = (segment_count, duration_count) {
            if seg != dur {
                violations.push(InvariantViolation {
                    invariant_type: InvariantType::CollectionSizeMismatch {
                        collection_a: "TimeAllocations".to_string(),
                        count_a: seg,
                        collection_b: "SegmentDurations".to_string(),
                        count_b: dur,
                    },
                    description: format!(
                        "TxBlock has {} segments but only {} duration records - data is out of sync",
                        seg, dur
                    ),
                    severity: ViolationSeverity::Critical,
                    evidence: InvariantEvidence {
                        source: "context.related_objects".to_string(),
                        observed_values: vec![
                            ("segment_count".to_string(), seg.to_string()),
                            ("duration_count".to_string(), dur.to_string()),
                        ],
                        expected_condition: "segment_count == duration_count".to_string(),
                    },
                    is_crash_cause: true,
                    recommendations: vec![
                        "Run data integrity check to find all mismatched TxBlocks".to_string(),
                        "Investigate source of data (import, manual edit, migration)".to_string(),
                        "Consider adding database constraint to prevent future mismatches".to_string(),
                    ],
                });
            }
        }
    }
    
    violations
}

fn detect_null_violations(crash: &CrashFile) -> Vec<InvariantViolation> {
    let mut violations = Vec::new();
    
    // Check if crash is MessageNotUnderstood to nil
    if crash.exception.exception_type.contains("MessageNotUnderstood") {
        if let Some(ref context) = crash.context {
            if let Some(ref receiver) = context.receiver {
                if receiver.class_name == "UndefinedObject" || 
                   receiver.class_name.to_lowercase() == "nil" {
                    violations.push(InvariantViolation {
                        invariant_type: InvariantType::UnexpectedNull {
                            field: "receiver".to_string(),
                            context: crash.stack_trace.first()
                                .map(|f| f.method_signature.clone())
                                .unwrap_or_default(),
                        },
                        description: "Message sent to nil object - something that should exist doesn't".to_string(),
                        severity: ViolationSeverity::High,
                        evidence: InvariantEvidence {
                            source: "context.receiver".to_string(),
                            observed_values: vec![
                                ("receiver_class".to_string(), receiver.class_name.clone()),
                            ],
                            expected_condition: "receiver != nil".to_string(),
                        },
                        is_crash_cause: true,
                        recommendations: vec![
                            "Trace back where the nil value came from".to_string(),
                            "Check if this is a timing/race condition".to_string(),
                            "Verify data loading/initialization sequence".to_string(),
                        ],
                    });
                }
            }
        }
    }
    
    violations
}

fn detect_temporal_violations(crash: &CrashFile) -> Vec<InvariantViolation> {
    // Check for timing-related issues in context objects
    // This is domain-specific - in WHATS'ON, check for:
    // - End time before start time
    // - Overlapping time allocations
    // - Gaps in continuous schedules
    
    Vec::new() // Placeholder - implement based on specific domain rules
}

fn detect_reference_violations(crash: &CrashFile) -> Vec<InvariantViolation> {
    // Check for broken object references
    // Look for OID references that point to nil or invalid objects
    
    Vec::new() // Placeholder
}

fn mark_crash_cause(violations: &mut [InvariantViolation], crash: &CrashFile) {
    // If only one critical violation, it's likely the cause
    let critical_count = violations.iter()
        .filter(|v| v.severity == ViolationSeverity::Critical)
        .count();
    
    if critical_count == 1 {
        for v in violations.iter_mut() {
            if v.severity == ViolationSeverity::Critical {
                v.is_crash_cause = true;
            }
        }
    }
    
    // Otherwise, look for violations that match the exception type
    let exception = &crash.exception.exception_type;
    
    if exception.contains("SubscriptOutOfBounds") || exception.contains("Index") {
        for v in violations.iter_mut() {
            if matches!(v.invariant_type, InvariantType::CollectionSizeMismatch { .. }) {
                v.is_crash_cause = true;
            }
        }
    }
    
    if exception.contains("MessageNotUnderstood") {
        for v in violations.iter_mut() {
            if matches!(v.invariant_type, InvariantType::UnexpectedNull { .. }) {
                v.is_crash_cause = true;
            }
        }
    }
}
```

**AI Implementation Notes:**
- Rules engine uses pattern matching on crash data
- Domain-specific rules for WHATS'ON (segment/duration matching)
- Severity classification helps prioritize issues
- Recommendations provide actionable next steps
- Evidence trail supports debugging

---

# PHASE 4: DATABASE FAILURE TAXONOMY

## EPIC 4.1: Database Error Classification

### Goal
Systematically categorize database-related crashes to distinguish infrastructure issues from application bugs.

---

### TASK 4.1.1: Database Error Classifier

#### SUBTASK 4.1.1.1: Define Database Error Types

**File:** `src/analyzer/database_errors.rs`

```rust
use serde::{Deserialize, Serialize};
use regex::Regex;
use lazy_static::lazy_static;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseErrorAnalysis {
    /// Type of database error
    pub error_type: DatabaseErrorType,
    
    /// Database backend
    pub backend: DatabaseBackend,
    
    /// Specific error code if available
    pub error_code: Option<String>,
    
    /// Is this likely an infrastructure issue vs app bug?
    pub is_infrastructure_issue: bool,
    
    /// Confidence in classification
    pub confidence: f32,
    
    /// Recommendations
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DatabaseErrorType {
    /// Prepared statement doesn't exist (PostgreSQL)
    PreparedStatementNotFound {
        statement_name: String,
    },
    
    /// Connection was lost/reset
    ConnectionLost {
        reason: Option<String>,
    },
    
    /// Transaction already aborted
    TransactionAborted,
    
    /// Deadlock detected
    Deadlock,
    
    /// Lock timeout
    LockTimeout {
        table: Option<String>,
    },
    
    /// Constraint violation
    ConstraintViolation {
        constraint_name: Option<String>,
        constraint_type: String,  // unique, foreign_key, check
    },
    
    /// Data too large for column
    DataTruncation {
        column: Option<String>,
    },
    
    /// Invalid SQL syntax
    SyntaxError {
        position: Option<usize>,
    },
    
    /// Permission denied
    PermissionDenied {
        object: Option<String>,
    },
    
    /// Connection pool exhausted
    PoolExhausted,
    
    /// Version/protocol mismatch
    VersionMismatch {
        client_version: Option<String>,
        server_version: Option<String>,
    },
    
    /// Generic/other
    Other {
        description: String,
    },
}

lazy_static! {
    // PostgreSQL patterns
    static ref PG_PREPARED_STMT: Regex = Regex::new(
        r"prepared statement [\"']?(\w+)[\"']? does not exist"
    ).unwrap();
    static ref PG_ERROR_CODE: Regex = Regex::new(r"ERROR:\s*(\d{5}):").unwrap();
    static ref PG_DEADLOCK: Regex = Regex::new(r"(?i)deadlock detected").unwrap();
    static ref PG_LOCK_TIMEOUT: Regex = Regex::new(r"(?i)lock timeout").unwrap();
    
    // Oracle patterns
    static ref ORA_ERROR: Regex = Regex::new(r"ORA-(\d{5})").unwrap();
    static ref ORA_DEADLOCK: Regex = Regex::new(r"ORA-00060").unwrap();
    static ref ORA_LOCK_TIMEOUT: Regex = Regex::new(r"ORA-30006").unwrap();
    static ref ORA_CONNECTION: Regex = Regex::new(r"ORA-(03113|03114|03135|12541)").unwrap();
}

pub fn analyze_database_error(crash: &CrashFile) -> Option<DatabaseErrorAnalysis> {
    // Check if this is a database-related crash
    let error_text = format!(
        "{} {}",
        crash.exception.exception_type,
        crash.exception.message
    );
    
    let is_db_error = error_text.contains("Database") ||
        error_text.contains("Oracle") ||
        error_text.contains("Postgres") ||
        error_text.contains("EXDI") ||
        error_text.contains("SQL") ||
        error_text.contains("prepared statement") ||
        ORA_ERROR.is_match(&error_text) ||
        PG_ERROR_CODE.is_match(&error_text);
    
    if !is_db_error {
        return None;
    }
    
    // Detect backend
    let backend = detect_database_backend(crash);
    
    // Classify error type
    let (error_type, confidence) = classify_database_error(&error_text, &backend);
    
    // Determine if infrastructure vs app bug
    let is_infrastructure = is_infrastructure_issue(&error_type);
    
    // Generate recommendations
    let recommendations = generate_db_recommendations(&error_type, &backend);
    
    // Extract error code
    let error_code = extract_error_code(&error_text, &backend);
    
    Some(DatabaseErrorAnalysis {
        error_type,
        backend,
        error_code,
        is_infrastructure_issue: is_infrastructure,
        confidence,
        recommendations,
    })
}

fn detect_database_backend(crash: &CrashFile) -> DatabaseBackend {
    // Check environment
    if crash.environment.oracle_server.is_some() {
        return DatabaseBackend::Oracle;
    }
    
    // Check error patterns
    let error_text = format!("{} {}", crash.exception.exception_type, crash.exception.message);
    
    if error_text.contains("Postgres") || 
       error_text.contains("libpq") ||
       error_text.contains("prepared statement") {
        return DatabaseBackend::PostgreSQL;
    }
    
    if error_text.contains("Oracle") || ORA_ERROR.is_match(&error_text) {
        return DatabaseBackend::Oracle;
    }
    
    // Check stack trace
    for frame in &crash.stack_trace {
        if frame.method_signature.contains("Postgres") {
            return DatabaseBackend::PostgreSQL;
        }
        if frame.method_signature.contains("Oracle") || frame.method_signature.contains("EXDI") {
            return DatabaseBackend::Oracle;
        }
    }
    
    DatabaseBackend::Unknown
}

fn classify_database_error(error_text: &str, backend: &DatabaseBackend) -> (DatabaseErrorType, f32) {
    match backend {
        DatabaseBackend::PostgreSQL => classify_postgres_error(error_text),
        DatabaseBackend::Oracle => classify_oracle_error(error_text),
        DatabaseBackend::Unknown => classify_generic_db_error(error_text),
    }
}

fn classify_postgres_error(error_text: &str) -> (DatabaseErrorType, f32) {
    // Prepared statement not found (common in connection pooling issues)
    if let Some(caps) = PG_PREPARED_STMT.captures(error_text) {
        return (
            DatabaseErrorType::PreparedStatementNotFound {
                statement_name: caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
            },
            0.95,
        );
    }
    
    // Deadlock
    if PG_DEADLOCK.is_match(error_text) {
        return (DatabaseErrorType::Deadlock, 0.95);
    }
    
    // Lock timeout
    if PG_LOCK_TIMEOUT.is_match(error_text) {
        return (
            DatabaseErrorType::LockTimeout { table: None },
            0.9,
        );
    }
    
    // Connection errors
    if error_text.contains("connection") && 
       (error_text.contains("lost") || error_text.contains("reset") || error_text.contains("closed")) {
        return (
            DatabaseErrorType::ConnectionLost { reason: None },
            0.85,
        );
    }
    
    // Transaction aborted
    if error_text.contains("current transaction is aborted") {
        return (DatabaseErrorType::TransactionAborted, 0.95);
    }
    
    // Generic
    (
        DatabaseErrorType::Other {
            description: error_text.to_string(),
        },
        0.5,
    )
}

fn classify_oracle_error(error_text: &str) -> (DatabaseErrorType, f32) {
    // Deadlock (ORA-00060)
    if ORA_DEADLOCK.is_match(error_text) {
        return (DatabaseErrorType::Deadlock, 0.95);
    }
    
    // Lock timeout (ORA-30006)
    if ORA_LOCK_TIMEOUT.is_match(error_text) {
        return (
            DatabaseErrorType::LockTimeout { table: None },
            0.95,
        );
    }
    
    // Connection errors
    if ORA_CONNECTION.is_match(error_text) {
        return (
            DatabaseErrorType::ConnectionLost {
                reason: Some("Network or server issue".to_string()),
            },
            0.9,
        );
    }
    
    // Constraint violation (ORA-00001 unique, ORA-02291 FK)
    if error_text.contains("ORA-00001") {
        return (
            DatabaseErrorType::ConstraintViolation {
                constraint_name: None,
                constraint_type: "unique".to_string(),
            },
            0.95,
        );
    }
    
    if error_text.contains("ORA-02291") || error_text.contains("ORA-02292") {
        return (
            DatabaseErrorType::ConstraintViolation {
                constraint_name: None,
                constraint_type: "foreign_key".to_string(),
            },
            0.95,
        );
    }
    
    // Generic
    (
        DatabaseErrorType::Other {
            description: error_text.to_string(),
        },
        0.5,
    )
}

fn classify_generic_db_error(error_text: &str) -> (DatabaseErrorType, f32) {
    if error_text.to_lowercase().contains("deadlock") {
        return (DatabaseErrorType::Deadlock, 0.7);
    }
    
    if error_text.to_lowercase().contains("timeout") {
        return (
            DatabaseErrorType::LockTimeout { table: None },
            0.7,
        );
    }
    
    if error_text.to_lowercase().contains("connection") {
        return (
            DatabaseErrorType::ConnectionLost { reason: None },
            0.6,
        );
    }
    
    (
        DatabaseErrorType::Other {
            description: error_text.to_string(),
        },
        0.3,
    )
}

fn is_infrastructure_issue(error_type: &DatabaseErrorType) -> bool {
    matches!(
        error_type,
        DatabaseErrorType::ConnectionLost { .. } |
        DatabaseErrorType::PoolExhausted |
        DatabaseErrorType::VersionMismatch { .. } |
        DatabaseErrorType::PreparedStatementNotFound { .. }  // Often connection pooling config
    )
}

fn extract_error_code(error_text: &str, backend: &DatabaseBackend) -> Option<String> {
    match backend {
        DatabaseBackend::Oracle => {
            ORA_ERROR.captures(error_text)
                .and_then(|c| c.get(1))
                .map(|m| format!("ORA-{}", m.as_str()))
        }
        DatabaseBackend::PostgreSQL => {
            PG_ERROR_CODE.captures(error_text)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
        }
        DatabaseBackend::Unknown => None,
    }
}

fn generate_db_recommendations(error_type: &DatabaseErrorType, backend: &DatabaseBackend) -> Vec<String> {
    let mut recs = Vec::new();
    
    match error_type {
        DatabaseErrorType::PreparedStatementNotFound { statement_name } => {
            recs.push("Check connection pooling configuration (PgBouncer, etc.)".to_string());
            recs.push("Ensure prepared statements are created per-connection, not cached globally".to_string());
            recs.push(format!("Statement '{}' was deallocated - possible connection reuse issue", statement_name));
            if matches!(backend, DatabaseBackend::PostgreSQL) {
                recs.push("If using PgBouncer, set pool_mode to 'session' or handle statement lifecycle".to_string());
            }
        }
        
        DatabaseErrorType::ConnectionLost { .. } => {
            recs.push("Check network connectivity between application and database server".to_string());
            recs.push("Review database server logs for restarts or connection limits".to_string());
            recs.push("Verify firewall rules and timeout settings".to_string());
        }
        
        DatabaseErrorType::Deadlock => {
            recs.push("Review transaction isolation levels".to_string());
            recs.push("Ensure consistent lock ordering across operations".to_string());
            recs.push("Consider reducing transaction scope".to_string());
        }
        
        DatabaseErrorType::LockTimeout { table } => {
            recs.push("Identify long-running transactions holding locks".to_string());
            if let Some(t) = table {
                recs.push(format!("Check concurrent access patterns on table {}", t));
            }
            recs.push("Consider increasing lock timeout or optimizing queries".to_string());
        }
        
        DatabaseErrorType::ConstraintViolation { constraint_type, .. } => {
            recs.push(format!("Verify data integrity - {} constraint violated", constraint_type));
            recs.push("Check application logic for race conditions".to_string());
        }
        
        _ => {
            recs.push("Review database logs for additional context".to_string());
            recs.push("Check database client/server version compatibility".to_string());
        }
    }
    
    recs
}
```

**AI Implementation Notes:**
- Separate classifiers for Oracle and PostgreSQL
- Error code extraction with regex
- Infrastructure vs app bug distinction
- Contextual recommendations

---

# PHASE 5: AI PROMPT UPDATES

## EPIC 5.1: Enhanced AI Prompts

### Goal
Update AI prompts to leverage signature, intent, invariant, and database error data.

---

### TASK 5.1.1: Updated Full Analysis Prompt

#### SUBTASK 5.1.1.1: Prompt Template with New Context

**File:** `src/analyzer/prompts/full_analysis.hbs`

```handlebars
{{> system_base}}

## Your Task

Analyze this WHATS'ON crash and provide comprehensive analysis.

---

## CRASH METADATA

### Signature
- **Hash:** {{signature.hash}}
- **Canonical:** {{signature.canonical}}
- **Previously Seen:** {{#if signature.occurrence_count}}{{signature.occurrence_count}} times{{else}}First occurrence{{/if}}
{{#if signature.linked_ticket}}
- **Known Issue:** {{signature.linked_ticket}}
{{/if}}

### Execution Context (Auto-Detected)
- **Trigger:** {{execution_context.trigger_type}} ({{execution_context.confidence}}% confidence)
- **Feature Area:** {{execution_context.feature_area}}
- **Operation:** {{execution_context.operation_type}}
- **Visibility:** {{execution_context.visibility}}

**Evidence:**
{{#each execution_context.evidence}}
- [{{evidence_type}}] {{value}} → {{interpretation}}
{{/each}}

---

## CRASH DATA

### Exception
- **Type:** {{exception.exception_type}}
- **Message:** {{exception.message}}
{{#if exception.parameter}}- **Parameter:** {{exception.parameter}}{{/if}}

### Environment
- **User:** {{environment.user}}
- **Site:** {{environment.site}}
- **Version:** {{environment.version}}
- **Build:** {{environment.build}}
{{#if environment.oracle_server}}- **Database:** Oracle ({{environment.oracle_server}}){{/if}}

### Stack Trace
```
{{#each stack_trace}}
[{{frame_number}}] {{method_signature}} ({{frame_type}})
{{/each}}
```

### Context
{{#if context}}
**Receiver:** {{context.receiver.class_name}}
{{#if context.receiver.collection_size}}- Size: {{context.receiver.collection_size}} items{{/if}}
{{#if context.receiver.collection_contents}}- Contents: {{context.receiver.collection_contents}}{{/if}}

**Related Objects:**
{{#each context.related_objects}}
- {{class_name}} {{#if object_id}}(OID: {{object_id}}){{/if}}
  {{#each properties}}{{@key}}: {{this}}, {{/each}}
{{/each}}
{{/if}}

---

## PRE-ANALYSIS (Auto-Detected)

### Invariant Violations Detected
{{#if invariant_violations}}
{{#each invariant_violations}}
- **{{invariant_type}}** ({{severity}})
  - {{description}}
  - Is crash cause: {{is_crash_cause}}
{{/each}}
{{else}}
No invariant violations detected by rules engine.
{{/if}}

### Database Error Analysis
{{#if database_error}}
- **Type:** {{database_error.error_type}}
- **Backend:** {{database_error.backend}}
- **Error Code:** {{database_error.error_code}}
- **Infrastructure Issue:** {{database_error.is_infrastructure_issue}}
{{else}}
Not a database-related crash.
{{/if}}

---

## YOUR ANALYSIS

Given the above pre-analysis, provide:

1. **Validate or refine** the auto-detected invariant violations and database errors
2. **Root cause** - technical and plain English
3. **User scenario** - what they were doing, step-by-step reproduction
4. **Suggested fix** - with reasoning and code hints
5. **System warnings** - any other issues noticed
6. **Impact analysis** - affected features
7. **Test scenarios** - verification tests

If this signature has been seen before ({{signature.occurrence_count}} times), consider:
- Is this the same root cause or a variant?
- Are there environment-specific patterns?
- Should recommendations be updated?

Respond with JSON matching the AnalysisResult schema.
```

**AI Implementation Notes:**
- Pre-analysis results fed to LLM for validation/refinement
- Signature history informs analysis
- Execution context provides workflow understanding
- Database error taxonomy reduces LLM guessing

---

# PHASE 6: UI ENHANCEMENTS

## EPIC 6.1: Signature Dashboard Tab

### Goal
Add a new top-level tab for browsing and managing crash signatures.

---

### TASK 6.1.1: Add Signatures Tab to Main UI

#### SUBTASK 6.1.1.1: Tab Integration

**File:** `src/App.tsx` (update)

```tsx
import { SignatureListView } from './components/SignatureListView';

// Add to tabs array:
const tabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'signatures', label: 'Signatures', icon: Fingerprint },  // NEW
  { id: 'testing', label: 'Testing & Impact', icon: TestTube },
  { id: 'stack', label: 'Stack Trace', icon: Layers },
  // ... rest
];

// In tab content render:
{activeTab === 'signatures' && (
  <SignatureListView 
    onSelectSignature={(hash) => {
      // Navigate to a specific crash with this signature
      const file = files.find(f => 
        f.analysis?.signature.hash === hash
      );
      if (file) {
        setSelectedFileId(file.id);
        setActiveTab('overview');
      }
    }}
  />
)}
```

---

## EPIC 6.2: Enhanced Overview Tab

### Goal
Display signature, intent, and invariant information in the Overview tab.

---

### TASK 6.2.1: Signature Badge in Overview

**File:** `src/components/OverviewTab.tsx` (update)

```tsx
// Add after the crash summary header:

{analysis.signature && (
  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
    <h3 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
      <Fingerprint className="w-4 h-4" />
      Crash Signature
    </h3>
    <SignatureBadge signature={analysis.signature} />
    {analysis.signature.occurrenceCount > 1 && (
      <p className="text-sm text-amber-700 mt-2">
        ⚠️ This crash has been seen {analysis.signature.occurrenceCount} times.
        {analysis.signature.linkedTicket && (
          <> Tracked in <a href="#" className="underline">{analysis.signature.linkedTicket}</a>.</>
        )}
      </p>
    )}
  </div>
)}
```

---

### TASK 6.2.2: Execution Context Display

**File:** `src/components/ExecutionContextCard.tsx`

```tsx
import React from 'react';
import { ExecutionContext } from '../types/intent';

interface ExecutionContextCardProps {
  context: ExecutionContext;
}

export const ExecutionContextCard: React.FC<ExecutionContextCardProps> = ({
  context,
}) => {
  const triggerIcons: Record<string, string> = {
    UserInterface: '🖱️',
    ApiCall: '🌐',
    BackgroundJob: '⚙️',
    Import: '📥',
    Export: '📤',
    SystemEvent: '🔧',
    Unknown: '❓',
  };

  const confidenceColor = context.confidence > 0.8 
    ? 'text-green-600' 
    : context.confidence > 0.5 
      ? 'text-yellow-600' 
      : 'text-red-600';

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-indigo-800 mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="text-lg">{triggerIcons[context.triggerType] || '❓'}</span>
          Execution Context (Auto-Reconstructed)
        </span>
        <span className={`text-xs ${confidenceColor}`}>
          {Math.round(context.confidence * 100)}% confidence
        </span>
      </h3>
      
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-indigo-600">Trigger:</span>
          <span className="ml-2 font-medium">{formatTrigger(context.triggerType)}</span>
        </div>
        <div>
          <span className="text-indigo-600">Feature:</span>
          <span className="ml-2 font-medium">{formatFeature(context.featureArea)}</span>
        </div>
        <div>
          <span className="text-indigo-600">Operation:</span>
          <span className="ml-2 font-medium">{context.operationType}</span>
        </div>
        <div>
          <span className="text-indigo-600">Visibility:</span>
          <span className="ml-2 font-medium">{context.visibility}</span>
        </div>
      </div>
      
      {context.evidence.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-indigo-600 cursor-pointer">
            Show evidence ({context.evidence.length} signals)
          </summary>
          <ul className="mt-2 text-xs text-slate-600 space-y-1">
            {context.evidence.map((ev, i) => (
              <li key={i} className="flex items-start gap-2">
                <code className="bg-white px-1 rounded">{ev.evidenceType}</code>
                <span>→ {ev.interpretation}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

function formatTrigger(trigger: string): string {
  const map: Record<string, string> = {
    UserInterface: 'User Interface Action',
    ApiCall: 'API/REST Call',
    BackgroundJob: 'Background Job',
    Import: 'Data Import',
    Export: 'Data Export',
    SystemEvent: 'System Event',
    Unknown: 'Unknown',
  };
  return map[trigger] || trigger;
}

function formatFeature(feature: string): string {
  const map: Record<string, string> = {
    ContinuityPlanning: 'Continuity Planner',
    BreakManagement: 'Break Editor',
    ScheduleManagement: 'Schedule Management',
    ContentManagement: 'Content/Programs',
    PlaylistExport: 'Playlist Export',
    EpgExport: 'EPG Export',
    DataImport: 'Data Import',
    Reporting: 'Reporting',
    Unknown: 'Unknown',
  };
  return map[feature] || feature;
}
```

---

### TASK 6.2.3: Invariant Violations Display

**File:** `src/components/InvariantViolationsCard.tsx`

```tsx
import React from 'react';
import { InvariantViolation } from '../types/invariants';

interface InvariantViolationsCardProps {
  violations: InvariantViolation[];
}

export const InvariantViolationsCard: React.FC<InvariantViolationsCardProps> = ({
  violations,
}) => {
  if (violations.length === 0) return null;

  const severityColors: Record<string, string> = {
    Critical: 'bg-red-100 border-red-300 text-red-800',
    High: 'bg-orange-100 border-orange-300 text-orange-800',
    Medium: 'bg-yellow-100 border-yellow-300 text-yellow-800',
    Low: 'bg-gray-100 border-gray-300 text-gray-800',
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-red-800 mb-3 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        Data Integrity Issues Detected
      </h3>
      
      <div className="space-y-3">
        {violations.map((v, i) => (
          <div 
            key={i}
            className={`p-3 rounded-lg border ${severityColors[v.severity]}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{formatInvariantType(v.invariantType)}</span>
                {v.isCrashCause && (
                  <span className="px-2 py-0.5 bg-red-200 text-red-900 rounded text-xs">
                    ROOT CAUSE
                  </span>
                )}
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-white bg-opacity-50">
                {v.severity}
              </span>
            </div>
            
            <p className="text-sm mt-1">{v.description}</p>
            
            {v.recommendations.length > 0 && (
              <div className="mt-2 pt-2 border-t border-current border-opacity-20">
                <p className="text-xs font-medium mb-1">Recommendations:</p>
                <ul className="text-xs space-y-0.5">
                  {v.recommendations.map((rec, j) => (
                    <li key={j}>• {rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

function formatInvariantType(type: any): string {
  if (typeof type === 'string') return type;
  
  // Handle structured types
  if ('CollectionSizeMismatch' in type) {
    return 'Collection Size Mismatch';
  }
  if ('UnexpectedNull' in type) {
    return 'Unexpected Null Value';
  }
  if ('BrokenReference' in type) {
    return 'Broken Reference';
  }
  
  return 'Data Invariant Violation';
}
```

---

# APPENDIX A: DATABASE MIGRATION NOTES

## SQLite to PostgreSQL Migration

When migrating from SQLite to PostgreSQL:

### Schema Changes
1. Change `TEXT` date columns to `TIMESTAMPTZ`
2. Change JSON `TEXT` columns to `JSONB`
3. Add proper UUID type for IDs
4. Add triggers for `updated_at` columns

### Migration Script Template
```sql
-- PostgreSQL migration from SQLite

-- 1. Create new tables with proper types
-- 2. Migrate data with type conversions
-- 3. Create indexes
-- 4. Verify data integrity
-- 5. Switch application connection string
```

### Rust Code Changes
1. Replace `rusqlite` with `sqlx` or `tokio-postgres`
2. Update query syntax for PostgreSQL
3. Handle JSONB serialization/deserialization
4. Update date/time handling

---

# APPENDIX B: TESTING CHECKLIST

## Unit Tests Required
- [ ] Signature computation determinism
- [ ] Signature component extraction
- [ ] Intent classification accuracy
- [ ] Invariant detection rules
- [ ] Database error classification

## Integration Tests Required
- [ ] Signature persistence and retrieval
- [ ] Cross-crash signature matching
- [ ] Full analysis pipeline with new components
- [ ] UI state management with signatures

## Manual Tests
- [ ] Signature grouping in UI
- [ ] Ticket linking workflow
- [ ] Status updates
- [ ] Export with signature data

---

# CHANGE LOG

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-01-19 | Added Phases 1-6 from Addendum requirements |

---

*End of Document*
