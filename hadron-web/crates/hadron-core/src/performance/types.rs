use serde::{Deserialize, Serialize};

/// Performance trace header statistics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceHeader {
    pub samples: u64,
    pub avg_ms_per_sample: f64,
    pub scavenges: u64,
    pub inc_gcs: u64,
    pub stack_spills: u64,
    pub mark_stack_overflows: u64,
    pub weak_list_overflows: u64,
    pub jit_cache_spills: u64,
    pub active_time: f64,
    pub other_processes: f64,
    pub real_time: f64,
    pub profiling_overhead: f64,
}

/// Derived performance metrics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DerivedMetrics {
    pub cpu_utilization: f64,
    pub activity_ratio: f64,
    pub sample_density: f64,
    pub gc_pressure: f64,
}

/// Process info from performance trace
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub name: String,
    pub priority: String,
    pub percentage: f64,
    pub status: String,
}

/// Top method info
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TopMethod {
    pub method: String,
    pub category: String,
    pub percentage: f64,
}

/// Detected performance pattern
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPattern {
    pub pattern_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub confidence: f64,
}

/// User scenario reconstruction
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserScenario {
    pub trigger: String,
    pub action: String,
    pub context: String,
    pub impact_percentage: f64,
    pub contributing_factors: Vec<String>,
}

/// Performance recommendation
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub rec_type: String,
    pub title: String,
    pub priority: String,
    pub description: String,
    pub effort: String,
}

/// Full performance trace analysis result
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceTraceResult {
    pub filename: String,
    pub user: Option<String>,
    pub timestamp: Option<String>,
    pub header: PerformanceHeader,
    pub derived: DerivedMetrics,
    pub processes: Vec<ProcessInfo>,
    pub top_methods: Vec<TopMethod>,
    pub patterns: Vec<DetectedPattern>,
    pub scenario: UserScenario,
    pub recommendations: Vec<Recommendation>,
    pub overall_severity: String,
    pub summary: String,
}
