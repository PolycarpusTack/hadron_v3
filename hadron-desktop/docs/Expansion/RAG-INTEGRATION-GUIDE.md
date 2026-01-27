# RAG System Integration Guide

## Overview

The Python RAG (Retrieval-Augmented Generation) system has been successfully integrated with the Tauri backend for the Hadron Intelligence Platform (Phase 1-2, Week 4).

## Architecture

```
┌─────────────────┐
│  Frontend (TS)  │
│  src/services/  │
│    rag.ts       │
└────────┬────────┘
         │ invoke()
         ▼
┌─────────────────┐
│  Tauri (Rust)   │
│  rag_commands.rs│
└────────┬────────┘
         │ stdin/stdout
         ▼
┌─────────────────┐
│  Python RAG     │
│  python/rag/    │
│    cli.py       │
└─────────────────┘
```

## Components

### 1. Rust Layer: `src-tauri/src/rag_commands.rs`

**Tauri Commands:**
- `rag_query` - Query vector store for similar analyses
- `rag_index_analysis` - Index an analysis into vector store
- `rag_build_context` - Build RAG context for enhanced analysis
- `rag_get_stats` - Get vector store statistics

**Security Features:**
- API keys passed via stdin (never CLI args or env vars)
- Size limits enforced (10KB query, 1MB analysis)
- Timeout protection (30 seconds)
- Input validation and sanitization

### 2. Python CLI: `python/rag/cli.py`

**Commands:**
- `query` - Search for similar analyses
- `index` - Index an analysis
- `context` - Build full RAG context
- `stats` - Get store statistics

**Enhancements:**
- Stdin input protocol for secure API key handling
- JSON input/output for structured data exchange
- Comprehensive error handling and logging
- Graceful degradation on failures

### 3. TypeScript Service: `src/services/rag.ts`

**Functions:**
- `ragQuery()` - Query for similar analyses
- `ragBuildContext()` - Build RAG context
- `ragIndexAnalysis()` - Index an analysis
- `ragReindexAnalysis()` - Re-index (e.g., after gold promotion)
- `ragGetStats()` - Get statistics
- Utility functions for formatting and extraction

## Auto-Indexing

Analyses are automatically indexed after successful completion:

### `analyze_crash_log` Hook
- Triggered after database insert
- Spawns async task (fire-and-forget)
- Only indexes if root_cause is meaningful
- Failures logged but don't affect main flow

### `save_external_analysis` Hook
- Triggered if API key provided
- Spawns async task (fire-and-forget)
- Best-effort operation

## Usage Examples

### Frontend Usage

```typescript
import { ragQuery, ragBuildContext, ragIndexAnalysis } from '@/services/rag';

// Query for similar crashes
const results = await ragQuery(
  "MessageNotUnderstood in OrderedCollection",
  { component: "Collections", severity: "critical" },
  5
);

// Build context for analysis
const context = await ragBuildContext(
  "NullPointerException in database connection pool",
  { severity: "high" }
);

// Manually index an analysis
await ragIndexAnalysis({
  id: 123,
  error_type: "MessageNotUnderstood",
  root_cause: "...",
  suggested_fixes: ["..."],
  // ... other fields
});

// Get statistics
const stats = await ragGetStats();
console.log(`Indexed ${stats.total_chunks} chunks from ${stats.total_analyses} analyses`);
```

### Backend Usage

Auto-indexing happens automatically, but you can also call RAG commands directly:

```rust
use crate::rag_commands::{RAGQueryRequest, rag_query};

let request = RAGQueryRequest {
    query: "Error in Collections framework".to_string(),
    component: Some("Collections".to_string()),
    severity: Some("critical".to_string()),
    top_k: Some(5),
    api_key: api_key.to_string(),
};

let results = rag_query(request).await?;
```

## Python CLI Usage

The CLI can also be used directly for testing:

```bash
# Query (with stdin)
echo '{"input": {"query": "NullPointerException", "top_k": 5}, "api_key": "sk-..."}' | \
  python -m python.rag.cli query --input -

# Index an analysis
echo '{"input": {...analysis...}, "api_key": "sk-..."}' | \
  python -m python.rag.cli index --input -

# Get stats
python -m python.rag.cli stats
```

## Configuration

### Environment Variables

The RAG system uses these environment variables (optional):

```bash
# Embedding model (default: text-embedding-3-small)
export HADRON_EMBEDDING_MODEL=text-embedding-3-small

# Embedding dimension (default: 1536)
export HADRON_EMBEDDING_DIMENSION=1536

# Batch size for embeddings (default: 100)
export HADRON_EMBEDDING_BATCH_SIZE=100
```

### Storage Location

Vector store data is persisted at:
- **Dev**: `<project_root>/python/rag/chroma_data/`
- **Production**: `<executable_dir>/python/rag/chroma_data/`

## Dependencies

