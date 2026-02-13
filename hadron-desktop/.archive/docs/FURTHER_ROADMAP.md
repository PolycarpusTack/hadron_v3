# Hadron AI Learning & Improvement Roadmap

## Executive Summary

This document outlines a comprehensive plan to make Hadron's crash analysis **smarter over time** through:
1. **RAG (Retrieval-Augmented Generation)** - Learn from past analyses
2. **Feedback Loop** - Capture user corrections and preferences
3. **Fine-tuning Pipeline** - Train custom models on domain-specific data
4. **Offline Readiness** - Path to fully local/private deployment

---

## Feasibility Assessment

### Overall Assessment: **FEASIBLE** with phased approach

| Component | Complexity | Effort | Risk | Priority |
|-----------|------------|--------|------|----------|
| Data Schema & Storage | Low | 2-3 weeks | Low | P0 |
| Feedback Capture | Low | 1-2 weeks | Low | P0 |
| RAG Pipeline | Medium | 4-6 weeks | Medium | P1 |
| Evaluation Harness | Medium | 2-3 weeks | Low | P1 |
| Fine-tuning (OpenAI) | Medium | 3-4 weeks | Medium | P2 |
| Offline Transition | High | 8-12 weeks | High | P3 |

### Current Codebase Alignment

Hadron already has several foundational pieces:
- **SQLite database** with analyses table (`src-tauri/src/database.rs`)
- **Analysis storage** with `full_data` JSON field
- **PII redaction** pipeline (`redact_pii_basic()` in `commands.rs`)
- **Multi-provider support** (OpenAI, Anthropic, Ollama, ZAI)
- **Signature/deduplication** system (`src-tauri/src/signature.rs`)

---

## EPIC 1: Objectives, Constraints & Data Governance

### TASK 1.1: Define Learning Objectives

| Subtask | Description | Feasibility | Notes |
|---------|-------------|-------------|-------|
| 1.1.1 | Define "smarter" outcomes | **Easy** | Metrics: fix acceptance rate, time-to-resolution, user edits required |
| 1.1.2 | Baseline metrics | **Easy** | Can derive from existing `view_count`, `is_favorite`, future feedback |
| 1.1.3 | Scope of learning | **Medium** | Start with RAG (immediate), defer fine-tuning to Phase 2 |

**Recommended Metrics:**
```
- Fix Acceptance Rate: % of suggested fixes marked as "helpful"
- Edit Distance: How much users modify AI suggestions
- Resolution Time: Time from analysis to ticket closure (if JIRA linked)
- Retrieval Precision: % of retrieved similar cases rated relevant
```

### TASK 1.2: Data Constraints

| Subtask | Description | Feasibility | Notes |
|---------|-------------|-------------|-------|
| 1.2.1 | PII/PHI policy | **Exists** | Already have `redact_pii_basic()`, needs expansion |
| 1.2.2 | Data portability (JSONL) | **Easy** | Add export command, ~1 day |
| 1.2.3 | Offline target | **Medium** | Recommend Llama 3.1 8B or Mistral 7B with LoRA |

**Current PII Redaction Coverage:**
- Email addresses
- IPv4 addresses
- API tokens (sk-xxx)
- Windows/Unix user paths

**Gaps to Address:**
- Database connection strings
- Customer names in logs
- Internal hostnames/IPs

---

## EPIC 2: Data Schema & Storage

### TASK 2.1: Canonical Data Schema

**Current Schema** (`src-tauri/src/database.rs`):
```rust
pub struct Analysis {
    id, filename, file_size_kb, error_type, error_message,
    severity, component, stack_trace, root_cause, suggested_fixes,
    confidence, analyzed_at, ai_model, ai_provider, tokens_used,
    cost, was_truncated, full_data, is_favorite, last_viewed_at,
    view_count, analysis_duration_ms, analysis_type
}
```

**Proposed Extensions:**

#### 2.1.1 Analysis Record (extend existing)
```sql
ALTER TABLE analyses ADD COLUMN embedding BLOB;           -- Vector embedding
ALTER TABLE analyses ADD COLUMN embedding_model TEXT;     -- e.g., "text-embedding-3-small"
ALTER TABLE analyses ADD COLUMN feedback_status TEXT;     -- "pending", "accepted", "rejected", "edited"
ALTER TABLE analyses ADD COLUMN gold_record_id INTEGER;   -- Link to curated version
```

