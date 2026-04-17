# Plan: replace JSON-parsed tool use with provider-native tool calling (F8)

**Date:** 2026-04-17
**Owner:** TBD
**Security source:** `security-mgx-tools_wrc-ai-analyzer-retest-2026-04-15.md` finding F8
**Status:** Draft — not started

## 1. Problem

The chat agent loop asks the model to emit tool invocations as free-text JSON
embedded in the assistant message:

```
To use a tool, respond with ONLY a JSON block: {"tool_use": {"name": "...", "arguments": {...}}}
```

The server then parses that text (`extract_tool_call` at `hadron-web/crates/hadron-server/src/routes/chat.rs:542`)
and executes whichever tool the model names (`execute_tool` at `hadron-web/crates/hadron-server/src/ai/tools.rs`).

This pattern is exploitable by prompt injection: if any retrieved document, JIRA ticket,
OpenSearch result, or knowledge-base snippet contains a crafted string that primes the
model to emit a `{"tool_use": ...}` block, the server will execute that tool without
the user asking for it. Evidence-sufficiency caps and iteration limits reduce blast
radius but do not close the class of bug.

The retest dropped this finding from the April-15 report, but the code pattern is still
present and the risk still applies. See retest report §Not Remediated / F8.

## 2. Goal

Stop parsing tool calls out of prose. Use the provider's native tool-calling API so:

- Tool call intent is a structured field in the API response, not a string pattern.
- Unknown / malformed tool calls cause a typed error, not a silent execution.
- Tool arguments validate against a JSON schema before execution.
- Prompt content cannot forge a tool call because prompt content never reaches the
  same channel as the structured tool-call output.

## 3. Current state (what we have)

- `ai/mod.rs::complete` returns `HadronResult<String>` — no tool calls surfaced.
- `ai/mod.rs::stream_completion` streams plain text tokens.
- `routes/chat.rs::run_agent_loop` calls `complete`, runs `extract_tool_call` on the
  text, executes the tool, appends both the raw assistant text and a
  `<tool_result>`-wrapped user message, and repeats up to `MAX_AGENT_ITERATIONS`.
- `ai::tools::chat_tools()` already returns `ToolDefinition { name, description, parameters }`
  where `parameters` is a JSON schema — directly usable by OpenAI and Anthropic tool APIs.
- `AgentState` tracks evidence tokens, iterations, and stop conditions; not tied to
  the parsing approach and can be reused.

## 4. Target architecture

### 4.1 New domain types (in `hadron-core::ai` or `hadron-server::ai`)

```rust
pub enum AiTurn {
    Message(String),                    // final prose response
    ToolCalls(Vec<AiToolCall>),         // structured tool invocations
}

pub struct AiToolCall {
    pub id: String,                     // provider-assigned id (echoed back in result)
    pub name: String,
    pub arguments: serde_json::Value,
}

pub enum AiMessage {
    System(String),
    User(String),
    Assistant { text: Option<String>, tool_calls: Vec<AiToolCall> },
    ToolResult { tool_call_id: String, name: String, content: String },
}
```

The existing flat `AiMessage { role, content }` is replaced. All call sites migrate.

### 4.2 New transport API

```rust
pub async fn complete_with_tools(
    config: &AiConfig,
    messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
    tools: &[ToolDefinition],
) -> HadronResult<AiTurn>;

pub async fn stream_completion_with_tools(
    config: &AiConfig,
    messages: Vec<AiMessage>,
    system_prompt: Option<&str>,
    tools: &[ToolDefinition],  // may be empty for final synthesis call
    tx: mpsc::Sender<ChatStreamEvent>,
) -> HadronResult<AiTurn>;
```

The existing `complete` and `stream_completion` stay for non-chat callers (analysis,
compliance, release-notes gen) — those don't use tools and don't need the refactor.

### 4.3 Provider mapping

**OpenAI** (`/v1/chat/completions`):
- Add `tools: [{ type: "function", function: { name, description, parameters } }]`.
- Add `tool_choice: "auto"`.
- Response `choices[0].message` carries optional `tool_calls: [{ id, type, function: { name, arguments } }]`.
- `arguments` is a string — parse as JSON.
- Tool result turns: role `"tool"` with `tool_call_id` + `content`.

**Anthropic** (`/v1/messages`):
- Add top-level `tools: [{ name, description, input_schema }]`.
- Response `content` is an array; each item is `{ type: "text", ... }` or
  `{ type: "tool_use", id, name, input }`.
- Tool result turns: user message with `content: [{ type: "tool_result", tool_use_id, content }]`.

Provider-specific request/response structs in `ai/mod.rs`; `to_openai_messages` and
`to_anthropic_messages` convert the canonical `AiMessage` enum.

