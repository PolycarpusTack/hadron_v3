# Phase 2b: Duplicate Detection + JIRA Round-Trip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add embedding-based duplicate ticket detection and JIRA comment posting with engineer feedback to the JIRA Assist feature.

**Architecture:** Reuse existing pgvector embeddings infrastructure (table, generate, store, search) with `source_type='ticket'`. Add JIRA comment posting and wiki markup formatting to the integrations layer. Extend TicketBriefPanel with similar tickets, post-to-JIRA, and feedback UI.

**Tech Stack:** Rust (hadron-server, pgvector, reqwest), React 18 + TypeScript + Tailwind CSS

---

## File Map

All modifications — no new files.

| File | Changes |
|------|---------|
| `crates/hadron-server/src/db/mod.rs` | Add `store_ticket_embedding()`, `find_similar_tickets()`, `mark_posted_to_jira()`, `update_engineer_feedback()`, `build_ticket_embedding_text()` |
| `crates/hadron-server/src/integrations/jira.rs` | Add `post_jira_comment()`, `format_brief_as_jira_markup()` |
| `crates/hadron-server/src/routes/jira_analysis.rs` | Add similar, post-brief, feedback routes; fire-and-forget embed in brief route |
| `crates/hadron-server/src/routes/mod.rs` | Register 3 new routes |
| `frontend/src/services/api.ts` | Add `SimilarTicketMatch` type + 3 API methods |
| `frontend/src/components/jira/TicketBriefPanel.tsx` | Add similar tickets section, post-to-JIRA, feedback |
| `frontend/src/components/jira/JiraAnalyzerView.tsx` | Pass creds + briefRow + callback to TicketBriefPanel |

---

## Task 1: DB Functions for Ticket Embeddings + Feedback

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/db/mod.rs`

- [ ] **Step 1: Add ticket embedding and feedback functions**

Read the file. Then append these functions at the end (near the existing ticket_briefs section):

```rust
// ============================================================================
// Ticket Embeddings (duplicate detection)
// ============================================================================

/// Deterministic hash of a JIRA key to use as source_id in the embeddings table.
fn jira_key_to_source_id(jira_key: &str) -> i64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    jira_key.hash(&mut hasher);
    hasher.finish() as i64
}

/// Build embedding text from brief data (AI-generated fields preferred) or raw ticket data.
pub fn build_ticket_embedding_text(
    title: &str,
    description: &str,
    brief_json: Option<&str>,
) -> String {
    // Try to extract AI-generated fields from brief_json
    if let Some(json_str) = brief_json {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
            let mut parts = Vec::new();

            if let Some(summary) = val.pointer("/analysis/plain_summary").and_then(|v| v.as_str()) {
                if !summary.is_empty() {
                    parts.push(summary.to_string());
                }
            }
            if let Some(root_cause) = val.pointer("/analysis/technical/root_cause").and_then(|v| v.as_str()) {
                if !root_cause.is_empty() {
                    parts.push(root_cause.to_string());
                }
            }
            if let Some(impact) = val.pointer("/triage/customer_impact").and_then(|v| v.as_str()) {
                if !impact.is_empty() {
                    parts.push(impact.to_string());
                }
            }

            if !parts.is_empty() {
                return format!("{}\n\n{}", title, parts.join("\n\n"));
            }
        }
    }

    // Fallback: title + description
    if description.is_empty() {
        title.to_string()
    } else {
        format!("{}\n\n{}", title, description)
    }
}

/// Store a ticket embedding in the existing embeddings table with source_type='ticket'.
pub async fn store_ticket_embedding(
    pool: &PgPool,
    jira_key: &str,
    embedding: &[f32],
    content: &str,
) -> HadronResult<i64> {
    let source_id = jira_key_to_source_id(jira_key);
    let metadata = serde_json::json!({ "jira_key": jira_key });
    store_embedding(pool, source_id, "ticket", embedding, content, Some(&metadata)).await
}

/// Result of a similar ticket search.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarTicketMatch {
    pub jira_key: String,
    pub title: String,
    pub similarity: f64,
    pub severity: Option<String>,
    pub category: Option<String>,
}

