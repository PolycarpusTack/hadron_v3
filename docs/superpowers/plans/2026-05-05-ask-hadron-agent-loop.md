# Ask Hadron Agent Loop + CodexMgX Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the full Tauri agentic tool-use loop to Electron, implement all 20+ chat tools (native DB + JIRA), integrate the CodexMgX MCP server as a tool source, and fix the 5 known runtime bugs in Ask Hadron.

**Architecture:** The agent loop lives entirely in `electron/ipc/chat.ts` — it iterates up to 5 times, calling the LLM with tools (non-streaming), executing all tool calls in parallel, then doing a final streaming synthesis call. Tool implementations are in `electron/services/chat-tools.ts`. The CodexMgX MCP server is spawned as a child PowerShell process by `electron/services/mcp-client.ts`; its tools (JIRA investigation, Confluence, MOD docs, KB) are transparently added to the agent's tool registry when available. AI provider tool-calling is handled by two new functions in `electron/services/ai-service.ts`.

**Tech Stack:** TypeScript, better-sqlite3 (via `getDb()`), node-fetch, `@anthropic-ai/sdk`, Electron child_process, JSON-RPC 2.0 over stdio, existing `jira-client.ts` for JIRA API calls.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `electron/services/ai-service.ts` | Modify | Add `callAiWithTools()`, `callAiStreaming()`, tool-call message builders |
| `electron/services/chat-tools.ts` | Create | Tool definitions + executor (native DB + JIRA) |
| `electron/services/mcp-client.ts` | Create | CodexMgX MCP stdio client; lazy spawn + JSON-RPC |
| `electron/ipc/chat.ts` | Modify | Full agent loop in `chat_send`; fix stream-state singleton; fix `chat_delete_feedback` |
| `electron/ipc/settings.ts` | Modify | Add `get_codexmgx_config` / `save_codexmgx_config` handlers |
| `src/components/SettingsPanel.tsx` | Modify | Add CodexMgX settings section |
| `src/services/secure-storage.ts` | No change needed | Already stores arbitrary provider keys |

---

## Task 1: AI Service — Tool-Calling Support

Add two new exported functions to `electron/services/ai-service.ts`:
- `callAiWithTools()` — non-streaming LLM call that returns tool calls or final text
- `callAiStreaming()` — streaming LLM call for the synthesis step; replaces ad-hoc `onChunk` usage in the agent

Also add shared types for tool-calling messages that the agent loop and the message builders both use.

**Files:**
- Modify: `electron/services/ai-service.ts`

- [ ] **Step 1: Add shared tool-calling types**

Append to the top of `electron/services/ai-service.ts` (after the existing `AiCallResult` interface):

```typescript
// ── Tool-calling types ──────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolUseId: string
  content: string
  isError: boolean
}

/** Returned by callAiWithTools. Either wantsTools=true (with toolCalls) or text output. */
export interface AiToolCallResult {
  wantsTools: boolean
  toolCalls: ToolCall[]
  /** Raw assistant message to append to conversation (provider-specific shape). */
  assistantMessage: unknown
  /** Final text if wantsTools=false. */
  content: string
  inputTokens: number
  outputTokens: number
}

/** Build provider-appropriate tool-result messages to append after tool execution. */
export function buildToolResultMessages(
  results: ToolResult[],
  provider: string,
): unknown[] {
  if (provider === 'anthropic') {
    return [{
      role: 'user',
      content: results.map(r => ({
        type: 'tool_result',
        tool_use_id: r.toolUseId,
        content: r.content,
        is_error: r.isError,
      })),
    }]
  }
  // OpenAI / ZAI / fallback: one message per result
  return results.map(r => ({
    role: 'tool',
    tool_call_id: r.toolUseId,
    content: r.content,
  }))
}
```

- [ ] **Step 2: Add `callAiWithTools()` for Anthropic**

Append after `buildToolResultMessages`:

```typescript
async function callAiWithToolsAnthropic(opts: {
  messages: unknown[]
  tools: ToolDefinition[]
  systemPrompt: string
  model: string
  apiKey: string
  maxTokens?: number
}): Promise<AiToolCallResult> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const anthropicTools = opts.tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
  const msgs = (opts.messages as Array<{ role: string; content: unknown }>)
    .filter(m => m.role !== 'system')

  const resp = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4000,
    system: opts.systemPrompt,
    messages: msgs as Parameters<typeof client.messages.create>[0]['messages'],
    tools: anthropicTools as Parameters<typeof client.messages.create>[0]['tools'],
  })

  const wantsTools = resp.stop_reason === 'tool_use'
  const toolCalls: ToolCall[] = wantsTools
    ? resp.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, arguments: b.input as Record<string, unknown> }))
    : []
  const content = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  // Build the assistant message to re-append (preserves tool_use blocks)
  const assistantMessage = { role: 'assistant', content: resp.content }

  return {
    wantsTools,
    toolCalls,
    assistantMessage,
    content,
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
  }
}
```

- [ ] **Step 3: Add `callAiWithTools()` for OpenAI**

Append after step 2:

```typescript
async function callAiWithToolsOpenAi(opts: {
  messages: unknown[]
  tools: ToolDefinition[]
  systemPrompt: string
  model: string
  apiKey: string
  maxTokens?: number
}): Promise<AiToolCallResult> {
  const { default: fetch } = await import('node-fetch')
  const openAiMessages = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.messages as Array<{ role: string; content: unknown }>).filter(m => m.role !== 'system'),
  ]
  const openAiTools = opts.tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4000,
      messages: openAiMessages,
      tools: openAiTools,
      tool_choice: 'auto',
    }),
  })
  if (!res.ok) throw new Error(`OpenAI tool-call error ${res.status}: ${await res.text()}`)
  const data = await res.json() as {
    choices: Array<{
      finish_reason: string
      message: {
        role: string
        content: string | null
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
      }
    }>
    usage: { prompt_tokens: number; completion_tokens: number }
  }
  const choice = data.choices[0]
  const wantsTools = choice.finish_reason === 'tool_calls'
  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map(tc => ({
    id: tc.id,
    name: tc.function.name,
    arguments: (() => { try { return JSON.parse(tc.function.arguments) } catch { return {} } })(),
  }))
  return {
    wantsTools,
    toolCalls,
    assistantMessage: { role: 'assistant', content: choice.message.content, tool_calls: choice.message.tool_calls },
    content: choice.message.content ?? '',
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  }
}
```

- [ ] **Step 4: Add public `callAiWithTools()` dispatcher + `callAiStreaming()`**

Append after step 3:

```typescript
/** Non-streaming LLM call with tool support. Used in the agent loop. */
export async function callAiWithTools(opts: {
  provider: string
  model: string
  apiKey: string
  systemPrompt: string
  messages: unknown[]
  tools: ToolDefinition[]
  maxTokens?: number
}): Promise<AiToolCallResult> {
  if (opts.provider === 'anthropic') return callAiWithToolsAnthropic(opts)
  // OpenAI, ZAI, llamacpp — all use chat/completions tool format
  return callAiWithToolsOpenAi(opts)
}

/**
 * Streaming synthesis call — no tool definitions, just streams the final answer.
 * Calls onChunk for each token. Returns full content on completion.
 */
export async function callAiStreaming(opts: {
  provider: string
  model: string
  apiKey: string
  systemPrompt: string
  messages: unknown[]
  maxTokens?: number
  onChunk: (text: string) => void
}): Promise<{ content: string; inputTokens: number; outputTokens: number; cost: number }> {
  // Reuse existing callAi with stream:true
  const result = await callAi({
    provider: opts.provider,
    model: opts.model,
    apiKey: opts.apiKey,
    systemPrompt: opts.systemPrompt,
    userPrompt: '',
    maxTokens: opts.maxTokens ?? 4096,
    stream: true,
    messages: opts.messages as Array<{ role: string; content: string }>,
    onChunk: opts.onChunk,
  })
  return { content: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost: result.cost }
}
```

- [ ] **Step 5: Type-check**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add electron/services/ai-service.ts
git commit -m "feat(chat): add tool-calling support to ai-service (callAiWithTools, callAiStreaming)"
```

---

## Task 2: Chat Tools Registry (Native DB + JIRA)

Create `electron/services/chat-tools.ts` with all 20 tool definitions and their implementations. This file is the TypeScript equivalent of the Tauri `chat_tools.rs`.

**Files:**
- Create: `electron/services/chat-tools.ts`

- [ ] **Step 1: Create file with tool context type and tool definitions**

Create `/mnt/c/Projects/Hadron_v3/hadron-electron/electron/services/chat-tools.ts`:

```typescript
import type { Database as BetterSqlite3 } from 'better-sqlite3'
import type { ToolDefinition, ToolResult } from './ai-service'
import { readJiraCreds, readJiraProjectKey, jiraFetch, readConfluenceCreds } from './jira-client'
import { ftsPhrase } from './db-helpers'
import log from 'electron-log'

export type { ToolDefinition, ToolResult }

export interface ToolContext {
  db: BetterSqlite3
  apiKey: string
  provider: string
  model: string
  wonVersion?: string | null
  customer?: string | null
  useKb: boolean
  useMcp: boolean
}

