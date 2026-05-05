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
    })
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
    })
    content = msg.content.map(b => b.type === 'text' ? b.text : '').join('')
    inputTokens = msg.usage.input_tokens
    outputTokens = msg.usage.output_tokens
  }

  return { content, inputTokens, outputTokens, cost: estimateCost('anthropic', inputTokens, outputTokens), model: opts.model }
}

async function callOpenAi(opts: AiCallOptions): Promise<AiCallResult> {
  const { default: fetch } = await import('node-fetch')
  const openAiMessages = opts.messages
    ? [{ role: 'system', content: opts.systemPrompt }, ...opts.messages.filter(m => m.role !== 'system')]
    : [{ role: 'system', content: opts.systemPrompt }, { role: 'user', content: opts.userPrompt }]
  const isOSeries = /^o[1-9]/.test(opts.model)
  const tokenParam = isOSeries ? 'max_completion_tokens' : 'max_tokens'
  const body = JSON.stringify({
    model: opts.model,
    [tokenParam]: opts.maxTokens ?? 8192,
    messages: openAiMessages,
    stream: false,
  })

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body,
  })
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)
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
}

// Context window sizes (tokens) for known OpenAI model families.
// Used for display only — the actual limit is enforced by the API.
function openAiContext(id: string): number | undefined {
  if (/^o[1-9]/.test(id)) return 200_000          // o1, o3, o4 reasoning family
  if (id.includes('gpt-4o'))      return 128_000
  if (id.includes('gpt-4-turbo')) return 128_000
  if (id.includes('gpt-4-32k'))   return 32_000
  if (/^gpt-4/.test(id))          return 8_000
  if (id.includes('gpt-3.5-turbo-16k')) return 16_000
  if (id.includes('gpt-3.5'))     return 16_000
  return undefined
}

export async function listModels(provider: string, apiKey: string): Promise<ProviderModel[]> {
  if (provider === 'anthropic') {
    return [
      { id: 'claude-opus-4-20250514',    label: 'Claude Opus 4',     context: 200_000, category: 'claude-4' },
      { id: 'claude-sonnet-4-20250514',  label: 'Claude Sonnet 4',   context: 200_000, category: 'claude-4' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  context: 200_000, category: 'claude-4' },
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
      return data.data
        .map(m => m.id)
        .filter(id =>
          id.startsWith('gpt') ||
          id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')
        )
        .sort()
        .map(id => ({ id, label: id, context: openAiContext(id) }))
    } catch (e) {
      log.warn('Failed to list OpenAI models', e)
      return [
        { id: 'gpt-4o',       label: 'gpt-4o',       context: 128_000 },
        { id: 'gpt-4o-mini',  label: 'gpt-4o-mini',  context: 128_000 },
        { id: 'gpt-4-turbo',  label: 'gpt-4-turbo',  context: 128_000 },
      ]
    }
  }
  return []
}
