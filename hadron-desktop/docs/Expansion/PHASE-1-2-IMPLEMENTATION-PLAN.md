# Phase 1-2 Implementation Plan
## Parallel Execution Strategy

**Branch:** `feature/hadron-intelligence-phase1-2`

**Duration:** 6 weeks (parallelized from 10 weeks sequential)

**Reference Resources:**
- `C:\Projects\GitHub_tools\Github_rag\chatgpt-retrieval-plugin` - RAG patterns, Chroma, chunking
- `C:\Projects\Hadron_v3\hadron-desktop\CONSOLIDATED-ROADMAP.md` - Full roadmap

---

## Parallel Execution Overview

```
Week 1    Week 2    Week 3    Week 4    Week 5    Week 6
──────────────────────────────────────────────────────────────
SHARED FOUNDATION (Week 1)
├─ Database Schema Migration
├─ Python RAG Service Setup
└─ Type Definitions

STREAM A: FEEDBACK (Weeks 2-4)          STREAM B: RAG (Weeks 2-5)
├─ Feedback UI Components               ├─ Embedding Pipeline
├─ Gold Curation Workflow               ├─ Vector Store (Chroma)
├─ JSONL Export                         ├─ Retrieval Service
└─ Evaluation Harness                   └─ Hybrid Search

                    INTEGRATION (Weeks 5-6)
                    ├─ RAG-Enhanced Prompts
                    ├─ Citation System
                    ├─ A/B Testing
                    └─ Documentation
```

---

## Week 1: Shared Foundation

### 1.1 Database Schema Migration

**File:** `src-tauri/src/database.rs`

```sql
-- Migration 006: Intelligence Platform Foundation

-- Feedback tracking
CREATE TABLE IF NOT EXISTS analysis_feedback (
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

-- Gold analyses (curated truth)
CREATE TABLE IF NOT EXISTS gold_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_analysis_id INTEGER,
    source_type TEXT NOT NULL DEFAULT 'crash',
    error_signature TEXT NOT NULL,
    crash_content_hash TEXT,
    root_cause TEXT NOT NULL,
    suggested_fixes TEXT NOT NULL,
    component TEXT,
    severity TEXT,
    validation_status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_by TEXT,
    times_referenced INTEGER DEFAULT 0,
    success_rate REAL,
    FOREIGN KEY (source_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL
);

-- Retrieval chunks for RAG
CREATE TABLE IF NOT EXISTS retrieval_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL CHECK(source_type IN ('analysis', 'gold', 'ticket', 'documentation')),
    source_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    embedding BLOB,
    embedding_model TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON analysis_feedback(analysis_id);
CREATE INDEX IF NOT EXISTS idx_gold_signature ON gold_analyses(error_signature);
CREATE INDEX IF NOT EXISTS idx_gold_component ON gold_analyses(component);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON retrieval_chunks(source_type, source_id);

-- Extend analyses table
ALTER TABLE analyses ADD COLUMN embedding BLOB;
ALTER TABLE analyses ADD COLUMN embedding_model TEXT;
ALTER TABLE analyses ADD COLUMN feedback_status TEXT DEFAULT 'pending';
```

**Tasks:**
- [ ] Create migration file in `src-tauri/src/database.rs`
- [ ] Add Rust structs for new tables
- [ ] Implement CRUD operations
- [ ] Write migration tests

**Effort:** 2 days

---

### 1.2 Python RAG Service Setup

**Location:** `python/rag/` (new directory)

Leverage code from `Github_rag/chatgpt-retrieval-plugin`:

```
python/
├── rag/
│   ├── __init__.py
│   ├── datastore.py          # Adapted from chatgpt-retrieval-plugin
│   ├── chroma_store.py       # Adapted ChromaDataStore
│   ├── chunks.py             # Adapted chunking service
│   ├── embeddings.py         # OpenAI embeddings wrapper
│   ├── retrieval.py          # Hybrid retrieval logic
│   └── models.py             # Pydantic models
├── requirements-rag.txt
└── rag_service.py            # CLI interface for Tauri
```

**Tasks:**
- [ ] Create directory structure
- [ ] Copy and adapt `datastore.py` base class
- [ ] Copy and adapt `chroma_datastore.py`
- [ ] Copy and adapt `chunks.py`
- [ ] Create `requirements-rag.txt`:
  ```
  chromadb>=0.4.0
  tiktoken>=0.5.0
  openai>=1.0.0
  pydantic>=2.0.0
  tenacity>=8.0.0
  ```
- [ ] Create Tauri command to invoke Python service

**Effort:** 3 days

---

### 1.3 TypeScript Type Definitions

**File:** `src/types/index.ts` (extend)

