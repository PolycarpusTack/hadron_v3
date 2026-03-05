# JIRA Deep Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Deep Analyze" button to the JIRA Ticket Analyzer that runs a dedicated JIRA analysis pipeline — using a JIRA-specific prompt, structured JSON output schema, and linked-ticket context — and displays an inline structured report with human-validation checkboxes.

**Architecture:** A new Rust module (`jira_deep_analysis.rs`) owns the prompt, request/response structs, and AI call logic. A new Tauri command `analyze_jira_ticket_deep` accepts the ticket fields, calls the active AI provider, parses the structured JSON response, and stores the result in the existing `analyses` table with `analysis_type = "jira_deep"`. The frontend adds a second CTA button beside the existing "Analyze with AI" button, calls the new command via a new `analyzeJiraTicketDeep()` API function, and renders the result in a new `JiraAnalysisReport` component inline — no navigation to the Crash Analyzer view.

**Tech Stack:** Rust (Tauri commands, `reqwest` + `serde_json`), TypeScript/React (Tauri `invoke`), existing AI provider functions (`call_openai`, `call_anthropic`, `call_zai`, `call_llamacpp`), existing SQLite DB (`analyses` table + `full_data` JSON column).

---

## Context

### Key files

| Path | Role |
|------|------|
| `src-tauri/src/ai_service.rs` | AI provider dispatch (`call_openai`, `call_anthropic`, `call_zai`, `call_llamacpp`) |
| `src-tauri/src/commands/jira.rs` | Existing JIRA commands — add new command here |
| `src-tauri/src/main.rs` | Module declarations + `invoke_handler` registration |
| `src-tauri/src/database.rs` | `save_analysis()` — how to persist to DB |
| `src/services/api.ts` | Frontend API layer — add `analyzeJiraTicketDeep()` here |
| `src/components/jira/JiraTicketAnalyzer.tsx` | Add "Deep Analyze" button and inline report render here |

### AI provider dispatch pattern (from `ai_service.rs`)
```rust
let result = match provider.to_lowercase().as_str() {
    "openai"    => call_openai(system_prompt, &user_prompt, api_key, model).await?,
    "anthropic" => call_anthropic(system_prompt, &user_prompt, api_key, model).await?,
    "zai"       => call_zai(system_prompt, &user_prompt, api_key, model).await?,
    "llamacpp"  => call_llamacpp(system_prompt, &user_prompt, model).await?,
    _           => return Err("Unknown provider".to_string()),
};
```
The new function in `jira_deep_analysis.rs` will use the same pattern.

### How the existing JIRA ticket analysis is called
`analyzeJiraTicket()` in `api.ts` → `invoke("analyze_jira_ticket", { request: {...} })` → Rust assembles a plain-text document → sends to AI with `WHATSON_SYSTEM_PROMPT` (crash dump expert, **not** JIRA-specific).

The new deep analysis uses a dedicated JIRA prompt and returns structured JSON parsed into typed Rust structs.

### DB persistence
The result is stored via `db.save_analysis(...)` with `analysis_type = "jira_deep"` and the full structured result serialized into `full_data` as a JSON string. The `summary`, `error_type`, `root_cause`, `suggested_fixes`, `severity` fields are populated from the structured result for compatibility with the existing history/search UI.

---

## Task 1: Create the Rust module `jira_deep_analysis.rs`

**Files:**
- Create: `src-tauri/src/jira_deep_analysis.rs`

### Step 1: Create the file with structs and prompt

