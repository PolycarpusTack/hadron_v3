import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RateLimiter } from '../rate-limiter'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows calls within the limit', () => {
    const limiter = new RateLimiter(3, 60_000)
    expect(limiter.tryAcquire('chan')).toBe(true)
    expect(limiter.tryAcquire('chan')).toBe(true)
    expect(limiter.tryAcquire('chan')).toBe(true)
  })

  it('blocks when the limit is exceeded', () => {
    const limiter = new RateLimiter(3, 60_000)
    limiter.tryAcquire('chan')
    limiter.tryAcquire('chan')
    limiter.tryAcquire('chan')
    expect(limiter.tryAcquire('chan')).toBe(false)
  })

  it('slides the window — old calls expire', () => {
    const limiter = new RateLimiter(3, 60_000)
    limiter.tryAcquire('chan') // t=0
    limiter.tryAcquire('chan') // t=0
    limiter.tryAcquire('chan') // t=0
    vi.advanceTimersByTime(61_000)    // now t=61s, all 3 calls are outside the window
    expect(limiter.tryAcquire('chan')).toBe(true)
  })

  it('isolates different channels', () => {
    const limiter = new RateLimiter(1, 60_000)
    expect(limiter.tryAcquire('a')).toBe(true)
    expect(limiter.tryAcquire('a')).toBe(false) // blocked
    expect(limiter.tryAcquire('b')).toBe(true)  // different channel, not blocked
  })

  it('provides remaining count', () => {
    const limiter = new RateLimiter(5, 60_000)
    limiter.tryAcquire('chan')
    limiter.tryAcquire('chan')
    expect(limiter.remaining('chan')).toBe(3)
  })

  it('expires calls at exactly the window boundary', () => {
    const limiter = new RateLimiter(3, 60_000)
    limiter.tryAcquire('chan') // t=0
    limiter.tryAcquire('chan') // t=0
    limiter.tryAcquire('chan') // t=0
    vi.advanceTimersByTime(60_000) // exactly one window width: t > cutoff means t=0 is expired
    expect(limiter.tryAcquire('chan')).toBe(true)
  })
})
