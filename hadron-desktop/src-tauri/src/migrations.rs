//! Database Migration System
//!
//! Provides versioned schema migrations for safe database evolution.
//! Each migration is a numbered function that runs exactly once.

use rusqlite::{Connection, Result};

/// Current schema version. Increment when adding new migrations.
pub const CURRENT_SCHEMA_VERSION: i32 = 5;

/// Migration function type
type MigrationFn = fn(&Connection) -> Result<()>;

/// Migration definition
struct Migration {
    version: i32,
    name: &'static str,
    up: MigrationFn,
}

/// All migrations in order. Add new migrations at the end.
const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "initial_schema",
        up: migration_001_initial_schema,
    },
    Migration {
        version: 2,
        name: "add_analysis_type",
        up: migration_002_add_analysis_type,
    },
    Migration {
        version: 3,
        name: "add_translations_table",
        up: migration_003_add_translations_table,
    },
    Migration {
        version: 4,
        name: "add_crash_signatures",
        up: migration_004_add_crash_signatures,
    },
    Migration {
        version: 5,
        name: "history_enhancements",
        up: migration_005_history_enhancements,
    },
];

/// Initialize the schema_versions table
pub fn init_migration_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            checksum TEXT
        )",
        [],
    )?;
    Ok(())
}

/// Get current schema version from database
pub fn get_current_version(conn: &Connection) -> Result<i32> {
    let version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_versions",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(version)
}

/// Run all pending migrations
pub fn run_migrations(conn: &Connection) -> Result<()> {
    init_migration_table(conn)?;

    let current_version = get_current_version(conn)?;
    log::info!(
        "Database schema version: {}, target: {}",
        current_version,
        CURRENT_SCHEMA_VERSION
    );

    for migration in MIGRATIONS {
        if migration.version > current_version {
            log::info!(
                "Running migration {}: {}",
                migration.version,
                migration.name
            );

            // Run migration in a transaction
            conn.execute("BEGIN TRANSACTION", [])?;

            match (migration.up)(conn) {
                Ok(()) => {
                    // Record successful migration
                    conn.execute(
                        "INSERT INTO schema_versions (version, name) VALUES (?1, ?2)",
                        rusqlite::params![migration.version, migration.name],
                    )?;
                    conn.execute("COMMIT", [])?;
                    log::info!("Migration {} completed successfully", migration.version);
                }
                Err(e) => {
                    conn.execute("ROLLBACK", [])?;
                    log::error!("Migration {} failed: {}", migration.version, e);
                    return Err(e);
                }
            }
        }
    }

    log::info!(
        "All migrations completed. Schema version: {}",
        CURRENT_SCHEMA_VERSION
    );
    Ok(())
}

/// Check if database needs migration
#[allow(dead_code)]
pub fn needs_migration(conn: &Connection) -> Result<bool> {
    init_migration_table(conn)?;
    let current = get_current_version(conn)?;
    Ok(current < CURRENT_SCHEMA_VERSION)
}

// ============================================================================
// Migration Definitions
// ============================================================================

/// Migration 1: Initial schema with analyses table
fn migration_001_initial_schema(conn: &Connection) -> Result<()> {
    // Create analyses table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS analyses (
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
        )",
        [],
    )?;

    // Create FTS5 virtual table
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS analyses_fts USING fts5(
            error_type,
            error_message,
            root_cause,
            suggested_fixes,
            component,
            stack_trace,
            content=analyses,
            content_rowid=id,
            tokenize='porter unicode61'
        )",
        [],
    )?;

    // Create triggers for FTS sync
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS analyses_ai AFTER INSERT ON analyses BEGIN
            INSERT INTO analyses_fts(rowid, error_type, error_message, root_cause, suggested_fixes, component, stack_trace)
            VALUES (new.id, new.error_type, new.error_message, new.root_cause, new.suggested_fixes, new.component, new.stack_trace);
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS analyses_au AFTER UPDATE ON analyses BEGIN
            UPDATE analyses_fts SET
                error_type = new.error_type,
                error_message = new.error_message,
                root_cause = new.root_cause,
                suggested_fixes = new.suggested_fixes,
                component = new.component,
                stack_trace = new.stack_trace
            WHERE rowid = new.id;
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS analyses_ad AFTER DELETE ON analyses BEGIN
            DELETE FROM analyses_fts WHERE rowid = old.id;
        END",
        [],
    )?;

    // Create performance indexes
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analyzed_at ON analyses(analyzed_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_severity ON analyses(severity) WHERE deleted_at IS NULL",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_component ON analyses(component) WHERE deleted_at IS NULL",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_favorite ON analyses(is_favorite, analyzed_at DESC) WHERE is_favorite = 1",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_recent ON analyses(last_viewed_at DESC) WHERE last_viewed_at IS NOT NULL",
        [],
    )?;

    Ok(())
}

