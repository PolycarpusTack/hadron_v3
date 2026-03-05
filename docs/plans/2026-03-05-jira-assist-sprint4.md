# JIRA Assist Sprint 4: Duplicate Detection

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Find semantically similar JIRA tickets using OpenAI embeddings stored in SQLite, with cosine similarity ranking.

**Embedding config:**
- Model: `text-embedding-3-small`, 1536 dimensions
- Source text: title + plain_summary + root_cause + customer_impact (from brief); fallback to title + description when no brief exists
- Timing: automatically after `generate_ticket_brief` succeeds, plus on-demand via "Find Similar" (generates embedding if missing)

**Search config:**
- Cosine similarity in Rust over all stored embeddings
- Default threshold: 0.65, default limit: 5
- Exclude the query ticket from results

---

## Context

### Key files

| Path | Role |
|------|------|
| `src-tauri/src/ticket_briefs.rs` | Existing CRUD for `ticket_briefs` table |
| `src-tauri/src/migrations.rs` | Migration 14 already created `ticket_embeddings` table |
| `src-tauri/src/retrieval/opensearch.rs` | `get_embedding(text, api_key, model, dimensions)` — reuse for OpenAI embeddings |
| `src-tauri/src/jira_brief.rs` | `run_jira_brief()` — parallel triage + deep analysis |
| `src-tauri/src/commands/jira_assist.rs` | Existing commands: `get_ticket_brief`, `delete_ticket_brief`, `triage_jira_ticket`, `generate_ticket_brief` |
| `src-tauri/src/main.rs` | Module declarations + `invoke_handler` registration |
| `src/services/jira-assist.ts` | TypeScript types + API functions for JIRA Assist |
| `src/components/jira/TicketBriefPanel.tsx` | UI for brief display — add "Similar Tickets" section here |

### ticket_embeddings table (migration 14, already applied)

```sql
CREATE TABLE IF NOT EXISTS ticket_embeddings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    jira_key     TEXT NOT NULL REFERENCES ticket_briefs(jira_key) ON DELETE CASCADE,
    embedding    BLOB NOT NULL,
    source_text  TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_embeddings_jira_key ON ticket_embeddings(jira_key);
```

### Existing get_embedding signature (retrieval/opensearch.rs)

```rust
pub async fn get_embedding(
    text: &str,
    api_key: &str,
    model: &str,
    dimensions: u32,
) -> Result<Vec<f64>, String>
```

---

## Task 1: Create `ticket_embeddings.rs` — BLOB serialization, CRUD, cosine similarity

**Files:**
- Create: `src-tauri/src/ticket_embeddings.rs`

### Step 1: Create the file

