use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::migrations;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Analysis {
    pub id: i64,
    pub filename: String,
    pub file_size_kb: f64,
    pub error_type: String,
    pub error_message: Option<String>,
    pub severity: String,
    pub component: Option<String>,
    pub stack_trace: Option<String>,
    pub root_cause: String,
    pub suggested_fixes: String, // JSON array
    pub confidence: Option<String>,
    pub analyzed_at: String,
    pub ai_model: String,
    pub ai_provider: Option<String>,
    pub tokens_used: i32,
    pub cost: f64,
    pub was_truncated: bool,
    pub full_data: Option<String>, // Complete JSON blob
    pub is_favorite: bool,
    pub last_viewed_at: Option<String>,
    pub view_count: i32,
    pub analysis_duration_ms: Option<i32>,
    pub analysis_type: String, // "complete" or "specialized"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Translation {
    pub id: i64,
    pub input_content: String,
    pub translation: String,
    pub translated_at: String,
    pub ai_model: String,
    pub ai_provider: String,
    pub is_favorite: bool,
    pub last_viewed_at: Option<String>,
    pub view_count: i32,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Drop for Database {
    fn drop(&mut self) {
        // Checkpoint WAL on cleanup to truncate the WAL file
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
        }
    }
}

impl Database {
    /// Helper method to acquire lock with proper error handling
    fn lock_conn(&self) -> Result<std::sync::MutexGuard<Connection>> {
        self.conn.lock()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Database mutex poisoned: {}", e)
                ))
            ))
    }

    pub fn new() -> Result<Self> {
        let db_path = Self::get_db_path();

        // Create parent directory if it doesn't exist
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(&db_path)?;

        // Enable WAL mode for better performance and concurrent reads
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "temp_store", "MEMORY")?;
        conn.pragma_update(None, "mmap_size", "268435456")?; // 256MB

        // Run versioned migrations
        migrations::run_migrations(&conn)?;

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    /// Get current schema version
    pub fn get_schema_version(&self) -> Result<i32> {
        let conn = self.lock_conn()?;
        migrations::get_current_version(&conn)
    }

    fn get_db_path() -> PathBuf {
        // Use app data directory
        let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("hadron");
        path.push("analyses.db");
        path
    }

    pub fn insert_analysis(&self, analysis: &Analysis) -> Result<i64> {
        let conn = self.lock_conn()?;

        conn.execute(
            "INSERT INTO analyses (
                filename, file_size_kb, error_type, error_message, severity, component, stack_trace,
                root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
                tokens_used, cost, was_truncated, analysis_duration_ms, full_data,
                is_favorite, view_count, analysis_type
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            params![
                analysis.filename,
                analysis.file_size_kb,
                analysis.error_type,
                analysis.error_message,
                analysis.severity,
                analysis.component,
                analysis.stack_trace,
                analysis.root_cause,
                analysis.suggested_fixes,
                analysis.confidence,
                analysis.analyzed_at,
                analysis.ai_model,
                analysis.ai_provider,
                analysis.tokens_used,
                analysis.cost,
                analysis.was_truncated as i32,
                analysis.analysis_duration_ms,
                analysis.full_data,
                analysis.is_favorite as i32,
                analysis.view_count,
                analysis.analysis_type,
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Default page size for paginated queries
    const DEFAULT_PAGE_SIZE: i64 = 50;

    /// Get all analyses (with optional pagination)
    /// If limit is None, uses DEFAULT_PAGE_SIZE. Set to -1 for unlimited (legacy behavior).
    pub fn get_all_analyses(&self) -> Result<Vec<Analysis>> {
        self.get_analyses_paginated(Some(Self::DEFAULT_PAGE_SIZE), Some(0))
    }

    /// Get analyses with pagination support
    /// - limit: Number of results to return (None = default, capped at MAX_PAGE_SIZE)
    /// - offset: Number of results to skip (must be >= 0)
    /// SECURITY: Uses parameterized queries to prevent SQL injection
    pub fn get_analyses_paginated(&self, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn()?;

        // SECURITY: Enforce bounds on pagination parameters
        const MAX_PAGE_SIZE: i64 = 1000;
        let actual_limit = limit
            .unwrap_or(Self::DEFAULT_PAGE_SIZE)
            .max(1)  // At least 1
            .min(MAX_PAGE_SIZE);  // Cap at MAX_PAGE_SIZE
        let actual_offset = offset.unwrap_or(0).max(0);  // No negative offsets

        let sql = "SELECT id, filename, file_size_kb, error_type, error_message, severity, component, stack_trace,
                    root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
                    tokens_used, cost, was_truncated, full_data, is_favorite, last_viewed_at,
                    view_count, analysis_duration_ms, analysis_type
             FROM analyses
             WHERE deleted_at IS NULL
             ORDER BY analyzed_at DESC
             LIMIT ?1 OFFSET ?2";

        let mut stmt = conn.prepare(sql)?;

        let analyses = stmt
            .query_map([actual_limit, actual_offset], |row| {
                Ok(Analysis {
                    id: row.get(0)?,
                    filename: row.get(1)?,
                    file_size_kb: row.get(2)?,
                    error_type: row.get(3)?,
                    error_message: row.get(4)?,
                    severity: row.get(5)?,
                    component: row.get(6)?,
                    stack_trace: row.get(7)?,
                    root_cause: row.get(8)?,
                    suggested_fixes: row.get(9)?,
                    confidence: row.get(10)?,
                    analyzed_at: row.get(11)?,
                    ai_model: row.get(12)?,
                    ai_provider: row.get(13)?,
                    tokens_used: row.get(14)?,
                    cost: row.get(15)?,
                    was_truncated: row.get::<_, i32>(16)? != 0,
                    full_data: row.get(17)?,
                    is_favorite: row.get::<_, i32>(18)? != 0,
                    last_viewed_at: row.get(19)?,
                    view_count: row.get(20)?,
                    analysis_duration_ms: row.get(21)?,
                    analysis_type: row.get::<_, Option<String>>(22)?.unwrap_or_else(|| "complete".to_string()),
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(analyses)
    }

    /// Get total count of analyses (for pagination UI)
    pub fn get_analyses_count(&self) -> Result<i64> {
        let conn = self.lock_conn()?;
        conn.query_row(
            "SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
    }

    pub fn get_analysis_by_id(&self, id: i64) -> Result<Analysis> {
        let conn = self.lock_conn()?;

        // Update view tracking
        conn.execute(
            "UPDATE analyses SET last_viewed_at = datetime('now'), view_count = view_count + 1 WHERE id = ?1",
            params![id],
        )?;

        conn.query_row(
            "SELECT id, filename, file_size_kb, error_type, error_message, severity, component, stack_trace,
                    root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
                    tokens_used, cost, was_truncated, full_data, is_favorite, last_viewed_at,
                    view_count, analysis_duration_ms, analysis_type
             FROM analyses
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(Analysis {
                    id: row.get(0)?,
                    filename: row.get(1)?,
                    file_size_kb: row.get(2)?,
                    error_type: row.get(3)?,
                    error_message: row.get(4)?,
                    severity: row.get(5)?,
                    component: row.get(6)?,
                    stack_trace: row.get(7)?,
                    root_cause: row.get(8)?,
                    suggested_fixes: row.get(9)?,
                    confidence: row.get(10)?,
                    analyzed_at: row.get(11)?,
                    ai_model: row.get(12)?,
                    ai_provider: row.get(13)?,
                    tokens_used: row.get(14)?,
                    cost: row.get(15)?,
                    was_truncated: row.get::<_, i32>(16)? != 0,
                    full_data: row.get(17)?,
                    is_favorite: row.get::<_, i32>(18)? != 0,
                    last_viewed_at: row.get(19)?,
                    view_count: row.get(20)?,
                    analysis_duration_ms: row.get(21)?,
                    analysis_type: row.get::<_, Option<String>>(22)?.unwrap_or_else(|| "complete".to_string()),
                })
            },
        )
    }

    pub fn delete_analysis(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        // Soft delete
        conn.execute("UPDATE analyses SET deleted_at = datetime('now') WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Full-text search using FTS5
    pub fn search_analyses(&self, query: &str, severity_filter: Option<&str>) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn()?;

        let sql = if severity_filter.is_some() {
            "SELECT a.id, a.filename, a.file_size_kb, a.error_type, a.error_message, a.severity, a.component, a.stack_trace,
                    a.root_cause, a.suggested_fixes, a.confidence, a.analyzed_at, a.ai_model, a.ai_provider,
                    a.tokens_used, a.cost, a.was_truncated, a.full_data, a.is_favorite, a.last_viewed_at,
                    a.view_count, a.analysis_duration_ms, a.analysis_type,
                    bm25(analyses_fts) as rank
             FROM analyses a
             JOIN analyses_fts ON a.id = analyses_fts.rowid
             WHERE analyses_fts MATCH ?1
             AND a.severity = ?2
             AND a.deleted_at IS NULL
             ORDER BY rank DESC
             LIMIT 100"
        } else {
            "SELECT a.id, a.filename, a.file_size_kb, a.error_type, a.error_message, a.severity, a.component, a.stack_trace,
                    a.root_cause, a.suggested_fixes, a.confidence, a.analyzed_at, a.ai_model, a.ai_provider,
                    a.tokens_used, a.cost, a.was_truncated, a.full_data, a.is_favorite, a.last_viewed_at,
                    a.view_count, a.analysis_duration_ms, a.analysis_type,
                    bm25(analyses_fts) as rank
             FROM analyses a
             JOIN analyses_fts ON a.id = analyses_fts.rowid
             WHERE analyses_fts MATCH ?1
             AND a.deleted_at IS NULL
             ORDER BY rank DESC
             LIMIT 100"
        };

        let mut stmt = conn.prepare(sql)?;

        let analyses = if let Some(severity) = severity_filter {
            stmt.query_map(params![query, severity], Self::map_row_to_analysis)?
        } else {
            stmt.query_map(params![query], Self::map_row_to_analysis)?
        }
        .collect::<Result<Vec<_>>>()?;

        Ok(analyses)
    }

    // Helper function to map database row to Analysis struct
    fn map_row_to_analysis(row: &rusqlite::Row) -> Result<Analysis> {
        Ok(Analysis {
            id: row.get(0)?,
            filename: row.get(1)?,
            file_size_kb: row.get(2)?,
            error_type: row.get(3)?,
            error_message: row.get(4)?,
            severity: row.get(5)?,
            component: row.get(6)?,
            stack_trace: row.get(7)?,
            root_cause: row.get(8)?,
            suggested_fixes: row.get(9)?,
            confidence: row.get(10)?,
            analyzed_at: row.get(11)?,
            ai_model: row.get(12)?,
            ai_provider: row.get(13)?,
            tokens_used: row.get(14)?,
            cost: row.get(15)?,
            was_truncated: row.get::<_, i32>(16)? != 0,
            full_data: row.get(17)?,
            is_favorite: row.get::<_, i32>(18)? != 0,
            last_viewed_at: row.get(19)?,
            view_count: row.get(20)?,
            analysis_duration_ms: row.get(21)?,
            analysis_type: row.get::<_, Option<String>>(22)?.unwrap_or_else(|| "complete".to_string()),
        })
    }

    // Toggle favorite status
    pub fn toggle_favorite(&self, id: i64) -> Result<bool> {
        let conn = self.lock_conn()?;

        let current: i32 = conn.query_row(
            "SELECT is_favorite FROM analyses WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        let new_value = if current == 0 { 1 } else { 0 };
        conn.execute(
            "UPDATE analyses SET is_favorite = ?1 WHERE id = ?2",
            params![new_value, id],
        )?;

        Ok(new_value != 0)
    }

    // Get favorite analyses
    pub fn get_favorites(&self) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn.prepare(
            "SELECT id, filename, file_size_kb, error_type, error_message, severity, component, stack_trace,
                    root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
                    tokens_used, cost, was_truncated, full_data, is_favorite, last_viewed_at,
                    view_count, analysis_duration_ms, analysis_type
             FROM analyses
             WHERE is_favorite = 1 AND deleted_at IS NULL
             ORDER BY analyzed_at DESC",
        )?;

        let analyses = stmt
            .query_map([], Self::map_row_to_analysis)?
            .collect::<Result<Vec<_>>>()?;

        Ok(analyses)
    }

    // Get recently viewed analyses
    pub fn get_recent(&self, limit: i64) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn.prepare(
            "SELECT id, filename, file_size_kb, error_type, error_message, severity, component, stack_trace,
                    root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
                    tokens_used, cost, was_truncated, full_data, is_favorite, last_viewed_at,
                    view_count, analysis_duration_ms, analysis_type
             FROM analyses
             WHERE last_viewed_at IS NOT NULL AND deleted_at IS NULL
             ORDER BY last_viewed_at DESC
             LIMIT ?1",
        )?;

        let analyses = stmt
            .query_map(params![limit], Self::map_row_to_analysis)?
            .collect::<Result<Vec<_>>>()?;

        Ok(analyses)
    }

    // Database statistics
    pub fn get_statistics(&self) -> Result<serde_json::Value> {
        let conn = self.lock_conn()?;

        let total_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;

        let favorite_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM analyses WHERE is_favorite = 1 AND deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;

        let severity_breakdown: Vec<(String, i64)> = conn
            .prepare("SELECT severity, COUNT(*) FROM analyses WHERE deleted_at IS NULL GROUP BY severity")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>>>()?;

        Ok(serde_json::json!({
            "total_count": total_count,
            "favorite_count": favorite_count,
            "severity_breakdown": severity_breakdown,
        }))
    }

    // Optimize FTS index
    pub fn optimize_fts(&self) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("INSERT INTO analyses_fts(analyses_fts) VALUES('optimize')", [])?;
        Ok(())
    }

    // Run integrity check
    pub fn integrity_check(&self) -> Result<bool> {
        let conn = self.lock_conn()?;
        let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        Ok(result == "ok")
    }

    // Compact database (VACUUM)
    pub fn compact(&self) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("VACUUM", [])?;
        Ok(())
    }

    // Checkpoint WAL to reduce file size and improve performance
    pub fn checkpoint_wal(&self) -> Result<()> {
        let conn = self.lock_conn()?;
        // TRUNCATE mode checkpoints and truncates the WAL file
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", [])?;
        Ok(())
    }

    // Translation methods
    pub fn insert_translation(&self, translation: &Translation) -> Result<i64> {
        let conn = self.lock_conn()?;

        conn.execute(
            "INSERT INTO translations (
                input_content, translation, translated_at, ai_model, ai_provider,
                is_favorite, view_count
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                translation.input_content,
                translation.translation,
                translation.translated_at,
                translation.ai_model,
                translation.ai_provider,
                translation.is_favorite as i32,
                translation.view_count,
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Get all translations (with default pagination)
    pub fn get_all_translations(&self) -> Result<Vec<Translation>> {
        self.get_translations_paginated(Some(Self::DEFAULT_PAGE_SIZE), Some(0))
    }

    /// Get translations with pagination support
    /// SECURITY: Uses parameterized queries to prevent SQL injection
    pub fn get_translations_paginated(&self, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<Translation>> {
        let conn = self.lock_conn()?;

        // SECURITY: Enforce bounds on pagination parameters
        const MAX_PAGE_SIZE: i64 = 1000;
        let actual_limit = limit
            .unwrap_or(Self::DEFAULT_PAGE_SIZE)
            .max(1)  // At least 1
            .min(MAX_PAGE_SIZE);  // Cap at MAX_PAGE_SIZE
        let actual_offset = offset.unwrap_or(0).max(0);  // No negative offsets

        let sql = "SELECT id, input_content, translation, translated_at, ai_model, ai_provider,
                    is_favorite, last_viewed_at, view_count
             FROM translations
             WHERE deleted_at IS NULL
             ORDER BY translated_at DESC
             LIMIT ?1 OFFSET ?2";

        let mut stmt = conn.prepare(sql)?;

        let translations = stmt
            .query_map([actual_limit, actual_offset], |row| {
                Ok(Translation {
                    id: row.get(0)?,
                    input_content: row.get(1)?,
                    translation: row.get(2)?,
                    translated_at: row.get(3)?,
                    ai_model: row.get(4)?,
                    ai_provider: row.get(5)?,
                    is_favorite: row.get::<_, i32>(6)? != 0,
                    last_viewed_at: row.get(7)?,
                    view_count: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(translations)
    }

    /// Get total count of translations (for pagination UI)
    pub fn get_translations_count(&self) -> Result<i64> {
        let conn = self.lock_conn()?;
        conn.query_row(
            "SELECT COUNT(*) FROM translations WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
    }

    pub fn get_translation_by_id(&self, id: i64) -> Result<Translation> {
        let conn = self.lock_conn()?;

        conn.query_row(
            "SELECT id, input_content, translation, translated_at, ai_model, ai_provider,
                    is_favorite, last_viewed_at, view_count
             FROM translations
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| {
                Ok(Translation {
                    id: row.get(0)?,
                    input_content: row.get(1)?,
                    translation: row.get(2)?,
                    translated_at: row.get(3)?,
                    ai_model: row.get(4)?,
                    ai_provider: row.get(5)?,
                    is_favorite: row.get::<_, i32>(6)? != 0,
                    last_viewed_at: row.get(7)?,
                    view_count: row.get(8)?,
                })
            },
        )
    }

    pub fn delete_translation(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("UPDATE translations SET deleted_at = datetime('now') WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn toggle_translation_favorite(&self, id: i64) -> Result<bool> {
        let conn = self.lock_conn()?;

        let is_favorite: i32 = conn.query_row(
            "SELECT is_favorite FROM translations WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        let new_value = if is_favorite != 0 { 0 } else { 1 };

        conn.execute(
            "UPDATE translations SET is_favorite = ?1 WHERE id = ?2",
            params![new_value, id],
        )?;

        Ok(new_value != 0)
    }
}