/// Find tickets similar to the given embedding vector.
pub async fn find_similar_tickets(
    pool: &PgPool,
    embedding: &[f32],
    exclude_key: &str,
    threshold: f64,
    limit: i64,
) -> HadronResult<Vec<SimilarTicketMatch>> {
    let vec_str = format!(
        "[{}]",
        embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    let exclude_source_id = jira_key_to_source_id(exclude_key);

    let rows: Vec<(String, String, f64, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT
            (e.metadata->>'jira_key')::text as jira_key,
            COALESCE(tb.title, '') as title,
            1 - (e.embedding <=> $1::vector) as similarity,
            tb.severity,
            tb.category
         FROM embeddings e
         LEFT JOIN ticket_briefs tb ON (e.metadata->>'jira_key') = tb.jira_key
         WHERE e.source_type = 'ticket'
           AND e.source_id != $4
           AND 1 - (e.embedding <=> $1::vector) > $3
         ORDER BY e.embedding <=> $1::vector
         LIMIT $2",
    )
    .bind(&vec_str)
    .bind(limit)
    .bind(threshold)
    .bind(exclude_source_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|(jira_key, title, similarity, severity, category)| SimilarTicketMatch {
            jira_key,
            title,
            similarity,
            severity,
            category,
        })
        .collect())
}

// ============================================================================
// JIRA Round-Trip (posting + feedback)
// ============================================================================

/// Mark a ticket brief as posted to JIRA.
pub async fn mark_posted_to_jira(pool: &PgPool, jira_key: &str) -> HadronResult<()> {
    sqlx::query(
        "UPDATE ticket_briefs SET posted_to_jira = true, posted_at = NOW(), updated_at = NOW()
         WHERE jira_key = $1",
    )
    .bind(jira_key)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

/// Update engineer feedback on a ticket brief.
pub async fn update_engineer_feedback(
    pool: &PgPool,
    jira_key: &str,
    rating: Option<i16>,
    notes: Option<&str>,
) -> HadronResult<()> {
    sqlx::query(
        "UPDATE ticket_briefs SET
            engineer_rating = COALESCE($2, engineer_rating),
            engineer_notes = COALESCE($3, engineer_notes),
            updated_at = NOW()
         WHERE jira_key = $1",
    )
    .bind(jira_key)
    .bind(rating)
    .bind(notes)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}
```

- [ ] **Step 2: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-server/src/db/mod.rs
git commit -m "feat(web): add ticket embedding storage, similarity search, and feedback DB functions"
```

---

## Task 2: JIRA Comment Posting + Wiki Markup

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/integrations/jira.rs`

- [ ] **Step 1: Add comment posting and markup formatting**

Read the current file. Then append these functions:

```rust
/// Post a comment to a JIRA issue.
pub async fn post_jira_comment(
    config: &JiraConfig,
    key: &str,
    body: &str,
) -> HadronResult<()> {
    let client = build_client()?;

    // Validate key
    if !key.chars().all(|c| c.is_alphanumeric() || c == '-') {
        return Err(HadronError::Validation(format!("Invalid JIRA key: {key}")));
    }

    // Use API v2 for comment posting (v3 uses ADF which is more complex)
    let url = format!(
        "{}/rest/api/2/issue/{}/comment",
        config.base_url.trim_end_matches('/'),
        key
    );

    let resp = client
        .post(&url)
        .basic_auth(&config.email, Some(&config.api_token))
        .json(&serde_json::json!({ "body": body }))
        .send()
        .await
        .map_err(|e| HadronError::external_service(format!("JIRA comment failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(HadronError::external_service(format!(
            "JIRA comment returned {status}: {text}"
        )));
    }

    Ok(())
}

/// Format a JiraBriefResult as JIRA wiki markup for posting as a comment.
pub fn format_brief_as_jira_markup(
    brief: &hadron_core::ai::JiraBriefResult,
    jira_key: &str,
) -> String {
    let triage = &brief.triage;
    let analysis = &brief.analysis;

    let mut lines = vec![
        format!("h3. Hadron Investigation Brief — {jira_key}"),
        String::new(),
        format!(
            "*Severity:* {} | *Category:* {} | *Confidence:* {}",
            triage.severity, triage.category, triage.confidence
        ),
    ];

    // Summary
    if !analysis.plain_summary.is_empty() {
        lines.push(String::new());
        lines.push("h4. Summary".to_string());
        lines.push(analysis.plain_summary.clone());
    }

    // Root Cause
    if !analysis.technical.root_cause.is_empty() {
        lines.push(String::new());
        lines.push("h4. Root Cause".to_string());
        lines.push(analysis.technical.root_cause.clone());
    }

    // Recommended Actions
    if !analysis.recommended_actions.is_empty() {
        lines.push(String::new());
        lines.push("h4. Recommended Actions".to_string());
        for action in &analysis.recommended_actions {
            lines.push(format!(
                "* *[{}]* {} — _{}_",
                action.priority, action.action, action.rationale
            ));
        }
    }

    // Risk
    lines.push(String::new());
    lines.push(format!(
        "*Risk:* {} blast radius, {} urgency. {}",
        analysis.risk.blast_radius,
        analysis.risk.urgency,
        analysis.risk.do_nothing_risk
    ));

    // Footer
    lines.push(String::new());
    lines.push("----".to_string());
    lines.push("_Generated by Hadron JIRA Assist_".to_string());

    lines.join("\n")
}
```

- [ ] **Step 2: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-server/src/integrations/jira.rs
git commit -m "feat(web): add JIRA comment posting and wiki markup formatting"
```

