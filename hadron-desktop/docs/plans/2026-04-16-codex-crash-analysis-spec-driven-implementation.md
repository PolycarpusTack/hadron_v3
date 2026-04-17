# Codex-Like Crash Analysis Implementation Plan

**Date:** 2026-04-16
**Approach:** Spec-driven, TDD-first, staged rollout
**Audience:** Hadron maintainers, Rust backend contributors, frontend contributors, QA
**Strategy:** Add OpenAI Responses support, introduce agentic crash analysis, evaluate before default switch

---

## Goal

Improve Hadron crash analysis so it behaves more like the Codex application for investigation quality, evidence gathering, and final synthesis.

This plan is intentionally not a "swap the default model" plan. The current hypothesis is that the quality gap comes from two sources:

1. The Codex-family model itself.
2. The Codex workflow around the model: iterative evidence gathering, tool use, structured reasoning, and final synthesis.

The implementation therefore targets both.

---

## Problem Statement

Today Hadron crash analysis is a structured single-shot analysis flow:

- Read crash file in `src-tauri/src/commands/ai.rs`
- Build a large prompt in `src-tauri/src/ai_service.rs`
- Optionally inject RAG / KB context
- Call the configured provider
- Parse one JSON response

Relevant files:

- `src-tauri/src/commands/ai.rs`
- `src-tauri/src/ai_service.rs`
- `src-tauri/src/chat_commands.rs`
- `src-tauri/src/model_fetcher.rs`
- `src/constants/providers.ts`
- `src/services/api.ts`
- `src/services/chat.ts`

This is materially different from a Codex-like agent workflow, which is iterative, tool-aware, and environment-aware.

---

## Desired Outcome

At the end of this initiative:

- Hadron can call OpenAI Codex-family models through a supported transport.
- Crash analysis has a new agent mode that gathers evidence before final synthesis.
- The old single-shot path remains available as a fallback during rollout.
- Quality is measured against a maintained fixture set before any default change.
- The decision to make Codex-family models the default is based on eval evidence, not anecdote.

---

## Non-Goals

- Embedding the entire `openai/codex` repository into Hadron.
- Recreating Codex CLI worktrees, shell execution, or subagents inside phase 1.
- Migrating all providers to a new transport in the first delivery wave.
- Replacing Ask Hadron chat architecture wholesale.

---

## Architecture Summary

### Current State

Current crash analysis entry point:

- `src-tauri/src/commands/ai.rs::analyze_crash_log`

Current analysis engine:

- `src-tauri/src/ai_service.rs::analyze_crash_log`
- `src-tauri/src/ai_service.rs::analyze_crash_log_safe`

Current tool-using agent loop exists only for chat:

- `src-tauri/src/chat_commands.rs::chat_send`

Current OpenAI path is still centered on `/v1/chat/completions`:

- `src-tauri/src/ai_service.rs::ProviderConfig::openai`

### Target State

Introduce three clearly separated layers:

1. **Transport layer**
   - OpenAI Chat Completions adapter
   - OpenAI Responses adapter
   - Existing Anthropic / Z.ai / local adapters unchanged at first

2. **Workflow layer**
   - Single-shot structured analysis workflow
   - Agentic crash analysis workflow

3. **Policy layer**
   - Model capability rules
   - Prompt modules
   - Evidence sufficiency rules
   - Output schema rules

---

## Delivery Principles

### Spec-Driven Development

No implementation starts without a written spec section covering:

- Problem being solved
- Scope
- Input / output contract
- Failure modes
- Rollback path
- Observability / metrics
- Test strategy

### TDD

For each story:

1. Write or extend the spec.
2. Add failing tests.
3. Implement minimum code to pass.
4. Refactor.
5. Run targeted regression suite.
6. Complete review checklist.

### Safe Rollout

Risky behavior ships behind flags first:

- `openai_responses_enabled`
- `crash_agent_enabled`
- `codex_default_candidate`

---

## Global Definition Of Ready

A story or phase is ready only when all of the following are true:

