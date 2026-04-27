# CodexMgX Integration — Phase 3: Web Server Integration

> **Prerequisite:** Phase 1 complete — `hadron-investigation` crate compiles.

**Goal:** Expose investigation endpoints on the Axum web server and create the TypeScript service module for the web frontend.

**Files:**
- Create: `hadron-web/crates/hadron-server/src/routes/investigation.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`
- Modify: `hadron-web/crates/hadron-server/Cargo.toml`
- Create: `hadron-web/frontend/src/services/investigation.ts`

---

### Task 16: Web Routes

**Files:**
- Modify: `hadron-web/crates/hadron-server/Cargo.toml`
- Create: `hadron-web/crates/hadron-server/src/routes/investigation.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Add hadron-investigation as dependency**

In `hadron-web/crates/hadron-server/Cargo.toml`, add to `[dependencies]`:
```toml
hadron-investigation = { path = "../hadron-investigation" }
```

- [ ] **Step 2: Create routes/investigation.rs**

```rust
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::HadronResult;
use hadron_investigation::{
    atlassian::{
        confluence::{get_confluence_content, search_confluence},
        AtlassianClient, InvestigationConfig,
    },
    investigate_customer_history, investigate_expected_behavior,
    investigate_regression_family, investigate_ticket,
};

// ─────────────────────────────────────────────────────────────────
// Request bodies
// ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct TicketRequest {
    pub ticket_key: String,
}

#[derive(Deserialize)]
pub struct ExpectedBehaviorRequest {
    pub ticket_key: Option<String>,
    pub query: String,
}

#[derive(Deserialize)]
pub struct ConfluenceSearchRequest {
    pub query: String,
    pub space_key: Option<String>,
    pub limit: Option<u32>,
}

// ─────────────────────────────────────────────────────────────────
// Config helper
// ─────────────────────────────────────────────────────────────────

async fn load_config(state: &AppState) -> Result<InvestigationConfig, (StatusCode, String)> {
    let row = db::get_poller_config(&state.db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load JIRA config: {}", e),
        )
    })?;

    if row.jira_base_url.is_empty() || row.jira_email.is_empty() || row.jira_api_token.is_empty() {
        return Err((StatusCode::UNPROCESSABLE_ENTITY, "JIRA not configured".into()));
    }

    // Load optional confluence / investigation settings from global_settings
    let confluence_url = db::get_global_setting(&state.db, "confluence_override_url")
        .await
        .ok()
        .flatten();
    let confluence_email = db::get_global_setting(&state.db, "confluence_override_email")
        .await
        .ok()
        .flatten();
    let confluence_token = db::get_global_setting(&state.db, "confluence_override_token")
        .await
        .ok()
        .flatten();
    let whatson_kb_url = db::get_global_setting(&state.db, "whatson_kb_url")
        .await
        .ok()
        .flatten();
    let mod_docs_homepage_id = db::get_global_setting(&state.db, "mod_docs_homepage_id")
        .await
        .ok()
        .flatten();
    let mod_docs_space_path = db::get_global_setting(&state.db, "mod_docs_space_path")
        .await
        .ok()
        .flatten();

    Ok(InvestigationConfig {
        jira_base_url: row.jira_base_url,
        jira_email: row.jira_email,
        jira_api_token: row.jira_api_token,
        confluence_base_url: confluence_url.filter(|s: &String| !s.is_empty()),
        confluence_email: confluence_email.filter(|s: &String| !s.is_empty()),
        confluence_api_token: confluence_token.filter(|s: &String| !s.is_empty()),
        whatson_kb_url: whatson_kb_url.filter(|s: &String| !s.is_empty()),
        mod_docs_homepage_id: mod_docs_homepage_id.filter(|s: &String| !s.is_empty()),
        mod_docs_space_path: mod_docs_space_path.filter(|s: &String| !s.is_empty()),
    })
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