---

## Task 3: Backend Routes (Similar, Post-Brief, Feedback)

**Files:**
- Modify: `hadron-web/crates/hadron-server/src/routes/jira_analysis.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add three new route handlers**

Read `hadron-web/crates/hadron-server/src/routes/jira_analysis.rs`. Append:

```rust
// ============================================================================
// Similar Tickets (embeddings)
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarTicketsRequest {
    pub credentials: JiraCredentials,
    pub threshold: Option<f64>,
    pub limit: Option<i64>,
}

/// POST /api/jira/issues/{key}/similar — find similar tickets via embeddings.
pub async fn find_similar_tickets(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<SimilarTicketsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let threshold = req.threshold.unwrap_or(0.65);
    let limit = req.limit.unwrap_or(5).min(20);

    // Load the brief to build embedding text
    let brief_row = crate::db::get_ticket_brief(&state.db, &key).await?;

    let title = brief_row.as_ref().map(|b| b.title.as_str()).unwrap_or(&key);
    let brief_json = brief_row.as_ref().and_then(|b| b.brief_json.as_deref());

    // Get or generate embedding
    let embed_text = crate::db::build_ticket_embedding_text(title, "", brief_json);

    // Resolve AI config for embedding API call (uses OpenAI)
    let ai_config = super::analyses::resolve_ai_config(
        &state.db,
        None,
        None,
        None,
    )
    .await?;

    let embedding = crate::integrations::embeddings::generate_embedding(
        &embed_text,
        &ai_config.api_key,
    )
    .await?;

    // Store embedding for future searches (fire-and-forget pattern)
    let pool_clone = state.db.clone();
    let key_clone = key.clone();
    let embed_clone = embedding.clone();
    let text_clone = embed_text.clone();
    tokio::spawn(async move {
        let _ = crate::db::store_ticket_embedding(
            &pool_clone,
            &key_clone,
            &embed_clone,
            &text_clone,
        )
        .await;
    });

    let similar = crate::db::find_similar_tickets(
        &state.db,
        &embedding,
        &key,
        threshold,
        limit,
    )
    .await?;

    Ok(Json(similar))
}

// ============================================================================
// Post Brief to JIRA
// ============================================================================

/// POST /api/jira/issues/{key}/post-brief — format and post brief as JIRA comment.
pub async fn post_brief_to_jira(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<FetchIssueRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Load brief from DB
    let brief_row = crate::db::get_ticket_brief(&state.db, &key)
        .await?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::not_found(
                format!("No brief found for {key}"),
            ))
        })?;

    let brief_json_str = brief_row.brief_json.ok_or_else(|| {
        AppError(hadron_core::error::HadronError::validation(
            "Brief has no analysis data. Generate a brief first.",
        ))
    })?;

    let brief: hadron_core::ai::JiraBriefResult = serde_json::from_str(&brief_json_str)
        .map_err(|e| {
            AppError(hadron_core::error::HadronError::Parse(format!(
                "Failed to parse stored brief: {e}"
            )))
        })?;

    // Format as wiki markup
    let markup = jira::format_brief_as_jira_markup(&brief, &key);

    // Post to JIRA
    let config = to_jira_config(&req.credentials);
    jira::post_jira_comment(&config, &key, &markup).await?;

    // Mark as posted
    crate::db::mark_posted_to_jira(&state.db, &key).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ============================================================================
// Engineer Feedback
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    pub rating: Option<i16>,
    pub notes: Option<String>,
}

