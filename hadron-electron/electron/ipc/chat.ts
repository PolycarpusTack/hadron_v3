import { IpcMain } from 'electron'
import log from 'electron-log'
import { getDb } from '../database'
import { callAiWithTools, callAiStreaming, buildToolResultMessages } from '../services/ai-service'
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

// Timestamp format: INTEGER columns (chat_sessions.created_at/updated_at, chat_messages.timestamp)
// use Date.now() (Unix milliseconds); TEXT columns (chat_feedback.created_at) use ISO strings
// to match SQLite DEFAULT (datetime('now')). This is intentional and schema-dependent.

const MAX_AGENT_ITERATIONS = 5

// ── Per-request stream state ─────────────────────────────────────────────────
// Each chat_send creates a fresh state object and stores it here.
// poll_chat_stream drains from it. No singleton mutation race.

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

export function registerChatHandlers(ipcMain: IpcMain): void {
  // Save (upsert) a chat session.
  // created_at / updated_at are stored as Unix ms integers.
  ipcMain.handle('chat_save_session', (_e, args: {
    request?: {
      id?: string; title?: string; won_version?: string; wonVersion?: string; customer?: string
      messages?: Array<{ id: string; role: string; content: string; sources_json?: string | null; timestamp?: number }>
    }
    id?: string; title?: string; won_version?: string; wonVersion?: string; customer?: string
    messages?: Array<{ id: string; role: string; content: string; sources_json?: string | null; timestamp?: number }>
  }) => {
    const p = (args.request ?? args) as {
      id?: string; title?: string; won_version?: string; wonVersion?: string; customer?: string
      messages?: Array<{ id: string; role: string; content: string; sources_json?: string | null; timestamp?: number }>
    }
    const id = (p.id ?? (p as Record<string, unknown>).sessionId) as string
    const wonVersion = p.won_version ?? p.wonVersion ?? null
    const db = getDb()
    const now = Date.now()
    db.prepare(`
      INSERT INTO chat_sessions (id, title, won_version, customer, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title      = excluded.title,
        won_version = excluded.won_version,
        customer   = excluded.customer,
        updated_at = excluded.updated_at
    `).run(id, p.title ?? '', wonVersion, p.customer ?? null, now, now)

    if (p.messages?.length) {
      const insertMsg = db.prepare(`
        INSERT OR REPLACE INTO chat_messages
          (id, session_id, role, content, sources_json, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const m of p.messages) {
        insertMsg.run(m.id, id, m.role, m.content, m.sources_json ?? null, m.timestamp ?? now)
      }
    }
    return { id }
  })

  const loadSessions = (_e: unknown, args?: { limit?: number; offset?: number }) => {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).all(args?.limit ?? 50, args?.offset ?? 0)
  }
  ipcMain.handle('chat_load_sessions', loadSessions)
  ipcMain.handle('chat_list_sessions', loadSessions)

  ipcMain.handle('chat_load_session', (_e, args: { id: string }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(args.id) ?? null
  })

  const loadMessages = (_e: unknown, args: { session_id?: string; sessionId?: string }) => {
    const db = getDb()
    const sessionId = args.session_id ?? args.sessionId ?? ''
    return db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId)
  }
  ipcMain.handle('chat_load_messages', loadMessages)
  ipcMain.handle('chat_get_messages', loadMessages)

  ipcMain.handle('chat_save_message', (_e, args: {
    id: string
    session_id: string
    role: string
    content: string
    sources_json?: string
    timestamp?: number
  }) => {
    const db = getDb()
    const now = Date.now()
    const ts = args.timestamp ?? now
    db.prepare(`
      INSERT OR REPLACE INTO chat_messages
        (id, session_id, role, content, sources_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(args.id, args.session_id, args.role, args.content, args.sources_json ?? null, ts)
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, args.session_id)
    return { id: args.id }
  })

  ipcMain.handle('chat_delete_session', (_e, args: { id?: string; sessionId?: string }) => {
    const db = getDb()
    const id = args.sessionId ?? args.id ?? ''
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
  })

  ipcMain.handle('chat_star_session', (_e, args: { id?: string; sessionId?: string; starred: boolean }) => {
    const db = getDb()
    const id = args.sessionId ?? args.id ?? ''
    db.prepare('UPDATE chat_sessions SET is_starred = ? WHERE id = ?').run(args.starred ? 1 : 0, id)
  })

  ipcMain.handle('chat_tag_session', (_e, args: { id?: string; sessionId?: string; tags: string[] }) => {
    const db = getDb()
    const id = args.sessionId ?? args.id ?? ''
    db.prepare('UPDATE chat_sessions SET tags = ? WHERE id = ?').run(JSON.stringify(args.tags), id)
  })

  ipcMain.handle('chat_update_session_metadata', (_e, args: {
    id?: string
    sessionId?: string
    title?: string
    won_version?: string
    wonVersion?: string
    customer?: string
  }) => {
    const db = getDb()
    const now = Date.now()
    const id = args.sessionId ?? args.id ?? ''
    const wonVersion = args.won_version ?? args.wonVersion
    const updates: string[] = []
    const params: unknown[] = []
    if (args.title !== undefined)    { updates.push('title = ?');       params.push(args.title) }
    if (wonVersion !== undefined)    { updates.push('won_version = ?'); params.push(wonVersion) }
    if (args.customer !== undefined) { updates.push('customer = ?');    params.push(args.customer) }
    if (updates.length === 0) return
    updates.push('updated_at = ?')
    params.push(now)
    params.push(id)
    db.prepare(`UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  })

  ipcMain.handle('chat_submit_feedback', (_e, args: {
    session_id: string
    message_id: string
    rating: string
    comment?: string
    tools_used?: string
    sources_cited?: string
    query?: string
    reason?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO chat_feedback
        (session_id, message_id, rating, comment, tools_used, sources_cited, query, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, message_id) DO UPDATE SET
        rating       = excluded.rating,
        comment      = excluded.comment,
        tools_used   = excluded.tools_used,
        sources_cited = excluded.sources_cited,
        query        = excluded.query,
        reason       = excluded.reason
    `).run(
      args.session_id, args.message_id, args.rating,
      args.comment ?? null, args.tools_used ?? null, args.sources_cited ?? null,
      args.query ?? null, args.reason ?? null, now,
    )
    const saved = db.prepare('SELECT id FROM chat_feedback WHERE session_id = ? AND message_id = ?')
      .get(args.session_id, args.message_id) as { id: number }
    return { id: saved.id }
  })

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

  // Poll the current streaming response chunk buffer.
  // Returns done:false when no stream is active (not-yet-started, not complete) so the
  // poll loop waits rather than exiting before chat_send has called streamReset().
  ipcMain.handle('poll_chat_stream', () => {
    if (!activeStream) return { text: '', done: false, error: null, events: [] }
    const s = activeStream
    const text = s.pendingText
    const done = s.done
    const error = s.error ?? undefined
    const events = [...s.events]
    s.pendingText = ''
    s.events = []
    return { text, done, error, events }
  })

  // Cancel an in-flight streaming request.
  ipcMain.handle('cancel_chat_stream', () => {
    if (activeStream && !activeStream.done) {
      activeStream.done = true
      activeStream.error = 'Request cancelled'
    }
  })

  // Send a chat message to the AI provider with the full agentic tool-use loop.
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
    try {

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

    // ── JIRA availability ──────────────────────────────────────────────────
    const jiraBaseUrl = (args as { jira_base_url?: string }).jira_base_url ?? (settingsStore.get('jira_base_url', '') as string)
    const hasJira = !!jiraBaseUrl

    // ── CodexMgX MCP availability ──────────────────────────────────────────
    const mcpEnabled = settingsStore.get('codexmgx_enabled', false) as boolean
    const mcpCallTool = mcpEnabled
      ? (name: string, mcpArgs: Record<string, unknown>) =>
          tryMcpCallTool(name, mcpArgs).then(r => r ?? '(MCP unavailable)')
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
        case 'search_analyses':
        case 'find_similar_crashes':
        case 'get_analysis_detail':
          return useRag
        case 'search_kb':
          return args.use_kb ?? false
        case 'search_jira':
        case 'create_jira_ticket':
        case 'investigate_jira_ticket':
        case 'investigate_regression_family':
        case 'investigate_expected_behavior':
        case 'investigate_customer_history':
        case 'search_confluence':
        case 'get_confluence_page':
          return hasJira
        default:
          return true
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

    // Inject selected analysis context
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
        ss.events.push(contextSummary)

        if (totalToolCalls === 0) {
          // No tools used at all — stream the direct response
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
        ss.events.push({ kind: 'tool_use', tool_name: tc.name, tool_args: tc.arguments, iteration })
        log.info(`[Chat] Tool call: ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`)
        if (['search_analyses', 'find_similar_crashes', 'get_analysis_detail'].includes(tc.name)) contextSummary.fts_results++
        if (tc.name === 'search_gold_answers') contextSummary.gold_matches++
        if (tc.name === 'search_kb') contextSummary.kb_results++
      }

      const results = await Promise.all(
        toolCalls.map(tc => executeTool(tc.name, tc.arguments, toolCtx, mcpCallTool))
      )

      // Tag each result with the correct toolUseId from the LLM call
      const taggedResults = results.map((r, i) => ({ ...r, toolUseId: toolCalls[i].id }))

      allToolResults.push(...taggedResults)
      allToolNames.push(...toolCalls.map(tc => tc.name))
      totalToolCalls += toolCalls.length

      agentMessages = [
        ...agentMessages,
        llmResult.assistantMessage,
        ...buildToolResultMessages(taggedResults, provider),
      ]
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

    } finally {
      // Reset so the next chat's poll loop does not see a stale done:true state.
      if (activeStream === ss) activeStream = null
    }
  })
}

function buildToolResultsXml(results: ToolResult[], names: string[]): string {
  if (results.length === 0) return ''
  return results.map((r, i) => {
    const name = names[i] ?? 'tool'
    if (r.isError) return `<tool_result name="${name}" error="true">\n${r.content}\n</tool_result>`
    return `<tool_result name="${name}">\n${r.content.substring(0, 3000)}\n</tool_result>`
  }).join('\n\n')
}