```rust
//! Ticket embedding storage and cosine-similarity search.

use rusqlite::params;

// ---- Serialization: Vec<f64> <-> BLOB (little-endian f64 bytes) ----------------

pub fn embedding_to_blob(embedding: &[f64]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

pub fn blob_to_embedding(blob: &[u8]) -> Vec<f64> {
    blob.chunks_exact(8)
        .map(|chunk| f64::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
}

// ---- Cosine similarity ----------------------------------------------------------

pub fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        0.0
    } else {
        dot / (mag_a * mag_b)
    }
}

// ---- CRUD -----------------------------------------------------------------------

/// Upsert an embedding for a ticket (one embedding per jira_key).
/// Deletes any existing row first, then inserts.
pub fn upsert_embedding(
    conn: &rusqlite::Connection,
    jira_key: &str,
    embedding: &[f64],
    source_text: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM ticket_embeddings WHERE jira_key = ?1",
        params![jira_key],
    )
    .map_err(|e| format!("Failed to delete old embedding: {e}"))?;

    let blob = embedding_to_blob(embedding);
    conn.execute(
        "INSERT INTO ticket_embeddings (jira_key, embedding, source_text) VALUES (?1, ?2, ?3)",
        params![jira_key, blob, source_text],
    )
    .map_err(|e| format!("Failed to insert embedding: {e}"))?;

    Ok(())
}

/// Check whether an embedding exists for a given ticket.
pub fn has_embedding(conn: &rusqlite::Connection, jira_key: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM ticket_embeddings WHERE jira_key = ?1",
        params![jira_key],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .map_err(|e| format!("Failed to check embedding: {e}"))
}

/// Retrieve the embedding vector for a ticket.
pub fn get_embedding_for_ticket(
    conn: &rusqlite::Connection,
    jira_key: &str,
) -> Result<Option<Vec<f64>>, String> {
    let mut stmt = conn
        .prepare("SELECT embedding FROM ticket_embeddings WHERE jira_key = ?1")
        .map_err(|e| format!("Failed to prepare query: {e}"))?;

    let mut rows = stmt
        .query_map(params![jira_key], |row| {
            let blob: Vec<u8> = row.get(0)?;
            Ok(blob_to_embedding(&blob))
        })
        .map_err(|e| format!("Failed to query embedding: {e}"))?;

    match rows.next() {
        Some(Ok(emb)) => Ok(Some(emb)),
        Some(Err(e)) => Err(format!("Failed to read embedding row: {e}")),
        None => Ok(None),
    }
}

// ---- Similarity search -----------------------------------------------------------

/// Result of a similarity search.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SimilarTicketMatch {
    pub jira_key: String,
    pub title: String,
    pub similarity: f64,
    pub severity: Option<String>,
    pub category: Option<String>,
}

/// Find tickets similar to the given embedding vector.
/// Returns up to `limit` results above `threshold`, excluding `exclude_key`.
pub fn find_similar(
    conn: &rusqlite::Connection,
    query_embedding: &[f64],
    exclude_key: &str,
    threshold: f64,
    limit: usize,
) -> Result<Vec<SimilarTicketMatch>, String> {
    // Fetch all embeddings + brief metadata in one query
    let mut stmt = conn
        .prepare(
            "SELECT e.jira_key, e.embedding, b.title, b.severity, b.category
             FROM ticket_embeddings e
             JOIN ticket_briefs b ON b.jira_key = e.jira_key
             WHERE e.jira_key != ?1",
        )
        .map_err(|e| format!("Failed to prepare similarity query: {e}"))?;

    let rows = stmt
        .query_map(params![exclude_key], |row| {
            let jira_key: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            let title: String = row.get(2)?;
            let severity: Option<String> = row.get(3)?;
            let category: Option<String> = row.get(4)?;
            Ok((jira_key, blob, title, severity, category))
        })
        .map_err(|e| format!("Failed to run similarity query: {e}"))?;

    let mut matches: Vec<SimilarTicketMatch> = Vec::new();

    for row in rows {
        let (jira_key, blob, title, severity, category) =
            row.map_err(|e| format!("Failed to read row: {e}"))?;
        let embedding = blob_to_embedding(&blob);
        let sim = cosine_similarity(query_embedding, &embedding);
        if sim >= threshold {
            matches.push(SimilarTicketMatch {
                jira_key,
                title,
                similarity: sim,
                severity,
                category,
            });
        }
    }

    // Sort descending by similarity
    matches.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    matches.truncate(limit);

    Ok(matches)
}
```

### Step 2: Add Database wrapper methods

Read `src-tauri/src/database.rs` to find the `impl Database` block. Add these methods following the existing pattern (they delegate to the free functions above via `self.conn()`):

