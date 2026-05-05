import { describe, it, expect } from 'vitest'
import { ftsPhrase } from '../db-helpers'

describe('ftsPhrase', () => {
  it('wraps plain text in double quotes', () =>
    expect(ftsPhrase('hello world')).toBe('"hello world"'))
  it('escapes internal double quotes', () =>
    expect(ftsPhrase('he said "hi"')).toBe('"he said ""hi"""'))
  it('neutralises FTS OR operator', () =>
    expect(ftsPhrase('foo OR bar')).toBe('"foo OR bar"'))
  it('neutralises FTS AND operator', () =>
    expect(ftsPhrase('foo AND bar')).toBe('"foo AND bar"'))
  it('neutralises NOT prefix', () =>
    expect(ftsPhrase('NOT foo')).toBe('"NOT foo"'))
  it('neutralises wildcard *', () =>
    expect(ftsPhrase('foo*')).toBe('"foo*"'))
  it('neutralises hyphen prefix', () =>
    expect(ftsPhrase('-foo')).toBe('"-foo"'))
  it('handles empty string', () =>
    expect(ftsPhrase('')).toBe('""'))
  it('handles non-string input gracefully', () =>
    expect(ftsPhrase(null as any)).toBe('""'))
})
