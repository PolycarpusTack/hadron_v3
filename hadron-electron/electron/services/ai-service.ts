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
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8192,
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

export async function listModels(provider: string, apiKey: string): Promise<string[]> {
  if (provider === 'anthropic') {
    return [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ]
  }
  if (provider === 'openai') {
    try {
      const { default: fetch } = await import('node-fetch')
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      const data = await res.json() as { data: Array<{ id: string }> }
      return data.data.map(m => m.id).filter(id => id.startsWith('gpt')).sort()
    } catch (e) {
      log.warn('Failed to list OpenAI models', e)
      return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
    }
  }
  return []
}
