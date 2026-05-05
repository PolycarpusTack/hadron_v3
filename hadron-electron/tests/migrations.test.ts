import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../electron/migrations'

describe('migration 15', () => {
  it('creates ticket_briefs_fts virtual table', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ticket_briefs_fts'"
    ).get()
    expect(row).toBeTruthy()
  })

  it('creates retrieval_chunks_fts virtual table', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='retrieval_chunks_fts'"
    ).get()
    expect(row).toBeTruthy()
  })
})
