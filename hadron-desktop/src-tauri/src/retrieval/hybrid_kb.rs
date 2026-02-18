//! Hybrid KB Search (Vector + Lexical)
//!
//! Native Rust replacement for the Python subprocess KB query.
//! Runs KNN and text queries in parallel, fuses with RRF.
//!
//! Aligned with the Analyst Chatbot's retrieval strategy:
//! - Always queries KB docs for the specified WON version
//! - Always queries base-release-notes for general release context
//! - When a customer is specified, ALSO queries customer-specific release notes
//! - Uses a customer-to-index mapping ported from index_settings.yaml

use crate::rag_commands::{KBContext, KBResultItem, OpenSearchConfig};
use crate::retrieval::opensearch::{
    build_knn_query, build_knn_query_filtered, build_text_query, get_embedding,
    OpenSearchClient, OpenSearchHit, KB_EMBEDDING_DIMENSIONS, KB_EMBEDDING_MODEL,
};
use crate::retrieval::rrf;
use std::collections::HashMap;

// ============================================================================
// Customer Index Mapping (ported from index_settings.yaml)
// ============================================================================

lazy_static::lazy_static! {
    /// Maps customer display names (case-insensitive lookup) to their OpenSearch
    /// release notes index name. Ported from the Analyst Chatbot's index_settings.yaml.
    static ref CUSTOMER_INDEX_MAP: HashMap<String, &'static str> = {
        let entries: Vec<(&str, &str)> = vec![
            ("AETN",                "aetn-release-notes"),
            ("AEUS",                "aeus-release-notes"),
            ("AJL",                 "ajl-release-notes"),
            ("AJMN",                "ajmn-release-notes"),
            ("Altice",              "altice-release-notes"),
            ("AMCN",                "amcn-release-notes"),
            ("BBC",                 "bbc-release-notes"),
            ("BR",                  "br-release-notes"),
            ("BSF",                 "bsf-release-notes"),
            ("BSQ",                 "bsq-release-notes"),
            ("BTS",                 "bts-release-notes"),
            ("BX1",                 "bx1-release-notes"),
            ("CBC",                 "cbc-release-notes"),
            ("CURI",                "curi-release-notes"),
            ("DAZN",                "dazn-release-notes"),
            ("DISCO",               "disco-release-notes"),
            ("Disney Plus",         "disney-release-notes"),
            ("DMC",                 "dmc-release-notes"),
            ("DPG",                 "dpg-release-notes"),
            ("DR",                  "dr-release-notes"),
            ("Dreamwall",           "dreamwall-release-notes"),
            ("EMGBE",               "emgbe-release-notes"),
            ("FOXTEL",              "foxtel-release-notes"),
            ("France Televisions",  "france-televisions-release-notes"),
            ("M6",                  "m6-release-notes"),
            ("MBC",                 "mbc-release-notes"),
            ("MEDIACORP",           "mediacorp-release-notes"),
            ("Mediaset",            "mediaset-release-notes"),
            ("NEP",                 "nep-release-notes"),
            ("NPO",                 "npo-release-notes"),
            ("NRK",                 "nrk-release-notes"),
            ("OCS",                 "ocs-release-notes"),
            ("Outernet",            "outernet-release-notes"),
            ("PMH",                 "pmh-release-notes"),
            ("RTE",                 "rte-release-notes"),
            ("RTL Hungary",         "rtl-hungary-release-notes"),
            ("SH",                  "sh-release-notes"),
            ("SRF",                 "srf-release-notes"),
            ("SWR",                 "swr-release-notes"),
            ("SYN",                 "syn-release-notes"),
            ("TERN",                "tern-release-notes"),
            ("TF1",                 "tf1-release-notes"),
            ("TVMEDIA",             "tvmedia-release-notes"),
            ("TVUV",                "tvuv-release-notes"),
            ("TWCLA",               "twcla-release-notes"),
            ("UKTV",                "uktv-release-notes"),
            ("VIRGIN",              "virgin-release-notes"),
            ("VPRO",                "vpro-release-notes"),
            ("VRT",                 "vrt-release-notes"),
            ("YES",                 "yes-release-notes"),
            ("YLE",                 "yle-release-notes"),
        ];
        let mut map = HashMap::new();
        for (name, index) in entries {
            map.insert(name.to_lowercase(), index);
        }
        map
    };
}

/// Resolve a customer name to its OpenSearch release notes index.
///
/// Tries (in order):
/// 1. Exact match in the customer index map (case-insensitive)
/// 2. Simple formatting: `{lowercase}-release-notes`
/// 3. Validates the index actually exists in OpenSearch
fn resolve_customer_index(customer: &str) -> String {
    let key = customer.to_lowercase();

    // Check the known mapping first
    if let Some(&index) = CUSTOMER_INDEX_MAP.get(&key) {
        return index.to_string();
    }

    // Fallback: derive from name (replace spaces with hyphens, lowercase)
    let normalized = key.replace(' ', "-");
    format!("{}-release-notes", normalized)
}

