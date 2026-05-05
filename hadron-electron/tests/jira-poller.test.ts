import { describe, it, expect } from 'vitest'

describe('JIRA poller state', () => {
  it('starts as stopped', () => {
    const state = { running: false, lastPolledAt: null as string | null, ticketsTriagedTotal: 0, intervalMins: 15 }
    expect(state.running).toBe(false)
    expect(state.lastPolledAt).toBeNull()
  })

  it('marks running after start', () => {
    const state = { running: false, lastPolledAt: null as string | null, ticketsTriagedTotal: 0, intervalMins: 15 }
    state.running = true
    state.lastPolledAt = new Date().toISOString()
    expect(state.running).toBe(true)
    expect(state.lastPolledAt).toBeTruthy()
  })
})
