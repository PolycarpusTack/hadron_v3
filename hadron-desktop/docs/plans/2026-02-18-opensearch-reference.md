# OpenSearch Reference: Analyst Chatbot → Hadron

Reference source: `C:\Projects\mediagenix-mgx-tools_analystchatbot-a73c1f9cc6b0`

## Connection

| Setting | Dev | Prod |
|---------|-----|------|
| Host | `localhost` | env `OPENSEARCH_URL` |
| Port | `9200` | `443` |
| SSL | `false` | `true` |
| Auth | None | Basic auth from credential file |
| Pool size | 20 | 20 |
| Docker | `opensearchproject/opensearch:3.2.0` | - |

## Index Mapping (HNSW/Lucene)

```json
{
  "settings": {
    "index": {
      "knn": "true",
      "knn.algo_param.ef_search": 100,
      "number_of_shards": 1,
      "number_of_replicas": 0
    }
  },
  "mappings": {
    "properties": {
      "embedding": {
        "type": "knn_vector",
        "dimension": 3072,
        "method": {
          "name": "hnsw",
          "engine": "lucene",
          "space_type": "innerproduct",
          "parameters": { "ef_construction": 128, "m": 24 }
        }
      },
      "won_version_for_sorting": { "type": "keyword" },
      "won_version": { "type": "match_only_text" },
      "customer": { "type": "match_only_text" }
    }
  }
}
```

## Index Naming

- **KB docs**: `kb-doc-{version}` (e.g., `kb-doc-2024r4`) — 54 versions (2023r1–2025r12)
- **Base RN**: `base-release-notes`
- **Customer RN**: `{customer}-release-notes` (e.g., `tf1-release-notes`)

## Embedding

- **Model**: `text-embedding-3-large` (OpenAI)
- **Dimensions**: 3072
- **Chat model**: `gpt-4o-2024-08-06`

## Chunking (Docling HybridChunker)

- **Min tokens**: 50
- **Max tokens**: 1000
- **Overlap**: 100 tokens
- **Tokenizer**: tiktoken for `text-embedding-3-large`

## Search Query

```json
{
  "size": 8,
  "query": {
    "knn": {
      "embedding": {
        "vector": "<query_embedding>",
        "k": 8,
        "filter": {
          "bool": {
            "must": {
              "range": {
                "won_version_for_sorting": {
                  "gte": "<min_version>",
                  "lte": "<max_version>"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Document Fields

| Field | Type | Description |
|-------|------|-------------|
| `text` | text | Document content |
| `embedding` | knn_vector (3072d) | Vector embedding |
| `link` | text | Source URL |
| `page_title` | text | Section/page title |
| `won_version` | match_only_text | WON version string |
| `won_version_for_sorting` | keyword | Sortable version for range queries |
| `customer` | match_only_text | Customer identifier |
| `build_nb` | text | Build number |
| `customer_version_nb` | text | Customer-specific version |
| `won_customer_version_full` | text | Full version string |

## Customer Indexes (54)

AETN, AEUS, AJL, AJMN, Altice, AMCN, BBC, BR, BSF, BSQ, BTS, BX1, CBC,
CURI, DAZN, DISCO, Disney Plus, DMC, DPG, DR, Dreamwall, EMGBE, FOXTEL,
France Televisions, M6, MBC, MEDIACORP, Mediaset, NEP, NPO, NRK, OCS,
Outernet, PMH, RTE, RTL Hungary, SH, SRF, SWR, SYN, TERN, TF1, TVMEDIA,
TVUV, TWCLA, UKTV, VIRGIN, VPRO, VRT, YES, YLE

## Pipeline Architecture

```
User Query
  → LLM Call #1: Query Reformulation (contextualize with history)
  → Vector Search: KB docs (per version)
  → Vector Search: Base release notes
  → Vector Search: Customer release notes (per customer)
  → LLM Call #2: Synthesize BASE answer (docs in system prompt as XML)
  → LLM Call #3: Synthesize CUSTOMER answer (per customer)
  → Post-process citations → Final answer
```

## Key Design Patterns

1. **Context in system prompt**: Retrieved docs embedded as `<documentation>` XML in developer/system role
2. **Clean message format**: `[developer/system + docs, history, user query]` — no tool roles
3. **Separate synthesis per source**: Base and customer answers generated independently
4. **Version filtering**: KNN queries filtered by `won_version_for_sorting` keyword field
5. **Batch indexing**: 100 docs per batch with refresh after each