#### 2.1.2 Feedback Record (new table)
```sql
CREATE TABLE analysis_feedback (
    id INTEGER PRIMARY KEY,
    analysis_id INTEGER NOT NULL REFERENCES analyses(id),
    feedback_type TEXT NOT NULL,  -- "accept", "reject", "edit", "rating"
    field_name TEXT,              -- Which field was edited
    original_value TEXT,
    new_value TEXT,
    rating INTEGER,               -- 1-5 usefulness
    feedback_at TEXT NOT NULL,
    user_id TEXT,                 -- Optional: who gave feedback
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);
```

#### 2.1.3 Gold Record (curated truth)
```sql
CREATE TABLE gold_analyses (
    id INTEGER PRIMARY KEY,
    source_analysis_id INTEGER,
    error_signature TEXT NOT NULL,  -- Canonical error pattern
    root_cause TEXT NOT NULL,
    suggested_fixes TEXT NOT NULL,  -- JSON array
    validation_status TEXT,         -- "verified", "pending_review"
    created_at TEXT NOT NULL,
    verified_by TEXT,
    times_referenced INTEGER DEFAULT 0
);
```

#### 2.1.4 Retrieval Chunk (for RAG)
```sql
CREATE TABLE retrieval_chunks (
    id INTEGER PRIMARY KEY,
    source_type TEXT NOT NULL,      -- "analysis", "gold", "documentation"
    source_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    metadata_json TEXT,             -- component, severity, version, etc.
    created_at TEXT NOT NULL
);

CREATE INDEX idx_chunks_source ON retrieval_chunks(source_type, source_id);
```

**Feasibility: HIGH** - Straightforward SQLite migrations

### TASK 2.2: Dual-Index System

| Storage | Purpose | Recommendation | Effort |
|---------|---------|----------------|--------|
| Relational | Canonical records | **SQLite** (existing) | Low |
| Vector | Similarity search | **FAISS** (Rust bindings exist) | Medium |
| Full-text | Keyword search | **SQLite FTS5** (existing) | Low |

**FAISS Integration Options:**
1. **Rust native**: Use `faiss-rs` crate (limited but works)
2. **Python sidecar**: Call Python FAISS via existing `python_runner.rs`
3. **Qdrant**: Self-hosted vector DB (more features, more complexity)

**Recommendation:** Start with SQLite + brute-force cosine similarity for <10K records, migrate to FAISS when needed.

### TASK 2.3: Data Lifecycle

| Subtask | Implementation | Effort |
|---------|---------------|--------|
| PII redaction | Extend `redact_pii_basic()` | 2-3 days |
| Archiving | Add `archived_at` column, cron job | 1 day |
| JSONL export | New Tauri command | 1 day |

**JSONL Export Format (OpenAI fine-tuning compatible):**
```json
{"messages": [
  {"role": "system", "content": "You are a Smalltalk crash analysis expert..."},
  {"role": "user", "content": "<crash_log_content>"},
  {"role": "assistant", "content": "<analysis_json>"}
]}
```

---

## EPIC 3: RAG Pipeline

### TASK 3.1: Ingestion & Chunking

**Integration Point:** `src-tauri/src/chunker.rs` (already exists!)

**Current Chunking:** Used for DeepScan map-reduce
**New Use:** Create retrieval chunks from completed analyses

```rust
// Proposed: src-tauri/src/rag/ingestion.rs
pub struct RetrievalChunk {
    pub content: String,
    pub embedding: Vec<f32>,
    pub metadata: ChunkMetadata,
}

pub struct ChunkMetadata {
    pub source_type: String,      // "analysis", "gold"
    pub source_id: i64,
    pub error_type: Option<String>,
    pub component: Option<String>,
    pub severity: Option<String>,
    pub outcome: Option<String>,  // "resolved", "workaround", "wontfix"
}
```

**Chunking Strategy:**
1. **Stack trace** → 1 chunk (preserves frame context)
2. **Root cause + fix** → 1 chunk (primary retrieval target)
3. **Full analysis JSON** → 1 chunk (for detailed context)

### TASK 3.2: Retrieval Strategy

