# Hadron Intelligence Platform - Consolidated Roadmap

---

## Current Status (Updated: 2026-01-21)

### Overall Progress: Phase 1-2 Foundation Complete

| Phase | Status | Progress | Notes |
|-------|--------|----------|-------|
| **Phase 1** | ✅ Complete | 100% | Feedback UI, Gold curation, DB schema |
| **Phase 2** | 🔄 In Progress | 60% | RAG scaffold complete, integration pending |
| **Phase 3** | ⏳ Not Started | 0% | JIRA Intelligence |
| **Phase 4** | ⏳ Not Started | 0% | Fine-tuning & API |
| **Phase 5** | ⏳ Not Started | 0% | Portals & Offline |

### Recent Completions (Phase 1-2)

**Database & Backend:**
- ✅ Migration 006: Feedback tables (`analysis_feedback`, `gold_analyses`, `retrieval_chunks`)
- ✅ Rust commands: `submit_analysis_feedback`, `promote_to_gold`, `verify_gold_analysis`, `reject_gold_analysis`
- ✅ RAG commands: `rag_query`, `rag_index_analysis`, `rag_build_context`, `rag_get_stats`
- ✅ Auto-indexing hook for new analyses

**Frontend Components:**
- ✅ `FeedbackButtons.tsx` - Thumbs up/down with ARIA accessibility
- ✅ `StarRating.tsx` - 5-star rating component
- ✅ `InlineEditor.tsx` - Edit root cause/fixes inline
- ✅ `GoldBadge.tsx` - Visual indicator for gold analyses
- ✅ `GoldReviewQueue.tsx` - Admin queue for gold curation

**Python RAG Scaffold:**
- ✅ `embeddings.py` - OpenAI embeddings with retry logic (tenacity)
- ✅ `chunking.py` - Analysis chunking strategy
- ✅ `chroma_store.py` - ChromaDB vector store (PersistentClient API)
- ✅ `models.py` - Pydantic models for RAG types
- ✅ `cli.py` - CLI interface for Tauri bridge

**TypeScript Services:**
- ✅ `rag.ts` - RAG service with query, index, context building

### Next Steps (Integration Phase)

1. **RAG-Enhanced Prompts** - Update AI service to include retrieved context
2. **Citation UI** - Display similar cases with source attribution
3. **A/B Testing Framework** - Compare RAG vs baseline
4. **Export Pipeline** - JSONL export for fine-tuning

---

## Executive Summary

This document consolidates two strategic initiatives into a unified development plan:

1. **AI Learning & Improvement** - Making Hadron smarter over time through RAG, feedback loops, and fine-tuning
2. **Support Intelligence** - Extending Hadron to analyze JIRA tickets and build institutional knowledge

The result is a comprehensive **Support Intelligence Platform** that learns from both crash logs and support tickets, providing actionable insights to engineers and customers.

---

## Vision

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         HADRON INTELLIGENCE PLATFORM                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │  CRASH LOGS     │    │  JIRA TICKETS   │    │  DOCUMENTATION  │         │
│  │  (Current)      │    │  (New)          │    │  (New)          │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                   │
│           └──────────────────────┼──────────────────────┘                   │
│                                  ▼                                          │
│                    ┌─────────────────────────┐                              │
│                    │    UNIFIED RAG ENGINE   │                              │
│                    │  • Embeddings           │                              │
│                    │  • Vector Search        │                              │
│                    │  • Hybrid Retrieval     │                              │
│                    │  • Gold Knowledge Base  │                              │
│                    └─────────────┬───────────┘                              │
│                                  │                                          │
│           ┌──────────────────────┼──────────────────────┐                   │
│           ▼                      ▼                      ▼                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │  Crash Analysis │    │  Ticket         │    │  Self-Service   │         │
│  │  (Enhanced)     │    │  Suggestions    │    │  Portal         │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                                             │
│                    ┌─────────────────────────┐                              │
│                    │    FEEDBACK LOOP        │                              │
│                    │  • User corrections     │                              │
│                    │  • Gold curation        │                              │
│                    │  • Fine-tuning data     │                              │
│                    └─────────────────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER                                  │
├──────────────────┬──────────────────┬──────────────────┬────────────────────┤
│  Hadron Desktop  │  Support Portal  │  Customer Portal │  API Gateway       │
│  (Existing)      │  (Phase 3)       │  (Phase 5)       │  (Phase 4)         │
└────────┬─────────┴────────┬─────────┴────────┬─────────┴────────┬───────────┘
         │                  │                  │                  │
         └──────────────────┴────────┬─────────┴──────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CORE SERVICES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  Analysis Engine │  │  RAG Service     │  │  Feedback        │          │
