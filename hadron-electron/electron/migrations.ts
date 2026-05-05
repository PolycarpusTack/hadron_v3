import Database from 'better-sqlite3'
import log from 'electron-log'

const CURRENT_VERSION = 15

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  const currentVersion: number = (db.prepare(
    'SELECT COALESCE(MAX(version), 0) AS v FROM schema_versions'
  ).get() as { v: number }).v

  log.info(`DB schema: current=${currentVersion}, target=${CURRENT_VERSION}`)

  const migrations: Array<{ version: number; name: string; up: (db: Database.Database) => void }> = [
    { version: 1,  name: 'initial_schema',         up: m001 },
    { version: 2,  name: 'add_analysis_type',       up: m002 },
    { version: 3,  name: 'add_translations_table',  up: m003 },
    { version: 4,  name: 'add_crash_signatures',    up: m004 },
    { version: 5,  name: 'history_enhancements',    up: m005 },
    { version: 6,  name: 'intelligence_platform',   up: m006 },
    { version: 7,  name: 'jira_ticket_linking',     up: m007 },
    { version: 8,  name: 'chat_feedback',           up: m008 },
    { version: 9,  name: 'chat_sessions',           up: m009 },
    { version: 10, name: 'release_notes',           up: m010 },
    { version: 11, name: 'feedback_reason',         up: m011 },
    { version: 12, name: 'ask_hadron_2',            up: m012 },
    { version: 13, name: 'canonicalize_jira_type',  up: m013 },
    { version: 14, name: 'jira_assist_tables',      up: m014 },
    { version: 15, name: 'fts_indices',             up: m015 },
  ]

  for (const m of migrations) {
    if (m.version > currentVersion) {
      log.info(`Running migration ${m.version}: ${m.name}`)
      const run = db.transaction(() => {
        m.up(db)
        db.prepare('INSERT INTO schema_versions (version, name) VALUES (?, ?)').run(m.version, m.name)
      })
      run()
      log.info(`Migration ${m.version} complete`)
    }
  }
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  return (db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('${table}') WHERE name='${col}'`).get() as {c:number}).c > 0
}

function m001(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      file_size_kb REAL,
      error_type TEXT,
      error_message TEXT,
      severity TEXT CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
      component TEXT,
      stack_trace TEXT,
      root_cause TEXT,
      suggested_fixes TEXT,
      confidence TEXT CHECK(confidence IN ('HIGH','MEDIUM','LOW')),
      analyzed_at TEXT NOT NULL,
      ai_model TEXT,
      ai_provider TEXT,
      tokens_used INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      was_truncated INTEGER DEFAULT 0,
      analysis_duration_ms INTEGER,
      full_data TEXT,
      is_favorite INTEGER DEFAULT 0,
      last_viewed_at TEXT,
      view_count INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS analyses_fts USING fts5(
      error_type, error_message, root_cause, suggested_fixes, component, stack_trace,
      content=analyses, content_rowid=id, tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS analyses_ai AFTER INSERT ON analyses BEGIN
      INSERT INTO analyses_fts(rowid,error_type,error_message,root_cause,suggested_fixes,component,stack_trace)
      VALUES (new.id,new.error_type,new.error_message,new.root_cause,new.suggested_fixes,new.component,new.stack_trace);
    END;
    CREATE TRIGGER IF NOT EXISTS analyses_au AFTER UPDATE ON analyses BEGIN
      UPDATE analyses_fts SET error_type=new.error_type,error_message=new.error_message,
        root_cause=new.root_cause,suggested_fixes=new.suggested_fixes,
        component=new.component,stack_trace=new.stack_trace WHERE rowid=new.id;
    END;
    CREATE TRIGGER IF NOT EXISTS analyses_ad AFTER DELETE ON analyses BEGIN
      DELETE FROM analyses_fts WHERE rowid=old.id;
    END;

    CREATE INDEX IF NOT EXISTS idx_analyzed_at ON analyses(analyzed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_severity    ON analyses(severity) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_component   ON analyses(component) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_favorite    ON analyses(is_favorite, analyzed_at DESC) WHERE is_favorite=1;
    CREATE INDEX IF NOT EXISTS idx_recent      ON analyses(last_viewed_at DESC) WHERE last_viewed_at IS NOT NULL;
  `)
}

function m002(db: Database.Database): void {
  if (!hasColumn(db, 'analyses', 'analysis_type'))
    db.exec(`ALTER TABLE analyses ADD COLUMN analysis_type TEXT DEFAULT 'complete'`)
}

