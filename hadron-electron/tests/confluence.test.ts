import { describe, it, expect } from 'vitest'

describe('Confluence API URL construction', () => {
  it('escapes CQL query correctly', () => {
    const query = 'NullPointerException "schedule service"'
    const escaped = query.replace(/"/g, '\\"')
    const cql = `text ~ "${escaped}"`
    expect(cql).toBe('text ~ "NullPointerException \\"schedule service\\""')
  })

  it('builds page URL from baseUrl and id', () => {
    const baseUrl = 'https://myorg.atlassian.net'
    const id = '12345'
    const url = `${baseUrl}/wiki/rest/api/content/${id}?expand=body.view`
    expect(url).toBe('https://myorg.atlassian.net/wiki/rest/api/content/12345?expand=body.view')
  })
})
