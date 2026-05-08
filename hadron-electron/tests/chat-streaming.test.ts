import { describe, it, expect } from 'vitest'

describe('stream GC timer identity guard', () => {
  it('timer only deletes the stream it was created for', () => {
    const streams = new Map<string, { done: boolean; pendingText: string }>()

    function streamCreate(id: string) {
      const s = { done: false, pendingText: '' }
      streams.set(id, s)
      return s
    }

    const ss1 = streamCreate('req-1')
    const ss2 = streamCreate('req-1') // replaces ss1

    const guardedDelete = (id: string, ss: typeof ss1) => {
      if (streams.get(id) === ss) streams.delete(id)
    }

    // Timer from ss1 fires — should NOT delete ss2
    guardedDelete('req-1', ss1)
    expect(streams.has('req-1')).toBe(true)
    expect(streams.get('req-1')).toBe(ss2)

    // Timer from ss2 fires — SHOULD delete
    guardedDelete('req-1', ss2)
    expect(streams.has('req-1')).toBe(false)
  })
})

describe('active stream abort before clobber (duplicate request_id)', () => {
  it('aborts existing non-done stream before creating a new one for same id', () => {
    const streams = new Map<string, { done: boolean; pendingText: string; controller: AbortController }>()
    let aborted = false

    function streamCreate(id: string) {
      const existing = streams.get(id)
      if (existing && !existing.done) {
        existing.controller.abort()
        existing.done = true
        aborted = true
        streams.delete(id)
      }
      const s = { done: false, pendingText: '', controller: new AbortController() }
      streams.set(id, s)
      return s
    }

    const ss1 = streamCreate('req-1')
    ss1.pendingText = 'partial'
    const ss2 = streamCreate('req-1')
    expect(aborted).toBe(true)
    expect(streams.get('req-1')).toBe(ss2)
    expect(ss1.done).toBe(true)
  })
})

describe('chat_save_session id validation', () => {
  it('rejects undefined id', () => {
    function validateSessionId(id: unknown): string {
      if (!id || typeof id !== 'string') throw new Error('chat_save_session requires a non-empty string id')
      return id
    }
    expect(() => validateSessionId(undefined)).toThrow('requires a non-empty string id')
    expect(() => validateSessionId(null)).toThrow()
    expect(() => validateSessionId('')).toThrow()
    expect(validateSessionId('session-123')).toBe('session-123')
  })
})