**Hybrid Retrieval (BM25 + Vector):**

```
Score = α × BM25_score + (1-α) × cosine_similarity
where α = 0.3 (favor semantic similarity)
```

**Implementation:**
```rust
// Pseudo-code for hybrid retrieval
pub async fn retrieve_similar(
    query: &str,
    filters: &RetrievalFilters,
    top_k: usize,
) -> Vec<RetrievalResult> {
    // 1. Get BM25 candidates from FTS5
    let fts_results = db.search_fts(query, top_k * 3)?;

    // 2. Get vector candidates
    let query_embedding = embed_text(query).await?;
    let vector_results = db.search_vectors(query_embedding, filters, top_k * 3)?;

    // 3. Merge and rerank
    let merged = merge_results(fts_results, vector_results);
    let reranked = rerank_with_cross_encoder(merged, query)?; // Optional

    reranked.into_iter().take(top_k).collect()
}
```

**Metadata Filters:**
```rust
pub struct RetrievalFilters {
    pub components: Option<Vec<String>>,    // ["PSI", "BM", "WOn"]
    pub severity_min: Option<String>,       // "medium"
    pub versions: Option<Vec<String>>,      // ["2024r3", "2024r2"]
    pub date_after: Option<String>,
    pub only_gold: bool,
}
```

### TASK 3.3: Prompt Strategy

**RAG-Enhanced Prompt Template:**
```
You are analyzing a Smalltalk crash log. Use the following similar past cases as reference:

## Similar Cases Found:
{for each retrieved_case}
### Case #{index}: {error_type} in {component}
**Root Cause:** {root_cause}
**Resolution:** {suggested_fix}
**Outcome:** {outcome} (verified: {is_gold})
{end for}

## Current Crash Log:
{crash_content}

## Instructions:
1. Analyze the current crash using insights from similar cases
2. CITE which past case(s) informed your analysis
3. If no similar cases are relevant, state this explicitly
4. Return JSON in the WhatsOnEnhancedAnalysis format
```

**Feasibility: MEDIUM** - Core RAG is straightforward, embedding generation needs provider integration

---

## EPIC 4: Feedback Loop & Evaluation

### TASK 4.1: Capture User Feedback

**UI Integration Points:**

| Component | Feedback Type | Implementation |
|-----------|--------------|----------------|
| `WhatsOnDetailView.tsx` | Accept/Reject root cause | Add thumbs up/down buttons |
| `WhatsOnDetailView.tsx` | Edit fix suggestion | Inline edit with diff tracking |
| `AnalysisDetailView.tsx` | Usefulness rating | 5-star component |
| `HistoryView.tsx` | Mark as "gold standard" | Promote to gold_analyses |

**Feedback API:**
```typescript
// src/services/api.ts
export async function submitFeedback(
  analysisId: number,
  feedback: AnalysisFeedback
): Promise<void> {
  await invoke("submit_analysis_feedback", { analysisId, feedback });
}

interface AnalysisFeedback {
  type: "accept" | "reject" | "edit" | "rating";
  field?: string;
  originalValue?: string;
  newValue?: string;
  rating?: number;
}
```

### TASK 4.2: Evaluation Harness

**Test Set Creation:**
1. Export 50-100 analyses with known good outcomes
2. Include variety: different error types, components, severities
3. Mark expected root cause and fixes

**Evaluation Metrics:**
```python
# evaluation/metrics.py
def evaluate_analysis(predicted, ground_truth):
    return {
        "root_cause_accuracy": semantic_similarity(
            predicted["root_cause"],
            ground_truth["root_cause"]
        ),
        "fix_coverage": count_matching_fixes(
            predicted["suggested_fixes"],
            ground_truth["suggested_fixes"]
        ),
        "hallucination_score": detect_unsupported_claims(
            predicted,
            original_crash_log
        ),
        "format_compliance": validate_json_schema(predicted),
    }
```

**Nightly Eval Pipeline:**
```bash
# scripts/nightly_eval.sh
python evaluation/run_eval.py \
  --test-set data/eval_set.jsonl \
  --model gpt-4.1 \
  --prompt-version v2.3 \
  --output results/$(date +%Y%m%d).json
```

### TASK 4.3: Close the Loop

