//! Reciprocal Rank Fusion (RRF)
//!
//! Generic implementation that merges multiple ranked result lists into a
//! single fused ranking. Used by both analysis search and KB search.

use std::collections::HashMap;
use std::hash::Hash;

use crate::database::Analysis;

/// Standard RRF constant. Higher values give less weight to rank position.
const K: f64 = 60.0;

/// Generic reciprocal rank fusion over arbitrary result lists.
///
/// - `result_lists`: Multiple ranked lists to fuse.
/// - `id_fn`: Extracts a hashable identity from each item (for dedup/fusion).
/// - `k`: RRF smoothing constant (default 60).
///
/// Returns items sorted by descending fused score, paired with their score.
pub fn reciprocal_rank_fusion<T, I, F>(
    result_lists: Vec<Vec<T>>,
    id_fn: F,
    k: Option<f64>,
) -> Vec<(T, f64)>
where
    T: Clone,
    I: Hash + Eq,
    F: Fn(&T) -> I,
{
    let k = k.unwrap_or(K);
    let mut scores: HashMap<usize, f64> = HashMap::new();
    let mut items: Vec<T> = Vec::new();
    let mut id_to_index: HashMap<I, usize> = HashMap::new();

    for results in &result_lists {
        for (rank, item) in results.iter().enumerate() {
            let id = id_fn(item);
            let rrf_score = 1.0 / (k + rank as f64 + 1.0);

            let idx = if let Some(&existing_idx) = id_to_index.get(&id) {
                existing_idx
            } else {
                let idx = items.len();
                items.push(item.clone());
                id_to_index.insert(id, idx);
                idx
            };

            *scores.entry(idx).or_insert(0.0) += rrf_score;
        }
    }

    let mut scored: Vec<(usize, f64)> = scores.into_iter().collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    scored
        .into_iter()
        .map(|(idx, score)| (items[idx].clone(), score))
        .collect()
}

/// Backward-compatible wrapper: fuse multiple `Vec<Analysis>` lists using
/// analysis ID as the identity key. Returns analyses sorted by RRF score.
pub fn rrf_analyses(result_lists: Vec<Vec<Analysis>>) -> Vec<Analysis> {
    reciprocal_rank_fusion(result_lists, |a: &Analysis| a.id, None)
        .into_iter()
        .map(|(a, _)| a)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rrf_basic_fusion() {
        // Simple test with integer IDs
        let list_a = vec![10, 20, 30];
        let list_b = vec![20, 30, 40];

        let fused = reciprocal_rank_fusion(vec![list_a, list_b], |x: &i32| *x, None);

        // Item 20 appears at rank 1 in list_a and rank 0 in list_b -> highest combined score
        assert_eq!(fused[0].0, 20);
        // Item 30 appears at rank 2 in list_a and rank 1 in list_b
        assert_eq!(fused[1].0, 30);
        assert_eq!(fused.len(), 4);
    }

    #[test]
    fn test_rrf_single_list() {
        let list = vec![1, 2, 3];
        let fused = reciprocal_rank_fusion(vec![list], |x: &i32| *x, None);
        assert_eq!(fused.len(), 3);
        assert_eq!(fused[0].0, 1);
    }

    #[test]
    fn test_rrf_empty() {
        let fused: Vec<(i32, f64)> =
            reciprocal_rank_fusion(Vec::new(), |x: &i32| *x, None);
        assert!(fused.is_empty());
    }
}
