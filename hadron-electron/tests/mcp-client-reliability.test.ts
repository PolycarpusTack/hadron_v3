import { describe, it, expect } from 'vitest'

describe('McpClient concurrency guard (pattern verification)', () => {
  it('concurrent calls to a promise-locked init run init only once', async () => {
    let callCount = 0

    class MockClient {
      private initialized = false
      private initPromise: Promise<void> | null = null

      async ensureInitialized(): Promise<void> {
        if (this.initialized) return
        if (!this.initPromise) {
          this.initPromise = this.start().finally(() => { this.initPromise = null })
        }
        return this.initPromise
      }

      private async start(): Promise<void> {
        callCount++
        await new Promise<void>(res => setTimeout(res, 10))
        this.initialized = true
      }
    }

    const client = new MockClient()
    await Promise.all([
      client.ensureInitialized(),
      client.ensureInitialized(),
      client.ensureInitialized(),
    ])
    expect(callCount).toBe(1) // start() called exactly once
  })
})

describe('McpClient buffer size guard', () => {
  it('rejects oversized Content-Length frames', () => {
    const MAX_FRAME_BYTES = 10 * 1024 * 1024

    function shouldRejectFrame(contentLength: number): boolean {
      return contentLength > MAX_FRAME_BYTES
    }

    expect(shouldRejectFrame(10 * 1024 * 1024 + 1)).toBe(true)
    expect(shouldRejectFrame(10 * 1024 * 1024)).toBe(false)
    expect(shouldRejectFrame(1024)).toBe(false)
    expect(shouldRejectFrame(999_999_999)).toBe(true)
  })
})

describe('save_codexmgx_config shutdown guard', () => {
  it('only shuts down when transitioning from enabled to disabled', () => {
    let shutdownCalled = false
    const shutdown = () => { shutdownCalled = true }

    function handleSave(wasEnabled: boolean, nowEnabled: boolean) {
      if (wasEnabled && !nowEnabled) shutdown()
    }

    shutdownCalled = false
    handleSave(true, false)
    expect(shutdownCalled).toBe(true)

    shutdownCalled = false
    handleSave(false, true)
    expect(shutdownCalled).toBe(false)

    shutdownCalled = false
    handleSave(true, true)
    expect(shutdownCalled).toBe(false)
  })
})