function m003(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_content TEXT NOT NULL,
      translation TEXT NOT NULL,
      translated_at TEXT NOT NULL,
      ai_model TEXT NOT NULL,
      ai_provider TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      last_viewed_at TEXT,
      view_count INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS translations_fts USING fts5(
      input_content, translation, content=translations, content_rowid=id, tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS translations_ai AFTER INSERT ON translations BEGIN
      INSERT INTO translations_fts(rowid,input_content,translation) VALUES(new.id,new.input_content,new.translation);
    END;
    CREATE TRIGGER IF NOT EXISTS translations_au AFTER UPDATE ON translations BEGIN
      UPDATE translations_fts SET input_content=new.input_content,translation=new.translation WHERE rowid=new.id;
    END;
    CREATE TRIGGER IF NOT EXISTS translations_ad AFTER DELETE ON translations BEGIN
      DELETE FROM translations_fts WHERE rowid=old.id;
    END;
    CREATE INDEX IF NOT EXISTS idx_translations_date ON translations(translated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_translations_favorite ON translations(is_favorite, translated_at DESC) WHERE is_favorite=1;
  `)
}

function m004(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crash_signatures (
      hash TEXT PRIMARY KEY,
      canonical TEXT NOT NULL,
      components_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      linked_ticket_system TEXT,
      linked_ticket_id TEXT,
      linked_ticket_url TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      status_metadata_json TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS analysis_signatures (
      analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      signature_hash TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
      matched_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (analysis_id, signature_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_signatures_status ON crash_signatures(status);
    CREATE INDEX IF NOT EXISTS idx_signatures_occurrences ON crash_signatures(occurrence_count DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_signatures_hash ON analysis_signatures(signature_hash);
  `)
}

function m005(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6B7280',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      usage_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS analysis_tags (
      analysis_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      tagged_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (analysis_id, tag_id),
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS translation_tags (
      translation_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      tagged_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (translation_id, tag_id),
      FOREIGN KEY (translation_id) REFERENCES translations(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS archived_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_id INTEGER NOT NULL,
      archived_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_by TEXT,
      data_json TEXT NOT NULL,
      restore_eligible_until TEXT
    );
    CREATE TABLE IF NOT EXISTS analysis_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS idx_analysis_tags_tag ON analysis_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_notes_analysis ON analysis_notes(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_filter_composite ON analyses(deleted_at,is_favorite,severity,analyzed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analyses_type_date ON analyses(analysis_type, analyzed_at DESC) WHERE deleted_at IS NULL;
  `)

  if (!hasColumn(db, 'analyses', 'error_signature'))
    db.exec(`ALTER TABLE analyses ADD COLUMN error_signature TEXT`)
  if (!hasColumn(db, 'analyses', 'source_type'))
    db.exec(`ALTER TABLE analyses ADD COLUMN source_type TEXT DEFAULT 'file'`)
  if (!hasColumn(db, 'translations', 'translation_type'))
    db.exec(`ALTER TABLE translations ADD COLUMN translation_type TEXT DEFAULT 'technical'`)

  db.exec(`UPDATE analyses SET error_signature =
    LOWER(COALESCE(error_type, 'unknown')) || ':' || LOWER(COALESCE(component, 'unknown'))
    WHERE error_signature IS NULL`)

  const ins = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)')
  const defaultTags = [
    ['production','#EF4444'],['staging','#F97316'],['development','#22C55E'],
    ['resolved','#10B981'],['investigating','#EAB308'],['needs-review','#8B5CF6'],
    ['recurring','#EC4899'],['critical-path','#DC2626'],
  ]
  for (const [name, color] of defaultTags) ins.run(name, color)
}

function m006(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      feedback_type TEXT NOT NULL CHECK(feedback_type IN ('accept','reject','edit','rating')),
      field_name TEXT, original_value TEXT, new_value TEXT,
      rating INTEGER CHECK(rating >= 1 AND rating <= 5),
      feedback_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS gold_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_analysis_id INTEGER,
      source_type TEXT NOT NULL DEFAULT 'crash',
      error_signature TEXT NOT NULL,
      crash_content_hash TEXT,
      root_cause TEXT NOT NULL,
      suggested_fixes TEXT NOT NULL,
      component TEXT, severity TEXT,
      validation_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_by TEXT,
      times_referenced INTEGER DEFAULT 0,
      success_rate REAL,
      FOREIGN KEY (source_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS retrieval_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('analysis','gold','ticket','documentation')),
      source_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL, embedding BLOB, embedding_model TEXT,
      metadata_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON analysis_feedback(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_gold_signature ON gold_analyses(error_signature);
    CREATE INDEX IF NOT EXISTS idx_gold_component ON gold_analyses(component);
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON retrieval_chunks(source_type, source_id);
  `)
  if (!hasColumn(db, 'analyses', 'embedding'))
    db.exec(`ALTER TABLE analyses ADD COLUMN embedding BLOB`)
  if (!hasColumn(db, 'analyses', 'embedding_model'))
    db.exec(`ALTER TABLE analyses ADD COLUMN embedding_model TEXT`)
  if (!hasColumn(db, 'analyses', 'feedback_status'))
    db.exec(`ALTER TABLE analyses ADD COLUMN feedback_status TEXT DEFAULT 'pending'`)
}

function m007(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_jira_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      jira_key TEXT NOT NULL, jira_url TEXT, jira_summary TEXT, jira_status TEXT, jira_priority TEXT,
      link_type TEXT NOT NULL DEFAULT 'related',
      linked_at TEXT NOT NULL DEFAULT (datetime('now')),
      linked_by TEXT, notes TEXT,
      UNIQUE(analysis_id, jira_key),
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_jira_links_analysis ON analysis_jira_links(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_jira_links_key ON analysis_jira_links(jira_key);
  `)
}

function m008(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      rating TEXT NOT NULL, comment TEXT, tools_used TEXT, sources_cited TEXT, query TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_feedback_session ON chat_feedback(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_feedback_rating ON chat_feedback(rating);
  `)
}

function m009(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, timestamp);
  `)
}

function m010(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS release_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fix_version TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'both', title TEXT NOT NULL,
      markdown_content TEXT NOT NULL, original_ai_content TEXT,
      ticket_keys TEXT NOT NULL DEFAULT '[]', ticket_count INTEGER NOT NULL DEFAULT 0,
      jql_filter TEXT, module_filter TEXT, ai_model TEXT NOT NULL, ai_provider TEXT NOT NULL,
      tokens_used INTEGER DEFAULT 0, cost REAL DEFAULT 0.0, generation_duration_ms INTEGER,
      ai_insights TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','published','archived')),
      checklist_state TEXT, reviewed_by TEXT, reviewed_at TEXT,
      version INTEGER NOT NULL DEFAULT 1, parent_id INTEGER REFERENCES release_notes(id),
      is_manual_edit INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT, deleted_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rn_fix_version ON release_notes(fix_version);
    CREATE INDEX IF NOT EXISTS idx_rn_status ON release_notes(status);
    CREATE INDEX IF NOT EXISTS idx_rn_created_at ON release_notes(created_at);
  `)
}

function m011(db: Database.Database): void {
  if (!hasColumn(db, 'chat_feedback', 'reason'))
    db.exec(`ALTER TABLE chat_feedback ADD COLUMN reason TEXT`)
}

function m012(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gold_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL, answer TEXT NOT NULL,
      session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      won_version TEXT, customer TEXT, tags TEXT, verified_by TEXT, tool_results_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gold_answers_tags ON gold_answers(tags);
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      summary_markdown TEXT NOT NULL, topic TEXT, won_version TEXT, customer TEXT,
      is_indexed INTEGER NOT NULL DEFAULT 0, is_exported INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  const cols: Array<[string, string]> = [
    ['is_starred','INTEGER NOT NULL DEFAULT 0'],
    ['tags','TEXT'],
    ['customer','TEXT'],
    ['won_version','TEXT'],
  ]
  for (const [col, def] of cols) {
    if (!hasColumn(db, 'chat_sessions', col))
      db.exec(`ALTER TABLE chat_sessions ADD COLUMN ${col} ${def}`)
  }
}

function m013(db: Database.Database): void {
  db.exec(`UPDATE analyses SET analysis_type='jira' WHERE analysis_type='jira_ticket'`)
}

function m014(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_briefs (
      jira_key TEXT PRIMARY KEY, title TEXT NOT NULL, customer TEXT, severity TEXT, category TEXT,
      tags TEXT, triage_json TEXT, brief_json TEXT,
      posted_to_jira INTEGER NOT NULL DEFAULT 0, posted_at TEXT,
      engineer_rating INTEGER, engineer_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ticket_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jira_key TEXT NOT NULL REFERENCES ticket_briefs(jira_key) ON DELETE CASCADE,
      embedding BLOB NOT NULL, source_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_embeddings_jira_key ON ticket_embeddings(jira_key);
  `)
}

function m015(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ticket_briefs_fts
      USING fts5(jira_key, title, triage_json, content=ticket_briefs, content_rowid=rowid);

    CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_chunks_fts
      USING fts5(content, metadata_json, content=retrieval_chunks, content_rowid=id);
  `)
}