- The problem statement is written and agreed.
- In-scope and out-of-scope items are documented.
- Required OpenAI behavior has been verified against current official docs.
- API contract changes are identified.
- Test cases are enumerated before implementation.
- Logging and error-handling expectations are defined.
- Data persistence impact is understood.
- Security / privacy implications are reviewed.
- Rollback path is documented.
- Ownership is clear.

---

## Global Definition Of Done

A story or phase is done only when all of the following are true:

- The spec is updated.
- Tests were written first or updated before behavior change.
- Unit tests pass.
- Integration tests pass where relevant.
- Regression coverage exists for prior behavior.
- Observability is sufficient for operations and debugging.
- User-visible docs or developer docs are updated where needed.
- Risky paths are feature-flagged or guarded.
- Review checklist is complete.
- Any introduced technical debt is either resolved in the same phase or tracked with owner and target phase.

---

## Quality Gates

Every phase must pass four gates:

### 1. Spec Gate

- Contract is written.
- Ambiguities are documented.
- Acceptance criteria are testable.

### 2. Test Gate

- New behavior has failing-first coverage.
- No test relies on manual verification alone.
- Golden fixtures are updated if output behavior changed intentionally.

### 3. Review Gate

- Peer review completed.
- High-risk changes receive architecture review.
- Prompt / model behavior changes receive product-quality review.

### 4. Rollout Gate

- Feature flag exists for risky behavior.
- Rollback is documented and tested.
- Known limitations are recorded.

---

## Review Model

### Required Reviews

Each implementation phase requires:

- **Architecture review**
  - module boundaries
  - transport choices
  - rollback strategy

- **API contract review**
  - request shape
  - response shape
  - streaming semantics
  - error mapping

- **Prompt / policy review**
  - instruction layering
  - schema rigidity
  - evidence rules

- **Security / privacy review**
  - API key handling
  - data leaving the app
  - PII redaction behavior

- **Test review**
  - fixture quality
  - regression gaps
  - flakiness risks

### Review Exit Criteria

- No unresolved P0 or P1 review findings.
- Any accepted risk is explicitly documented.
- Follow-up work has owner and due phase.

---

## Technical Debt Cycle

### Debt Budget

Reserve approximately 20% of each phase for cleanup and convergence.

### Stabilization Cadence

After every two implementation phases, schedule one stabilization slice focused only on quality and debt reduction.

### Allowed Temporary Debt

Temporary debt is allowed only if all of the following are true:

- It is documented in the phase section.
- It has an owner.
- It has a target removal phase.
- It does not weaken rollback or correctness guarantees.

### Debt Checklist

Each stabilization slice must review:

- duplicate request builders
- duplicate response parsers
- model-family string matching
- feature-flag sprawl
- dead fallback branches
- prompt duplication
- inconsistent logging / telemetry
- inconsistent error text

---

## Eval Strategy

This initiative must be driven by a maintained fixture set and rubric, not subjective impressions.

### Golden Fixture Set

Create a crash-analysis fixture corpus under:

- `tests/fixtures/crash-analysis/`

Minimum categories:

- Small clean crash log
- Large crash log with raw walkback
- Ambiguous root cause
- Memory-heavy issue
- Database-heavy issue
- WHATS'ON namespace-heavy issue
- Similar-known-historical-case issue
- Noisy / low-signal issue
- Sentry-like event payload
- Regression fixture for previously misanalyzed cases

### Eval Rubric

Score each output on:

- Root-cause correctness
- Evidence use
- Actionability of remediation
- Hallucination / unsupported claims
- Schema compliance
- Latency
- Token / cost profile

### Eval Matrix

Every major milestone compares:

- Current baseline model on current single-shot path
- Codex-family model on current single-shot path
- Codex-family model on new agent path

---

## Phase 0: Planning And Baseline

### Objective

Create the spec, fixture corpus, and scoring harness before changing transport or behavior.

### Stories

#### Story 0.1: Write the canonical design/spec

**Deliverable**

- New design/spec section in this document or sibling design doc if later split.

**Acceptance Criteria**

- Current and target flows are documented.
- Risks and non-goals are explicit.
- Rollout flags are named.

**Suggested Files**

- `docs/plans/2026-04-16-codex-crash-analysis-spec-driven-implementation.md`

