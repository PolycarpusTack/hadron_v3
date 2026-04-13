# Web-Desktop Parity Phase 7: RAG/OpenSearch Hybrid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hybrid retrieval (vector + BM25 + RRF fusion) for local analyses and remote KB, auto-embed analyses, upgrade chat tools to use hybrid search.

**Architecture:** hadron-core gets `retrieval/` module (RRF, evidence gate, customer mappings). hadron-server extends OpenSearch with KNN, adds hybrid search routes, auto-embeds on save, upgrades chat tools. Frontend gets admin embeddings panel and search toggle.

**Tech Stack:** Rust (hadron-core, Axum, pgvector, OpenSearch), React 18, TypeScript

**Spec:** `docs/plans/2026-04-13-web-parity-phase7-design.md`

---

## File Map

### hadron-core (create)
- `hadron-web/crates/hadron-core/src/retrieval/mod.rs`
- `hadron-web/crates/hadron-core/src/retrieval/types.rs`
- `hadron-web/crates/hadron-core/src/retrieval/rrf.rs`
- `hadron-web/crates/hadron-core/src/retrieval/evidence_gate.rs`
- `hadron-web/crates/hadron-core/src/retrieval/customer_mappings.rs`

### hadron-core (modify)
- `hadron-web/crates/hadron-core/src/lib.rs` — add `pub mod retrieval`

### hadron-server (create)
- `hadron-web/crates/hadron-server/src/routes/search.rs` — hybrid search + backfill routes

### hadron-server (modify)
- `hadron-web/crates/hadron-server/src/integrations/opensearch.rs` — add KNN queries
- `hadron-web/crates/hadron-server/src/integrations/embeddings.rs` — add retry + batch
- `hadron-web/crates/hadron-server/src/ai/tools.rs` — upgrade to hybrid search
- `hadron-web/crates/hadron-server/src/routes/mod.rs` — register routes
- `hadron-web/crates/hadron-server/src/routes/analyses.rs` — auto-embed on save
- `hadron-web/crates/hadron-server/src/routes/sentry_analysis.rs` — auto-embed on save
- `hadron-web/crates/hadron-server/src/routes/performance.rs` — auto-embed on save
- `hadron-web/crates/hadron-server/src/db/mod.rs` — embedding storage + vector search queries

### Frontend (create)
- `hadron-web/frontend/src/components/admin/EmbeddingsPanel.tsx`

### Frontend (modify)
- `hadron-web/frontend/src/services/api.ts` — types + methods
- `hadron-web/frontend/src/components/admin/AdminPanel.tsx` — add Embeddings tab
- `hadron-web/frontend/src/components/search/AdvancedSearchPanel.tsx` — hybrid toggle

---

## Task 1: hadron-core — Retrieval Module (RRF, Evidence Gate, Customer Mappings)

**Files:** Create `hadron-web/crates/hadron-core/src/retrieval/` (5 files), modify `lib.rs`

- [ ] **Step 1: Create types.rs**

All types with `#[derive(Debug, Clone, Serialize, Deserialize)]` and `#[serde(rename_all = "camelCase")]`:

- `SearchHit` — id (String), title (String), content (String), score (f64), source (SearchSource), metadata (HashMap<String, String>)
- `SearchSource` enum — PgVector, PostgresFts, OpenSearchKnn, OpenSearchText
- `CustomerIndices` — kb_index (String), rn_index (Option<String>)
- `EvidenceGateConfig` — min_score (f64, default 0.01), gold_boost (f64, default 0.3)

- [ ] **Step 2: Create rrf.rs**

Port from desktop. Generic RRF over result lists:

```rust
pub fn reciprocal_rank_fusion(result_lists: Vec<Vec<SearchHit>>, k: usize) -> Vec<SearchHit> {
    let mut scores: HashMap<String, (f64, SearchHit)> = HashMap::new();
    for list in &result_lists {
        for (rank, hit) in list.iter().enumerate() {
            let rrf_score = 1.0 / (k as f64 + rank as f64 + 1.0);
            let entry = scores.entry(hit.id.clone()).or_insert((0.0, hit.clone()));
            entry.0 += rrf_score;
        }
    }
    let mut results: Vec<SearchHit> = scores.into_values()
        .map(|(score, mut hit)| { hit.score = score; hit })
        .collect();
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results
}
```

