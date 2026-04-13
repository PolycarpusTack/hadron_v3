use std::collections::HashMap;
use super::types::SearchHit;

pub fn reciprocal_rank_fusion(result_lists: Vec<Vec<SearchHit>>, k: usize) -> Vec<SearchHit> {
    let mut scores: HashMap<String, (f64, SearchHit)> = HashMap::new();
    for list in &result_lists {
        for (rank, hit) in list.iter().enumerate() {
            let rrf_score = 1.0 / (k as f64 + rank as f64 + 1.0);
            let entry = scores.entry(hit.id.clone()).or_insert((0.0, hit.clone()));
            entry.0 += rrf_score;
        }
    }
    let mut results: Vec<SearchHit> = scores
        .into_values()
        .map(|(score, mut hit)| {
            hit.score = score;
            hit
        })
        .collect();
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::retrieval::types::SearchSource;
    use std::collections::HashMap;

    fn make_hit(id: &str, score: f64) -> SearchHit {
        SearchHit {
            id: id.to_string(),
            title: format!("Title {}", id),
            content: format!("Content {}", id),
            score,
            source: SearchSource::PgVector,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn single_list_identity() {
        let list = vec![make_hit("a", 1.0), make_hit("b", 0.8), make_hit("c", 0.6)];
        let result = reciprocal_rank_fusion(vec![list], 60);
        assert_eq!(result.len(), 3);
        // First item should be rank 0 → highest RRF score
        assert_eq!(result[0].id, "a");
        assert_eq!(result[1].id, "b");
        assert_eq!(result[2].id, "c");
    }

    #[test]
    fn two_lists_merge() {
        let list1 = vec![make_hit("a", 1.0), make_hit("b", 0.8)];
        let list2 = vec![make_hit("c", 0.9), make_hit("d", 0.7)];
        let result = reciprocal_rank_fusion(vec![list1, list2], 60);
        assert_eq!(result.len(), 4);
        // All four distinct IDs should be present
        let ids: Vec<&str> = result.iter().map(|h| h.id.as_str()).collect();
        assert!(ids.contains(&"a"));
        assert!(ids.contains(&"b"));
        assert!(ids.contains(&"c"));
        assert!(ids.contains(&"d"));
    }

    #[test]
    fn overlapping_results_get_boosted_score() {
        let list1 = vec![make_hit("a", 1.0), make_hit("b", 0.8)];
        let list2 = vec![make_hit("a", 0.9), make_hit("c", 0.7)];
        let result = reciprocal_rank_fusion(vec![list1, list2], 60);
        // "a" appears in both lists at rank 0, so it gets two RRF contributions
        let a = result.iter().find(|h| h.id == "a").unwrap();
        let b = result.iter().find(|h| h.id == "b").unwrap();
        let c = result.iter().find(|h| h.id == "c").unwrap();
        // "a" score = 1/61 + 1/61 = 2/61 ≈ 0.0328
        // "b" score = 1/62 ≈ 0.0161
        // "c" score = 1/62 ≈ 0.0161
        assert!(a.score > b.score, "overlapping 'a' should outscore non-overlapping 'b'");
        assert!(a.score > c.score, "overlapping 'a' should outscore non-overlapping 'c'");
    }
}