#### Story 0.2: Create crash-analysis fixture set

**Deliverable**

- Fixture files and rubric metadata.

**Acceptance Criteria**

- At least 25 representative fixtures.
- Each fixture has expected qualitative rubric targets.
- Each fixture is tagged by category.

**Suggested Files**

- `tests/fixtures/crash-analysis/*.txt`
- `tests/fixtures/crash-analysis/*.json`

#### Story 0.3: Add baseline eval harness

**Deliverable**

- Test or script harness that can compare multiple model/workflow variants.

**Acceptance Criteria**

- Can run current path against fixture set.
- Produces report artifact or machine-readable summary.
- Baseline report checked in or generated in CI artifact form.

**Suggested Files**

- `src-tauri/src/bin/` or `scripts/`
- `tests/README.md`

### Phase 0 DoR

- OpenAI model/transport assumptions re-verified.
- Fixture categories agreed.

### Phase 0 DoD

- Fixture set exists.
- Baseline scores exist.
- No implementation changes to transport or prompts required yet.

---

## Phase 1: OpenAI Transport Refactor

### Objective

Support OpenAI Responses API cleanly without breaking current OpenAI usage.

### Scope

- Introduce transport abstraction for OpenAI.
- Keep Anthropic / Z.ai / local providers unchanged initially.
- Normalize model capability routing.

### Stories

#### Story 1.1: Introduce transport capability model

**Deliverable**

- Central model capability rules that answer:
  - does this model require Responses?
  - does this model support tool use on this path?
  - what token parameter conventions apply?

**Acceptance Criteria**

- Capability logic is not scattered across multiple builder functions.
- Existing GPT-4.x and GPT-4o paths remain valid.

**Suggested Files**

- `src-tauri/src/ai_service.rs`
- optional new module: `src-tauri/src/ai_transport.rs`

**Tests**

- unit tests for model-family routing

#### Story 1.2: Add OpenAI Responses request builder

**Deliverable**

- Builder for non-streaming and streaming Responses requests.

**Acceptance Criteria**

- Supports structured final output and tool-aware interactions.
- Handles model-specific parameters consistently.

**Tests**

- request JSON contract tests
- regression tests for existing chat-completions builder

#### Story 1.3: Add OpenAI Responses streaming parser

**Deliverable**

- Parser for streamed response events into Hadron’s internal stream model.

**Acceptance Criteria**

- Text streaming works.
- Tool events can be reconstructed.
- Error states are surfaced consistently.

**Tests**

- SSE / event parsing unit tests
- malformed event regression tests

#### Story 1.4: Add fallback and rollback routing

**Deliverable**

- Runtime routing that can fall back to current transport behind flags.

**Acceptance Criteria**

- Transport choice can be switched off safely.
- Existing OpenAI chat path remains functional.

### Phase 1 DoR

- Baseline harness is green.
- Request/response contracts are written.

### Phase 1 DoD

- `gpt-5.1-codex` or equivalent Codex-family models can be reached through supported routing.
- Existing OpenAI regression suite stays green.
- No frontend breakage.

### Phase 1 Technical Debt Watchlist

- duplicated OpenAI request builders
- multiple GPT-family special cases
- split streaming logic

---

## Phase 2: Crash Analysis Agent Workflow

### Objective

Add a new crash-analysis agent mode that iteratively gathers evidence before producing the final structured analysis.

### Scope

- Reuse existing chat agent patterns where possible.
- Do not remove the single-shot workflow yet.

### Agent Workflow Target

1. Parse crash metadata and sections.
2. Form an initial working hypothesis.
3. Decide what evidence is missing.
4. Call internal tools for more evidence.
5. Assess evidence sufficiency.
6. Produce final structured output.

### Stories

#### Story 2.1: Define crash-analysis internal tools

**Deliverable**

- Tool contract list for crash analysis.

**Candidate Tools**

- stack trace summarizer
- parser section extractor
- environment summary
- DB/session summary
- memory summary
- similar case search
- KB / release-note lookup
- signature lookup

**Acceptance Criteria**

- Each tool has input schema and output schema.
- Outputs are deterministic enough for tests.