│  │  (Existing)      │  │  (Phase 2)       │  │  Service         │          │
│  │                  │  │                  │  │  (Phase 1)       │          │
│  │  • Crash parsing │  │  • Embeddings    │  │                  │          │
│  │  • AI analysis   │  │  • Retrieval     │  │  • Capture       │          │
│  │  • Patterns      │  │  • Ranking       │  │  • Gold curation │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  JIRA Service    │  │  Knowledge       │  │  Export/Training │          │
│  │  (Extended)      │  │  Ingestion       │  │  Service         │          │
│  │                  │  │  (Phase 2)       │  │  (Phase 4)       │          │
│  │  • Read tickets  │  │                  │  │                  │          │
│  │  • Write tickets │  │  • Tickets       │  │  • JSONL export  │          │
│  │  • Webhooks      │  │  • Documentation │  │  • Fine-tune API │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  SQLite          │  │  Vector Index    │  │  Document Store  │          │
│  │  (Existing)      │  │  (Phase 2)       │  │  (Phase 2)       │          │
│  │                  │  │                  │  │                  │          │
│  │  • Analyses      │  │  • FAISS local   │  │  • Raw tickets   │          │
│  │  • Feedback      │  │  • Embeddings    │  │  • Documentation │          │
│  │  • Gold records  │  │  • Chunks        │  │  • Runbooks      │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Current | Phase 2+ | Offline (Phase 5) |
|-------|---------|----------|-------------------|
| **Database** | SQLite | SQLite + FTS5 | Same |
| **Vector Store** | - | FAISS (via Python) | FAISS local |
| **Embeddings** | - | OpenAI text-embedding-3-small | nomic-embed-text |
| **LLM** | Claude/GPT/Ollama | Same + RAG context | Fine-tuned Llama 3 |
| **Backend** | Rust (Tauri) | Same | Same |
| **Frontend** | React + TypeScript | Same + Portal | Same |

---

## Data Model

### Extended Schema