```typescript
// Feedback types
export interface AnalysisFeedback {
  id?: number;
  analysis_id: number;
  feedback_type: 'accept' | 'reject' | 'edit' | 'rating';
  field_name?: string;
  original_value?: string;
  new_value?: string;
  rating?: number;
  feedback_at?: string;
}

// Gold analysis types
export interface GoldAnalysis {
  id: number;
  source_analysis_id?: number;
  source_type: 'crash' | 'ticket' | 'manual';
  error_signature: string;
  crash_content_hash?: string;
  root_cause: string;
  suggested_fixes: string[];
  component?: string;
  severity?: string;
  validation_status: 'pending' | 'verified' | 'rejected';
  created_at: string;
  verified_by?: string;
  times_referenced: number;
  success_rate?: number;
}

// RAG types
export interface RetrievalChunk {
  id: number;
  source_type: 'analysis' | 'gold' | 'ticket' | 'documentation';
  source_id: number;
  chunk_index: number;
  content: string;
  metadata: ChunkMetadata;
  score?: number;
}

export interface ChunkMetadata {
  component?: string;
  severity?: string;
  error_type?: string;
  version?: string;
}

export interface RetrievalResult {
  chunks: RetrievalChunk[];
  query: string;
  total_found: number;
}

export interface RAGContext {
  similar_analyses: SimilarCase[];
  gold_matches: GoldAnalysis[];
  confidence_boost: number;
}

export interface SimilarCase {
  analysis_id: number;
  similarity_score: number;
  root_cause: string;
  suggested_fixes: string[];
  is_gold: boolean;
  citation_id: string;
}
```

**Effort:** 1 day

---

## Stream A: Feedback System (Weeks 2-4)

### A.1 Feedback UI Components (Week 2)

#### A.1.1 FeedbackButtons Component

**File:** `src/components/FeedbackButtons.tsx` (new)

```typescript
import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnalysisFeedback } from '../types';

interface FeedbackButtonsProps {
  analysisId: number;
  fieldName: string;
  currentValue: string;
  onFeedbackSubmitted?: (feedback: AnalysisFeedback) => void;
}

export const FeedbackButtons: React.FC<FeedbackButtonsProps> = ({
  analysisId,
  fieldName,
  currentValue,
  onFeedbackSubmitted
}) => {
  const [status, setStatus] = useState<'idle' | 'accepted' | 'rejected'>('idle');

  const submitFeedback = async (type: 'accept' | 'reject') => {
    const feedback: AnalysisFeedback = {
      analysis_id: analysisId,
      feedback_type: type,
      field_name: fieldName,
      original_value: currentValue,
    };

    await invoke('submit_analysis_feedback', { feedback });
    setStatus(type === 'accept' ? 'accepted' : 'rejected');
    onFeedbackSubmitted?.(feedback);
  };

  return (
    <div className="feedback-buttons">
      <button
        className={`feedback-btn ${status === 'accepted' ? 'active' : ''}`}
        onClick={() => submitFeedback('accept')}
        disabled={status !== 'idle'}
        title="This is correct"
      >
        👍
      </button>
      <button
        className={`feedback-btn ${status === 'rejected' ? 'active' : ''}`}
        onClick={() => submitFeedback('reject')}
        disabled={status !== 'idle'}
        title="This is incorrect"
      >
        👎
      </button>
    </div>
  );
};
```

#### A.1.2 InlineEditor Component

**File:** `src/components/InlineEditor.tsx` (new)

```typescript
import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface InlineEditorProps {
  analysisId: number;
  fieldName: string;
  value: string;
  onSave: (newValue: string) => void;
}

export const InlineEditor: React.FC<InlineEditorProps> = ({
  analysisId,
  fieldName,
  value,
  onSave
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState(value);

  const handleSave = async () => {
    await invoke('submit_analysis_feedback', {
      feedback: {
        analysis_id: analysisId,
        feedback_type: 'edit',
        field_name: fieldName,
        original_value: value,
        new_value: editedValue,
      }
    });
    onSave(editedValue);
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <div className="inline-editor">
        <span>{value}</span>
        <button onClick={() => setIsEditing(true)} title="Edit">✏️</button>
      </div>
    );
  }

  return (
    <div className="inline-editor editing">
      <textarea
        value={editedValue}
        onChange={(e) => setEditedValue(e.target.value)}
        rows={4}
      />
      <div className="editor-actions">
        <button onClick={handleSave}>Save</button>
        <button onClick={() => { setIsEditing(false); setEditedValue(value); }}>Cancel</button>
      </div>
    </div>
  );
};
```

#### A.1.3 StarRating Component

**File:** `src/components/StarRating.tsx` (new)

```typescript
import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface StarRatingProps {
  analysisId: number;
  initialRating?: number;
  onRatingChange?: (rating: number) => void;
}

export const StarRating: React.FC<StarRatingProps> = ({
  analysisId,
  initialRating = 0,
  onRatingChange
}) => {
  const [rating, setRating] = useState(initialRating);
  const [hover, setHover] = useState(0);

  const handleRating = async (value: number) => {
    setRating(value);
    await invoke('submit_analysis_feedback', {
      feedback: {
        analysis_id: analysisId,
        feedback_type: 'rating',
        rating: value,
      }
    });
    onRatingChange?.(value);
  };

  return (
    <div className="star-rating">
      <span>Was this analysis helpful?</span>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          className={`star ${star <= (hover || rating) ? 'filled' : ''}`}
          onClick={() => handleRating(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
        >
          ★
        </button>
      ))}
    </div>
  );
};
```

**Tasks:**
- [ ] Create `FeedbackButtons.tsx`
- [ ] Create `InlineEditor.tsx`
- [ ] Create `StarRating.tsx`
- [ ] Add styles to `src/styles.css`
- [ ] Integrate into `WhatsOnDetailView.tsx`
- [ ] Integrate into `AnalysisDetailView.tsx`

**Effort:** 3 days

