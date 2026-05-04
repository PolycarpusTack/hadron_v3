import Database from 'better-sqlite3'
import path from 'path'
import log from 'electron-log'
import { runMigrations } from './migrations'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized — call initDatabase() first')
  return _db
}

export function initDatabase(dbPath?: string): void {
  const { app } = require('electron')
  const resolvedPath = dbPath ?? path.join(app.getPath('userData'), 'hadron.db')
  log.info(`Opening database at: ${resolvedPath}`)
  _db = new Database(resolvedPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  _db.pragma('busy_timeout = 5000')
  runMigrations(_db)
  log.info('Database initialized')
}

export function closeDatabase(): void {
  _db?.close()
  _db = null
}
