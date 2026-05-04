import { IpcMain, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import log from 'electron-log'
import { getSecret } from '../services/safe-storage'
import { getDb } from '../database'
import { callAi, listModels } from '../services/ai-service'

const SERVICE_NAME = 'hadron-electron'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_PROMPT_CHARS = 100_000

function getKey(provider: string): string {
  const key = getSecret(SERVICE_NAME, provider)
  if (!key) throw new Error(`No API key configured for provider: ${provider}`)
  return key
}

function isSafePath(filePath: string): boolean {
  const normalized = path.resolve(filePath)
  const dangerous = [
    '/etc', '/sys', '/proc', '/root',
    'C:\\Windows', 'C:\\System32',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE as string, '.ssh') : '',
    path.join(os.homedir(), '.ssh'),
    path.join(os.homedir(), '.gnupg'),
  ].filter(Boolean)
  return !dangerous.some(d => normalized.startsWith(d))
}

const CRASH_SYSTEM_PROMPT = `You are an expert software engineer specializing in crash log analysis.
Analyze the provided crash log and return a JSON response with this exact structure:
{
  "error_type": "string",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "component": "string",
  "root_cause": "string",
  "suggested_fixes": ["fix1", "fix2"],
  "confidence": "HIGH|MEDIUM|LOW",
  "stack_trace": "string"
}
Return only valid JSON, no markdown fences.`


export function registerAiHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('analyze_crash_log', async (event, args: {
    file_path: string
    model: string
    provider: string
    analysis_type?: string
    redact_pii?: boolean
  }) => {
    if (!isSafePath(args.file_path)) {
      throw new Error('Access denied: file path is not allowed')
    }
    const start = Date.now()
    const stat = await fs.stat(args.file_path)
    if (stat.size > MAX_FILE_BYTES) throw new Error('File too large (max 10 MB)')
    const content = await fs.readFile(args.file_path, 'utf-8')
    const filename = path.basename(args.file_path)
    const fileSizeKb = content.length / 1024
    const apiKey = await getKey(args.provider)

    let resultText = ''
    const win = BrowserWindow.fromWebContents(event.sender)

    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey,
      systemPrompt: CRASH_SYSTEM_PROMPT,
      userPrompt: `Analyze this crash log:\n\nFilename: ${filename}\n\n${content}`,
      maxTokens: 4096,
      stream: true,
      onChunk: (chunk) => {
        resultText += chunk
        win?.webContents.send('stream:chunk', chunk)
      },
    })

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
      null,
      ((parsed.severity as string) ?? 'MEDIUM').toUpperCase(),
      (parsed.component as string) ?? null,
      (parsed.stack_trace as string) ?? null,
      (parsed.root_cause as string) ?? '',
      JSON.stringify(parsed.suggested_fixes ?? []),
      (parsed.confidence as string) ?? 'MEDIUM',
      now,
      args.model, args.provider,
      result.inputTokens + result.outputTokens,
      result.cost, 0,
      Date.now() - start,
      JSON.stringify(parsed),
      args.analysis_type ?? 'comprehensive',
      'file',
    )

    return {
      id: row.lastInsertRowid,
      ...parsed,
      analyzed_at: now,
      ai_model: args.model,
      ai_provider: args.provider,
      tokens_used: result.inputTokens + result.outputTokens,
      cost: result.cost,
    }
  })

  ipcMain.handle('call_ai', async (_e, args: {
    provider: string
    model: string
    system_prompt: string
    user_prompt: string
    max_tokens?: number
  }) => {
    if ((args.system_prompt?.length ?? 0) + (args.user_prompt?.length ?? 0) > MAX_PROMPT_CHARS) {
      throw new Error('Prompt too large (max 100KB combined)')
    }
    const apiKey = await getKey(args.provider)
    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey,
      systemPrompt: args.system_prompt,
      userPrompt: args.user_prompt,
      maxTokens: args.max_tokens ?? 4096,
    })
    return { content: result.content, tokens_used: result.inputTokens + result.outputTokens, cost: result.cost }
  })

  ipcMain.handle('translate_content', async (event, args: {
    content: string
    target_language?: string
    provider: string
    model: string
  }) => {
    const apiKey = await getKey(args.provider)
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
    const tmpPath = path.join(os.tmpdir(), args.filename)
    await fs.writeFile(tmpPath, args.content, 'utf-8')
    return { tmp_path: tmpPath }
  })

  ipcMain.handle('list_models', async (_e, args: { provider: string }) => {
    try {
      const apiKey = getSecret(SERVICE_NAME, args.provider) ?? ''
      return await listModels(args.provider, apiKey)
    } catch { return [] }
  })

  ipcMain.handle('test_connection', async (_e, args: { provider: string; model: string }) => {
    try {
      const apiKey = await getKey(args.provider)
      await callAi({
        provider: args.provider, model: args.model, apiKey,
        systemPrompt: 'You are a test.', userPrompt: 'Reply with "ok"', maxTokens: 10,
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('get_analysis_progress', () => {
    return { phase: 'idle', progress: 0 }
  })

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
}