```sql
-- ============================================================================
-- MIGRATION 006: Intelligence Platform Foundation
-- ============================================================================

-- 1. FEEDBACK TRACKING
-- Captures user corrections and ratings on AI outputs
CREATE TABLE analysis_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    feedback_type TEXT NOT NULL CHECK(feedback_type IN ('accept', 'reject', 'edit', 'rating')),
    field_name TEXT,              -- Which field was edited (root_cause, suggested_fixes, etc.)
    original_value TEXT,
    new_value TEXT,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    feedback_at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id TEXT,                 -- Optional: for multi-user scenarios
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);

-- 2. GOLD ANALYSES (Curated Truth)
-- Verified, high-quality analyses for RAG retrieval and training
CREATE TABLE gold_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_analysis_id INTEGER,
    source_type TEXT NOT NULL CHECK(source_type IN ('crash', 'ticket', 'manual')),
    error_signature TEXT NOT NULL,
    crash_content_hash TEXT,
    root_cause TEXT NOT NULL,
    suggested_fixes TEXT NOT NULL,  -- JSON array
    component TEXT,
    severity TEXT,
    whats_on_version TEXT,
    validation_status TEXT DEFAULT 'pending' CHECK(validation_status IN ('pending', 'verified', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_by TEXT,
    times_referenced INTEGER DEFAULT 0,
    success_rate DECIMAL,           -- From feedback: % of times this fix worked
    FOREIGN KEY (source_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL
);

-- 3. RETRIEVAL CHUNKS (RAG)
-- Embedded content for semantic search
CREATE TABLE retrieval_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL CHECK(source_type IN ('analysis', 'gold', 'ticket', 'documentation', 'runbook')),
    source_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    embedding BLOB,                 -- Binary vector (f32 array)
    embedding_model TEXT,           -- e.g., "text-embedding-3-small"
    metadata_json TEXT,             -- {"component": "EPG", "severity": "critical", ...}
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. JIRA TICKETS (Support Intelligence)
-- Cached JIRA ticket data for analysis and training
CREATE TABLE jira_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jira_key TEXT NOT NULL UNIQUE,  -- e.g., "SUPPORT-4521"
    project TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT,
    component TEXT,
    priority TEXT,
    status TEXT,
    resolution TEXT,
    resolution_notes TEXT,
    root_cause TEXT,                -- Extracted or manually entered
    customer_id TEXT,
    whatson_version TEXT,
    environment TEXT,
    created_at TEXT,
    resolved_at TEXT,
    resolution_time_hours DECIMAL,
    is_resolved BOOLEAN DEFAULT FALSE,
    last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    hadron_analysis_id INTEGER,     -- Link to Hadron analysis if created
    FOREIGN KEY (hadron_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL
);

-- 5. TICKET SYMPTOMS (Extracted patterns)
CREATE TABLE ticket_symptoms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    symptom_type TEXT NOT NULL CHECK(symptom_type IN ('error_code', 'behavior', 'performance', 'data_issue', 'integration')),
    symptom_value TEXT NOT NULL,
    confidence DECIMAL,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (ticket_id) REFERENCES jira_tickets(id) ON DELETE CASCADE
);

-- 6. DOCUMENTATION SOURCES
-- Ingested documentation for RAG
CREATE TABLE documentation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL CHECK(source_type IN ('runbook', 'user_guide', 'release_notes', 'known_issue', 'faq')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    file_path TEXT,                 -- Original file location
    url TEXT,                       -- Confluence/wiki URL if applicable
    component TEXT,
    whatson_version TEXT,
    last_updated TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. SUGGESTION FEEDBACK (Ticket-specific)
-- Track which suggestions helped resolve tickets
CREATE TABLE suggestion_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    gold_analysis_id INTEGER,       -- Which gold record was suggested
    suggestion_text TEXT,
    was_helpful BOOLEAN,
    engineer_notes TEXT,
    actual_resolution TEXT,         -- What actually fixed it
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (ticket_id) REFERENCES jira_tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (gold_analysis_id) REFERENCES gold_analyses(id) ON DELETE SET NULL
);

-- INDEXES
CREATE INDEX idx_feedback_analysis ON analysis_feedback(analysis_id);
CREATE INDEX idx_gold_signature ON gold_analyses(error_signature);
CREATE INDEX idx_gold_component ON gold_analyses(component);
CREATE INDEX idx_chunks_source ON retrieval_chunks(source_type, source_id);
CREATE INDEX idx_chunks_embedding ON retrieval_chunks(embedding_model) WHERE embedding IS NOT NULL;
CREATE INDEX idx_tickets_key ON jira_tickets(jira_key);
CREATE INDEX idx_tickets_component ON jira_tickets(component);
CREATE INDEX idx_tickets_resolved ON jira_tickets(is_resolved, resolved_at);
CREATE INDEX idx_symptoms_ticket ON ticket_symptoms(ticket_id);
CREATE INDEX idx_docs_component ON documentation(component);

-- Add embedding columns to analyses (existing table)
ALTER TABLE analyses ADD COLUMN embedding BLOB;
ALTER TABLE analyses ADD COLUMN embedding_model TEXT;
ALTER TABLE analyses ADD COLUMN feedback_status TEXT DEFAULT 'pending';
ALTER TABLE analyses ADD COLUMN gold_record_id INTEGER REFERENCES gold_analyses(id);
```

### WHATS'ON Taxonomies

```yaml
# configs/whatson_taxonomy.yaml

components:
  - id: epg
    name: EPG Management
    aliases: ["electronic program guide", "schedule import", "epg feed"]
  - id: rights
    name: Rights & Contracts
    aliases: ["licensing", "rights management", "contract"]
  - id: scheduling
    name: Scheduling
    aliases: ["planner", "scheduler", "broadcast schedule"]
  - id: playout
    name: Playout Integration
    aliases: ["automation", "playout", "broadcast output"]
  - id: mam
    name: Media Asset Management
    aliases: ["media", "assets", "content management"]
  - id: reporting
    name: Reporting & Analytics
    aliases: ["reports", "dashboards", "analytics"]
  - id: admin
    name: User Management
    aliases: ["users", "permissions", "authentication"]
  - id: api
    name: API/Integrations
    aliases: ["rest api", "integration", "web services"]
  - id: workflow
    name: Workflow Engine
    aliases: ["workflows", "automation rules", "business logic"]
  - id: database
    name: Database/Performance
    aliases: ["oracle", "sql", "performance", "database"]

symptom_categories:
  - id: data_sync_failure
    patterns: ["sync failed", "replication error", "data mismatch"]
  - id: performance_degradation
    patterns: ["slow", "timeout", "high cpu", "memory"]
  - id: ui_error
    patterns: ["ui freeze", "display error", "rendering"]
  - id: integration_timeout
    patterns: ["connection timeout", "api error", "service unavailable"]
  - id: rights_calculation_error
    patterns: ["rights violation", "license error", "contract mismatch"]
  - id: scheduling_conflict
    patterns: ["overlap", "conflict", "double booking"]
  - id: epg_feed_parsing
    patterns: ["parse error", "invalid xml", "feed rejected"]
  - id: workflow_stuck
    patterns: ["workflow blocked", "stuck", "pending indefinitely"]
  - id: authentication_issue
    patterns: ["login failed", "session expired", "unauthorized"]
  - id: data_corruption
    patterns: ["corrupt", "invalid state", "data integrity"]

severity_mapping:
  on_air_impact: critical
  data_loss_risk: critical
  workflow_blocked: high
  degraded_performance: medium
  ui_inconvenience: low
  feature_request: info
```