---

### A.2 Rust Feedback Commands (Week 2)

**File:** `src-tauri/src/commands.rs` (extend)

```rust
#[tauri::command]
pub async fn submit_analysis_feedback(
    db: DbState<'_>,
    feedback: AnalysisFeedback,
) -> Result<i64, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.insert_feedback(&feedback)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn get_analysis_feedback(
    db: DbState<'_>,
    analysis_id: i64,
) -> Result<Vec<AnalysisFeedback>, String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db.get_feedback_for_analysis(analysis_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn promote_to_gold(
    db: DbState<'_>,
    analysis_id: i64,
    verified_by: Option<String>,
) -> Result<i64, String> {
    let db_clone = Arc::clone(&db);

    // Get the analysis
    let analysis = tauri::async_runtime::spawn_blocking(move || {
        db_clone.get_analysis_by_id(analysis_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    let analysis = analysis.ok_or("Analysis not found")?;

    // Create gold record
    let gold = GoldAnalysis {
        id: 0,
        source_analysis_id: Some(analysis_id),
        source_type: "crash".to_string(),
        error_signature: analysis.error_type.clone(),
        crash_content_hash: None,
        root_cause: analysis.root_cause.clone(),
        suggested_fixes: analysis.suggested_fixes.clone(),
        component: analysis.component.clone(),
        severity: Some(analysis.severity.clone()),
        validation_status: "verified".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        verified_by,
        times_referenced: 0,
        success_rate: None,
    };

    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.insert_gold_analysis(&gold)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))
}
```

**Tasks:**
- [ ] Add `AnalysisFeedback` struct to models
- [ ] Add `GoldAnalysis` struct to models
- [ ] Implement `submit_analysis_feedback` command
- [ ] Implement `get_analysis_feedback` command
- [ ] Implement `promote_to_gold` command
- [ ] Register commands in `main.rs`

**Effort:** 2 days

---

### A.3 Gold Curation Workflow (Week 3)

#### A.3.1 GoldBadge Component

**File:** `src/components/GoldBadge.tsx` (new)

```typescript
import React from 'react';

interface GoldBadgeProps {
  isGold: boolean;
  onClick?: () => void;
}

export const GoldBadge: React.FC<GoldBadgeProps> = ({ isGold, onClick }) => {
  return (
    <button
      className={`gold-badge ${isGold ? 'is-gold' : ''}`}
      onClick={onClick}
      title={isGold ? 'Gold Standard Analysis' : 'Promote to Gold'}
    >
      {isGold ? '⭐' : '☆'}
    </button>
  );
};
```

#### A.3.2 GoldReviewQueue Component

**File:** `src/components/GoldReviewQueue.tsx` (new)

```typescript
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GoldAnalysis } from '../types';

export const GoldReviewQueue: React.FC = () => {
  const [pendingGold, setPendingGold] = useState<GoldAnalysis[]>([]);

  useEffect(() => {
    loadPendingGold();
  }, []);

  const loadPendingGold = async () => {
    const gold = await invoke<GoldAnalysis[]>('get_pending_gold_analyses');
    setPendingGold(gold);
  };

  const handleVerify = async (id: number) => {
    await invoke('verify_gold_analysis', { id });
    loadPendingGold();
  };

  const handleReject = async (id: number) => {
    await invoke('reject_gold_analysis', { id });
    loadPendingGold();
  };

  return (
    <div className="gold-review-queue">
      <h3>Pending Gold Analyses ({pendingGold.length})</h3>
      {pendingGold.map((gold) => (
        <div key={gold.id} className="gold-review-item">
          <div className="gold-signature">{gold.error_signature}</div>
          <div className="gold-root-cause">{gold.root_cause}</div>
          <div className="gold-actions">
            <button onClick={() => handleVerify(gold.id)}>✓ Verify</button>
            <button onClick={() => handleReject(gold.id)}>✗ Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
};
```

**Tasks:**
- [ ] Create `GoldBadge.tsx`
- [ ] Create `GoldReviewQueue.tsx`
- [ ] Add "Promote to Gold" button in `HistoryView.tsx`
- [ ] Implement auto-promotion criteria:
  - Rating >= 4
  - No edits required
  - JIRA linked (if applicable)
- [ ] Add gold review tab/section

**Effort:** 3 days

---

### A.4 JSONL Export (Week 4)

**File:** `src-tauri/src/export.rs` (new)

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenAITrainingExample {
    messages: Vec<OpenAIMessage>,
}

pub fn export_for_finetuning(
    analyses: Vec<GoldAnalysis>,
    crash_contents: Vec<String>,
    system_prompt: &str,
) -> Result<String, String> {
    let mut lines = Vec::new();

    for (analysis, crash_content) in analyses.iter().zip(crash_contents.iter()) {
        // Apply PII redaction
        let redacted_content = redact_pii_for_training(crash_content);

        let example = OpenAITrainingExample {
            messages: vec![
                OpenAIMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                OpenAIMessage {
                    role: "user".to_string(),
                    content: redacted_content,
                },
                OpenAIMessage {
                    role: "assistant".to_string(),
                    content: serde_json::json!({
                        "root_cause": analysis.root_cause,
                        "suggested_fixes": serde_json::from_str::<Vec<String>>(&analysis.suggested_fixes).unwrap_or_default(),
                        "component": analysis.component,
                        "severity": analysis.severity,
                    }).to_string(),
                },
            ],
        };

        lines.push(serde_json::to_string(&example).map_err(|e| e.to_string())?);
    }

    Ok(lines.join("\n"))
}

