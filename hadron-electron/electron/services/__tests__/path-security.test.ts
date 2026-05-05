import { describe, it, expect } from 'vitest'
import { isSystemPath } from '../path-security'

describe('isSystemPath', () => {
  it('blocks C:\\Windows', () => expect(isSystemPath('C:\\Windows')).toBe(true))
  it('blocks C:\\System32', () => expect(isSystemPath('C:\\System32')).toBe(true))
  it('blocks /etc', () => expect(isSystemPath('/etc')).toBe(true))
  it('blocks /etc/passwd', () => expect(isSystemPath('/etc/passwd')).toBe(true))
  it('blocks /sys', () => expect(isSystemPath('/sys')).toBe(true))
  it('blocks /proc', () => expect(isSystemPath('/proc')).toBe(true))
  it('blocks /root', () => expect(isSystemPath('/root')).toBe(true))
  it('blocks ~/.ssh', () => {
    const { homedir } = require('os')
    expect(isSystemPath(require('path').join(homedir(), '.ssh'))).toBe(true)
  })
  it('blocks ~/.gnupg', () => {
    const { homedir } = require('os')
    expect(isSystemPath(require('path').join(homedir(), '.gnupg'))).toBe(true)
  })
  it('blocks ~/.aws', () => {
    const { homedir } = require('os')
    expect(isSystemPath(require('path').join(homedir(), '.aws'))).toBe(true)
  })
  it('blocks ~/.azure', () => {
    const { homedir } = require('os')
    expect(isSystemPath(require('path').join(homedir(), '.azure'))).toBe(true)
  })
  it('allows a normal home subdirectory', () => {
    const { homedir } = require('os')
    expect(isSystemPath(require('path').join(homedir(), 'Documents'))).toBe(false)
  })
  it('allows app userData path', () => {
    expect(isSystemPath('/home/user/.config/hadron-electron')).toBe(false)
  })
  it('returns false for empty string', () => expect(isSystemPath('')).toBe(false))
  it('returns false for non-string input', () => expect(isSystemPath(null as any)).toBe(false))
})
