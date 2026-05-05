import { describe, it, expect } from 'vitest'
import { sanitiseForPrompt, wrapField } from '../prompt-helpers'

describe('sanitiseForPrompt', () => {
  it('passes through normal text unchanged', () =>
    expect(sanitiseForPrompt('hello world')).toBe('hello world'))
  it('replaces <<< with the safe lookalike', () =>
    expect(sanitiseForPrompt('<<<INJECT')).not.toContain('<<<'))
  it('replaces >>> with the safe lookalike', () =>
    expect(sanitiseForPrompt('INJECT>>>')).not.toContain('>>>'))
  it('handles non-string input', () =>
    expect(sanitiseForPrompt(null as any)).toBe(''))
  it('handles empty string', () =>
    expect(sanitiseForPrompt('')).toBe(''))
})

describe('wrapField', () => {
  it('wraps a value with field delimiters', () => {
    const result = wrapField('CRASH_LOG', 'NullPointerException at line 42')
    expect(result).toContain('<<<FIELD:CRASH_LOG>>>')
    expect(result).toContain('NullPointerException at line 42')
    expect(result).toContain('<<<END:CRASH_LOG>>>')
  })
  it('sanitises the value before wrapping', () => {
    const result = wrapField('TITLE', '<<<INJECT>>> evil instructions')
    expect(result).not.toContain('<<<INJECT>>>')
    expect(result).toContain('<<<FIELD:TITLE>>>')
  })
  it('handles non-string value', () => {
    const result = wrapField('X', null as any)
    expect(result).toContain('<<<FIELD:X>>>')
    expect(result).toContain('<<<END:X>>>')
  })
})