// ── Tool Definitions ────────────────────────────────────────────────────────

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'search_analyses',
      description: 'Search historical crash analyses by text query. Returns matching analyses ranked by relevance.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "NilReceiver PSI scheduling", "Oracle deadlock")' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Optional severity filter' },
          date_from: { type: 'string', description: 'Optional ISO-8601 start date (e.g., "2025-01-01")' },
          date_to: { type: 'string', description: 'Optional ISO-8601 end date (e.g., "2025-06-30")' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_analysis_detail',
      description: 'Get full details of a specific crash analysis by its ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The analysis ID number' },
        },
        required: ['id'],
      },
    },
    {
      name: 'find_similar_crashes',
      description: 'Find crashes similar to a given analysis. Matches by error type and component.',
      parameters: {
        type: 'object',
        properties: {
          analysis_id: { type: 'integer', description: 'The analysis ID to find similar crashes for' },
          limit: { type: 'integer', description: 'Max results (default 5)', default: 5 },
        },
        required: ['analysis_id'],
      },
    },
    {
      name: 'get_crash_signature',
      description: 'Look up a crash signature by hash and get all its occurrences. Use to check if a crash is a known issue.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'The signature hash (e.g., "a3f2b1c4d5e6")' },
        },
        required: ['hash'],
      },
    },
    {
      name: 'get_top_signatures',
      description: 'Get the most frequent crash signatures. Shows recurring crash patterns.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max results (default 10)', default: 10 },
          status: { type: 'string', enum: ['new', 'known', 'investigating', 'fixed', 'wont_fix'], description: 'Filter by status' },
        },
      },
    },
    {
      name: 'get_trend_data',
      description: 'Get crash trend analytics over a time period. Shows how many crashes occurred per day/week/month.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['day', 'week', 'month'], description: 'Grouping period' },
          range_days: { type: 'integer', description: 'Lookback window in days (default 30)', default: 30 },
        },
        required: ['period'],
      },
    },
    {
      name: 'get_error_patterns',
      description: 'Get the most common error types and their frequency.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max results (default 10)', default: 10 },
        },
      },
    },
    {
      name: 'get_statistics',
      description: 'Get overall database statistics: total analyses, severity breakdown, favorites count.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'correlate_crash_to_jira',
      description: 'Find JIRA tickets linked to a crash analysis.',
      parameters: {
        type: 'object',
        properties: {
          analysis_id: { type: 'integer', description: 'The analysis ID to find JIRA links for' },
        },
        required: ['analysis_id'],
      },
    },
    {
      name: 'get_crash_timeline',
      description: 'Build a chronological timeline of a crash signature showing all occurrences.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'The crash signature hash to trace' },
        },
        required: ['hash'],
      },
    },
    {
      name: 'compare_crashes',
      description: 'Compare two crash analyses side-by-side.',
      parameters: {
        type: 'object',
        properties: {
          analysis_id_a: { type: 'integer', description: 'First analysis ID' },
          analysis_id_b: { type: 'integer', description: 'Second analysis ID' },
        },
        required: ['analysis_id_a', 'analysis_id_b'],
      },
    },
    {
      name: 'get_component_health',
      description: 'Get a health summary for a WHATS\'ON component: total crashes, severity breakdown, most common errors.',
      parameters: {
        type: 'object',
        properties: {
          component: { type: 'string', description: 'Component name (e.g., "PSI", "Scheduling", "Oracle")' },
        },
        required: ['component'],
      },
    },
    {
      name: 'search_gold_answers',
      description: 'Search verified gold answers from previous investigations. Check here first before other sources.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to find relevant verified answers' },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_jira',
      description: 'Search JIRA issues by JQL query or text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'JQL query or text search' },
          max_results: { type: 'integer', description: 'Max results (default 5)', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_jira_ticket',
      description: 'Create a new JIRA ticket. Use when the user asks to file a bug or create a ticket.',
      parameters: {
        type: 'object',
        properties: {
          project_key: { type: 'string', description: 'JIRA project key (e.g., "PSI", "WON")' },
          summary: { type: 'string', description: 'Ticket summary/title' },
          description: { type: 'string', description: 'Detailed ticket description' },
          issue_type: { type: 'string', enum: ['Bug', 'Task', 'Story'], description: 'Issue type (default: Bug)' },
          priority: { type: 'string', enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'], description: 'Priority (default: Medium)' },
        },
        required: ['project_key', 'summary', 'description'],
      },
    },
    // Investigation tools — delegated to CodexMgX MCP when available
    {
      name: 'investigate_jira_ticket',
      description: 'Run a full investigation on a JIRA ticket. Returns changelog, comments, worklogs, related issues, Confluence docs, hypotheses, and open questions. Use when a user asks to investigate or deep-dive into a ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticket_key: { type: 'string', description: 'The JIRA ticket key, e.g. BR-997 or SRF-1165' },
        },
        required: ['ticket_key'],
      },
    },
    {
      name: 'investigate_regression_family',
      description: 'Find all related historical issues that may be siblings or predecessors of the given ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticket_key: { type: 'string', description: 'The JIRA ticket key to find regression siblings for' },
        },
        required: ['ticket_key'],
      },
    },
    {
      name: 'investigate_expected_behavior',
      description: 'Look up expected behavior and documentation for a feature or component. Searches Confluence, MOD documentation, and the WHATS\'ON knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          ticket_key: { type: 'string', description: 'The JIRA ticket key providing context (may be empty)' },
          query: { type: 'string', description: 'What to look up, e.g. "EPG scheduling rules"' },
        },
        required: ['query'],
      },
    },
    {
      name: 'investigate_customer_history',
      description: 'Retrieve all tickets reported by the same customer/reporter as the given ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticket_key: { type: 'string', description: "The JIRA ticket key whose reporter's history to fetch" },
        },
        required: ['ticket_key'],
      },
    },
    {
      name: 'search_confluence',
      description: 'Search Confluence for documentation pages.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query or CQL expression' },
          space_key: { type: 'string', description: 'Optional Confluence space key' },
          limit: { type: 'integer', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_confluence_page',
      description: 'Fetch a specific Confluence page by its content ID.',
      parameters: {
        type: 'object',
        properties: {
          content_id: { type: 'string', description: 'The Confluence page content ID' },
        },
        required: ['content_id'],
      },
    },
  ]
}
```

- [ ] **Step 2: Add native DB tool executor (search_analyses through search_gold_answers)**

Append to the same file:

```typescript
// ── Tool Executor ────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  mcpCallTool?: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<ToolResult> {
  const id = `${name}-${Date.now()}`
  try {
    const content = await executeToolInner(name, args, ctx, mcpCallTool)
    return { toolUseId: id, content, isError: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn(`Tool ${name} failed: ${msg}`)
    return { toolUseId: id, content: `Error: ${msg}`, isError: true }
  }
}

