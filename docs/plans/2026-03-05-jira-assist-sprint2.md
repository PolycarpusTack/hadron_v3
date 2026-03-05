# JIRA Assist Sprint 2 — Triage Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add on-demand AI triage to the JIRA Ticket Analyzer — one click classifies severity, category, customer impact, and tags, persists the result in `ticket_briefs`, and shows a badge panel that reloads from DB on re-open.

**Architecture:** New Rust module `jira_triage.rs` owns the prompt, request/response structs, and AI dispatch (same pattern as `jira_deep_analysis.rs`). A new `triage_jira_ticket` command in `commands/jira_assist.rs` calls it and upserts the result into `ticket_briefs` via `db.upsert_ticket_brief()`. The frontend adds a "Triage" button to `JiraTicketAnalyzer.tsx`; on ticket fetch it also loads any existing brief from DB so the badge panel persists across sessions.

**Tech Stack:** Rust, serde_json, Tauri v2, React/TypeScript, existing `ai_service.rs` call functions, existing `ticket_briefs.rs` CRUD + `Database::upsert_ticket_brief`.

---

## Key File Map

| File | Action |
|------|--------|
| `src-tauri/src/jira_triage.rs` | Create — AI module |
| `src-tauri/src/main.rs` | Modify — add `mod jira_triage;` |
| `src-tauri/src/commands/jira_assist.rs` | Modify — add `triage_jira_ticket` command |
| `src/services/jira-assist.ts` | Modify — add `JiraTriageResult` type + `triageJiraTicket()` |
| `src/components/jira/TriageBadgePanel.tsx` | Create — badge display component |
| `src/components/jira/JiraTicketAnalyzer.tsx` | Modify — Triage button + badge panel + load-on-fetch |

---

## Task 1: Create `src-tauri/src/jira_triage.rs`

**Files:**
- Create: `src-tauri/src/jira_triage.rs`

### Step 1: Create the file