### Python Requirements

Add to `python/requirements-rag.txt`:
```
chromadb>=0.4.0
openai>=1.0.0
tenacity>=8.0.0
pydantic>=2.0.0
tiktoken>=0.5.0
rank-bm25>=0.2.0
```

Install with:
```bash
pip install -r python/requirements-rag.txt
```

### Rust Dependencies

Already included in `src-tauri/Cargo.toml`:
- `serde` with `derive` feature
- `serde_json`
- `tokio` with `process` feature

## Testing

### Unit Tests

```bash
# Test Python CLI
cd python/rag
python -m pytest tests/

# Test Rust commands
cd src-tauri
cargo test rag_commands
```

### Integration Test

1. Start the Tauri app
2. Analyze a crash log
3. Check logs for "Auto-indexing analysis X into RAG store"
4. Query for similar analyses using the frontend
5. Verify results are returned

### Manual Test

```typescript
// In browser console
const { ragQuery } = await import('./services/rag');
const results = await ragQuery("test query");
console.log(results);
```

## Monitoring

### Logging

RAG operations are logged at these levels:
- `INFO`: Successful operations, indexing events
- `WARN`: Failed indexing (non-critical)
- `ERROR`: Critical failures in CLI execution

Check logs:
```bash
# Tauri logs
tail -f ~/.local/share/hadron/logs/hadron.log

# Python logs (stderr)
# Captured in Tauri logs
```

### Metrics

Track these metrics:
- Indexing success rate
- Query latency
- Vector store size
- Cache hit rate (if caching implemented)

## Troubleshooting

### "API key not configured"
- Ensure OpenAI API key is set in settings
- Check secure storage is working

### "RAG CLI timed out"
- Increase timeout in `rag_commands.rs` (default: 30s)
- Check network connectivity
- Verify OpenAI API is accessible

### "Failed to generate embeddings"
- Check API key is valid
- Verify OpenAI quota/billing
- Check network connectivity

### "No JSON found in RAG CLI output"
- Check Python CLI is installed correctly
- Verify `python -m python.rag.cli` works
- Check Python environment

### Empty search results
- Verify analyses have been indexed
- Check vector store exists (`rag_get_stats`)
- Try broader queries

## Performance Considerations

### Embedding Generation
- **Cost**: ~$0.00002 per 1K tokens (text-embedding-3-small)
- **Latency**: ~200ms per batch (100 texts)
- **Caching**: Embeddings are cached in ChromaDB

### Query Performance
- **Latency**: ~100-500ms for hybrid search
- **Scaling**: Linear with collection size (up to ~100K chunks)
- **Optimization**: BM25 pre-filtering reduces vector search space

### Storage
- **Size**: ~1.5KB per chunk (embedding + metadata)
- **Growth**: ~5-10 chunks per analysis
- **Cleanup**: Implement periodic cleanup of old/low-quality chunks

## Future Enhancements

1. **Advanced Retrieval**
   - Multi-query retrieval
   - Reranking with cross-encoder
   - Query expansion

2. **Context Optimization**
   - Dynamic top_k based on query
   - Relevance thresholding
   - Context compression

3. **Caching**
   - Query result caching
   - Embedding caching
   - Context caching

4. **Analytics**
   - Track query patterns
   - Measure retrieval quality
   - A/B testing different strategies

5. **Batch Operations**
   - Bulk indexing
   - Batch re-indexing
   - Background indexing queue

## Security Considerations

✅ **Implemented:**
- API keys passed via stdin (never CLI/env)
- Input size limits enforced
- Timeout protection
- Path validation for storage
- Error message sanitization

⚠️ **Future:**
- Encrypt vector store at rest
- Rate limiting on queries
- Audit logging for sensitive operations

## Migration Path

### From Existing Database

To index existing analyses:

```typescript
import { ragIndexAnalysis } from '@/services/rag';
import { getAllAnalyses } from '@/services/api';

async function indexExistingAnalyses() {
  const analyses = await getAllAnalyses();

  for (const analysis of analyses) {
    try {
      await ragIndexAnalysis(analysis);
      console.log(`Indexed analysis ${analysis.id}`);
    } catch (error) {
      console.error(`Failed to index ${analysis.id}:`, error);
    }
  }
}
```

### Gradual Rollout

1. **Week 1**: Deploy with auto-indexing disabled
2. **Week 2**: Enable auto-indexing for new analyses
3. **Week 3**: Batch index historical analyses
4. **Week 4**: Enable RAG-enhanced analysis

## Support

For issues or questions:
1. Check logs in `~/.local/share/hadron/logs/`
2. Verify Python dependencies are installed
3. Test Python CLI directly
4. Check network connectivity to OpenAI
5. Review this guide's troubleshooting section

---

**Implementation Date**: 2026-01-21
**Phase**: 1-2, Week 4
**Status**: ✅ Complete