pub async fn post_investigate_ticket(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<TicketRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    match investigate_ticket(config, &body.ticket_key).await {
        Ok(dossier) => Json(dossier).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn post_investigate_regression(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<TicketRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    match investigate_regression_family(config, &body.ticket_key).await {
        Ok(dossier) => Json(dossier).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn post_investigate_expected(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<ExpectedBehaviorRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let key = body.ticket_key.as_deref().unwrap_or("");
    match investigate_expected_behavior(config, key, &body.query).await {
        Ok(dossier) => Json(dossier).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn post_investigate_customer(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<TicketRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    match investigate_customer_history(config, &body.ticket_key).await {
        Ok(dossier) => Json(dossier).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn post_confluence_search(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<ConfluenceSearchRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let client = AtlassianClient::new(config);
    let cql = if let Some(space) = body.space_key.filter(|s| !s.is_empty()) {
        format!("space = {} AND text ~ \"{}\"", space, body.query.replace('"', "'"))
    } else {
        format!("text ~ \"{}\"", body.query.replace('"', "'"))
    };
    match search_confluence(&client, &cql, body.limit.unwrap_or(10)).await {
        Ok(docs) => Json(docs).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn get_confluence_page_handler(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let client = AtlassianClient::new(config);
    match get_confluence_content(&client, &id).await {
        Ok(doc) => Json(doc).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}
```

Note: `db::get_global_setting` — verify this function exists in `hadron-web/crates/hadron-server/src/db/mod.rs`. It's used for Confluence config already (lines ~504-507 in `admin.rs`). If the signature differs, adapt accordingly.

- [ ] **Step 3: Register routes in routes/mod.rs**

Add `pub mod investigation;` at the top with other module declarations.

Then in `api_router()`, after the admin confluence routes (around line 211):
```rust
        .route("/investigation/ticket", post(investigation::post_investigate_ticket))
        .route("/investigation/regression-family", post(investigation::post_investigate_regression))
        .route("/investigation/expected-behavior", post(investigation::post_investigate_expected))
        .route("/investigation/customer-history", post(investigation::post_investigate_customer))
        .route("/confluence/search", post(investigation::post_confluence_search))
        .route("/confluence/content/:id", get(investigation::get_confluence_page_handler))
```

- [ ] **Step 4: Verify web server compiles**

```bash
cd hadron-web && SQLX_OFFLINE=true cargo check -p hadron-server
```
Expected: clean compile. Common issues:
- `AuthenticatedUser` extractor — check the correct import path in existing route handlers
- `db::get_global_setting` signature — match to how `admin.rs` calls it

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-server/Cargo.toml hadron-web/crates/hadron-server/src/routes/investigation.rs hadron-web/crates/hadron-server/src/routes/mod.rs
git commit -m "feat(web): add investigation API routes"
```

---

### Task 17: Web Frontend Investigation Service

**Files:**
- Create: `hadron-web/frontend/src/services/investigation.ts`

- [ ] **Step 1: Create investigation.ts**

```typescript
import { api } from "./api";

export interface EvidenceClaim {
  text: string;
  category:
    | "observed_behavior"
    | "linked_context"
    | "historical_match"
    | "expected_behavior"
    | "attachment_signal"
    | "issue_comment"
    | "customer_history";
  entities: string[];
}

export interface RelatedIssue {
  key: string;
  summary: string;
  status: string;
  relation_type: "direct_link" | "project_history" | "cross_project_sibling";
  url: string;
}

export interface ConfluenceDoc {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  space_key: string | null;
}

export interface Hypothesis {
  text: string;
  confidence: "high" | "medium" | "low";
  supporting_claims: string[];
}

export interface AttachmentResult {
  filename: string;
  extracted_text: string | null;
  extraction_status:
    | "success"
    | "skipped"
    | { failed: string };
}

export interface InvestigationDossier {
  ticket_key: string;
  ticket_summary: string;
  ticket_url: string;
  status: string;
  assignee: string | null;
  claims: EvidenceClaim[];
  related_issues: RelatedIssue[];
  confluence_docs: ConfluenceDoc[];
  hypotheses: Hypothesis[];
  open_questions: string[];
  next_checks: string[];
  attachments: AttachmentResult[];
  warnings: string[];
  investigation_type:
    | "ticket"
    | "regression_family"
    | "expected_behavior"
    | "customer_history";
  investigation_status: "complete" | "partial_failure";
}

export const investigationService = {
  async investigateTicket(ticketKey: string): Promise<InvestigationDossier> {
    return api.post("/api/investigation/ticket", { ticket_key: ticketKey });
  },

  async investigateRegressionFamily(ticketKey: string): Promise<InvestigationDossier> {
    return api.post("/api/investigation/regression-family", { ticket_key: ticketKey });
  },

  async investigateExpectedBehavior(
    query: string,
    ticketKey?: string
  ): Promise<InvestigationDossier> {
    return api.post("/api/investigation/expected-behavior", {
      ticket_key: ticketKey ?? "",
      query,
    });
  },

  async investigateCustomerHistory(ticketKey: string): Promise<InvestigationDossier> {
    return api.post("/api/investigation/customer-history", { ticket_key: ticketKey });
  },

  async searchConfluence(
    query: string,
    options?: { spaceKey?: string; limit?: number }
  ): Promise<ConfluenceDoc[]> {
    return api.post("/api/confluence/search", {
      query,
      space_key: options?.spaceKey,
      limit: options?.limit,
    });
  },

  async getConfluencePage(contentId: string): Promise<ConfluenceDoc> {
    return api.get(`/api/confluence/content/${contentId}`);
  },
};
```

Note: The `api.post` and `api.get` calls assume the existing `ApiClient` in `services/api.ts` exposes those methods. Check the actual method names — it may be `api.fetch(...)` or similar. Adapt to match the existing pattern used by other services in `hadron-web/frontend/src/services/`.

- [ ] **Step 2: Verify TypeScript**

```bash
cd hadron-web/frontend && npm run type-check
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/services/investigation.ts
git commit -m "feat(web): add investigation frontend service module"
```