---

## Development Phases

### Phase Overview

| Phase | Focus | Duration | Key Deliverables |
|-------|-------|----------|------------------|
| **Phase 1** | Feedback Foundation | 4 weeks | Feedback UI, gold curation, export |
| **Phase 2** | RAG Integration | 6 weeks | Embeddings, retrieval, enhanced prompts |
| **Phase 3** | JIRA Intelligence | 4 weeks | Ticket reading, analysis, suggestions |
| **Phase 4** | Fine-tuning & API | 6 weeks | Training pipeline, REST API |
| **Phase 5** | Portals & Offline | 8 weeks | Customer portal, local models |

**Total: ~28 weeks (7 months)**

---

## Phase 1: Feedback Foundation (Weeks 1-4)

### Goal
Capture user feedback to build training data and improve suggestions over time.

### Tasks

#### 1.1 Database Schema (Week 1) ✅ COMPLETE
- [x] Create migration 006 with feedback and gold tables
- [x] Add embedding columns to analyses
- [x] Implement CRUD operations in `database.rs`

#### 1.2 Feedback UI Components (Week 2) ✅ COMPLETE
- [x] Add thumbs up/down buttons to `WhatsOnDetailView.tsx`
- [x] Add inline edit capability for root cause and fixes
- [x] Add 5-star rating component to `AnalysisDetailView.tsx`
- [x] Track edit diffs for training data

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ROOT CAUSE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ BMProgramSegmentDurations>>calculateTotalDuration sends         │
│ #rootClass to a nil object when segment data is missing.        │
│                                                                 │
│ [👍 Correct]  [👎 Wrong]  [✏️ Edit]                             │
└─────────────────────────────────────────────────────────────────┘
│                                                                 │
│ Was this analysis helpful?  ★★★★☆                              │
└─────────────────────────────────────────────────────────────────┘
```

#### 1.3 Gold Curation Workflow (Week 3) ✅ COMPLETE
- [x] Add "Promote to Gold" action in history view
- [x] Create gold review queue UI (`GoldReviewQueue.tsx`)
- [x] Implement automatic promotion criteria:
  - Rating >= 4/5
  - No edits required
  - Linked to resolved JIRA (if applicable)

#### 1.4 Export Pipeline (Week 4) ⏳ PENDING
- [ ] Implement JSONL export command
- [ ] Support OpenAI fine-tuning format
- [ ] Add PII redaction expansion
- [ ] Create basic evaluation harness with 50 test cases

**Export Format:**
```json
{"messages":[
  {"role":"system","content":"You are a WHATS'ON crash analysis expert..."},
  {"role":"user","content":"<redacted_crash_log>"},
  {"role":"assistant","content":"<analysis_json>"}
]}
```

### Success Criteria
- [ ] 100+ analyses with feedback collected
- [ ] 25+ gold analyses curated
- [ ] Export produces valid OpenAI JSONL
- [ ] Baseline accuracy measured on test set

**Phase 1 Status: ✅ 75% Complete** - Core feedback and gold curation infrastructure done. Export pipeline pending.

---

## Phase 2: RAG Integration (Weeks 5-10)

### Goal
Enhance analysis quality by retrieving similar past cases.

### Tasks

#### 2.1 Embedding Pipeline (Weeks 5-6) ✅ COMPLETE
- [x] Integrate OpenAI Embeddings API in Python (`embeddings.py`)
- [x] Add embedding generation after analysis completion (auto-indexing hook)
- [x] Implement chunking strategy (`chunking.py`):
  - Stack trace → 1 chunk
  - Root cause + fix → 1 chunk
  - Full analysis → 1 chunk
- [x] Store embeddings in ChromaDB vector store (`chroma_store.py`)

**Rust Implementation:**
```rust
// src-tauri/src/rag/embeddings.rs
pub async fn generate_embedding(
    content: &str,
    model: &str,  // "text-embedding-3-small"
) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/embeddings")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&json!({
            "model": model,
            "input": content
        }))
        .send()
        .await?;

    let result: EmbeddingResponse = response.json().await?;
    Ok(result.data[0].embedding.clone())
}
```

#### 2.2 Retrieval Implementation (Weeks 7-8) ✅ COMPLETE
- [x] Implement cosine similarity search via ChromaDB
- [x] Add Python sidecar with Tauri bridge (`rag_commands.rs`)
- [x] Implement hybrid retrieval (BM25 + vector) in `chroma_store.py`
- [x] Add metadata filtering (component, severity, version)

**Hybrid Retrieval:**
```rust
pub async fn retrieve_similar(
    query: &str,
    filters: &RetrievalFilters,
    top_k: usize,
) -> Result<Vec<RetrievalResult>, String> {
    // 1. Get BM25 candidates from FTS5
    let fts_results = db.search_fts(query, top_k * 3)?;

    // 2. Get vector candidates
    let query_embedding = generate_embedding(query, "text-embedding-3-small").await?;
    let vector_results = search_vectors(&query_embedding, filters, top_k * 3)?;

    // 3. Merge with weighted scoring
    // Score = 0.3 × BM25_score + 0.7 × cosine_similarity
    let merged = merge_and_rank(fts_results, vector_results, 0.3);

    Ok(merged.into_iter().take(top_k).collect())
}
```

#### 2.3 RAG-Enhanced Prompts (Week 9) ⏳ PENDING
- [ ] Update system prompts to include retrieved context
- [ ] Add citation requirements (reference similar cases)
- [ ] Implement confidence scoring based on retrieval quality

**RAG Prompt Template:**
```
You are analyzing a WHATS'ON crash log. Use these similar past cases as reference:

## Similar Cases Found:
{for each retrieved_case}
### Case #{index}: {error_type} in {component}
**Similarity:** {similarity_score}%
**Root Cause:** {root_cause}
**Resolution:** {suggested_fix}
**Verified:** {is_gold}
{end for}

## Current Crash Log:
{crash_content}

## Instructions:
1. Analyze the current crash using insights from similar cases
2. CITE which past case(s) informed your analysis (e.g., "Similar to Case #2")
3. If no similar cases are relevant, state this explicitly
4. Return JSON in the standard format
```

#### 2.4 A/B Testing (Week 10) ⏳ PENDING
- [ ] Implement feature flag for RAG mode
- [ ] Compare RAG vs baseline on test set
- [ ] Measure retrieval latency
- [ ] Gather user feedback on relevance

### Success Criteria
- [ ] RAG improves fix acceptance by 15%+
- [ ] <500ms retrieval latency for 10K records
- [ ] Users report similar cases as relevant 70%+ of time
- [ ] No regression on edge cases

**Phase 2 Status: 🔄 60% Complete** - RAG infrastructure built (embeddings, retrieval, Tauri bridge). Integration with AI prompts and A/B testing pending.

---

## Phase 3: JIRA Intelligence (Weeks 11-14)

### Goal
Extend Hadron to analyze JIRA support tickets and provide suggestions.

### Tasks

#### 3.1 JIRA Read Integration (Week 11)
- [ ] Extend `jira.ts` service with read capabilities
- [ ] Implement ticket fetching by key, JQL query
- [ ] Add webhook receiver for real-time updates (optional)
- [ ] Cache tickets in `jira_tickets` table

**TypeScript Service:**
```typescript
// src/services/jira.ts (extended)
export async function fetchTicket(key: string): Promise<JiraTicket> {
    const response = await jiraClient.get(`/rest/api/3/issue/${key}`);
    return mapJiraResponse(response.data);
}

export async function searchTickets(jql: string, maxResults = 50): Promise<JiraTicket[]> {
    const response = await jiraClient.post('/rest/api/3/search', {
        jql,
        maxResults,
        fields: ['summary', 'description', 'components', 'priority', 'status', 'resolution', 'customfield_*']
    });
    return response.data.issues.map(mapJiraResponse);
}

export async function syncResolvedTickets(since: string): Promise<number> {
    const jql = `project = SUPPORT AND status = Resolved AND resolved >= "${since}" ORDER BY resolved DESC`;
    const tickets = await searchTickets(jql, 100);

    for (const ticket of tickets) {
        await invoke('upsert_jira_ticket', { ticket });
        await invoke('extract_ticket_symptoms', { ticketId: ticket.id });
    }

    return tickets.length;
}
```

#### 3.2 Ticket Analysis (Week 12)
- [ ] Create symptom extraction prompts
- [ ] Implement component classification
- [ ] Generate embeddings for tickets
- [ ] Store in unified retrieval index

**Symptom Extraction Prompt:**
```
Analyze this JIRA support ticket and extract structured information:

TICKET: {jira_key}
SUMMARY: {summary}
DESCRIPTION: {description}

