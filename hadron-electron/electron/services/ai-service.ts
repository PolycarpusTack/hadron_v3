import Anthropic from '@anthropic-ai/sdk'
import log from 'electron-log'

export interface AiCallOptions {
  provider: string
  model: string
  apiKey: string
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  stream?: boolean
  onChunk?: (text: string) => void
  messages?: Array<{ role: string; content: string }>
  signal?: AbortSignal
}

export interface AiCallResult {
  content: string
  inputTokens: number
  outputTokens: number
  cost: number
  model: string
}

function estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
  if (provider === 'anthropic') {
    return (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0
  }
  if (provider === 'openai') {
    return (inputTokens / 1_000_000) * 5.0 + (outputTokens / 1_000_000) * 15.0
  }
  return 0
}

type OpenAiEndpoint = 'responses' | 'chat_completions'

interface OpenAiModelCapability {
  id: string
  label: string
  context: number
  maxOutputTokens: number
  preferredEndpoint: OpenAiEndpoint
  category: string
  suitableForHadron: boolean
  supportsStreaming: boolean
  supportsReasoningEffort: boolean
  supportsStructuredOutput: boolean
}

// Hadron routinely sends 500-600 KB text files and can approach 1 MB, so the
// default OpenAI picker only exposes text models with at least a 400K context.
const OPENAI_HADRON_MODELS: OpenAiModelCapability[] = [
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5 (Best)',
    context: 1_000_000,
    maxOutputTokens: 128_000,
    preferredEndpoint: 'responses',
    category: 'recommended',
    suitableForHadron: true,
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsStructuredOutput: true,
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4 (Recommended)',
    context: 1_000_000,
    maxOutputTokens: 128_000,
    preferredEndpoint: 'responses',
    category: 'recommended',
    suitableForHadron: true,
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsStructuredOutput: true,
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini (Default)',
    context: 400_000,
    maxOutputTokens: 128_000,
    preferredEndpoint: 'responses',
    category: 'fast',
    suitableForHadron: true,
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsStructuredOutput: true,
  },
  {
    id: 'gpt-5.4-nano',
    label: 'GPT-5.4 Nano (Cheapest)',
    context: 400_000,
    maxOutputTokens: 128_000,
    preferredEndpoint: 'responses',
    category: 'cheap',
    suitableForHadron: true,
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsStructuredOutput: true,
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1 (Large Context)',
    context: 1_047_576,
    maxOutputTokens: 32_768,
    preferredEndpoint: 'responses',
    category: 'large-context',
    suitableForHadron: true,
    supportsStreaming: true,
    supportsReasoningEffort: false,
    supportsStructuredOutput: true,
  },
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 Mini (Large Context)',
    context: 1_047_576,
    maxOutputTokens: 32_768,
    preferredEndpoint: 'responses',
    category: 'fast',
    suitableForHadron: true,
    supportsStreaming: true,
    supportsReasoningEffort: false,
    supportsStructuredOutput: true,
  },
  {
    id: 'gpt-4.1-nano',
    label: 'GPT-4.1 Nano (Large Context)',
    context: 1_047_576,
    maxOutputTokens: 32_768,
    preferredEndpoint: 'responses',
    category: 'cheap',
    suitableForHadron: true,
    supportsStreaming: true,
    supportsReasoningEffort: false,
    supportsStructuredOutput: true,
  },
]

const OPENAI_HADRON_MODEL_BY_ID = new Map(OPENAI_HADRON_MODELS.map(model => [model.id, model]))

function openAiModelCapability(model: string): OpenAiModelCapability | undefined {
  const known = OPENAI_HADRON_MODEL_BY_ID.get(model)
  if (known) return known

  if (/^gpt-5(\.|-|$)/.test(model)) {
    return {
      id: model,
      label: model,
      context: 400_000,
      maxOutputTokens: 128_000,
      preferredEndpoint: 'responses',
      category: 'custom',
      suitableForHadron: true,
      supportsStreaming: true,
      supportsReasoningEffort: true,
      supportsStructuredOutput: true,
    }
  }

  if (/^gpt-4\.1/.test(model)) {
    return {
      id: model,
      label: model,
      context: 1_047_576,
      maxOutputTokens: 32_768,
      preferredEndpoint: 'responses',
      category: 'custom',
      suitableForHadron: true,
      supportsStreaming: true,
      supportsReasoningEffort: false,
      supportsStructuredOutput: true,
    }
  }

  return undefined
}

function openAiChatCompletionsTokenParam(model: string): 'max_tokens' | 'max_completion_tokens' {
  return /^(gpt-5|o[1-9])/.test(model) ? 'max_completion_tokens' : 'max_tokens'
}

