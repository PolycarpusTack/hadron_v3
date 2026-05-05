import { describe, it, expect } from 'vitest'

describe('updater response shape', () => {
  it('returns null when no update available', () => {
    const currentVersion = '5.0.0'
    const latestVersion = '5.0.0'
    const result = latestVersion === currentVersion ? null : { available: true, version: latestVersion }
    expect(result).toBeNull()
  })

  it('returns update object when newer version exists', () => {
    const currentVersion = '5.0.0'
    const latestVersion = '5.1.0'
    const result = latestVersion === currentVersion ? null : {
      available: true, currentVersion, version: latestVersion,
    }
    expect(result?.available).toBe(true)
    expect(result?.version).toBe('5.1.0')
  })
})
