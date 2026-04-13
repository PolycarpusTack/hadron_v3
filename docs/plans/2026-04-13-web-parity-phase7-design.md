# Web-Desktop Parity Phase 7: RAG/OpenSearch Hybrid

**Date:** 2026-04-13
**Status:** Design approved
**Parent:** `docs/plans/2026-03-25-web-desktop-parity-design.md`

## Overview

Add hybrid retrieval (vector + BM25) with RRF fusion to the web. Two search paths: PostgreSQL pgvector + FTS for local analyses (always available), OpenSearch KNN + text for KB docs (when configured). Auto-embed analyses on creation, backfill existing data, upgrade chat tools to use hybrid search. Port 55+ customer-specific KB index mappings.

## Design Decisions

1. **Dual hybrid search:** pgvector hybrid for local analyses (built-in, always works). OpenSearch hybrid for KB docs (optional). Both use RRF fusion.
2. **Auto-embed on save:** Fire-and-forget embedding generation when analyses are created. Background backfill route for existing data.
3. **Customer mappings:** Port all 55+ customer→index mappings from desktop (hardcoded in hadron-core).
4. **Single configurable KB index** as default, customer-specific indices when customer is specified.
5. **Evidence gating:** Score threshold + gold match boosting for confidence filtering.

---

## 1. hadron-core — `retrieval` Module

### Module Structure

```
hadron-core/src/retrieval/
├── mod.rs              — re-exports
├── types.rs            — SearchHit, HybridSearchConfig, SearchSource, CustomerIndices
├── rrf.rs              — Reciprocal Rank Fusion (generic, K=60)
├── evidence_gate.rs    — confidence threshold + gold boost
├── customer_mappings.rs — 55+ customer→index mappings
```

### Types (`types.rs`)

```rust
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub content: String,
    pub score: f64,
    pub source: SearchSource,
    pub metadata: HashMap<String, String>,
}

pub enum SearchSource {
    PgVector,     // local analysis via pgvector cosine
    PostgresFts,  // local analysis via FTS
    OpenSearchKnn, // remote KB via KNN
    OpenSearchText, // remote KB via BM25
}

pub struct CustomerIndices {
    pub kb_index: String,
    pub rn_index: Option<String>,
}

pub struct EvidenceGateConfig {
    pub min_score: f64,        // minimum RRF score to include (default 0.01)
    pub gold_boost: f64,       // boost for gold/standard matches (default 0.3)
}
```

### RRF (`rrf.rs`)

```rust
pub fn reciprocal_rank_fusion(
    result_lists: Vec<Vec<SearchHit>>,
    k: usize,  // default 60
) -> Vec<SearchHit>
```

Formula: For each document across all lists, `score = sum(1 / (k + rank + 1))`. Merge by ID, sort descending.

Ported from desktop's `retrieval/rrf.rs` (~100 lines).

### Evidence Gate (`evidence_gate.rs`)

```rust
pub fn apply_evidence_gate(
    results: Vec<SearchHit>,
    config: &EvidenceGateConfig,
) -> Vec<SearchHit>
```

Filter results below `min_score`. Boost results with `is_gold: true` metadata by `gold_boost`.

### Customer Mappings (`customer_mappings.rs`)

```rust
pub fn get_customer_indices(customer: &str) -> Option<CustomerIndices>
```

Hardcoded HashMap of 55+ customer→`CustomerIndices` mappings, ported from desktop's `hybrid_kb.rs`. Returns `None` for unknown customers (falls back to default index).

### Tests

- `test_rrf_single_list` — identity operation
- `test_rrf_two_lists` — proper merging + score calculation
- `test_rrf_overlapping_results` — same doc in multiple lists gets boosted
- `test_evidence_gate_filters` — below-threshold results removed
- `test_evidence_gate_gold_boost` — gold results get boosted
- `test_customer_mappings` — known customers return correct indices
- `test_customer_mappings_unknown` — unknown returns None

---

## 2. hadron-server — Search Infrastructure

### Extend `integrations/opensearch.rs`

Add KNN query builder:
```rust
pub fn build_knn_query(vector: &[f32], k: usize) -> serde_json::Value
pub fn build_knn_query_filtered(vector: &[f32], k: usize, filter: serde_json::Value) -> serde_json::Value
pub async fn search_knn(config: &OpenSearchConfig, index: &str, vector: &[f32], k: usize) -> HadronResult<Vec<SearchHit>>
```

