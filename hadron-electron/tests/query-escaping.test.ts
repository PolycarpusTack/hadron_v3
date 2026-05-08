import { describe, it, expect } from 'vitest'

function escapeJqlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

describe('JQL escaping', () => {
  it('escapes double quotes in accountId', () => {
    const malicious = 'user" OR project != "NONE'
    const jql = `reporter = "${escapeJqlString(malicious)}" ORDER BY created DESC`
    expect(jql).toBe('reporter = "user\\" OR project != \\"NONE" ORDER BY created DESC')
  })

  it('escapes backslash in accountId', () => {
    const malicious = 'user\\whatever'
    const escaped = escapeJqlString(malicious)
    expect(escaped).toBe('user\\\\whatever')
  })

  it('passes through normal accountId unchanged', () => {
    expect(escapeJqlString('5a2d9f1e8b3c4a7d')).toBe('5a2d9f1e8b3c4a7d')
  })
})

describe('CQL escaping (space_key)', () => {
  it('escapes double quotes in space_key', () => {
    const malicious = 'FOO" OR type=blogpost OR text ~ "'
    const escaped = escapeJqlString(malicious)
    // All double quotes in the value must be preceded by a backslash
    expect(escaped).not.toMatch(/(?<!\\)"/)
    const cql = `type=page AND space.key = "${escaped}"`
    // The CQL string should not break out into unescaped injection clauses
    expect(cql).toContain('\\"')
  })

  it('passes through normal space_key unchanged', () => {
    expect(escapeJqlString('MYSPACE')).toBe('MYSPACE')
  })
})

describe('LIKE wildcard escaping', () => {
  it('escapes % wildcard', () => {
    expect(escapeLike('%')).toBe('\\%')
  })

  it('escapes _ wildcard', () => {
    expect(escapeLike('test_case')).toBe('test\\_case')
  })

  it('escapes backslash', () => {
    expect(escapeLike('foo\\bar')).toBe('foo\\\\bar')
  })

  it('passes through normal search terms', () => {
    expect(escapeLike('null pointer')).toBe('null pointer')
  })
})

describe('jqlFilter validation', () => {
  it('rejects parentheses', () => {
    function validateJqlFilter(raw: string): string {
      if (/[(){}]/.test(raw)) throw new Error('jqlFilter must not contain parentheses or braces')
      if (raw.length > 500) throw new Error('jqlFilter exceeds maximum length')
      return raw
    }
    expect(() => validateJqlFilter('fixVersion = "1.0" AND (project = FOO)')).toThrow('parentheses')
  })

  it('rejects overlong filters', () => {
    function validateJqlFilter(raw: string): string {
      if (/[(){}]/.test(raw)) throw new Error('jqlFilter must not contain parentheses or braces')
      if (raw.length > 500) throw new Error('jqlFilter exceeds maximum length')
      return raw
    }
    expect(() => validateJqlFilter('a'.repeat(501))).toThrow('maximum length')
  })

  it('passes a valid filter through', () => {
    function validateJqlFilter(raw: string): string {
      if (/[(){}]/.test(raw)) throw new Error('jqlFilter must not contain parentheses or braces')
      if (raw.length > 500) throw new Error('jqlFilter exceeds maximum length')
      return raw
    }
    const valid = 'fixVersion = "1.0.0" ORDER BY created DESC'
    expect(validateJqlFilter(valid)).toBe(valid)
  })
})
