# CodexMgX Integration — Phase 2: Desktop Integration

> **Prerequisite:** Phase 1 complete — `hadron-investigation` crate compiles cleanly.

**Goal:** Wire `hadron-investigation` into Hadron Desktop — Tauri commands, AskHadron chat tools, and contextual starters.

**Files modified:**
- Create: `hadron-desktop/src-tauri/src/commands/investigation.rs`
- Modify: `hadron-desktop/src-tauri/src/commands/mod.rs`
- Modify: `hadron-desktop/src-tauri/src/main.rs`
- Modify: `hadron-desktop/src-tauri/src/chat_tools.rs`
- Modify: `hadron-desktop/src/components/AskHadronView.tsx`

---

### Task 13: Desktop Tauri Commands

**Files:**
- Create: `hadron-desktop/src-tauri/src/commands/investigation.rs`
- Modify: `hadron-desktop/src-tauri/src/commands/mod.rs`
- Modify: `hadron-desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Create commands/investigation.rs**

```rust
//! Tauri commands wrapping hadron-investigation orchestrators.
use hadron_investigation::{
    atlassian::{
        confluence::{get_confluence_content, search_confluence},
        InvestigationConfig,
    },
    investigation::evidence::{ConfluenceDoc, InvestigationDossier},
    investigate_customer_history, investigate_expected_behavior,
    investigate_regression_family, investigate_ticket,
};