- [ ] **Step 3: Create evidence_gate.rs**

```rust
pub fn apply_evidence_gate(mut results: Vec<SearchHit>, config: &EvidenceGateConfig) -> Vec<SearchHit> {
    // Boost gold matches
    for hit in &mut results {
        if hit.metadata.get("is_gold").map(|v| v == "true").unwrap_or(false) {
            hit.score += config.gold_boost;
        }
    }
    // Filter by threshold
    results.retain(|h| h.score >= config.min_score);
    // Re-sort after boosting
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results
}
```

- [ ] **Step 4: Create customer_mappings.rs**

Port all 55+ mappings from desktop's `hybrid_kb.rs`. Structure:

```rust
pub fn get_customer_indices(customer: &str) -> Option<CustomerIndices> {
    let customer_lower = customer.to_lowercase();
    // Match against known customers
    let (kb, rn) = match customer_lower.as_str() {
        "customer1" | "cust1" => ("won-kb-customer1", Some("customer-release-notes-customer1")),
        // ... 55+ entries ported from desktop
        _ => return None,
    };
    Some(CustomerIndices {
        kb_index: kb.to_string(),
        rn_index: rn.map(String::from),
    })
}

pub const DEFAULT_KB_INDEX: &str = "won-kb-base";
pub const DEFAULT_RN_INDEX: &str = "base-release-notes";
```

Read the desktop's `hadron-desktop/src-tauri/src/retrieval/hybrid_kb.rs` to get the exact customer list.

- [ ] **Step 5: Create mod.rs, register in lib.rs**

```rust
pub mod types;
pub mod rrf;
pub mod evidence_gate;
pub mod customer_mappings;
pub use types::*;
```

Add `pub mod retrieval;` to `lib.rs`.

- [ ] **Step 6: Tests**

In rrf.rs: test_single_list, test_two_lists_merge, test_overlapping_results
In evidence_gate.rs: test_filters_low_scores, test_gold_boost
In customer_mappings.rs: test_known_customer, test_unknown_returns_none

- [ ] **Step 7: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo test -p hadron-core -- retrieval
git add hadron-web/crates/hadron-core/src/retrieval/ hadron-web/crates/hadron-core/src/lib.rs
git commit -m "feat(core): add retrieval module with RRF fusion, evidence gate, and customer mappings"
```

---

## Task 2: hadron-server — Extend OpenSearch + Embeddings

**Files:** Modify `integrations/opensearch.rs`, `integrations/embeddings.rs`, `db/mod.rs`

- [ ] **Step 1: Add KNN query builders to opensearch.rs**

Read the existing file first. Add:

```rust
pub fn build_knn_query(vector: &[f32], k: usize) -> serde_json::Value {
    serde_json::json!({
        "size": k,
        "query": { "knn": { "embedding": { "vector": vector, "k": k } } }
    })
}

pub async fn search_knn(
    config: &OpenSearchConfig, index: &str, vector: &[f32], k: usize,
) -> HadronResult<Vec<hadron_core::retrieval::SearchHit>>
// HTTP POST to {url}/{index}/_search with KNN body, parse hits
```

Also check what `OpenSearchConfig` looks like — it may need to come from the `opensearch_configs` DB table or from admin settings.

- [ ] **Step 2: Add retry + batch to embeddings.rs**

Read existing file. Add:

```rust
pub async fn generate_embedding_with_retry(
    api_key: &str, text: &str, model: &str, dims: usize, max_retries: usize,
) -> HadronResult<Vec<f32>> {
    // 3 retries with 1s/2s/4s backoff on 429/500
}

pub async fn generate_embeddings_batch(
    api_key: &str, texts: &[&str], model: &str, dims: usize,
) -> HadronResult<Vec<Vec<f32>>> {
    // POST to OpenAI with input as array
}
```

- [ ] **Step 3: Add DB functions for embedding storage + vector search**

In `db/mod.rs`:

```rust
pub async fn store_embedding(
    pool: &PgPool, source_type: &str, source_id: i64, chunk_text: &str, embedding: &[f32],
) -> HadronResult<()>
// INSERT INTO embeddings (source_type, source_id, chunk_index, chunk_text, embedding)
// ON CONFLICT (source_type, source_id, chunk_index) DO UPDATE