Extract as JSON:
{
  "primary_component": "one of: epg, rights, scheduling, playout, mam, reporting, admin, api, workflow, database",
  "symptoms": [
    {
      "type": "error_code | behavior | performance | data_issue | integration",
      "description": "specific observable symptom",
      "entities": ["affected items: channels, customers, time ranges"]
    }
  ],
  "severity_assessment": {
    "level": "critical | high | medium | low",
    "reasoning": "why this severity"
  },
  "related_error_patterns": ["any error codes or stack traces mentioned"]
}
```

#### 3.3 Suggestion Generation (Week 13)
- [ ] Retrieve similar tickets AND crash analyses
- [ ] Generate actionable suggestions
- [ ] Post suggestions back to JIRA as comment
- [ ] Track suggestion feedback

**Suggestion Generation Flow:**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  New Ticket │────▶│  Extract    │────▶│  Retrieve   │────▶│  Generate   │
│  (JIRA)     │     │  Symptoms   │     │  Similar    │     │  Suggestion │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                   │
                    ┌──────────────────────────────────────────────┘
                    ▼
            ┌─────────────────────────────────────────────────────────┐
            │  Post to JIRA:                                          │
            │  🤖 **Hadron Analysis** (Confidence: 87%)               │
            │                                                         │
            │  **Likely Cause:** Secondary channel EPG propagation... │
            │                                                         │
            │  **Similar Cases:**                                     │
            │  • SUPPORT-3892 (94% match) - Channel group refresh     │
            │  • CRASH-2024-1015 (78% match) - Cache invalidation     │
            │                                                         │
            │  **Suggested Actions:**                                 │
            │  1. Verify channel linkage in Admin > Channels          │
            │  2. Check EPG refresh job timing                        │
            └─────────────────────────────────────────────────────────┘
```

#### 3.4 Support Dashboard (Week 14)
- [ ] Create ticket queue view in Hadron
- [ ] Show AI suggestions inline
- [ ] Enable one-click feedback
- [ ] Display ticket-to-crash correlations

### Success Criteria
- [ ] Analyze 100+ historical tickets
- [ ] 70%+ of suggestions rated helpful
- [ ] Successfully correlate tickets with crash logs
- [ ] Engineers report time savings

---

## Phase 4: Fine-tuning & API (Weeks 15-20)

### Goal
Train custom models and expose capabilities via API.

### Tasks

#### 4.1 Dataset Curation (Weeks 15-16)
- [ ] Export 1,000+ gold examples
- [ ] Balance across components and severity levels
- [ ] Manual review for quality
- [ ] Create held-out test set (100 examples)

#### 4.2 Fine-tuning Pipeline (Weeks 17-18)
- [ ] Upload training data to OpenAI
- [ ] Train gpt-4o-mini fine-tuned model
- [ ] Evaluate on held-out test set
- [ ] Compare to baseline and RAG-only

**Fine-tuning Command:**
```bash
# Upload training file
openai api files.create -f hadron_training.jsonl -p fine-tune

# Create fine-tuning job
openai api fine_tuning.jobs.create \
  -t file-xxx \
  -m gpt-4o-mini-2024-07-18 \
  --suffix "hadron-v1"
```

#### 4.3 REST API (Weeks 19-20)
- [ ] Create FastAPI service wrapping Hadron analysis
- [ ] Implement endpoints:
  - `POST /analyze` - Analyze crash log or ticket
  - `GET /search` - Search knowledge base
  - `POST /feedback` - Submit feedback
  - `POST /ingest` - Add to knowledge base
- [ ] Add authentication (API keys)
- [ ] Document with OpenAPI spec

**API Schema:**
```yaml
paths:
  /analyze:
    post:
      summary: Analyze a crash log or support ticket
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                content:
                  type: string
                  description: Crash log content or ticket description
                content_type:
                  type: string
                  enum: [crash_log, jira_ticket]
                metadata:
                  type: object
                  properties:
                    component: { type: string }
                    customer_id: { type: string }
                    version: { type: string }
      responses:
        200:
          description: Analysis results
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AnalysisResult'

  /search:
    get:
      summary: Search knowledge base for similar cases
      parameters:
        - name: query
          in: query
          required: true
          schema: { type: string }
        - name: component
          in: query
          schema: { type: string }
        - name: limit
          in: query
          schema: { type: integer, default: 5 }
      responses:
        200:
          description: Similar cases
```

### Success Criteria
- [ ] Fine-tuned model beats baseline by 20%+
- [ ] API handles 100 requests/minute
- [ ] Cost reduction of 30%+ vs base model
- [ ] No regression on edge cases

---

## Phase 5: Portals & Offline (Weeks 21-28)

### Goal
Customer-facing portal and fully local deployment option.

### Tasks

