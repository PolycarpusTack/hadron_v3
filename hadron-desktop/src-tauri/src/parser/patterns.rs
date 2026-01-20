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
        r#"^(\d+):\s*(?:'([^']*)'|"([^"]*)")\s+(\S+)"#
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
    KNOWN_SECTIONS
        .iter()
        .find(|&&s| trimmed.eq_ignore_ascii_case(s) || trimmed.contains(s))
        .copied()
}