async function executeToolInner(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  mcpCallTool?: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<string> {
  switch (name) {
    case 'search_analyses': return toolSearchAnalyses(args, ctx)
    case 'get_analysis_detail': return toolGetAnalysisDetail(args, ctx)
    case 'find_similar_crashes': return toolFindSimilarCrashes(args, ctx)
    case 'get_crash_signature': return toolGetCrashSignature(args, ctx)
    case 'get_top_signatures': return toolGetTopSignatures(args, ctx)
    case 'get_trend_data': return toolGetTrendData(args, ctx)
    case 'get_error_patterns': return toolGetErrorPatterns(args, ctx)
    case 'get_statistics': return toolGetStatistics(ctx)
    case 'correlate_crash_to_jira': return toolCorrelateToJira(args, ctx)
    case 'get_crash_timeline': return toolGetCrashTimeline(args, ctx)
    case 'compare_crashes': return toolCompareCrashes(args, ctx)
    case 'get_component_health': return toolGetComponentHealth(args, ctx)
    case 'search_gold_answers': return toolSearchGoldAnswers(args, ctx)
    case 'search_jira': return toolSearchJira(args)
    case 'create_jira_ticket': return toolCreateJiraTicket(args)
    // Investigation tools: delegate to MCP if available, else fall back to native JIRA
    case 'investigate_jira_ticket':
      if (mcpCallTool) return mcpCallTool('investigate_ticket', { ticket_key: args.ticket_key })
      return toolNativeInvestigateTicket(args)
    case 'investigate_regression_family':
      if (mcpCallTool) return mcpCallTool('investigate_regression_family', { ticket_key: args.ticket_key })
      return toolNativeRegressionFamily(args)
    case 'investigate_expected_behavior':
      if (mcpCallTool) return mcpCallTool('investigate_expected_behavior', { ticket_key: args.ticket_key ?? '', query: args.query })
      return toolNativeExpectedBehavior(args)
    case 'investigate_customer_history':
      if (mcpCallTool) return mcpCallTool('investigate_customer_history', { ticket_key: args.ticket_key })
      return toolNativeCustomerHistory(args)
    case 'search_confluence':
      if (mcpCallTool) return mcpCallTool('confluence_search_content', { query: args.query, space_key: args.space_key, limit: args.limit })
      return toolNativeSearchConfluence(args)
    case 'get_confluence_page':
      if (mcpCallTool) return mcpCallTool('confluence_get_content', { content_id: args.content_id })
      return toolNativeGetConfluencePage(args)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── Native DB implementations ────────────────────────────────────────────────

function toolSearchAnalyses(args: Record<string, unknown>, ctx: ToolContext): string {
  const query = String(args.query ?? '')
  if (!query) return 'Missing query parameter.'
  const db = ctx.db
  type Row = { id: number; filename: string; severity: string; error_type: string; root_cause: string; component: string | null; analyzed_at: string }
  let sql = `
    SELECT a.id, a.filename, a.severity, a.error_type, a.root_cause, a.component, a.analyzed_at
    FROM analyses_fts
    JOIN analyses a ON analyses_fts.rowid = a.id
    WHERE analyses_fts MATCH ? AND a.deleted_at IS NULL`
  const params: unknown[] = [ftsPhrase(query)]
  if (args.severity) { sql += ' AND LOWER(a.severity) = ?'; params.push(String(args.severity).toLowerCase()) }
  if (args.date_from) { sql += ' AND a.analyzed_at >= ?'; params.push(args.date_from) }
  if (args.date_to)   { sql += ' AND a.analyzed_at <= ?'; params.push(args.date_to) }
  sql += ' LIMIT 10'
  const rows = db.prepare(sql).all(...params) as Row[]
  if (rows.length === 0) return 'No analyses found matching the query.'
  return `Found ${rows.length} analyses:\n\n` + rows.map(r =>
    `**[Analysis #${r.id}](hadron://analysis/${r.id})** — ${r.filename} (${r.severity})\n` +
    `- Error: ${r.error_type}\n- Root Cause: ${r.root_cause.substring(0, 200)}\n` +
    `- Component: ${r.component ?? 'unknown'}\n- Date: ${r.analyzed_at}\n`
  ).join('\n')
}

function toolGetAnalysisDetail(args: Record<string, unknown>, ctx: ToolContext): string {
  const id = Number(args.id)
  if (!id) throw new Error("Missing 'id' parameter")
  type Row = { id: number; filename: string; error_type: string; error_message: string | null; severity: string; component: string | null; root_cause: string; suggested_fixes: string; confidence: string | null; analyzed_at: string; ai_model: string; ai_provider: string | null; analysis_type: string; stack_trace: string | null }
  const row = ctx.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as Row | undefined
  if (!row) return `Analysis #${id} not found.`
  let fixes: string[] = []
  try { fixes = JSON.parse(row.suggested_fixes) } catch { fixes = [] }
  return `**[Analysis #${row.id}](hadron://analysis/${row.id})**: ${row.filename}\n\n` +
    `- **Error Type**: ${row.error_type}\n` +
    `- **Error Message**: ${row.error_message ?? 'N/A'}\n` +
    `- **Severity**: ${row.severity}\n` +
    `- **Component**: ${row.component ?? 'unknown'}\n` +
    `- **Root Cause**: ${row.root_cause}\n` +
    `- **Suggested Fixes**:\n${fixes.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}\n` +
    `- **Confidence**: ${row.confidence ?? 'N/A'}\n` +
    `- **Date**: ${row.analyzed_at}\n` +
    `- **Model**: ${row.ai_model} (${row.ai_provider ?? 'unknown'})\n` +
    `- **Type**: ${row.analysis_type}`
}

function toolFindSimilarCrashes(args: Record<string, unknown>, ctx: ToolContext): string {
  const id = Number(args.analysis_id)
  if (!id) throw new Error("Missing 'analysis_id' parameter")
  const limit = Number(args.limit ?? 5)
  type Source = { error_type: string; component: string | null }
  const source = ctx.db.prepare('SELECT error_type, component FROM analyses WHERE id = ?').get(id) as Source | undefined
  if (!source) return `Analysis #${id} not found.`
  type Row = { id: number; filename: string; severity: string; error_type: string; root_cause: string }
  const rows = ctx.db.prepare(`
    SELECT id, filename, severity, error_type, root_cause FROM analyses
    WHERE id != ? AND deleted_at IS NULL
      AND (error_type = ? OR (component = ? AND component IS NOT NULL))
    ORDER BY analyzed_at DESC LIMIT ?
  `).all(id, source.error_type, source.component, limit) as Row[]
  if (rows.length === 0) return 'No similar crashes found.'
  return `Found ${rows.length} similar crashes:\n\n` + rows.map(r =>
    `- **#${r.id}** ${r.filename} (${r.severity}) — ${r.error_type}: ${r.root_cause.substring(0, 100)}`
  ).join('\n')
}

function toolGetCrashSignature(args: Record<string, unknown>, ctx: ToolContext): string {
  const hash = String(args.hash ?? '')
  if (!hash) throw new Error("Missing 'hash' parameter")
  type Sig = { hash: string; canonical: string; occurrence_count: number; first_seen_at: string; last_seen_at: string; status: string; linked_ticket_id: string | null; linked_ticket_url: string | null }
  const sig = ctx.db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(hash) as Sig | undefined
  if (!sig) return `Signature ${hash} not found.`
  type File = { id: number; filename: string; severity: string; analyzed_at: string }
  const files = ctx.db.prepare(`
    SELECT a.id, a.filename, a.severity, a.analyzed_at FROM analyses a
    JOIN analysis_signatures asig ON asig.analysis_id = a.id
    WHERE asig.signature_hash = ? ORDER BY a.analyzed_at DESC LIMIT 10
  `).all(hash) as File[]
  return `**Signature**: \`${sig.hash}\`\n` +
    `- **Status**: ${sig.status}\n` +
    `- **Occurrences**: ${sig.occurrence_count}\n` +
    `- **First seen**: ${sig.first_seen_at}\n` +
    `- **Last seen**: ${sig.last_seen_at}\n` +
    (sig.linked_ticket_id ? `- **Linked ticket**: [${sig.linked_ticket_id}](${sig.linked_ticket_url})\n` : '') +
    `\n**Recent occurrences** (${files.length}):\n` +
    files.map(f => `- [Analysis #${f.id}](hadron://analysis/${f.id}) — ${f.filename} (${f.severity}) — ${f.analyzed_at}`).join('\n')
}

function toolGetTopSignatures(args: Record<string, unknown>, ctx: ToolContext): string {
  const limit = Number(args.limit ?? 10)
  type Sig = { hash: string; canonical: string; occurrence_count: number; status: string; first_seen_at: string; last_seen_at: string }
  let sql = 'SELECT * FROM crash_signatures'
  const params: unknown[] = []
  if (args.status) { sql += ' WHERE status = ?'; params.push(args.status) }
  sql += ' ORDER BY occurrence_count DESC LIMIT ?'
  params.push(limit)
  const rows = ctx.db.prepare(sql).all(...params) as Sig[]
  if (rows.length === 0) return 'No crash signatures found.'
  return `Top ${rows.length} crash signatures:\n\n` + rows.map((s, i) =>
    `${i + 1}. \`${s.hash}\` — ${s.occurrence_count} occurrences (${s.status})\n   ${s.canonical.substring(0, 100)}`
  ).join('\n')
}

function toolGetTrendData(args: Record<string, unknown>, ctx: ToolContext): string {
  const period = String(args.period ?? 'day')
  const rangeDays = Number(args.range_days ?? 30)
  const strfmt = period === 'month' ? '%Y-%m' : period === 'week' ? '%Y-W%W' : '%Y-%m-%d'
  type Row = { period: string; count: number }
  const rows = ctx.db.prepare(`
    SELECT strftime(?, analyzed_at) as period, COUNT(*) as count
    FROM analyses
    WHERE deleted_at IS NULL AND analyzed_at >= datetime('now', ?)
    GROUP BY period ORDER BY period ASC
  `).all(strfmt, `-${rangeDays} days`) as Row[]
  if (rows.length === 0) return `No crash data found for the last ${rangeDays} days.`
  return `Crash trends (by ${period}, last ${rangeDays} days):\n\n` +
    rows.map(r => `- **${r.period}**: ${r.count} crashes`).join('\n')
}

function toolGetErrorPatterns(args: Record<string, unknown>, ctx: ToolContext): string {
  const limit = Number(args.limit ?? 10)
  type Row = { error_type: string; count: number }
  const rows = ctx.db.prepare(`
    SELECT error_type, COUNT(*) as count FROM analyses
    WHERE deleted_at IS NULL GROUP BY error_type ORDER BY count DESC LIMIT ?
  `).all(limit) as Row[]
  if (rows.length === 0) return 'No error patterns found.'
  return `Top error patterns:\n\n` + rows.map((r, i) => `${i + 1}. **${r.error_type}**: ${r.count} occurrences`).join('\n')
}

function toolGetStatistics(ctx: ToolContext): string {
  type Total = { total: number }
  type Sev = { severity: string; count: number }
  type Fav = { fav: number }
  const total = (ctx.db.prepare('SELECT COUNT(*) as total FROM analyses WHERE deleted_at IS NULL').get() as Total).total
  const bySeverity = ctx.db.prepare('SELECT severity, COUNT(*) as count FROM analyses WHERE deleted_at IS NULL GROUP BY severity ORDER BY count DESC').all() as Sev[]
  const favorites = (ctx.db.prepare('SELECT COUNT(*) as fav FROM analyses WHERE is_favorite = 1 AND deleted_at IS NULL').get() as Fav).fav
  return `**Hadron Database Statistics**\n\n` +
    `- **Total analyses**: ${total}\n` +
    `- **Favorites**: ${favorites}\n` +
    `- **By severity**:\n${bySeverity.map(s => `  - ${s.severity}: ${s.count}`).join('\n')}`
}

function toolCorrelateToJira(args: Record<string, unknown>, ctx: ToolContext): string {
  const id = Number(args.analysis_id)
  if (!id) throw new Error("Missing 'analysis_id' parameter")
  // Check analysis_jira_links table (m007)
  type Link = { jira_key: string; jira_url: string | null; link_type: string | null; created_at: string }
  const links = ctx.db.prepare(`
    SELECT jira_key, jira_url, link_type, created_at FROM analysis_jira_links WHERE analysis_id = ?
  `).all(id) as Link[]
  if (links.length === 0) return `No JIRA tickets linked to analysis #${id}.`
  return `JIRA tickets linked to analysis #${id}:\n\n` + links.map(l =>
    `- **${l.jira_key}** (${l.link_type ?? 'linked'})${l.jira_url ? ` — [${l.jira_url}](${l.jira_url})` : ''} — ${l.created_at}`
  ).join('\n')
}

function toolGetCrashTimeline(args: Record<string, unknown>, ctx: ToolContext): string {
  const hash = String(args.hash ?? '')
  if (!hash) throw new Error("Missing 'hash' parameter")
  type Sig = { hash: string; canonical: string; occurrence_count: number; first_seen_at: string; last_seen_at: string; status: string; linked_ticket_id: string | null; linked_ticket_url: string | null }
  const sig = ctx.db.prepare('SELECT * FROM crash_signatures WHERE hash = ?').get(hash) as Sig | undefined
  if (!sig) return `Signature ${hash} not found.`
  type File = { id: number; filename: string; severity: string; analyzed_at: string }
  const files = ctx.db.prepare(`
    SELECT a.id, a.filename, a.severity, a.analyzed_at
    FROM analyses a JOIN analysis_signatures asig ON asig.analysis_id = a.id
    WHERE asig.signature_hash = ? ORDER BY a.analyzed_at ASC
  `).all(hash) as File[]
  return `**Timeline for signature** \`${hash}\`\n` +
    `**Canonical**: ${sig.canonical.substring(0, 150)}\n` +
    `**Status**: ${sig.status} | **Total**: ${sig.occurrence_count} occurrences\n` +
    (sig.linked_ticket_id ? `**Linked ticket**: ${sig.linked_ticket_id}\n` : '') +
    `\n| Date | Analysis | Severity |\n|---|---|---|\n` +
    files.map(f => `| ${f.analyzed_at.substring(0, 10)} | [#${f.id} ${f.filename}](hadron://analysis/${f.id}) | ${f.severity} |`).join('\n')
}

function toolCompareCrashes(args: Record<string, unknown>, ctx: ToolContext): string {
  const idA = Number(args.analysis_id_a)
  const idB = Number(args.analysis_id_b)
  if (!idA || !idB) throw new Error("Missing 'analysis_id_a' or 'analysis_id_b'")
  type Row = { id: number; filename: string; error_type: string; severity: string; component: string | null; root_cause: string; suggested_fixes: string; confidence: string | null }
  const a = ctx.db.prepare('SELECT id, filename, error_type, severity, component, root_cause, suggested_fixes, confidence FROM analyses WHERE id = ?').get(idA) as Row | undefined
  const b = ctx.db.prepare('SELECT id, filename, error_type, severity, component, root_cause, suggested_fixes, confidence FROM analyses WHERE id = ?').get(idB) as Row | undefined
  if (!a || !b) return `One or both analyses not found (${idA}, ${idB}).`
  const field = (label: string, va: string | null, vb: string | null) =>
    `| **${label}** | ${va ?? 'N/A'} | ${vb ?? 'N/A'} |\n`
  return `**Comparison: Analysis #${a.id} vs Analysis #${b.id}**\n\n` +
    `| Field | #${a.id} ${a.filename} | #${b.id} ${b.filename} |\n|---|---|---|\n` +
    field('Error Type', a.error_type, b.error_type) +
    field('Severity', a.severity, b.severity) +
    field('Component', a.component, b.component) +
    field('Confidence', a.confidence, b.confidence) +
    `| **Root Cause** | ${a.root_cause.substring(0, 150)} | ${b.root_cause.substring(0, 150)} |`
}

function toolGetComponentHealth(args: Record<string, unknown>, ctx: ToolContext): string {
  const component = String(args.component ?? '')
  if (!component) throw new Error("Missing 'component' parameter")
  type Total = { total: number }
  type Sev = { severity: string; count: number }
  type Err = { error_type: string; count: number }
  const total = (ctx.db.prepare('SELECT COUNT(*) as total FROM analyses WHERE component LIKE ? AND deleted_at IS NULL').get(`%${component}%`) as Total).total
  const bySev = ctx.db.prepare('SELECT severity, COUNT(*) as count FROM analyses WHERE component LIKE ? AND deleted_at IS NULL GROUP BY severity ORDER BY count DESC').all(`%${component}%`) as Sev[]
  const topErrors = ctx.db.prepare('SELECT error_type, COUNT(*) as count FROM analyses WHERE component LIKE ? AND deleted_at IS NULL GROUP BY error_type ORDER BY count DESC LIMIT 5').all(`%${component}%`) as Err[]
  type Link = { jira_key: string }
  const jiraLinks = ctx.db.prepare(`SELECT DISTINCT jl.jira_key FROM analysis_jira_links jl JOIN analyses a ON a.id = jl.analysis_id WHERE a.component LIKE ? AND a.deleted_at IS NULL LIMIT 5`).all(`%${component}%`) as Link[]
  return `**Component Health: ${component}**\n\n` +
    `- **Total crashes**: ${total}\n` +
    `- **By severity**: ${bySev.map(s => `${s.severity}: ${s.count}`).join(', ')}\n` +
    `- **Top error types**:\n${topErrors.map(e => `  - ${e.error_type}: ${e.count}`).join('\n')}\n` +
    (jiraLinks.length > 0 ? `- **Related JIRA tickets**: ${jiraLinks.map(l => l.jira_key).join(', ')}\n` : '')
}

function toolSearchGoldAnswers(args: Record<string, unknown>, ctx: ToolContext): string {
  const query = String(args.query ?? '')
  if (!query) throw new Error("Missing 'query' parameter")
  type Row = { id: number; question: string; answer: string; won_version: string | null; customer: string | null; created_at: string }
  const rows = ctx.db.prepare(`
    SELECT id, question, answer, won_version, customer, created_at
    FROM gold_answers
    WHERE question LIKE ? OR answer LIKE ?
    ORDER BY created_at DESC LIMIT 5
  `).all(`%${query}%`, `%${query}%`) as Row[]
  if (rows.length === 0) return `No verified answers found for "${query}".`
  return `Found ${rows.length} verified answers:\n\n` + rows.map(r =>
    `**Q**: ${r.question.substring(0, 200)}\n**A**: ${r.answer.substring(0, 400)}\n` +
    (r.won_version ? `*(WON ${r.won_version}${r.customer ? `, ${r.customer}` : ''})*` : '')
  ).join('\n\n---\n\n')
}

// ── JIRA native tools ────────────────────────────────────────────────────────

async function toolSearchJira(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '')
  if (!query) throw new Error("Missing 'query' parameter")
  const maxResults = Number(args.max_results ?? 5)
  const { baseUrl, email, apiToken } = readJiraCreds()
  // Detect if query looks like JQL (contains operators/keywords) or plain text
  const isJql = /\b(project|status|assignee|priority|AND|OR|ORDER BY|issuetype)\b/i.test(query)
  const jql = isJql ? query : `text ~ "${query.replace(/"/g, '\\"')}" ORDER BY updated DESC`
  const data = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,priority,issuetype`) as {
    issues: Array<{ key: string; fields: { summary: string; status: { name: string }; assignee: { displayName: string } | null; priority: { name: string } | null; issuetype: { name: string } } }>
  }
  if (!data.issues?.length) return 'No JIRA tickets found.'
  return `Found ${data.issues.length} JIRA tickets:\n\n` + data.issues.map(i =>
    `- **${i.key}**: ${i.fields.summary}\n  Status: ${i.fields.status.name} | Priority: ${i.fields.priority?.name ?? 'N/A'} | Assignee: ${i.fields.assignee?.displayName ?? 'Unassigned'}`
  ).join('\n')
}

async function toolCreateJiraTicket(args: Record<string, unknown>): Promise<string> {
  const { project_key, summary, description, issue_type = 'Bug', priority = 'Medium' } = args as {
    project_key: string; summary: string; description: string; issue_type?: string; priority?: string
  }
  if (!project_key || !summary || !description) throw new Error('Missing required parameters: project_key, summary, description')
  const { baseUrl, email, apiToken } = readJiraCreds()
  const body = {
    fields: {
      project: { key: project_key },
      summary,
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] },
      issuetype: { name: issue_type },
      priority: { name: priority },
    },
  }
  const created = await jiraFetch(baseUrl, email, apiToken, '/rest/api/3/issue', { method: 'POST', body: JSON.stringify(body) }) as { key: string; id: string }
  return `Successfully created JIRA ticket **${created.key}**: "${summary}"\nIssue ID: ${created.id}`
}

// ── Native fallbacks for investigation tools (when MCP not available) ─────────

async function toolNativeInvestigateTicket(args: Record<string, unknown>): Promise<string> {
  const ticketKey = String(args.ticket_key ?? '')
  if (!ticketKey) throw new Error("Missing 'ticket_key' parameter")
  const { baseUrl, email, apiToken } = readJiraCreds()
  const issue = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/issue/${ticketKey}?expand=changelog,renderedFields&fields=summary,description,status,priority,assignee,reporter,issuetype,labels,components,comment,attachment`) as {
    key: string
    fields: {
      summary: string
      status: { name: string }
      priority: { name: string } | null
      assignee: { displayName: string } | null
      reporter: { displayName: string } | null
      issuetype: { name: string }
      labels: string[]
      components: Array<{ name: string }>
      comment: { comments: Array<{ author: { displayName: string }; body: unknown; created: string }> }
    }
    changelog: { histories: Array<{ created: string; author: { displayName: string }; items: Array<{ field: string; fromString: string | null; toString: string | null }> }> }
  }
  const f = issue.fields
  const comments = f.comment.comments.slice(-5).map(c => `  [${c.created.substring(0, 10)}] ${c.author.displayName}: (comment body omitted)`)
  const history = issue.changelog.histories.slice(-10).map(h =>
    `  [${h.created.substring(0, 10)}] ${h.author.displayName}: ` + h.items.map(i => `${i.field}: ${i.fromString ?? '(none)'} → ${i.toString ?? '(none)'}`).join(', ')
  )
  return `**Investigation: ${ticketKey} — ${f.summary}**\n\n` +
    `- **Status**: ${f.status.name} | **Priority**: ${f.priority?.name ?? 'N/A'} | **Type**: ${f.issuetype.name}\n` +
    `- **Assignee**: ${f.assignee?.displayName ?? 'Unassigned'} | **Reporter**: ${f.reporter?.displayName ?? 'Unknown'}\n` +
    `- **Labels**: ${f.labels.join(', ') || 'none'} | **Components**: ${f.components.map(c => c.name).join(', ') || 'none'}\n\n` +
    `**Recent Comments** (last 5):\n${comments.join('\n') || '  None'}\n\n` +
    `**Changelog** (last 10 changes):\n${history.join('\n') || '  No changes'}\n\n` +
    `*Tip: For deeper investigation including Confluence docs and hypotheses, configure CodexMgX in Settings.*`
}

async function toolNativeRegressionFamily(args: Record<string, unknown>): Promise<string> {
  const ticketKey = String(args.ticket_key ?? '')
  if (!ticketKey) throw new Error("Missing 'ticket_key' parameter")
  const { baseUrl, email, apiToken } = readJiraCreds()
  // Extract project from ticket key (e.g. "BR-997" → "BR")
  const project = ticketKey.split('-')[0]
  const jql = `project = "${project}" AND created >= -90d AND text ~ "${ticketKey}" ORDER BY created DESC`
  const data = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,status,created`) as {
    issues: Array<{ key: string; fields: { summary: string; status: { name: string }; created: string } }>
  }
  if (!data.issues?.length) return `No related issues found for ${ticketKey} in the last 90 days.`
  return `**Regression family for ${ticketKey}** (last 90 days, project ${project}):\n\n` +
    data.issues.map(i => `- **${i.key}**: ${i.fields.summary} (${i.fields.status.name}, ${i.fields.created.substring(0, 10)})`).join('\n') +
    `\n\n*For cross-project analysis, configure CodexMgX in Settings.*`
}

async function toolNativeExpectedBehavior(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '')
  if (!query) throw new Error("Missing 'query' parameter")
  // Native fallback: search Confluence
  try {
    const { baseUrl, email, apiToken } = readConfluenceCreds()
    const data = await jiraFetch(baseUrl.replace(/\/rest\/api.*/, ''), email, apiToken,
      `/wiki/rest/api/content/search?cql=${encodeURIComponent(`type=page AND text ~ "${query}"`)}&limit=5&expand=excerpt`) as {
      results: Array<{ id: string; title: string; _links: { webui: string }; excerpt?: string }>
    }
    if (!data.results?.length) return `No Confluence documentation found for "${query}".`
    return `**Confluence docs for "${query}"**:\n\n` + data.results.map(r =>
      `- **[${r.title}](${r._links.webui})**\n  ${r.excerpt ?? '(no excerpt)'}`
    ).join('\n\n')
  } catch (e) {
    return `Could not search documentation: ${e instanceof Error ? e.message : String(e)}. Configure CodexMgX for full MOD/KB search.`
  }
}

async function toolNativeCustomerHistory(args: Record<string, unknown>): Promise<string> {
  const ticketKey = String(args.ticket_key ?? '')
  if (!ticketKey) throw new Error("Missing 'ticket_key' parameter")
  const { baseUrl, email, apiToken } = readJiraCreds()
  const issue = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/issue/${ticketKey}?fields=reporter`) as {
    fields: { reporter: { accountId: string; displayName: string } | null }
  }
  const reporter = issue.fields.reporter
  if (!reporter) return `No reporter found for ${ticketKey}.`
  const jql = `reporter = "${reporter.accountId}" ORDER BY created DESC`
  const data = await jiraFetch(baseUrl, email, apiToken, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,status,created,priority`) as {
    issues: Array<{ key: string; fields: { summary: string; status: { name: string }; created: string; priority: { name: string } | null } }>
  }
  if (!data.issues?.length) return `No ticket history found for reporter ${reporter.displayName}.`
  return `**Ticket history for ${reporter.displayName}** (reporter of ${ticketKey}):\n\n` +
    data.issues.map(i => `- **${i.key}**: ${i.fields.summary} (${i.fields.status.name}, ${i.fields.priority?.name ?? 'N/A'}, ${i.fields.created.substring(0, 10)})`).join('\n')
}

async function toolNativeSearchConfluence(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '')
  const limit = Number(args.limit ?? 10)
  const { baseUrl, email, apiToken } = readConfluenceCreds()
  let cql = `type=page AND text ~ "${query.replace(/"/g, '\\"')}"`
  if (args.space_key) cql += ` AND space.key = "${args.space_key}"`
  const data = await jiraFetch(baseUrl.replace(/\/rest\/api.*/, ''), email, apiToken,
    `/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=excerpt`) as {
    results: Array<{ id: string; title: string; _links: { webui: string }; excerpt?: string }>
  }
  if (!data.results?.length) return `No Confluence pages found for "${query}".`
  return `Found ${data.results.length} Confluence pages:\n\n` + data.results.map(r =>
    `- **[${r.title}](${r._links.webui})**\n  ID: ${r.id}\n  ${r.excerpt ?? ''}`
  ).join('\n\n')
}