**Gold Promotion Flow:**
```
Analysis → User Accepts → Review Queue → Gold Record
                ↓
         User Edits → Diff Stored → Manual Review → Gold Record
```

**Automatic Promotion Criteria:**
- Rating ≥ 4/5
- No edits required
- Linked to resolved JIRA ticket
- Similar error signature not already in gold set

---

## EPIC 5: Fine-tuning Pipeline

### TASK 5.1: Data Preparation

**Minimum Viable Dataset:** 500-1,000 examples
**Target Dataset:** 5,000+ examples for production quality

**Data Sources:**
1. Gold analyses (highest quality)
2. Accepted analyses with 4+ rating
3. Manually curated historical analyses

**JSONL Conversion:**
```rust
// src-tauri/src/export/finetune.rs
pub fn export_for_finetuning(
    analyses: Vec<GoldAnalysis>,
    format: ExportFormat,  // OpenAI, Anthropic, Generic
) -> Result<String, String> {
    let records: Vec<_> = analyses.iter().map(|a| {
        json!({
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": &a.crash_content},
                {"role": "assistant", "content": &a.analysis_json}
            ]
        })
    }).collect();

    Ok(records.iter().map(|r| r.to_string()).collect::<Vec<_>>().join("\n"))
}
```

### TASK 5.2: Fine-tuning Workflow

**OpenAI Fine-tuning Process:**
```bash
# 1. Upload training file
openai api files.create -f training_data.jsonl -p fine-tune

# 2. Create fine-tuning job
openai api fine_tunes.create \
  -t file-xxx \
  -m gpt-4o-mini-2024-07-18 \
  --suffix "hadron-crash-v1"

# 3. Monitor progress
openai api fine_tunes.follow -i ft-xxx
```

**Cost Estimate (OpenAI):**
- Training: ~$0.008/1K tokens
- 1,000 examples × 4K tokens avg = 4M tokens = ~$32
- Inference: ~$0.0015/1K tokens (fine-tuned mini)

### TASK 5.3: Offline Readiness

**Recommended Offline Stack:**
| Component | Recommendation | Notes |
|-----------|---------------|-------|
| Base Model | Llama 3.1 8B / Mistral 7B | Good quality, fits 16GB VRAM |
| Fine-tuning | QLoRA (4-bit) | Fits on consumer GPU |
| Inference | llama.cpp / Ollama | Already integrated! |
| Vector DB | FAISS | Single-file, portable |

**LoRA Training Config:**
```yaml
# configs/lora_training.yaml
base_model: "meta-llama/Llama-3.1-8B-Instruct"
lora_config:
  r: 16
  lora_alpha: 32
  target_modules: ["q_proj", "v_proj", "k_proj", "o_proj"]
  lora_dropout: 0.05
training:
  batch_size: 4
  gradient_accumulation_steps: 4
  learning_rate: 2e-4
  num_epochs: 3
  warmup_ratio: 0.03
```

**Hardware Requirements:**
- Training: 24GB VRAM (RTX 4090) or cloud GPU
- Inference: 8GB VRAM (RTX 3070+) with 4-bit quantization

---

## EPIC 6: Security & Compliance

### TASK 6.1: PII/Secrets Handling

**Expanded Redaction Rules:**
```rust
// Add to src-tauri/src/commands.rs
static DB_CONN_RE: Lazy<Regex> = Lazy::new(||
    Regex::new(r"(jdbc|oracle|postgres)://[^\s]+").unwrap()
);
static HOSTNAME_RE: Lazy<Regex> = Lazy::new(||
    Regex::new(r"\b[a-zA-Z0-9-]+\.(internal|local|corp|lan)\b").unwrap()
);
static CUSTOMER_ID_RE: Lazy<Regex> = Lazy::new(||
    Regex::new(r"\b(customer|client|tenant)[_-]?id[=:]\s*\S+").unwrap()
);
```

**Redaction Pipeline:**
```
Raw Log → Basic PII Redaction → Domain-Specific Redaction → Storage
                                        ↓
                              Allowlist Check (keep safe patterns)
```

### TASK 6.2: Access Control

**Current State:** No access control (single-user desktop app)

**Future Considerations (if multi-user):**
- Role-based access to training data exports
- Audit log for who viewed sensitive analyses
- Encryption at rest for gold dataset

### TASK 6.3: Safe Deployment