Add hybrid search orchestrator:
```rust
pub async fn search_hybrid(
    config: &OpenSearchConfig,
    index: &str,
    query_text: &str,
    query_embedding: &[f32],
    k: usize,
) -> HadronResult<Vec<SearchHit>>
```

Runs KNN + text in parallel (`tokio::try_join!`), merges via RRF.

### Extend `integrations/embeddings.rs`

- Add retry logic: 3 attempts with exponential backoff (1s, 2s, 4s) on 429/500 errors
- Add batch support: `generate_embeddings_batch(texts: &[&str]) -> HadronResult<Vec<Vec<f32>>>`
- Keep existing single-text function

### New: `routes/search.rs`

**Local hybrid search:** `POST /api/search/hybrid`

```json
{ "query": "crash in login module", "limit": 10, "threshold": 0.01 }
```

1. Generate query embedding via OpenAI
2. pgvector cosine search: `SELECT * FROM embeddings ... ORDER BY embedding <=> $1 LIMIT $2`
3. PostgreSQL FTS search: `SELECT * FROM analyses WHERE search_vector @@ websearch_to_tsquery($1)`
4. RRF merge both result lists
5. Apply evidence gate
6. Return results with scores

**KB hybrid search:** `POST /api/search/knowledge-base`

```json
{ "query": "contract module fix", "customer": "acme", "limit": 10 }
```

1. Resolve customer indices (or use default KB index from admin config)
2. Generate query embedding
3. OpenSearch hybrid search (KNN + text + RRF)
4. If customer has RN index, search that too and merge
5. Apply evidence gate
6. Return results

**Admin backfill:** `POST /api/admin/embeddings/backfill`

- Admin-only
- Queries all analyses where no embedding exists in `embeddings` table
- Generates embeddings in batches of 20
- Returns `{ processed: N, skipped: M, errors: E }`

**Admin status:** `GET /api/admin/embeddings/status`

- Returns `{ total_analyses: N, embedded: M, coverage: percentage }`

### Auto-embed on Analysis Save

In `routes/analyses.rs`, `routes/sentry_analysis.rs`, `routes/performance.rs` — after inserting an analysis, spawn a fire-and-forget task:

```rust
tokio::spawn(async move {
    let text = format!("{} {} {}", error_type, root_cause, component);
    match crate::integrations::embeddings::generate_embedding(&text).await {
        Ok(embedding) => {
            let _ = db::store_embedding(&pool, "analysis", analysis_id, &text, &embedding).await;
        }
        Err(e) => tracing::warn!("Failed to embed analysis {}: {e}", analysis_id),
    }
});
```

### Upgrade Chat Tools (`ai/tools.rs`)

Current tools fall back to text-only search. Upgrade:

- `search_knowledge_base` → if OpenSearch configured, call hybrid KB search. Otherwise, call local hybrid (pgvector + FTS).
- Add `search_similar_analyses` tool → pgvector cosine similarity search for finding analyses similar to the current context.

Both tools return results with similarity scores in the response for the AI to reference.

---

## 3. Frontend

### Admin Panel: `EmbeddingsPanel.tsx`

- Coverage stats: "X of Y analyses have embeddings (Z%)"
- "Backfill Embeddings" button → calls admin backfill route, shows progress
- Status auto-refreshes

### Search Enhancement

- `AdvancedSearchPanel.tsx` or `OpenSearchPanel.tsx`: add "Hybrid" toggle
  - When hybrid: calls `/api/search/hybrid` (vector + text)
  - When text-only: uses existing FTS search
- Results show similarity score badge when available

### Chat Display

- When chat tools return results with scores, display source attribution + similarity percentage in the tool result rendering

### AdminPanel.tsx

Add "Embeddings" tab with `<EmbeddingsPanel />`.

---

## 4. Implementation Order

1. hadron-core `retrieval/` — RRF, evidence gate, customer mappings, types, tests
2. hadron-server — extend OpenSearch with KNN queries
3. hadron-server — extend embeddings with retry + batch
4. hadron-server — local hybrid search route (pgvector + FTS + RRF)
5. hadron-server — KB hybrid search route (OpenSearch + customer indices)
6. hadron-server — auto-embed on analysis save + backfill route
7. hadron-server — upgrade chat tools to hybrid search
8. Frontend — API types, EmbeddingsPanel, search toggle
9. Verification
