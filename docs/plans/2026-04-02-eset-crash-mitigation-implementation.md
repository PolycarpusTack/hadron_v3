# ESET Crash Mitigation Implementation Plan (Without Depending on Whitelisting)

**Date:** 2026-04-02
**Owner:** Hadron Desktop maintainer
**Scope:** hadron-desktop (Tauri 2 + WebView2 + Rust + React)

## 1. Why this plan exists

Whitelisting the app in ESET can reduce crashes, but it is not a complete product fix.

Main reason:
- The app currently generates a very high volume of native-to-WebView IPC events.
- On Windows, `app.emit(...)` in Tauri/WebView2 crosses a COM boundary.
- Security products (ESET now, potentially others later) inspect/hook this path.
- High call rate plus concurrent emissions increases re-entrancy and hook instability risk.

So the long-term fix is:
1. Reduce event volume.
2. Add guardrails and observability.
3. Move high-frequency paths away from global event emit.
4. Keep code signing as defense in depth.

## 2. Existing code references (where the issue is amplified)

High-frequency emit points:
- `hadron-desktop/src-tauri/src/ai_service.rs` — `call_provider_streaming(...)` emits `chat-stream` for every token-like SSE chunk (~lines 1570-1636).
- `hadron-desktop/src-tauri/src/commands/common/helpers.rs` — `emit_progress(...)` wraps `app.emit("analysis-progress", ...)` (~lines 11-14).
- `hadron-desktop/src-tauri/src/commands/ai.rs` — Many calls to `emit_progress(...)` across one analysis path.
- `hadron-desktop/src-tauri/src/ai_service.rs` — `PARALLEL_CHUNK_LIMIT = 4` in deep scan path multiplies concurrent activity (~line 2716).

Related stability context:
- `hadron-desktop/src-tauri/Cargo.toml` — Contains tao patch for Windows re-entrancy issue (flush_paint_messages).

## 3. Implementation strategy (ordered)

### Phase P0 (do first, low risk, highest value)

#### Step P0.1: Debounce analysis-progress emission

**Goal:** Cut progress event spam while preserving user feedback.

**Changes:**
- File: `hadron-desktop/src-tauri/src/commands/common/helpers.rs`
- Introduce a global timestamp gate for non-terminal progress events.
- Always emit `Complete` and `Error` immediately.
- For other phases, emit at most once per 150ms.

**Acceptance criteria:**
- Progress bar still updates.
- Event frequency drops visibly.
- No UX regression in terminal states.

#### Step P0.2: Batch streaming tokens before emit

**Goal:** Remove the largest IPC burst source (`chat-stream` per token).

**Changes:**
- File: `hadron-desktop/src-tauri/src/ai_service.rs`
- In `call_provider_streaming(...)`, buffer tokens and emit batched text.
- Flush on either: every 8 tokens or 96 chars, or stream completion.
- Also batch `emit_text_as_stream` in `chat_commands.rs` (increase chunk size from 80 to 500 chars).

**Why this is safe:** Frontend already appends incoming token text (`streamingContentRef.current += event.token`). A batched token string behaves the same functionally.

**Acceptance criteria:**
- Streaming UX still feels real-time.
- Call rate is significantly reduced.
- No missing text in final response.

#### Step P0.3: Add SSE buffer hard guard

**Goal:** Prevent memory blow-up if malformed SSE never sends newline separators.

**Changes:**
- File: `hadron-desktop/src-tauri/src/ai_service.rs`
- After `buffer.push_str(...)`, add 2MB max cap.

**Acceptance criteria:**
- No unbounded growth path remains in streaming parser.

### Phase P1 (observability so you can prove the fix)

#### Step P1.1: Add IPC rate counters

**Goal:** Measure actual event pressure in production.

**Changes:**
- File: `hadron-desktop/src-tauri/src/commands/common/helpers.rs` — `PROGRESS_EMIT_COUNT` atomic counter.
- File: `hadron-desktop/src-tauri/src/ai_service.rs` — `STREAM_EMIT_COUNT` atomic counter + per-request logging.
- Log total emits and chars per streaming request.

**Acceptance criteria:**
- Logs show before/after emit-rate reduction.

### Phase P2 (architectural hardening)

#### Step P2.1: Move chat-stream from global events to Channel API

**Goal:** Reduce dependency on global event path for high-frequency streaming.

**Changes:**
- Rust: `chat_commands.rs` / `ai_service.rs` — command receives a channel handle and uses `channel.send(...)`.
- Frontend: `hadron-desktop/src/services/chat.ts`, `hadron-desktop/src/components/AskHadronView.tsx` — create channel, pass it in invoke, consume stream messages from channel.

**Suggested migration approach:**
1. Keep old event path for fallback behind feature flag.
2. Add new channel path and enable by default in dev builds.
3. Remove old path after validation.

**Acceptance criteria:**
- Stream works end-to-end on channel path.
- Event bus load drops further.

#### Step P2.2: Replace push progress with pull polling (optional but robust)

**Goal:** Eliminate `analysis-progress` event path entirely.

**Changes:**
- Rust: store latest progress in managed state (`Arc<RwLock<AnalysisProgress>>`), expose `get_analysis_progress` command.
- Frontend: `AnalysisProgressBar.tsx` — poll every 200ms while analysis is active.

**Acceptance criteria:**
- No progress event emissions required.
- Progress still feels responsive.

### Phase P3 (enterprise trust hardening)

#### Step P3.1: Commercial code signing

**Goal:** Reduce aggressive AV/EDR hooking on unsigned/low-reputation binaries.

**Action:**
- Use commercial CA certificate for release builds.
- Keep self-signed cert only for local dev/testing.
- Update `hadron-desktop/scripts/create-signing-cert.ps1` with explicit warning.

**Acceptance criteria:**
- Release pipeline signs with CA cert.
- Binary reputation and AV trust improves over time.

## 4. Verification checklist

**Functional:**
- Chat streaming text remains complete and ordered.
- Progress bar still communicates stage changes.
- No regression in analysis completion time.

**Stability:**
- On affected Dell/ESET machine, crash frequency drops after P0 changes.
- Emit rate observed in logs moves from very high burst mode to controlled mode.

**Technical:**
- Streaming parser no longer allows unbounded buffer growth.
- No new panics introduced in emit path.

**Operational:**
- Release signing process documented and repeatable.
- Incident logs include enough data to compare environments.

## 5. Notes for implementation simplicity

Keep this practical:
- Start with P0 only. It gives most of the value quickly.
- Avoid large refactors before measuring the impact of call reduction.
- Use feature flags for P2 changes so rollback is easy.

If you can only do one change now, do P0.2 (stream batching). It is the biggest call-volume reducer.