```rust
//! JIRA Assist — Triage Engine (Sprint 2).
//!
//! Classifies a JIRA ticket into severity/category/tags/customer_impact
//! and returns a structured `JiraTriageResult`. Supports all AI providers.

use serde::{Deserialize, Serialize};

// ─── Input ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct JiraTriageRequest {
    pub jira_key: String,
    pub title: String,
    pub description: String,
    pub issue_type: String,
    pub priority: Option<String>,
    pub status: Option<String>,
    pub components: Vec<String>,
    pub labels: Vec<String>,
    pub comments: Vec<String>,
    pub api_key: String,
    pub model: String,
    pub provider: String,
}

// ─── Output ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraTriageResult {
    /// Critical | High | Medium | Low
    pub severity: String,
    /// Bug | Feature | Infrastructure | UX | Performance | Security
    pub category: String,
    /// Plain-language description of who is impacted and how severely
    pub customer_impact: String,
    /// Short classification tags (max 5), e.g. ["login", "auth", "regression"]
    pub tags: Vec<String>,
    /// High | Medium | Low — model's confidence in this triage
    pub confidence: String,
    /// 1–3 sentence rationale for the severity/category choices
    pub rationale: String,
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT: &str = r#"You are a senior support engineer triaging JIRA tickets for a software product.
Your job is to classify each ticket quickly and accurately so the team can prioritize work.

OUTPUT FORMAT: Respond ONLY with valid JSON. No markdown, no prose outside JSON.

{
  "severity": "Critical|High|Medium|Low",
  "category": "Bug|Feature|Infrastructure|UX|Performance|Security",
  "customer_impact": "Plain-language description of who is affected and how severely (1-2 sentences max).",
  "tags": ["tag1", "tag2"],
  "confidence": "High|Medium|Low",
  "rationale": "1-3 sentences explaining why you chose this severity and category."
}

SEVERITY GUIDE:
- Critical: Production down, data loss, security breach, blocking all users
- High: Major feature broken, significant user population affected, no workaround
- Medium: Feature degraded, workaround exists, affects a subset of users
- Low: Cosmetic, edge case, minor inconvenience, enhancement request

CATEGORY GUIDE:
- Bug: Unintended behavior, crash, regression
- Feature: New functionality or enhancement request
- Infrastructure: Deployment, config, CI/CD, environment
- UX: Usability, accessibility, layout, wording
- Performance: Slow response, high resource usage, timeout
- Security: Auth, permissions, data exposure, injection

TAGS: 2-5 short lowercase single-word or hyphenated labels describing the affected area (e.g. "login", "api", "export", "dark-mode"). Do not repeat severity or category as tags.

Be direct. If the ticket is vague, lower your confidence and explain why.
"#;

// ─── Core function ────────────────────────────────────────────────────────────

pub async fn run_jira_triage(req: JiraTriageRequest) -> Result<JiraTriageResult, String> {
    use crate::ai_service::{call_anthropic, call_llamacpp, call_openai, call_zai};

    let user_prompt = build_prompt(&req);

    let raw = match req.provider.to_lowercase().as_str() {
        "openai"    => call_openai(TRIAGE_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "anthropic" => call_anthropic(TRIAGE_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "zai"       => call_zai(TRIAGE_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "llamacpp"  => call_llamacpp(TRIAGE_SYSTEM_PROMPT, &user_prompt, &req.model).await?,
        p           => return Err(format!("Unknown AI provider: {}", p)),
    };

    parse_triage_result(&raw)
}

fn build_prompt(req: &JiraTriageRequest) -> String {
    let mut parts = vec![
        format!("TICKET: {}", req.jira_key),
        format!("TYPE: {}", req.issue_type),
        format!("PRIORITY (reporter-set): {}", req.priority.as_deref().unwrap_or("not set")),
        format!("STATUS: {}", req.status.as_deref().unwrap_or("unknown")),
        format!("TITLE: {}", req.title),
    ];

    if !req.components.is_empty() {
        parts.push(format!("COMPONENTS: {}", req.components.join(", ")));
    }
    if !req.labels.is_empty() {
        parts.push(format!("LABELS: {}", req.labels.join(", ")));
    }

    if req.description.is_empty() {
        parts.push("\nDESCRIPTION: (empty)".to_string());
    } else {
        // Limit description to 2000 chars to keep token budget small for triage
        let desc = if req.description.len() > 2000 {
            format!("{}… (truncated)", &req.description[..2000])
        } else {
            req.description.clone()
        };
        parts.push(format!("\nDESCRIPTION:\n{}", desc));
    }

    if !req.comments.is_empty() {
        // Include up to 5 most recent comments, each capped at 500 chars
        let recent: Vec<String> = req.comments.iter().rev().take(5).enumerate()
            .map(|(i, c)| {
                let body = if c.len() > 500 { format!("{}…", &c[..500]) } else { c.clone() };
                format!("[Comment {}] {}", i + 1, body)
            })
            .collect();
        parts.push(format!("\nRECENT COMMENTS:\n{}", recent.join("\n")));
    }

    parts.join("\n")
}

fn parse_triage_result(raw: &str) -> Result<JiraTriageResult, String> {
    let json_str = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str(json_str).map_err(|e| {
        format!(
            "Failed to parse triage JSON: {}. Raw (first 400 chars): {}",
            e,
            &raw[..raw.len().min(400)]
        )
    })
}
```

### Step 2: Verify it compiles

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error" | head -20
```

Expected: errors about `jira_triage` not declared as a module — that's fine, resolved in Task 2.

### Step 3: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add hadron-desktop/src-tauri/src/jira_triage.rs
git commit -m "feat(jira-assist): add jira_triage module — prompt, structs, AI dispatch"
```

---

## Task 2: Declare module + add `triage_jira_ticket` command

**Files:**
- Modify: `src-tauri/src/main.rs` (add `mod jira_triage;` + register command)
- Modify: `src-tauri/src/commands/jira_assist.rs` (add the command function)

### Step 1: Add `mod jira_triage;` to `main.rs`

In `main.rs`, find the block of `mod` declarations (around line 14, near `mod jira_deep_analysis;`). Add directly below it:

```rust
mod jira_triage;
```

### Step 2: Add the command to `commands/jira_assist.rs`

Open `src-tauri/src/commands/jira_assist.rs`. Add these imports at the top (after the existing `use` lines):

```rust
use crate::jira_triage::{JiraTriageRequest, JiraTriageResult};
use crate::ticket_briefs::TicketBrief;
```

Note: `TicketBrief` is already imported — only add `JiraTriageRequest` and `JiraTriageResult`.

Then append the new command at the end of the file:

```rust
/// Triage a JIRA ticket with AI — classify severity, category, customer impact, and tags.
/// Upserts the result into ticket_briefs so it persists across sessions.
#[tauri::command]
pub async fn triage_jira_ticket(
    request: JiraTriageRequest,
    db: DbState<'_>,
) -> Result<JiraTriageResult, String> {
    log::debug!("cmd: triage_jira_ticket key={}", request.jira_key);

    // Capture fields needed after request is moved into run_jira_triage
    let jira_key = request.jira_key.clone();
    let title = request.title.clone();

    let result = crate::jira_triage::run_jira_triage(request).await?;

    // Persist to ticket_briefs (upsert — creates row if absent, updates if present)
    let db = Arc::clone(&db);
    let result_clone = result.clone();
    let tags_json = serde_json::to_string(&result_clone.tags)
        .unwrap_or_else(|_| "[]".to_string());
    let triage_json = serde_json::to_string(&result_clone)
        .map_err(|e| format!("Serialization error: {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let brief = TicketBrief {
            jira_key: jira_key.clone(),
            title,
            customer: None,
            severity: Some(result_clone.severity.clone()),
            category: Some(result_clone.category.clone()),
            tags: Some(tags_json),
            triage_json: Some(triage_json),
            brief_json: None,
            posted_to_jira: false,
            posted_at: None,
            engineer_rating: None,
            engineer_notes: None,
            // created_at / updated_at are set by DB trigger — use placeholder
            created_at: String::new(),
            updated_at: String::new(),
        };
        db.upsert_ticket_brief(&brief)
            .map_err(|e| format!("Database error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    Ok(result)
}
```

### Step 3: Register the command in `main.rs`

In `main.rs`, find the `// JIRA Assist` comment in the `invoke_handler!` block (around line 320+, after `commands::jira_assist::delete_ticket_brief`). Add:

```rust
commands::jira_assist::triage_jira_ticket,
```

### Step 4: Compile check

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error" | head -20
```

Expected: 0 errors. Fix any before continuing.

### Step 5: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add \
  hadron-desktop/src-tauri/src/main.rs \
  hadron-desktop/src-tauri/src/commands/jira_assist.rs
git commit -m "feat(jira-assist): add triage_jira_ticket Tauri command"
```

---

## Task 3: TypeScript — add `triageJiraTicket()` to `jira-assist.ts`

**Files:**
- Modify: `src/services/jira-assist.ts`

### Step 1: Add the `JiraTriageResult` interface

Open `src/services/jira-assist.ts`. After the `TicketBrief` interface, add:

```typescript
export interface JiraTriageResult {
  severity: string;        // "Critical" | "High" | "Medium" | "Low"
  category: string;        // "Bug" | "Feature" | "Infrastructure" | "UX" | "Performance" | "Security"
  customer_impact: string;
  tags: string[];
  confidence: string;      // "High" | "Medium" | "Low"
  rationale: string;
}
```

### Step 2: Add the `triageJiraTicket()` function

After `deleteTicketBrief`, add:

```typescript
/** Run AI triage on a JIRA ticket and persist the result. */
export async function triageJiraTicket(params: {
  jiraKey: string;
  title: string;
  description: string;
  issueType: string;
  priority?: string;
  status?: string;
  components: string[];
  labels: string[];
  comments: string[];
  apiKey: string;
  model: string;
  provider: string;
}): Promise<JiraTriageResult> {
  return invoke<JiraTriageResult>("triage_jira_ticket", {
    request: {
      jira_key: params.jiraKey,
      title: params.title,
      description: params.description,
      issue_type: params.issueType,
      priority: params.priority,
      status: params.status,
      components: params.components,
      labels: params.labels,
      comments: params.comments,
      api_key: params.apiKey,
      model: params.model,
      provider: params.provider,
    },
  });
}
```

### Step 3: Add severity/category color maps

At the bottom of the file, add:

```typescript
/** Category → Tailwind color class for badges (dark-mode friendly). */
export const CATEGORY_COLORS: Record<string, string> = {
  Bug:            "bg-red-500/15 text-red-300 border-red-500/30",
  Feature:        "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Infrastructure: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  UX:             "bg-pink-500/15 text-pink-300 border-pink-500/30",
  Performance:    "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Security:       "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

/** Severity → Tailwind color class (dark-mode, replaces SEVERITY_COLORS). */
export const SEVERITY_BADGE: Record<string, string> = {
  Critical: "bg-red-500/20 text-red-300 border-red-500/40",
  High:     "bg-orange-500/20 text-orange-300 border-orange-500/40",
  Medium:   "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  Low:      "bg-green-500/20 text-green-300 border-green-500/40",
};

/** Confidence → Tailwind text color. */
export const CONFIDENCE_COLOR: Record<string, string> = {
  High:   "text-green-400",
  Medium: "text-yellow-400",
  Low:    "text-red-400",
};
```