fn redact_pii_for_training(content: &str) -> String {
    // Extend existing redact_pii_basic with additional patterns
    let mut redacted = redact_pii_basic(content);

    // Additional patterns for training data
    static DB_CONN_RE: Lazy<Regex> = Lazy::new(||
        Regex::new(r"(jdbc|oracle|postgres|mysql)://[^\s]+").unwrap()
    );
    static HOSTNAME_RE: Lazy<Regex> = Lazy::new(||
        Regex::new(r"\b[a-zA-Z0-9-]+\.(internal|local|corp|lan)\b").unwrap()
    );

    redacted = DB_CONN_RE.replace_all(&redacted, "[DB_CONNECTION]").to_string();
    redacted = HOSTNAME_RE.replace_all(&redacted, "[HOSTNAME]").to_string();

    redacted
}

#[tauri::command]
pub async fn export_training_data(
    db: DbState<'_>,
    output_path: String,
    format: String,  // "openai" | "anthropic" | "generic"
) -> Result<usize, String> {
    let db = Arc::clone(&db);

    // Get verified gold analyses
    let gold_analyses = tauri::async_runtime::spawn_blocking(move || {
        db.get_gold_analyses_by_status("verified")
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    // TODO: Get corresponding crash contents from full_data

    let system_prompt = include_str!("../prompts/crash_analysis_system.txt");
    let jsonl = export_for_finetuning(gold_analyses.clone(), vec![], system_prompt)?;

    std::fs::write(&output_path, &jsonl)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(gold_analyses.len())
}
```

**Tasks:**
- [ ] Create `src-tauri/src/export.rs`
- [ ] Implement OpenAI JSONL format export
- [ ] Extend PII redaction for training data
- [ ] Create export UI in Settings or History view
- [ ] Add system prompt file `src-tauri/prompts/crash_analysis_system.txt`

**Effort:** 2 days

---

### A.5 Evaluation Harness (Week 4)

**File:** `python/evaluation/` (new directory)

```
python/
├── evaluation/
│   ├── __init__.py
│   ├── metrics.py         # Accuracy metrics
│   ├── test_set.py        # Test set management
│   ├── run_eval.py        # Evaluation runner
│   └── report.py          # Generate reports
```

**File:** `python/evaluation/metrics.py`

```python
from typing import Dict, Any
import json
from difflib import SequenceMatcher

def evaluate_analysis(predicted: Dict, ground_truth: Dict) -> Dict[str, float]:
    """Evaluate a single analysis against ground truth."""
    return {
        "root_cause_similarity": semantic_similarity(
            predicted.get("root_cause", ""),
            ground_truth.get("root_cause", "")
        ),
        "fix_coverage": calculate_fix_coverage(
            predicted.get("suggested_fixes", []),
            ground_truth.get("suggested_fixes", [])
        ),
        "component_accuracy": 1.0 if predicted.get("component") == ground_truth.get("component") else 0.0,
        "severity_accuracy": 1.0 if predicted.get("severity") == ground_truth.get("severity") else 0.0,
    }

def semantic_similarity(text1: str, text2: str) -> float:
    """Simple similarity score using SequenceMatcher."""
    return SequenceMatcher(None, text1.lower(), text2.lower()).ratio()

def calculate_fix_coverage(predicted: list, ground_truth: list) -> float:
    """Calculate how many ground truth fixes are covered by predictions."""
    if not ground_truth:
        return 1.0
    matches = sum(1 for gt in ground_truth if any(
        semantic_similarity(gt, pred) > 0.7 for pred in predicted
    ))
    return matches / len(ground_truth)
```

**Tasks:**
- [ ] Create evaluation directory structure
- [ ] Implement basic metrics
- [ ] Create initial test set (50 examples) from existing analyses
- [ ] Build evaluation runner script
- [ ] Document baseline accuracy

**Effort:** 3 days

---

## Stream B: RAG System (Weeks 2-5)

### B.1 Embedding Pipeline (Week 2)

Adapt from `Github_rag/chatgpt-retrieval-plugin/services/openai.py`

**File:** `python/rag/embeddings.py`

```python
import os
from typing import List
import openai
from tenacity import retry, wait_random_exponential, stop_after_attempt

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSION = int(os.environ.get("EMBEDDING_DIMENSION", 1536))

@retry(wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(3))
def get_embeddings(texts: List[str]) -> List[List[float]]:
    """Generate embeddings using OpenAI API."""
    client = openai.OpenAI()

    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
        dimensions=EMBEDDING_DIMENSION
    )

    return [item.embedding for item in response.data]

def get_single_embedding(text: str) -> List[float]:
    """Generate embedding for a single text."""
    return get_embeddings([text])[0]
```

**File:** `python/rag/chunks.py` (adapt from chatgpt-retrieval-plugin)

```python
import tiktoken
from typing import List, Optional

CHUNK_SIZE = 500  # Larger for crash logs
MIN_CHUNK_SIZE_CHARS = 200
MIN_CHUNK_LENGTH_TO_EMBED = 10

tokenizer = tiktoken.get_encoding("cl100k_base")

def chunk_crash_log(content: str, chunk_size: Optional[int] = None) -> List[str]:
    """
    Chunk a crash log into semantic sections.

    Strategy:
    1. Stack trace -> 1 chunk (preserve context)
    2. Error message + root cause -> 1 chunk
    3. Environment info -> 1 chunk
    4. Remaining content -> token-based chunks
    """
    chunks = []
    size = chunk_size or CHUNK_SIZE

    # Try to identify stack trace section
    if "Stack:" in content or "Traceback" in content:
        # Extract stack trace as single chunk
        # ... implementation
        pass

    # Fall back to token-based chunking
    tokens = tokenizer.encode(content)
    for i in range(0, len(tokens), size):
        chunk_tokens = tokens[i:i + size]
        chunk_text = tokenizer.decode(chunk_tokens).strip()
        if len(chunk_text) > MIN_CHUNK_LENGTH_TO_EMBED:
            chunks.append(chunk_text)

    return chunks

def chunk_analysis(analysis: dict) -> List[dict]:
    """
    Create retrieval chunks from a completed analysis.

    Returns list of chunks with metadata.
    """
    chunks = []

    # Chunk 1: Root cause + suggested fixes (primary retrieval target)
    root_cause_chunk = {
        "content": f"Root Cause: {analysis.get('root_cause', '')}\n\nSuggested Fixes:\n" +
                   "\n".join(f"- {fix}" for fix in analysis.get('suggested_fixes', [])),
        "chunk_type": "solution",
        "metadata": {
            "error_type": analysis.get("error_type"),
            "component": analysis.get("component"),
            "severity": analysis.get("severity"),
        }
    }
    chunks.append(root_cause_chunk)

    # Chunk 2: Full analysis JSON (for detailed retrieval)
    full_chunk = {
        "content": json.dumps(analysis, indent=2),
        "chunk_type": "full_analysis",
        "metadata": root_cause_chunk["metadata"]
    }
    chunks.append(full_chunk)

    return chunks
```

**Tasks:**
- [ ] Create `python/rag/embeddings.py`
- [ ] Create `python/rag/chunks.py`
- [ ] Create `python/rag/models.py` (Pydantic models)
- [ ] Test embedding generation with sample data
- [ ] Integrate with Tauri via `python_runner.rs`

**Effort:** 3 days

---

### B.2 Vector Store - Chroma (Week 3)

Adapt from `Github_rag/chatgpt-retrieval-plugin/datastore/providers/chroma_datastore.py`

**File:** `python/rag/chroma_store.py`

```python
import os
from typing import List, Optional, Dict, Any
import chromadb
from chromadb.config import Settings

from .models import RetrievalChunk, ChunkMetadata, QueryResult
from .embeddings import get_single_embedding

CHROMA_PERSISTENCE_DIR = os.environ.get(
    "HADRON_CHROMA_DIR",
    os.path.expanduser("~/.hadron/chroma")
)

class HadronChromaStore:
    def __init__(self, persistence_dir: str = CHROMA_PERSISTENCE_DIR):
        self._client = chromadb.Client(Settings(
            chroma_db_impl="duckdb+parquet",
            persist_directory=persistence_dir,
            anonymized_telemetry=False
        ))
        self._collection = self._client.get_or_create_collection(
            name="hadron_analyses",
            embedding_function=None  # We provide embeddings ourselves
        )

    def upsert(self, chunks: List[RetrievalChunk]) -> List[str]:
        """Insert or update chunks in the store."""
        if not chunks:
            return []

        self._collection.upsert(
            ids=[chunk.id for chunk in chunks],
            embeddings=[chunk.embedding for chunk in chunks],
            documents=[chunk.content for chunk in chunks],
            metadatas=[chunk.metadata.dict() for chunk in chunks]
        )

        return [chunk.id for chunk in chunks]

    def query(
        self,
        query_text: str,
        top_k: int = 5,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[QueryResult]:
        """Query the store for similar chunks."""
        query_embedding = get_single_embedding(query_text)

        where_clause = self._build_where_clause(filters) if filters else None

        results = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, self._collection.count()),
            where=where_clause,
            include=["documents", "distances", "metadatas"]
        )

        return self._process_results(query_text, results)

    def _build_where_clause(self, filters: Dict[str, Any]) -> Dict:
        """Build Chroma where clause from filters."""
        conditions = []
        for key, value in filters.items():
            if value is not None:
                conditions.append({key: value})

        if len(conditions) == 0:
            return None
        elif len(conditions) == 1:
            return conditions[0]
        else:
            return {"$and": conditions}

    def _process_results(self, query: str, results: Dict) -> List[QueryResult]:
        """Process Chroma results into QueryResult objects."""
        output = []
        if not results["ids"] or not results["ids"][0]:
            return output

        ids = results["ids"][0]
        documents = results["documents"][0]
        distances = results["distances"][0]
        metadatas = results["metadatas"][0]

        for id_, doc, distance, metadata in zip(ids, documents, distances, metadatas):
            # Convert distance to similarity score (Chroma uses L2 by default)
            similarity = 1 / (1 + distance)
            output.append(QueryResult(
                id=id_,
                content=doc,
                score=similarity,
                metadata=ChunkMetadata(**metadata)
            ))

        return output

    def delete(self, ids: List[str]) -> bool:
        """Delete chunks by ID."""
        self._collection.delete(ids=ids)
        return True

    def count(self) -> int:
        """Get total number of chunks."""
        return self._collection.count()