```rust
// ---- Ticket Embeddings ----

pub fn upsert_ticket_embedding(
    &self,
    jira_key: &str,
    embedding: &[f64],
    source_text: &str,
) -> Result<(), String> {
    let conn = self.conn();
    crate::ticket_embeddings::upsert_embedding(&conn, jira_key, embedding, source_text)
}

pub fn has_ticket_embedding(&self, jira_key: &str) -> Result<bool, String> {
    let conn = self.conn();
    crate::ticket_embeddings::has_embedding(&conn, jira_key)
}

pub fn get_ticket_embedding(&self, jira_key: &str) -> Result<Option<Vec<f64>>, String> {
    let conn = self.conn();
    crate::ticket_embeddings::get_embedding_for_ticket(&conn, jira_key)
}

pub fn find_similar_tickets(
    &self,
    query_embedding: &[f64],
    exclude_key: &str,
    threshold: f64,
    limit: usize,
) -> Result<Vec<crate::ticket_embeddings::SimilarTicketMatch>, String> {
    let conn = self.conn();
    crate::ticket_embeddings::find_similar(&conn, query_embedding, exclude_key, threshold, limit)
}
```

### Step 3: Declare module in `main.rs`

After the existing `mod ticket_briefs;` line, add:

```rust
mod ticket_embeddings;
```

### Step 4: Verify compiles

```bash
cd hadron-desktop && cargo check 2>&1 | grep "error" | head -20
```

Expected: no errors. Warnings about unused functions are OK at this stage.

### Step 5: Commit

```
feat(jira-assist): add ticket_embeddings module with BLOB serialization and cosine similarity search
```

---

## Task 2: Build embedding source text helper + embed-on-brief hook

**Files:**
- Modify: `src-tauri/src/commands/jira_assist.rs`

### Step 1: Add a helper function to build embedding source text

At the top of the file (after imports), add:

```rust
use crate::ticket_embeddings::SimilarTicketMatch;

const EMBEDDING_MODEL: &str = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS: u32 = 1536;

/// Build the source text for embedding from brief data.
/// Uses AI-generated fields when available, falls back to raw ticket data.
fn build_embedding_text(
    title: &str,
    brief_json: Option<&str>,
    description: &str,
) -> String {
    if let Some(json_str) = brief_json {
        if let Ok(brief) = serde_json::from_str::<serde_json::Value>(json_str) {
            let mut parts = vec![title.to_string()];

            // analysis.plain_summary
            if let Some(summary) = brief
                .get("analysis")
                .and_then(|a| a.get("plain_summary"))
                .and_then(|s| s.as_str())
            {
                parts.push(summary.to_string());
            }

            // analysis.technical.root_cause
            if let Some(root_cause) = brief
                .get("analysis")
                .and_then(|a| a.get("technical"))
                .and_then(|t| t.get("root_cause"))
                .and_then(|s| s.as_str())
            {
                parts.push(root_cause.to_string());
            }

            // triage.customer_impact
            if let Some(impact) = brief
                .get("triage")
                .and_then(|t| t.get("customer_impact"))
                .and_then(|s| s.as_str())
            {
                parts.push(impact.to_string());
            }

            if parts.len() > 1 {
                return parts.join("\n\n");
            }
        }
    }

    // Fallback: title + raw description
    if description.is_empty() {
        title.to_string()
    } else {
        format!("{title}\n\n{description}")
    }
}
```

### Step 2: Add embed-on-brief hook to `generate_ticket_brief`

In the existing `generate_ticket_brief` command, after the brief is persisted to `ticket_briefs` (after the `db.upsert_ticket_brief(...)` call), add the embedding generation. This should be fire-and-forget — don't fail the brief if embedding fails.

Find the spot after `upsert_ticket_brief` succeeds and before the function returns. Add:

```rust
// -- Embed the ticket (fire-and-forget; log errors but don't fail the brief) --
{
    let api_key = api_key_clone.clone(); // capture the API key used for the brief
    let jira_key = jira_key.clone();
    let title = title.clone();
    let brief_json_str = brief_json.clone(); // the serialized brief_json string
    let description = description.clone();
    let db2 = Arc::clone(&db);

    tokio::spawn(async move {
        let source_text = build_embedding_text(&title, Some(&brief_json_str), &description);
        match crate::retrieval::opensearch::get_embedding(
            &source_text,
            &api_key,
            EMBEDDING_MODEL,
            EMBEDDING_DIMENSIONS,
        )
        .await
        {
            Ok(embedding) => {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    if let Err(e) = db2.upsert_ticket_embedding(&jira_key, &embedding, &source_text) {
                        log::warn!("Failed to store embedding for {}: {e}", jira_key);
                    }
                })
                .await;
            }
            Err(e) => {
                log::warn!("Failed to generate embedding for {jira_key}: {e}");
            }
        }
    });
}
```