```rust
//! Standalone JIRA deep analysis — dedicated prompt + structured output.

use serde::{Deserialize, Serialize};

// ─── Input ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct JiraDeepRequest {
    pub jira_key: String,
    pub summary: String,
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
pub struct JiraDeepResult {
    /// Human-readable plain-language summary (2–4 sentences max)
    pub plain_summary: String,
    /// Ticket quality score 0–100 with rationale
    pub quality: TicketQuality,
    /// Technical analysis section
    pub technical: TechnicalAnalysis,
    /// Open questions the ticket leaves unanswered
    pub open_questions: Vec<String>,
    /// Concrete recommended actions for the team
    pub recommended_actions: Vec<RecommendedAction>,
    /// Risk & impact assessment
    pub risk: RiskAssessment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketQuality {
    pub score: u8,            // 0–100
    pub verdict: String,      // "Good" | "Needs Work" | "Poor"
    pub strengths: Vec<String>,
    pub gaps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechnicalAnalysis {
    pub root_cause: String,
    pub affected_areas: Vec<String>,
    pub error_type: String,       // e.g. "NullPointerException", "Race Condition", "Config Error"
    pub severity_estimate: String, // "Critical" | "High" | "Medium" | "Low"
    pub confidence: String,       // "High" | "Medium" | "Low" — confidence in the above
    pub confidence_rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendedAction {
    pub priority: String,  // "Immediate" | "Short-term" | "Long-term"
    pub action: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAssessment {
    pub user_impact: String,
    pub blast_radius: String,   // "Single user" | "Team" | "Org" | "All users"
    pub urgency: String,        // "Blocking" | "High" | "Medium" | "Low"
    pub do_nothing_risk: String,
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

pub const JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT: &str = r#"You are a senior software engineering lead and JIRA expert.
You receive a JIRA ticket (summary, description, comments, metadata) and produce a thorough structured analysis.

OUTPUT FORMAT: Respond ONLY with valid JSON matching this exact schema. No markdown, no prose outside JSON.

{
  "plain_summary": "2-4 sentence plain-language explanation of what this ticket is about and why it matters. Avoid jargon.",
  "quality": {
    "score": 0,
    "verdict": "Good|Needs Work|Poor",
    "strengths": ["..."],
    "gaps": ["..."]
  },
  "technical": {
    "root_cause": "Your best understanding of the root cause based on available evidence. Be specific.",
    "affected_areas": ["component or service names"],
    "error_type": "e.g. NullPointerException, Race Condition, Config Error, UX Bug, Performance Regression",
    "severity_estimate": "Critical|High|Medium|Low",
    "confidence": "High|Medium|Low",
    "confidence_rationale": "Why your confidence is high/medium/low given the ticket's information density."
  },
  "open_questions": [
    "Question the ticket leaves unanswered that would help resolve it faster"
  ],
  "recommended_actions": [
    {
      "priority": "Immediate|Short-term|Long-term",
      "action": "Concrete action for the team",
      "rationale": "Why this action matters"
    }
  ],
  "risk": {
    "user_impact": "Who is affected and how",
    "blast_radius": "Single user|Team|Org|All users",
    "urgency": "Blocking|High|Medium|Low",
    "do_nothing_risk": "What happens if this ticket is ignored or deprioritized"
  }
}

SCORING GUIDE for quality.score:
- 0–39 Poor: Missing description, no reproduction steps, no acceptance criteria, vague summary
- 40–69 Needs Work: Partial description, some context missing, no clear done-criteria
- 70–89 Good: Clear description, reproduction steps or clear spec, some acceptance criteria
- 90–100 Excellent: Complete description, full repro/spec, acceptance criteria, attachments/logs referenced

Be direct. Do not hedge unnecessarily. If the ticket is vague, say so clearly in plain_summary and gaps.
"#;

// ─── Core function ────────────────────────────────────────────────────────────

pub async fn run_jira_deep_analysis(req: JiraDeepRequest) -> Result<JiraDeepResult, String> {
    use crate::ai_service::{call_openai, call_anthropic, call_zai, call_llamacpp};

    let user_prompt = build_user_prompt(&req);

    let raw_response = match req.provider.to_lowercase().as_str() {
        "openai"    => call_openai(JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "anthropic" => call_anthropic(JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "zai"       => call_zai(JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT, &user_prompt, &req.api_key, &req.model).await?,
        "llamacpp"  => call_llamacpp(JIRA_DEEP_ANALYSIS_SYSTEM_PROMPT, &user_prompt, &req.model).await?,
        p           => return Err(format!("Unknown AI provider: {}", p)),
    };

    parse_deep_result(&raw_response)
}

fn build_user_prompt(req: &JiraDeepRequest) -> String {
    let mut parts = vec![
        format!("TICKET: {}", req.jira_key),
        format!("TYPE: {}", req.issue_type),
        format!("PRIORITY: {}", req.priority.as_deref().unwrap_or("not set")),
        format!("STATUS: {}", req.status.as_deref().unwrap_or("unknown")),
        format!("SUMMARY: {}", req.summary),
    ];

    if !req.components.is_empty() {
        parts.push(format!("COMPONENTS: {}", req.components.join(", ")));
    }
    if !req.labels.is_empty() {
        parts.push(format!("LABELS: {}", req.labels.join(", ")));
    }

    if !req.description.is_empty() {
        parts.push(format!("\nDESCRIPTION:\n{}", req.description));
    } else {
        parts.push("\nDESCRIPTION: (empty)".to_string());
    }

    if !req.comments.is_empty() {
        parts.push(format!("\nCOMMENTS ({}):", req.comments.len()));
        for (i, c) in req.comments.iter().enumerate() {
            parts.push(format!("[Comment {}] {}", i + 1, c));
        }
    }

    parts.join("\n")
}

fn parse_deep_result(raw: &str) -> Result<JiraDeepResult, String> {
    // Strip markdown code fences if the model wraps the JSON
    let json_str = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str(json_str).map_err(|e| format!("Failed to parse AI response as JSON: {}. Raw: {}", e, &raw[..raw.len().min(300)]))
}
```

