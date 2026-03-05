# JIRA Assist Sprint 3 — Investigation Brief Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Generate Brief" button that runs triage and deep analysis in parallel, combines the results into a persisted `JiraBriefResult`, and displays a rich tabbed `TicketBriefPanel` below the ticket card.

**Architecture:** New `jira_brief.rs` module holds `JiraBriefRequest`, `JiraBriefResult` (which embeds `JiraTriageResult` + `JiraDeepResult`), and `run_jira_brief` which calls both in parallel via `tokio::try_join!`. A new `generate_ticket_brief` command in `commands/jira_assist.rs` calls it and persists `brief_json` (plus syncs triage fields). The frontend adds a `TicketBriefPanel` with two tabs ("Brief" / "Analysis") and a "Generate Brief" button alongside the existing three buttons; the brief is reloaded from DB on ticket fetch.

**Tech Stack:** Rust (tokio::try_join!, serde_json), Tauri v2, React/TypeScript, existing `jira_triage::run_jira_triage`, existing `jira_deep_analysis::run_jira_deep_analysis`.

---

## Key File Map

| File | Action |
|------|--------|
| `src-tauri/src/jira_brief.rs` | Create — brief module |
| `src-tauri/src/main.rs` | Modify — `mod jira_brief;` + register command |
| `src-tauri/src/commands/jira_assist.rs` | Modify — add `generate_ticket_brief` command |
| `src/services/jira-assist.ts` | Modify — add `JiraBriefResult` + `generateTicketBrief()` |
| `src/components/jira/TicketBriefPanel.tsx` | Create — tabbed brief display |
| `src/components/jira/JiraTicketAnalyzer.tsx` | Modify — "Generate Brief" button + load-on-fetch + render panel |

---

## Background: existing types you will use

`JiraTriageRequest` / `JiraTriageResult` — `src-tauri/src/jira_triage.rs`
`JiraDeepRequest` / `JiraDeepResult` — `src-tauri/src/jira_deep_analysis.rs`
`run_jira_triage(req: JiraTriageRequest) -> Result<JiraTriageResult, String>` — async, cloud only
`run_jira_deep_analysis(req: JiraDeepRequest) -> Result<JiraDeepResult, String>` — async, cloud only
`db.upsert_ticket_brief(&TicketBrief)` — available on the `Database` wrapper via `DbState`

---

## Task 1: Create `src-tauri/src/jira_brief.rs`

**Files:**
- Create: `src-tauri/src/jira_brief.rs`

### Step 1: Create the file

```rust
//! JIRA Assist — Investigation Brief (Sprint 3).
//!
//! Runs triage + deep analysis in parallel and combines the results
//! into a single `JiraBriefResult` that is persisted as `brief_json`.

use serde::{Deserialize, Serialize};
use crate::jira_triage::{JiraTriageRequest, JiraTriageResult};
use crate::jira_deep_analysis::{JiraDeepRequest, JiraDeepResult};

// ─── Input ───────────────────────────────────────────────────────────────────

/// Combined input for the investigation brief.
/// Contains all fields needed by both triage and deep analysis.
#[derive(Debug, Deserialize)]
pub struct JiraBriefRequest {
    pub jira_key: String,
    /// Ticket summary/title — maps to `title` in triage and `summary` in deep analysis.
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

/// Combined result: triage classification + deep technical analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraBriefResult {
    pub triage: JiraTriageResult,
    pub analysis: JiraDeepResult,
}

// ─── Core function ────────────────────────────────────────────────────────────

/// Run triage and deep analysis in parallel, then combine.
/// Both calls use the same provider/model/key from the request.
pub async fn run_jira_brief(req: JiraBriefRequest) -> Result<JiraBriefResult, String> {
    // Build both sub-requests from the combined input
    let triage_req = JiraTriageRequest {
        jira_key:    req.jira_key.clone(),
        title:       req.title.clone(),
        description: req.description.clone(),
        issue_type:  req.issue_type.clone(),
        priority:    req.priority.clone(),
        status:      req.status.clone(),
        components:  req.components.clone(),
        labels:      req.labels.clone(),
        comments:    req.comments.clone(),
        api_key:     req.api_key.clone(),
        model:       req.model.clone(),
        provider:    req.provider.clone(),
    };

    let deep_req = JiraDeepRequest {
        jira_key:    req.jira_key,
        summary:     req.title,
        description: req.description,
        issue_type:  req.issue_type,
        priority:    req.priority,
        status:      req.status,
        components:  req.components,
        labels:      req.labels,
        comments:    req.comments,
        api_key:     req.api_key,
        model:       req.model,
        provider:    req.provider,
    };

    // Run both AI calls in parallel
    let (triage, analysis) = tokio::try_join!(
        crate::jira_triage::run_jira_triage(triage_req),
        crate::jira_deep_analysis::run_jira_deep_analysis(deep_req),
    )?;

    Ok(JiraBriefResult { triage, analysis })
}
```