export async function callAi(opts: AiCallOptions): Promise<AiCallResult> {
  if (opts.provider === 'anthropic') return callAnthropic(opts)
  if (opts.provider === 'openai') return callOpenAi(opts)
  if (opts.provider === 'zai') return callZai(opts)
  throw new Error(`Unsupported provider: ${opts.provider}`)
}

async function callAnthropic(opts: AiCallOptions): Promise<AiCallResult> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  let content = ''
  let inputTokens = 0
  let outputTokens = 0

  const anthropicMessages = opts.messages
    ? opts.messages.filter(m => m.role !== 'system') as Array<{ role: 'user' | 'assistant'; content: string }>
    : [{ role: 'user' as const, content: opts.userPrompt }]

  if (opts.stream && opts.onChunk) {
    const stream = client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.systemPrompt,
      messages: anthropicMessages,
    }, { signal: opts.signal })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        content += event.delta.text
        opts.onChunk(event.delta.text)
      }
    }
    const msg = await stream.finalMessage()
    inputTokens = msg.usage.input_tokens
    outputTokens = msg.usage.output_tokens
  } else {
    const msg = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.systemPrompt,
      messages: anthropicMessages,
    }, { signal: opts.signal })
    content = msg.content.map(b => b.type === 'text' ? b.text : '').join('')
    inputTokens = msg.usage.input_tokens
    outputTokens = msg.usage.output_tokens
  }

  return { content, inputTokens, outputTokens, cost: estimateCost('anthropic', inputTokens, outputTokens), model: opts.model }
}

async function callOpenAiResponsesApi(opts: AiCallOptions): Promise<AiCallResult> {
  const { default: fetch } = await import('node-fetch')
  const inputMessages = opts.messages
    ? opts.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: opts.userPrompt }]

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      instructions: opts.systemPrompt,
      input: inputMessages,
      max_output_tokens: opts.maxTokens ?? 8192,
    }),
    signal: opts.signal ?? null,
  })
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)
  const data = await res.json() as {
    output: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>
    usage: { input_tokens: number; output_tokens: number }
  }
  const content = (data.output ?? [])
    .filter(o => o.type === 'message')
    .flatMap(o => o.content ?? [])
    .filter(c => c.type === 'output_text')
    .map(c => c.text ?? '')
    .join('')
  return {
    content,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    cost: estimateCost('openai', data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0),
    model: opts.model,
  }
}

async function callOpenAi(opts: AiCallOptions): Promise<AiCallResult> {
  const capability = openAiModelCapability(opts.model)
  if (capability?.preferredEndpoint === 'responses' || /^(o3(?!-mini)|o4)/.test(opts.model)) {
    return callOpenAiResponsesApi(opts)
  }

  const { default: fetch } = await import('node-fetch')
  const openAiMessages = opts.messages
    ? [{ role: 'system', content: opts.systemPrompt }, ...opts.messages.filter(m => m.role !== 'system')]
    : [{ role: 'system', content: opts.systemPrompt }, { role: 'user', content: opts.userPrompt }]
  const isOSeries = /^o[1-9]/.test(opts.model)
  const tokenParam = openAiChatCompletionsTokenParam(opts.model)
  // o-series reasoning models don't support streaming
  const useStream = !isOSeries && opts.stream && !!opts.onChunk

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      [tokenParam]: opts.maxTokens ?? 8192,
      messages: openAiMessages,
      stream: useStream,
      ...(useStream ? { stream_options: { include_usage: true } } : {}),
    }),
    signal: opts.signal ?? null,
  })
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)

  if (useStream) {
    let content = ''
    let inputTokens = 0
    let outputTokens = 0
    let buffer = ''
    // node-fetch body is a NodeJS.ReadableStream
    await new Promise<void>((resolve, reject) => {
      res.body!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const payload = trimmed.slice(6)
          if (payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload) as {
              choices: Array<{ delta: { content?: string } }>
              usage?: { prompt_tokens: number; completion_tokens: number }
            }
            const delta = parsed.choices[0]?.delta?.content
            if (delta) { content += delta; opts.onChunk!(delta) }
            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens
              outputTokens = parsed.usage.completion_tokens
            }
          } catch { /* ignore malformed SSE lines */ }
        }
      })
      res.body!.on('end', resolve)
      res.body!.on('error', reject)
    })
    return { content, inputTokens, outputTokens, cost: estimateCost('openai', inputTokens, outputTokens), model: opts.model }
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number }
  }
  const content = data.choices[0]?.message?.content ?? ''
  return {
    content,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
    cost: estimateCost('openai', data.usage.prompt_tokens, data.usage.completion_tokens),
    model: opts.model,
  }
}