async function toolNativeGetConfluencePage(args: Record<string, unknown>): Promise<string> {
  const contentId = String(args.content_id ?? '')
  if (!contentId) throw new Error("Missing 'content_id' parameter")
  const { baseUrl, email, apiToken } = readConfluenceCreds()
  const data = await jiraFetch(baseUrl.replace(/\/rest\/api.*/, ''), email, apiToken,
    `/wiki/rest/api/content/${contentId}?expand=body.view,version`) as {
    title: string
    _links: { webui: string }
    body: { view: { value: string } }
  }
  // Strip HTML tags for plain text
  const text = data.body?.view?.value?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
  return `**${data.title}**\nURL: ${data._links.webui}\n\n${text.substring(0, 3000)}`
}
```

- [ ] **Step 3: Type-check**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (only pre-existing issues if any).

- [ ] **Step 4: Commit**

```bash
git add electron/services/chat-tools.ts
git commit -m "feat(chat): add full chat tools registry — 20 native DB + JIRA tools"
```

---

## Task 3: CodexMgX MCP Client

Create `electron/services/mcp-client.ts` — a lazy-initialized stdio MCP client that spawns the PowerShell server on first use and routes tool calls through JSON-RPC 2.0.

The MCP server script is at: `C:\whatsOn\CodexMgX plugin\plugins\codexmgx-plugin\scripts\start-codexmgx-mcp.ps1`
It loads credentials from `%USERPROFILE%\.codex\plugins\codexmgx-plugin\codexmgx-env.ps1` automatically.

**Files:**
- Create: `electron/services/mcp-client.ts`
- Modify: `electron/ipc/settings.ts` (add CodexMgX config handlers)

- [ ] **Step 1: Create `mcp-client.ts`**

Create `/mnt/c/Projects/Hadron_v3/hadron-electron/electron/services/mcp-client.ts`:

```typescript
import { spawn, ChildProcess } from 'child_process'
import log from 'electron-log'
import Store from 'electron-store'

