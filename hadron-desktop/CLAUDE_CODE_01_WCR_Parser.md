# CLAUDE CODE INSTRUCTION: WCR Crash File Parser

## Context

You are implementing a crash file parser for WHATS'ON (a VisualWorks Smalltalk broadcast management application). The crash files are text dumps with the naming pattern `WCR_*.txt` containing diagnostic information when the application crashes.

This is a Rust/Tauri desktop application. The parser is a core component that all other features depend on.

## Project Structure

Ensure this structure exists:
```
src/
├── parser/
│   ├── mod.rs
│   ├── crash_file.rs       # Main parser entry point
│   ├── sections/
│   │   ├── mod.rs
│   │   ├── header.rs
│   │   ├── environment.rs
│   │   ├── exception.rs
│   │   ├── stack_trace.rs
│   │   ├── context.rs
│   │   ├── windows.rs
│   │   ├── processes.rs
│   │   ├── database.rs
│   │   └── memory.rs
│   ├── patterns.rs         # Regex patterns
│   └── error.rs            # Parser errors
├── models/
│   ├── mod.rs
│   └── crash.rs            # Data structures
```

## Dependencies

Add to `Cargo.toml`:
```toml
[dependencies]
regex = "1.10"
lazy_static = "1.4"
chrono = { version = "0.4", features = ["serde"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
anyhow = "1.0"
tracing = "0.1"  # For logging
```

---

## TASK 1: Define Data Models

### File: `src/models/crash.rs`