pub async fn vector_search(
    pool: &PgPool, query_embedding: &[f32], limit: i64, source_type: Option<&str>,
) -> HadronResult<Vec<hadron_core::retrieval::SearchHit>>
// SELECT ... FROM embeddings ORDER BY embedding <=> $1::vector LIMIT $2

pub async fn get_embedding_coverage(pool: &PgPool) -> HadronResult<(i64, i64)>
// (total_analyses, embedded_count)

pub async fn get_unembedded_analyses(pool: &PgPool, limit: i64) -> HadronResult<Vec<(i64, String, Option<String>, Option<String>)>>
// Analyses without embeddings
```

- [ ] **Step 4: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check
git add hadron-web/crates/hadron-server/src/integrations/opensearch.rs hadron-web/crates/hadron-server/src/integrations/embeddings.rs hadron-web/crates/hadron-server/src/db/mod.rs
git commit -m "feat(server): extend OpenSearch with KNN, add embedding retry/batch and vector search DB"
```

---

## Task 3: hadron-server — Hybrid Search Routes + Backfill

**Files:** Create `routes/search.rs`, modify `routes/mod.rs`

- [ ] **Step 1: Create routes/search.rs**

4 handlers:

**A) Local hybrid search:** `POST /api/search/hybrid`
```rust
pub async fn search_hybrid(user, state, Json(req)) -> Result<impl IntoResponse, AppError> {
    // 1. Get AI config for embedding
    // 2. Generate query embedding
    // 3. pgvector search: db::vector_search(pool, embedding, limit)
    // 4. PostgreSQL FTS: db::search_analyses(pool, user_id, query_text, limit)
    // 5. Convert both to Vec<SearchHit>
    // 6. RRF merge: hadron_core::retrieval::rrf::reciprocal_rank_fusion(vec![vector, fts], 60)
    // 7. Apply evidence gate
    // 8. Return results
}
```

**B) KB search:** `POST /api/search/knowledge-base`
```rust
pub async fn search_knowledge_base(user, state, Json(req)) -> Result<impl IntoResponse, AppError> {
    // 1. Load OpenSearch config from DB (opensearch_configs table)
    // 2. Resolve customer indices (or default)
    // 3. Generate query embedding
    // 4. OpenSearch hybrid: parallel KNN + text via tokio::try_join!
    // 5. RRF merge
    // 6. If customer has RN index, search that too and merge
    // 7. Return results
}
```

**C) Backfill:** `POST /api/admin/embeddings/backfill`
```rust
pub async fn backfill_embeddings(user, state) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    // 1. Get unembedded analyses
    // 2. Process in batches of 20
    // 3. For each: build text from error_type + root_cause + component, generate embedding, store
    // 4. Return { processed, skipped, errors }
}
```

**D) Status:** `GET /api/admin/embeddings/status`

- [ ] **Step 2: Register routes**

```rust
mod search;
// ...
.route("/search/hybrid", post(search::search_hybrid))
.route("/search/knowledge-base", post(search::search_knowledge_base))
.route("/admin/embeddings/backfill", post(search::backfill_embeddings))
.route("/admin/embeddings/status", get(search::embeddings_status))
```

