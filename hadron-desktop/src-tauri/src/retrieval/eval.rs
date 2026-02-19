//! Retrieval Evaluation Harness
//!
//! Computes retrieval quality metrics (Precision@K, Recall@K, MRR, latency)
//! over a set of evaluation queries with known-relevant document IDs.

use serde::{Deserialize, Serialize};

/// A single evaluation query with expected relevant document IDs.
#[derive(Debug, Clone, Deserialize)]
pub struct EvalQuery {
    /// The query text
    pub query: String,
    /// Document IDs that are known to be relevant for this query
    pub relevant_ids: Vec<String>,
    /// Optional label for display purposes
    pub label: Option<String>,
}

/// Result of evaluating a single query.
#[derive(Debug, Clone, Serialize)]
pub struct EvalResult {
    pub query: String,
    pub label: Option<String>,
    /// IDs retrieved by the system (in order)
    pub retrieved_ids: Vec<String>,
    /// Precision at K (fraction of top-K that are relevant)
    pub precision_at_k: f64,
    /// Recall at K (fraction of relevant docs found in top-K)
    pub recall_at_k: f64,
    /// Mean Reciprocal Rank (1/rank of first relevant result, 0 if none found)
    pub mrr: f64,
    /// Retrieval latency in milliseconds
    pub latency_ms: u64,
}

/// Summary statistics across all evaluation queries.
#[derive(Debug, Clone, Serialize)]
pub struct EvalSummary {
    pub total_queries: usize,
    pub avg_precision_at_k: f64,
    pub avg_recall_at_k: f64,
    pub avg_mrr: f64,
    pub avg_latency_ms: f64,
    pub results: Vec<EvalResult>,
}

/// Compute metrics for a single query given retrieved and relevant IDs.
pub fn compute_metrics(
    query: &str,
    label: Option<&str>,
    retrieved_ids: &[String],
    relevant_ids: &[String],
    latency_ms: u64,
    k: usize,
) -> EvalResult {
    let top_k: Vec<&String> = retrieved_ids.iter().take(k).collect();

    // Precision@K: how many of the top-K are relevant
    let relevant_in_top_k = top_k
        .iter()
        .filter(|id| relevant_ids.contains(id))
        .count();
    let precision_at_k = if top_k.is_empty() {
        0.0
    } else {
        relevant_in_top_k as f64 / top_k.len() as f64
    };

    // Recall@K: how many of the relevant docs are in top-K
    let recall_at_k = if relevant_ids.is_empty() {
        1.0 // vacuously true
    } else {
        relevant_in_top_k as f64 / relevant_ids.len() as f64
    };

    // MRR: 1/rank of first relevant result
    let mrr = top_k
        .iter()
        .position(|id| relevant_ids.contains(id))
        .map(|pos| 1.0 / (pos as f64 + 1.0))
        .unwrap_or(0.0);

    EvalResult {
        query: query.to_string(),
        label: label.map(|s| s.to_string()),
        retrieved_ids: retrieved_ids.to_vec(),
        precision_at_k,
        recall_at_k,
        mrr,
        latency_ms,
    }
}

/// Aggregate individual results into a summary.
pub fn summarize(results: Vec<EvalResult>) -> EvalSummary {
    let n = results.len();
    if n == 0 {
        return EvalSummary {
            total_queries: 0,
            avg_precision_at_k: 0.0,
            avg_recall_at_k: 0.0,
            avg_mrr: 0.0,
            avg_latency_ms: 0.0,
            results,
        };
    }

    let avg_precision = results.iter().map(|r| r.precision_at_k).sum::<f64>() / n as f64;
    let avg_recall = results.iter().map(|r| r.recall_at_k).sum::<f64>() / n as f64;
    let avg_mrr = results.iter().map(|r| r.mrr).sum::<f64>() / n as f64;
    let avg_latency = results.iter().map(|r| r.latency_ms as f64).sum::<f64>() / n as f64;

    EvalSummary {
        total_queries: n,
        avg_precision_at_k: avg_precision,
        avg_recall_at_k: avg_recall,
        avg_mrr: avg_mrr,
        avg_latency_ms: avg_latency,
        results,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_perfect_retrieval() {
        let result = compute_metrics(
            "test query",
            None,
            &["a".into(), "b".into(), "c".into()],
            &["a".into(), "b".into()],
            50,
            5,
        );
        assert!((result.precision_at_k - 2.0 / 3.0).abs() < 1e-9);
        assert!((result.recall_at_k - 1.0).abs() < 1e-9);
        assert!((result.mrr - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_no_relevant_found() {
        let result = compute_metrics(
            "test query",
            None,
            &["x".into(), "y".into()],
            &["a".into(), "b".into()],
            100,
            5,
        );
        assert!((result.precision_at_k).abs() < 1e-9);
        assert!((result.recall_at_k).abs() < 1e-9);
        assert!((result.mrr).abs() < 1e-9);
    }

    #[test]
    fn test_mrr_second_position() {
        let result = compute_metrics(
            "test query",
            None,
            &["x".into(), "a".into(), "y".into()],
            &["a".into()],
            75,
            5,
        );
        assert!((result.mrr - 0.5).abs() < 1e-9); // 1/2
    }

    #[test]
    fn test_summary() {
        let results = vec![
            compute_metrics("q1", None, &["a".into()], &["a".into()], 50, 5),
            compute_metrics("q2", None, &["x".into()], &["a".into()], 100, 5),
        ];
        let summary = summarize(results);
        assert_eq!(summary.total_queries, 2);
        assert!((summary.avg_precision_at_k - 0.5).abs() < 1e-9);
        assert!((summary.avg_latency_ms - 75.0).abs() < 1e-9);
    }
}
