import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
})

afterEach(() => db.close())

describe('migrations', () => {
  it('runs all 14 migrations from empty', () => {
    runMigrations(db)
    const version = (db.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v: number }).v
    expect(version).toBe(14)
  })

  it('is idempotent — running twice is safe', () => {
    runMigrations(db)
    runMigrations(db)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM schema_versions').get() as { c: number }).c
    expect(count).toBe(14)
  })

  it('seeds 8 default tags', () => {
    runMigrations(db)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }).c
    expect(count).toBe(8)
  })

  it('creates analyses table with FTS virtual table', () => {
    runMigrations(db)
    const exists = (db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='analyses'`).get() as {c:number}).c
    expect(exists).toBe(1)
    const fts = (db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name='analyses_fts'`).get() as {c:number}).c
    expect(fts).toBe(1)
  })

  it('creates translations table', () => {
    runMigrations(db)
    const exists = (db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='translations'`).get() as {c:number}).c
    expect(exists).toBe(1)
  })

  it('creates chat_sessions and chat_messages tables', () => {
    runMigrations(db)
    const sessions = (db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='chat_sessions'`).get() as {c:number}).c
    expect(sessions).toBe(1)
    const messages = (db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='chat_messages'`).get() as {c:number}).c
    expect(messages).toBe(1)
  })
})