```

**Tasks:**
- [ ] Create `python/rag/chroma_store.py`
- [ ] Implement upsert, query, delete operations
- [ ] Add metadata filtering
- [ ] Test with sample data
- [ ] Create initialization script

**Effort:** 3 days

---

### B.3 Hybrid Retrieval (Week 4)

**File:** `python/rag/retrieval.py`

```python
from typing import List, Optional, Dict, Any
from .chroma_store import HadronChromaStore
from .models import QueryResult, RetrievalFilters

class HybridRetriever:
    def __init__(self, chroma_store: HadronChromaStore, sqlite_path: str):
        self.vector_store = chroma_store
        self.sqlite_path = sqlite_path
        self.alpha = 0.3  # Weight for BM25 vs vector (0.3 = favor vector)

    def retrieve(
        self,
        query: str,
        filters: Optional[RetrievalFilters] = None,
        top_k: int = 5
    ) -> List[QueryResult]:
        """
        Hybrid retrieval combining BM25 and vector similarity.

        Score = α × BM25_score + (1-α) × cosine_similarity
        """
        # Get vector results
        vector_filter = self._filters_to_dict(filters) if filters else None
        vector_results = self.vector_store.query(query, top_k * 3, vector_filter)

        # Get BM25 results from SQLite FTS5
        bm25_results = self._bm25_search(query, filters, top_k * 3)

        # Merge and rerank
        merged = self._merge_results(bm25_results, vector_results)

        # Return top_k
        return sorted(merged, key=lambda x: x.score, reverse=True)[:top_k]

    def _bm25_search(
        self,
        query: str,
        filters: Optional[RetrievalFilters],
        limit: int
    ) -> List[QueryResult]:
        """Search using SQLite FTS5."""
        import sqlite3

        conn = sqlite3.connect(self.sqlite_path)
        cursor = conn.cursor()

        # Build FTS5 query
        # Note: Hadron would need FTS5 table for this
        # For now, fall back to LIKE search
        cursor.execute("""
            SELECT id, root_cause, suggested_fixes, error_type, component, severity
            FROM analyses
            WHERE root_cause LIKE ? OR error_type LIKE ?
            LIMIT ?
        """, (f"%{query}%", f"%{query}%", limit))

        results = []
        for row in cursor.fetchall():
            results.append(QueryResult(
                id=str(row[0]),
                content=row[1],
                score=0.5,  # Placeholder BM25 score
                metadata={"component": row[4], "severity": row[5]}
            ))

        conn.close()
        return results

    def _merge_results(
        self,
        bm25_results: List[QueryResult],
        vector_results: List[QueryResult]
    ) -> List[QueryResult]:
        """Merge BM25 and vector results with weighted scoring."""
        merged = {}

        # Add BM25 results
        for r in bm25_results:
            merged[r.id] = QueryResult(
                id=r.id,
                content=r.content,
                score=self.alpha * r.score,
                metadata=r.metadata
            )

        # Add/update with vector results
        for r in vector_results:
            if r.id in merged:
                merged[r.id].score += (1 - self.alpha) * r.score
            else:
                merged[r.id] = QueryResult(
                    id=r.id,
                    content=r.content,
                    score=(1 - self.alpha) * r.score,
                    metadata=r.metadata
                )

        return list(merged.values())

    def _filters_to_dict(self, filters: RetrievalFilters) -> Dict[str, Any]:
        """Convert RetrievalFilters to dict for Chroma."""
        result = {}
        if filters.component:
            result["component"] = filters.component
        if filters.severity:
            result["severity"] = filters.severity
        return result