### Step 2: Verify the file compiles (build check only)

```bash
cd hadron-desktop && cargo check 2>&1 | grep -E "error|warning.*jira_deep" | head -20
```
Expected: no errors related to `jira_deep_analysis`. Warnings about unused imports are OK at this stage.

### Step 3: Commit

```bash
git add src-tauri/src/jira_deep_analysis.rs
git commit -m "feat(jira): add jira_deep_analysis module with prompt + structs"
```

---

## Task 2: Declare the module and register the command in `main.rs`

**Files:**
- Modify: `src-tauri/src/main.rs`

### Step 1: Add module declaration

In `src-tauri/src/main.rs`, after the existing `mod jira_service;` line (around line 13), add:

```rust
mod jira_deep_analysis;
```

### Step 2: Add command to invoke_handler

In the `invoke_handler!(tauri::generate_handler![...])` block, after `post_jira_comment,` (around line 250), add:

```rust
analyze_jira_ticket_deep,
```

Note: `analyze_jira_ticket_deep` is defined in `commands/jira.rs` (Task 3) and re-exported via `use commands::*;` which is already at line 33.

### Step 3: Verify compiles

```bash
cd hadron-desktop && cargo check 2>&1 | grep "error" | head -10
```
Expected: errors about `analyze_jira_ticket_deep` not found — that's expected until Task 3 is done. The module declaration itself should be clean.

---

## Task 3: Add `analyze_jira_ticket_deep` Tauri command to `commands/jira.rs`

**Files:**
- Modify: `src-tauri/src/commands/jira.rs`

### Step 1: Add the command function

At the end of `src-tauri/src/commands/jira.rs` (after the `get_all_jira_links` function), add:

```rust
/// Deep JIRA analysis — JIRA-specific prompt, structured JSON output, stored in DB
#[tauri::command]
pub async fn analyze_jira_ticket_deep(
    request: crate::jira_deep_analysis::JiraDeepRequest,
    db: DbState<'_>,
) -> Result<serde_json::Value, String> {
    log::debug!("cmd: analyze_jira_ticket_deep key={}", request.jira_key);

    // Capture fields we need after moving `request` into run_jira_deep_analysis
    let jira_key = request.jira_key.clone();
    let summary = request.summary.clone();
    let model = request.model.clone();
    let provider = request.provider.clone();

    let result = crate::jira_deep_analysis::run_jira_deep_analysis(request).await?;

    // Persist to DB — reuse the existing analyses table
    // Map structured result to the flat DB columns
    let db = Arc::clone(&db);
    let result_clone = result.clone();
    let jira_key_clone = jira_key.clone();
    let model_clone = model.clone();

    let analysis_id = tauri::async_runtime::spawn_blocking(move || {
        let full_data = serde_json::to_string(&result_clone)
            .map_err(|e| format!("Serialization error: {}", e))?;

        let suggested_fixes = result_clone.recommended_actions
            .iter()
            .map(|a| format!("[{}] {}", a.priority, a.action))
            .collect::<Vec<_>>()
            .join("\n");

        db.save_analysis(
            &jira_key_clone,           // filename / ticket key
            &result_clone.technical.error_type,
            &result_clone.technical.root_cause,
            &suggested_fixes,
            &result_clone.technical.severity_estimate,
            None,                       // stack_trace
            Some(&result_clone.plain_summary), // error_message
            None,                       // component
            &model_clone,
            Some("jira_deep"),
            Some(&full_data),
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Return both the ID (for navigation) and the structured result
    Ok(serde_json::json!({
        "id": analysis_id,
        "result": result,
    }))
}
```

**Note on `db.save_analysis` signature:** Check `database.rs` for the exact parameter order. The call above assumes:
`fn save_analysis(&self, filename, error_type, root_cause, suggested_fixes, severity, stack_trace, error_message, component, ai_model, analysis_type, full_data) -> Result<i64, ...>`

If the signature differs, adjust accordingly — the key requirement is `analysis_type = "jira_deep"` and `full_data = JSON string of result`.

### Step 2: Build check

```bash
cd hadron-desktop && cargo check 2>&1 | grep "error" | head -20
```
Expected: no errors.

### Step 3: Commit

```bash
git add src-tauri/src/commands/jira.rs src-tauri/src/main.rs
git commit -m "feat(jira): add analyze_jira_ticket_deep Tauri command"
```

---

## Task 4: Add `analyzeJiraTicketDeep()` to `src/services/api.ts`

**Files:**
- Modify: `src/services/api.ts`

### Step 1: Add TypeScript types

After the existing `AnalysisResponse` type (or near the end of the types section), add:

```typescript
// ─── JIRA Deep Analysis types ────────────────────────────────────────────────

export interface JiraDeepTicketQuality {
  score: number;       // 0–100
  verdict: string;     // "Good" | "Needs Work" | "Poor"
  strengths: string[];
  gaps: string[];
}

export interface JiraDeepTechnical {
  root_cause: string;
  affected_areas: string[];
  error_type: string;
  severity_estimate: string;
  confidence: string;
  confidence_rationale: string;
}

export interface JiraDeepRecommendedAction {
  priority: string;  // "Immediate" | "Short-term" | "Long-term"
  action: string;
  rationale: string;
}

export interface JiraDeepRisk {
  user_impact: string;
  blast_radius: string;
  urgency: string;
  do_nothing_risk: string;
}

export interface JiraDeepResult {
  plain_summary: string;
  quality: JiraDeepTicketQuality;
  technical: JiraDeepTechnical;
  open_questions: string[];
  recommended_actions: JiraDeepRecommendedAction[];
  risk: JiraDeepRisk;
}

export interface JiraDeepAnalysisResponse {
  id: number;
  result: JiraDeepResult;
}
```

### Step 2: Add the invoke function

After the existing `analyzeJiraTicket()` function (around line 184), add:

```typescript
/**
 * Run dedicated JIRA deep analysis with JIRA-specific prompt and structured output.
 * Stores result in DB with analysis_type = "jira_deep".
 */
export async function analyzeJiraTicketDeep(
  jiraKey: string,
  summary: string,
  description: string,
  issueType: string,
  priority: string | undefined,
  status: string | undefined,
  components: string[],
  labels: string[],
  comments: string[],
  apiKey: string,
  model?: string,
  provider?: string,
): Promise<JiraDeepAnalysisResponse> {
  return invoke<JiraDeepAnalysisResponse>("analyze_jira_ticket_deep", {
    request: {
      jira_key: jiraKey,
      summary,
      description,
      issue_type: issueType,
      priority,
      status,
      components,
      labels,
      comments,
      api_key: apiKey,
      model: model ?? getStoredModel(),
      provider: provider ?? getStoredProvider(),
    },
  });
}
```