async function callZai(opts: AiCallOptions): Promise<AiCallResult> {
  const { default: fetch } = await import('node-fetch')
  const zaiMessages = opts.messages
    ? [{ role: 'system', content: opts.systemPrompt }, ...opts.messages.filter(m => m.role !== 'system')]
    : [{ role: 'system', content: opts.systemPrompt }, { role: 'user', content: opts.userPrompt }]
  const res = await fetch('https://api.zai.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      messages: zaiMessages,
    }),
  })
  if (!res.ok) throw new Error(`ZAI error ${res.status}: ${await res.text()}`)
  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>
    usage?: { prompt_tokens: number; completion_tokens: number }
  }
  return {
    content: data.choices[0]?.message?.content ?? '',
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    cost: 0,
    model: opts.model,
  }
}

export interface ProviderModel {
  id: string
  label: string
  context?: number
  category?: string
  maxOutputTokens?: number
  preferredEndpoint?: OpenAiEndpoint
  suitableForHadron?: boolean
  supportsStreaming?: boolean
  supportsReasoningEffort?: boolean
  supportsStructuredOutput?: boolean
}

export async function listModels(provider: string, apiKey: string): Promise<ProviderModel[]> {
  if (provider === 'anthropic') {
    return [
      { id: 'claude-sonnet-4-0',         label: 'Claude Sonnet 4',   context: 200_000, category: 'claude-4' },
      { id: 'claude-opus-4-1-20250805',  label: 'Claude Opus 4.1',   context: 200_000, category: 'claude-4' },
      { id: 'claude-opus-4-20250514',    label: 'Claude Opus 4',     context: 200_000, category: 'claude-4' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', context: 200_000, category: 'claude-3' },
      { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku',  context: 200_000, category: 'claude-3' },
      { id: 'claude-3-opus-20240229',     label: 'Claude 3 Opus',     context: 200_000, category: 'claude-3' },
      { id: 'claude-3-haiku-20240307',    label: 'Claude 3 Haiku',    context: 200_000, category: 'claude-3' },
    ]
  }
  if (provider === 'openai') {
    try {
      const { default: fetch } = await import('node-fetch')
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const data = await res.json() as { data: Array<{ id: string }> }
      const availableIds = new Set(data.data.map(m => m.id))
      const suitableModels = OPENAI_HADRON_MODELS.filter(model => availableIds.has(model.id))
      if (suitableModels.length > 0) return suitableModels

      log.warn('No curated Hadron-suitable OpenAI models were present in /v1/models; using curated fallback list')
      return OPENAI_HADRON_MODELS
    } catch (e) {
      log.warn('Failed to list OpenAI models', e)
      return OPENAI_HADRON_MODELS
    }
  }
  return []
}

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

export interface AiToolCallResult {
  wantsTools: boolean
  toolCalls: ToolCall[]
  assistantMessage: unknown
  content: string
  inputTokens: number
  outputTokens: number
}

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
  return results.map(r => ({
    role: 'tool',
    tool_call_id: r.toolUseId,
    content: r.content,
  }))
}

async function callAiWithToolsAnthropic(opts: {
  messages: unknown[]
  tools: ToolDefinition[]
  systemPrompt: string
  model: string
  apiKey: string
  maxTokens?: number
  signal?: AbortSignal
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
  }, { signal: opts.signal })

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

  return {
    wantsTools,
    toolCalls,
    assistantMessage: { role: 'assistant', content: resp.content },
    content,
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
  }
}

async function callAiWithToolsOpenAi(opts: {
  messages: unknown[]
  tools: ToolDefinition[]
  systemPrompt: string
  model: string
  apiKey: string
  maxTokens?: number
  signal?: AbortSignal
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
  const tokenParam = openAiChatCompletionsTokenParam(opts.model)

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      [tokenParam]: opts.maxTokens ?? 4000,
      messages: openAiMessages,
      tools: openAiTools,
      tool_choice: 'auto',
    }),
    signal: opts.signal ?? null,
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

export async function callAiWithTools(opts: {
  provider: string
  model: string
  apiKey: string
  systemPrompt: string
  messages: unknown[]
  tools: ToolDefinition[]
  maxTokens?: number
  signal?: AbortSignal
}): Promise<AiToolCallResult> {
  if (opts.provider === 'anthropic') return callAiWithToolsAnthropic(opts)
  return callAiWithToolsOpenAi(opts)
}

export async function callAiStreaming(opts: {
  provider: string
  model: string
  apiKey: string
  systemPrompt: string
  messages: unknown[]
  maxTokens?: number
  onChunk: (text: string) => void
  signal?: AbortSignal
}): Promise<{ content: string; inputTokens: number; outputTokens: number; cost: number }> {
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
    signal: opts.signal,
  })
  return { content: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost: result.cost }
}
