//! Hybrid Analysis Retrieval
//!
//! Improved analysis search with weighted BM25, FTS5 query sanitization,
//! date/type filters, multi-query expansion, and feedback boosting.

use std::collections::HashMap;
use std::sync::Arc;

use crate::ai_service::{call_provider_quick, ChatMessage};
use crate::database::{Analysis, Database};
use crate::str_utils::floor_char_boundary;
use crate::retrieval::rrf;
use crate::retrieval::RetrievalOptions;

// ============================================================================
// FTS5 Query Sanitization
// ============================================================================

/// Sanitize a user query for FTS5 MATCH syntax.
/// Escapes special characters and wraps individual tokens in quotes.
pub fn sanitize_fts5_query(query: &str) -> String {
    // Remove characters that are FTS5 operators/syntax
    let cleaned: String = query
        .chars()
        .map(|c| match c {
            '"' | '*' | '(' | ')' | '{' | '}' | '^' | '~' | ':' => ' ',
            _ => c,
        })
        .collect();

    // Split into tokens and wrap each in quotes to prevent syntax errors
    let tokens: Vec<String> = cleaned
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| {
            // FTS5 operators that should not be quoted
            let upper = t.to_uppercase();
            if upper == "AND" || upper == "OR" || upper == "NOT" || upper == "NEAR" {
                upper
            } else {
                format!("\"{}\"", t)
            }
        })
        .collect();

    if tokens.is_empty() {
        return String::new();
    }

    tokens.join(" ")
}

// ============================================================================
// Query Variant Generation
// ============================================================================

const VARIANT_SYSTEM_PROMPT: &str = r#"Generate 2 alternative search queries for finding relevant crash analyses and documentation. Be diverse in phrasing — use synonyms, rephrase, and vary specificity. Output ONLY a JSON array of 2 strings, nothing else. Example: ["query one", "query two"]"#;

async fn generate_query_variants(
    query: &str,
    provider: &str,
    api_key: &str,
    model: &str,
) -> Vec<String> {
    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: format!("Generate 2 search query variants for: \"{}\"", query),
    }];

    match call_provider_quick(provider, &messages, VARIANT_SYSTEM_PROMPT, api_key, model, 200).await
    {
        Ok(response) => {
            let response = response.trim();
            if let Ok(variants) = serde_json::from_str::<Vec<String>>(response) {
                log::info!(
                    "Generated {} query variants for: \"{}\"",
                    variants.len(),
                    &query[..floor_char_boundary(query, 50)]
                );
                return variants;
            }
            log::warn!("Failed to parse query variants as JSON, using original query only");
            Vec::new()
        }
        Err(e) => {
            log::warn!("Query variant generation failed: {}", e);
            Vec::new()
        }
    }
}

// ============================================================================
// Hybrid Search Orchestrator
// ============================================================================

/// Execute hybrid analysis search with weighted BM25, filters, query expansion,
/// RRF fusion, and feedback boosting.
pub async fn search(
    db: &Arc<Database>,
    options: &RetrievalOptions,
    provider: &str,
    api_key: &str,
    model: &str,
) -> Vec<Analysis> {
    let query = &options.query;
    if query.trim().is_empty() {
        return Vec::new();
    }

    // Generate query variants for multi-query retrieval
    let variants = generate_query_variants(query, provider, api_key, model).await;

    // Run original + variant queries in parallel
    let mut handles = Vec::new();

    // Original query with filters
    {
        let db = Arc::clone(db);
        let sanitized = sanitize_fts5_query(query);
        let opts = options.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            db.search_analyses_filtered(
                &sanitized,
                opts.severity.as_deref(),
                opts.date_from.as_deref(),
                opts.date_to.as_deref(),
                opts.analysis_types.as_deref(),
                100,
            )
        }));
    }

    // Variant queries (no date/type filters to widen net)
    for variant in &variants {
        let db = Arc::clone(db);
        let sanitized = sanitize_fts5_query(variant);
        let severity = options.severity.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            db.search_analyses_filtered(
                &sanitized,
                severity.as_deref(),
                None,
                None,
                None,
                50,
            )
        }));
    }

    // Collect results
    let mut result_lists = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(results)) => result_lists.push(results),
            Ok(Err(e)) => log::warn!("Search variant failed: {}", e),
            Err(e) => log::warn!("Search task error: {}", e),
        }
    }

    // Merge with RRF
    let mut results = if result_lists.len() > 1 {
        rrf::rrf_analyses(result_lists)
    } else {
        result_lists.into_iter().next().unwrap_or_default()
    };

    // Apply feedback-based boosting
    let ids: Vec<i64> = results.iter().map(|a| a.id).collect();
    let db_clone = Arc::clone(db);
    if let Ok(feedback_scores) = tokio::task::spawn_blocking(move || {
        db_clone.get_feedback_scores_for_analyses(&ids)
    })
    .await
    .unwrap_or_else(|_| Ok(HashMap::new()))
    {
        if !feedback_scores.is_empty() {
            let n = results.len() as f64;
            let mut scored: Vec<(Analysis, f64)> = results
                .into_iter()
                .enumerate()
                .map(|(i, a)| {
                    let base = n - i as f64;
                    let mult = feedback_scores.get(&a.id).copied().unwrap_or(1.0);
                    (a, base * mult)
                })
                .collect();
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            results = scored.into_iter().map(|(a, _)| a).collect();
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_fts5_basic() {
        assert_eq!(sanitize_fts5_query("hello world"), "\"hello\" \"world\"");
    }

    #[test]
    fn test_sanitize_fts5_special_chars() {
        assert_eq!(
            sanitize_fts5_query("NilReceiver (PSI)"),
            "\"NilReceiver\" \"PSI\""
        );
    }

    #[test]
    fn test_sanitize_fts5_operators() {
        assert_eq!(
            sanitize_fts5_query("nil AND receiver"),
            "\"nil\" AND \"receiver\""
        );
    }

    #[test]
    fn test_sanitize_fts5_empty() {
        assert_eq!(sanitize_fts5_query(""), "");
        assert_eq!(sanitize_fts5_query("   "), "");
    }

    #[test]
    fn test_sanitize_fts5_quotes() {
        assert_eq!(
            sanitize_fts5_query("error \"message\" test"),
            "\"error\" \"message\" \"test\""
        );
    }
}