// ============================================================================
// Public API
// ============================================================================

/// Execute hybrid (vector + lexical) KB search natively in Rust.
///
/// Aligned with the Analyst Chatbot's retrieval strategy:
/// - Fetches KB docs (knowledge base documentation)
/// - Always fetches base release notes
/// - When customer is specified, also fetches customer-specific release notes
/// - Each source type gets its own top_k allocation (no competition between sources)
pub async fn query_kb_native(
    config: &OpenSearchConfig,
    query: &str,
    won_version: Option<&str>,
    customer: Option<&str>,
    top_k: usize,
    api_key: &str,
) -> Result<KBContext, String> {
    let start = std::time::Instant::now();
    let client = OpenSearchClient::new(config);

    // Generate embedding for the query
    let embedding = get_embedding(query, api_key, KB_EMBEDDING_MODEL, KB_EMBEDDING_DIMENSIONS)
        .await
        .map_err(|e| format!("Failed to generate query embedding: {}", e))?;

    // Determine KB index name
    let kb_index = determine_kb_index(&client, won_version).await;

    // Always query base release notes
    let base_rn_index = if client.index_exists("base-release-notes").await {
        Some("base-release-notes".to_string())
    } else {
        log::warn!("base-release-notes index not found");
        None
    };

    // Determine customer-specific release notes index (separate from base)
    let customer_rn_index = if let Some(cust) = customer {
        if !cust.is_empty() {
            let index = resolve_customer_index(cust);
            if client.index_exists(&index).await {
                log::info!("Customer RN index resolved: '{}' -> '{}'", cust, index);
                Some(index)
            } else {
                log::warn!(
                    "Customer release notes index '{}' not found for customer '{}'",
                    index,
                    cust
                );
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    // Fetch from all sources in parallel, each with KNN + text queries
    let fetch_k = top_k * 2; // Over-fetch for RRF fusion

    // For release notes, use won_version as a max filter so results are scoped
    // to the user's version and earlier (matching the reference chatbot pattern).
    // KB docs don't need this — they're already scoped by index name.
    let (kb_results, base_rn_results, customer_rn_results) = tokio::join!(
        fetch_hybrid_results(&client, &kb_index, query, &embedding, fetch_k, "knowledge_base"),
        fetch_hybrid_rn_results(
            &client,
            &base_rn_index,
            query,
            &embedding,
            fetch_k,
            None, // base RN has no customer
            won_version,
        ),
        fetch_hybrid_rn_results(
            &client,
            &customer_rn_index,
            query,
            &embedding,
            fetch_k,
            customer,
            won_version,
        ),
    );

    let kb_results = kb_results.unwrap_or_default();
    let base_rn_results = base_rn_results.unwrap_or_default();
    let customer_rn_results = customer_rn_results.unwrap_or_default();

    // Trim each source to top_k
    let kb_results: Vec<KBResultItem> = kb_results.into_iter().take(top_k).collect();
    let base_rn_results: Vec<KBResultItem> = base_rn_results.into_iter().take(top_k).collect();
    let customer_rn_results: Vec<KBResultItem> =
        customer_rn_results.into_iter().take(top_k).collect();

    // Combined release_note_results for backward compatibility
    let mut release_note_results = Vec::new();
    release_note_results.extend(base_rn_results.clone());
    release_note_results.extend(customer_rn_results.clone());

    let elapsed_ms = start.elapsed().as_millis() as i64;
    log::info!(
        "Native KB search completed in {}ms: {} KB docs, {} base RN, {} customer RN",
        elapsed_ms,
        kb_results.len(),
        base_rn_results.len(),
        customer_rn_results.len()
    );

    Ok(KBContext {
        kb_results,
        release_note_results,
        base_rn_results,
        customer_rn_results,
        retrieval_time_ms: Some(elapsed_ms),
        source_mode: "remote-native".to_string(),
    })
}

// ============================================================================
// Index Resolution
// ============================================================================

async fn determine_kb_index(client: &OpenSearchClient, won_version: Option<&str>) -> String {
    if let Some(version) = won_version {
        let specific = format!("kb-doc-{}", version);
        if client.index_exists(&specific).await {
            return specific;
        }
        log::warn!(
            "KB index '{}' not found, falling back to wildcard",
            specific
        );
    }
    "kb-doc-*".to_string()
}

// ============================================================================
// Hybrid Search (KNN + Text → RRF)
// ============================================================================

async fn fetch_hybrid_results(
    client: &OpenSearchClient,
    index: &str,
    query: &str,
    embedding: &[f64],
    k: usize,
    source_type: &str,
) -> Result<Vec<KBResultItem>, String> {
    // Run KNN and text queries in parallel
    let knn_body = build_knn_query(embedding, k);
    let text_body = build_text_query(query, k);

    let (knn_result, text_result) = tokio::join!(
        client.search(index, &knn_body),
        client.search(index, &text_body),
    );

    let knn_hits = knn_result.map(|r| r.hits.hits).unwrap_or_else(|e| {
        log::warn!("KNN search failed on '{}': {}", index, e);
        Vec::new()
    });
    let text_hits = text_result.map(|r| r.hits.hits).unwrap_or_else(|e| {
        log::warn!("Text search failed on '{}': {}", index, e);
        Vec::new()
    });

    // Convert to KBResultItem
    let knn_items: Vec<KBResultItem> = knn_hits
        .iter()
        .map(|hit| hit_to_kb_item(hit, source_type, ""))
        .collect();
    let text_items: Vec<KBResultItem> = text_hits
        .iter()
        .map(|hit| hit_to_kb_item(hit, source_type, ""))
        .collect();

    // Fuse with RRF using document ID as key
    if knn_items.is_empty() && text_items.is_empty() {
        return Ok(Vec::new());
    }

    let fused = rrf::reciprocal_rank_fusion(
        vec![knn_items, text_items],
        |item: &KBResultItem| item.link.clone(),
        None,
    );

    Ok(fused
        .into_iter()
        .map(|(mut item, score)| {
            item.score = score;
            item
        })
        .collect())
}

async fn fetch_hybrid_rn_results(
    client: &OpenSearchClient,
    index: &Option<String>,
    query: &str,
    embedding: &[f64],
    k: usize,
    customer: Option<&str>,
    version_max: Option<&str>,
) -> Result<Vec<KBResultItem>, String> {
    let index = match index {
        Some(idx) => idx,
        None => return Ok(Vec::new()),
    };

    let source_type = if customer.is_some() {
        "customer_release_notes"
    } else {
        "base_release_notes"
    };
    let cust = customer.unwrap_or("");

    // Use version-filtered KNN query for release notes indexes (which contain
    // all versions in a single index). Filters by won_version_for_sorting <= max.
    let knn_body = build_knn_query_filtered(embedding, k, None, version_max);
    let text_body = build_text_query(query, k);

    let (knn_result, text_result) = tokio::join!(
        client.search(index, &knn_body),
        client.search(index, &text_body),
    );

    let knn_hits = knn_result.map(|r| r.hits.hits).unwrap_or_else(|e| {
        log::warn!("KNN search on RN '{}' failed: {}", index, e);
        Vec::new()
    });
    let text_hits = text_result.map(|r| r.hits.hits).unwrap_or_else(|e| {
        log::warn!("Text search on RN '{}' failed: {}", index, e);
        Vec::new()
    });

    let knn_items: Vec<KBResultItem> = knn_hits
        .iter()
        .map(|hit| hit_to_kb_item(hit, source_type, cust))
        .collect();
    let text_items: Vec<KBResultItem> = text_hits
        .iter()
        .map(|hit| hit_to_kb_item(hit, source_type, cust))
        .collect();

    if knn_items.is_empty() && text_items.is_empty() {
        return Ok(Vec::new());
    }

    let fused = rrf::reciprocal_rank_fusion(
        vec![knn_items, text_items],
        |item: &KBResultItem| item.link.clone(),
        None,
    );

    Ok(fused
        .into_iter()
        .map(|(mut item, score)| {
            item.score = score;
            item
        })
        .collect())
}

// ============================================================================
// Helpers
// ============================================================================

fn hit_to_kb_item(hit: &OpenSearchHit, source_type: &str, customer: &str) -> KBResultItem {
    let src = &hit.source;
    KBResultItem {
        text: src["text"]
            .as_str()
            .or_else(|| src["content"].as_str())
            .unwrap_or("")
            .to_string(),
        link: src["link"]
            .as_str()
            .or_else(|| src["url"].as_str())
            .unwrap_or("")
            .to_string(),
        page_title: src["page_title"]
            .as_str()
            .or_else(|| src["title"].as_str())
            .unwrap_or("")
            .to_string(),
        won_version: src["won_version"].as_str().unwrap_or("").to_string(),
        customer: if customer.is_empty() {
            src["customer"].as_str().unwrap_or("").to_string()
        } else {
            customer.to_string()
        },
        score: hit.score.unwrap_or(0.0),
        source_type: source_type.to_string(),
    }
}
