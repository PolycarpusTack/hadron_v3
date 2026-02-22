#![allow(dead_code)]
use once_cell::sync::Lazy;
use regex::Regex;

// === Section Boundary Patterns ===

/// Matches section headers like "Smalltalk Exception Information:"
pub static SECTION_HEADER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^([A-Z][A-Za-z\s]+):\s*$").expect("SECTION_HEADER"));

/// Dump completion status
pub static DUMP_STATUS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Dump (completed|incomplete|aborted)").expect("DUMP_STATUS"));

// === Environment Patterns ===

/// Key: Value pattern (with possible multiline values)
pub static KEY_VALUE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^([A-Za-z][A-Za-z0-9\s_-]*?):\s*(.*)$").expect("KEY_VALUE"));

/// Site name pattern: "Site: SITENAME"
pub static SITE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Site:\s*(\S+)").expect("SITE"));

/// Version pattern: "WHATS'ON version 2024r3.000.064"
pub static VERSION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"WHATS'ON version\s+(\S+)").expect("VERSION"));

/// Build pattern: "build 2024r3.000.064.8"
pub static BUILD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"build\s+(\S+)").expect("BUILD"));

/// Smalltalk version pattern
pub static SMALLTALK_VERSION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"VisualWorks[®]?,?\s*(?:Version\s+)?(\d+\.?\d*)").expect("SMALLTALK_VERSION"));

/// Oracle server version
pub static ORACLE_SERVER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Database Server Version:\s*(.+)").expect("ORACLE_SERVER"));

/// Oracle client version
pub static ORACLE_CLIENT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Database Client Version:\s*(.+)").expect("ORACLE_CLIENT"));

// === Exception Patterns ===

/// Exception class pattern
pub static EXCEPTION_CLASS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^Unhandled exception:\s*(.+)$").expect("EXCEPTION_CLASS"));

/// Alternative: "Exception Class: ..."
pub static EXCEPTION_CLASS_ALT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Exception Class:\s*(.+)").expect("EXCEPTION_CLASS_ALT"));

/// Exception message/parameter
pub static EXCEPTION_MESSAGE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:messageText|errorString|parameter):\s*'?(.+?)'?\s*$").expect("EXCEPTION_MESSAGE"));

/// Signal name
pub static SIGNAL_NAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Signal:\s*(\S+)").expect("SIGNAL_NAME"));

// === Stack Trace Patterns ===

/// Stack frame: "[1] ClassName>>methodName" or "[1] optimized [] in ..."
pub static STACK_FRAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\[(\d+)\]\s+(.+)$").expect("STACK_FRAME"));

/// Method signature breakdown: "Namespace.Class(Parent)>>method:"
pub static METHOD_SIGNATURE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(?:optimized\s+)?(?:\[\]\s+in\s+)*(?:([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.)?([A-Za-z_]\w*)(?:\(([A-Za-z_]\w*)\))?>>([^\s]+)").expect("METHOD_SIGNATURE"));

// === Context Patterns ===

/// Receiver line: "Receiver: anOrderedCollection ..."
pub static RECEIVER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^Receiver:\s*(?:an?\s*)?(\w+)").expect("RECEIVER"));

/// Collection info: "firstIndex = 1, lastIndex = 5"
pub static COLLECTION_INFO: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"firstIndex\s*=\s*(\d+).*lastIndex\s*=\s*(\d+)").expect("COLLECTION_INFO"));

/// Argument line: "argName = value" or "argName: value"
pub static ARGUMENT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(\w+)\s*[=:]\s*(.+)$").expect("ARGUMENT"));

/// OID extraction: "oid = 12345" or "(oid: 12345)"
pub static OID: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"oid\s*[=:]\s*(\d+)").expect("OID"));

// === Window Patterns ===

/// Window entry: "1: 'Window Title' PLModelClass"
pub static WINDOW_ENTRY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"^(\d+):\s*(?:'([^']*)'|"([^"]*)")\s+(\S+)"#).expect("WINDOW_ENTRY"));

// === Process Patterns ===

/// Process entry: "ProcessName priority hash"
pub static PROCESS_ENTRY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^'?([^']+)'?\s+(\w+)?\s*(#[\da-fA-F]+)?").expect("PROCESS_ENTRY"));

// === Database Patterns ===

/// Connection entry: "hash state (username@env)"
pub static DB_CONNECTION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(#[\da-fA-F]+)\s+(\w+)\s+\((\w+)@(\w+)\)").expect("DB_CONNECTION"));

/// Transaction state: "xactYes" or "xactNo"
pub static TRANSACTION_STATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"xact(Yes|No)").expect("TRANSACTION_STATE"));

/// Prepared statement: "prepared statement 'name'"
pub static PREPARED_STATEMENT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"prepared statement\s+['"]([\w\d]+)['"]"#).expect("PREPARED_STATEMENT"));

// === Memory Patterns ===

/// Memory space: "Eden: 1234K (45%)"
pub static MEMORY_SPACE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(\w+):\s*([\d,]+)\s*([KMG]?B?)?\s*\((\d+(?:\.\d+)?)\s*%\)").expect("MEMORY_SPACE"));

/// Memory limit: "limit = 1024M"
pub static MEMORY_LIMIT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"limit\s*=\s*([\d,]+\s*[KMG]?B?)").expect("MEMORY_LIMIT"));

// === Business Object Patterns (WHATS'ON Specific) ===

/// MediaGeniX class detection
pub static MEDIAGENIIX_CLASS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"MediaGeniX\.(\w+)").expect("MEDIAGENIIX_CLASS"));

/// TxBlock pattern
pub static TXBLOCK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"PSITxBlock\w*").expect("TXBLOCK"));

/// TimeAllocation pattern
pub static TIME_ALLOCATION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:BM)?TimeAllocation").expect("TIME_ALLOCATION"));

/// Channel pattern
pub static CHANNEL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"channel\s*[=:]\s*'?([^'\n]+)'?").expect("CHANNEL"));

/// Date pattern in context
pub static SCHEDULE_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"date\s*[=:]\s*'?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})'?").expect("SCHEDULE_DATE"));

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
    KNOWN_SECTIONS
        .iter()
        .find(|&&s| trimmed.eq_ignore_ascii_case(s) || trimmed.contains(s))
        .copied()
}