**Model Versioning:**
```
models/
├── prompts/
│   ├── v1.0_base.txt
│   ├── v2.0_rag_enhanced.txt
│   └── v2.1_rag_with_citations.txt
├── fine_tuned/
│   ├── hadron-crash-v1/
│   └── hadron-crash-v2/
└── evaluations/
    ├── 2024-01-15_v2.0.json
    └── 2024-01-22_v2.1.json
```

**Rollback Strategy:**
```rust
// Settings: model_version preference
pub enum ModelStrategy {
    Baseline,           // Original prompts, no RAG
    RagEnhanced,        // RAG retrieval enabled
    FineTuned(String),  // Specific fine-tuned model
    Hybrid,             // Fine-tuned + RAG
}
```

---

## EPIC 7: Rollout Plan

### Phase 1: Foundation (Weeks 1-4)

**Goal:** Capture feedback, prepare for learning

| Week | Tasks | Deliverables |
|------|-------|--------------|
| 1 | Database schema extensions | Migration 006 with feedback tables |
| 2 | Feedback UI components | Thumbs up/down, edit tracking, ratings |
| 3 | JSONL export command | `export_training_data` Tauri command |
| 4 | Basic eval harness | 50 test cases, accuracy metrics |

**Success Criteria:**
- [ ] 100+ analyses with feedback collected
- [ ] Export produces valid OpenAI JSONL
- [ ] Baseline accuracy measured

### Phase 2: RAG Integration (Weeks 5-10)

**Goal:** Learn from past analyses

| Week | Tasks | Deliverables |
|------|-------|--------------|
| 5-6 | Embedding generation | Integration with OpenAI embeddings API |
| 7-8 | Retrieval implementation | Hybrid BM25 + vector search |
| 9 | Prompt enhancement | RAG-aware prompts with citations |
| 10 | A/B testing | Compare RAG vs baseline |

**Success Criteria:**
- [ ] RAG improves fix acceptance by 15%+
- [ ] <500ms retrieval latency
- [ ] Users report relevant similar cases

### Phase 3: Fine-tuning (Weeks 11-16)

**Goal:** Custom model for crash analysis

| Week | Tasks | Deliverables |
|------|-------|--------------|
| 11-12 | Dataset curation | 1,000+ gold examples |
| 13 | Pilot fine-tune | First custom model |
| 14-15 | Evaluation & iteration | Compare to baseline + RAG |
| 16 | Production rollout | Fine-tuned model as default |

**Success Criteria:**
- [ ] Fine-tuned model beats baseline by 20%+
- [ ] Cost reduction of 30%+ (smaller model)
- [ ] No regression in edge cases

### Phase 4: Offline Transition (Weeks 17-28)

**Goal:** Fully local deployment option

| Week | Tasks | Deliverables |
|------|-------|--------------|
| 17-20 | Local model training | QLoRA fine-tuned Llama/Mistral |
| 21-24 | Local RAG stack | FAISS + local embeddings |
| 25-26 | Parity testing | Cloud vs local comparison |
| 27-28 | Documentation & release | Offline deployment guide |

**Success Criteria:**
- [ ] Local model within 10% of cloud quality
- [ ] Works on 16GB RAM / 8GB VRAM machine
- [ ] No external API calls required

---

## Resource Requirements

### Development Effort

| Phase | Engineering Weeks | Skills Required |
|-------|------------------|-----------------|
| Phase 1 | 4 weeks | Rust, TypeScript, SQLite |
| Phase 2 | 6 weeks | ML/Embeddings, Search, Rust |
| Phase 3 | 6 weeks | ML Ops, Fine-tuning, Evaluation |
| Phase 4 | 12 weeks | Local ML, Optimization, DevOps |

**Total:** ~28 engineering weeks (7 months at 1 engineer)

### Infrastructure Costs

| Component | Cloud (Monthly) | Self-Hosted |
|-----------|----------------|-------------|
| Embeddings | $50-100 | Free (local model) |
| Vector DB | $0 (FAISS local) | $0 |
| Fine-tuning | $50-100 (one-time) | GPU rental ~$50 |
| Inference | $100-500 | Hardware cost |

### Hardware (Offline Phase)