fn make_config(
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> InvestigationConfig {
    InvestigationConfig {
        jira_base_url: base_url,
        jira_email: email,
        jira_api_token: api_token,
        confluence_base_url: confluence_url.filter(|s| !s.is_empty()),
        confluence_email: confluence_email.filter(|s| !s.is_empty()),
        confluence_api_token: confluence_token.filter(|s| !s.is_empty()),
        whatson_kb_url: whatson_kb_url.filter(|s| !s.is_empty()),
        mod_docs_homepage_id: mod_docs_homepage_id.filter(|s| !s.is_empty()),
        mod_docs_space_path: mod_docs_space_path.filter(|s| !s.is_empty()),
    }
}

#[tauri::command]
pub async fn investigate_jira_ticket(
    key: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> Result<InvestigationDossier, String> {
    log::debug!("cmd: investigate_jira_ticket key={}", key);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        whatson_kb_url, mod_docs_homepage_id, mod_docs_space_path,
    );
    investigate_ticket(config, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_regression_family(
    key: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> Result<InvestigationDossier, String> {
    log::debug!("cmd: investigate_jira_regression_family key={}", key);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        whatson_kb_url, mod_docs_homepage_id, mod_docs_space_path,
    );
    investigate_regression_family(config, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_expected_behavior(
    key: String,
    query: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> Result<InvestigationDossier, String> {
    log::debug!("cmd: investigate_jira_expected_behavior key={}", key);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        whatson_kb_url, mod_docs_homepage_id, mod_docs_space_path,
    );
    investigate_expected_behavior(config, &key, &query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_customer_history(
    key: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> Result<InvestigationDossier, String> {
    log::debug!("cmd: investigate_jira_customer_history key={}", key);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        whatson_kb_url, mod_docs_homepage_id, mod_docs_space_path,
    );
    investigate_customer_history(config, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_confluence_docs(
    query: String,
    space_key: Option<String>,
    limit: Option<u32>,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
) -> Result<Vec<ConfluenceDoc>, String> {
    log::debug!("cmd: search_confluence_docs query={}", query);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        None, None, None,
    );
    let client = hadron_investigation::atlassian::mod_::AtlassianClient::new(config);
    let cql = if let Some(space) = space_key.filter(|s| !s.is_empty()) {
        format!("space = {} AND text ~ \"{}\"", space, query.replace('"', "'"))
    } else {
        format!("text ~ \"{}\"", query.replace('"', "'"))
    };
    search_confluence(&client, &cql, limit.unwrap_or(10))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_confluence_page(
    content_id: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
) -> Result<ConfluenceDoc, String> {
    log::debug!("cmd: get_confluence_page id={}", content_id);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        None, None, None,
    );
    let client = hadron_investigation::atlassian::mod_::AtlassianClient::new(config);
    get_confluence_content(&client, &content_id)
        .await
        .map_err(|e| e.to_string())
}
```

Note: `mod_::AtlassianClient` is pub(crate) by default — change it to `pub` in `mod_.rs` if needed, or expose a constructor in `lib.rs`.

- [ ] **Step 2: Register in commands/mod.rs**

Add at the end of `hadron-desktop/src-tauri/src/commands/mod.rs`:
```rust
pub mod investigation;
```

- [ ] **Step 3: Register commands in main.rs**

Find the `.invoke_handler(tauri::generate_handler![` block in `main.rs`. Add after `commands::jira_assist::get_poller_status,` (or at the end of the list before the closing `])`):

```rust
            commands::investigation::investigate_jira_ticket,
            commands::investigation::investigate_jira_regression_family,
            commands::investigation::investigate_jira_expected_behavior,
            commands::investigation::investigate_jira_customer_history,
            commands::investigation::search_confluence_docs,
            commands::investigation::get_confluence_page,
```

- [ ] **Step 4: Verify desktop compiles**

```bash
cd hadron-desktop/src-tauri && cargo check
```
Expected: clean compile. Fix any visibility issues (make `mod_` pub, or expose `AtlassianClient` through `lib.rs`).

- [ ] **Step 5: Commit**

```bash
git add hadron-desktop/src-tauri/src/commands/investigation.rs hadron-desktop/src-tauri/src/commands/mod.rs hadron-desktop/src-tauri/src/main.rs
git commit -m "feat(desktop): add Tauri commands for investigation"
```

---

### Task 14: AskHadron Chat Tools

**Files:**
- Modify: `hadron-desktop/src-tauri/src/chat_tools.rs`

The file currently has `execute_tool` at line 363 matching on tool names. We need to:
1. Add 6 new `ToolDefinition` entries in `get_tool_definitions()`
2. Add 6 new match arms in `execute_tool()`
3. Add 6 executor functions

- [ ] **Step 1: Add 6 ToolDefinitions at end of get_tool_definitions() vec**

In `get_tool_definitions()`, before the closing `]` of the vec, add:

```rust
        ToolDefinition {
            name: "investigate_jira_ticket".to_string(),
            description: "Run a full investigation on a JIRA ticket. Returns structured evidence: changelog, comments, worklogs, related issues, Confluence docs, attachment signals, hypotheses, and open questions. Use when a user asks to investigate or deep-dive into a ticket.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ticket_key": {
                        "type": "string",
                        "description": "The JIRA ticket key, e.g. BR-997 or SRF-1165"
                    }
                },
                "required": ["ticket_key"]
            }),
        },
        ToolDefinition {
            name: "investigate_regression_family".to_string(),
            description: "Find all related historical issues that may be siblings or predecessors of the given ticket — across the same project (90 days) and cross-project (6 months). Use when a user suspects a regression.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ticket_key": {
                        "type": "string",
                        "description": "The JIRA ticket key to find regression siblings for"
                    }
                },
                "required": ["ticket_key"]
            }),
        },
        ToolDefinition {
            name: "investigate_expected_behavior".to_string(),
            description: "Look up expected behavior and documentation for a feature or component. Searches Confluence, MOD documentation, and the WHATS'ON knowledge base.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ticket_key": {
                        "type": "string",
                        "description": "The JIRA ticket key providing context (may be empty)"
                    },
                    "query": {
                        "type": "string",
                        "description": "What to look up, e.g. 'EPG scheduling rules' or 'import pipeline'"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "investigate_customer_history".to_string(),
            description: "Retrieve all tickets reported by the same customer/reporter as the given ticket. Useful for pattern detection across a customer's issue history.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "ticket_key": {
                        "type": "string",
                        "description": "The JIRA ticket key whose reporter's history to fetch"
                    }
                },
                "required": ["ticket_key"]
            }),
        },
        ToolDefinition {
            name: "search_confluence".to_string(),
            description: "Search Confluence for documentation pages. Accepts free-text queries or CQL. Returns titles, excerpts, and URLs.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query or CQL expression"
                    },
                    "space_key": {
                        "type": "string",
                        "description": "Optional Confluence space key to restrict the search"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results to return (default 10)"
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "get_confluence_page".to_string(),
            description: "Fetch a specific Confluence page by its content ID. Returns title, body text, and URL.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "content_id": {
                        "type": "string",
                        "description": "The Confluence page content ID"
                    }
                },
                "required": ["content_id"]
            }),
        },
```

- [ ] **Step 2: Add match arms in execute_tool()**

In `execute_tool()`, before the `_ => Err(...)` arm, add:

```rust
        "investigate_jira_ticket" => execute_investigate_ticket(&tool_call.arguments, ctx).await,
        "investigate_regression_family" => execute_investigate_regression(&tool_call.arguments, ctx).await,
        "investigate_expected_behavior" => execute_investigate_expected(&tool_call.arguments, ctx).await,
        "investigate_customer_history" => execute_investigate_customer(&tool_call.arguments, ctx).await,
        "search_confluence" => execute_search_confluence(&tool_call.arguments, ctx).await,
        "get_confluence_page" => execute_get_confluence_page(&tool_call.arguments, ctx).await,