### Step 2: Verify it compiles (will get "module not declared" error — that's expected)

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error" | head -20
```

Expected: only errors about `jira_brief` not declared as a module. Any other errors must be fixed.

### Step 3: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add hadron-desktop/src-tauri/src/jira_brief.rs
git commit -m "feat(jira-assist): add jira_brief module — parallel triage+analysis, JiraBriefResult"
```

---

## Task 2: Declare module + add `generate_ticket_brief` command

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/commands/jira_assist.rs`

### Step 1: Add `mod jira_brief;` to `main.rs`

Find the block of `mod` declarations. Add after `mod jira_triage;`:
```rust
mod jira_brief;
```

### Step 2: Add the command to `commands/jira_assist.rs`

Open `commands/jira_assist.rs`. Add to the imports at the top:
```rust
use crate::jira_brief::{JiraBriefRequest, JiraBriefResult};
```

Then append this command at the end of the file:

```rust
/// Generate a full investigation brief — runs triage + deep analysis in parallel.
/// Persists the combined result as `brief_json` in `ticket_briefs`, and also
/// syncs the triage fields (severity, category, tags, triage_json).
#[tauri::command]
pub async fn generate_ticket_brief(
    request: JiraBriefRequest,
    db: DbState<'_>,
) -> Result<JiraBriefResult, String> {
    log::debug!("cmd: generate_ticket_brief key={}", request.jira_key);

    // Capture fields needed for the DB upsert after request is consumed
    let jira_key = request.jira_key.clone();
    let title    = request.title.clone();

    let result = crate::jira_brief::run_jira_brief(request).await?;

    // Serialize for storage
    let db = Arc::clone(&db);
    let result_clone = result.clone();
    let tags_json = serde_json::to_string(&result_clone.triage.tags)
        .unwrap_or_else(|_| "[]".to_string());
    let triage_json = serde_json::to_string(&result_clone.triage)
        .map_err(|e| format!("Serialization error (triage): {}", e))?;
    let brief_json = serde_json::to_string(&result_clone)
        .map_err(|e| format!("Serialization error (brief): {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let brief = TicketBrief {
            jira_key: jira_key.clone(),
            title,
            customer:       None,
            severity:       Some(result_clone.triage.severity.clone()),
            category:       Some(result_clone.triage.category.clone()),
            tags:           Some(tags_json),
            triage_json:    Some(triage_json),
            brief_json:     Some(brief_json),
            posted_to_jira: false,
            posted_at:      None,
            engineer_rating: None,
            engineer_notes:  None,
            created_at:     String::new(),
            updated_at:     String::new(),
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

In the invoke_handler, after `commands::jira_assist::triage_jira_ticket`, add:
```rust
commands::jira_assist::generate_ticket_brief,
```

### Step 4: Compile check

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error" | head -20
```

Expected: 0 errors. Fix any before committing.

### Step 5: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add \
  hadron-desktop/src-tauri/src/main.rs \
  hadron-desktop/src-tauri/src/commands/jira_assist.rs
git commit -m "feat(jira-assist): add generate_ticket_brief Tauri command"
```

---

## Task 3: TypeScript — add types and `generateTicketBrief()` to `jira-assist.ts`

**Files:**
- Modify: `src/services/jira-assist.ts`

### Step 1: Add the `JiraBriefResult` interface

Read the file first. After the existing `JiraTriageResult` interface, add:

```typescript
// ─── Brief types (re-export deep analysis types inline to avoid cross-service imports) ───

export interface JiraDeepTicketQuality {
  score: number;
  verdict: string;
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
  priority: string;
  action: string;
  rationale: string;
}

export interface JiraDeepRisk {
  user_impact: string;
  blast_radius: string;
  urgency: string;
  do_nothing_risk: string;
}

export interface JiraDeepAnalysis {
  plain_summary: string;
  quality: JiraDeepTicketQuality;
  technical: JiraDeepTechnical;
  open_questions: string[];
  recommended_actions: JiraDeepRecommendedAction[];
  risk: JiraDeepRisk;
}

export interface JiraBriefResult {
  triage: JiraTriageResult;
  analysis: JiraDeepAnalysis;
}
```

**Note:** These deep analysis sub-types duplicate those in `api.ts` (`JiraDeepResult`, etc.) but keeping them in `jira-assist.ts` avoids a cross-service import. They are structurally identical.

### Step 2: Add `generateTicketBrief()` function

After `triageJiraTicket`, add:

```typescript
/** Generate a full investigation brief (triage + deep analysis in parallel). */
export async function generateTicketBrief(params: {
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
}): Promise<JiraBriefResult> {
  return invoke<JiraBriefResult>("generate_ticket_brief", {
    request: {
      jira_key:    params.jiraKey,
      title:       params.title,
      description: params.description,
      issue_type:  params.issueType,
      priority:    params.priority,
      status:      params.status,
      components:  params.components,
      labels:      params.labels,
      comments:    params.comments,
      api_key:     params.apiKey,
      model:       params.model,
      provider:    params.provider,
    },
  });
}
```

### Step 3: TypeScript check

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npx tsc --noEmit 2>&1 | grep "jira-assist" | head -10
```

Expected: no errors.

### Step 4: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add hadron-desktop/src/services/jira-assist.ts
git commit -m "feat(jira-assist): add JiraBriefResult types and generateTicketBrief() API"
```

---

## Task 4: Create `TicketBriefPanel.tsx`

**Files:**
- Create: `src/components/jira/TicketBriefPanel.tsx`

### Step 1: Create the file

```tsx
/**
 * TicketBriefPanel
 * Full investigation brief — tabbed display combining triage + deep analysis.
 * Shown after "Generate Brief" runs, or when loaded from DB on ticket fetch.
 */

import { useState } from "react";
import {
  FileText, Zap, ShieldAlert, AlertCircle, HelpCircle,
  List, Shield, CheckCircle2, AlertTriangle, ChevronDown,
  ChevronUp, ExternalLink, Tag, Users, Brain,
} from "lucide-react";
import type { JiraBriefResult } from "../../services/jira-assist";
import {
  SEVERITY_BADGE, CATEGORY_COLORS, CONFIDENCE_COLOR,
} from "../../services/jira-assist";

interface TicketBriefPanelProps {
  jiraKey: string;
  result: JiraBriefResult;
  /** When true shows a subtle "loaded from DB" indicator */
  fromCache?: boolean;
}

type BriefTab = "brief" | "analysis";

export default function TicketBriefPanel({ jiraKey, result, fromCache }: TicketBriefPanelProps) {
  const [tab, setTab] = useState<BriefTab>("brief");
  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());

  function toggleAction(i: number) {
    setCheckedActions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  const severityClass  = SEVERITY_BADGE[result.triage.severity]   ?? "bg-gray-500/15 text-gray-300 border-gray-500/30";
  const categoryClass  = CATEGORY_COLORS[result.triage.category]  ?? "bg-gray-500/15 text-gray-300 border-gray-500/30";
  const confidenceClass = CONFIDENCE_COLOR[result.triage.confidence] ?? "text-gray-400";

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-white">Investigation Brief — {jiraKey}</span>
          {fromCache && (
            <span className="text-xs text-gray-600 italic">· saved</span>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
          {(["brief", "analysis"] as BriefTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded-md transition capitalize ${
                tab === t
                  ? "bg-indigo-600 text-white font-medium"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {t === "brief" ? "Brief" : "Analysis"}
            </button>
          ))}
        </div>
      </div>

      {/* Brief tab */}
      {tab === "brief" && (
        <div className="p-4 space-y-4">
          {/* Triage summary row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Triage</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${severityClass}`}>
              {result.triage.severity}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border ${categoryClass}`}>
              {result.triage.category}
            </span>
            {result.triage.tags.map((tag) => (
              <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
                {tag}
              </span>
            ))}
          </div>

          {/* Plain summary */}
          <div className="bg-gray-900/50 rounded-lg p-3">
            <p className="text-sm text-gray-300 leading-relaxed">{result.analysis.plain_summary}</p>
          </div>

          {/* Customer impact */}
          <Section icon={<Users className="w-4 h-4 text-sky-400" />} title="Customer Impact">
            <p className="text-sm text-gray-300 leading-relaxed">{result.triage.customer_impact}</p>
          </Section>

          {/* Technical */}
          <Section icon={<AlertCircle className="w-4 h-4 text-red-400" />} title="Technical Analysis">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 text-xs">
              <MetaRow label="Error Type" value={result.analysis.technical.error_type} />
              <MetaRow label="Severity" value={result.analysis.technical.severity_estimate} highlight />
              <MetaRow
                label="Confidence"
                value={`${result.analysis.technical.confidence} — ${result.analysis.technical.confidence_rationale}`}
                span
              />
            </div>
            <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">Root Cause</p>
            <p className="text-sm text-gray-300 leading-relaxed mb-3">{result.analysis.technical.root_cause}</p>
            {result.analysis.technical.affected_areas.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.analysis.technical.affected_areas.map((a) => (
                  <span key={a} className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300 font-mono">{a}</span>
                ))}
              </div>
            )}
          </Section>

          {/* Recommended actions */}
          <Section icon={<List className="w-4 h-4 text-green-400" />} title="Recommended Actions">
            <p className="text-xs text-gray-500 mb-2">Check off as your team validates:</p>
            <ul className="space-y-2">
              {result.analysis.recommended_actions.map((action, i) => (
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
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium mr-2 ${priorityBadge(action.priority)}`}>
                      {action.priority}
                    </span>
                    <p className={`text-sm leading-snug inline ${checkedActions.has(i) ? "line-through text-gray-500" : "text-gray-200"}`}>
                      {action.action}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{action.rationale}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          {/* Risk */}
          <Section icon={<Shield className="w-4 h-4 text-orange-400" />} title="Risk & Impact">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <MetaRow label="Blast Radius" value={result.analysis.risk.blast_radius} highlight />
              <MetaRow label="Urgency"      value={result.analysis.risk.urgency} highlight />
              <MetaRow label="User Impact"     value={result.analysis.risk.user_impact} span />
              <MetaRow label="Do-Nothing Risk" value={result.analysis.risk.do_nothing_risk} span />
            </div>
          </Section>

          {/* Triage rationale */}
          <Section icon={<Brain className="w-4 h-4 text-purple-400" />} title="Triage Rationale">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs ${confidenceClass}`}>{result.triage.confidence} confidence</span>
            </div>
            <p className="text-sm text-gray-400 italic leading-relaxed">{result.triage.rationale}</p>
          </Section>
        </div>
      )}

      {/* Analysis tab — ticket quality + open questions */}
      {tab === "analysis" && (
        <div className="p-4 space-y-4">
          {/* Ticket quality */}
          <Section icon={<FileText className="w-4 h-4 text-purple-400" />} title="Ticket Quality">
            <div className="flex items-center gap-3 mb-3">
              <QualityGauge score={result.analysis.quality.score} />
              <div>
                <span className={`text-sm font-semibold ${qualityColor(result.analysis.quality.verdict)}`}>
                  {result.analysis.quality.verdict}
                </span>
                <span className="text-xs text-gray-500 ml-2">({result.analysis.quality.score}/100)</span>
              </div>
            </div>
            {result.analysis.quality.strengths.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-green-400 font-medium mb-1">Strengths</p>
                <ul className="space-y-0.5">
                  {result.analysis.quality.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.analysis.quality.gaps.length > 0 && (
              <div>
                <p className="text-xs text-amber-400 font-medium mb-1">Gaps</p>
                <ul className="space-y-0.5">
                  {result.analysis.quality.gaps.map((g, i) => (
                    <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          {/* Open questions */}
          {result.analysis.open_questions.length > 0 && (
            <Section icon={<HelpCircle className="w-4 h-4 text-yellow-400" />} title="Open Questions">
              <ul className="space-y-1">
                {result.analysis.open_questions.map((q, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-yellow-500 font-medium text-xs mt-1 flex-shrink-0">{i + 1}.</span>
                    {q}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
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
          {icon}{title}
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
      <span className={`text-gray-500 font-medium text-xs ${span ? "col-span-2" : ""}`}>{label}:</span>
      <span className={`text-xs ${highlight ? "text-amber-300 font-semibold" : "text-gray-300"} ${span ? "col-span-2" : ""}`}>
        {value}
      </span>
    </>
  );
}

function QualityGauge({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  const r = 18, cx = 24, cy = 24, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth="4" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 24 24)" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill={color} fontWeight="bold">{score}</text>
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

### Step 2: TypeScript check

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npx tsc --noEmit 2>&1 | grep "TicketBriefPanel" | head -10
```

Expected: no errors.

### Step 3: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add hadron-desktop/src/components/jira/TicketBriefPanel.tsx
git commit -m "feat(jira-assist): add TicketBriefPanel tabbed component"
```

---

## Task 5: Wire "Generate Brief" into `JiraTicketAnalyzer.tsx`

**Files:**
- Modify: `src/components/jira/JiraTicketAnalyzer.tsx`

Read the file first to understand the current structure before making changes.

### Step 1: Add imports

Add to the existing import from `../../services/jira-assist`:
```typescript
import { generateTicketBrief, type JiraBriefResult } from "../../services/jira-assist";
```

Add the new component import:
```typescript
import TicketBriefPanel from "./TicketBriefPanel";
```

Add `BookOpen` to the existing `lucide-react` import line.

### Step 2: Add state variables

After the existing `triageFromCache` state, add:
```typescript
const [briefing, setBriefing] = useState(false);
const [briefResult, setBriefResult] = useState<JiraBriefResult | null>(null);
const [briefFromCache, setBriefFromCache] = useState(false);
```

### Step 3: Load existing brief from DB on ticket fetch

In `handleFetch`, after the existing triage DB-load block (the `getTicketBrief` try/catch), add:
```typescript
// Load any previously stored brief
setBriefResult(null);
setBriefFromCache(false);
try {
  const brief = await getTicketBrief(result.issue.key);
  if (brief?.brief_json) {
    const parsed: JiraBriefResult = JSON.parse(brief.brief_json);
    setBriefResult(parsed);
    setBriefFromCache(true);
  }
} catch {
  // No stored brief — that's fine
}
```

### Step 4: Clear brief in `handleReset`

Add to `handleReset`:
```typescript
setBriefResult(null);
setBriefFromCache(false);
```

### Step 5: Add `handleGenerateBrief` function

After `handleTriage`, add:
```typescript
async function handleGenerateBrief() {
  if (!issue) return;

  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    setError("No API key configured. Set one in Settings.");
    return;
  }

  setBriefing(true);
  setError(null);

  try {
    const commentTexts = issue.comments.map((c) => c.body);
    const result = await generateTicketBrief({
      jiraKey:     issue.key,
      title:       issue.summary,
      description: issue.descriptionPlaintext || "",
      issueType:   issue.issueType || "Unknown",
      priority:    issue.priority || undefined,
      status:      issue.status || undefined,
      components:  issue.components,
      labels:      issue.labels,
      comments:    commentTexts,
      apiKey,
      model:    getStoredModel(),
      provider: getStoredProvider(),
    });
    setBriefResult(result);
    setBriefFromCache(false);
    // Also sync triage result from the brief (brief includes a fresh triage)
    setTriageResult(result.triage);
    setTriageFromCache(false);
  } catch (err) {
    setError(`Brief generation failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBriefing(false);
  }
}
```

### Step 6: Add indigo progress indicator

After the amber triage progress block, add:
```tsx
{briefing && (
  <div className="flex items-center gap-3 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
    <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
    <div>
      <p className="text-sm text-indigo-300 font-medium">Generating brief for {issue?.key}...</p>
      <p className="text-xs text-gray-400">Running triage + deep analysis in parallel</p>
    </div>
  </div>
)}
```

### Step 7: Add "Generate Brief" button to the action bar

In the `<div className="flex items-center gap-2">` that wraps all action buttons, add a "Generate Brief" button AFTER the Triage button (between Triage and "Analyze with AI"):

```tsx
<Button
  onClick={handleGenerateBrief}
  loading={briefing}
  size="lg"
  icon={<BookOpen />}
  className="bg-indigo-700 hover:bg-indigo-600 font-semibold px-5"
  disabled={analyzing || deepAnalyzing || triaging}
>
  {briefing ? "Generating..." : "Generate Brief"}
</Button>
```

Also add `|| briefing` to the `disabled` prop of each of the other three buttons so all four are mutually exclusive.

### Step 8: Render `TicketBriefPanel`

After the `{/* Triage Badge Panel */}` block (and before the `{/* Deep Analysis Report */}` block), add:
```tsx
{/* Investigation Brief Panel */}
{briefResult && !briefing && issue && (
  <TicketBriefPanel
    jiraKey={issue.key}
    result={briefResult}
    fromCache={briefFromCache}
  />
)}
```

### Step 9: TypeScript check

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

Expected: only the two pre-existing errors in `PerformanceAnalyzerView.tsx` and `code-analysis.ts`.

### Step 10: Commit

```bash
cd /mnt/c/Projects/Hadron_v3 && git add hadron-desktop/src/components/jira/JiraTicketAnalyzer.tsx
git commit -m "feat(jira-assist): wire Generate Brief button and TicketBriefPanel into JiraTicketAnalyzer"
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

Expected: succeeds. Pre-existing TS errors in `PerformanceAnalyzerView.tsx` / `code-analysis.ts` are acceptable.

### Step 3: Final commit if needed

Only if there are uncommitted changes from fixing build errors:
```bash
cd /mnt/c/Projects/Hadron_v3 && git add -A && git commit -m "chore(jira-assist): sprint 3 — fix build errors"
```

---

## Sprint 3 Acceptance Criteria

- [ ] `cargo build` — 0 errors
- [ ] `npm run build` — succeeds
- [ ] "Generate Brief" button (indigo) appears in the action bar; all four buttons mutually disable each other
- [ ] Clicking "Generate Brief" shows an indigo progress indicator while running
- [ ] On success, `TicketBriefPanel` renders below the ticket card showing "Brief" tab by default
- [ ] Brief tab shows: triage badges row, plain summary, Customer Impact, Technical Analysis (root cause + areas), Recommended Actions (with checkboxes), Risk & Impact, Triage Rationale
- [ ] Analysis tab shows: Ticket Quality gauge + strengths/gaps, Open Questions
- [ ] Generating a brief also updates the `TriageBadgePanel` with the new triage result
- [ ] Re-fetching the same ticket reloads both the brief and triage from DB ("· saved" indicator)
- [ ] `ticket_briefs.brief_json` is set in SQLite after generation
