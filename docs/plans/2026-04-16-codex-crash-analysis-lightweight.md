# Codex Crash Analysis — Lightweight Alternative Plan

**Date:** 2026-04-16
**Status:** Proposal (alternative to spec-driven implementation plan)
**Scope:** Both hadron-desktop (Tauri + SQLite) and hadron-web (Axum + Postgres)
**Premise:** Test the simple hypothesis first, reuse what we have, avoid building a parallel system.

---

## Why this plan exists

The original plan commits 5 phases and ~20 stories to two hypotheses:

1. Codex-family models produce better crash analyses.
2. An agentic evidence-gathering workflow produces better crash analyses.

This plan tests hypothesis #1 first (cheapest to verify), reuses the existing web agent architecture for hypothesis #2 (instead of building a second one), and positions MCP as the third angle: letting Codex CLI investigate using Hadron's data externally.

If hypothesis #1 alone closes the quality gap, most of the original plan is unnecessary.

---

## What we already have

| Capability | Location | Status |
|-----------|----------|--------|
| Single-shot crash analysis | `ai_service.rs::analyze_crash_log` | Production, 5 providers |
| RAG-enhanced analysis | `ai_service.rs::analyze_crash_log_with_rag` | Production |
| Agentic chat with tools | `hadron-web: routes/chat.rs` | Production (10 tools, AgentState, evidence tracking, early stopping) |
| Evidence gate | `hadron-core: retrieval/evidence_gate.rs` | Production (threshold-based) |
| Chat tools (desktop) | `chat_tools.rs` | Production (4 tools) |
| MCP server (8 tools) | `hadron-mcp` crate | Just shipped |
| OpenAI gpt-5/o3 support | `ai_service.rs` (`is_gpt5` branch) | Partial (max_completion_tokens) |
| Codex-family models | `providers.ts` curated list | Not listed yet |

Key insight: the web chat agent (`routes/chat.rs`) already does iterative evidence gathering with structured `AgentState`, tool dispatch, evidence sufficiency, and early stopping. The desktop lacks this — it has a simpler chat loop. The gap is not "Hadron has no agent workflow" but "the desktop doesn't have the web's agent workflow."

---

## Phase 0: Baseline (2-3 days)

**Goal:** Measure current quality on both surfaces. Create the eval foundation.

### 0.1 Create shared fixture corpus

- 10 crash fixtures (not 25 — grow later from real misanalyses)
- Categories: clean crash, large walkback, ambiguous root cause, memory, database, WHATS'ON namespace, Sentry event, noisy low-signal, known historical regression, multi-thread deadlock
- Location: `tests/fixtures/crash-analysis/` (repo root — shared by both surfaces)
- Each fixture: `.txt` (input) + `.rubric.json` (expected severity, root cause category, key terms)

### 0.2 Eval harness — one per surface

**Desktop:** Rust binary at `hadron-desktop/src-tauri/src/bin/eval.rs`
- Calls `ai_service::analyze_crash_log()` directly
- Configurable: model, provider, analysis_type
- Outputs CSV: fixture, model, provider, latency_ms, tokens_used, schema_valid

**Web:** Rust binary at `hadron-web/crates/hadron-server/src/bin/eval.rs` (or a script hitting the REST API)
- Calls `POST /api/analyses/analyze` with each fixture
- Same CSV output format for comparison

Both read from the same fixture corpus. Results are directly comparable.

### 0.3 Baseline run

- Desktop: `gpt-4o`, `gpt-4.1`, `claude-sonnet-4`
- Web: same models via server-side AI config
- Save as `tests/fixtures/crash-analysis/baseline-desktop-2026-04-16.csv` and `baseline-web-2026-04-16.csv`

**Exit criteria:** We have numbers for both surfaces.

---

## Phase 1: Add Codex models to existing path (1-2 days)

**Goal:** Test hypothesis #1 with zero architecture changes, on both surfaces.

### 1.1 Add Codex to curated models

**Desktop** — `hadron-desktop/src/constants/providers.ts`:
```typescript
{ id: "codex-mini", label: "Codex Mini (Agent)", context: 1000000, category: "agent" },
```

**Web** — `hadron-web/frontend/src/constants/providers.ts` (or equivalent):
Same entry. Users can select it in the model picker on both surfaces.

