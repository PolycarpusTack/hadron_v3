# RAG System - Quick Start Guide

## 🚀 Quick Start (5 minutes)

### 1. Install Dependencies

```bash
# Install Python RAG dependencies
pip install -r python/requirements-rag.txt

# Verify installation
python -m python.rag.cli stats
```

### 2. Configure API Key

The system uses your existing OpenAI API key from Hadron settings. No additional configuration needed!

### 3. Use RAG Features

#### Auto-Indexing (Automatic)

Every crash analysis is automatically indexed after successful completion:

```
✅ Analysis complete → Database saved → RAG indexed (background)
```

No manual action required!

#### Query Similar Analyses (Frontend)

```typescript
import { ragQuery } from '@/services/rag';

// Search for similar crashes
const results = await ragQuery(
  "MessageNotUnderstood in OrderedCollection",
  { severity: "critical" },
  5 // top 5 results
);

results.forEach(r => {
  console.log(`[${(r.score * 100).toFixed(1)}%] ${r.content}`);
});
```

#### Build Enhanced Context

```typescript
import { ragBuildContext } from '@/services/rag';

const context = await ragBuildContext(
  "NullPointerException in database pool"
);

console.log(`Found ${context.similar_analyses.length} similar cases`);
console.log(`Gold matches: ${context.gold_matches.length}`);
console.log(`Confidence boost: ${context.confidence_boost}`);
```

## 📊 Check Status

```typescript
import { ragGetStats } from '@/services/rag';

const stats = await ragGetStats();
console.log(stats);
// {
//   total_chunks: 150,
//   total_analyses: 30,
//   gold_analyses: 5,
//   storage_path: "/path/to/chroma_data"
// }
```

## 🔧 Common Tasks

### Re-index an Analysis

```typescript
import { ragReindexAnalysis } from '@/services/rag';

await ragReindexAnalysis(123, analysisObject);
```

### Search with Filters

```typescript
const results = await ragQuery(
  "error in Collections",
  {
    component: "Collections",
    severity: "critical"
  },
  10
);
```

### Format Results for Display

```typescript
import { formatSimilarCases } from '@/services/rag';

const formatted = formatSimilarCases(context.similar_analyses);
console.log(formatted);
// 1. [95.3% match 🏆] Root cause description...
// 2. [87.2% match] Root cause description...
```

## 🐛 Troubleshooting

### "API key not configured"
→ Set OpenAI API key in Hadron settings

### "RAG CLI timed out"
→ Check network connection to OpenAI API

### Empty search results
→ Run some analyses first to populate the vector store

### Check logs
```bash
tail -f ~/.local/share/hadron/logs/hadron.log | grep RAG
```

## 📁 File Locations

- **Rust Commands**: `src-tauri/src/rag_commands.rs`
- **Python CLI**: `python/rag/cli.py`
- **TypeScript Service**: `src/services/rag.ts`
- **Vector Store**: `python/rag/chroma_data/`
- **Full Guide**: `RAG-INTEGRATION-GUIDE.md`

## 💡 Best Practices

1. **Let auto-indexing work** - Don't manually index unless needed
2. **Use filters** - Narrow searches with component/severity
3. **Check stats** - Monitor vector store growth
4. **Gold analyses** - Promote quality analyses for better results
5. **Query length** - Keep queries focused (< 500 chars)

## 🔗 Key Functions Reference

| Function | Purpose | Example |
|----------|---------|---------|
| `ragQuery()` | Find similar analyses | `await ragQuery("error msg")` |
| `ragBuildContext()` | Get full context | `await ragBuildContext("error")` |
| `ragIndexAnalysis()` | Index manually | `await ragIndexAnalysis(obj)` |
| `ragGetStats()` | Check status | `await ragGetStats()` |
| `isRagAvailable()` | Check if enabled | `await isRagAvailable()` |

## 📚 Learn More

- Full integration guide: `RAG-INTEGRATION-GUIDE.md`
- Implementation details: `PHASE-1-2-WEEK-4-RAG-IMPLEMENTATION.md`
- Python RAG modules: `python/rag/`

---

**Need help?** Check the full integration guide or review the logs!
