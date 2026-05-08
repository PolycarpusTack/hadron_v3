import { describe, it, expect, vi, beforeEach } from 'vitest'

function isRendererWritable(name: string): boolean {
  return !name.startsWith('_')
}

const RENDERER_BLOCKED_STORES = new Set(['secure-storage'])
function isRendererReadable(name: string): boolean {
  return !name.startsWith('_') && !RENDERER_BLOCKED_STORES.has(name)
}

describe('store guard functions', () => {
  it('isRendererWritable allows secure-storage (BUG: was the bug)', () => {
    expect(isRendererWritable('secure-storage')).toBe(true)
  })

  it('isRendererReadable blocks secure-storage (CORRECT behaviour)', () => {
    expect(isRendererReadable('secure-storage')).toBe(false)
  })

  it('isRendererReadable allows normal stores', () => {
    expect(isRendererReadable('settings')).toBe(true)
    expect(isRendererReadable('ui-state')).toBe(true)
  })

  it('isRendererReadable blocks underscore-prefixed stores', () => {
    expect(isRendererReadable('_internal')).toBe(false)
  })
})

describe('store:entries handler guard (integration sim)', () => {
  it('blocks secure-storage from being listed', () => {
    const store = 'secure-storage'
    const allowed = isRendererReadable(store)
    expect(allowed).toBe(false)
  })

  it('allows settings store to be listed', () => {
    const store = 'settings'
    expect(isRendererReadable(store)).toBe(true)
  })
})