### Step 3: Commit

```bash
git add src/services/api.ts
git commit -m "feat(jira): add analyzeJiraTicketDeep TypeScript API function"
```

---

## Task 5: Create `JiraAnalysisReport.tsx` component

**Files:**
- Create: `src/components/jira/JiraAnalysisReport.tsx`

This component renders the structured `JiraDeepResult` inline in the JIRA Ticket Analyzer — no page navigation.

```tsx
/**
 * JiraAnalysisReport
 * Renders a structured JiraDeepResult inline in the ticket analyzer.
 */

import { useState } from "react";
import {
  CheckCircle2, AlertCircle, AlertTriangle, Info,
  ChevronDown, ChevronUp, ExternalLink, ClipboardList,
  Zap, Shield, HelpCircle, List,
} from "lucide-react";
import type { JiraDeepResult } from "../../services/api";

interface Props {
  analysisId: number;
  jiraKey: string;
  result: JiraDeepResult;
  onViewInHistory: (id: number) => void;
}

export default function JiraAnalysisReport({ analysisId, jiraKey, result, onViewInHistory }: Props) {
  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());

  function toggleAction(i: number) {
    setCheckedActions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Deep Analysis — {jiraKey}</span>
        </div>
        <button
          onClick={() => onViewInHistory(analysisId)}
          className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" /> View in History
        </button>
      </div>

      {/* Plain Summary */}
      <Section icon={<Info className="w-4 h-4 text-sky-400" />} title="Plain Language Summary">
        <p className="text-sm text-gray-300 leading-relaxed">{result.plain_summary}</p>
      </Section>

      {/* Quality Score */}
      <Section icon={<ClipboardList className="w-4 h-4 text-purple-400" />} title="Ticket Quality">
        <div className="flex items-center gap-3 mb-3">
          <QualityGauge score={result.quality.score} />
          <div>
            <span className={`text-sm font-semibold ${qualityColor(result.quality.verdict)}`}>
              {result.quality.verdict}
            </span>
            <span className="text-xs text-gray-500 ml-2">({result.quality.score}/100)</span>
          </div>
        </div>
        {result.quality.strengths.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-green-400 font-medium mb-1">Strengths</p>
            <ul className="space-y-0.5">
              {result.quality.strengths.map((s, i) => (
                <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.quality.gaps.length > 0 && (
          <div>
            <p className="text-xs text-amber-400 font-medium mb-1">Gaps</p>
            <ul className="space-y-0.5">
              {result.quality.gaps.map((g, i) => (
                <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Technical Analysis */}
      <Section icon={<AlertCircle className="w-4 h-4 text-red-400" />} title="Technical Analysis">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 text-xs">
          <MetaRow label="Error Type" value={result.technical.error_type} />
          <MetaRow label="Severity" value={result.technical.severity_estimate} highlight />
          <MetaRow label="Confidence" value={`${result.technical.confidence} — ${result.technical.confidence_rationale}`} span />
        </div>
        <div className="mb-2">
          <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">Root Cause</p>
          <p className="text-sm text-gray-300 leading-relaxed">{result.technical.root_cause}</p>
        </div>
        {result.technical.affected_areas.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">Affected Areas</p>
            <div className="flex flex-wrap gap-1">
              {result.technical.affected_areas.map((a) => (
                <span key={a} className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300 font-mono">{a}</span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Open Questions */}
      {result.open_questions.length > 0 && (
        <Section icon={<HelpCircle className="w-4 h-4 text-yellow-400" />} title="Open Questions">
          <ul className="space-y-1">
            {result.open_questions.map((q, i) => (
              <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                <span className="text-yellow-500 font-medium text-xs mt-1 flex-shrink-0">{i + 1}.</span>
                {q}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Recommended Actions — with validation checkboxes */}
      <Section icon={<List className="w-4 h-4 text-green-400" />} title="Recommended Actions">
        <p className="text-xs text-gray-500 mb-2">Check off items as your team validates them:</p>
        <ul className="space-y-2">
          {result.recommended_actions.map((action, i) => (
            <li
              key={i}
              className={`flex items-start gap-3 p-2.5 rounded-lg border transition ${
                checkedActions.has(i)
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-gray-700 bg-gray-800/40"
              }`}
            >
              <input
                type="checkbox"
                checked={checkedActions.has(i)}
                onChange={() => toggleAction(i)}
                className="mt-1 accent-green-500 flex-shrink-0 cursor-pointer"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityBadge(action.priority)}`}>
                    {action.priority}
                  </span>
                </div>
                <p className={`text-sm leading-snug ${checkedActions.has(i) ? "line-through text-gray-500" : "text-gray-200"}`}>
                  {action.action}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{action.rationale}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* Risk & Impact */}
      <Section icon={<Shield className="w-4 h-4 text-orange-400" />} title="Risk & Impact">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-3">
          <MetaRow label="Blast Radius" value={result.risk.blast_radius} highlight />
          <MetaRow label="Urgency" value={result.risk.urgency} highlight />
          <MetaRow label="User Impact" value={result.risk.user_impact} span />
          <MetaRow label="Do-Nothing Risk" value={result.risk.do_nothing_risk} span />
        </div>
      </Section>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-700/30 transition"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          {icon}
          {title}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