#### 5.1 Customer Self-Service Portal (Weeks 21-24)
- [ ] Create separate React app for customers
- [ ] Implement issue description input
- [ ] Show suggested solutions before ticket creation
- [ ] Track deflection rate (issues resolved without ticket)
- [ ] Implement multi-tenant data isolation

**Portal UI:**
```
┌─────────────────────────────────────────────────────────────────┐
│  WHATS'ON SUPPORT                              [Customer: VRT]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Describe your issue:                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ EPG updates not showing on Canvas and Ketnet channels   │   │
│  │ since yesterday morning. Main channels work fine.       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [🔍 Find Solutions]                                           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  💡 SUGGESTED SOLUTIONS                                         │
│                                                                 │
│  This sounds like a secondary channel propagation issue.        │
│                                                                 │
│  TRY THESE STEPS:                                               │
│  1. Go to Admin → Channel Groups                                │
│  2. Verify Canvas and Ketnet are linked to main EPG source     │
│  3. Click "Refresh Linkage" on affected channels               │
│                                                                 │
│  [✓ This solved my issue]  [Open Support Ticket →]             │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.2 Local Model Training (Weeks 25-26)
- [ ] Set up QLoRA training pipeline
- [ ] Train Llama 3.1 8B on gold dataset
- [ ] Quantize to 4-bit for inference
- [ ] Package as Ollama model

**QLoRA Config:**
```yaml
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
quantization:
  bits: 4
  quant_type: "nf4"
```

#### 5.3 Local RAG Stack (Weeks 27-28)
- [ ] Integrate local embedding model (nomic-embed-text)
- [ ] Replace OpenAI embeddings with local
- [ ] Ensure FAISS works fully offline
- [ ] Create offline deployment package

**Offline Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    HADRON OFFLINE MODE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │  Ollama         │    │  FAISS          │                    │
│  │  (Local LLM)    │    │  (Local Vector) │                    │
│  │                 │    │                 │                    │
│  │  hadron-v1      │    │  index.faiss    │                    │
│  │  (fine-tuned)   │    │  (embeddings)   │                    │
│  └────────┬────────┘    └────────┬────────┘                    │
│           │                      │                              │
│           └──────────┬───────────┘                              │
│                      ▼                                          │
│           ┌─────────────────────┐                               │
│           │  nomic-embed-text   │                               │
│           │  (local embeddings) │                               │
│           └─────────────────────┘                               │
│                                                                 │
│  Requirements: 16GB RAM, 8GB VRAM (RTX 3060+)                  │
│  No internet connection required                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Success Criteria
- [ ] Customer portal deflects 30%+ issues
- [ ] Local model within 10% of cloud quality
- [ ] Works on 16GB RAM / 8GB VRAM machine
- [ ] Zero external API calls in offline mode

---

## Success Metrics

### Operational Metrics

| Metric | Baseline | Phase 2 Target | Phase 5 Target |
|--------|----------|----------------|----------------|
| Fix acceptance rate | ~50% | 65% | 75% |
| Time to first suggestion | N/A | <5 sec | <3 sec |
| Similar case relevance | N/A | 70% | 80% |
| Ticket deflection rate | 0% | N/A | 30% |

### Quality Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Root cause accuracy | ~70% | 85% |
| Component classification | ~80% | 95% |
| Hallucination rate | ~10% | <5% |
| Gold dataset size | 0 | 1,000+ |

### Business Metrics

| Metric | Target |
|--------|--------|
| Support cost per ticket | -30% |
| Mean time to resolution | -40% |
| Customer satisfaction | +15% |
| Engineer productivity | +50% |

---

## Resource Requirements

### Development Effort

| Phase | Duration | Skills Required |
|-------|----------|-----------------|
| Phase 1 | 4 weeks | Rust, TypeScript, SQLite |
| Phase 2 | 6 weeks | ML/Embeddings, Search |
| Phase 3 | 4 weeks | JIRA API, TypeScript |
| Phase 4 | 6 weeks | ML Ops, FastAPI |
| Phase 5 | 8 weeks | Local ML, React |

**Total: ~28 weeks**

### Infrastructure Costs (Monthly)

| Component | Cloud | Self-Hosted |
|-----------|-------|-------------|
| Embeddings API | $50-100 | Free (local) |
| LLM API | $100-500 | Free (local) |
| Vector storage | $0 (FAISS) | $0 |
| Fine-tuning | $50-100 (one-time) | GPU rental |
| **Total** | **$150-600/mo** | **$0 + hardware** |

### Hardware (Offline Deployment)

| Tier | GPU | RAM | Use Case |
|------|-----|-----|----------|
| Minimum | RTX 3060 12GB | 16GB | Inference only |
| Recommended | RTX 4070 12GB | 32GB | Inference + light training |
| Power User | RTX 4090 24GB | 64GB | Full local training |

---

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Insufficient training data | High | Medium | Start feedback collection immediately |
| Poor retrieval relevance | Medium | Medium | Tune similarity thresholds, add filters |
| JIRA API rate limits | Low | Medium | Cache aggressively, batch requests |
| Fine-tuned model regression | Medium | Low | Keep baseline fallback, A/B test |
| PII leakage in training | Critical | Low | Multi-layer redaction, manual review |
| Local model too slow | Medium | Medium | Use quantization, batch processing |
| Customer portal adoption | Medium | Medium | Make UX frictionless, track deflection |

---

## Appendix A: API Contracts

### Analysis Request

```typescript
interface AnalyzeRequest {
  content: string;
  content_type: 'crash_log' | 'jira_ticket';
  metadata?: {
    component?: string;
    customer_id?: string;
    version?: string;
    jira_key?: string;
  };
  options?: {
    use_rag?: boolean;
    max_similar_cases?: number;
    include_documentation?: boolean;
  };
}

