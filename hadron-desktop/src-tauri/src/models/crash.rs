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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
#[derive(Default)]
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
    #[default]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
