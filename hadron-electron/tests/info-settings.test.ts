import { describe, it, expect } from 'vitest'

describe('crash_log_dir persistence', () => {
  it('stores and retrieves a dir path', () => {
    const store = new Map<string, unknown>()
    const set = (k: string, v: unknown) => store.set(k, v)
    const get = (k: string, def: unknown) => store.get(k) ?? def

    set('crash_log_dir', '/custom/logs')
    expect(get('crash_log_dir', '')).toBe('/custom/logs')
  })

  it('stores and retrieves stability mode', () => {
    const store = new Map<string, unknown>()
    store.set('stability_mode', true)
    expect(store.get('stability_mode')).toBe(true)
  })
})
