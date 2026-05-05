import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../electron/migrations'

describe('find_similar_tickets FTS', () => {
  it('returns matching tickets by title keyword', () => {
    const db = new Database(':memory:')
    runMigrations(db)

    db.prepare(`INSERT INTO ticket_briefs (jira_key, title, severity, category, brief_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
      .run('WON-100', 'NullPointerException in ScheduleService', 'HIGH', 'Bug', '{}')
    db.prepare(`INSERT INTO ticket_briefs (jira_key, title, severity, category, brief_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
      .run('WON-200', 'Login page timeout', 'MEDIUM', 'Performance', '{}')

    db.exec("INSERT INTO ticket_briefs_fts(ticket_briefs_fts) VALUES('rebuild')")

    const rows = db.prepare(`
      SELECT tb.jira_key, tb.title, tb.severity, tb.category,
             ticket_briefs_fts.rank AS rank
      FROM ticket_briefs_fts
      JOIN ticket_briefs tb ON ticket_briefs_fts.rowid = tb.rowid
      WHERE ticket_briefs_fts MATCH ?
      ORDER BY rank
      LIMIT 5
    `).all('NullPointerException') as Array<{ jira_key: string; title: string }>

    expect(rows).toHaveLength(1)
    expect(rows[0].jira_key).toBe('WON-100')
  })
})