function MetaRow({ label, value, highlight, span }: { label: string; value: string; highlight?: boolean; span?: boolean }) {
  return (
    <>
      <span className={`text-gray-500 font-medium ${span ? "col-span-2" : ""}`}>{label}:</span>
      <span className={`${highlight ? "text-amber-300 font-semibold" : "text-gray-300"} ${span ? "col-span-2" : ""}`}>
        {value}
      </span>
    </>
  );
}

function QualityGauge({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  const r = 18, cx = 24, cy = 24;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth="4" />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
      />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill={color} fontWeight="bold">
        {score}
      </text>
    </svg>
  );
}

function qualityColor(verdict: string) {
  if (verdict === "Good" || verdict === "Excellent") return "text-green-400";
  if (verdict === "Needs Work") return "text-amber-400";
  return "text-red-400";
}

function priorityBadge(priority: string) {
  if (priority === "Immediate") return "bg-red-500/20 text-red-400";
  if (priority === "Short-term") return "bg-amber-500/20 text-amber-400";
  return "bg-blue-500/20 text-blue-400";
}
```

### Step 2: Commit

```bash
git add src/components/jira/JiraAnalysisReport.tsx
git commit -m "feat(jira): add JiraAnalysisReport component for deep analysis results"
```

---

## Task 6: Wire the "Deep Analyze" button into `JiraTicketAnalyzer.tsx`

**Files:**
- Modify: `src/components/jira/JiraTicketAnalyzer.tsx`

### Step 1: Add imports

At the top of `JiraTicketAnalyzer.tsx`, add to the existing imports:

```typescript
import { analyzeJiraTicketDeep, type JiraDeepResult } from "../../services/api";
import JiraAnalysisReport from "./JiraAnalysisReport";
import { Microscope } from "lucide-react"; // deep analyze icon
```

Also add `Microscope` to the existing `lucide-react` import line.

### Step 2: Add state for deep analysis

In the component body, after the existing state variables, add:

```typescript
const [deepAnalyzing, setDeepAnalyzing] = useState(false);
const [deepResult, setDeepResult] = useState<{ id: number; result: JiraDeepResult } | null>(null);
```

### Step 3: Add `handleDeepAnalyze` function

After the existing `handleAnalyze` function, add:

```typescript
async function handleDeepAnalyze() {
  if (!issue) return;

  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    setError("No API key configured. Set one in Settings.");
    return;
  }

  setDeepAnalyzing(true);
  setDeepResult(null);
  setError(null);

  try {
    const commentTexts = issue.comments.map((c) => c.body);
    const response = await analyzeJiraTicketDeep(
      issue.key,
      issue.summary,
      issue.descriptionPlaintext || "",
      issue.issueType || "Unknown",
      issue.priority || undefined,
      issue.status || undefined,
      issue.components,
      issue.labels,
      commentTexts,
      apiKey,
      getStoredModel(),
      getStoredProvider(),
    );
    setDeepResult({ id: response.id, result: response.result });
  } catch (err) {
    setError(`Deep analysis failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    setDeepAnalyzing(false);
  }
}
```

### Step 4: Add the button alongside the existing "Analyze with AI" button

The current action bar (around line 313–330) renders:
```tsx
<div className="px-5 py-4 flex items-center justify-between">
  <Button onClick={handleReset} variant="ghost">Clear & start over</Button>
  <Button onClick={handleAnalyze} ...>Analyze with AI</Button>
</div>
```

Replace it with:
```tsx
<div className="px-5 py-4 flex items-center justify-between">
  <Button onClick={handleReset} variant="ghost">
    Clear & start over
  </Button>
  <div className="flex items-center gap-2">
    <Button
      onClick={handleAnalyze}
      loading={analyzing}
      size="lg"
      icon={<Zap />}
      className="bg-sky-600 hover:bg-sky-700 font-semibold px-5"
      disabled={deepAnalyzing}
    >
      {analyzing ? "Analyzing..." : "Analyze with AI"}
    </Button>
    <Button
      onClick={handleDeepAnalyze}
      loading={deepAnalyzing}
      size="lg"
      icon={<Microscope />}
      className="bg-purple-700 hover:bg-purple-600 font-semibold px-5"
      disabled={analyzing}
    >
      {deepAnalyzing ? "Deep Analyzing..." : "Deep Analyze"}
    </Button>
  </div>
</div>
```

### Step 5: Add inline progress indicator for deep analysis

After the existing `{analyzing && <ProgressIndicator />}` block (around line 180–189), add:

```tsx
{deepAnalyzing && (
  <div className="flex items-center gap-3 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
    <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
    <div>
      <p className="text-sm text-purple-300 font-medium">Deep analyzing {issue?.key}...</p>
      <p className="text-xs text-gray-400">Running JIRA-specific analysis with structured output</p>
    </div>
  </div>
)}
```

### Step 6: Render the deep analysis report inline

After the closing `{/* Issue Preview Card */}` block (after line 331, before the empty state), add:

```tsx
{/* Deep Analysis Report */}
{deepResult && !deepAnalyzing && (
  <JiraAnalysisReport
    analysisId={deepResult.id}
    jiraKey={issue?.key ?? ""}
    result={deepResult.result}
    onViewInHistory={(id) => {
      // Navigate to the analysis in history
      // If a parent onAnalysisComplete callback accepts an Analysis object, fetch and pass it
      // For now, open a toast or inform user — full nav can be wired up in a follow-up
      console.log("View analysis in history:", id);
    }}
  />
)}
```

**Note:** The `onViewInHistory` callback should ideally call `getAnalysisById(id)` and then `onAnalysisComplete(analysis)` to navigate to the full analysis view. Wire this up after seeing how the component is used in the parent tab. For now, the console.log is a safe placeholder.

### Step 7: Full build check

```bash
cd hadron-desktop && npm run typecheck 2>&1 | head -40
```
Expected: no TypeScript errors.

### Step 8: Commit

```bash
git add src/components/jira/JiraTicketAnalyzer.tsx
git commit -m "feat(jira): wire Deep Analyze button and inline report in JiraTicketAnalyzer"
```

---

## Task 7: Connect `onViewInHistory` to history navigation

**Files:**
- Modify: `src/components/jira/JiraTicketAnalyzer.tsx`
- (Possibly) `src/components/jira/JiraAnalyzerView.tsx`

### Step 1: Check the parent component

Look at how `JiraTicketAnalyzer` is mounted in `JiraAnalyzerView.tsx`. The existing prop is:
```tsx
<JiraTicketAnalyzer onAnalysisComplete={onAnalysisComplete} />
```

The `onAnalysisComplete` callback receives an `Analysis` object and switches the tab to show the analysis.

### Step 2: Wire the navigation

In the `handleDeepAnalyze` success block (after `setDeepResult(...)`), also fetch the full analysis and call `onAnalysisComplete`:

```typescript
// After setDeepResult(...)
try {
  const fullAnalysis = await getAnalysisById(response.id);
  // Store but don't navigate yet — let the user see the inline report first
  // They can click "View in History" to navigate
  setDeepResult({ id: response.id, result: response.result, analysis: fullAnalysis });
} catch {
  // Navigation setup failed — the inline report is still shown
}
```

And update the `JiraAnalysisReport` `onViewInHistory` callback:
```tsx
onViewInHistory={(id) => {
  if (deepResult?.analysis) {
    onAnalysisComplete(deepResult.analysis);
  }
}}
```

You'll need to add `analysis?: Analysis` to the `deepResult` state type.

### Step 3: Commit

```bash
git add src/components/jira/JiraTicketAnalyzer.tsx
git commit -m "feat(jira): wire deep analysis View in History navigation"
```

---

## Task 8: Rust full build + TypeScript build

**Step 1: Rust build**
```bash
cd hadron-desktop && cargo build 2>&1 | grep "error" | head -20
```
Expected: clean build.

**Step 2: TypeScript build**
```bash
cd hadron-desktop && npm run build 2>&1 | tail -20
```
Expected: clean build.

**Step 3: Fix any errors found**

Common Rust errors to watch for:
- `db.save_analysis(...)` signature mismatch — check `database.rs` for the exact function signature
- Missing `use crate::ai_service::call_*` imports in `jira_deep_analysis.rs` — the functions need to be `pub` in `ai_service.rs`
- Ownership errors on `request` fields after moving into `run_jira_deep_analysis` — fix by cloning before the call

Common TS errors:
- `Microscope` not exported from `lucide-react` — use `FlaskConical` or `ScanSearch` as alternatives
- `issueType` field not present on `NormalizedIssue` — check the interface in `jira-import.ts` and use the correct field name (may be `type` or `issue_type`)

**Step 4: Final commit**
```bash
git add -A
git commit -m "feat(jira): complete deep analysis feature — full build passing"
```

---

## Acceptance Criteria

- [ ] "Deep Analyze" button appears beside "Analyze with AI" in `JiraTicketAnalyzer` after a ticket is fetched
- [ ] Clicking "Deep Analyze" shows a purple progress indicator while the AI call runs
- [ ] On success, the structured report renders inline below the ticket card (no navigation)
- [ ] The report shows all 6 sections: Plain Summary, Ticket Quality (with gauge), Technical Analysis, Open Questions, Recommended Actions (with checkboxes), Risk & Impact
- [ ] Checking an action item crosses it out
- [ ] "View in History" link navigates to the full analysis in the history view
- [ ] The analysis is stored in the DB with `analysis_type = "jira_deep"` (verify via DevTools SQLite or History tab)
- [ ] Both standard "Analyze with AI" and "Deep Analyze" work independently (no interference)
- [ ] TypeScript build and Rust build are both clean

---

## Known Simplifications / Follow-up Work (not in scope)

- **RAG + KB context**: The deep analysis currently sends only the ticket content. A follow-up can add RAG-retrieved similar analyses and KB domain knowledge to the user prompt.
- **Streaming**: The AI call is non-streaming. A follow-up can switch to streaming for large tickets.
- **Linked tickets**: A follow-up can fetch parent/linked/child ticket summaries and include them in the prompt.
- **Report caching**: The inline report disappears if the user fetches a new ticket. A follow-up can persist the last report per ticket key in `localStorage`.