interface AnalyzeResponse {
  analysis_id: number;
  classification: {
    component: string;
    severity: string;
    error_type: string;
    symptoms: Symptom[];
  };
  root_cause: {
    technical: string;
    plain_english: string;
  };
  suggested_fixes: SuggestedFix[];
  similar_cases: SimilarCase[];
  confidence: number;
  citations: string[];  // References to similar cases used
}
```

### Feedback Request

```typescript
interface FeedbackRequest {
  analysis_id: number;
  feedback_type: 'accept' | 'reject' | 'edit' | 'rating';
  field_name?: string;
  original_value?: string;
  new_value?: string;
  rating?: number;  // 1-5
  notes?: string;
}
```

---

## Appendix B: Prompt Templates

### Crash Analysis (RAG-Enhanced)

```
You are a WHATS'ON broadcast management system expert. Analyze the crash log using the provided similar cases as reference.

## Similar Cases:
{similar_cases}

## Current Crash Log:
{crash_content}

## Instructions:
1. Identify the root cause based on the error type and stack trace
2. CITE similar cases that informed your analysis (e.g., "Similar to Case #2")
3. Provide actionable fix suggestions specific to WHATS'ON
4. Rate your confidence based on similarity match quality

Return JSON matching the WhatsOnEnhancedAnalysis schema.
```

### Ticket Symptom Extraction

```
Analyze this JIRA support ticket for a WHATS'ON broadcast management system.

TICKET: {jira_key}
SUMMARY: {summary}
DESCRIPTION: {description}

Extract structured information as JSON:
{
  "primary_component": "epg|rights|scheduling|playout|mam|reporting|admin|api|workflow|database",
  "symptoms": [{
    "type": "error_code|behavior|performance|data_issue|integration",
    "description": "observable symptom",
    "entities": ["affected items"]
  }],
  "severity": "critical|high|medium|low",
  "severity_reasoning": "explanation",
  "related_errors": ["error patterns mentioned"]
}
```

### Ticket Suggestion Generation

```
You are a WHATS'ON support expert. Based on this ticket and similar resolved issues, provide actionable suggestions.

CURRENT TICKET:
{ticket_details}

SIMILAR RESOLVED TICKETS:
{similar_tickets}

RELATED CRASH ANALYSES:
{related_crashes}

RELEVANT DOCUMENTATION:
{documentation}

Provide:
1. LIKELY CAUSE: Most probable root cause
2. SIMILAR CASES: Reference specific tickets/crashes with resolution summary
3. SUGGESTED ACTIONS: Step-by-step troubleshooting
4. ESCALATION TRIGGERS: When to escalate to development
5. CONFIDENCE: high/medium/low with reasoning

Use WHATS'ON terminology. Be specific and actionable.
```

---

## Conclusion

This consolidated roadmap provides a clear path from Hadron's current crash analysis capabilities to a comprehensive Support Intelligence Platform. The phased approach allows for:

1. **Immediate value** (Phase 1-2): Better crash analyses through feedback and RAG
2. **Extended scope** (Phase 3): Support ticket intelligence
3. **Scalability** (Phase 4): API access and fine-tuned models
4. **Independence** (Phase 5): Fully offline operation and customer self-service

**Recommended Immediate Actions:**
1. Implement feedback capture UI (Phase 1.2)
2. Start collecting gold analyses manually
3. Extend JIRA service with read capabilities
4. Set up embedding pipeline with OpenAI

The architecture is designed to be modular - each phase delivers standalone value while building toward the complete vision.