### Step 4: TypeScript check

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npx tsc --noEmit 2>&1 | grep "jira-assist" | head -10
```

Expected: no errors.

### Step 5: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add hadron-desktop/src/services/jira-assist.ts
git commit -m "feat(jira-assist): add JiraTriageResult type and triageJiraTicket() API function"
```

---

## Task 4: Create `TriageBadgePanel.tsx` component

**Files:**
- Create: `src/components/jira/TriageBadgePanel.tsx`

### Step 1: Create the file

```tsx
/**
 * TriageBadgePanel
 * Displays the AI triage result as a compact badge row below the ticket card.
 * Used in JiraTicketAnalyzer after triage runs, or when loaded from DB on fetch.
 */

import { ShieldAlert, Tag, Users, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { JiraTriageResult } from "../../services/jira-assist";
import { SEVERITY_BADGE, CATEGORY_COLORS, CONFIDENCE_COLOR } from "../../services/jira-assist";

interface TriageBadgePanelProps {
  result: JiraTriageResult;
  /** When true shows a subtle "loaded from DB" label */
  fromCache?: boolean;
}

export default function TriageBadgePanel({ result, fromCache }: TriageBadgePanelProps) {
  const [expanded, setExpanded] = useState(false);

  const severityClass = SEVERITY_BADGE[result.severity] ?? "bg-gray-500/15 text-gray-300 border-gray-500/30";
  const categoryClass = CATEGORY_COLORS[result.category] ?? "bg-gray-500/15 text-gray-300 border-gray-500/30";
  const confidenceClass = CONFIDENCE_COLOR[result.confidence] ?? "text-gray-400";

  return (
    <div className="bg-gray-800/60 rounded-lg border border-gray-700 overflow-hidden">
      {/* Compact badge row */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Header label */}
        <div className="flex items-center gap-1.5 mr-1">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
            Triage
          </span>
          {fromCache && (
            <span className="text-xs text-gray-600 italic">· saved</span>
          )}
        </div>

        {/* Severity badge */}
        <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${severityClass}`}>
          {result.severity}
        </span>

        {/* Category badge */}
        <span className={`text-xs px-2 py-0.5 rounded border ${categoryClass}`}>
          {result.category}
        </span>

        {/* Tags */}
        {result.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <Tag className="w-3 h-3 text-gray-500" />
            {result.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-1.5 py-0.5 bg-gray-700 rounded text-gray-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-gray-500 hover:text-gray-300 transition"
          title={expanded ? "Collapse triage details" : "Expand triage details"}
        >
          {expanded
            ? <ChevronUp className="w-4 h-4" />
            : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expandable detail panel */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-700 space-y-3">
          {/* Customer impact */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Customer Impact
              </span>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">
              {result.customer_impact}
            </p>
          </div>

          {/* Rationale + confidence */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Brain className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Rationale
              </span>
              <span className={`text-xs ml-auto ${confidenceClass}`}>
                {result.confidence} confidence
              </span>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed italic">
              {result.rationale}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 2: TypeScript check

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npx tsc --noEmit 2>&1 | grep "TriageBadgePanel" | head -10
```

Expected: no errors.

### Step 3: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add hadron-desktop/src/components/jira/TriageBadgePanel.tsx
git commit -m "feat(jira-assist): add TriageBadgePanel component"
```

---

## Task 5: Wire Triage button into `JiraTicketAnalyzer.tsx`

**Files:**
- Modify: `src/components/jira/JiraTicketAnalyzer.tsx`

### Step 1: Add imports

At the top of the file, add to the existing imports:

```typescript
import { triageJiraTicket, getTicketBrief, type JiraTriageResult } from "../../services/jira-assist";
import TriageBadgePanel from "./TriageBadgePanel";
import { ShieldAlert } from "lucide-react";
```

Add `ShieldAlert` to the existing `lucide-react` import line (alongside `Zap`, `Microscope`, etc.).

### Step 2: Add state variables

In the component body, after the existing state declarations (after `deepResult` state), add:

```typescript
const [triaging, setTriaging] = useState(false);
const [triageResult, setTriageResult] = useState<JiraTriageResult | null>(null);
const [triageFromCache, setTriageFromCache] = useState(false);
```

### Step 3: Load existing triage from DB on ticket fetch

In `handleFetch`, after `setIssue(result.issue)` (around line 71), add:

```typescript
// Load any previously stored triage for this ticket
setTriageResult(null);
setTriageFromCache(false);
try {
  const brief = await getTicketBrief(result.issue.key);
  if (brief?.triage_json) {
    const parsed: JiraTriageResult = JSON.parse(brief.triage_json);
    setTriageResult(parsed);
    setTriageFromCache(true);
  }
} catch {
  // No stored triage — that's fine
}
```

### Step 4: Also clear triage in `handleReset`

In `handleReset`, add:

```typescript
setTriageResult(null);
setTriageFromCache(false);
```

### Step 5: Add `handleTriage` function

After `handleDeepAnalyze`, add:

```typescript
async function handleTriage() {
  if (!issue) return;

  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    setError("No API key configured. Set one in Settings.");
    return;
  }

  setTriaging(true);
  setError(null);

  try {
    const commentTexts = issue.comments.map((c) => c.body);
    const result = await triageJiraTicket({
      jiraKey: issue.key,
      title: issue.summary,
      description: issue.descriptionPlaintext || "",
      issueType: issue.issueType || "Unknown",
      priority: issue.priority || undefined,
      status: issue.status || undefined,
      components: issue.components,
      labels: issue.labels,
      comments: commentTexts,
      apiKey,
      model: getStoredModel(),
      provider: getStoredProvider(),
    });
    setTriageResult(result);
    setTriageFromCache(false);
  } catch (err) {
    setError(`Triage failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setTriaging(false);
  }
}
```

### Step 6: Add progress indicator for triage

After the `{deepAnalyzing && ...}` progress block (around line 235–247), add:

```tsx
{triaging && (
  <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
    <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
    <div>
      <p className="text-sm text-amber-300 font-medium">Triaging {issue?.key}...</p>
      <p className="text-xs text-gray-400">Classifying severity, category, and impact</p>
    </div>
  </div>
)}
```

### Step 7: Add "Triage" button to the action bar

The action bar currently has two buttons: "Analyze with AI" and "Deep Analyze". Find the `<div className="flex items-center gap-2">` wrapping those buttons (around line 379) and add the Triage button **before** the other two:

```tsx
<Button
  onClick={handleTriage}
  loading={triaging}
  size="lg"
  icon={<ShieldAlert />}
  className="bg-amber-700 hover:bg-amber-600 font-semibold px-5"
  disabled={analyzing || deepAnalyzing}
>
  {triaging ? "Triaging..." : "Triage"}
</Button>
```

### Step 8: Render the TriageBadgePanel below the ticket card

After the closing `</div>` of the Issue Preview Card (around line 402, the `)}` that closes `{issue && !analyzing && (`), add:

```tsx
{/* Triage Badge Panel — shown when triage result available (from DB or just computed) */}
{triageResult && !triaging && issue && (
  <TriageBadgePanel result={triageResult} fromCache={triageFromCache} />
)}
```

### Step 9: TypeScript check

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

Expected: no new errors (only the pre-existing ones in `PerformanceAnalyzerView.tsx` and `code-analysis.ts`).

### Step 10: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add hadron-desktop/src/components/jira/JiraTicketAnalyzer.tsx
git commit -m "feat(jira-assist): wire Triage button and TriageBadgePanel into JiraTicketAnalyzer"
```

---

## Task 6: Full build verification

### Step 1: Rust build

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error" | head -20
```

Expected: 0 errors.

### Step 2: TypeScript build

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npm run build 2>&1 | tail -20
```

Expected: build succeeds. Pre-existing TS errors in `PerformanceAnalyzerView.tsx` / `code-analysis.ts` are not introduced by this sprint.

### Step 3: Final commit if any cleanup needed

```bash
cd /mnt/c/Projects/Hadron_v3 && git add -A && git commit -m "chore(jira-assist): sprint 2 complete — triage engine ready"
```

Only create this commit if there are actual uncommitted changes.

---

## Sprint 2 Acceptance Criteria

- [ ] `cargo build` — 0 errors
- [ ] `npm run build` — succeeds
- [ ] "Triage" button appears in the action bar alongside "Analyze with AI" and "Deep Analyze"
- [ ] Clicking "Triage" shows amber progress indicator, then `TriageBadgePanel` below the ticket card
- [ ] Badge panel shows: severity chip, category chip, tags row, expand toggle
- [ ] Expanded panel shows: customer impact paragraph, rationale + confidence
- [ ] Re-fetching the same ticket (after triage) loads the saved triage from DB (badge shows "· saved")
- [ ] Re-fetching a different ticket clears the previous triage result
- [ ] All three action buttons disable their siblings while running (no concurrent AI calls)
- [ ] Triage result persists in SQLite `ticket_briefs.triage_json` — verify via History or a second fetch