/// PUT /api/jira/briefs/{key}/feedback — update engineer rating and notes.
pub async fn submit_feedback(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<FeedbackRequest>,
) -> Result<impl IntoResponse, AppError> {
    crate::db::update_engineer_feedback(
        &state.db,
        &key,
        req.rating,
        req.notes.as_deref(),
    )
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Add fire-and-forget embedding to `generate_brief`**

In the existing `generate_brief` handler (the non-streaming one), after the DB upsert block, add:

```rust
    // Fire-and-forget: generate embedding for similarity search
    let pool_clone = state.db.clone();
    let key_clone = key.clone();
    let title_clone = ticket.summary.clone();
    let brief_json_clone = brief_json.clone();
    let api_key_clone = ai_config.api_key.clone();
    tokio::spawn(async move {
        let embed_text = crate::db::build_ticket_embedding_text(&title_clone, "", Some(&brief_json_clone));
        match crate::integrations::embeddings::generate_embedding(&embed_text, &api_key_clone).await {
            Ok(embedding) => {
                let _ = crate::db::store_ticket_embedding(&pool_clone, &key_clone, &embedding, &embed_text).await;
                tracing::debug!("Ticket embedding generated for {key_clone}");
            }
            Err(e) => {
                tracing::warn!("Failed to generate embedding for {key_clone}: {e}");
            }
        }
    });
```

- [ ] **Step 3: Register routes in `mod.rs`**

In `hadron-web/crates/hadron-server/src/routes/mod.rs`, add after the existing JIRA brief routes:

```rust
        // JIRA Similar Tickets + Round-Trip
        .route("/jira/issues/{key}/similar", post(jira_analysis::find_similar_tickets))
        .route("/jira/issues/{key}/post-brief", post(jira_analysis::post_brief_to_jira))
        .route("/jira/briefs/{key}/feedback", put(jira_analysis::submit_feedback))
```

- [ ] **Step 4: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/jira_analysis.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(web): add similar tickets, post-to-JIRA, and feedback routes"
```

---

## Task 4: Frontend Types and API Methods

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`

- [ ] **Step 1: Add type and API methods**

Read the file. Add after the `TicketBriefRow` interface:

```typescript
export interface SimilarTicketMatch {
  jiraKey: string;
  title: string;
  similarity: number;
  severity: string | null;
  category: string | null;
}
```

Add to the `ApiClient` class after the existing JIRA methods:

```typescript
  // === JIRA Similar Tickets + Round-Trip ===

  async findSimilarTickets(
    key: string,
    credentials: JiraCredentials,
    threshold?: number,
    limit?: number,
  ): Promise<SimilarTicketMatch[]> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/similar`, {
      credentials,
      threshold,
      limit,
    });
  }

  async postBriefToJira(
    key: string,
    credentials: JiraCredentials,
  ): Promise<void> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/post-brief`, {
      credentials,
    });
  }

  async submitEngineerFeedback(
    key: string,
    rating?: number,
    notes?: string,
  ): Promise<void> {
    return this.request("PUT", `/jira/briefs/${encodeURIComponent(key)}/feedback`, {
      rating,
      notes,
    });
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts
git commit -m "feat(web): add similar tickets, post-to-JIRA, and feedback API methods"
```

---

## Task 5: Extend TicketBriefPanel with Similar Tickets, Post, Feedback

**Files:**
- Modify: `hadron-web/frontend/src/components/jira/TicketBriefPanel.tsx`

- [ ] **Step 1: Read the current file and extend**

Read `hadron-web/frontend/src/components/jira/TicketBriefPanel.tsx`. Make these changes:

**Update props:**
```typescript
interface TicketBriefPanelProps {
  jiraKey: string;
  result: JiraBriefResult;
  jiraCredentials: JiraCredentials;
  briefRow: TicketBriefRow | null;
  onBriefUpdated?: () => void;
}
```

Add imports for new types:
```typescript
import { api, JiraBriefResult, JiraCredentials, TicketBriefRow, SimilarTicketMatch } from "../../services/api";
```

**Add state:**
```typescript
const [similarTickets, setSimilarTickets] = useState<SimilarTicketMatch[]>([]);
const [searchingSimilar, setSearchingSimilar] = useState(false);
const [posting, setPosting] = useState(false);
const [rating, setRating] = useState<number>(briefRow?.engineerRating || 0);
const [notes, setNotes] = useState(briefRow?.engineerNotes || "");
const [showNotes, setShowNotes] = useState(false);
```

**Add handlers:**

```typescript
const handleFindSimilar = async () => {
  setSearchingSimilar(true);
  try {
    const results = await api.findSimilarTickets(jiraKey, jiraCredentials, 0.65, 5);
    setSimilarTickets(results);
  } catch (err) {
    // silently fail — not critical
  } finally {
    setSearchingSimilar(false);
  }
};

const handlePostToJira = async () => {
  if (!window.confirm(`Post this brief as a comment on ${jiraKey}?`)) return;
  setPosting(true);
  try {
    await api.postBriefToJira(jiraKey, jiraCredentials);
    onBriefUpdated?.();
  } catch (err) {
    // show error somehow
  } finally {
    setPosting(false);
  }
};

const handleRating = async (value: number) => {
  setRating(value);
  await api.submitEngineerFeedback(jiraKey, value).catch(() => {});
  onBriefUpdated?.();
};

const handleNotesBlur = async () => {
  if (notes !== (briefRow?.engineerNotes || "")) {
    await api.submitEngineerFeedback(jiraKey, undefined, notes).catch(() => {});
    onBriefUpdated?.();
  }
};
```

