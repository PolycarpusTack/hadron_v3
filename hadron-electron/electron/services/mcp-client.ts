import { spawn, ChildProcess } from 'child_process'
import path from 'path'
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

/**
 * Path to the bundled CodexMgX launcher script, valid in both dev and production.
 * In dev: process.resourcesPath = <project>/resources
 * In prod: process.resourcesPath = <installDir>/resources
 * Fallback: derive from __dirname (out/main → ../../resources) for safety.
 */
function getBundledScriptPath(): string {
  const resPath: string =
    (process as unknown as { resourcesPath?: string }).resourcesPath ??
    path.join(__dirname, '..', '..', 'resources')
  return path.join(resPath, 'codexmgx', 'scripts', 'start-codexmgx-mcp.ps1')
}

// Only the bundled script under resourcesPath/codexmgx/scripts may be spawned.
// Renderer-supplied overrides are discarded — they were a renderer→main RCE path.
function resolveSafeScriptPath(): string {
  const bundled = path.resolve(getBundledScriptPath())
  const override = (settingsStore.get('codexmgx_script_path', '') as string) || ''
  if (!override) return bundled
  const resolved = path.resolve(override)
  const allowedDir = path.resolve(path.dirname(bundled))
  const rel = path.relative(allowedDir, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return bundled
  if (!resolved.toLowerCase().endsWith('.ps1')) return bundled
  return resolved
}

class McpClient {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  // Raw buffer for Content-Length framing (never decoded as a whole string)
  private rawBuffer = Buffer.alloc(0)
  private initialized = false
  private initPromise: Promise<void> | null = null
  private tools: McpTool[] = []

  /** Effective script path — sanitised; never honours an arbitrary renderer override. */
  private get scriptPath(): string {
    return resolveSafeScriptPath()
  }

  /** Whether CodexMgX is enabled by the user. Bundled scripts are always present. */
  isConfigured(): boolean {
    return !!(settingsStore.get('codexmgx_enabled', false) as boolean)
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = this.start().finally(() => { this.initPromise = null })
    }
    return this.initPromise
  }

  private async start(): Promise<void> {
    const scriptPath = this.scriptPath
    log.info('[MCP] Spawning CodexMgX server:', scriptPath)

    this.process = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'AllSigned', '-File', scriptPath,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    // Work with raw Buffers — the server uses Content-Length framing where the
    // header byte count may differ from character count for non-ASCII JSON.
    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.rawBuffer = Buffer.concat([this.rawBuffer, chunk])
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
      for (const [, { reject }] of this.pending) {
        reject(err)
      }
      this.pending.clear()
      this.initialized = false
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

  /**
   * Parse LSP-style Content-Length framing from the raw byte buffer.
   * Format: "Content-Length: <n>\r\n\r\n<utf8-body>"
   */
  private processBuffer(): void {
    while (true) {
      // Look for the \r\n\r\n header terminator
      const headerEnd = this.rawBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break

      const headerStr = this.rawBuffer.slice(0, headerEnd).toString('ascii')
      const match = headerStr.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        // Malformed header — skip past the separator and try again
        this.rawBuffer = this.rawBuffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(match[1], 10)
      const bodyStart = headerEnd + 4

      const MAX_FRAME_BYTES = 10 * 1024 * 1024 // 10 MB
      if (contentLength > MAX_FRAME_BYTES) {
        log.error('[MCP] Oversized frame received, resetting buffer', { contentLength })
        this.rawBuffer = Buffer.alloc(0)
        break
      }

      if (this.rawBuffer.length < bodyStart + contentLength) break // incomplete, wait for more data

      const body = this.rawBuffer.slice(bodyStart, bodyStart + contentLength).toString('utf8')
      this.rawBuffer = this.rawBuffer.slice(bodyStart + contentLength)

      try {
        const msg = JSON.parse(body) as JsonRpcResponse
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
        // Non-JSON body (startup messages, etc.) — ignore
      }
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
      this.pending.set(id, { resolve, reject })
      try {
        this.writeFramed(req)
      } catch (e) {
        this.pending.delete(id)
        reject(e)
        return
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
    try {
      this.writeFramed({ jsonrpc: '2.0', method, params })
    } catch { /* ignore */ }
  }

  /** Write a single JSON-RPC message with Content-Length framing. */
  private writeFramed(msg: unknown): void {
    if (!this.process?.stdin) throw new Error('MCP process stdin not available')
    const bodyBytes = Buffer.from(JSON.stringify(msg), 'utf8')
    const header = Buffer.from(`Content-Length: ${bodyBytes.length}\r\n\r\n`, 'ascii')
    this.process.stdin.write(Buffer.concat([header, bodyBytes]))
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    await this.ensureInitialized()
    const requestPromise = this.sendRequest('tools/call', { name, arguments: args }) as Promise<{
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }>
    let result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }
    if (signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        if (signal.aborted) { reject(new Error('MCP tool call aborted')); return }
        signal.addEventListener('abort', () => reject(new Error('MCP tool call aborted')), { once: true })
      })
      result = await Promise.race([requestPromise, abortPromise])
    } else {
      result = await requestPromise
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
    const proc = this.process
    if (!proc) return
    // Null immediately so re-entrant calls and stale event handlers that
    // close over `this` cannot corrupt a new session started after restart.
    this.process = null
    this.initialized = false
    this.rawBuffer = Buffer.alloc(0)
    this.pending.clear()
    proc.stdout?.removeAllListeners()
    proc.stderr?.removeAllListeners()
    proc.removeAllListeners()
    if (process.platform === 'win32') {
      try {
        const killer = spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid!)], { windowsHide: true })
        killer.unref()
      } catch { /* ignore */ }
    } else {
      try { proc.stdin?.end() } catch { /* ignore */ }
      try { proc.kill() } catch { /* ignore */ }
    }
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

/**
 * Try to call a CodexMgX MCP tool. Returns null if MCP is disabled or the call fails.
 * Safe to call at any time — catches all errors internally.
 */
export async function tryMcpCallTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string | null> {
  const client = getMcpClient()
  if (!client.isConfigured()) return null
  try {
    return await client.callTool(name, args, signal)
  } catch (e) {
    log.warn(`[MCP] Tool ${name} failed:`, e instanceof Error ? e.message : e)
    return null
  }
}