const settingsStore = new Store({ name: 'settings' })

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

class McpClient {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private buffer = ''
  private initialized = false
  private tools: McpTool[] = []

  private get scriptPath(): string {
    return (settingsStore.get('codexmgx_script_path', '') as string) ||
      `C:\\whatsOn\\CodexMgX plugin\\plugins\\codexmgx-plugin\\scripts\\start-codexmgx-mcp.ps1`
  }

  isConfigured(): boolean {
    return !!this.scriptPath
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await this.start()
  }

  private async start(): Promise<void> {
    const scriptPath = this.scriptPath
    log.info('[MCP] Spawning CodexMgX server:', scriptPath)

    this.process = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.process.stdout!.setEncoding('utf8')
    this.process.stdout!.on('data', (chunk: string) => {
      this.buffer += chunk
      this.processBuffer()
    })
    this.process.stderr!.on('data', (data: Buffer) => {
      log.warn('[MCP] stderr:', data.toString().trim())
    })
    this.process.on('exit', (code) => {
      log.info('[MCP] Process exited with code', code)
      this.initialized = false
      this.process = null
      // Reject all pending requests
      for (const [, { reject }] of this.pending) {
        reject(new Error('MCP server process exited'))
      }
      this.pending.clear()
    })
    this.process.on('error', (err) => {
      log.error('[MCP] Process error:', err)
    })

    // Send initialize
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'hadron-electron', version: '5.0.0' },
    })

    // Send initialized notification (no response expected)
    this.sendNotification('notifications/initialized', {})

    // List available tools
    const toolsResult = await this.sendRequest('tools/list', {}) as { tools: McpTool[] }
    this.tools = toolsResult.tools ?? []
    log.info('[MCP] Available tools:', this.tools.map(t => t.name).join(', '))

    this.initialized = true
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse
        if (msg.id !== undefined) {
          const pending = this.pending.get(msg.id)
          if (pending) {
            this.pending.delete(msg.id)
            if (msg.error) {
              pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`))
            } else {
              pending.resolve(msg.result)
            }
          }
        }
      } catch (e) {
        // Non-JSON output from server (e.g. startup logs) — ignore
      }
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
      this.pending.set(id, { resolve, reject })
      const line = JSON.stringify(req) + '\n'
      try {
        this.process!.stdin!.write(line)
      } catch (e) {
        this.pending.delete(id)
        reject(e)
      }
      // 30-second timeout per request
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP request timeout: ${method}`))
        }
      }, 30_000)
    })
  }

  private sendNotification(method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'
    try { this.process?.stdin?.write(msg) } catch { /* ignore */ }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.ensureInitialized()
    const result = await this.sendRequest('tools/call', { name, arguments: args }) as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }
    const text = (result.content ?? [])
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n')
    if (result.isError) throw new Error(text || 'MCP tool returned error')
    return text
  }

  getTools(): McpTool[] {
    return this.tools
  }

  shutdown(): void {
    try { this.process?.stdin?.end() } catch { /* ignore */ }
    try { this.process?.kill() } catch { /* ignore */ }
    this.process = null
    this.initialized = false
    this.pending.clear()
  }
}

// Singleton — lazily initialized on first use
let instance: McpClient | null = null

export function getMcpClient(): McpClient {
  if (!instance) instance = new McpClient()
  return instance
}

export function shutdownMcpClient(): void {
  instance?.shutdown()
  instance = null
}

/**
 * Try to call a CodexMgX MCP tool. Returns null if MCP is not configured or fails.
 * Use this as the `mcpCallTool` parameter in executeTool().
 */