**Suggested Files**

- `src-tauri/src/chat_tools.rs`
- optional new module: `src-tauri/src/crash_analysis_tools.rs`

#### Story 2.2: Add crash agent loop

**Deliverable**

- Agent loop specialized for crash analysis.

**Acceptance Criteria**

- Maximum iteration count enforced.
- Timeouts enforced.
- Tool traces recorded.
- Final synthesis uses collected evidence, not raw prompt alone.

**Tests**

- iteration cap tests
- tool execution order tests
- fallback tests

#### Story 2.3: Add evidence sufficiency gate

**Deliverable**

- Policy deciding whether enough evidence exists to answer.

**Acceptance Criteria**

- Final answer is blocked from premature synthesis when evidence is insufficient.
- Gate behavior is testable and logged.

**Suggested Files**

- `src-tauri/src/retrieval/evidence_gate.rs`

#### Story 2.4: Maintain single-shot fallback

**Deliverable**

- Feature-flagged fallback path for regressions and rollout safety.

**Acceptance Criteria**

- Operator can disable agent path without code changes.

### Phase 2 DoR

- Transport layer supports target model.
- Tool contracts are written.

### Phase 2 DoD

- Crash analysis agent mode runs end-to-end.
- Tool traces are visible in logs or diagnostics.
- Existing saved-analysis data model remains compatible.

### Phase 2 Technical Debt Watchlist

- duplicated tool schemas between chat and crash analysis
- two independent evidence policies
- duplicated streaming orchestration

---

## Phase 3: Prompt Modularization And Policy Cleanup

### Objective

Replace oversized rigid prompts with composable policy modules so the model can investigate first and structure output last.

### Scope

- Keep structured output.
- Reduce prompt duplication.
- Move schema constraints to final synthesis stage where possible.

### Stories

#### Story 3.1: Split prompt layers

**Deliverable**

- Layered prompt modules:
  - domain role
  - investigation policy
  - tool policy
  - output policy

**Acceptance Criteria**

- Large prompt blobs are reduced.
- Prompt modules are reusable.

#### Story 3.2: Final synthesis schema contract

**Deliverable**

- One final-schema policy per analysis mode, instead of schema pressure across the whole workflow.

**Acceptance Criteria**

- Final outputs remain parseable.
- Intermediate reasoning/tool turns are no longer forced into end-state schema format.

#### Story 3.3: Malformed output recovery

**Deliverable**

- Recovery behavior for incomplete or malformed structured output.

**Acceptance Criteria**

- Parse failures are logged clearly.
- Recovery path is test-covered.

### Phase 3 DoR

- Agent workflow is operational behind flag.

### Phase 3 DoD

- Prompt duplication reduced materially.
- Final schema tests stay green.
- Hallucination rate does not regress on eval set.

### Phase 3 Technical Debt Watchlist

- legacy prompts left unused
- divergent schema names across modes

---

## Phase 4: Settings, Capabilities, And UX Exposure

### Objective

Expose the new model/workflow options safely in the UI and configuration.

### Stories

#### Story 4.1: Model capability metadata in frontend

**Deliverable**

- Model metadata indicating transport/workflow suitability.

**Acceptance Criteria**

- Unsupported model-path combinations are not silently selectable.
- Defaults are capability-aware.

**Suggested Files**

- `src/constants/providers.ts`
- `src/components/SettingsPanel.tsx`
- `src/services/api.ts`

#### Story 4.2: Feature flags and diagnostics

**Deliverable**

- Diagnostics telling the user or developer which path was used.

**Acceptance Criteria**

- Analysis records show model and provider as before.
- Debug logs reveal transport and workflow choice.

#### Story 4.3: Candidate default rollout

**Deliverable**

- Configurable candidate default for Codex-family model without forced migration.

**Acceptance Criteria**

- Existing users are not unexpectedly broken.
- New default can be reverted quickly.

### Phase 4 DoR

- Backend path stable on eval subset.

### Phase 4 DoD

- UI can express capability-aware choice.
- Feature flags and diagnostics are usable.

---

## Phase 5: Quality Validation And Default Decision

### Objective