/// Migration 2: Add analysis_type column
fn migration_002_add_analysis_type(conn: &Connection) -> Result<()> {
    // Check if column already exists (for existing databases)
    let has_column: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('analyses') WHERE name='analysis_type'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if !has_column {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN analysis_type TEXT DEFAULT 'complete'",
            [],
        )?;
    }

    Ok(())
}

/// Migration 3: Add translations table
fn migration_003_add_translations_table(conn: &Connection) -> Result<()> {
    // Create translations table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS translations (
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
        )",
        [],
    )?;

    // Create FTS5 for translations
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS translations_fts USING fts5(
            input_content,
            translation,
            content=translations,
            content_rowid=id,
            tokenize='porter unicode61'
        )",
        [],
    )?;

    // Create triggers for translations FTS
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS translations_ai AFTER INSERT ON translations BEGIN
            INSERT INTO translations_fts(rowid, input_content, translation)
            VALUES (new.id, new.input_content, new.translation);
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS translations_au AFTER UPDATE ON translations BEGIN
            UPDATE translations_fts SET
                input_content = new.input_content,
                translation = new.translation
            WHERE rowid = new.id;
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS translations_ad AFTER DELETE ON translations BEGIN
            DELETE FROM translations_fts WHERE rowid = old.id;
        END",
        [],
    )?;

    // Create indexes for translations
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_translations_date ON translations(translated_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_translations_favorite ON translations(is_favorite, translated_at DESC) WHERE is_favorite = 1",
        [],
    )?;

    Ok(())
}

/// Migration 4: Add crash signatures tables for deduplication
fn migration_004_add_crash_signatures(conn: &Connection) -> Result<()> {
    // Create crash_signatures table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS crash_signatures (
            -- Primary key: the signature hash (12 chars)
            hash TEXT PRIMARY KEY,

            -- Human-readable canonical form
            canonical TEXT NOT NULL,

            -- Component data (JSON)
            components_json TEXT NOT NULL,

            -- Timestamps (ISO 8601)
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,

            -- Occurrence tracking
            occurrence_count INTEGER NOT NULL DEFAULT 1,

            -- Ticket linking
            linked_ticket_system TEXT,
            linked_ticket_id TEXT,
            linked_ticket_url TEXT,

            -- Status: new, investigating, fix_in_progress, fixed, wont_fix, duplicate
            status TEXT NOT NULL DEFAULT 'new',
            status_metadata_json TEXT,

            -- Notes
            notes TEXT,

            -- Audit
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )?;

    // Create index for status filtering
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_signatures_status ON crash_signatures(status)",
        [],
    )?;

    // Create index for ticket lookup
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_signatures_ticket ON crash_signatures(linked_ticket_system, linked_ticket_id)",
        [],
    )?;

    // Create index for occurrence count (for sorting)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_signatures_occurrences ON crash_signatures(occurrence_count DESC)",
        [],
    )?;

    // Junction table: which analyses have which signatures
    conn.execute(
        "CREATE TABLE IF NOT EXISTS analysis_signatures (
            analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
            signature_hash TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,

            -- When this occurrence was recorded
            matched_at TEXT NOT NULL DEFAULT (datetime('now')),

            PRIMARY KEY (analysis_id, signature_hash)
        )",
        [],
    )?;

    // Create index for finding all analyses with a signature
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analysis_signatures_hash ON analysis_signatures(signature_hash)",
        [],
    )?;

    // Signature relationships (for duplicate tracking)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS signature_relationships (
            from_hash TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
            to_hash TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
            relationship TEXT NOT NULL,  -- 'duplicate_of', 'related_to', 'superseded_by'
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),

            PRIMARY KEY (from_hash, to_hash, relationship)
        )",
        [],
    )?;

    Ok(())
}