**Note:** You'll need to capture `api_key`, `title`, `description`, and `brief_json` before they're moved. Read the existing `generate_ticket_brief` function to identify exactly where these values are available and clone them as needed. The embed block uses `tokio::spawn` so it runs concurrently — the command returns the brief immediately without waiting.

### Step 3: Verify compiles

```bash
cd hadron-desktop && cargo check 2>&1 | grep "error" | head -20
```

### Step 4: Commit

```
feat(jira-assist): auto-embed ticket on brief generation (fire-and-forget)
```

---

## Task 3: Add `find_similar_tickets` Tauri command

**Files:**
- Modify: `src-tauri/src/commands/jira_assist.rs`
- Modify: `src-tauri/src/main.rs`

### Step 1: Add the command

At the end of `commands/jira_assist.rs`, add:

```rust
/// Find tickets similar to the given ticket using embedding cosine similarity.
/// If the ticket has no embedding yet, generates one on the fly.
#[tauri::command]
pub async fn find_similar_tickets(
    jira_key: String,
    title: String,
    description: String,
    api_key: String,
    threshold: Option<f64>,
    limit: Option<usize>,
    db: DbState<'_>,
) -> CommandResult<Vec<SimilarTicketMatch>> {
    log::debug!("cmd: find_similar_tickets key={jira_key}");

    let threshold = threshold.unwrap_or(0.65);
    let limit = limit.unwrap_or(5);
    let db = Arc::clone(&db);

    // 1. Check if we already have an embedding; if not, generate one
    let db2 = Arc::clone(&db);
    let jira_key2 = jira_key.clone();
    let has_emb = tauri::async_runtime::spawn_blocking(move || {
        db2.has_ticket_embedding(&jira_key2)
    })
    .await
    .map_err(|e| HadronError::internal(format!("Task error: {e}")))??;

    if !has_emb {
        // Try to build source text from existing brief, or fall back to title+description
        let db3 = Arc::clone(&db);
        let jira_key3 = jira_key.clone();
        let brief_json = tauri::async_runtime::spawn_blocking(move || {
            db3.get_ticket_brief(&jira_key3)
        })
        .await
        .map_err(|e| HadronError::internal(format!("Task error: {e}")))?
        .ok()
        .flatten()
        .and_then(|b| b.brief_json);

        let source_text = build_embedding_text(&title, brief_json.as_deref(), &description);

        let embedding = crate::retrieval::opensearch::get_embedding(
            &source_text,
            &api_key,
            EMBEDDING_MODEL,
            EMBEDDING_DIMENSIONS,
        )
        .await
        .map_err(|e| HadronError::internal(format!("Embedding generation failed: {e}")))?;

        let db4 = Arc::clone(&db);
        let jira_key4 = jira_key.clone();
        let source_text2 = source_text.clone();
        tauri::async_runtime::spawn_blocking(move || {
            db4.upsert_ticket_embedding(&jira_key4, &embedding, &source_text2)
        })
        .await
        .map_err(|e| HadronError::internal(format!("Task error: {e}")))??;
    }

    // 2. Fetch the embedding
    let db5 = Arc::clone(&db);
    let jira_key5 = jira_key.clone();
    let query_embedding = tauri::async_runtime::spawn_blocking(move || {
        db5.get_ticket_embedding(&jira_key5)
    })
    .await
    .map_err(|e| HadronError::internal(format!("Task error: {e}")))??
    .ok_or_else(|| HadronError::internal("Embedding not found after generation".to_string()))?;

    // 3. Search
    let db6 = Arc::clone(&db);
    let jira_key6 = jira_key.clone();
    let results = tauri::async_runtime::spawn_blocking(move || {
        db6.find_similar_tickets(&query_embedding, &jira_key6, threshold, limit)
    })
    .await
    .map_err(|e| HadronError::internal(format!("Task error: {e}")))??;

    Ok(results)
}
```