Decide whether the Codex-style path should become the default for crash analysis.

### Stories

#### Story 5.1: Full eval run

**Deliverable**

- Full quality comparison across target variants.

**Acceptance Criteria**

- Report includes correctness, evidence use, hallucination rate, latency, and cost.

#### Story 5.2: Rollback rehearsal

**Deliverable**

- Documented and tested rollback from agent path and from Responses path.

**Acceptance Criteria**

- Rollback requires only configuration/flag change.

#### Story 5.3: Default decision ADR

**Deliverable**

- Written decision record:
  - stay experimental
  - default for opt-in only
  - make default

**Acceptance Criteria**

- Decision cites eval evidence.
- Remaining risks are documented.

### Phase 5 DoR

- All preceding phase gates passed.

### Phase 5 DoD

- Default decision made from evidence.
- Rollback validated.

---

## Testing Strategy

### Unit Tests

Add or extend unit coverage for:

- model capability routing
- request builders
- response parsers
- tool parsing
- evidence sufficiency logic
- malformed output recovery

### Integration Tests

Add or extend integration coverage for:

- crash analysis command flow
- transport selection
- persistence compatibility
- feature-flag fallback

### Eval / Fixture Tests

Add or extend reproducible fixture-based tests for:

- output schema
- evidence usage
- large-input handling
- regression cases

### Suggested Test Locations

- `src/utils/*.test.ts`
- `src/hooks/*.test.ts`
- `src/components/**/*.test.tsx`
- `src-tauri` Rust unit tests in module files
- new fixture corpus under `tests/fixtures/crash-analysis/`

---

## Operational Metrics

Track at minimum:

- transport used
- workflow used
- model used
- total latency
- tool-call count
- evidence sufficiency result
- parse failure count
- fallback count
- cost / token estimates

---

## Rollout Strategy

### Stage 1

- Hidden behind feature flags
- Dev / maintainer only

### Stage 2

- Opt-in for advanced users
- Baseline comparison enabled

### Stage 3

- Candidate default for new users only

### Stage 4

- Full default only if eval evidence is positive and rollback is proven

---

## Risks

### Risk 1: Model improvement without workflow improvement is underwhelming

Mitigation:

- Measure single-shot Codex vs agentic Codex separately.

### Risk 2: Responses integration adds complexity faster than value

Mitigation:

- Keep existing OpenAI route intact during rollout.

### Risk 3: Prompt modularization destabilizes parseability

Mitigation:

- Keep schema enforcement at final synthesis and protect with golden tests.

### Risk 4: Cost or latency rises too much

Mitigation:

- Track cost/latency in evals and require explicit approval for default switch.

### Risk 5: Technical debt accumulates across dual paths

Mitigation:

- Enforce stabilization slice after every two implementation phases.

---

## Release Criteria

The Codex-style path may become the default only if all of the following are true:

- Full relevant test suite is green.
- Eval results are better than current default on agreed quality metrics.
- No major parseability regression exists.
- Rollback has been rehearsed successfully.
- Technical debt from the rollout is acceptable or explicitly scheduled.

---

## Initial Backlog

### Epic A: Planning And Eval

- A1 Write final spec sections
- A2 Create fixture corpus
- A3 Add eval harness

### Epic B: OpenAI Transport

- B1 Capability routing
- B2 Responses request builder
- B3 Responses streaming parser
- B4 Fallback routing

### Epic C: Crash Agent

- C1 Tool contracts
- C2 Crash-analysis agent loop
- C3 Evidence gate integration
- C4 Fallback path

### Epic D: Prompt And Policy Cleanup

- D1 Prompt modularization
- D2 Final synthesis contracts
- D3 Malformed output recovery

### Epic E: Rollout

- E1 Settings and diagnostics
- E2 Candidate default flag
- E3 Full eval and decision ADR

---

## References

- OpenAI model docs: https://developers.openai.com/api/docs/models
- OpenAI GPT-5.1 Codex docs: https://developers.openai.com/api/docs/models/gpt-5.1-codex
- OpenAI Codex use cases: https://developers.openai.com/codex/use-cases
- OpenAI Codex repository: https://github.com/openai/codex