/// Migration 5: History Tab Enhancements - Tags, Archive, Notes
fn migration_005_history_enhancements(conn: &Connection) -> Result<()> {
    // ========================================================================
    // Tags System
    // ========================================================================

    // User-defined tags
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '#6B7280',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            usage_count INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Many-to-many: Analysis <-> Tags
    conn.execute(
        "CREATE TABLE IF NOT EXISTS analysis_tags (
            analysis_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            tagged_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (analysis_id, tag_id),
            FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Many-to-many: Translation <-> Tags
    conn.execute(
        "CREATE TABLE IF NOT EXISTS translation_tags (
            translation_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            tagged_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (translation_id, tag_id),
            FOREIGN KEY (translation_id) REFERENCES translations(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // ========================================================================
    // Archive System
    // ========================================================================

    // Archive table for soft-deleted items (for permanent deletion recovery)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS archived_analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_id INTEGER NOT NULL,
            archived_at TEXT NOT NULL DEFAULT (datetime('now')),
            archived_by TEXT,
            data_json TEXT NOT NULL,
            restore_eligible_until TEXT
        )",
        [],
    )?;

    // ========================================================================
    // Notes System
    // ========================================================================

    // User notes/comments on analyses
    conn.execute(
        "CREATE TABLE IF NOT EXISTS analysis_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT,
            FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // ========================================================================
    // Schema Modifications
    // ========================================================================

    // Add error_signature column to analyses (for duplicate detection)
    let has_error_signature: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('analyses') WHERE name='error_signature'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if !has_error_signature {
        conn.execute("ALTER TABLE analyses ADD COLUMN error_signature TEXT", [])?;
    }

    // Add source_type column to analyses
    let has_source_type: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('analyses') WHERE name='source_type'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if !has_source_type {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN source_type TEXT DEFAULT 'file'",
            [],
        )?;
    }

    // Add translation_type column to translations (for code_analysis distinction)
    let has_translation_type: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('translations') WHERE name='translation_type'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if !has_translation_type {
        conn.execute(
            "ALTER TABLE translations ADD COLUMN translation_type TEXT DEFAULT 'technical'",
            [],
        )?;
    }

    // ========================================================================
    // Indexes
    // ========================================================================

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analyses_error_signature ON analyses(error_signature)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analyses_analysis_type ON analyses(analysis_type)",
        [],
    )?;

    conn.execute("CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)", [])?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analysis_tags_tag ON analysis_tags(tag_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analysis_notes_analysis ON analysis_notes(analysis_id)",
        [],
    )?;

    // ========================================================================
    // Seed Default Tags
    // ========================================================================

    // Insert default tags (ignore if already exist)
    let default_tags = [
        ("production", "#EF4444"),    // red
        ("staging", "#F97316"),       // orange
        ("development", "#22C55E"),   // green
        ("resolved", "#10B981"),      // emerald
        ("investigating", "#EAB308"), // yellow
        ("needs-review", "#8B5CF6"),  // violet
        ("recurring", "#EC4899"),     // pink
        ("critical-path", "#DC2626"), // dark red
    ];

    for (name, color) in &default_tags {
        conn.execute(
            "INSERT OR IGNORE INTO tags (name, color) VALUES (?1, ?2)",
            rusqlite::params![name, color],
        )?;
    }

    // ========================================================================
    // Generate Error Signatures for Existing Data
    // ========================================================================

    conn.execute(
        "UPDATE analyses SET error_signature =
            LOWER(COALESCE(error_type, 'unknown')) || ':' || LOWER(COALESCE(component, 'unknown'))
         WHERE error_signature IS NULL",
        [],
    )?;

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_migrations_run_in_order() {
        let conn = Connection::open_in_memory().unwrap();

        // Enable WAL for testing
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();

        run_migrations(&conn).unwrap();

        let version = get_current_version(&conn).unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn test_migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();

        // Run migrations twice
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let version = get_current_version(&conn).unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);

        // Verify only 5 migration records exist
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM schema_versions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 5);
    }

    #[test]
    fn test_tags_table_created() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Verify tags table exists
        let exists: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tags'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);

        // Verify default tags are seeded
        let tag_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tag_count, 8);
    }

    #[test]
    fn test_analyses_table_created() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Verify table exists
        let exists: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='analyses'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
    }

    #[test]
    fn test_translations_table_created() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Verify table exists
        let exists: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='translations'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
    }
}
