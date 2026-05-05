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
    return !!(settingsStore.get('codexmgx_enabled', false) as boolean) && !!this.scriptPath
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
      for (const [, { reject }] of this.pending) {
        reject(new Error('MCP server process exited'))
      }
      this.pending.clear()
    })
    this.process.on('error', (err) => {
      log.error('[MCP] Process error:', err)
    })

    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'hadron-electron', version: '5.0.0' },
    })

    this.sendNotification('notifications/initialized', {})

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
      } catch {
        // Non-JSON output (e.g. startup logs) — ignore
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

let instance: McpClient | null = null

export function getMcpClient(): McpClient {
  if (!instance) instance = new McpClient()
  return instance
}

export function shutdownMcpClient(): void {
  instance?.shutdown()
  instance = null
}

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