```

**Tasks:**
- [ ] Create `python/rag/retrieval.py`
- [ ] Implement hybrid BM25 + vector search
- [ ] Add result merging and reranking
- [ ] Test with sample queries
- [ ] Tune alpha parameter

**Effort:** 3 days

---

### B.4 Tauri Integration (Week 4)

**File:** `src-tauri/src/rag_commands.rs` (new)

```rust
use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct RAGQuery {
    pub query: String,
    pub component: Option<String>,
    pub severity: Option<String>,
    pub top_k: Option<usize>,
}

#[derive(Serialize, Deserialize)]
pub struct RAGResult {
    pub id: String,
    pub content: String,
    pub score: f64,
    pub source_type: String,
    pub metadata: serde_json::Value,
}

#[tauri::command]
pub async fn rag_query(query: RAGQuery) -> Result<Vec<RAGResult>, String> {
    let query_json = serde_json::to_string(&query)
        .map_err(|e| format!("Serialization error: {}", e))?;

    let output = Command::new("python")
        .args(&[
            "-m", "rag.cli",
            "query",
            "--input", &query_json
        ])
        .current_dir(get_python_dir())
        .output()
        .map_err(|e| format!("Failed to execute Python: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let results: Vec<RAGResult> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse results: {}", e))?;

    Ok(results)
}