### Step 2: Register command in `main.rs`

In the `invoke_handler!(tauri::generate_handler![...])` block, after the existing `generate_ticket_brief,` line, add:

```rust
find_similar_tickets,
```

### Step 3: Verify compiles

```bash
cd hadron-desktop && cargo check 2>&1 | grep "error" | head -20
```

### Step 4: Commit

```
feat(jira-assist): add find_similar_tickets command with on-demand embedding
```

---

## Task 4: Add TypeScript types and API function

**Files:**
- Modify: `src/services/jira-assist.ts`

### Step 1: Add the SimilarTicket interface

After the existing type exports, add:

```typescript
export interface SimilarTicket {
  jira_key: string;
  title: string;
  similarity: number;
  severity: string | null;
  category: string | null;
}
```

### Step 2: Add the findSimilarTickets function

After the existing `generateTicketBrief` function, add:

```typescript
export async function findSimilarTickets(params: {
  jiraKey: string;
  title: string;
  description: string;
  apiKey: string;
  threshold?: number;
  limit?: number;
}): Promise<SimilarTicket[]> {
  return invoke<SimilarTicket[]>("find_similar_tickets", {
    jiraKey: params.jiraKey,
    title: params.title,
    description: params.description,
    apiKey: params.apiKey,
    threshold: params.threshold,
    limit: params.limit,
  });
}
```

### Step 3: Verify TypeScript compiles

```bash
cd hadron-desktop && npx tsc --noEmit 2>&1 | head -20
```

### Step 4: Commit

```
feat(jira-assist): add SimilarTicket type and findSimilarTickets API function
```

---

## Task 5: Add "Similar Tickets" section to TicketBriefPanel

**Files:**
- Modify: `src/components/jira/TicketBriefPanel.tsx`

### Step 1: Add imports

Add to existing imports:

```typescript
import { findSimilarTickets, type SimilarTicket } from "../../services/jira-assist";
```

Add `Search` to the existing `lucide-react` import.

### Step 2: Add state and handler

Inside the component, add state for similar tickets:

```typescript
const [similarTickets, setSimilarTickets] = useState<SimilarTicket[]>([]);
const [searchingSimlar, setSearchingSimilar] = useState(false);
const [similarError, setSimilarError] = useState<string | null>(null);
```

Add the search handler:

```typescript
async function handleFindSimilar() {
  if (!brief) return;
  setSearchingSimilar(true);
  setSimilarError(null);
  try {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setSimilarError("No API key configured.");
      return;
    }
    const results = await findSimilarTickets({
      jiraKey: brief.jira_key,
      title: brief.title,
      description: "", // description not stored in brief; title is enough with the brief_json fallback
      apiKey,
    });
    setSimilarTickets(results);
  } catch (err) {
    setSimilarError(`Search failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    setSearchingSimilar(false);
  }
}
```

**Note:** Check how `brief` / props are structured. The handler needs `jira_key` and `title` from the brief. Adapt the prop names to match the actual component interface. Also check how `getStoredApiKey` is imported — follow the pattern used in `JiraTicketAnalyzer.tsx`.

### Step 3: Add the UI section

Inside the Brief tab content area, after the existing sections (e.g. after Risk & Impact or Triage Rationale), add a new collapsible section:

```tsx
{/* Similar Tickets */}
<div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
  <div className="px-4 py-2.5 flex items-center justify-between">
    <div className="flex items-center gap-2 text-sm font-medium text-white">
      <Search className="w-4 h-4 text-cyan-400" />
      Similar Tickets
    </div>
    <button
      onClick={handleFindSimilar}
      disabled={searchingSimilar}
      className="text-xs px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium disabled:opacity-50 transition"
    >
      {searchingSimilar ? "Searching..." : "Find Similar"}
    </button>
  </div>

  {similarError && (
    <div className="px-4 pb-3">
      <p className="text-xs text-red-400">{similarError}</p>
    </div>
  )}

  {similarTickets.length > 0 && (
    <div className="px-4 pb-4 space-y-2">
      {similarTickets.map((ticket) => (
        <div
          key={ticket.jira_key}
          className="flex items-center justify-between p-2.5 rounded-lg border border-gray-700 bg-gray-800/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-mono text-cyan-400 font-semibold">
                {ticket.jira_key}
              </span>
              {ticket.severity && (
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  SEVERITY_BADGE[ticket.severity as keyof typeof SEVERITY_BADGE] ?? "bg-gray-700 text-gray-300"
                }`}>
                  {ticket.severity}
                </span>
              )}
              {ticket.category && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
                  {ticket.category}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-300 truncate">{ticket.title}</p>
          </div>
          <span className="text-xs font-semibold text-cyan-300 ml-3 flex-shrink-0">
            {Math.round(ticket.similarity * 100)}%
          </span>
        </div>
      ))}
    </div>
  )}

  {!searchingSimilar && similarTickets.length === 0 && !similarError && (
    <div className="px-4 pb-3">
      <p className="text-xs text-gray-500">Click "Find Similar" to search for duplicate or related tickets.</p>
    </div>
  )}
</div>
```

**Note:** `SEVERITY_BADGE` is already exported from `jira-assist.ts`. Import it if not already imported. Adapt class names and layout to match the existing section styling in the component.

### Step 4: Verify frontend builds

```bash
cd hadron-desktop && npx tsc --noEmit 2>&1 | head -20
```

### Step 5: Commit

```
feat(jira-assist): add Similar Tickets section to TicketBriefPanel with Find Similar button
```

---

## Task 6: Full build verification

### Step 1: Rust build

```bash
cd hadron-desktop && cargo check 2>&1 | grep "error" | head -20
```

### Step 2: TypeScript build

```bash
cd hadron-desktop && npm run build 2>&1 | tail -20
```

### Step 3: Fix any errors

Common issues to watch for:
- `get_embedding` might not be `pub` — check `retrieval/opensearch.rs` and add `pub` if needed
- `DbState` and `HadronError` imports missing in `jira_assist.rs` — check what's already imported
- `Arc` not imported — add `use std::sync::Arc;` if missing
- Tauri `invoke` serializes `camelCase` — the `find_similar_tickets` command params need `snake_case` on Rust side; check that the TypeScript `invoke` call uses the correct key casing (Tauri auto-converts camelCase to snake_case)
- `getStoredApiKey` import path may differ — check existing usage in `JiraTicketAnalyzer.tsx`

### Step 4: Commit if fixes needed

```
fix(jira-assist): fix build errors in Sprint 4 duplicate detection
```

---

## Acceptance Criteria

- [ ] `ticket_embeddings.rs` module with BLOB serialization, cosine similarity, and CRUD functions
- [ ] Database wrapper methods for embedding operations
- [ ] Embedding auto-generated after `generate_ticket_brief` (fire-and-forget, non-blocking)
- [ ] `find_similar_tickets` Tauri command with on-demand embedding generation
- [ ] `SimilarTicket` TypeScript type and `findSimilarTickets()` API function
- [ ] "Similar Tickets" collapsible section in TicketBriefPanel with "Find Similar" button
- [ ] Results show JIRA key, title, similarity percentage, severity/category badges
- [ ] Both Rust and TypeScript builds pass cleanly