- [ ] **Step 3: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check
git add hadron-web/crates/hadron-server/src/routes/search.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(server): add hybrid search routes, KB search, and embedding backfill"
```

---

## Task 4: hadron-server — Auto-Embed + Chat Tools Upgrade

**Files:** Modify `routes/analyses.rs`, `routes/sentry_analysis.rs`, `routes/performance.rs`, `ai/tools.rs`

- [ ] **Step 1: Add auto-embed helper**

In a shared location (or inline in each route file):

```rust
fn spawn_embed_analysis(pool: sqlx::PgPool, id: i64, text: String) {
    tokio::spawn(async move {
        let ai_config = match crate::db::get_server_ai_config(&pool).await {
            Ok(Some(c)) => c,
            _ => return,
        };
        match crate::integrations::embeddings::generate_embedding_with_retry(
            &ai_config.api_key, &text, "text-embedding-3-small", 1536, 3,
        ).await {
            Ok(embedding) => {
                if let Err(e) = crate::db::store_embedding(&pool, "analysis", id, &text, &embedding).await {
                    tracing::warn!("Failed to store embedding for analysis {id}: {e}");
                }
            }
            Err(e) => tracing::warn!("Failed to generate embedding for analysis {id}: {e}"),
        }
    });
}
```

- [ ] **Step 2: Wire into analysis save paths**

In `analyses.rs`: after `insert_analysis()`, call `spawn_embed_analysis(pool, id, text)`.
In `sentry_analysis.rs`: after `insert_sentry_analysis()`, call it.
In `performance.rs`: after `insert_performance_analysis()`, call it.

The `text` should be a concatenation of the most meaningful fields (error_type, root_cause, component, summary).

- [ ] **Step 3: Upgrade chat tools**

In `ai/tools.rs`, read the existing file. Upgrade:

- `search_knowledge_base` tool: if OpenSearch is configured (`opensearch_configs` table has an entry), call the hybrid KB search. Otherwise, call local hybrid (pgvector + FTS). This requires generating a query embedding.
- Add `search_similar_analyses` tool: pgvector cosine search for finding analyses similar to given text.
- Both return results with scores.

- [ ] **Step 4: Verify and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-web && SQLX_OFFLINE=true cargo check
git add hadron-web/crates/hadron-server/src/routes/analyses.rs hadron-web/crates/hadron-server/src/routes/sentry_analysis.rs hadron-web/crates/hadron-server/src/routes/performance.rs hadron-web/crates/hadron-server/src/ai/tools.rs
git commit -m "feat(server): auto-embed analyses on save and upgrade chat tools to hybrid search"
```

---

## Task 5: Frontend — Admin Embeddings Panel + Search Toggle

**Files:** Create `EmbeddingsPanel.tsx`, modify `api.ts`, `AdminPanel.tsx`, `AdvancedSearchPanel.tsx`

- [ ] **Step 1: Add types and methods to api.ts**

```typescript
export interface HybridSearchRequest {
  query: string;
  limit?: number;
  threshold?: number;
}

export interface KBSearchRequest {
  query: string;
  customer?: string;
  limit?: number;
}

export interface SearchHitResult {
  id: string;
  title: string;
  content: string;
  score: number;
  source: string;
  metadata: Record<string, string>;
}

export interface EmbeddingStatus {
  totalAnalyses: number;
  embedded: number;
  coverage: number;
}

export interface BackfillResult {
  processed: number;
  skipped: number;
  errors: number;
}
```

Methods:
```typescript
async searchHybrid(query: string, limit?: number): Promise<SearchHitResult[]>
async searchKnowledgeBase(query: string, customer?: string, limit?: number): Promise<SearchHitResult[]>
async getEmbeddingStatus(): Promise<EmbeddingStatus>
async backfillEmbeddings(): Promise<BackfillResult>
```

- [ ] **Step 2: Create EmbeddingsPanel.tsx (~80 lines)**

- On mount: load `api.getEmbeddingStatus()`
- Display: "X of Y analyses have embeddings (Z%)" with progress bar
- "Backfill Embeddings" button → calls `api.backfillEmbeddings()`, shows result
- Loading/error states

- [ ] **Step 3: Wire into AdminPanel**

Add "Embeddings" tab.

- [ ] **Step 4: Add hybrid toggle to AdvancedSearchPanel**

Read the existing file. Add a "Hybrid Search" toggle. When enabled, call `api.searchHybrid()` instead of the existing text search. Show similarity score badges on results.

- [ ] **Step 5: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts hadron-web/frontend/src/components/admin/EmbeddingsPanel.tsx hadron-web/frontend/src/components/admin/AdminPanel.tsx hadron-web/frontend/src/components/search/AdvancedSearchPanel.tsx
git commit -m "feat(frontend): add embeddings admin panel and hybrid search toggle"
```

---

## Task 6: Verification

- [ ] **Step 1:** `cargo test -p hadron-core -- retrieval` (7+ tests)
- [ ] **Step 2:** `cargo check` (clean)
- [ ] **Step 3:** `npx tsc --noEmit && npx vite build` (clean)
- [ ] **Step 4:** Fix issues, final commit

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | hadron-core | RRF fusion, evidence gate, 55+ customer mappings, tests |
| 2 | hadron-server | KNN query builders, embedding retry/batch, vector search DB |
| 3 | hadron-server | Hybrid search routes (local + KB), backfill |
| 4 | hadron-server | Auto-embed on save, chat tools upgrade |
| 5 | Frontend | Embeddings admin panel, search toggle |
| 6 | Verification | Tests, builds |
