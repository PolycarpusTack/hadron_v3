//! Retrieval Pipeline
//!
//! Rust-native retrieval infrastructure for Ask Hadron:
//! hybrid search (vector + lexical), reranking, evidence gating,
//! citation enforcement, and evaluation.

pub mod cache;
#[allow(dead_code)]
pub mod citation;
pub mod eval;
pub mod evidence_gate;
pub mod hybrid_analysis;
pub mod hybrid_kb;
pub mod opensearch;
pub mod query_planner;
pub mod rrf;

use serde::{Deserialize, Serialize};

// ============================================================================
// Core Types
// ============================================================================

/// Source system that produced a search result.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ResultSource {
    /// FTS5 full-text search over local analyses
    AnalysisFts,
    /// Vector similarity search over analyses (future)
    AnalysisVector,
    /// OpenSearch KNN vector search over KB docs
    KbVector,
    /// OpenSearch text/BM25 search over KB docs
    KbLexical,
    /// Release notes from OpenSearch
    ReleaseNote,
    /// JIRA ticket search
    Jira,
}

/// A single scored search result, unified across all retrieval sources.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ScoredResult {
    /// Unique identifier (analysis ID, document ID, JIRA key, etc.)
    pub id: String,
    /// Which retrieval source produced this result
    pub source: ResultSource,
    /// The textual content returned to the LLM
    pub content: String,
    /// Relevance score (higher = more relevant). Comparable only within
    /// a single retrieval pipeline run after RRF normalization.
    pub score: f64,
    /// Arbitrary metadata for display/diagnostics
    pub metadata: serde_json::Value,
}

/// Options controlling a retrieval request across all sources.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RetrievalOptions {
    /// The user's search query (possibly rewritten)
    pub query: String,
    /// Maximum results to return after fusion + reranking
    pub top_k: usize,
    // --- Filters (all optional) ---
    /// ISO-8601 date string, inclusive lower bound
    pub date_from: Option<String>,
    /// ISO-8601 date string, inclusive upper bound
    pub date_to: Option<String>,
    /// Filter to specific analysis types (e.g. ["NilReceiver", "Deadlock"])
    pub analysis_types: Option<Vec<String>>,
    /// Filter by severity level
    pub severity: Option<String>,
    /// Filter by component name
    pub component: Option<String>,
    /// WHATS'ON version for KB scoping
    pub won_version: Option<String>,
    /// Customer identifier for customer-specific release notes
    pub customer: Option<String>,
}
