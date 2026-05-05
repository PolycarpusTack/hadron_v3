export class RateLimiter {
  private readonly windows = new Map<string, number[]>()

  constructor(
    private readonly maxCalls: number,
    private readonly windowMs: number,
  ) {}

  tryAcquire(channel: string): boolean {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const calls = (this.windows.get(channel) ?? []).filter(t => t > cutoff)
    if (calls.length >= this.maxCalls) {
      this.windows.set(channel, calls)
      return false
    }
    calls.push(now)
    this.windows.set(channel, calls)
    return true
  }

  remaining(channel: string): number {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const calls = (this.windows.get(channel) ?? []).filter(t => t > cutoff)
    return Math.max(0, this.maxCalls - calls.length)
  }
}

export const aiRateLimiter = new RateLimiter(10, 60_000)