```

- [ ] **Step 3: Add executor functions**

Add these at the end of the file, before any final `}`:

```rust
// ============================================================================
// Investigation Tool Handlers
// ============================================================================

fn jira_config_to_investigation(ctx: &ToolContext) -> Option<hadron_investigation::atlassian::InvestigationConfig> {
    let jira = ctx.jira_config.as_ref()?;
    Some(hadron_investigation::atlassian::InvestigationConfig {
        jira_base_url: jira.base_url.clone(),
        jira_email: jira.email.clone(),
        jira_api_token: jira.api_token.clone(),
        confluence_base_url: None,
        confluence_email: None,
        confluence_api_token: None,
        whatson_kb_url: None,
        mod_docs_homepage_id: None,
        mod_docs_space_path: None,
    })
}

async fn execute_investigate_ticket(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let key = args["ticket_key"].as_str().ok_or("Missing ticket_key")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let dossier = hadron_investigation::investigate_ticket(config, &key)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&dossier).map_err(|e| e.to_string())
}

async fn execute_investigate_regression(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let key = args["ticket_key"].as_str().ok_or("Missing ticket_key")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let dossier = hadron_investigation::investigate_regression_family(config, &key)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&dossier).map_err(|e| e.to_string())
}

async fn execute_investigate_expected(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let key = args["ticket_key"].as_str().unwrap_or("").to_string();
    let query = args["query"].as_str().ok_or("Missing query")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let dossier = hadron_investigation::investigate_expected_behavior(config, &key, &query)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&dossier).map_err(|e| e.to_string())
}

async fn execute_investigate_customer(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let key = args["ticket_key"].as_str().ok_or("Missing ticket_key")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let dossier = hadron_investigation::investigate_customer_history(config, &key)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&dossier).map_err(|e| e.to_string())
}

async fn execute_search_confluence(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let query = args["query"].as_str().ok_or("Missing query")?.to_string();
    let space_key = args["space_key"].as_str().map(String::from);
    let limit = args["limit"].as_u64().unwrap_or(10) as u32;
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let client = hadron_investigation::atlassian::AtlassianClient::new(config);
    let cql = if let Some(space) = space_key.filter(|s| !s.is_empty()) {
        format!("space = {} AND text ~ \"{}\"", space, query.replace('"', "'"))
    } else {
        format!("text ~ \"{}\"", query.replace('"', "'"))
    };
    let docs = hadron_investigation::atlassian::confluence::search_confluence(&client, &cql, limit)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&docs).map_err(|e| e.to_string())
}

async fn execute_get_confluence_page(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<String, String> {
    let id = args["content_id"].as_str().ok_or("Missing content_id")?.to_string();
    let config = jira_config_to_investigation(ctx).ok_or("JIRA not configured")?;
    let client = hadron_investigation::atlassian::AtlassianClient::new(config);
    let doc = hadron_investigation::atlassian::confluence::get_confluence_content(&client, &id)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&doc).map_err(|e| e.to_string())
}
```

Note: The above requires that `hadron_investigation::atlassian::AtlassianClient` and the submodules are `pub`. Verify visibility in `src/atlassian/mod.rs` and `mod_.rs` — mark `AtlassianClient` as `pub` and the module as `pub`.

- [ ] **Step 4: Verify**

```bash
cd hadron-desktop/src-tauri && cargo check
```

- [ ] **Step 5: Commit**

```bash
git add hadron-desktop/src-tauri/src/chat_tools.rs
git commit -m "feat(desktop): add 6 investigation chat tools to AskHadron"
```

---

### Task 15: AskHadronView.tsx — Labels and Starters

**Files:**
- Modify: `hadron-desktop/src/components/AskHadronView.tsx`

- [ ] **Step 1: Add TOOL_LABELS entries**

Current `TOOL_LABELS` ends at line ~92 with `search_gold_answers`. Add after `search_gold_answers: "Checking verified answers",`:

```ts
  investigate_jira_ticket: "Investigating ticket",
  investigate_regression_family: "Analysing regression family",
  investigate_expected_behavior: "Looking up expected behaviour",
  investigate_customer_history: "Fetching customer history",
  search_confluence: "Searching Confluence",
  get_confluence_page: "Fetching Confluence page",
```

- [ ] **Step 2: Add CONTEXTUAL_STARTERS entry**

Current `CONTEXTUAL_STARTERS` at line ~65 has 4 entries. Add one more:

```ts
  "Investigate this JIRA ticket",
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd hadron-desktop && npm run type-check
```
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add hadron-desktop/src/components/AskHadronView.tsx
git commit -m "feat(desktop): add investigation tool labels and contextual starter"
```