### 1.2 Fix model detection on both surfaces

**Desktop** — `ai_service.rs` has 3 occurrences of:
```rust
let is_gpt5 = model.starts_with("gpt-5") || model.starts_with("o1") || model.starts_with("o3");
```
Add `|| model.starts_with("codex")`. Rename to `uses_max_completion_tokens` for clarity.

**Web** — `hadron-server/src/ai/mod.rs` uses a hardcoded `max_tokens: Some(4096)` in `OpenAiRequest` with no model-family detection at all. Add the same `uses_max_completion_tokens` logic: send `max_completion_tokens` for codex/gpt-5/o3 models, `max_tokens` for older models.

### 1.3 Verify Chat Completions works

On both surfaces, verify:
- Single-shot crash analysis works with `codex-mini`
- JSON mode works
- Streaming works (desktop polling + web SSE)

If Chat Completions works: the Responses API is unnecessary. Skip it entirely.

### 1.4 Eval run with Codex

- Run both surface eval harnesses with `codex-mini`
- Compare to Phase 0 baseline

**Decision point:** If Codex on the same single-shot path is materially better, ship it as an option and stop. If not, proceed to Phase 2.

---

## Phase 2: Port web agent to hadron-core (3-5 days)

**Goal:** Make the web's proven agent architecture available to desktop, instead of building a new one. Both surfaces use one agent implementation.

### Why not build a new agent loop?

`hadron-web/crates/hadron-server/src/routes/chat.rs` already has:
- `AgentState` with `tool_history`, `evidence: Vec<EvidenceItem>`, `evidence_tokens`, `iterations_used`
- 10 tools: search_analyses, search_tickets, search_sentry, get_analysis, search_knowledge_base, get_jira_issue, get_release_notes, suggest_related, calculate_metrics, summarize_evidence
- Evidence-grounded synthesis prompt
- Early stopping when evidence is sufficient
- Max iteration cap

Desktop's `chat_commands.rs` has a simpler 4-tool loop without structured evidence tracking. Building a third agent loop for crash analysis would create three divergent implementations.

### 2.1 Extract AgentState + loop into hadron-core

Move from `hadron-server/src/routes/chat.rs`:
- `AgentState`, `ToolCallRecord`, `EvidenceItem` → `hadron-core/src/ai/agent.rs`
- Agent loop logic (iterate, dispatch tools, check evidence, synthesize) → same module
- Tool dispatch stays surface-specific (Postgres vs SQLite), abstracted via an `AgentToolContext` trait (same pattern as `McpContext`)

Both surfaces then depend on `hadron-core::ai::agent` for the loop, with their own `AgentToolContext` impls.

### 2.2 Define CrashAnalysisAgent as a parameterized agent

Instead of a wholly new agent, configure the existing one:
- System prompt: crash analysis domain role
- Tool set: subset of existing tools + new crash-specific ones (stack trace summarizer, environment parser)
- Evidence threshold: higher than chat (crash analysis needs more evidence)
- Max iterations: 5 (crash analysis is bounded)
- Final synthesis: structured JSON output matching `AnalysisResult`

### 2.3 Wire into both surfaces

**Desktop:** New Tauri command `analyze_crash_log_agent`
- Behind `crash_agent_enabled` feature flag (Tauri store setting)
- Falls back to `analyze_crash_log` if disabled
- Streams progress events to frontend (reuse chat stream infrastructure)

**Web:** New route `POST /api/analyses/analyze/agent`
- Behind `HADRON_CRASH_AGENT_ENABLED` env var (default: false)
- Falls back to existing `run_analysis_with_config` if disabled
- Streams via SSE (same pattern as chat)

### 2.4 Eval run with agent path

- Run both eval harnesses with: `codex-mini` on agent path, `gpt-4.1` on agent path, baselines
- Compare all variants across both surfaces

**Exit criteria:** Agent path works on both web and desktop. Eval shows whether the workflow improvement matters.

---

## Phase 3: MCP angle — let external agents use Hadron (1 day, already mostly done)

**Goal:** Enable Codex CLI / Claude Code / Cursor to investigate crashes using Hadron's data, on both surfaces.

