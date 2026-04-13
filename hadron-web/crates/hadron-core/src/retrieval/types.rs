use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub content: String,
    pub score: f64,
    pub source: SearchSource,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SearchSource {
    PgVector,
    PostgresFts,
    OpenSearchKnn,
    OpenSearchText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerIndices {
    pub kb_index: String,
    pub rn_index: Option<String>,
}

#[derive(Debug, Clone)]
pub struct EvidenceGateConfig {
    pub min_score: f64,
    pub gold_boost: f64,
}

impl Default for EvidenceGateConfig {
    fn default() -> Self {
        Self { min_score: 0.01, gold_boost: 0.3 }
    }
}