#[tauri::command]
pub async fn rag_index_analysis(analysis_id: i64, db: DbState<'_>) -> Result<(), String> {
    // Get analysis from database
    let db = Arc::clone(&db);
    let analysis = tauri::async_runtime::spawn_blocking(move || {
        db.get_analysis_by_id(analysis_id)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Database error: {}", e))?;

    let analysis = analysis.ok_or("Analysis not found")?;

    // Call Python to generate embedding and store
    let analysis_json = serde_json::to_string(&analysis)
        .map_err(|e| format!("Serialization error: {}", e))?;

    let output = Command::new("python")
        .args(&[
            "-m", "rag.cli",
            "index",
            "--analysis", &analysis_json
        ])
        .current_dir(get_python_dir())
        .output()
        .map_err(|e| format!("Failed to execute Python: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(())
}

fn get_python_dir() -> String {
    // Return path to python directory
    std::env::current_dir()
        .unwrap()
        .join("python")
        .to_string_lossy()
        .to_string()
}
```

**Tasks:**
- [ ] Create `src-tauri/src/rag_commands.rs`
- [ ] Implement `rag_query` command
- [ ] Implement `rag_index_analysis` command
- [ ] Create Python CLI interface `python/rag/cli.py`
- [ ] Register commands in `main.rs`

**Effort:** 2 days

---

### B.5 Auto-Indexing After Analysis (Week 5)

**File:** `src-tauri/src/commands.rs` (modify `analyze_whatson_enhanced`)

```rust
// After successful analysis, trigger indexing
if let Ok(analysis_id) = db_result {
    // Spawn background task to index for RAG
    let id = analysis_id;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = rag_index_analysis(id).await {
            log::warn!("Failed to index analysis for RAG: {}", e);
        }
    });
}
```

**Tasks:**
- [ ] Add post-analysis hook to index new analyses
- [ ] Add background indexing for historical analyses
- [ ] Create progress indicator for bulk indexing
- [ ] Test indexing performance

**Effort:** 1 day

---

## Integration Phase (Weeks 5-6)

### I.1 RAG-Enhanced Prompts (Week 5)

**File:** `src-tauri/prompts/rag_enhanced_analysis.txt` (new)

```
You are analyzing a WHATS'ON crash log. Use the following similar past cases as reference:

## Similar Cases Found:
{{#each similar_cases}}
### Case #{{@index}}: {{this.error_type}} in {{this.component}}
**Similarity:** {{this.similarity_score}}%
**Root Cause:** {{this.root_cause}}
**Resolution:** {{this.suggested_fix}}
**Verified:** {{#if this.is_gold}}Yes (Gold Standard){{else}}No{{/if}}

{{/each}}

## Current Crash Log:
{crash_content}

## Instructions:
1. Analyze the current crash using insights from similar cases
2. CITE which past case(s) informed your analysis using format: [Case #N]
3. If no similar cases are relevant, state "No matching historical cases found"
4. Provide confidence level based on:
   - High: Strong match to verified gold case
   - Medium: Partial match to historical cases
   - Low: No relevant historical data

Return JSON in the WhatsOnEnhancedAnalysis format with added `citations` field.
```

**File:** `src-tauri/src/ai_service.rs` (modify)

```rust
pub async fn analyze_with_rag(
    content: &str,
    provider: &str,
    model: &str,
) -> Result<WhatsOnEnhancedAnalysis, String> {
    // 1. Query RAG for similar cases
    let rag_results = rag_query(RAGQuery {
        query: content.chars().take(2000).collect(), // Use beginning for query
        component: None,
        severity: None,
        top_k: Some(5),
    }).await?;

    // 2. Build context from results
    let context = build_rag_context(&rag_results);

    // 3. Load RAG-enhanced prompt
    let prompt_template = include_str!("../prompts/rag_enhanced_analysis.txt");
    let prompt = render_rag_prompt(prompt_template, &context, content);

    // 4. Call AI provider
    let response = match provider {
        "anthropic" => call_anthropic(&prompt, model).await?,
        "openai" => call_openai(&prompt, model).await?,
        "ollama" => call_ollama(&prompt, model).await?,
        _ => return Err("Unknown provider".to_string()),
    };

    // 5. Parse and enhance response with citations
    let mut analysis: WhatsOnEnhancedAnalysis = serde_json::from_str(&response)
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Add RAG metadata
    analysis.rag_context = Some(context);

    Ok(analysis)
}
```

**Tasks:**
- [ ] Create RAG-enhanced prompt template
- [ ] Implement `analyze_with_rag` function
- [ ] Add citation extraction from response
- [ ] Update `WhatsOnEnhancedAnalysis` type with RAG fields
- [ ] Test with real analyses

**Effort:** 3 days

---

### I.2 Citation Display UI (Week 5)

**File:** `src/components/CitationBadge.tsx` (new)

```typescript
import React from 'react';
import { SimilarCase } from '../types';

interface CitationBadgeProps {
  citation: SimilarCase;
  onClick?: () => void;
}

export const CitationBadge: React.FC<CitationBadgeProps> = ({ citation, onClick }) => {
  return (
    <span
      className={`citation-badge ${citation.is_gold ? 'gold' : ''}`}
      onClick={onClick}
      title={`${citation.similarity_score}% match - Click to view`}
    >
      [Case #{citation.citation_id}]
      {citation.is_gold && ' ⭐'}
    </span>
  );
};
```

**File:** `src/components/RAGContextPanel.tsx` (new)

```typescript
import React from 'react';
import { RAGContext, SimilarCase } from '../types';

interface RAGContextPanelProps {
  context: RAGContext;
  onCaseClick?: (case_: SimilarCase) => void;
}

export const RAGContextPanel: React.FC<RAGContextPanelProps> = ({
  context,
  onCaseClick
}) => {
  if (!context.similar_analyses.length) {
    return (
      <div className="rag-context-panel empty">
        <p>No similar historical cases found.</p>
      </div>
    );
  }

  return (
    <div className="rag-context-panel">
      <h4>Similar Cases ({context.similar_analyses.length})</h4>
      {context.similar_analyses.map((case_, idx) => (
        <div
          key={case_.citation_id}
          className={`similar-case ${case_.is_gold ? 'gold' : ''}`}
          onClick={() => onCaseClick?.(case_)}
        >
          <div className="case-header">
            <span className="case-id">Case #{idx + 1}</span>
            <span className="similarity">{Math.round(case_.similarity_score * 100)}% match</span>
            {case_.is_gold && <span className="gold-badge">⭐ Verified</span>}
          </div>
          <div className="case-root-cause">{case_.root_cause}</div>
        </div>
      ))}
    </div>
  );
};
```

**Tasks:**
- [ ] Create `CitationBadge.tsx`
- [ ] Create `RAGContextPanel.tsx`
- [ ] Integrate into `WhatsOnDetailView.tsx`
- [ ] Add click-through to view referenced analysis
- [ ] Style citations in analysis text

**Effort:** 2 days

---

### I.3 Feature Flag & A/B Testing (Week 6)

**File:** `src/hooks/useFeatureFlags.ts` (new)

```typescript
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface FeatureFlags {
  rag_enabled: boolean;
  feedback_enabled: boolean;
  gold_curation_enabled: boolean;
}

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>({
    rag_enabled: false,
    feedback_enabled: true,
    gold_curation_enabled: true,
  });

  useEffect(() => {
    invoke<FeatureFlags>('get_feature_flags').then(setFlags);
  }, []);

  return flags;
}
```

**File:** `src-tauri/src/settings.rs` (extend)

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct FeatureFlags {
    pub rag_enabled: bool,
    pub feedback_enabled: bool,
    pub gold_curation_enabled: bool,
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            rag_enabled: false,  // Start disabled, enable for A/B test
            feedback_enabled: true,
            gold_curation_enabled: true,
        }
    }
}
```

**Tasks:**
- [ ] Implement feature flag system
- [ ] Add RAG toggle in settings UI
- [ ] Create A/B test logging
- [ ] Add metrics collection for comparison
- [ ] Document A/B test procedure

**Effort:** 2 days

---

### I.4 Documentation & Testing (Week 6)

**Tasks:**
- [ ] Update README with new features
- [ ] Document RAG configuration
- [ ] Document feedback workflow
- [ ] Create user guide for gold curation
- [ ] Write integration tests
- [ ] Performance benchmarks

**Effort:** 2 days

---

## Summary: Parallel Execution Timeline

```
Week 1: SHARED FOUNDATION
├─ Database migration
├─ Python RAG service setup
└─ TypeScript types

Week 2:
├─ STREAM A: Feedback UI components
└─ STREAM B: Embedding pipeline

Week 3:
├─ STREAM A: Gold curation workflow
└─ STREAM B: Chroma vector store

Week 4:
├─ STREAM A: JSONL export + Evaluation harness
└─ STREAM B: Hybrid retrieval + Tauri integration

Week 5:
├─ STREAM A: Polish feedback UI
└─ STREAM B: RAG-enhanced prompts + Auto-indexing
└─ INTEGRATION: Citation UI

Week 6: INTEGRATION
├─ Feature flags + A/B testing
├─ Documentation
└─ Testing & polish
```

---

## Success Criteria

### Phase 1 (Feedback)
- [ ] 100+ analyses with feedback collected
- [ ] 25+ gold analyses curated
- [ ] JSONL export produces valid OpenAI format
- [ ] Baseline accuracy measured

### Phase 2 (RAG)
- [ ] 500+ analyses indexed in Chroma
- [ ] <500ms retrieval latency
- [ ] RAG improves accuracy by 15%+ vs baseline
- [ ] Users report similar cases as relevant 70%+ of time

---

## Dependencies & Resources

### Python Dependencies
```
chromadb>=0.4.0
tiktoken>=0.5.0
openai>=1.0.0
pydantic>=2.0.0
tenacity>=8.0.0
```

### Reference Code
- `C:\Projects\GitHub_tools\Github_rag\chatgpt-retrieval-plugin\datastore\datastore.py`
- `C:\Projects\GitHub_tools\Github_rag\chatgpt-retrieval-plugin\datastore\providers\chroma_datastore.py`
- `C:\Projects\GitHub_tools\Github_rag\chatgpt-retrieval-plugin\services\chunks.py`
- `C:\Projects\GitHub_tools\Github_rag\chatgpt-retrieval-plugin\services\openai.py`

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Chroma performance with large datasets | Start with <10K, monitor, migrate to FAISS if needed |
| Python/Rust integration issues | Use JSON over stdio, test early |
| RAG returns irrelevant results | Tune similarity threshold, add metadata filters |
| Users don't provide feedback | Make feedback frictionless (1-click) |