Create comprehensive data structures for parsed crash data:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Complete parsed crash file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashFile {
    /// File metadata and header info
    pub header: CrashHeader,
    
    /// Environment/system information
    pub environment: Environment,
    
    /// The exception that caused the crash
    pub exception: Exception,
    
    /// The active process when crash occurred
    pub active_process: Option<ActiveProcess>,
    
    /// Stack trace frames
    pub stack_trace: Vec<StackFrame>,
    
    /// Context arguments from stack
    pub context: Option<ContextArguments>,
    
    /// Open windows at crash time
    pub windows: Vec<OpenWindow>,
    
    /// Process lists
    pub processes: ProcessLists,
    
    /// Database connection state
    pub database: DatabaseState,
    
    /// Memory report
    pub memory: MemoryReport,
    
    /// Command line arguments
    pub command_line: Option<String>,
    
    /// Raw walkback text (for AI analysis)
    pub raw_walkback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashHeader {
    pub file_name: String,
    pub file_size: u64,
    pub timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub dump_complete: bool,
    pub dump_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Environment {
    pub user: Option<String>,
    pub site: Option<String>,
    pub version: Option<String>,
    pub build: Option<String>,
    pub db_hash: Option<String>,
    pub smalltalk_version: Option<String>,
    pub computer_name: Option<String>,
    pub os_user: Option<String>,
    pub time_zone: Option<String>,
    pub frame_rate: Option<String>,
    pub frame_rate_mode: Option<String>,
    pub oracle_server: Option<String>,
    pub oracle_client: Option<String>,
    pub postgres_version: Option<String>,
    pub db_encoding: Option<String>,
    pub citrix_session: Option<String>,
    /// Any additional key-value pairs found
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Exception {
    pub exception_type: String,
    pub message: String,
    pub parameter: Option<String>,
    pub signal_name: Option<String>,
    pub is_resumable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveProcess {
    pub name: String,
    pub priority: Option<String>,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackFrame {
    pub frame_number: u32,
    pub method_signature: String,
    pub class_name: Option<String>,
    pub parent_class: Option<String>,
    pub method_name: Option<String>,
    pub namespace: Option<String>,
    pub is_optimized: bool,
    pub is_block_closure: bool,
    pub frame_type: FrameType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FrameType {
    /// Exception/error handling frames
    Error,
    /// Application code (MediaGeniX.*)
    Application,
    /// VisualWorks framework
    Framework,
    /// Database related (EXDI, Oracle, Postgres)
    Database,
    /// Unknown/other
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContextArguments {
    pub receiver: Option<ObjectSnapshot>,
    pub arguments: Vec<NamedValue>,
    pub temporaries: Vec<NamedValue>,
    pub instance_variables: Vec<NamedValue>,
    /// Extracted business objects with their properties
    pub business_objects: Vec<BusinessObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectSnapshot {
    pub class_name: String,
    pub print_string: Option<String>,
    pub oid: Option<String>,
    pub is_collection: bool,
    pub collection_size: Option<usize>,
    pub first_index: Option<usize>,
    pub last_index: Option<usize>,
    pub collection_contents: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedValue {
    pub name: String,
    pub value: String,
    pub class_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessObject {
    pub class_name: String,
    pub oid: Option<String>,
    pub properties: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWindow {
    pub id: u32,
    pub label: String,
    pub title: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProcessLists {
    pub quiescent: Vec<ProcessInfo>,
    pub suspended: Vec<ProcessInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub name: String,
    pub priority: Option<String>,
    pub hash: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DatabaseState {
    pub connections: Vec<DbConnection>,
    pub sessions: Vec<DbSession>,
    pub has_active_transaction: bool,
    pub active_transaction_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbConnection {
    pub hash: String,
    pub state: String,
    pub username: Option<String>,
    pub environment: Option<String>,
    pub has_transaction: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbSession {
    pub hash: String,
    pub state: String,
    pub query: Option<String>,
    pub prepared_statement: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryReport {
    pub eden: Option<MemorySpace>,
    pub survivor: Option<MemorySpace>,
    pub old: Option<MemorySpace>,
    pub large: Option<MemorySpace>,
    pub perm: Option<MemorySpace>,
    pub total_used: Option<String>,
    pub config_limit: Option<String>,
    pub growth_limit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySpace {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub size_display: String,
    pub percent_used: f32,
}
```

### File: `src/models/mod.rs`

```rust
mod crash;

pub use crash::*;
```

---

## TASK 2: Define Parser Errors

### File: `src/parser/error.rs`

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ParseError {
    #[error("Failed to read file: {0}")]
    IoError(#[from] std::io::Error),
    
    #[error("File appears to be empty or invalid")]
    EmptyFile,
    
    #[error("Missing required section: {0}")]
    MissingSection(String),
    
    #[error("Failed to parse section '{section}': {message}")]
    SectionParseError {
        section: String,
        message: String,
    },
    
    #[error("Invalid timestamp format: {0}")]
    InvalidTimestamp(String),
    
    #[error("Unexpected format in {context}: {details}")]
    UnexpectedFormat {
        context: String,
        details: String,
    },
}

pub type ParseResult<T> = Result<T, ParseError>;
```

---

## TASK 3: Define Regex Patterns

### File: `src/parser/patterns.rs`

```rust
use lazy_static::lazy_static;
use regex::Regex;

lazy_static! {
    // === Section Boundary Patterns ===
    
    /// Matches section headers like "Smalltalk Exception Information:"
    pub static ref SECTION_HEADER: Regex = Regex::new(
        r"^([A-Z][A-Za-z\s]+):\s*$"
    ).unwrap();
    
    /// Dump completion status
    pub static ref DUMP_STATUS: Regex = Regex::new(
        r"Dump (completed|incomplete|aborted)"
    ).unwrap();
    
    // === Environment Patterns ===
    
    /// Key: Value pattern (with possible multiline values)
    pub static ref KEY_VALUE: Regex = Regex::new(
        r"^([A-Za-z][A-Za-z0-9\s_-]*?):\s*(.*)$"
    ).unwrap();
    
    /// Site name pattern: "Site: SITENAME"
    pub static ref SITE: Regex = Regex::new(
        r"Site:\s*(\S+)"
    ).unwrap();
    
    /// Version pattern: "WHATS'ON version 2024r3.000.064"
    pub static ref VERSION: Regex = Regex::new(
        r"WHATS'ON version\s+(\S+)"
    ).unwrap();
    
    /// Build pattern: "build 2024r3.000.064.8"
    pub static ref BUILD: Regex = Regex::new(
        r"build\s+(\S+)"
    ).unwrap();
    
    /// Smalltalk version pattern
    pub static ref SMALLTALK_VERSION: Regex = Regex::new(
        r"VisualWorks[®]?,?\s*(?:Version\s+)?(\d+\.?\d*)"
    ).unwrap();
    
    /// Oracle server version
    pub static ref ORACLE_SERVER: Regex = Regex::new(
        r"Database Server Version:\s*(.+)"
    ).unwrap();
    
    /// Oracle client version
    pub static ref ORACLE_CLIENT: Regex = Regex::new(
        r"Database Client Version:\s*(.+)"
    ).unwrap();
    
    // === Exception Patterns ===
    
    /// Exception class pattern
    pub static ref EXCEPTION_CLASS: Regex = Regex::new(
        r"^Unhandled exception:\s*(.+)$"
    ).unwrap();
    
    /// Alternative: "Exception Class: ..."
    pub static ref EXCEPTION_CLASS_ALT: Regex = Regex::new(
        r"Exception Class:\s*(.+)"
    ).unwrap();
    
    /// Exception message/parameter
    pub static ref EXCEPTION_MESSAGE: Regex = Regex::new(
        r"(?:messageText|errorString|parameter):\s*'?(.+?)'?\s*$"
    ).unwrap();
    
    /// Signal name
    pub static ref SIGNAL_NAME: Regex = Regex::new(
        r"Signal:\s*(\S+)"
    ).unwrap();
    
    // === Stack Trace Patterns ===
    
    /// Stack frame: "[1] ClassName>>methodName" or "[1] optimized [] in ..."
    pub static ref STACK_FRAME: Regex = Regex::new(
        r"^\[(\d+)\]\s+(.+)$"
    ).unwrap();
    
    /// Method signature breakdown: "Namespace.Class(Parent)>>method:"
    pub static ref METHOD_SIGNATURE: Regex = Regex::new(
        r"^(?:optimized\s+)?(?:\[\]\s+in\s+)*(?:([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.)?([A-Za-z_]\w*)(?:\(([A-Za-z_]\w*)\))?>>([^\s]+)"
    ).unwrap();
    
    // === Context Patterns ===
    
    /// Receiver line: "Receiver: anOrderedCollection ..."
    pub static ref RECEIVER: Regex = Regex::new(
        r"^Receiver:\s*(?:an?\s*)?(\w+)"
    ).unwrap();
    
    /// Collection info: "firstIndex = 1, lastIndex = 5"
    pub static ref COLLECTION_INFO: Regex = Regex::new(
        r"firstIndex\s*=\s*(\d+).*lastIndex\s*=\s*(\d+)"
    ).unwrap();
    
    /// Argument line: "argName = value" or "argName: value"
    pub static ref ARGUMENT: Regex = Regex::new(
        r"^\s*(\w+)\s*[=:]\s*(.+)$"
    ).unwrap();
    
    /// OID extraction: "oid = 12345" or "(oid: 12345)"
    pub static ref OID: Regex = Regex::new(
        r"oid\s*[=:]\s*(\d+)"
    ).unwrap();
    
    // === Window Patterns ===
    
    /// Window entry: "1: 'Window Title' PLModelClass"
    pub static ref WINDOW_ENTRY: Regex = Regex::new(
        r"^(\d+):\s*(?:'([^']*)'|\"([^\"]*)\")\s+(\S+)"
    ).unwrap();
    
    // === Process Patterns ===
    
    /// Process entry: "ProcessName priority hash"
    pub static ref PROCESS_ENTRY: Regex = Regex::new(
        r"^'?([^']+)'?\s+(\w+)?\s*(#[\da-fA-F]+)?"
    ).unwrap();
    
    // === Database Patterns ===
    
    /// Connection entry: "hash state (username@env)"
    pub static ref DB_CONNECTION: Regex = Regex::new(
        r"(#[\da-fA-F]+)\s+(\w+)\s+\((\w+)@(\w+)\)"
    ).unwrap();
    
    /// Transaction state: "xactYes" or "xactNo"
    pub static ref TRANSACTION_STATE: Regex = Regex::new(
        r"xact(Yes|No)"
    ).unwrap();
    
    /// Prepared statement: "prepared statement 'name'"
    pub static ref PREPARED_STATEMENT: Regex = Regex::new(
        r#"prepared statement\s+['"]([\w\d]+)['"]"#
    ).unwrap();
    
    // === Memory Patterns ===
    
    /// Memory space: "Eden: 1234K (45%)"
    pub static ref MEMORY_SPACE: Regex = Regex::new(
        r"(\w+):\s*([\d,]+)\s*([KMG]?B?)?\s*\((\d+(?:\.\d+)?)\s*%\)"
    ).unwrap();
    
    /// Memory limit: "limit = 1024M"
    pub static ref MEMORY_LIMIT: Regex = Regex::new(
        r"limit\s*=\s*([\d,]+\s*[KMG]?B?)"
    ).unwrap();
    
    // === Business Object Patterns (WHATS'ON Specific) ===
    
    /// MediaGeniX class detection
    pub static ref MEDIAGENIIX_CLASS: Regex = Regex::new(
        r"MediaGeniX\.(\w+)"
    ).unwrap();
    
    /// TxBlock pattern
    pub static ref TXBLOCK: Regex = Regex::new(
        r"PSITxBlock\w*"
    ).unwrap();
    
    /// TimeAllocation pattern
    pub static ref TIME_ALLOCATION: Regex = Regex::new(
        r"(?:BM)?TimeAllocation"
    ).unwrap();
    
    /// Channel pattern
    pub static ref CHANNEL: Regex = Regex::new(
        r"channel\s*[=:]\s*'?([^'\n]+)'?"
    ).unwrap();
    
    /// Date pattern in context
    pub static ref SCHEDULE_DATE: Regex = Regex::new(
        r"date\s*[=:]\s*'?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})'?"
    ).unwrap();
}

/// Section names we recognize
pub const KNOWN_SECTIONS: &[&str] = &[
    "Smalltalk Exception Information",
    "Exception Information", 
    "Environment Information",
    "System Information",
    "Active Process",
    "Stack Trace",
    "Context Stack",
    "Initial Context Stack Arguments",
    "Open Windows",
    "Quiescent Processes",
    "Suspended Processes",
    "Database Connections",
    "Database Sessions",
    "Memory Report",
    "Memory Statistics",
    "Command Line",
    "Walkback",
];

/// Detect which section a line might be starting
pub fn detect_section(line: &str) -> Option<&'static str> {
    let trimmed = line.trim().trim_end_matches(':');
    KNOWN_SECTIONS.iter()
        .find(|&&s| trimmed.eq_ignore_ascii_case(s) || trimmed.contains(s))
        .copied()
}
```

---

## TASK 4: Implement Section Parsers

### File: `src/parser/sections/mod.rs`

```rust
mod header;
mod environment;
mod exception;
mod stack_trace;
mod context;
mod windows;
mod processes;
mod database;
mod memory;

pub use header::parse_header;
pub use environment::parse_environment;
pub use exception::parse_exception;
pub use stack_trace::parse_stack_trace;
pub use context::parse_context;
pub use windows::parse_windows;
pub use processes::{parse_quiescent_processes, parse_suspended_processes};
pub use database::{parse_db_connections, parse_db_sessions};
pub use memory::parse_memory;
```

### File: `src/parser/sections/header.rs`

```rust
use crate::models::CrashHeader;
use crate::parser::patterns::DUMP_STATUS;
use chrono::{DateTime, NaiveDateTime, Utc};

pub fn parse_header(content: &str, file_name: &str, file_size: u64) -> CrashHeader {
    let mut timestamp = None;
    let mut dump_complete = true;
    let mut dump_status = None;

    for line in content.lines().take(20) {
        // Look for timestamp patterns
        if timestamp.is_none() {
            if let Some(ts) = try_parse_timestamp(line) {
                timestamp = Some(ts);
            }
        }

        // Check dump status
        if let Some(caps) = DUMP_STATUS.captures(line) {
            let status = caps.get(1).map(|m| m.as_str()).unwrap_or("unknown");
            dump_status = Some(status.to_string());
            dump_complete = status == "completed";
        }
    }

    CrashHeader {
        file_name: file_name.to_string(),
        file_size,
        timestamp,
        dump_complete,
        dump_status,
    }
}

fn try_parse_timestamp(line: &str) -> Option<DateTime<Utc>> {
    // Common formats in WCR files:
    // "2026-01-15 14:23:45"
    // "15/01/2026 14:23:45"
    // "Jan 15, 2026 2:23:45 PM"
    
    let formats = [
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
        "%b %d, %Y %I:%M:%S %p",
    ];

    for fmt in formats {
        if let Ok(naive) = NaiveDateTime::parse_from_str(line.trim(), fmt) {
            return Some(DateTime::from_naive_utc_and_offset(naive, Utc));
        }
    }

    // Try to find timestamp substring in longer lines
    // Pattern: look for YYYY-MM-DD or DD/MM/YYYY
    let date_patterns = [
        r"\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}",
        r"\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}",
    ];
    
    for pattern in date_patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(m) = re.find(line) {
                for fmt in &formats[..2] {
                    if let Ok(naive) = NaiveDateTime::parse_from_str(m.as_str(), fmt) {
                        return Some(DateTime::from_naive_utc_and_offset(naive, Utc));
                    }
                }
            }
        }
    }

    None
}
```

### File: `src/parser/sections/environment.rs`

```rust
use crate::models::Environment;
use crate::parser::patterns::*;
use std::collections::HashMap;

pub fn parse_environment(content: &str) -> Environment {
    let mut env = Environment::default();
    let mut extra = HashMap::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Try key-value extraction
        if let Some(caps) = KEY_VALUE.captures(line) {
            let key = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let value = caps.get(2).map(|m| m.as_str().trim()).unwrap_or("");
            
            match key.to_lowercase().as_str() {
                "user" | "username" | "logged in user" => env.user = Some(value.to_string()),
                "site" => env.site = Some(value.to_string()),
                "computer" | "computername" | "machine" => env.computer_name = Some(value.to_string()),
                "os user" | "windows user" => env.os_user = Some(value.to_string()),
                "time zone" | "timezone" => env.time_zone = Some(value.to_string()),
                "frame rate" => env.frame_rate = Some(value.to_string()),
                "frame rate mode" => env.frame_rate_mode = Some(value.to_string()),
                "citrix session" | "citrix" => env.citrix_session = Some(value.to_string()),
                "database server version" => env.oracle_server = Some(value.to_string()),
                "database client version" => env.oracle_client = Some(value.to_string()),
                "db encoding" | "encoding" => env.db_encoding = Some(value.to_string()),
                _ => {
                    if !value.is_empty() {
                        extra.insert(key.to_string(), value.to_string());
                    }
                }
            }
        }

        // Version pattern
        if let Some(caps) = VERSION.captures(line) {
            env.version = caps.get(1).map(|m| m.as_str().to_string());
        }

        // Build pattern
        if let Some(caps) = BUILD.captures(line) {
            env.build = caps.get(1).map(|m| m.as_str().to_string());
        }

        // Smalltalk version
        if let Some(caps) = SMALLTALK_VERSION.captures(line) {
            env.smalltalk_version = caps.get(1).map(|m| m.as_str().to_string());
        }

        // Check for PostgreSQL indicators
        if line.to_lowercase().contains("postgres") || line.contains("libpq") {
            if env.postgres_version.is_none() {
                env.postgres_version = Some(extract_version_number(line));
            }
        }
    }

    env.extra = extra;
    env
}

fn extract_version_number(text: &str) -> String {
    // Try to find version-like patterns: X.Y.Z or X.Y
    let re = regex::Regex::new(r"\d+\.\d+(?:\.\d+)?").unwrap();
    re.find(text)
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| text.to_string())
}
```

### File: `src/parser/sections/exception.rs`

```rust
use crate::models::Exception;
use crate::parser::patterns::*;

pub fn parse_exception(content: &str) -> Exception {
    let mut exception_type = String::new();
    let mut message = String::new();
    let mut parameter = None;
    let mut signal_name = None;
    let mut is_resumable = false;

    for line in content.lines() {
        let line = line.trim();

        // Exception class
        if exception_type.is_empty() {
            if let Some(caps) = EXCEPTION_CLASS.captures(line) {
                exception_type = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            } else if let Some(caps) = EXCEPTION_CLASS_ALT.captures(line) {
                exception_type = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            }
        }

        // Message/parameter
        if line.starts_with("messageText") || line.starts_with("errorString") {
            if let Some(idx) = line.find(':') {
                message = line[idx + 1..].trim().trim_matches('\'').to_string();
            }
        }

        if line.starts_with("parameter") {
            if let Some(idx) = line.find(':') {
                parameter = Some(line[idx + 1..].trim().trim_matches('\'').to_string());
            }
        }

        // Signal name
        if let Some(caps) = SIGNAL_NAME.captures(line) {
            signal_name = caps.get(1).map(|m| m.as_str().to_string());
        }

        // Resumable flag
        if line.to_lowercase().contains("resumable") {
            is_resumable = line.to_lowercase().contains("true") || 
                           line.to_lowercase().contains("yes");
        }
    }

    // If we still don't have exception type, try first non-empty line
    if exception_type.is_empty() {
        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.contains(':') {
                exception_type = trimmed.to_string();
                break;
            }
        }
    }

    Exception {
        exception_type,
        message,
        parameter,
        signal_name,
        is_resumable,
    }
}
```

### File: `src/parser/sections/stack_trace.rs`

```rust
use crate::models::{StackFrame, FrameType};
use crate::parser::patterns::*;

pub fn parse_stack_trace(content: &str) -> Vec<StackFrame> {
    let mut frames = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(caps) = STACK_FRAME.captures(line) {
            let frame_number: u32 = caps.get(1)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0);
            
            let method_signature = caps.get(2)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();

            let frame = parse_frame(frame_number, &method_signature);
            frames.push(frame);
        }
    }

    frames
}

fn parse_frame(frame_number: u32, signature: &str) -> StackFrame {
    let is_optimized = signature.starts_with("optimized");
    let is_block_closure = signature.contains("[] in");

    // Clean up signature for parsing
    let clean_sig = signature
        .replace("optimized ", "")
        .replace("[] in ", "");

    let (namespace, class_name, parent_class, method_name) = 
        extract_method_parts(&clean_sig);

    let frame_type = classify_frame(signature);

    StackFrame {
        frame_number,
        method_signature: signature.to_string(),
        class_name,
        parent_class,
        method_name,
        namespace,
        is_optimized,
        is_block_closure,
        frame_type,
    }
}

fn extract_method_parts(signature: &str) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    // Try to match: Namespace.Class(Parent)>>method
    if let Some(caps) = METHOD_SIGNATURE.captures(signature) {
        let namespace = caps.get(1).map(|m| m.as_str().to_string());
        let class_name = caps.get(2).map(|m| m.as_str().to_string());
        let parent_class = caps.get(3).map(|m| m.as_str().to_string());
        let method_name = caps.get(4).map(|m| m.as_str().to_string());
        return (namespace, class_name, parent_class, method_name);
    }

    // Fallback: try simple Class>>method pattern
    if let Some(idx) = signature.find(">>") {
        let class_part = &signature[..idx];
        let method_part = &signature[idx + 2..];
        
        // Check for namespace in class
        let (namespace, class_name) = if let Some(dot_idx) = class_part.rfind('.') {
            (Some(class_part[..dot_idx].to_string()), Some(class_part[dot_idx + 1..].to_string()))
        } else {
            (None, Some(class_part.to_string()))
        };

        return (namespace, class_name, None, Some(method_part.to_string()));
    }

    (None, None, None, None)
}

fn classify_frame(signature: &str) -> FrameType {
    let sig_lower = signature.to_lowercase();

    // Error/exception handling
    if sig_lower.contains("error") || 
       sig_lower.contains("exception") ||
       sig_lower.contains("signal") ||
       sig_lower.contains("subscriptbounds") ||
       sig_lower.contains("walkback") {
        return FrameType::Error;
    }

    // Application code (MediaGeniX namespace)
    if signature.contains("MediaGeniX.") {
        return FrameType::Application;
    }

    // Database related
    if sig_lower.contains("exdi") ||
       sig_lower.contains("oracle") ||
       sig_lower.contains("postgres") ||
       sig_lower.contains("database") ||
       sig_lower.contains("sql") {
        return FrameType::Database;
    }

    // Check for other common application indicators
    if signature.starts_with("PSI") ||
       signature.starts_with("BM") ||
       signature.starts_with("PL") ||
       signature.starts_with("WOn") {
        return FrameType::Application;
    }

    FrameType::Framework
}
```

### File: `src/parser/sections/context.rs`

```rust
use crate::models::{ContextArguments, ObjectSnapshot, NamedValue, BusinessObject};
use crate::parser::patterns::*;
use std::collections::HashMap;

pub fn parse_context(content: &str) -> ContextArguments {
    let mut ctx = ContextArguments::default();
    let mut current_section = "";
    let mut current_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // Detect subsections
        if trimmed.starts_with("Receiver:") || trimmed == "Receiver" {
            flush_section(&mut ctx, current_section, &current_lines);
            current_section = "receiver";
            current_lines.clear();
            if trimmed.starts_with("Receiver:") {
                current_lines.push(trimmed);
            }
        } else if trimmed.starts_with("Arguments:") || trimmed == "Arguments" {
            flush_section(&mut ctx, current_section, &current_lines);
            current_section = "arguments";
            current_lines.clear();
        } else if trimmed.starts_with("Temporaries:") || trimmed == "Temporaries" {
            flush_section(&mut ctx, current_section, &current_lines);
            current_section = "temporaries";
            current_lines.clear();
        } else if trimmed.starts_with("Instance Variables:") {
            flush_section(&mut ctx, current_section, &current_lines);
            current_section = "instance_vars";
            current_lines.clear();
        } else if !trimmed.is_empty() {
            current_lines.push(trimmed);
        }
    }

    // Flush final section
    flush_section(&mut ctx, current_section, &current_lines);

    // Extract business objects from all parsed data
    ctx.business_objects = extract_business_objects(&ctx);

    ctx
}

fn flush_section(ctx: &mut ContextArguments, section: &str, lines: &[&str]) {
    match section {
        "receiver" => {
            ctx.receiver = Some(parse_receiver(lines));
        }
        "arguments" => {
            ctx.arguments = parse_named_values(lines);
        }
        "temporaries" => {
            ctx.temporaries = parse_named_values(lines);
        }
        "instance_vars" => {
            ctx.instance_variables = parse_named_values(lines);
        }
        _ => {}
    }
}

fn parse_receiver(lines: &[&str]) -> ObjectSnapshot {
    let mut snapshot = ObjectSnapshot {
        class_name: "Unknown".to_string(),
        print_string: None,
        oid: None,
        is_collection: false,
        collection_size: None,
        first_index: None,
        last_index: None,
        collection_contents: None,
    };

    let combined = lines.join(" ");

    // Extract class name
    if let Some(caps) = RECEIVER.captures(&combined) {
        snapshot.class_name = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
    }

    // Check if it's a collection
    let is_collection = snapshot.class_name.contains("Collection") ||
                        snapshot.class_name.contains("Array") ||
                        snapshot.class_name.contains("Set") ||
                        snapshot.class_name.contains("Dictionary");
    snapshot.is_collection = is_collection;

    // Extract collection info
    if let Some(caps) = COLLECTION_INFO.captures(&combined) {
        snapshot.first_index = caps.get(1).and_then(|m| m.as_str().parse().ok());
        snapshot.last_index = caps.get(2).and_then(|m| m.as_str().parse().ok());
        
        if let (Some(first), Some(last)) = (snapshot.first_index, snapshot.last_index) {
            snapshot.collection_size = Some((last - first + 1) as usize);
        }
    }

    // Extract OID
    if let Some(caps) = OID.captures(&combined) {
        snapshot.oid = caps.get(1).map(|m| m.as_str().to_string());
    }

    // Look for print string (often in quotes or after class name)
    if combined.contains('\'') {
        let parts: Vec<&str> = combined.split('\'').collect();
        if parts.len() >= 2 {
            snapshot.print_string = Some(parts[1].to_string());
        }
    }

    // Try to extract collection contents if present
    if is_collection {
        let mut contents = Vec::new();
        for line in lines {
            // Look for indexed entries: "1: value" or "[1] value"
            if let Some(idx) = line.find(':') {
                let prefix = &line[..idx];
                if prefix.trim().parse::<usize>().is_ok() {
                    contents.push(line[idx + 1..].trim().to_string());
                }
            }
        }
        if !contents.is_empty() {
            snapshot.collection_contents = Some(contents);
        }
    }

    snapshot
}

fn parse_named_values(lines: &[&str]) -> Vec<NamedValue> {
    let mut values = Vec::new();

    for line in lines {
        if let Some(caps) = ARGUMENT.captures(line) {
            let name = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let value = caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
            
            // Try to extract class name from value
            let class_name = if value.starts_with("a ") || value.starts_with("an ") {
                value.split_whitespace().nth(1).map(|s| s.to_string())
            } else {
                None
            };

            values.push(NamedValue { name, value, class_name });
        }
    }

    values
}

fn extract_business_objects(ctx: &ContextArguments) -> Vec<BusinessObject> {
    let mut objects = Vec::new();
    let mut seen_oids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Helper to extract business object from a named value
    let extract_from_value = |nv: &NamedValue, objects: &mut Vec<BusinessObject>, seen: &mut std::collections::HashSet<String>| {
        // Check if it's a MediaGeniX object
        if let Some(ref class) = nv.class_name {
            if class.starts_with("PSI") || class.starts_with("BM") || 
               class.starts_with("PL") || class.starts_with("WOn") ||
               MEDIAGENIIX_CLASS.is_match(&nv.value) {
                
                let mut props = HashMap::new();
                
                // Extract OID if present
                let oid = OID.captures(&nv.value)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string());
                
                if let Some(ref oid) = oid {
                    if seen.contains(oid) {
                        return;
                    }
                    seen.insert(oid.clone());
                    props.insert("oid".to_string(), serde_json::Value::String(oid.clone()));
                }

                // Extract channel if present
                if let Some(caps) = CHANNEL.captures(&nv.value) {
                    props.insert(
                        "channel".to_string(),
                        serde_json::Value::String(caps.get(1).unwrap().as_str().to_string())
                    );
                }

                // Extract date if present
                if let Some(caps) = SCHEDULE_DATE.captures(&nv.value) {
                    props.insert(
                        "date".to_string(),
                        serde_json::Value::String(caps.get(1).unwrap().as_str().to_string())
                    );
                }

                objects.push(BusinessObject {
                    class_name: class.clone(),
                    oid,
                    properties: props,
                });
            }
        }
    };

    // Process all sources
    for nv in &ctx.arguments {
        extract_from_value(nv, &mut objects, &mut seen_oids);
    }
    for nv in &ctx.temporaries {
        extract_from_value(nv, &mut objects, &mut seen_oids);
    }
    for nv in &ctx.instance_variables {
        extract_from_value(nv, &mut objects, &mut seen_oids);
    }

    // Also check receiver
    if let Some(ref recv) = ctx.receiver {
        if recv.class_name.starts_with("PSI") || recv.class_name.starts_with("BM") ||
           recv.class_name.starts_with("PL") {
            if let Some(ref oid) = recv.oid {
                if !seen_oids.contains(oid) {
                    objects.push(BusinessObject {
                        class_name: recv.class_name.clone(),
                        oid: Some(oid.clone()),
                        properties: HashMap::new(),
                    });
                }
            }
        }
    }

    objects
}
```

### File: `src/parser/sections/windows.rs`

```rust
use crate::models::OpenWindow;
use crate::parser::patterns::WINDOW_ENTRY;

pub fn parse_windows(content: &str) -> Vec<OpenWindow> {
    let mut windows = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(caps) = WINDOW_ENTRY.captures(line) {
            let id: u32 = caps.get(1)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0);
            
            // Title might be in group 2 (single quotes) or group 3 (double quotes)
            let title = caps.get(2)
                .or_else(|| caps.get(3))
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            
            let model = caps.get(4)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();

            // Extract label from title if present
            let label = if title.contains(':') {
                title.split(':').last().unwrap_or(&title).trim().to_string()
            } else {
                title.clone()
            };

            windows.push(OpenWindow {
                id,
                label,
                title,
                model,
            });
        } else {
            // Fallback: try simple space-separated parsing
            let parts: Vec<&str> = line.splitn(3, ' ').collect();
            if parts.len() >= 2 {
                if let Ok(id) = parts[0].trim_end_matches(':').parse::<u32>() {
                    windows.push(OpenWindow {
                        id,
                        label: parts.get(1).unwrap_or(&"").to_string(),
                        title: parts.get(1).unwrap_or(&"").to_string(),
                        model: parts.get(2).unwrap_or(&"").to_string(),
                    });
                }
            }
        }
    }

    windows
}
```

### File: `src/parser/sections/processes.rs`

```rust
use crate::models::ProcessInfo;

pub fn parse_quiescent_processes(content: &str) -> Vec<ProcessInfo> {
    parse_process_list(content)
}

pub fn parse_suspended_processes(content: &str) -> Vec<ProcessInfo> {
    parse_process_list(content)
}

fn parse_process_list(content: &str) -> Vec<ProcessInfo> {
    let mut processes = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Parse process entry: 'Name' priority #hash
        // Or: Name priority hash
        let (name, rest) = if line.starts_with('\'') {
            // Quoted name
            if let Some(end_quote) = line[1..].find('\'') {
                let name = line[1..end_quote + 1].to_string();
                let rest = &line[end_quote + 2..];
                (name, rest.trim())
            } else {
                (line.to_string(), "")
            }
        } else {
            // Unquoted - first word is name
            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            (
                parts.first().unwrap_or(&"").to_string(),
                parts.get(1).unwrap_or(&"").trim()
            )
        };

        if name.is_empty() {
            continue;
        }

        // Parse remaining parts: priority and hash
        let parts: Vec<&str> = rest.split_whitespace().collect();
        let priority = parts.first()
            .filter(|s| !s.starts_with('#'))
            .map(|s| s.to_string());
        
        let hash = parts.iter()
            .find(|s| s.starts_with('#'))
            .map(|s| s.to_string());

        processes.push(ProcessInfo {
            name,
            priority,
            hash,
            state: None,
        });
    }

    processes
}
```

### File: `src/parser/sections/database.rs`

```rust
use crate::models::{DbConnection, DbSession};
use crate::parser::patterns::*;

pub fn parse_db_connections(content: &str) -> Vec<DbConnection> {
    let mut connections = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Try structured pattern: #hash state (user@env)
        if let Some(caps) = DB_CONNECTION.captures(line) {
            let hash = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let state = caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
            let username = caps.get(3).map(|m| m.as_str().to_string());
            let environment = caps.get(4).map(|m| m.as_str().to_string());
            
            let has_transaction = state.to_lowercase().contains("xactyes") ||
                                   TRANSACTION_STATE.captures(&state)
                                       .map(|c| c.get(1).map(|m| m.as_str()) == Some("Yes"))
                                       .unwrap_or(false);

            connections.push(DbConnection {
                hash,
                state,
                username,
                environment,
                has_transaction,
            });
        } else {
            // Fallback: space-separated parsing
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let hash = parts[0].to_string();
                let state = parts.get(1).unwrap_or(&"").to_string();
                let has_transaction = state.to_lowercase().contains("xactyes");

                connections.push(DbConnection {
                    hash,
                    state,
                    username: None,
                    environment: None,
                    has_transaction,
                });
            }
        }
    }

    connections
}

pub fn parse_db_sessions(content: &str) -> Vec<DbSession> {
    let mut sessions = Vec::new();
    let mut current_session: Option<DbSession> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            if let Some(session) = current_session.take() {
                sessions.push(session);
            }
            continue;
        }

        // Check for hash at start (new session)
        if line.starts_with('#') || line.starts_with("0x") {
            if let Some(session) = current_session.take() {
                sessions.push(session);
            }

            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            current_session = Some(DbSession {
                hash: parts[0].to_string(),
                state: parts.get(1).unwrap_or(&"").to_string(),
                query: None,
                prepared_statement: None,
            });
        } else if let Some(ref mut session) = current_session {
            // Look for SQL query
            if line.to_uppercase().starts_with("SELECT") ||
               line.to_uppercase().starts_with("INSERT") ||
               line.to_uppercase().starts_with("UPDATE") ||
               line.to_uppercase().starts_with("DELETE") {
                session.query = Some(line.to_string());
            }

            // Look for prepared statement name
            if let Some(caps) = PREPARED_STATEMENT.captures(line) {
                session.prepared_statement = caps.get(1).map(|m| m.as_str().to_string());
            }

            // Append to query if it looks like continuation
            if session.query.is_some() && !line.contains(':') {
                if let Some(ref mut query) = session.query {
                    query.push(' ');
                    query.push_str(line);
                }
            }
        }
    }

    // Don't forget the last session
    if let Some(session) = current_session {
        sessions.push(session);
    }

    sessions
}
```

### File: `src/parser/sections/memory.rs`

```rust
use crate::models::{MemoryReport, MemorySpace};
use crate::parser::patterns::*;

pub fn parse_memory(content: &str) -> MemoryReport {
    let mut report = MemoryReport::default();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Parse memory space line
        if let Some(caps) = MEMORY_SPACE.captures(line) {
            let name = caps.get(1).map(|m| m.as_str().to_lowercase()).unwrap_or_default();
            let size_str = caps.get(2).map(|m| m.as_str()).unwrap_or("0");
            let unit = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let percent: f32 = caps.get(4)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0.0);

            let size_display = format!("{}{}", size_str.replace(',', ""), unit);
            let size_bytes = parse_size_to_bytes(size_str, unit);

            let space = MemorySpace {
                name: name.clone(),
                size_bytes,
                size_display,
                percent_used: percent,
            };

            match name.as_str() {
                "eden" => report.eden = Some(space),
                "survivor" => report.survivor = Some(space),
                "old" => report.old = Some(space),
                "large" => report.large = Some(space),
                "perm" | "permanent" => report.perm = Some(space),
                _ => {}
            }
        }

        // Parse total/limit lines
        if line.to_lowercase().contains("total") {
            if let Some(caps) = MEMORY_LIMIT.captures(line) {
                report.total_used = caps.get(1).map(|m| m.as_str().to_string());
            } else {
                // Try simple extraction
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 2 {
                    report.total_used = Some(parts[1].trim().to_string());
                }
            }
        }

        if line.to_lowercase().contains("config") && line.to_lowercase().contains("limit") {
            if let Some(caps) = MEMORY_LIMIT.captures(line) {
                report.config_limit = caps.get(1).map(|m| m.as_str().to_string());
            }
        }

        if line.to_lowercase().contains("growth") && line.to_lowercase().contains("limit") {
            if let Some(caps) = MEMORY_LIMIT.captures(line) {
                report.growth_limit = caps.get(1).map(|m| m.as_str().to_string());
            }
        }
    }

    report
}

fn parse_size_to_bytes(size_str: &str, unit: &str) -> Option<u64> {
    let size: u64 = size_str.replace(',', "").parse().ok()?;
    
    let multiplier = match unit.to_uppercase().as_str() {
        "K" | "KB" => 1024,
        "M" | "MB" => 1024 * 1024,
        "G" | "GB" => 1024 * 1024 * 1024,
        "B" | "" => 1,
        _ => 1,
    };

    Some(size * multiplier)
}
```

---

## TASK 5: Main Parser Implementation

### File: `src/parser/crash_file.rs`

```rust
use std::path::Path;
use std::collections::HashMap;
use tokio::fs;

use crate::models::*;
use crate::parser::error::{ParseError, ParseResult};
use crate::parser::patterns::{detect_section, KNOWN_SECTIONS};
use crate::parser::sections::*;

/// Main crash file parser
pub struct CrashFileParser {
    /// Whether to preserve raw walkback text
    preserve_walkback: bool,
}

impl Default for CrashFileParser {
    fn default() -> Self {
        Self::new()
    }
}

impl CrashFileParser {
    pub fn new() -> Self {
        Self {
            preserve_walkback: true,
        }
    }

    pub fn with_walkback(mut self, preserve: bool) -> Self {
        self.preserve_walkback = preserve;
        self
    }

    /// Parse a crash file from disk
    pub async fn parse_file(&self, path: &Path) -> ParseResult<CrashFile> {
        let content = fs::read_to_string(path).await?;
        let file_name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        let metadata = fs::metadata(path).await?;
        
        self.parse_content(&content, &file_name, metadata.len())
    }

    /// Parse crash file content directly
    pub fn parse_content(&self, content: &str, file_name: &str, file_size: u64) -> ParseResult<CrashFile> {
        if content.trim().is_empty() {
            return Err(ParseError::EmptyFile);
        }

        // Split content into sections
        let sections = self.split_sections(content);

        // Parse header from beginning of file
        let header = parse_header(content, file_name, file_size);

        // Parse each section
        let environment = sections.get("environment")
            .map(|s| parse_environment(s))
            .unwrap_or_default();

        let exception = sections.get("exception")
            .map(|s| parse_exception(s))
            .ok_or_else(|| ParseError::MissingSection("Exception".to_string()))?;

        let stack_trace = sections.get("stack_trace")
            .map(|s| parse_stack_trace(s))
            .unwrap_or_default();

        let context = sections.get("context")
            .map(|s| parse_context(s));

        let windows = sections.get("windows")
            .map(|s| parse_windows(s))
            .unwrap_or_default();

        let quiescent = sections.get("quiescent")
            .map(|s| parse_quiescent_processes(s))
            .unwrap_or_default();

        let suspended = sections.get("suspended")
            .map(|s| parse_suspended_processes(s))
            .unwrap_or_default();

        let connections = sections.get("db_connections")
            .map(|s| parse_db_connections(s))
            .unwrap_or_default();

        let sessions = sections.get("db_sessions")
            .map(|s| parse_db_sessions(s))
            .unwrap_or_default();

        let has_active_transaction = connections.iter().any(|c| c.has_transaction);
        let active_transaction_count = connections.iter().filter(|c| c.has_transaction).count();

        let memory = sections.get("memory")
            .map(|s| parse_memory(s))
            .unwrap_or_default();

        let command_line = sections.get("command_line").cloned();

        let raw_walkback = if self.preserve_walkback {
            sections.get("walkback").cloned()
        } else {
            None
        };

        // Extract active process from stack trace context or dedicated section
        let active_process = sections.get("active_process")
            .and_then(|s| parse_active_process(s));

        Ok(CrashFile {
            header,
            environment,
            exception,
            active_process,
            stack_trace,
            context,
            windows,
            processes: ProcessLists { quiescent, suspended },
            database: DatabaseState {
                connections,
                sessions,
                has_active_transaction,
                active_transaction_count,
            },
            memory,
            command_line,
            raw_walkback,
        })
    }

    /// Split the file into named sections
    fn split_sections(&self, content: &str) -> HashMap<String, String> {
        let mut sections: HashMap<String, String> = HashMap::new();
        let mut current_section = String::new();
        let mut current_content = String::new();

        for line in content.lines() {
            // Check if this line starts a new section
            if let Some(section_name) = detect_section(line) {
                // Save previous section
                if !current_section.is_empty() && !current_content.is_empty() {
                    let key = self.normalize_section_name(&current_section);
                    sections.insert(key, current_content.trim().to_string());
                }
                current_section = section_name.to_string();
                current_content.clear();
            } else {
                current_content.push_str(line);
                current_content.push('\n');
            }
        }

        // Don't forget the last section
        if !current_section.is_empty() && !current_content.is_empty() {
            let key = self.normalize_section_name(&current_section);
            sections.insert(key, current_content.trim().to_string());
        }

        // Also try to extract sections if no clear headers found
        if sections.is_empty() || !sections.contains_key("exception") {
            self.extract_sections_heuristically(content, &mut sections);
        }

        sections
    }

    fn normalize_section_name(&self, name: &str) -> String {
        let lower = name.to_lowercase();
        
        if lower.contains("exception") {
            return "exception".to_string();
        }
        if lower.contains("environment") || lower.contains("system info") {
            return "environment".to_string();
        }
        if lower.contains("stack") && !lower.contains("context") {
            return "stack_trace".to_string();
        }
        if lower.contains("context") || lower.contains("argument") {
            return "context".to_string();
        }
        if lower.contains("window") {
            return "windows".to_string();
        }
        if lower.contains("quiescent") {
            return "quiescent".to_string();
        }
        if lower.contains("suspended") {
            return "suspended".to_string();
        }
        if lower.contains("database") && lower.contains("connection") {
            return "db_connections".to_string();
        }
        if lower.contains("database") && lower.contains("session") {
            return "db_sessions".to_string();
        }
        if lower.contains("memory") {
            return "memory".to_string();
        }
        if lower.contains("command") {
            return "command_line".to_string();
        }
        if lower.contains("walkback") {
            return "walkback".to_string();
        }
        if lower.contains("active process") {
            return "active_process".to_string();
        }

        lower.replace(' ', "_")
    }

    /// Fallback: try to find sections without clear headers
    fn extract_sections_heuristically(&self, content: &str, sections: &mut HashMap<String, String>) {
        // Look for exception pattern anywhere
        if !sections.contains_key("exception") {
            for line in content.lines() {
                if line.contains("Unhandled exception") || 
                   line.contains("Exception Class") ||
                   line.contains("Error:") {
                    // Take this line and following context
                    let idx = content.find(line).unwrap_or(0);
                    let exception_content: String = content[idx..]
                        .lines()
                        .take(10)
                        .collect::<Vec<_>>()
                        .join("\n");
                    sections.insert("exception".to_string(), exception_content);
                    break;
                }
            }
        }

        // Look for stack trace pattern (numbered frames)
        if !sections.contains_key("stack_trace") {
            let mut stack_lines = Vec::new();
            for line in content.lines() {
                if line.trim().starts_with('[') && line.contains(']') {
                    stack_lines.push(line);
                }
            }
            if !stack_lines.is_empty() {
                sections.insert("stack_trace".to_string(), stack_lines.join("\n"));
            }
        }
    }
}

fn parse_active_process(content: &str) -> Option<ActiveProcess> {
    let mut name = None;
    let mut priority = None;
    let mut hash = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // First non-empty line is usually the process name
        if name.is_none() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            name = Some(parts[0].trim_matches('\'').to_string());
            priority = parts.get(1).map(|s| s.to_string());
            hash = parts.iter().find(|s| s.starts_with('#')).map(|s| s.to_string());
            break;
        }
    }

    name.map(|n| ActiveProcess {
        name: n,
        priority,
        hash,
    })
}
```

### File: `src/parser/mod.rs`

```rust
mod crash_file;
mod error;
mod patterns;
mod sections;

pub use crash_file::CrashFileParser;
pub use error::{ParseError, ParseResult};
pub use patterns::*;
```

---

## TASK 6: Integration and Testing

### File: `src/lib.rs`

Add to your library root:
```rust
pub mod models;
pub mod parser;

pub use models::*;
pub use parser::CrashFileParser;
```

### File: `tests/parser_tests.rs`

Create integration tests:
```rust
use whatson_crash_analyzer::parser::CrashFileParser;
use std::path::Path;

#[tokio::test]
async fn test_parse_sample_crash() {
    let parser = CrashFileParser::new();
    
    // Use a sample crash file for testing
    let sample_path = Path::new("tests/fixtures/sample_crash.txt");
    if sample_path.exists() {
        let result = parser.parse_file(sample_path).await;
        assert!(result.is_ok(), "Failed to parse: {:?}", result.err());
        
        let crash = result.unwrap();
        assert!(!crash.exception.exception_type.is_empty());
        assert!(!crash.stack_trace.is_empty());
    }
}

#[test]
fn test_parse_minimal_crash() {
    let parser = CrashFileParser::new();
    let content = r#"
Unhandled exception: SubscriptOutOfBoundsError
messageText: '3'

Stack Trace:
[1] OrderedCollection>>at:
[2] MediaGeniX.PSITxBlock>>someMethod:
[3] Object>>perform:
"#;

    let result = parser.parse_content(content, "test.txt", content.len() as u64);
    assert!(result.is_ok());
    
    let crash = result.unwrap();
    assert_eq!(crash.exception.exception_type, "SubscriptOutOfBoundsError");
    assert_eq!(crash.stack_trace.len(), 3);
}

#[test]
fn test_frame_classification() {
    let parser = CrashFileParser::new();
    let content = r#"
Unhandled exception: Error

Stack Trace:
[1] Error>>signal
[2] MediaGeniX.PSITxBlock>>crash
[3] OrderedCollection>>do:
[4] EXDI.OracleSession>>execute
"#;

    let crash = parser.parse_content(content, "test.txt", content.len() as u64).unwrap();
    
    use whatson_crash_analyzer::models::FrameType;
    assert_eq!(crash.stack_trace[0].frame_type, FrameType::Error);
    assert_eq!(crash.stack_trace[1].frame_type, FrameType::Application);
    assert_eq!(crash.stack_trace[2].frame_type, FrameType::Framework);
    assert_eq!(crash.stack_trace[3].frame_type, FrameType::Database);
}
```

---

## TASK 7: Tauri Command Integration

### File: `src/commands/parser_commands.rs`

```rust
use crate::parser::CrashFileParser;
use crate::models::CrashFile;
use std::path::Path;

#[tauri::command]
pub async fn parse_crash_file(path: String) -> Result<CrashFile, String> {
    let parser = CrashFileParser::new();
    parser.parse_file(Path::new(&path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn parse_crash_content(content: String, file_name: String) -> Result<CrashFile, String> {
    let parser = CrashFileParser::new();
    parser.parse_content(&content, &file_name, content.len() as u64)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn parse_crash_files_batch(paths: Vec<String>) -> Result<Vec<(String, Result<CrashFile, String>)>, String> {
    let parser = CrashFileParser::new();
    let mut results = Vec::new();
    
    for path in paths {
        let result = parser.parse_file(Path::new(&path))
            .await
            .map_err(|e| e.to_string());
        results.push((path, result));
    }
    
    Ok(results)
}
```

---

## Verification Checklist

After implementing, verify:

- [ ] `cargo build` succeeds without errors
- [ ] `cargo test` passes all tests
- [ ] Parser handles empty files gracefully
- [ ] Parser handles malformed files without panicking
- [ ] Stack frames are correctly classified by type
- [ ] Environment fields are extracted correctly
- [ ] Context arguments capture business objects
- [ ] Database state detects active transactions
- [ ] Memory report parses all 5 spaces

---

## Notes for Claude Code

1. **File creation order matters** - Create models first, then patterns, then section parsers, then main parser
2. **Test incrementally** - Run `cargo check` after each major file
3. **Handle edge cases** - WCR files can be incomplete or corrupted
4. **Preserve raw text** - Keep walkback for AI analysis later
5. **Be defensive** - Use `Option` liberally, never panic on bad input
