import { IpcMain, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { getSecret } from '../services/safe-storage'
import { getDb } from '../database'
import { callAi, listModels } from '../services/ai-service'
import { SERVICE_NAME } from '../services/jira-client'
import { getApiKeyFromKeeper, getKeeperUidForProvider } from './keeper'
import { isSystemPath } from '../services/path-security'
import { wrapField } from '../services/prompt-helpers'
import { aiRateLimiter } from '../services/rate-limiter'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_PROMPT_CHARS = 100_000
const OPENAI_400K_CRASH_LOG_CHARS = 320_000
const OPENAI_1M_CRASH_LOG_CHARS = 760_000
const DEFAULT_CRASH_LOG_CHARS = 140_000

interface ProgressState {
  phase: string; progress: number; message: string; current_step?: number; total_steps?: number
}
let analysisProgress: ProgressState = { phase: 'idle', progress: 0, message: '' }
function setProgress(p: ProgressState) { analysisProgress = p }

function defaultModelForProvider(provider: string): string {
  if (provider === 'openai') return 'gpt-5.4-mini'
  if (provider === 'anthropic') return 'claude-sonnet-4-0'
  if (provider === 'zai') return 'glm-4'
  return 'default'
}

function crashLogCharBudget(provider: string, model: string): number {
  if (provider === 'openai') {
    if (model === 'gpt-5.4-mini' || model === 'gpt-5.4-nano') return OPENAI_400K_CRASH_LOG_CHARS
    if (model.startsWith('gpt-5') || model.startsWith('gpt-4.1')) return OPENAI_1M_CRASH_LOG_CHARS
  }
  return DEFAULT_CRASH_LOG_CHARS
}

function compactCrashLog(content: string, budget: number): { content: string; wasTruncated: boolean } {
  if (content.length <= budget) return { content, wasTruncated: false }

  const markerBudget = 1_000
  const usableBudget = Math.max(20_000, budget - markerBudget)
  const headBudget = Math.floor(usableBudget * 0.35)
  const signalBudget = Math.floor(usableBudget * 0.30)
  const tailBudget = usableBudget - headBudget - signalBudget
  const head = content.slice(0, headBudget)
  const tail = content.slice(-tailBudget)

  const signalPatterns = /(exception|error|fatal|crash|stack|traceback|caused by|segfault|access violation|assert|panic|fail|timeout|oom|out of memory|thread|at\s+\S+\(|^\s*#\d+\s+)/i
  const signalLines: string[] = []
  let signalChars = 0
  for (const line of content.split(/\r?\n/)) {
    if (!signalPatterns.test(line)) continue
    const clippedLine = line.length > 1_000 ? `${line.slice(0, 1_000)} ...` : line
    if (signalChars + clippedLine.length + 1 > signalBudget) break
    signalLines.push(clippedLine)
    signalChars += clippedLine.length + 1
  }

  return {
    wasTruncated: true,
    content: [
      `[Hadron compacted this crash log from ${content.length.toLocaleString()} characters to fit the selected model context window.]`,
      '[BEGINNING OF LOG]',
      head,
      '[ERROR/STACK SIGNAL LINES]',
      signalLines.length > 0 ? signalLines.join('\n') : '[No distinct error/stack signal lines found.]',
      '[END OF LOG]',
      tail,
    ].join('\n\n'),
  }
}

async function resolveKey(provider: string, keeperSecretUid?: string | null): Promise<string> {
  const stored = getSecret(SERVICE_NAME, provider)
  if (stored) return stored
  if (keeperSecretUid) return getApiKeyFromKeeper(keeperSecretUid)
  throw new Error(`No API key configured for provider: ${provider}`)
}


const CRASH_SYSTEM_PROMPT = `You are an expert software engineer specialising in crash log analysis.
Analyse the provided crash log and return ONLY a valid JSON object — no markdown fences, no explanation.

The JSON must contain ALL of the following fields.
If a value cannot be determined from the log, use reasonable defaults (empty string, empty array, "unknown", "none", etc.).

=== FLAT FIELDS (required for database storage) ===
"error_type"     — exception class / error type string
"error_message"  — exact error message, or null
"severity"       — "CRITICAL", "HIGH", "MEDIUM", or "LOW"
"component"      — primary affected class, module, or component name
"root_cause"     — one-paragraph plain-English explanation (copy from rootCause.plainEnglish below)
"suggested_fixes"— array of 2–4 brief fix strings
"confidence"     — "HIGH", "MEDIUM", or "LOW"
"stack_trace"    — raw stack trace extracted from the log, or null

=== STRUCTURED ANALYSIS ===

"summary": {
  "title": "Concise crash title (≤12 words)",
  "severity": "critical|high|medium|low",
  "category": "scheduling|playout|database|memory|integration|ui|rights|timing|other",
  "confidence": "high|medium|low",
  "affectedWorkflow": "The user workflow that triggered the crash"
}

"rootCause": {
  "technical": "Developer-facing explanation — include class/method names, variable states, exact failure mode",
  "plainEnglish": "Support-engineer-facing explanation a non-developer can understand",
  "affectedMethod": "ClassName >> methodName: (or language-appropriate equivalent)",
  "affectedModule": "Module / subsystem short name or abbreviation",
  "triggerCondition": "The specific pre-condition that triggers this crash"
}

"userScenario": {
  "description": "Brief description of what the user was doing",
  "workflow": "Workflow name (e.g. 'Programme Planning')",
  "steps": [
    { "step": 1, "action": "What the user did", "isCrashPoint": false },
    { "step": 2, "action": "Where the system crashed", "isCrashPoint": true }
  ],
  "expectedResult": "What should have happened",
  "actualResult": "What actually happened — the crash",
  "reproductionLikelihood": "always|often|sometimes|rarely|unknown"
}

"suggestedFix": {
  "summary": "Brief description of the primary fix",
  "reasoning": "Why this fix addresses the root cause",
  "codeChanges": [
    {
      "file": "ClassName or filename",
      "description": "What to change",
      "before": "Code or state before the fix (optional)",
      "after": "Code or state after the fix (optional)",
      "priority": "P0"
    }
  ],
  "complexity": "simple|moderate|complex",
  "estimatedEffort": "hours|days|weeks",
  "riskLevel": "low|medium|high"
}

"systemWarnings": []

"impactAnalysis": {
  "dataAtRisk": "none|low|moderate|high|critical",
  "directlyAffected": [
    { "feature": "Feature name", "module": "Module", "description": "Impact", "severity": "high|medium|low" }
  ],
  "potentiallyAffected": []
}

"testScenarios": []

"environment": {
  "application": { "version": null, "build": null },
  "database": { "type": null, "connectionInfo": null }
}

Return only the JSON object. No markdown fences.`


export function registerAiHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('analyze_crash_log', async (event, args: {
    request?: {
      file_path: string; model: string; provider: string
      analysis_type?: string; redact_pii?: boolean; keeper_secret_uid?: string
      api_key?: string; use_rag?: boolean; analysis_mode?: string
    }
    file_path?: string; model?: string; provider?: string
    analysis_type?: string; redact_pii?: boolean; keeper_secret_uid?: string; api_key?: string
  }) => {
    const p = args.request ?? (args as {
      file_path: string; model: string; provider: string
      analysis_type?: string; redact_pii?: boolean; keeper_secret_uid?: string; api_key?: string
    })
    if (isSystemPath(p.file_path)) {
      throw new Error('Access denied: file path is not allowed')
    }
    if (!aiRateLimiter.tryAcquire('ai')) {
      throw new Error('Rate limit exceeded: too many AI requests. Please wait a moment.')
    }
    try {
      setProgress({ phase: 'reading', progress: 10, message: 'Reading file…', current_step: 1, total_steps: 4 })
      const start = Date.now()
      const stat = await fs.stat(p.file_path)
      if (stat.size > MAX_FILE_BYTES) throw new Error('File too large (max 10 MB)')
      const content = await fs.readFile(p.file_path, 'utf-8')
      const filename = path.basename(p.file_path)
      const fileSizeKb = content.length / 1024
      const apiKey = p.api_key || await resolveKey(p.provider, p.keeper_secret_uid)
      let compacted = compactCrashLog(content, crashLogCharBudget(p.provider, p.model))

      setProgress({ phase: 'analyzing', progress: 30, message: 'Sending to AI…', current_step: 2, total_steps: 4 })
      let resultText = ''
      let tokenCount = 0
      const win = BrowserWindow.fromWebContents(event.sender)

      const analyzeCompactedContent = () => callAi({
        provider: p.provider,
        model: p.model,
        apiKey,
        systemPrompt: CRASH_SYSTEM_PROMPT,
        userPrompt: `Analyze this crash log:\n\n${wrapField('FILENAME', filename)}\n\n${wrapField('CRASH_LOG', compacted.content)}`,
        maxTokens: 8192,
        stream: true,
        onChunk: (chunk) => {
          resultText += chunk
          tokenCount += chunk.length
          const streamPct = Math.min(30 + Math.floor((tokenCount / 3000) * 55), 85)
          setProgress({ phase: 'analyzing', progress: streamPct, message: 'Analyzing…', current_step: 2, total_steps: 4 })
          win?.webContents.send('stream:chunk', chunk)
        },
      })

      let result
      try {
        result = await analyzeCompactedContent()
      } catch (err) {
        const message = (err as Error).message
        if (!/context_length_exceeded|exceeds the context window|input exceeds/i.test(message)) throw err

        setProgress({ phase: 'analyzing', progress: 35, message: 'Compacting large log…', current_step: 2, total_steps: 4 })
        compacted = compactCrashLog(content, Math.floor(crashLogCharBudget(p.provider, p.model) / 2))
        resultText = ''
        tokenCount = 0
        result = await analyzeCompactedContent()
      }

      if (!resultText) resultText = result.content

      setProgress({ phase: 'saving', progress: 90, message: 'Saving result…', current_step: 3, total_steps: 4 })
      let parsed: Record<string, unknown>
      try {
        const jsonStr = resultText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
        parsed = JSON.parse(jsonStr)
      } catch {
        parsed = {
          error_type: 'Unknown',
          severity: 'MEDIUM',
          root_cause: resultText,
          suggested_fixes: [],
          confidence: 'LOW',
          stack_trace: null,
        }
      }

      const db = getDb()
      const now = new Date().toISOString()
      const row = db.prepare(`
        INSERT INTO analyses (filename, file_size_kb, error_type, error_message, severity, component,
          stack_trace, root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
          tokens_used, cost, was_truncated, analysis_duration_ms, full_data, analysis_type, source_type)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        filename, fileSizeKb,
        (parsed.error_type as string) ?? 'Unknown',
        (parsed.error_message as string) ?? null,
        ((parsed.severity as string) ?? 'MEDIUM').toUpperCase(),
        (parsed.component as string) ?? null,
        (parsed.stack_trace as string) ?? null,
        (parsed.root_cause as string) ?? '',
        JSON.stringify(parsed.suggested_fixes ?? []),
        (parsed.confidence as string) ?? 'MEDIUM',
        now,
        p.model, p.provider,
        result.inputTokens + result.outputTokens,
        result.cost, compacted.wasTruncated ? 1 : 0,
        Date.now() - start,
        JSON.stringify(parsed),
        p.analysis_type ?? 'comprehensive',
        'file',
      )

      setProgress({ phase: 'complete', progress: 100, message: 'Analysis complete', current_step: 4, total_steps: 4 })
      return {
        id: row.lastInsertRowid,
        ...parsed,
        analyzed_at: now,
        ai_model: p.model,
        ai_provider: p.provider,
        tokens_used: result.inputTokens + result.outputTokens,
        cost: result.cost,
      }
    } catch (err) {
      setProgress({ phase: 'failed', progress: 0, message: (err as Error).message })
      throw err
    } finally {
      setTimeout(() => { analysisProgress = { phase: 'idle', progress: 0, message: '' } }, 3000)
    }
  })

  ipcMain.handle('call_ai', async (_e, args: {
    provider: string
    model: string
    system_prompt?: string
    user_prompt?: string
    content?: string
    apiKey?: string
    keeperSecretUid?: string
    max_tokens?: number
  }) => {
    if (!aiRateLimiter.tryAcquire('ai')) {
      throw new Error('Rate limit exceeded: too many AI requests. Please wait a moment.')
    }
    const systemPrompt = args.system_prompt ?? ''
    const userPrompt = args.user_prompt ?? args.content ?? ''
    if ((systemPrompt.length + userPrompt.length) > MAX_PROMPT_CHARS) {
      throw new Error('Prompt too large (max 100KB combined)')
    }
    const apiKey = args.apiKey || await resolveKey(args.provider, args.keeperSecretUid)
    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey,
      systemPrompt,
      userPrompt,
      maxTokens: args.max_tokens ?? 4096,
    })
    // Return plain string — frontend callAi() is typed as Promise<string>
    return result.content
  })

  ipcMain.handle('translate_content', async (event, args: {
    content: string
    target_language?: string
    provider: string
    model: string
    keeper_secret_uid?: string | null
  }) => {
    if (!aiRateLimiter.tryAcquire('ai')) {
      throw new Error('Rate limit exceeded: too many AI requests. Please wait a moment.')
    }
    const apiKey = await resolveKey(args.provider, args.keeper_secret_uid)
    const lang = args.target_language ?? 'English'
    let translated = ''
    const win = BrowserWindow.fromWebContents(event.sender)

    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey,
      systemPrompt: `Translate the following text to ${lang}. Return only the translated text.`,
      userPrompt: args.content,
      stream: true,
      onChunk: (chunk) => {
        translated += chunk
        win?.webContents.send('stream:chunk', chunk)
      },
    })

    const db = getDb()
    const row = db.prepare(`
      INSERT INTO translations (input_content, translation, translated_at, ai_model, ai_provider)
      VALUES (?, ?, ?, ?, ?)
    `).run(args.content, translated, new Date().toISOString(), args.model, args.provider)

    return { id: row.lastInsertRowid, translation: translated, tokens_used: result.inputTokens + result.outputTokens }
  })

  ipcMain.handle('save_analysis', async (_e, args: {
    filename: string
    provider: string
    model: string
    analysis: Record<string, unknown>
    analysis_type?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`
      INSERT INTO analyses (filename, file_size_kb, error_type, error_message, severity, component,
        stack_trace, root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
        tokens_used, cost, was_truncated, full_data, analysis_type, source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      args.filename, 0,
      (args.analysis.error_type as string) ?? 'Unknown',
      null,
      ((args.analysis.severity as string) ?? 'MEDIUM').toUpperCase(),
      (args.analysis.component as string) ?? null,
      (args.analysis.stack_trace as string) ?? null,
      (args.analysis.root_cause as string) ?? '',
      JSON.stringify(args.analysis.suggested_fixes ?? []),
      (args.analysis.confidence as string) ?? 'MEDIUM',
      now,
      args.model, args.provider,
      0, 0, 0,
      JSON.stringify(args.analysis),
      args.analysis_type ?? 'comprehensive',
      'external',
    )
    return { id: row.lastInsertRowid }
  })

  ipcMain.handle('save_pasted_log', async (_e, args: { content: string; filename: string }) => {
    // SECURITY: cap content size so a malicious renderer cannot fill the
    // disk with a single IPC call. Same MAX_FILE_BYTES as analyze_crash_log
    // (10 MB) to keep the analyser pipeline coherent.
    if (typeof args.content !== 'string') throw new Error('content must be a string')
    if (Buffer.byteLength(args.content, 'utf-8') > MAX_FILE_BYTES) {
      throw new Error('Pasted content too large (max 10 MB)')
    }
    // Strip any path separators and produce a tame filename. We also reject
    // empty/`..` names and force a `.log` fallback if the input is unusable.
    const rawName = typeof args.filename === 'string' ? args.filename : ''
    let safeName = path.basename(rawName).replace(/[/\\:*?"<>|]/g, '_').slice(0, 128)
    if (!safeName || safeName === '.' || safeName === '..') safeName = 'pasted.log'
    // Generate a per-call unique prefix so concurrent saves never collide
    // and predictable filenames cannot be used to overwrite existing files
    // a different process placed under tmpdir.
    const unique = `hadron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
    const tmpPath = path.join(os.tmpdir(), unique)
    await fs.writeFile(tmpPath, args.content, { encoding: 'utf-8', flag: 'wx' })
    return { tmp_path: tmpPath }
  })

  ipcMain.handle('list_models', async (_e, args: { provider: string; apiKey?: string; keeperSecretUid?: string | null }) => {
    try {
      const key = args.apiKey || getSecret(SERVICE_NAME, args.provider) ||
        (args.keeperSecretUid ? await getApiKeyFromKeeper(args.keeperSecretUid) : '')
      return await listModels(args.provider, key)
    } catch { return [] }
  })

  ipcMain.handle('test_connection', async (_e, args: { provider: string; model?: string; apiKey?: string; keeperSecretUid?: string | null }) => {
    try {
      const key = args.apiKey || await resolveKey(args.provider, args.keeperSecretUid)
      await callAi({
        provider: args.provider,
        model: args.model ?? defaultModelForProvider(args.provider),
        apiKey: key,
        systemPrompt: 'You are a test.', userPrompt: 'Reply with "ok"', maxTokens: 10,
      })
      return { success: true, message: 'Connection successful' }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('get_analysis_progress', () => analysisProgress)

  ipcMain.handle('save_external_analysis', async (_e, args: {
    filename: string
    provider: string
    model: string
    analysis: Record<string, unknown>
    analysis_type: string
    source_type?: string
  }) => {
    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`
      INSERT INTO analyses (filename, file_size_kb, error_type, error_message, severity, component,
        stack_trace, root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
        tokens_used, cost, was_truncated, full_data, analysis_type, source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      args.filename, 0,
      (args.analysis.error_type as string) ?? 'Unknown',
      (args.analysis.error_message as string) ?? null,
      ((args.analysis.severity as string) ?? 'MEDIUM').toUpperCase(),
      (args.analysis.component as string) ?? null,
      (args.analysis.stack_trace as string) ?? null,
      (args.analysis.root_cause as string) ?? '',
      JSON.stringify(args.analysis.suggested_fixes ?? []),
      (args.analysis.confidence as string) ?? 'MEDIUM',
      now,
      args.model, args.provider,
      0, 0, 0,
      JSON.stringify(args.analysis),
      args.analysis_type,
      args.source_type ?? 'external',
    )
    return { id: row.lastInsertRowid }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // analyze_jira_ticket — AI analysis of JIRA ticket data
  // Returns AnalysisResponse shape to match frontend expectations.
  // ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('analyze_jira_ticket', async (_e, args: {
    request: {
      jira_key: string
      summary: string
      description?: string
      comments?: string[]
      priority?: string
      status?: string
      components?: string[]
      labels?: string[]
      api_key?: string
      keeper_secret_uid?: string | null
      model?: string
      provider?: string
      use_rag?: boolean
      use_kb?: boolean
      customer?: string
      won_version?: string
    }
  }) => {
    const p = args.request
    if (!aiRateLimiter.tryAcquire('ai')) {
      throw new Error('Rate limit exceeded: too many AI requests. Please wait a moment.')
    }
    const provider = p.provider ?? 'openai'
    const model = p.model ?? 'gpt-4o'
    let apiKey = p.api_key ?? ''
    if (!apiKey) apiKey = await resolveKey(provider, p.keeper_secret_uid)

    const userPrompt = [
      `JIRA Ticket: ${p.jira_key}`,
      `Summary: ${wrapField('SUMMARY', p.summary)}`,
      p.description ? `Description: ${wrapField('DESCRIPTION', p.description)}` : '',
      p.priority ? `Priority: ${p.priority}` : '',
      p.status ? `Status: ${p.status}` : '',
      p.components?.length ? `Components: ${p.components.join(', ')}` : '',
      p.labels?.length ? `Labels: ${p.labels.map(l => wrapField('LABEL', l)).join('\n')}` : '',
      p.comments?.length ? `Comments:\n${p.comments.map(c => wrapField('COMMENT', c)).join('\n')}` : '',
    ].filter(Boolean).join('\n')

    const now = new Date().toISOString()
    const start = Date.now()
    const result = await callAi({
      provider, model, apiKey,
      systemPrompt: JIRA_DEEP_SYSTEM_PROMPT,
      userPrompt: `Analyze this JIRA ticket:\n\n${userPrompt}`,
      maxTokens: 4096,
    })

    let parsed: Record<string, unknown>
    try {
      const jsonStr = result.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      parsed = { error_type: 'Unknown', severity: 'MEDIUM', root_cause: result.content, suggested_fixes: [], confidence: 'LOW', stack_trace: null }
    }

    const db = getDb()
    const row = db.prepare(`
      INSERT INTO analyses (filename, file_size_kb, error_type, error_message, severity, component,
        stack_trace, root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
        tokens_used, cost, was_truncated, analysis_duration_ms, full_data, analysis_type, source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      p.jira_key, 0,
      (parsed.error_type as string) ?? 'Unknown',
      null,
      ((parsed.severity as string) ?? 'MEDIUM').toUpperCase(),
      (parsed.component as string) ?? null,
      (parsed.stack_trace as string) ?? null,
      (parsed.root_cause as string) ?? '',
      JSON.stringify(parsed.suggested_fixes ?? []),
      (parsed.confidence as string) ?? 'MEDIUM',
      now, model, provider,
      result.inputTokens + result.outputTokens,
      result.cost, 0,
      Date.now() - start,
      JSON.stringify(parsed),
      'jira_ticket', 'jira',
    )

    return {
      id: Number(row.lastInsertRowid),
      filename: p.jira_key,
      error_type: (parsed.error_type as string) ?? 'Unknown',
      severity: ((parsed.severity as string) ?? 'medium').toLowerCase() as 'critical' | 'high' | 'medium' | 'low',
      root_cause: (parsed.root_cause as string) ?? '',
      suggested_fixes: (parsed.suggested_fixes as string[]) ?? [],
      analyzed_at: now,
      cost: result.cost,
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // analyze_jira_ticket_deep — structured deep analysis returning JiraDeepResult
  // ──────────────────────────────────────────────────────────────────────────
  const JIRA_DEEP_SYSTEM_PROMPT = `You are an expert software engineer analyzing JIRA tickets for the Mediagenix WHATS'ON broadcast management software.
Return ONLY valid JSON with this exact structure:
{
  "plain_summary": "string — one sentence non-technical summary",
  "quality": { "score": 0-100, "verdict": "Good|Needs Work|Poor", "strengths": ["..."], "gaps": ["..."] },
  "technical": { "root_cause": "string", "affected_areas": ["..."], "error_type": "string", "severity_estimate": "Critical|High|Medium|Low", "confidence": "High|Medium|Low", "confidence_rationale": "string" },
  "open_questions": ["..."],
  "recommended_actions": [{ "priority": "Immediate|Short-term|Long-term", "action": "string", "rationale": "string" }],
  "risk": { "user_impact": "string", "blast_radius": "string", "urgency": "string", "do_nothing_risk": "string" }
}
Return only valid JSON, no markdown fences.`

  ipcMain.handle('analyze_jira_ticket_deep', async (_e, args: {
    request: {
      jira_key: string
      summary: string
      description?: string
      issue_type?: string
      priority?: string
      status?: string
      components?: string[]
      labels?: string[]
      comments?: string[]
      model?: string
      provider?: string
      keeper_secret_uid?: string | null
    }
  }) => {
    const p = args.request
    if (!aiRateLimiter.tryAcquire('ai')) {
      throw new Error('Rate limit exceeded: too many AI requests. Please wait a moment.')
    }
    const provider = p.provider ?? 'openai'
    const model = p.model ?? 'gpt-4o'
    const apiKey = await resolveKey(provider, p.keeper_secret_uid)

    const userPrompt = [
      `JIRA Ticket: ${p.jira_key}`,
      `Issue Type: ${p.issue_type ?? 'Unknown'}`,
      `Summary: ${wrapField('SUMMARY', p.summary)}`,
      p.description ? `Description: ${wrapField('DESCRIPTION', p.description)}` : '',
      p.priority ? `Priority: ${p.priority}` : '',
      p.status ? `Status: ${p.status}` : '',
      p.components?.length ? `Components: ${p.components.join(', ')}` : '',
      p.labels?.length ? `Labels: ${p.labels.map(l => wrapField('LABEL', l)).join('\n')}` : '',
      p.comments?.length ? `Comments:\n${p.comments.map(c => wrapField('COMMENT', c)).join('\n')}` : '',
    ].filter(Boolean).join('\n')

    const result = await callAi({
      provider, model, apiKey,
      systemPrompt: JIRA_DEEP_SYSTEM_PROMPT,
      userPrompt: `Perform deep analysis of this JIRA ticket:\n\n${userPrompt}`,
      maxTokens: 4096,
    })

    let deepResult: Record<string, unknown>
    try {
      const jsonStr = result.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      deepResult = JSON.parse(jsonStr)
    } catch {
      deepResult = {
        plain_summary: result.content,
        quality: { score: 0, verdict: 'Poor', strengths: [], gaps: ['Analysis failed'] },
        technical: { root_cause: result.content, affected_areas: [], error_type: 'Unknown', severity_estimate: 'Medium', confidence: 'Low', confidence_rationale: 'Parse error' },
        open_questions: [],
        recommended_actions: [],
        risk: { user_impact: 'Unknown', blast_radius: 'Unknown', urgency: 'Unknown', do_nothing_risk: 'Unknown' },
      }
    }

    const db = getDb()
    const now = new Date().toISOString()
    const row = db.prepare(`
      INSERT INTO analyses (filename, file_size_kb, error_type, error_message, severity, component,
        stack_trace, root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
        tokens_used, cost, was_truncated, full_data, analysis_type, source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      p.jira_key, 0,
      ((deepResult.technical as Record<string, unknown>)?.error_type as string) ?? 'Unknown',
      null,
      (((deepResult.technical as Record<string, unknown>)?.severity_estimate as string) ?? 'MEDIUM').toUpperCase(),
      null, null,
      ((deepResult.technical as Record<string, unknown>)?.root_cause as string) ?? '',
      JSON.stringify([]),
      ((deepResult.technical as Record<string, unknown>)?.confidence as string) ?? 'MEDIUM',
      now, model, provider,
      result.inputTokens + result.outputTokens,
      result.cost, 0,
      JSON.stringify(deepResult),
      'jira_deep', 'jira',
    )

    return { id: Number(row.lastInsertRowid), result: deepResult }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // analyze_performance_trace — read trace file and AI-analyze it
  // Returns PerformanceAnalysisResult shape (snake_case per component's local types).
  // ──────────────────────────────────────────────────────────────────────────
  const PERF_SYSTEM_PROMPT = `You are an expert at analyzing VisualWorks Smalltalk performance trace logs for WHATS'ON broadcast management software.
Return ONLY valid JSON with this structure (snake_case fields):
{
  "user": "username extracted from trace header or Unknown",
  "timestamp": "datetime string from trace header",
  "header": { "samples": 0, "avg_ms_per_sample": 0.0, "scavenges": 0, "inc_gcs": 0, "stack_spills": 0, "mark_stack_overflows": 0, "weak_list_overflows": 0, "jit_cache_spills": 0, "active_time": 0.0, "other_processes": 0.0, "real_time": 0.0, "profiling_overhead": 0.0 },
  "derived": { "cpu_utilization": 0.0, "smalltalk_activity_ratio": 0.0, "sample_density": 0.0, "gc_pressure": 0.0 },
  "processes": [{ "name": "string", "priority": 0, "percentage": 0.0, "status": "normal|warning|error" }],
  "top_methods": [{ "method": "string", "percentage": 0.0, "category": "string" }],
  "patterns": [{ "type": "string", "severity": "critical|high|medium|low|info", "title": "string", "description": "string", "confidence": 0 }],
  "scenario": { "trigger": "string", "action": "string", "context": "string", "impact": "string", "additional_factors": ["..."] },
  "recommendations": [{ "type": "optimization|workaround|investigation|configuration|documentation", "priority": "high|medium|low", "title": "string", "description": "string", "effort": "Low|Medium|High" }],
  "overall_severity": "critical|high|medium|low|info",
  "summary": "2-3 sentence technical summary of the trace"
}
Return only valid JSON, no markdown fences.`

  ipcMain.handle('analyze_performance_trace', async (_e, args: { filePath: string }) => {
    if (isSystemPath(args.filePath)) throw new Error('Access denied: file path is not allowed')
    if (!aiRateLimiter.tryAcquire('ai')) {
      throw new Error('Rate limit exceeded: too many AI requests. Please wait a moment.')
    }
    const stat = await fs.stat(args.filePath)
    if (stat.size > MAX_FILE_BYTES) throw new Error('File too large (max 10 MB)')
    const content = await fs.readFile(args.filePath, 'utf-8')
    const filename = path.basename(args.filePath)

    // No provider/model sent by frontend — pick the first configured one (direct then Keeper)
    const FALLBACK_PROVIDERS: Array<[string, string]> = [
      ['openai', 'gpt-5.4-mini'],
      ['anthropic', 'claude-sonnet-4-0'],
    ]
    let provider: string | null = null
    let model: string | null = null
    let apiKey = ''
    for (const [p, m] of FALLBACK_PROVIDERS) {
      const direct = getSecret(SERVICE_NAME, p)
      if (direct) { provider = p; model = m; apiKey = direct; break }
    }
    if (!provider) {
      for (const [p, m] of FALLBACK_PROVIDERS) {
        const uid = getKeeperUidForProvider(p)
        if (uid) {
          try { apiKey = await getApiKeyFromKeeper(uid); provider = p; model = m; break } catch { /* try next */ }
        }
      }
    }
    if (!provider || !model || !apiKey) throw new Error('No AI provider configured. Add an API key in Settings.')

    const result = await callAi({
      provider, model, apiKey,
      systemPrompt: PERF_SYSTEM_PROMPT,
      userPrompt: `Analyze this performance trace file:\n\n${wrapField('FILENAME', filename)}\n\n${wrapField('TRACE_CONTENT', content.substring(0, MAX_PROMPT_CHARS))}`,
      maxTokens: 4096,
    })

    let parsed: Record<string, unknown>
    try {
      const jsonStr = result.content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      parsed = {
        user: 'Unknown', timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        header: { samples: 0, avg_ms_per_sample: 0, scavenges: 0, inc_gcs: 0, stack_spills: 0, mark_stack_overflows: 0, weak_list_overflows: 0, jit_cache_spills: 0, active_time: 0, other_processes: 0, real_time: 0, profiling_overhead: 0 },
        derived: { cpu_utilization: 0, smalltalk_activity_ratio: 0, sample_density: 0, gc_pressure: 0 },
        processes: [], top_methods: [],
        patterns: [{ type: 'error', severity: 'high', title: 'Parse Error', description: result.content, confidence: 0 }],
        scenario: { trigger: 'N/A', action: 'Analysis could not be parsed', context: filename, impact: 'Unknown', additional_factors: [] },
        recommendations: [],
        overall_severity: 'high',
        summary: 'Could not parse AI response for performance trace analysis.',
      }
    }

    return { filename, ...parsed }
  })
}