export async function tryMcpCallTool(name: string, args: Record<string, unknown>): Promise<string | null> {
  const client = getMcpClient()
  if (!client.isConfigured()) return null
  try {
    return await client.callTool(name, args)
  } catch (e) {
    log.warn(`[MCP] Tool ${name} failed:`, e instanceof Error ? e.message : e)
    return null
  }
}
```

- [ ] **Step 2: Add CodexMgX settings handlers to `electron/ipc/settings.ts`**

Read the existing file first, then append at the end of `registerSettingsHandlers()`:

```typescript
  // CodexMgX MCP configuration
  ipcMain.handle('get_codexmgx_config', () => {
    const db = getDb()
    const scriptPath = settingsStore.get('codexmgx_script_path', '') as string
    const enabled = settingsStore.get('codexmgx_enabled', false) as boolean
    return { scriptPath, enabled }
  })

  ipcMain.handle('save_codexmgx_config', (_e, args: { scriptPath: string; enabled: boolean }) => {
    settingsStore.set('codexmgx_script_path', args.scriptPath)
    settingsStore.set('codexmgx_enabled', args.enabled)
    // Reset MCP client so it re-initializes with new path
    const { shutdownMcpClient } = require('../services/mcp-client')
    shutdownMcpClient()
    return { ok: true }
  })
```

- [ ] **Step 3: Register MCP shutdown on app quit**

In `electron/main.ts` (or wherever app `before-quit` is handled), add:

```typescript
app.on('before-quit', () => {
  shutdownMcpClient()
})
```

Find the import line in `electron/main.ts` that imports from services and add:
```typescript
import { shutdownMcpClient } from './services/mcp-client'
```

- [ ] **Step 4: Type-check**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add electron/services/mcp-client.ts electron/ipc/settings.ts electron/main.ts
git commit -m "feat(mcp): add CodexMgX MCP stdio client + settings handlers"
```

---

## Task 4: Full Agent Loop in `chat_send`

Rewrite the `chat_send` handler in `electron/ipc/chat.ts` with the full agentic loop. This is the largest task.

Key behaviors to implement:
1. Per-request stream state (fix singleton race condition)
2. Resolve API key (existing pattern)
3. Build tool context + filter tools by toggle flags
4. Build system prompt (verbosity + analysis context)
5. Agent loop: up to 5 iterations of `callAiWithTools()` → parallel tool execution
6. Final synthesis via `callAiStreaming()`
7. Emit sideband events: context, tool_use, diagnostics, final_content

**Files:**
- Modify: `electron/ipc/chat.ts`

- [ ] **Step 1: Add imports and per-request stream state**

Replace the top of `electron/ipc/chat.ts` with:

```typescript
import { IpcMain } from 'electron'
import log from 'electron-log'
import { getDb } from '../database'
import { callAi, callAiWithTools, callAiStreaming, buildToolResultMessages } from '../services/ai-service'
import type { ToolCall, ToolResult } from '../services/ai-service'
import { getSecret } from '../services/safe-storage'
import { SERVICE_NAME } from '../services/jira-client'
import { getApiKeyFromKeeper } from './keeper'
import { ftsPhrase } from '../services/db-helpers'
import { getToolDefinitions, executeTool } from '../services/chat-tools'
import type { ToolContext } from '../services/chat-tools'
import { tryMcpCallTool } from '../services/mcp-client'
import Store from 'electron-store'

const settingsStore = new Store({ name: 'settings' })

const MAX_AGENT_ITERATIONS = 5

// ── Per-request stream state ─────────────────────────────────────────────────
// Each chat_send creates a fresh state object and stores a reference here.
// poll_chat_stream drains from this reference. No race: only one stream
// can be "active" at a time (the frontend blocks sending until done).

interface StreamState {
  pendingText: string
  done: boolean
  error: string | null
  events: Array<{ kind: string; [k: string]: unknown }>
}

let activeStream: StreamState | null = null

function streamReset(): StreamState {
  const s: StreamState = { pendingText: '', done: false, error: null, events: [] }
  activeStream = s
  return s
}

// ── System Prompt ────────────────────────────────────────────────────────────

const CHAT_SYSTEM_PROMPT_BASE = `You are Ask Hadron, an expert regarding the Mediagenix WHATS'ON broadcast management software, its customer-agnostic general BASE implementation, as well as specific customer implementation customizations. You help users understand crashes, debug issues, navigate documentation, and leverage historical analyses.

## Your Tools
You have tools to search and retrieve information from Hadron's databases. USE YOUR TOOLS proactively — do not guess or make up information.

Tool usage strategy:
- For documentation/feature questions: use \`search_kb\` if KB is available, otherwise \`search_gold_answers\` first
- For questions about specific crashes or errors: use \`search_analyses\` first, then \`get_analysis_detail\` for specifics
- For "how many" / trend / pattern questions: use \`get_trend_data\`, \`get_error_patterns\`, or \`get_statistics\`
- For signature/recurring crash questions: use \`get_top_signatures\` or \`get_crash_signature\`
- For cross-referencing crashes with JIRA: use \`correlate_crash_to_jira\`
- For JIRA investigations: use \`investigate_jira_ticket\` when the user gives you a ticket key
- For regression patterns: use \`investigate_regression_family\`
- For component health assessment: use \`get_component_health\`
- Always cite your sources (analysis IDs, KB doc titles/URLs, JIRA keys)

## Response Formatting
- Be concise but thorough. Default to 2-3 paragraphs unless asked for more detail.
- When presenting data from multiple sources, use **tables** for structured comparisons.
- Base your response ONLY on retrieved tool results. Do not make up information.
- If tool searches return no results, say so honestly.
- Format code references with backticks, use markdown headers for structure.`
```

- [ ] **Step 2: Rewrite the `registerChatHandlers` function**

Replace the entire body of `registerChatHandlers` with the content below. This replaces `chat_send`, `poll_chat_stream`, and all session/feedback handlers. Keep the existing session/feedback handlers intact — only replace `chat_send` and `poll_chat_stream`.

Find and replace the `ipcMain.handle('poll_chat_stream', ...)` handler:

```typescript
  ipcMain.handle('poll_chat_stream', () => {
    if (!activeStream) return { text: '', done: true, error: null, events: [] }
    const s = activeStream
    const text = s.pendingText
    const done = s.done
    const error = s.error ?? undefined
    const events = [...s.events]
    s.pendingText = ''
    s.events = []
    return { text, done, error, events }
  })
