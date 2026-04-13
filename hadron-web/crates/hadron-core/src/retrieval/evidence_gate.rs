use super::types::{EvidenceGateConfig, SearchHit};

pub fn apply_evidence_gate(mut results: Vec<SearchHit>, config: &EvidenceGateConfig) -> Vec<SearchHit> {
    for hit in &mut results {
        if hit.metadata.get("is_gold").map(|v| v == "true").unwrap_or(false) {
            hit.score += config.gold_boost;
        }
    }
    results.retain(|h| h.score >= config.min_score);
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

    fn make_gold_hit(id: &str, score: f64) -> SearchHit {
        let mut hit = make_hit(id, score);
        hit.metadata.insert("is_gold".to_string(), "true".to_string());
        hit
    }

    #[test]
    fn filters_low_scores() {
        let config = EvidenceGateConfig { min_score: 0.5, gold_boost: 0.3 };
        let results = vec![
            make_hit("keep", 0.8),
            make_hit("boundary", 0.5),
            make_hit("drop", 0.3),
            make_hit("also_drop", 0.01),
        ];
        let filtered = apply_evidence_gate(results, &config);
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().all(|h| h.score >= 0.5));
        assert!(filtered.iter().any(|h| h.id == "keep"));
        assert!(filtered.iter().any(|h| h.id == "boundary"));
    }

    #[test]
    fn gold_boost_raises_score() {
        let config = EvidenceGateConfig { min_score: 0.01, gold_boost: 0.3 };
        let base_score = 0.5;
        let gold = make_gold_hit("gold", base_score);
        let normal = make_hit("normal", base_score);
        let results = apply_evidence_gate(vec![gold, normal], &config);
        let gold_result = results.iter().find(|h| h.id == "gold").unwrap();
        let normal_result = results.iter().find(|h| h.id == "normal").unwrap();
        assert!((gold_result.score - (base_score + 0.3)).abs() < f64::EPSILON);
        assert!((normal_result.score - base_score).abs() < f64::EPSILON);
        // Gold should be sorted first
        assert_eq!(results[0].id, "gold");
    }

    #[test]
    fn gold_boost_can_rescue_near_threshold_hit() {
        let config = EvidenceGateConfig { min_score: 0.5, gold_boost: 0.3 };
        // Score 0.3 would normally be filtered, but gold boost brings it to 0.6
        let gold_low = make_gold_hit("rescued", 0.3);
        let normal_drop = make_hit("dropped", 0.3);
        let results = apply_evidence_gate(vec![gold_low, normal_drop], &config);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "rescued");
    }
}