### 4.4 New agent loop (replaces `run_agent_loop` in `chat.rs`)

```
loop iteration < MAX:
    turn = stream_completion_with_tools(config, messages, system, tools, tx)
    match turn:
        Message(text):
            save + done
            return
        ToolCalls(calls):
            for call in calls:
                send ToolUse event
                result = execute_tool(pool, user_id, &call.name, &call.arguments)
                send ToolResult event
                record in AgentState
                append AiMessage::Assistant { text: None, tool_calls: vec![call] }
                append AiMessage::ToolResult { tool_call_id: call.id, name, content }
            if AgentState::should_stop(): break to synthesis

synthesis:
    final = stream_completion_with_tools(config, messages, system, &[], tx)
    save + done
```

Remove:
- The "respond with ONLY a JSON block" fragment from the system prompt.
- `extract_tool_call` and `ToolCallRequest` in `chat.rs`.
- The `<tool_result>` string-wrapping.

Keep:
- `AgentState` evidence tracking.
- `MAX_AGENT_ITERATIONS`.
- `ChatStreamEvent::{ToolUse, ToolResult, Token, Done, Error}` (wire format unchanged).

## 5. Migration strategy

1. **Core types:** add the new `AiMessage` / `AiTurn` / `AiToolCall` types alongside
   the current ones. Don't delete the old ones yet.
2. **Transport:** implement `complete_with_tools` + `stream_completion_with_tools`
   for both providers behind the new types. Unit-test response parsing with
   recorded fixtures (both "message" and "tool_calls" shapes, both providers).
3. **Chat route:** port `run_agent_loop` to use the new transport. Delete
   `extract_tool_call` and the JSON-emission instructions.
4. **Clean up:** once chat is migrated and all tests pass, remove the old
   `AiMessage { role, content }` shape and migrate remaining callers
   (analysis / compliance / release-notes-gen) to the new canonical shape,
   or keep a simpler shim for non-tool callers.
5. **Rip out:** delete `extract_tool_call`, `ToolCallRequest`, and the JSON
   instruction text from the system prompt.

## 6. Test strategy

- **Unit:** parser tests for OpenAI tool_calls envelope, Anthropic tool_use blocks,
  both the "text only" and "tool call only" and "text + tool call" (Anthropic can
  mix) cases. Include a malformed-arguments case — must surface a typed error.
- **Integration:** one recorded-fixture test per provider driving a two-turn
  conversation (one tool call, then final message) through `run_agent_loop`
  against a fake transport. Assert the `ChatStreamEvent` sequence.
- **Regression:** add a prompt-injection test — seed retrieved context with the
  old `{"tool_use": ...}` pattern and assert no tool execution happens. This is
  the security test that closes F8.
- **Existing:** all 121 `hadron-core` tests and the 12 `hadron-server` tests must
  still pass.

## 7. Risks & open questions

- **Multi-tool-call per turn** (Anthropic allows multiple `tool_use` blocks in one
  response; OpenAI's tool_calls is also an array). Loop must handle N calls
  before the next model round-trip. Straightforward but not what the current
  code does — today it executes one tool per iteration.
- **Streaming tool calls.** Both providers stream tool-call JSON in deltas.
  Simplest v1 approach: buffer the full assistant turn non-streamed, then
  stream only the *final* synthesis response. This preserves the existing
  UX (user sees tokens for the final answer, sees `ToolUse`/`ToolResult`
  events for intermediate steps). More complex alternative is to stream
  final prose mid-turn when the model emits text before a tool call.
- **Backward compat on persisted chat history.** `db::save_chat_message`
  currently takes `role` + `content` strings. Decide whether to persist
  tool-call turns, and if so in what shape. Safest: persist final
  assistant message content only, same as today.
- **Provider availability / model coverage.** Tool calling requires a recent
  model on both providers. Config validation must reject unsupported models
  before the chat starts.
- **Error path:** when the model returns an unknown tool name, return a
  typed error tool-result (`"unknown tool"`) rather than silently skipping,
  so the model can recover.

## 8. Out of scope

- Human-in-the-loop confirmation for tool execution (separate UX decision).
- Per-tool allowlist based on user role (separate authz layer).
- Provider-abstract tool caching or memoization.
- Changing the set of tools or their parameters.

## 9. Acceptance criteria

- `extract_tool_call` and the JSON-emission instructions in the system prompt
  are deleted.
- Both providers go through a structured tool-calling API.
- Regression test proves that injected `{"tool_use": ...}` strings in tool
  output or retrieval context do not trigger tool execution.
- All existing test suites still pass.
- No new lints; `cargo check` and `cargo clippy` clean.