```

Find and replace the entire `ipcMain.handle('chat_send', ...)` handler with:

```typescript
  ipcMain.handle('chat_send', async (_e, rawArgs: {
    request?: {
      messages: Array<{ role: string; content: string }>
      api_key?: string
      model: string
      provider: string
      use_rag?: boolean
      use_kb?: boolean
      won_version?: string
      customer?: string
      analysis_id?: number
      request_id?: string
      keeper_secret_uid?: string
      auxiliary_model?: string
      verbosity?: string
      opensearch_config?: unknown
      jira_base_url?: string
      jira_email?: string
      jira_api_token?: string
      jira_project_key?: string
    }
    messages?: Array<{ role: string; content: string }>
    api_key?: string
    model?: string
    provider?: string
    use_rag?: boolean
    use_kb?: boolean
    keeper_secret_uid?: string
  }) => {
    const args = rawArgs.request ?? rawArgs as {
      messages: Array<{ role: string; content: string }>
      api_key?: string; model: string; provider: string
      use_rag?: boolean; use_kb?: boolean
      won_version?: string; customer?: string
      analysis_id?: number; request_id?: string
      keeper_secret_uid?: string; auxiliary_model?: string; verbosity?: string
    }

    const ss = streamReset()

    // ── Resolve API key ────────────────────────────────────────────────────
    let apiKey = args.api_key ?? ''
    if (!apiKey) {
      const stored = getSecret(SERVICE_NAME, args.provider)
      if (stored) apiKey = stored
    }
    if (!apiKey && args.keeper_secret_uid) {
      try { apiKey = await getApiKeyFromKeeper(args.keeper_secret_uid) }
      catch (err) { log.warn('Keeper lookup failed:', err instanceof Error ? err.message : err) }
    }
    if (!apiKey) {
      ss.error = `No API key configured for provider: ${args.provider}`
      ss.done = true
      return { content: '', inputTokens: 0, outputTokens: 0, cost: 0 }
    }

    const provider = args.provider
    const model = args.model
    const db = getDb()

    // ── Build JIRA config check ────────────────────────────────────────────
    const jiraBaseUrl = args.jira_base_url ?? (settingsStore.get('jira_base_url', '') as string)
    const hasJira = !!jiraBaseUrl

    // ── Build CodexMgX availability check ─────────────────────────────────
    const mcpEnabled = settingsStore.get('codexmgx_enabled', false) as boolean
    const mcpCallTool = mcpEnabled
      ? (name: string, mcpArgs: Record<string, unknown>) => tryMcpCallTool(name, mcpArgs).then(r => r ?? '(MCP unavailable)')
      : undefined

    // ── Tool context ───────────────────────────────────────────────────────
    const toolCtx: ToolContext = {
      db,
      apiKey,
      provider,
      model,
      wonVersion: args.won_version ?? null,
      customer: args.customer ?? null,
      useKb: args.use_kb ?? false,
      useMcp: mcpEnabled,
    }

    // ── Filter tools by user toggles ───────────────────────────────────────
    const useRag = args.use_rag ?? true
    const allTools = getToolDefinitions()
    const tools = allTools.filter(t => {
      switch (t.name) {
        case 'search_analyses': case 'find_similar_crashes': case 'get_analysis_detail': return useRag
        case 'search_jira': case 'create_jira_ticket':
        case 'investigate_jira_ticket': case 'investigate_regression_family':
        case 'investigate_expected_behavior': case 'investigate_customer_history':
        case 'search_confluence': case 'get_confluence_page': return hasJira
        default: return true
      }
    })

    // ── System prompt ─────────────────────────────────────────────────────
    let systemPrompt = CHAT_SYSTEM_PROMPT_BASE

    if (hasJira) {
      systemPrompt += '\n\n## JIRA Investigation Tools\nYou have deep investigation tools. When a user says "investigate ticket MGX-56673" or "look into BR-997", call `investigate_jira_ticket` immediately.'
    }

    switch (args.verbosity) {
      case 'concise':
        systemPrompt += '\n\nIMPORTANT: Be brief and concise. Answer in 2-3 sentences maximum unless explicitly asked for more.'
        break
      case 'detailed':
        systemPrompt += '\n\nProvide a thorough, detailed response. Include all relevant details, examples, source citations, and reasoning.'
        break
    }

    // Inject analysis context if selected
    if (args.analysis_id) {
      try {
        type Row = { id: number; filename: string; severity: string; error_type: string; error_message: string | null; component: string | null; root_cause: string; suggested_fixes: string; stack_trace: string | null }
        const analysis = db.prepare('SELECT * FROM analyses WHERE id = ?').get(args.analysis_id) as Row | undefined
        if (analysis) {
          let fixes: string[] = []
          try { fixes = JSON.parse(analysis.suggested_fixes) } catch { fixes = [] }
          systemPrompt += `\n\n## Currently Selected Analysis\nThe user is viewing this analysis. Answer questions in its context.\n` +
            `<current_analysis id="${analysis.id}" filename="${analysis.filename}" severity="${analysis.severity}" type="${analysis.error_type}">\n` +
            `Error: ${analysis.error_message ?? 'N/A'}\n` +
            `Component: ${analysis.component ?? 'unknown'}\n` +
            `Root Cause: ${analysis.root_cause}\n` +
            `Suggested Fixes: ${fixes.join('; ')}\n` +
            `</current_analysis>`
        }
      } catch (e) {
        log.warn('Failed to load analysis for chat context:', e)
      }
    }

    // ── Initial FTS context (fast pre-fetch for 0-tool responses) ─────────
    const query = [...(args.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? ''
    if (query && useRag) {
      try {
        type FtsRow = { id: number; filename: string; severity: string | null; root_cause: string | null; error_message: string | null; error_type: string | null }
        const rows = db.prepare(`
          SELECT a.id, a.filename, a.severity, a.root_cause, a.error_message, a.error_type
          FROM analyses_fts JOIN analyses a ON analyses_fts.rowid = a.id
          WHERE analyses_fts MATCH ? LIMIT 3
        `).all(ftsPhrase(query)) as FtsRow[]
        if (rows.length > 0) {
          systemPrompt += '\n\n## Quick Context (Full-Text Search)\n' + rows.map(r =>
            `<analysis id="${r.id}" filename="${r.filename}" severity="${r.severity ?? 'UNKNOWN'}">\n` +
            (r.error_type ? `Error Type: ${r.error_type}\n` : '') +
            (r.root_cause ? `Root Cause: ${r.root_cause}\n` : '') +
            `</analysis>`
          ).join('\n\n')
        }
      } catch { /* non-fatal */ }
    }

    // ── Agent loop ────────────────────────────────────────────────────────
    let agentMessages: unknown[] = (args.messages ?? []).map(m => ({ role: m.role, content: m.content }))
    const synthesisMessages = [...agentMessages]

    let totalToolCalls = 0
    const allToolResults: ToolResult[] = []
    const allToolNames: string[] = []
    const contextSummary = { rag_results: 0, kb_results: 0, gold_matches: 0, fts_results: 0, kind: 'context' as const }

    for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
      let llmResult
      try {
        llmResult = await callAiWithTools({
          provider,
          model,
          apiKey,
          systemPrompt,
          messages: agentMessages,
          tools,
          maxTokens: 4000,
        })
      } catch (e) {
        ss.error = e instanceof Error ? e.message : String(e)
        ss.done = true
        return { content: '', inputTokens: 0, outputTokens: 0, cost: 0 }
      }

      if (!llmResult.wantsTools) {
        // No tools — emit context and stream the response text
        ss.events.push(contextSummary)

        if (totalToolCalls === 0) {
          // No tools used at all: stream the direct response
          ss.pendingText += llmResult.content
          ss.done = true
          return { content: llmResult.content, inputTokens: llmResult.inputTokens, outputTokens: llmResult.outputTokens, cost: 0 }
        }

        // Tools were used — emit diagnostics, then do streaming synthesis
        ss.events.push({
          kind: 'diagnostics',
          tools_used: [...new Set(allToolNames)],
          total_tool_calls: totalToolCalls,
          retrieval_latency_ms: 0,
          evidence_sufficient: allToolResults.some(r => !r.isError),
          evidence_confidence: 0.8,
          evidence_reason: `${totalToolCalls} tool calls completed`,
        })

        // Build synthesis system prompt with all tool results as XML
        const sourceXml = buildToolResultsXml(allToolResults, allToolNames)
        const synthSystemPrompt = systemPrompt + (sourceXml ? '\n\n## Retrieved Context\n' + sourceXml : '')

        try {
          let finalContent = ''
          await callAiStreaming({
            provider,
            model,
            apiKey,
            systemPrompt: synthSystemPrompt,
            messages: synthesisMessages,
            maxTokens: 4096,
            onChunk: (text) => {
              ss.pendingText += text
              finalContent += text
            },
          })
          ss.done = true
          return { content: finalContent, inputTokens: 0, outputTokens: 0, cost: 0 }
        } catch (e) {
          ss.error = e instanceof Error ? e.message : String(e)
          ss.done = true
          return { content: '', inputTokens: 0, outputTokens: 0, cost: 0 }
        }
      }

      // ── Execute tool calls in parallel ──────────────────────────────────
      const toolCalls: ToolCall[] = llmResult.toolCalls

      for (const tc of toolCalls) {
        ss.events.push({
          kind: 'tool_use',
          tool_name: tc.name,
          tool_args: tc.arguments,
          iteration,
        })
        log.info(`[Chat] Tool call: ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`)
        // Update context counts
        if (['search_analyses', 'find_similar_crashes', 'get_analysis_detail'].includes(tc.name)) contextSummary.fts_results++
        if (tc.name === 'search_gold_answers') contextSummary.gold_matches++
      }

      const results = await Promise.all(
        toolCalls.map(tc => executeTool(tc.name, tc.arguments, toolCtx, mcpCallTool))
      )

      // Give each result the correct toolUseId from the LLM call
      const taggedResults = results.map((r, i) => ({ ...r, toolUseId: toolCalls[i].id }))

      allToolResults.push(...taggedResults)
      allToolNames.push(...toolCalls.map(tc => tc.name))
      totalToolCalls += toolCalls.length

      // Append assistant tool-call message + tool results to conversation
      agentMessages = [...agentMessages, llmResult.assistantMessage, ...buildToolResultMessages(taggedResults, provider)]
    }

    // ── Max iterations — force final streaming response ───────────────────
    ss.events.push(contextSummary)
    ss.events.push({
      kind: 'diagnostics',
      tools_used: [...new Set(allToolNames)],
      total_tool_calls: totalToolCalls,
      retrieval_latency_ms: 0,
      evidence_sufficient: allToolResults.some(r => !r.isError),
      evidence_confidence: 0.7,
      evidence_reason: `Max iterations reached (${MAX_AGENT_ITERATIONS})`,
    })

    const sourceXml = buildToolResultsXml(allToolResults, allToolNames)
    const synthSystemPrompt = systemPrompt + (sourceXml ? '\n\n## Retrieved Context\n' + sourceXml : '')

    try {
      let finalContent = ''
      await callAiStreaming({
        provider,
        model,
        apiKey,
        systemPrompt: synthSystemPrompt,
        messages: synthesisMessages,
        maxTokens: 4096,
        onChunk: (text) => { ss.pendingText += text; finalContent += text },
      })
      ss.done = true
      return { content: finalContent, inputTokens: 0, outputTokens: 0, cost: 0 }
    } catch (e) {
      ss.error = e instanceof Error ? e.message : String(e)
      ss.done = true
      return { content: '', inputTokens: 0, outputTokens: 0, cost: 0 }
    }
  })
```

- [ ] **Step 3: Add `buildToolResultsXml` helper at the bottom of the file**

```typescript
function buildToolResultsXml(results: ToolResult[], names: string[]): string {
  if (results.length === 0) return ''
  return results.map((r, i) => {
    const name = names[i] ?? 'tool'
    if (r.isError) return `<tool_result name="${name}" error="true">\n${r.content}\n</tool_result>`
    return `<tool_result name="${name}">\n${r.content.substring(0, 3000)}\n</tool_result>`
  }).join('\n\n')
}
```

- [ ] **Step 4: Fix `chat_delete_feedback` to match backend schema**

The handler currently expects `{ id: number }` but the frontend calls with `{ session_id, message_id }`. Fix the handler:

```typescript
  ipcMain.handle('chat_delete_feedback', (_e, args: {
    id?: number
    session_id?: string
    sessionId?: string
    message_id?: string
    messageId?: string
  }) => {
    const db = getDb()
    if (args.id) {
      db.prepare('DELETE FROM chat_feedback WHERE id = ?').run(args.id)
    } else {
      const sessionId = args.session_id ?? args.sessionId ?? ''
      const messageId = args.message_id ?? args.messageId ?? ''
      db.prepare('DELETE FROM chat_feedback WHERE session_id = ? AND message_id = ?').run(sessionId, messageId)
    }
  })
```

- [ ] **Step 5: Type-check**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron && npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/chat.ts
git commit -m "feat(chat): full agentic tool-use loop — 5-iteration agent, parallel tool execution, streaming synthesis, MCP delegation, fixed stream state and feedback deletion"
```

---

## Task 5: Settings UI — CodexMgX Configuration

Add a CodexMgX section to `src/components/SettingsPanel.tsx` so users can enable the MCP server and set the script path.

**Files:**
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/services/settings.ts` (or wherever settings IPC calls live) — actually add to `src/services/secure-storage.ts` or a new `src/services/mcp.ts`

- [ ] **Step 1: Add CodexMgX service wrapper in `src/services/`**

Create `/mnt/c/Projects/Hadron_v3/hadron-electron/src/services/codexmgx.ts`:

```typescript
import { invoke } from '../lib/tauri-core-shim'

export interface CodexMgXConfig {
  scriptPath: string
  enabled: boolean
}

const DEFAULT_SCRIPT_PATH = 'C:\\whatsOn\\CodexMgX plugin\\plugins\\codexmgx-plugin\\scripts\\start-codexmgx-mcp.ps1'

export async function getCodexMgXConfig(): Promise<CodexMgXConfig> {
  try {
    return await invoke<CodexMgXConfig>('get_codexmgx_config')
  } catch {
    return { scriptPath: DEFAULT_SCRIPT_PATH, enabled: false }
  }
}

export async function saveCodexMgXConfig(config: CodexMgXConfig): Promise<void> {
  await invoke<void>('save_codexmgx_config', config)
}
```

- [ ] **Step 2: Add CodexMgX section to `SettingsPanel.tsx`**

Find the section in `SettingsPanel.tsx` that renders the JIRA settings block. After the JIRA settings section, add a CodexMgX section. First add state and load at the top of the component:

```typescript
// Near other useState declarations:
const [codexMgxConfig, setCodexMgxConfig] = useState<{ scriptPath: string; enabled: boolean }>({
  scriptPath: 'C:\\whatsOn\\CodexMgX plugin\\plugins\\codexmgx-plugin\\scripts\\start-codexmgx-mcp.ps1',
  enabled: false,
})
```

In the `useEffect` that loads settings, add:
```typescript
getCodexMgXConfig().then(setCodexMgxConfig).catch(() => {})
```

In `handleSaveSettings`, before the success message, add:
```typescript
await saveCodexMgXConfig(codexMgxConfig)
```

Add the import at the top:
```typescript
import { getCodexMgXConfig, saveCodexMgXConfig } from '../services/codexmgx'
```

Then add this JSX section after the JIRA settings block (search for the closing div of the JIRA settings card and add after it):

```tsx
{/* CodexMgX MCP Integration */}
<div className="hd-panel-soft p-4 rounded-lg">
  <div className="flex items-center justify-between mb-3">
    <div>
      <h3 className="text-sm font-semibold text-gray-200">CodexMgX Integration</h3>
      <p className="text-xs text-gray-400 mt-0.5">
        Deep JIRA investigation, Confluence, MOD docs, and KB via MCP server
      </p>
    </div>
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={codexMgxConfig.enabled}
        onChange={(e) => setCodexMgxConfig(prev => ({ ...prev, enabled: e.target.checked }))}
        className="sr-only peer"
      />
      <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
    </label>
  </div>
  {codexMgxConfig.enabled && (
    <div>
      <label className="block text-xs text-gray-400 mb-1">MCP Server Script Path</label>
      <input
        type="text"
        value={codexMgxConfig.scriptPath}
        onChange={(e) => setCodexMgxConfig(prev => ({ ...prev, scriptPath: e.target.value }))}
        placeholder="C:\whatsOn\CodexMgX plugin\plugins\..."
        className="w-full text-xs bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
      />
      <p className="text-xs text-gray-500 mt-1">
        Default: <code className="text-gray-400">C:\whatsOn\CodexMgX plugin\...</code>
      </p>
    </div>
  )}
</div>
```

- [ ] **Step 3: Type-check**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/services/codexmgx.ts src/components/SettingsPanel.tsx
git commit -m "feat(settings): add CodexMgX MCP configuration section"
```

---

## Task 6: Wire `search_kb` Tool

The `search_kb` tool is listed in tool definitions but not yet in the executor. In the Tauri version it hits OpenSearch; in Electron it uses the local RAG/KB system.

**Files:**
- Modify: `electron/services/chat-tools.ts`
- Modify: `electron/ipc/chat.ts`

- [ ] **Step 1: Add `search_kb` to tool definitions in `chat-tools.ts`**

Add to the `getToolDefinitions()` return array:

```typescript
    {
      name: 'search_kb',
      description: "Search WHATS'ON Knowledge Base documentation and release notes. Use for questions about features, configuration, or what changed in a release.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for KB docs (e.g., "scheduling engine conflicts", "PSI namespace")' },
          top_k: { type: 'integer', description: 'Max results (default 8)', default: 8 },
        },
        required: ['query'],
      },
    },
```

- [ ] **Step 2: Add `search_kb` to `executeToolInner` switch in `chat-tools.ts`**

```typescript
    case 'search_kb': return toolSearchKb(args, ctx)
```

- [ ] **Step 3: Add `toolSearchKb` implementation**

```typescript
async function toolSearchKb(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const query = String(args.query ?? '')
  const topK = Number(args.top_k ?? 8)
  if (!query) throw new Error("Missing 'query' parameter")

  // Use retrieval_chunks table (indexed by the RAG import flow)
  type Chunk = { id: number; source_path: string; content: string; relevance?: number }
  const db = ctx.db
  const rows = db.prepare(`
    SELECT rc.id, rc.source_path, rc.content
    FROM retrieval_chunks_fts rcf
    JOIN retrieval_chunks rc ON rcf.rowid = rc.id
    WHERE rcf MATCH ?
    LIMIT ?
  `).all(ftsPhrase(query), topK) as Chunk[]

  if (rows.length === 0) {
    return 'No Knowledge Base documents found matching the query. Ensure KB documents have been imported in Settings → Knowledge Base.'
  }

  return `Found ${rows.length} KB documents:\n\n` + rows.map(r => {
    const title = r.source_path.split(/[\\/]/).pop() ?? r.source_path
    return `<documentation>\n  <source>${title}</source>\n  <extract>${r.content.substring(0, 1200)}</extract>\n</documentation>`
  }).join('\n\n')
}
```

- [ ] **Step 4: Add `search_kb` to tool filter in `chat_send` (it should be gated on `use_kb`)**

In `chat_send`, the tool filter block already handles this if we add `search_kb` to the condition:
```typescript
        case 'search_kb': return args.use_kb ?? false
```

This should already be in the switch from Task 4 if you included the `search_kb` case. If not, add it now.

- [ ] **Step 5: Type-check and commit**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron && npx tsc --noEmit 2>&1 | head -20
git add electron/services/chat-tools.ts electron/ipc/chat.ts
git commit -m "feat(chat): wire search_kb tool to local retrieval_chunks FTS"
```

---

## Task 7: End-to-End Smoke Test

Manual verification that the agent loop works correctly before merging.

- [ ] **Step 1: Build and start the app**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron && npm run dev
```

Expected: App starts, no build errors in console.

- [ ] **Step 2: Test basic chat (no tools)**

In Ask Hadron, type: `Hello, what can you do?`

Expected: Response streams in. No tool-use activity indicator. No errors in DevTools console.

- [ ] **Step 3: Test search_analyses tool**

Type: `What are the most common PSI crashes?`

Expected:
- "Searching analyses..." activity indicator appears briefly
- Response includes analysis IDs and crash details
- DiagnosticsPanel (if visible) shows tools_used: ["search_analyses"]

- [ ] **Step 4: Test statistics tool**

Type: `How many analyses are in the database?`

Expected: Response cites exact counts from `get_statistics` tool.

- [ ] **Step 5: Test verbosity toggle**

Enable "Concise" in the chat UI, ask a question. Response should be shorter.
Enable "Detailed", ask the same question. Response should be longer with more explanation.

- [ ] **Step 6: Test JIRA investigation (if JIRA configured)**

Type: `Investigate ticket BR-997`

Expected:
- "Investigating ticket..." activity shows
- If CodexMgX is enabled and configured: rich dossier with changelog, hypotheses, etc.
- If CodexMgX is not enabled: native JIRA investigation result

- [ ] **Step 7: Test selected analysis context**

Open an analysis, click "Ask Hadron" (or use the contextual starter). Type: `Explain this crash in simple terms`

Expected: Response references the specific analysis details, not a generic answer.

- [ ] **Step 8: Confirm feedback deletion fix**

In a session, click thumbs-down on a response, then click again to remove it.

Expected: No error in DevTools console. Feedback is removed.

---

## Self-Review Checklist

After writing this plan, checking against the spec:

**Spec coverage:**
- ✅ Fix singleton stream state race → per-request `streamReset()` returns fresh object
- ✅ Fix `chat_delete_feedback` → handles both `id` and `session_id/message_id`
- ✅ Verbosity not used → wired into system prompt in Task 4
- ✅ `selectedAnalysisId` not injected → Task 4 injects analysis into system prompt
- ✅ Gold answers not in context → `search_gold_answers` tool available to agent
- ✅ Full agentic tool-use loop → Task 4 (20+ tools, 5 iterations, parallel execution)
- ✅ Tool-calling for OpenAI + Anthropic → Task 1
- ✅ Sideband events (context, tool_use, diagnostics) → Task 4
- ✅ CodexMgX MCP client → Task 3
- ✅ Investigation tools delegate to MCP → Tasks 2 + 3
- ✅ Settings UI for CodexMgX → Task 5
- ✅ `search_kb` wired → Task 6
- ✅ JIRA native tools (search_jira, create_jira_ticket) → Task 2

**Gaps identified:** None. `final_content` sideband event is not emitted in this implementation (citation post-processing from Tauri is complex and omitted intentionally — the Electron port does not have the citation infrastructure). The `onFinalContent` callback in the frontend will simply not fire; this is acceptable since the final content is already streamed via `onStream`.