Already shipped:
- `hadron-mcp` crate with 8 tools (shared by both surfaces)
- Desktop: `hadron-mcp` stdio binary
- Web: `POST /api/mcp` (JSON-RPC 2.0 over HTTP, JWT auth)

Remaining work:

### 3.1 Add crash-specific MCP tools

Two new tools in `hadron-mcp` (available on both surfaces automatically):
- `parse_crash_sections` — runs `hadron-core::parser::parse_crash_content` on raw crash text, returns structured sections (stack trace, environment, DB state, memory)
- `analyze_crash_quick` — runs the single-shot analysis and returns the result

The `McpContext` trait gets two new methods; web implements them over Postgres, desktop over SQLite. Since the parser is in `hadron-core` (shared), both implementations call the same parsing logic.

### 3.2 Example prompts for Codex CLI / Claude Code

Add to `docs/mcp/README.md`:
```
Example: "Analyze this crash log. Use hadron's parse_crash_sections to extract structure,
then search_ticket_briefs for similar issues, then hybrid_search for related context.
Finally, provide root cause analysis and remediation steps."
```

Works identically whether the MCP client connects to the desktop stdio binary or the web HTTP endpoint.

**Exit criteria:** An external agent can investigate crashes using Hadron as a tool source on either surface.

---

## Phase 4: Prompt improvements (2 days, if needed)

Only if the eval data from Phases 1-3 shows the prompts are the bottleneck.

### 4.1 Split system prompt into layers

The current `WHATSON_SYSTEM_PROMPT` is a monolithic blob. Split into:
- Role definition (short)
- Investigation instructions (what to look for)
- Output schema (JSON structure)

### 4.2 Move schema enforcement to final synthesis

In agent mode, don't force JSON schema during evidence gathering — only enforce it on the final synthesis turn. The model reasons better when not constrained to a schema during investigation.

---

## What this plan skips (and why)

| Original plan item | Why skip |
|--------------------|----------|
| OpenAI Responses API transport | Chat Completions works for Codex models. Verify in Phase 1.3; add later only if needed. |
| New streaming parser | Existing streaming works on both surfaces. No new parser needed. |
| Separate crash agent loop | Reuse web's proven agent. Extract to hadron-core so both surfaces share it. |
| Desktop-only scope | Both surfaces are first-class. hadron-core extraction ensures parity. |
| 25 fixtures up front | Start with 10, grow from real misanalyses. |
| Prompt modularization (Phase 3 of original) | Only if eval shows prompts are the bottleneck. |
| Settings/UX/candidate default (Phase 4-5 of original) | Standard model picker already works on both surfaces. Add Codex to the list and ship. |

---

## Timeline

| Phase | Duration | Depends on |
|-------|----------|------------|
| 0: Baseline | 2-3 days | Nothing |
| 1: Add Codex models | 1-2 days | Phase 0 |
| Decision point | 1 day | Phase 1 eval results |
| 2: Port agent to hadron-core | 3-5 days | Only if Phase 1 isn't enough |
| 3: MCP crash tools | 1 day | MCP server (done) |
| 4: Prompt improvements | 2 days | Only if eval shows need |

**Best case (model alone is enough):** 4-6 days total.
**Worst case (need agent + prompts):** 10-13 days total.

Original plan estimate: 5 phases, unknown duration, ~20 stories.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Codex via Chat Completions doesn't support tool_use | Verify in Phase 1.3. If true, add minimal Responses support (not the full transport refactor). |
| hadron-core agent extraction is harder than expected | The web agent is ~300 lines. Extraction is mechanical, not architectural. |
| MCP approach is too indirect for users | Phase 2 gives the embedded agent path as fallback. MCP is additive. |
| Eval corpus is too small | It's a starting point. Add fixtures as real failures surface. |

---

## Success criteria

Same as the original plan, but testable sooner and on both surfaces:

- Codex-family models are available in the model picker on both desktop and web (Phase 1)
- Crash analysis quality improves measurably on the fixture set on both surfaces (Phase 1 or 2)
- External agents can investigate crashes via MCP on both surfaces (Phase 3)
- No regressions to existing single-shot path on either surface
- Agent architecture lives in hadron-core, not duplicated per surface
- Decision to expand scope is based on eval data from both surfaces, not speculation