**Add to header area** (next to tab buttons):

1. **Post to JIRA button:**
```tsx
<button
  onClick={handlePostToJira}
  disabled={posting || briefRow?.postedToJira}
  className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
>
  {briefRow?.postedToJira ? `Posted ${briefRow.postedAt ? new Date(briefRow.postedAt).toLocaleDateString() : ""}` : posting ? "Posting..." : "Post to JIRA"}
</button>
```

2. **Star rating** (5 clickable stars):
```tsx
<div className="flex gap-0.5">
  {[1, 2, 3, 4, 5].map((star) => (
    <button
      key={star}
      onClick={() => handleRating(star)}
      className={`text-lg ${star <= rating ? "text-yellow-400" : "text-slate-600"}`}
    >
      ★
    </button>
  ))}
</div>
```

3. **Notes toggle + textarea:**
```tsx
<button onClick={() => setShowNotes(!showNotes)} className="text-xs text-slate-400 hover:text-slate-300">
  {showNotes ? "Hide Notes" : "Notes"}
</button>
{showNotes && (
  <textarea
    value={notes}
    onChange={(e) => setNotes(e.target.value)}
    onBlur={handleNotesBlur}
    placeholder="Engineer notes..."
    className="mt-2 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200"
    rows={3}
  />
)}
```

**Add "Similar Tickets" section** at the bottom of the Brief tab content:

```tsx
{/* Similar Tickets */}
<div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
  <div className="flex items-center justify-between mb-3">
    <h4 className="text-sm font-semibold text-slate-300">Similar Tickets</h4>
    <button
      onClick={handleFindSimilar}
      disabled={searchingSimilar}
      className="rounded-md bg-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-600 disabled:opacity-50"
    >
      {searchingSimilar ? "Searching..." : "Find Similar"}
    </button>
  </div>
  {similarTickets.length > 0 ? (
    <div className="space-y-2">
      {similarTickets.map((t) => (
        <div key={t.jiraKey} className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800/50 p-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-blue-400">{t.jiraKey}</span>
            {t.severity && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">{t.severity}</span>}
            <span className="text-sm text-slate-300 truncate max-w-xs">{t.title}</span>
          </div>
          <span className="text-xs text-slate-400">{Math.round(t.similarity * 100)}%</span>
        </div>
      ))}
    </div>
  ) : searchingSimilar ? null : (
    <p className="text-xs text-slate-500">Click "Find Similar" to search for duplicate tickets.</p>
  )}
</div>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/jira/TicketBriefPanel.tsx
git commit -m "feat(web): add similar tickets, post-to-JIRA, and feedback to TicketBriefPanel"
```

---

## Task 6: Update JiraAnalyzerView to Pass Props

**Files:**
- Modify: `hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx`

- [ ] **Step 1: Update TicketBriefPanel usage**

Read the current file. Find where `<TicketBriefPanel>` is rendered. Update it to pass the new props:

```tsx
<TicketBriefPanel
  jiraKey={ticket.key}
  result={briefResult}
  jiraCredentials={{ baseUrl, email, apiToken }}
  briefRow={cachedBrief}
  onBriefUpdated={async () => {
    const updated = await api.getTicketBrief(ticket.key);
    setCachedBrief(updated);
  }}
/>
```

Make sure `cachedBrief` state (from Task 8 of Phase 2a) is available. It should be — the `TicketBriefRow | null` state was added in Phase 2a. If the variable is named differently, read the file and match.

Also import `TicketBriefRow` if not already imported.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx
git commit -m "feat(web): pass credentials and briefRow to TicketBriefPanel for round-trip features"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Full Rust check**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`

- [ ] **Step 2: Run all Rust tests**

Run: `cd hadron-web && cargo test 2>&1 | tail -20`

- [ ] **Step 3: Frontend type check**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 4: Verify route count**

Run: `grep -c "jira_analysis::" hadron-web/crates/hadron-server/src/routes/mod.rs`
Expected: should be higher than before (was ~10 from Phase 2a, now +3 = ~13)