| Tier | GPU | RAM | Use Case |
|------|-----|-----|----------|
| Minimum | RTX 3060 12GB | 16GB | Inference only |
| Recommended | RTX 4070 12GB | 32GB | Inference + light training |
| Power User | RTX 4090 24GB | 64GB | Full local training |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Insufficient training data | Medium | High | Start feedback collection immediately |
| Fine-tuned model worse than base | Medium | Medium | Keep baseline fallback, A/B test |
| PII leakage in training | Low | Critical | Multi-layer redaction, manual review |
| Retrieval returns irrelevant cases | Medium | Medium | Tune similarity thresholds, add filters |
| Local model too slow | Medium | Medium | Use quantization, batch processing |
| User adoption of feedback | High | Medium | Make feedback frictionless (1-click) |

---

## Appendix A: Database Migration

```sql
-- Migration 006: AI Learning Infrastructure

-- Feedback tracking
CREATE TABLE analysis_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    feedback_type TEXT NOT NULL CHECK(feedback_type IN ('accept', 'reject', 'edit', 'rating')),
    field_name TEXT,
    original_value TEXT,
    new_value TEXT,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    feedback_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);

-- Gold standard analyses
CREATE TABLE gold_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_analysis_id INTEGER,
    error_signature TEXT NOT NULL,
    crash_content_hash TEXT NOT NULL,
    root_cause TEXT NOT NULL,
    suggested_fixes TEXT NOT NULL,
    component TEXT,
    severity TEXT,
    validation_status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_by TEXT,
    times_referenced INTEGER DEFAULT 0,
    FOREIGN KEY (source_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL
);

-- Retrieval chunks for RAG
CREATE TABLE retrieval_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL CHECK(source_type IN ('analysis', 'gold', 'documentation')),
    source_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    embedding BLOB,
    embedding_model TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_feedback_analysis ON analysis_feedback(analysis_id);
CREATE INDEX idx_gold_signature ON gold_analyses(error_signature);
CREATE INDEX idx_chunks_source ON retrieval_chunks(source_type, source_id);
CREATE INDEX idx_chunks_embedding ON retrieval_chunks(embedding_model) WHERE embedding IS NOT NULL;

-- Add embedding column to analyses
ALTER TABLE analyses ADD COLUMN embedding BLOB;
ALTER TABLE analyses ADD COLUMN embedding_model TEXT;
```

---

## Appendix B: JSONL Export Example

```json
{"messages":[{"role":"system","content":"You are a Smalltalk crash analysis expert for MediaGeniX broadcast management systems. Analyze crash logs and return structured JSON with root cause analysis and suggested fixes."},{"role":"user","content":"=== WHATS'ON Crash Report ===\nVersion: 2024r3.000.064\nError: MessageNotUnderstood: #rootClass\nStack:\n  UndefinedObject(Object)>>doesNotUnderstand:\n  BMProgramSegmentDurations>>calculateTotalDuration\n  ..."},{"role":"assistant","content":"{\"summary\":{\"title\":\"Nil reference in duration calculation\",\"severity\":\"critical\",\"category\":\"scheduling\"},\"rootCause\":{\"technical\":\"BMProgramSegmentDurations>>calculateTotalDuration sends #rootClass to nil\",\"plainEnglish\":\"The system tried to calculate duration for a program segment that doesn't exist\"},\"suggestedFix\":{\"summary\":\"Add nil guard before accessing rootClass\",\"codeChanges\":[{\"file\":\"BMProgramSegmentDurations>>calculateTotalDuration\",\"before\":\"segment rootClass\",\"after\":\"segment ifNil: [^0] ifNotNil: [:s | s rootClass]\"}]}}"}]}
```

---

## Conclusion

This roadmap is **technically feasible** and builds naturally on Hadron's existing architecture. The phased approach allows for:

1. **Immediate value** (Phase 1-2): Better analyses through RAG
2. **Medium-term gains** (Phase 3): Custom fine-tuned model
3. **Long-term independence** (Phase 4): Fully offline operation

**Recommended Next Steps:**
1. Implement feedback capture UI (low effort, high value)
2. Start collecting gold analyses manually
3. Add JSONL export capability
4. Pilot RAG with 100 historical analyses

The biggest risk is **insufficient training data** - start feedback collection immediately to build the dataset needed for Phase 3.
