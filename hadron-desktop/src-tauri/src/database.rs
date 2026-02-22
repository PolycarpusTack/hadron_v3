use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

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

/// User-defined tag for organizing analyses and translations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub usage_count: i32,
    pub created_at: String,
}

/// JIRA ticket link for an analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraLink {
    pub id: i64,
    pub analysis_id: i64,
    pub jira_key: String,
    pub jira_url: Option<String>,
    pub jira_summary: Option<String>,
    pub jira_status: Option<String>,
    pub jira_priority: Option<String>,
    pub link_type: String,
    pub linked_at: String,
    pub linked_by: Option<String>,
    pub notes: Option<String>,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Drop for Database {
    fn drop(&mut self) {
        // Checkpoint WAL on cleanup to truncate the WAL file
        // parking_lot::Mutex never poisons - direct lock acquisition
        let conn = self.conn.lock();
        let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
    }
}

impl Database {
    /// Column list for SELECT queries returning an Analysis struct.
    /// Must match the field order expected by `map_row_to_analysis`.
    const ANALYSIS_SELECT_COLS: &'static str =
        "id, filename, file_size_kb, error_type, error_message, severity, component, stack_trace, \
         root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider, \
         tokens_used, cost, was_truncated, full_data, is_favorite, last_viewed_at, \
         view_count, analysis_duration_ms, analysis_type";

    /// Same columns with `a.` table alias prefix for JOIN queries.
    const ANALYSIS_SELECT_COLS_ALIASED: &'static str =
        "a.id, a.filename, a.file_size_kb, a.error_type, a.error_message, a.severity, a.component, a.stack_trace, \
         a.root_cause, a.suggested_fixes, a.confidence, a.analyzed_at, a.ai_model, a.ai_provider, \
         a.tokens_used, a.cost, a.was_truncated, a.full_data, a.is_favorite, a.last_viewed_at, \
         a.view_count, a.analysis_duration_ms, a.analysis_type";

    /// Helper method to acquire lock
    /// parking_lot::Mutex never poisons, so this always succeeds
    fn lock_conn(&self) -> parking_lot::MutexGuard<'_, Connection> {
        self.conn.lock()
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
        let conn = self.lock_conn();
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
        let conn = self.lock_conn();

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
    ///
    /// SECURITY: Uses parameterized queries to prevent SQL injection
    pub fn get_analyses_paginated(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn();

        // SECURITY: Enforce bounds on pagination parameters
        const MAX_PAGE_SIZE: i64 = 1000;
        let actual_limit = limit
            .unwrap_or(Self::DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let actual_offset = offset.unwrap_or(0).max(0); // No negative offsets

        let sql = format!(
            "SELECT {} FROM analyses WHERE deleted_at IS NULL ORDER BY analyzed_at DESC LIMIT ?1 OFFSET ?2",
            Self::ANALYSIS_SELECT_COLS
        );

        let mut stmt = conn.prepare(&sql)?;

        let analyses = stmt
            .query_map([actual_limit, actual_offset], Self::map_row_to_analysis)?
            .collect::<Result<Vec<_>>>()?;

        Ok(analyses)
    }

    /// Get total count of analyses (for pagination UI)
    pub fn get_analyses_count(&self) -> Result<i64> {
        let conn = self.lock_conn();
        conn.query_row(
            "SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
    }

    pub fn get_analysis_by_id(&self, id: i64) -> Result<Analysis> {
        let conn = self.lock_conn();

        // Update view tracking
        conn.execute(
            "UPDATE analyses SET last_viewed_at = datetime('now'), view_count = view_count + 1 WHERE id = ?1",
            params![id],
        )?;

        conn.query_row(
            &format!("SELECT {} FROM analyses WHERE id = ?1", Self::ANALYSIS_SELECT_COLS),
            params![id],
            Self::map_row_to_analysis,
        )
    }

    pub fn delete_analysis(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        // Soft delete
        conn.execute(
            "UPDATE analyses SET deleted_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    // Full-text search using FTS5
    pub fn search_analyses(
        &self,
        query: &str,
        severity_filter: Option<&str>,
    ) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn();

        let sql = if severity_filter.is_some() {
            format!(
                "SELECT {}, bm25(analyses_fts) as rank FROM analyses a \
                 JOIN analyses_fts ON a.id = analyses_fts.rowid \
                 WHERE analyses_fts MATCH ?1 AND a.severity = ?2 AND a.deleted_at IS NULL \
                 ORDER BY rank DESC LIMIT 100",
                Self::ANALYSIS_SELECT_COLS_ALIASED
            )
        } else {
            format!(
                "SELECT {}, bm25(analyses_fts) as rank FROM analyses a \
                 JOIN analyses_fts ON a.id = analyses_fts.rowid \
                 WHERE analyses_fts MATCH ?1 AND a.deleted_at IS NULL \
                 ORDER BY rank DESC LIMIT 100",
                Self::ANALYSIS_SELECT_COLS_ALIASED
            )
        };

        let mut stmt = conn.prepare(&sql)?;

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
            analysis_type: row
                .get::<_, Option<String>>(22)?
                .unwrap_or_else(|| "complete".to_string()),
        })
    }

    /// Full-text search with weighted BM25 and optional date/type/severity filters.
    ///
    /// BM25 column weights: error_type=10, error_message=5, root_cause=8,
    /// suggested_fixes=3, component=7, stack_trace=2.
    pub fn search_analyses_filtered(
        &self,
        query: &str,
        severity: Option<&str>,
        date_from: Option<&str>,
        date_to: Option<&str>,
        analysis_types: Option<&[String]>,
        limit: usize,
    ) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn();

        // Build a query with optional filters.
        // We use weighted BM25 for ranking: bm25(table, w1..w6)
        // Columns: error_type=10, error_message=5, root_cause=8,
        //          suggested_fixes=3, component=7, stack_trace=2
        let mut sql = format!(
            "SELECT {}, bm25(analyses_fts, 10.0, 5.0, 8.0, 3.0, 7.0, 2.0) as rank \
             FROM analyses a \
             JOIN analyses_fts ON a.id = analyses_fts.rowid \
             WHERE analyses_fts MATCH ?1 AND a.deleted_at IS NULL",
            Self::ANALYSIS_SELECT_COLS_ALIASED
        );

        // Append optional filters as static SQL conditions
        if severity.is_some() {
            sql.push_str(" AND a.severity = ?2");
        }
        if date_from.is_some() {
            sql.push_str(&format!(
                " AND a.analyzed_at >= ?{}",
                if severity.is_some() { 3 } else { 2 }
            ));
        }
        if date_to.is_some() {
            let idx = 2 + severity.is_some() as usize + date_from.is_some() as usize;
            sql.push_str(&format!(" AND a.analyzed_at <= ?{}", idx));
        }

        sql.push_str(" ORDER BY rank LIMIT ?");
        let limit_idx =
            2 + severity.is_some() as usize + date_from.is_some() as usize + date_to.is_some() as usize;
        sql.push_str(&limit_idx.to_string());

        let mut stmt = conn.prepare(&sql)?;

        // Build dynamic parameter list
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        params_vec.push(Box::new(query.to_string()));
        if let Some(sev) = severity {
            params_vec.push(Box::new(sev.to_string()));
        }
        if let Some(df) = date_from {
            params_vec.push(Box::new(df.to_string()));
        }
        if let Some(dt) = date_to {
            params_vec.push(Box::new(dt.to_string()));
        }
        params_vec.push(Box::new(limit as i64));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        let mut analyses: Vec<Analysis> = stmt
            .query_map(param_refs.as_slice(), Self::map_row_to_analysis)?
            .collect::<Result<Vec<_>>>()?;

        // Post-filter by analysis_types (error_type) if specified.
        // Done in Rust because FTS5 MATCH doesn't support enum-style filtering.
        if let Some(types) = analysis_types {
            if !types.is_empty() {
                let types_lower: Vec<String> = types.iter().map(|t| t.to_lowercase()).collect();
                analyses.retain(|a| {
                    let et = a.error_type.to_lowercase();
                    types_lower.iter().any(|t| et.contains(t))
                });
            }
        }

        Ok(analyses)
    }

    // Toggle favorite status
    pub fn toggle_favorite(&self, id: i64) -> Result<bool> {
        let conn = self.lock_conn();

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
        let conn = self.lock_conn();

        let sql = format!(
            "SELECT {} FROM analyses WHERE is_favorite = 1 AND deleted_at IS NULL ORDER BY analyzed_at DESC",
            Self::ANALYSIS_SELECT_COLS
        );
        let mut stmt = conn.prepare(&sql)?;

        let analyses = stmt
            .query_map([], Self::map_row_to_analysis)?
            .collect::<Result<Vec<_>>>()?;

        Ok(analyses)
    }

    // Get recently viewed analyses
    pub fn get_recent(&self, limit: i64) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn();

        let sql = format!(
            "SELECT {} FROM analyses WHERE last_viewed_at IS NOT NULL AND deleted_at IS NULL ORDER BY last_viewed_at DESC LIMIT ?1",
            Self::ANALYSIS_SELECT_COLS
        );
        let mut stmt = conn.prepare(&sql)?;

        let analyses = stmt
            .query_map(params![limit], Self::map_row_to_analysis)?
            .collect::<Result<Vec<_>>>()?;

        Ok(analyses)
    }

    // Database statistics
    pub fn get_statistics(&self) -> Result<serde_json::Value> {
        let conn = self.lock_conn();

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
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO analyses_fts(analyses_fts) VALUES('optimize')",
            [],
        )?;
        Ok(())
    }

    // Run integrity check
    pub fn integrity_check(&self) -> Result<bool> {
        let conn = self.lock_conn();
        let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        Ok(result == "ok")
    }

    // Compact database (VACUUM)
    pub fn compact(&self) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute("VACUUM", [])?;
        Ok(())
    }

    // Checkpoint WAL to reduce file size and improve performance
    pub fn checkpoint_wal(&self) -> Result<()> {
        let conn = self.lock_conn();
        // TRUNCATE mode checkpoints and truncates the WAL file
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", [])?;
        Ok(())
    }

    // Translation methods
    pub fn insert_translation(&self, translation: &Translation) -> Result<i64> {
        let conn = self.lock_conn();

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
    pub fn get_translations_paginated(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Translation>> {
        let conn = self.lock_conn();

        // SECURITY: Enforce bounds on pagination parameters
        const MAX_PAGE_SIZE: i64 = 1000;
        let actual_limit = limit
            .unwrap_or(Self::DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let actual_offset = offset.unwrap_or(0).max(0); // No negative offsets

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
        let conn = self.lock_conn();
        conn.query_row(
            "SELECT COUNT(*) FROM translations WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
    }

    pub fn get_translation_by_id(&self, id: i64) -> Result<Translation> {
        let conn = self.lock_conn();

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
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE translations SET deleted_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn toggle_translation_favorite(&self, id: i64) -> Result<bool> {
        let conn = self.lock_conn();

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

    // =========================================================================
    // Crash Signature Methods
    // =========================================================================

    /// Upsert a crash signature
    pub fn upsert_signature(&self, signature: &crate::signature::CrashSignature) -> Result<bool> {
        let conn = self.lock_conn();
        crate::signature::upsert_signature(&conn, signature)
    }

    /// Find a signature by hash
    pub fn find_signature_by_hash(
        &self,
        hash: &str,
    ) -> Result<Option<crate::signature::CrashSignature>> {
        let conn = self.lock_conn();
        crate::signature::find_signature_by_hash(&conn, hash)
    }

    /// Link an analysis to a signature
    pub fn link_analysis_to_signature(&self, analysis_id: i64, signature_hash: &str) -> Result<()> {
        let conn = self.lock_conn();
        crate::signature::link_analysis_to_signature(&conn, analysis_id, signature_hash)
    }

    /// Get analyses for a signature
    pub fn get_analyses_for_signature(
        &self,
        hash: &str,
    ) -> Result<Vec<crate::signature::CrashFileSummary>> {
        let conn = self.lock_conn();
        crate::signature::get_analyses_for_signature(&conn, hash)
    }

    /// Get top signatures
    pub fn get_top_signatures(
        &self,
        limit: usize,
        status_filter: Option<&str>,
    ) -> Result<Vec<crate::signature::CrashSignature>> {
        let conn = self.lock_conn();
        crate::signature::get_top_signatures(&conn, limit, status_filter)
    }

    /// Update signature status
    pub fn update_signature_status(
        &self,
        hash: &str,
        status: &str,
        metadata: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock_conn();
        crate::signature::update_signature_status(&conn, hash, status, metadata)
    }

    /// Link a ticket to a signature
    pub fn link_ticket_to_signature(
        &self,
        hash: &str,
        ticket_id: &str,
        ticket_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock_conn();
        crate::signature::link_ticket_to_signature(&conn, hash, ticket_id, ticket_url)
    }

    // =========================================================================
    // Tag Management Methods
    // =========================================================================

    /// Create a new tag
    pub fn create_tag(&self, name: &str, color: &str) -> Result<Tag> {
        let conn = self.lock_conn();

        conn.execute(
            "INSERT INTO tags (name, color) VALUES (?1, ?2)",
            params![name, color],
        )?;

        let id = conn.last_insert_rowid();

        conn.query_row(
            "SELECT id, name, color, usage_count, created_at FROM tags WHERE id = ?1",
            params![id],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    usage_count: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
    }

    /// Update an existing tag
    pub fn update_tag(&self, id: i64, name: Option<&str>, color: Option<&str>) -> Result<Tag> {
        let conn = self.lock_conn();

        // Build dynamic UPDATE query based on which fields are provided
        if let Some(n) = name {
            conn.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![n, id])?;
        }
        if let Some(c) = color {
            conn.execute("UPDATE tags SET color = ?1 WHERE id = ?2", params![c, id])?;
        }

        conn.query_row(
            "SELECT id, name, color, usage_count, created_at FROM tags WHERE id = ?1",
            params![id],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    usage_count: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
    }

    /// Delete a tag (cascade removes from all analysis_tags and translation_tags)
    pub fn delete_tag(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Get all tags ordered by usage count (most used first)
    pub fn get_all_tags(&self) -> Result<Vec<Tag>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, name, color, usage_count, created_at FROM tags ORDER BY usage_count DESC, name ASC"
        )?;

        let tags = stmt
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    usage_count: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(tags)
    }

    /// Get or create a tag ID by name (case-insensitive)
    pub fn get_or_create_tag_id(&self, name: &str, color: &str) -> Result<i64> {
        let conn = self.lock_conn();

        conn.execute(
            "INSERT OR IGNORE INTO tags (name, color) VALUES (?1, ?2)",
            params![name, color],
        )?;

        conn.query_row(
            "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) LIMIT 1",
            params![name],
            |row| row.get(0),
        )
    }

    /// Add a tag to an analysis
    pub fn add_tag_to_analysis(&self, analysis_id: i64, tag_id: i64) -> Result<()> {
        let conn = self.lock_conn();

        // Insert into junction table (IGNORE if already exists)
        conn.execute(
            "INSERT OR IGNORE INTO analysis_tags (analysis_id, tag_id) VALUES (?1, ?2)",
            params![analysis_id, tag_id],
        )?;

        // Increment usage count only if a new row was inserted
        if conn.changes() > 0 {
            conn.execute(
                "UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?1",
                params![tag_id],
            )?;
        }

        Ok(())
    }

    /// Remove a tag from an analysis
    pub fn remove_tag_from_analysis(&self, analysis_id: i64, tag_id: i64) -> Result<()> {
        let conn = self.lock_conn();

        conn.execute(
            "DELETE FROM analysis_tags WHERE analysis_id = ?1 AND tag_id = ?2",
            params![analysis_id, tag_id],
        )?;

        // Decrement usage count only if a row was deleted
        if conn.changes() > 0 {
            conn.execute(
                "UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?1",
                params![tag_id],
            )?;
        }

        Ok(())
    }

    /// Get all tags for a specific analysis
    pub fn get_tags_for_analysis(&self, analysis_id: i64) -> Result<Vec<Tag>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color, t.usage_count, t.created_at
             FROM tags t
             JOIN analysis_tags at ON t.id = at.tag_id
             WHERE at.analysis_id = ?1
             ORDER BY t.name ASC",
        )?;

        let tags = stmt
            .query_map(params![analysis_id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    usage_count: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(tags)
    }

    /// Check if an analysis has any tags
    pub fn analysis_has_tags(&self, analysis_id: i64) -> Result<bool> {
        let conn = self.lock_conn();
        let exists: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM analysis_tags WHERE analysis_id = ?1 LIMIT 1",
                params![analysis_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(exists.is_some())
    }

    /// Count analyses that do not have any tags
    pub fn count_analyses_without_tags(&self) -> Result<i64> {
        let conn = self.lock_conn();
        conn.query_row(
            "SELECT COUNT(*) FROM analyses a
             WHERE a.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM analysis_tags at WHERE at.analysis_id = a.id)",
            [],
            |row| row.get(0),
        )
    }

    /// Add a tag to a translation
    pub fn add_tag_to_translation(&self, translation_id: i64, tag_id: i64) -> Result<()> {
        let conn = self.lock_conn();

        conn.execute(
            "INSERT OR IGNORE INTO translation_tags (translation_id, tag_id) VALUES (?1, ?2)",
            params![translation_id, tag_id],
        )?;

        if conn.changes() > 0 {
            conn.execute(
                "UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?1",
                params![tag_id],
            )?;
        }

        Ok(())
    }

    /// Remove a tag from a translation
    pub fn remove_tag_from_translation(&self, translation_id: i64, tag_id: i64) -> Result<()> {
        let conn = self.lock_conn();

        conn.execute(
            "DELETE FROM translation_tags WHERE translation_id = ?1 AND tag_id = ?2",
            params![translation_id, tag_id],
        )?;

        if conn.changes() > 0 {
            conn.execute(
                "UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?1",
                params![tag_id],
            )?;
        }

        Ok(())
    }

    /// Get all tags for a specific translation
    pub fn get_tags_for_translation(&self, translation_id: i64) -> Result<Vec<Tag>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color, t.usage_count, t.created_at
             FROM tags t
             JOIN translation_tags tt ON t.id = tt.tag_id
             WHERE tt.translation_id = ?1
             ORDER BY t.name ASC",
        )?;

        let tags = stmt
            .query_map(params![translation_id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    usage_count: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(tags)
    }

    // =========================================================================
    // Advanced Filtering Methods
    // =========================================================================

    /// Get analyses with advanced filtering options
    pub fn get_analyses_filtered(
        &self,
        options: &crate::commands::AdvancedFilterOptions,
    ) -> Result<crate::commands::FilteredResults<Analysis>> {
        let conn = self.lock_conn();

        // Build dynamic WHERE clause
        let mut conditions: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        // Soft delete filter (default: exclude deleted)
        if !options.include_archived.unwrap_or(false) {
            conditions.push("a.deleted_at IS NULL".to_string());
        }

        // Favorites filter
        if options.favorites_only.unwrap_or(false) {
            conditions.push("a.is_favorite = 1".to_string());
        }

        // Severity filter
        if let Some(ref severities) = options.severities {
            if !severities.is_empty() {
                let placeholders: Vec<String> = severities
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", params.len() + i + 1))
                    .collect();
                conditions.push(format!(
                    "LOWER(a.severity) IN ({})",
                    placeholders.join(", ")
                ));
                for s in severities {
                    params.push(Box::new(s.to_lowercase()));
                }
            }
        }

        // Analysis type filter
        if let Some(ref types) = options.analysis_types {
            if !types.is_empty() {
                // Expand aliases so callers can use stable canonical types.
                // Example: "jira" should include legacy stored type "jira_ticket".
                let mut expanded_types: Vec<String> = Vec::new();
                for t in types {
                    if !expanded_types.contains(t) {
                        expanded_types.push(t.clone());
                    }
                    if t == "jira" && !expanded_types.iter().any(|et| et == "jira_ticket") {
                        expanded_types.push("jira_ticket".to_string());
                    }
                }

                let placeholders: Vec<String> = expanded_types
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", params.len() + i + 1))
                    .collect();
                conditions.push(format!("a.analysis_type IN ({})", placeholders.join(", ")));
                for t in expanded_types {
                    params.push(Box::new(t.clone()));
                }
            }
        }

        // Analysis mode filter (e.g., "Quick", "Deep Scan")
        if let Some(ref modes) = options.analysis_modes {
            if !modes.is_empty() {
                let placeholders: Vec<String> = modes
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", params.len() + i + 1))
                    .collect();
                // analysis_mode is stored in full_data JSON, use json_extract
                conditions.push(format!(
                    "json_extract(a.full_data, '$.analysis_mode') IN ({})",
                    placeholders.join(", ")
                ));
                for m in modes {
                    params.push(Box::new(m.clone()));
                }
            }
        }

        // Full-text search filter
        if let Some(ref search) = options.search {
            let search_trimmed = search.trim();
            if !search_trimmed.is_empty() {
                // Search across multiple fields using LIKE for simplicity
                // For FTS, we could use the analyses_fts table but LIKE is simpler for cross-field search
                params.push(Box::new(format!("%{}%", search_trimmed)));
                let param_idx = params.len();
                conditions.push(format!(
                    "(a.filename LIKE ?{idx} OR a.error_type LIKE ?{idx} OR a.error_message LIKE ?{idx} OR a.root_cause LIKE ?{idx} OR a.component LIKE ?{idx})",
                    idx = param_idx
                ));
            }
        }

        // Tag filter
        if let Some(ref tag_ids) = options.tag_ids {
            if !tag_ids.is_empty() {
                let tag_mode = options.tag_mode.as_deref().unwrap_or("any");
                if tag_mode == "all" {
                    // AND mode: analysis must have ALL specified tags
                    for (i, tag_id) in tag_ids.iter().enumerate() {
                        params.push(Box::new(*tag_id));
                        conditions.push(format!(
                            "EXISTS (SELECT 1 FROM analysis_tags at{i} WHERE at{i}.analysis_id = a.id AND at{i}.tag_id = ?{})",
                            params.len()
                        ));
                    }
                } else {
                    // OR mode (default): analysis must have ANY of the specified tags
                    let placeholders: Vec<String> = tag_ids
                        .iter()
                        .enumerate()
                        .map(|(i, _)| format!("?{}", params.len() + i + 1))
                        .collect();
                    conditions.push(format!(
                        "EXISTS (SELECT 1 FROM analysis_tags at WHERE at.analysis_id = a.id AND at.tag_id IN ({}))",
                        placeholders.join(", ")
                    ));
                    for tid in tag_ids {
                        params.push(Box::new(*tid));
                    }
                }
            }
        }

        // Date range filter
        if let Some(ref date_from) = options.date_from {
            params.push(Box::new(date_from.clone()));
            conditions.push(format!("a.analyzed_at >= ?{}", params.len()));
        }
        if let Some(ref date_to) = options.date_to {
            params.push(Box::new(date_to.clone()));
            conditions.push(format!("a.analyzed_at <= ?{}", params.len()));
        }

        // Cost range filter
        if let Some(cost_min) = options.cost_min {
            params.push(Box::new(cost_min));
            conditions.push(format!("a.cost >= ?{}", params.len()));
        }
        if let Some(cost_max) = options.cost_max {
            params.push(Box::new(cost_max));
            conditions.push(format!("a.cost <= ?{}", params.len()));
        }

        // Build WHERE clause
        let where_clause = if conditions.is_empty() {
            "1=1".to_string()
        } else {
            conditions.join(" AND ")
        };

        // Sort configuration
        let sort_field = match options.sort_by.as_deref() {
            Some("severity") => "a.severity",
            Some("cost") => "a.cost",
            Some("fileSize") => "a.file_size_kb",
            Some("filename") => "a.filename",
            _ => "a.analyzed_at", // default: date
        };
        let sort_order = match options.sort_order.as_deref() {
            Some("asc") => "ASC",
            _ => "DESC",
        };

        // Pagination
        let limit = options.limit.unwrap_or(50).clamp(1, 1000);
        let offset = options.offset.unwrap_or(0).max(0);
        let page = offset / limit;

        // Count total matching records
        let count_sql = format!("SELECT COUNT(*) FROM analyses a WHERE {}", where_clause);

        // Convert params to references for rusqlite
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let total_count: i64 =
            conn.query_row(&count_sql, param_refs.as_slice(), |row| row.get(0))?;

        // Main query
        let sql = format!(
            "SELECT a.id, a.filename, a.file_size_kb, a.error_type, a.error_message,
                    a.severity, a.component, a.stack_trace, a.root_cause, a.suggested_fixes,
                    a.confidence, a.analyzed_at, a.ai_model, a.ai_provider, a.tokens_used,
                    a.cost, a.was_truncated, a.full_data, a.is_favorite, a.last_viewed_at,
                    a.view_count, a.analysis_duration_ms, a.analysis_type
             FROM analyses a
             WHERE {}
             ORDER BY {} {}
             LIMIT {} OFFSET {}",
            where_clause, sort_field, sort_order, limit, offset
        );

        let mut stmt = conn.prepare(&sql)?;

        let analyses = stmt
            .query_map(param_refs.as_slice(), |row| {
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
                    analysis_type: row
                        .get::<_, Option<String>>(22)?
                        .unwrap_or_else(|| "complete".to_string()),
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        let has_more = (offset + limit) < total_count;

        Ok(crate::commands::FilteredResults {
            items: analyses,
            total_count,
            page,
            page_size: limit,
            has_more,
        })
    }

    // =========================================================================
    // Bulk Operations
    // =========================================================================

    /// Delete multiple analyses in a single transaction
    /// Returns the number of successfully deleted analyses
    pub fn bulk_delete_analyses(&self, ids: &[i64]) -> Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }

        let conn = self.lock_conn();

        // Use a transaction for atomicity
        conn.execute("BEGIN TRANSACTION", [])?;

        let mut deleted = 0;
        for id in ids {
            match conn.execute("DELETE FROM analyses WHERE id = ?1", params![id]) {
                Ok(count) => deleted += count,
                Err(e) => {
                    conn.execute("ROLLBACK", [])?;
                    return Err(e);
                }
            }
        }

        conn.execute("COMMIT", [])?;
        Ok(deleted)
    }

    /// Delete multiple translations in a single transaction
    pub fn bulk_delete_translations(&self, ids: &[i64]) -> Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }

        let conn = self.lock_conn();

        conn.execute("BEGIN TRANSACTION", [])?;

        let mut deleted = 0;
        for id in ids {
            match conn.execute("DELETE FROM translations WHERE id = ?1", params![id]) {
                Ok(count) => deleted += count,
                Err(e) => {
                    conn.execute("ROLLBACK", [])?;
                    return Err(e);
                }
            }
        }

        conn.execute("COMMIT", [])?;
        Ok(deleted)
    }

    /// Add a tag to multiple analyses
    /// Returns the number of successful additions (skips duplicates)
    pub fn bulk_add_tag_to_analyses(&self, analysis_ids: &[i64], tag_id: i64) -> Result<usize> {
        if analysis_ids.is_empty() {
            return Ok(0);
        }

        let conn = self.lock_conn();

        conn.execute("BEGIN TRANSACTION", [])?;

        let mut added = 0;
        for analysis_id in analysis_ids {
            // INSERT OR IGNORE to skip duplicates
            match conn.execute(
                "INSERT OR IGNORE INTO analysis_tags (analysis_id, tag_id) VALUES (?1, ?2)",
                params![analysis_id, tag_id],
            ) {
                Ok(count) => added += count,
                Err(e) => {
                    conn.execute("ROLLBACK", [])?;
                    return Err(e);
                }
            }
        }

        // Update tag usage count
        conn.execute(
            "UPDATE tags SET usage_count = (
                SELECT COUNT(*) FROM analysis_tags WHERE tag_id = ?1
            ) + (
                SELECT COUNT(*) FROM translation_tags WHERE tag_id = ?1
            ) WHERE id = ?1",
            params![tag_id],
        )?;

        conn.execute("COMMIT", [])?;
        Ok(added)
    }

    /// Remove a tag from multiple analyses
    pub fn bulk_remove_tag_from_analyses(
        &self,
        analysis_ids: &[i64],
        tag_id: i64,
    ) -> Result<usize> {
        if analysis_ids.is_empty() {
            return Ok(0);
        }

        let conn = self.lock_conn();

        conn.execute("BEGIN TRANSACTION", [])?;

        let mut removed = 0;
        for analysis_id in analysis_ids {
            match conn.execute(
                "DELETE FROM analysis_tags WHERE analysis_id = ?1 AND tag_id = ?2",
                params![analysis_id, tag_id],
            ) {
                Ok(count) => removed += count,
                Err(e) => {
                    conn.execute("ROLLBACK", [])?;
                    return Err(e);
                }
            }
        }

        // Update tag usage count
        conn.execute(
            "UPDATE tags SET usage_count = (
                SELECT COUNT(*) FROM analysis_tags WHERE tag_id = ?1
            ) + (
                SELECT COUNT(*) FROM translation_tags WHERE tag_id = ?1
            ) WHERE id = ?1",
            params![tag_id],
        )?;

        conn.execute("COMMIT", [])?;
        Ok(removed)
    }

    /// Set favorite status for multiple analyses
    pub fn bulk_set_favorite_analyses(
        &self,
        analysis_ids: &[i64],
        favorite: bool,
    ) -> Result<usize> {
        if analysis_ids.is_empty() {
            return Ok(0);
        }

        let conn = self.lock_conn();

        conn.execute("BEGIN TRANSACTION", [])?;

        let mut updated = 0;
        for analysis_id in analysis_ids {
            match conn.execute(
                "UPDATE analyses SET is_favorite = ?1 WHERE id = ?2",
                params![favorite as i32, analysis_id],
            ) {
                Ok(count) => updated += count,
                Err(e) => {
                    conn.execute("ROLLBACK", [])?;
                    return Err(e);
                }
            }
        }

        conn.execute("COMMIT", [])?;
        Ok(updated)
    }

    /// Set favorite status for multiple translations
    pub fn bulk_set_favorite_translations(
        &self,
        translation_ids: &[i64],
        favorite: bool,
    ) -> Result<usize> {
        if translation_ids.is_empty() {
            return Ok(0);
        }

        let conn = self.lock_conn();

        conn.execute("BEGIN TRANSACTION", [])?;

        let mut updated = 0;
        for translation_id in translation_ids {
            match conn.execute(
                "UPDATE translations SET is_favorite = ?1 WHERE id = ?2",
                params![favorite as i32, translation_id],
            ) {
                Ok(count) => updated += count,
                Err(e) => {
                    conn.execute("ROLLBACK", [])?;
                    return Err(e);
                }
            }
        }

        conn.execute("COMMIT", [])?;
        Ok(updated)
    }

    // =========================================================================
    // Archive System
    // =========================================================================

    /// Archive an analysis (soft delete - sets deleted_at timestamp)
    pub fn archive_analysis(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE analyses SET deleted_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
        )?;
        Ok(())
    }

    /// Restore an archived analysis (clears deleted_at timestamp)
    pub fn restore_analysis(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE analyses SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id],
        )?;
        Ok(())
    }

    /// Get all archived analyses
    pub fn get_archived_analyses(&self) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn();
        let sql = format!(
            "SELECT {} FROM analyses WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
            Self::ANALYSIS_SELECT_COLS
        );
        let mut stmt = conn.prepare(&sql)?;

        let rows = stmt.query_map([], Self::map_row_to_analysis)?;
        rows.collect()
    }

    /// Permanently delete an analysis (from archive)
    pub fn permanently_delete_analysis(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute("DELETE FROM analyses WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Archive a translation (soft delete)
    pub fn archive_translation(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE translations SET deleted_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
        )?;
        Ok(())
    }

    /// Restore an archived translation
    pub fn restore_translation(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE translations SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id],
        )?;
        Ok(())
    }

    /// Bulk archive analyses
    pub fn bulk_archive_analyses(&self, ids: &[i64]) -> Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }

        let conn = self.lock_conn();
        conn.execute("BEGIN TRANSACTION", [])?;

        let mut archived = 0;
        for id in ids {
            match conn.execute(
                "UPDATE analyses SET deleted_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
            ) {
                Ok(count) => archived += count,
                Err(e) => {
                    conn.execute("ROLLBACK", [])?;
                    return Err(e);
                }
            }
        }

        conn.execute("COMMIT", [])?;
        Ok(archived)
    }

    // =========================================================================
    // Notes System
    // =========================================================================

    /// Add a note to an analysis
    pub fn add_note(&self, analysis_id: i64, content: &str) -> Result<AnalysisNote> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO analysis_notes (analysis_id, content) VALUES (?1, ?2)",
            params![analysis_id, content],
        )?;

        let id = conn.last_insert_rowid();
        let note = conn.query_row(
            "SELECT id, analysis_id, content, created_at, updated_at FROM analysis_notes WHERE id = ?1",
            params![id],
            |row| {
                Ok(AnalysisNote {
                    id: row.get(0)?,
                    analysis_id: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )?;

        Ok(note)
    }

    /// Update a note
    pub fn update_note(&self, id: i64, content: &str) -> Result<AnalysisNote> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE analysis_notes SET content = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![content, id],
        )?;

        let note = conn.query_row(
            "SELECT id, analysis_id, content, created_at, updated_at FROM analysis_notes WHERE id = ?1",
            params![id],
            |row| {
                Ok(AnalysisNote {
                    id: row.get(0)?,
                    analysis_id: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )?;

        Ok(note)
    }

    /// Delete a note
    pub fn delete_note(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute("DELETE FROM analysis_notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Get all notes for an analysis
    pub fn get_notes_for_analysis(&self, analysis_id: i64) -> Result<Vec<AnalysisNote>> {
        let conn = self.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, content, created_at, updated_at
             FROM analysis_notes
             WHERE analysis_id = ?1
             ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map(params![analysis_id], |row| {
            Ok(AnalysisNote {
                id: row.get(0)?,
                analysis_id: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        rows.collect()
    }

    /// Check if an analysis has notes
    pub fn analysis_has_notes(&self, analysis_id: i64) -> Result<bool> {
        let conn = self.lock_conn();
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM analysis_notes WHERE analysis_id = ?1",
            params![analysis_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get note count for an analysis
    pub fn get_note_count(&self, analysis_id: i64) -> Result<i32> {
        let conn = self.lock_conn();
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM analysis_notes WHERE analysis_id = ?1",
            params![analysis_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}

/// Analysis note struct
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisNote {
    pub id: i64,
    pub analysis_id: i64,
    pub content: String,
    pub created_at: String,
    pub updated_at: Option<String>,
}

// ============================================================================
// Intelligence Platform Types (Phase 1-2)
// ============================================================================

/// Feedback record for analysis quality tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisFeedback {
    pub id: i64,
    pub analysis_id: i64,
    pub feedback_type: String, // "accept", "reject", "edit", "rating"
    pub field_name: Option<String>,
    pub original_value: Option<String>,
    pub new_value: Option<String>,
    pub rating: Option<i32>,
    pub feedback_at: String,
}

/// Gold analysis - curated, verified analysis for RAG retrieval
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldAnalysis {
    pub id: i64,
    pub source_analysis_id: Option<i64>,
    pub source_type: String,
    pub error_signature: String,
    pub crash_content_hash: Option<String>,
    pub root_cause: String,
    pub suggested_fixes: String,
    pub component: Option<String>,
    pub severity: Option<String>,
    pub validation_status: String,
    pub created_at: String,
    pub verified_by: Option<String>,
    pub times_referenced: i32,
    pub success_rate: Option<f64>,
}

/// Gold analysis with source data for fine-tuning export
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldAnalysisExport {
    pub id: i64,
    pub source_analysis_id: Option<i64>,
    pub source_type: String,
    pub error_signature: String,
    pub root_cause: String,
    pub suggested_fixes: String,
    pub component: Option<String>,
    pub severity: Option<String>,
    pub validation_status: String,
    pub created_at: String,
    pub verified_by: Option<String>,
    // Source analysis data for context
    pub source_full_data: Option<String>,
    pub source_error_type: Option<String>,
    pub source_error_message: Option<String>,
    pub source_stack_trace: Option<String>,
}

/// Retrieval chunk for RAG system
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalChunk {
    pub id: i64,
    pub source_type: String,
    pub source_id: i64,
    pub chunk_index: i32,
    pub content: String,
    pub embedding: Option<Vec<u8>>,
    pub embedding_model: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

impl Database {
    // =========================================================================
    // Similar Crash Detection
    // =========================================================================

    /// Get similar analyses based on error signature
    pub fn get_similar_analyses(&self, analysis_id: i64, limit: i32) -> Result<Vec<Analysis>> {
        let conn = self.lock_conn();

        // First get the error signature of the target analysis
        let signature: Option<String> = conn
            .query_row(
                "SELECT error_signature FROM analyses WHERE id = ?1",
                params![analysis_id],
                |row| row.get(0),
            )
            .ok();

        let signature = match signature {
            Some(s) if !s.is_empty() => s,
            _ => {
                // Generate signature from error_type and component
                let (error_type, component): (String, Option<String>) = conn.query_row(
                    "SELECT error_type, component FROM analyses WHERE id = ?1",
                    params![analysis_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                format!(
                    "{}:{}",
                    error_type.to_lowercase(),
                    component
                        .unwrap_or_else(|| "unknown".to_string())
                        .to_lowercase()
                )
            }
        };

        // Find similar analyses (excluding the original)
        let sql = format!(
            "SELECT {} FROM analyses \
             WHERE error_signature = ?1 AND id != ?2 AND deleted_at IS NULL \
             ORDER BY analyzed_at DESC LIMIT ?3",
            Self::ANALYSIS_SELECT_COLS
        );
        let mut stmt = conn.prepare(&sql)?;

        let rows = stmt.query_map(params![signature, analysis_id, limit], Self::map_row_to_analysis)?;
        rows.collect()
    }

    /// Count similar analyses for an analysis
    pub fn count_similar_analyses(&self, analysis_id: i64) -> Result<i32> {
        let conn = self.lock_conn();

        // Get the error signature
        let signature: Option<String> = conn
            .query_row(
                "SELECT error_signature FROM analyses WHERE id = ?1",
                params![analysis_id],
                |row| row.get(0),
            )
            .ok();

        let signature = match signature {
            Some(s) if !s.is_empty() => s,
            _ => {
                // Generate signature from error_type and component
                let (error_type, component): (String, Option<String>) = conn.query_row(
                    "SELECT error_type, component FROM analyses WHERE id = ?1",
                    params![analysis_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                format!(
                    "{}:{}",
                    error_type.to_lowercase(),
                    component
                        .unwrap_or_else(|| "unknown".to_string())
                        .to_lowercase()
                )
            }
        };

        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM analyses
             WHERE error_signature = ?1
               AND id != ?2
               AND deleted_at IS NULL",
            params![signature, analysis_id],
            |row| row.get(0),
        )?;

        Ok(count)
    }

    // =========================================================================
    // Trend Analytics
    // =========================================================================

    /// Get trend data for a period
    pub fn get_trend_data(&self, period: &str, range_days: i32) -> Result<Vec<TrendDataPoint>> {
        let conn = self.lock_conn();

        // Determine grouping based on period
        let date_format = match period {
            "day" => "%Y-%m-%d",
            "week" => "%Y-%W",
            "month" => "%Y-%m",
            _ => "%Y-%m-%d",
        };

        let mut stmt = conn.prepare(&format!(
            "SELECT
                strftime('{}', analyzed_at) as period_key,
                COUNT(*) as total,
                SUM(CASE WHEN LOWER(severity) = 'critical' THEN 1 ELSE 0 END) as critical_count,
                SUM(CASE WHEN LOWER(severity) = 'high' THEN 1 ELSE 0 END) as high_count,
                SUM(CASE WHEN LOWER(severity) = 'medium' THEN 1 ELSE 0 END) as medium_count,
                SUM(CASE WHEN LOWER(severity) = 'low' THEN 1 ELSE 0 END) as low_count,
                SUM(CASE WHEN analysis_type = 'whatson' THEN 1 ELSE 0 END) as whatson_count,
                SUM(CASE WHEN analysis_type = 'complete' THEN 1 ELSE 0 END) as complete_count,
                SUM(CASE WHEN analysis_type = 'specialized' THEN 1 ELSE 0 END) as specialized_count,
                SUM(cost) as total_cost
             FROM analyses
             WHERE deleted_at IS NULL
               AND analyzed_at >= datetime('now', '-{} days')
             GROUP BY period_key
             ORDER BY period_key ASC",
            date_format, range_days
        ))?;

        let rows = stmt.query_map([], |row| {
            Ok(TrendDataPoint {
                period: row.get(0)?,
                total: row.get(1)?,
                critical_count: row.get(2)?,
                high_count: row.get(3)?,
                medium_count: row.get(4)?,
                low_count: row.get(5)?,
                whatson_count: row.get(6)?,
                complete_count: row.get(7)?,
                specialized_count: row.get(8)?,
                total_cost: row.get(9)?,
            })
        })?;

        rows.collect()
    }

    /// Get top error patterns
    pub fn get_top_error_patterns(&self, limit: i32) -> Result<Vec<ErrorPatternCount>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT error_signature, error_type, component, COUNT(*) as count
             FROM analyses
             WHERE deleted_at IS NULL
               AND error_signature IS NOT NULL
             GROUP BY error_signature
             ORDER BY count DESC
             LIMIT ?1",
        )?;

        let rows = stmt.query_map(params![limit], |row| {
            Ok(ErrorPatternCount {
                signature: row.get(0)?,
                error_type: row.get(1)?,
                component: row.get(2)?,
                count: row.get(3)?,
            })
        })?;

        rows.collect()
    }

    // =========================================================================
    // Intelligence Platform Methods (Phase 1-2)
    // =========================================================================

    /// Submit feedback for an analysis
    pub fn submit_feedback(
        &self,
        analysis_id: i64,
        feedback_type: &str,
        field_name: Option<&str>,
        original_value: Option<&str>,
        new_value: Option<&str>,
        rating: Option<i32>,
    ) -> Result<AnalysisFeedback> {
        let conn = self.lock_conn();

        conn.execute(
            "INSERT INTO analysis_feedback (analysis_id, feedback_type, field_name, original_value, new_value, rating)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                analysis_id,
                feedback_type,
                field_name,
                original_value,
                new_value,
                rating,
            ],
        )?;

        let id = conn.last_insert_rowid();

        // Update the analysis feedback_status
        let new_status = match feedback_type {
            "accept" => "accepted",
            "reject" => "rejected",
            "edit" => "edited",
            "rating" => "rated",
            _ => "pending",
        };

        conn.execute(
            "UPDATE analyses SET feedback_status = ?1 WHERE id = ?2",
            params![new_status, analysis_id],
        )?;

        conn.query_row(
            "SELECT id, analysis_id, feedback_type, field_name, original_value, new_value, rating, feedback_at
             FROM analysis_feedback WHERE id = ?1",
            params![id],
            |row| {
                Ok(AnalysisFeedback {
                    id: row.get(0)?,
                    analysis_id: row.get(1)?,
                    feedback_type: row.get(2)?,
                    field_name: row.get(3)?,
                    original_value: row.get(4)?,
                    new_value: row.get(5)?,
                    rating: row.get(6)?,
                    feedback_at: row.get(7)?,
                })
            },
        )
    }

    /// Get all feedback for an analysis
    pub fn get_feedback_for_analysis(&self, analysis_id: i64) -> Result<Vec<AnalysisFeedback>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, feedback_type, field_name, original_value, new_value, rating, feedback_at
             FROM analysis_feedback
             WHERE analysis_id = ?1
             ORDER BY feedback_at DESC",
        )?;

        let rows = stmt.query_map(params![analysis_id], |row| {
            Ok(AnalysisFeedback {
                id: row.get(0)?,
                analysis_id: row.get(1)?,
                feedback_type: row.get(2)?,
                field_name: row.get(3)?,
                original_value: row.get(4)?,
                new_value: row.get(5)?,
                rating: row.get(6)?,
                feedback_at: row.get(7)?,
            })
        })?;

        rows.collect()
    }

    /// Promote an analysis to gold standard
    pub fn promote_to_gold(&self, analysis_id: i64) -> Result<GoldAnalysis> {
        let conn = self.lock_conn();

        // Get the source analysis
        let (error_type, component, root_cause, suggested_fixes, severity): (
            String,
            Option<String>,
            String,
            String,
            String,
        ) = conn.query_row(
            "SELECT error_type, component, root_cause, suggested_fixes, severity
             FROM analyses WHERE id = ?1",
            params![analysis_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )?;

        // Generate error signature
        let error_signature = format!(
            "{}:{}",
            error_type.to_lowercase(),
            component.as_deref().unwrap_or("unknown").to_lowercase()
        );

        // Check if already promoted
        let existing: std::result::Result<i64, _> = conn.query_row(
            "SELECT id FROM gold_analyses WHERE source_analysis_id = ?1",
            params![analysis_id],
            |row| row.get(0),
        );

        if existing.is_ok() {
            return Err(rusqlite::Error::QueryReturnedNoRows); // Already promoted
        }

        // Insert into gold_analyses with 'pending' status for review workflow
        conn.execute(
            "INSERT INTO gold_analyses (source_analysis_id, source_type, error_signature, root_cause, suggested_fixes, component, severity, validation_status)
             VALUES (?1, 'crash', ?2, ?3, ?4, ?5, ?6, 'pending')",
            params![
                analysis_id,
                error_signature,
                root_cause,
                suggested_fixes,
                component,
                severity,
            ],
        )?;

        let id = conn.last_insert_rowid();

        conn.query_row(
            "SELECT id, source_analysis_id, source_type, error_signature, crash_content_hash, root_cause, suggested_fixes, component, severity, validation_status, created_at, verified_by, times_referenced, success_rate
             FROM gold_analyses WHERE id = ?1",
            params![id],
            |row| {
                Ok(GoldAnalysis {
                    id: row.get(0)?,
                    source_analysis_id: row.get(1)?,
                    source_type: row.get(2)?,
                    error_signature: row.get(3)?,
                    crash_content_hash: row.get(4)?,
                    root_cause: row.get(5)?,
                    suggested_fixes: row.get(6)?,
                    component: row.get(7)?,
                    severity: row.get(8)?,
                    validation_status: row.get(9)?,
                    created_at: row.get(10)?,
                    verified_by: row.get(11)?,
                    times_referenced: row.get(12)?,
                    success_rate: row.get(13)?,
                })
            },
        )
    }

    /// Get all gold analyses
    pub fn get_gold_analyses(&self) -> Result<Vec<GoldAnalysis>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, source_analysis_id, source_type, error_signature, crash_content_hash, root_cause, suggested_fixes, component, severity, validation_status, created_at, verified_by, times_referenced, success_rate
             FROM gold_analyses
             ORDER BY times_referenced DESC, created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(GoldAnalysis {
                id: row.get(0)?,
                source_analysis_id: row.get(1)?,
                source_type: row.get(2)?,
                error_signature: row.get(3)?,
                crash_content_hash: row.get(4)?,
                root_cause: row.get(5)?,
                suggested_fixes: row.get(6)?,
                component: row.get(7)?,
                severity: row.get(8)?,
                validation_status: row.get(9)?,
                created_at: row.get(10)?,
                verified_by: row.get(11)?,
                times_referenced: row.get(12)?,
                success_rate: row.get(13)?,
            })
        })?;

        rows.collect()
    }

    /// Check if an analysis is a gold standard
    pub fn is_gold_analysis(&self, analysis_id: i64) -> Result<bool> {
        let conn = self.lock_conn();

        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM gold_analyses WHERE source_analysis_id = ?1",
            params![analysis_id],
            |row| row.get(0),
        )?;

        Ok(count > 0)
    }

    /// Get pending gold analyses (validation_status = 'pending')
    pub fn get_pending_gold_analyses(&self) -> Result<Vec<GoldAnalysis>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, source_analysis_id, source_type, error_signature, crash_content_hash, root_cause, suggested_fixes, component, severity, validation_status, created_at, verified_by, times_referenced, success_rate
             FROM gold_analyses
             WHERE validation_status = 'pending'
             ORDER BY created_at ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(GoldAnalysis {
                id: row.get(0)?,
                source_analysis_id: row.get(1)?,
                source_type: row.get(2)?,
                error_signature: row.get(3)?,
                crash_content_hash: row.get(4)?,
                root_cause: row.get(5)?,
                suggested_fixes: row.get(6)?,
                component: row.get(7)?,
                severity: row.get(8)?,
                validation_status: row.get(9)?,
                created_at: row.get(10)?,
                verified_by: row.get(11)?,
                times_referenced: row.get(12)?,
                success_rate: row.get(13)?,
            })
        })?;

        rows.collect()
    }

    /// Get gold analyses by status
    pub fn get_gold_analyses_by_status(&self, status: &str) -> Result<Vec<GoldAnalysis>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, source_analysis_id, source_type, error_signature, crash_content_hash, root_cause, suggested_fixes, component, severity, validation_status, created_at, verified_by, times_referenced, success_rate
             FROM gold_analyses
             WHERE validation_status = ?1
             ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map(params![status], |row| {
            Ok(GoldAnalysis {
                id: row.get(0)?,
                source_analysis_id: row.get(1)?,
                source_type: row.get(2)?,
                error_signature: row.get(3)?,
                crash_content_hash: row.get(4)?,
                root_cause: row.get(5)?,
                suggested_fixes: row.get(6)?,
                component: row.get(7)?,
                severity: row.get(8)?,
                validation_status: row.get(9)?,
                created_at: row.get(10)?,
                verified_by: row.get(11)?,
                times_referenced: row.get(12)?,
                success_rate: row.get(13)?,
            })
        })?;

        rows.collect()
    }

    /// Verify a gold analysis (set validation_status to 'verified')
    pub fn verify_gold_analysis(&self, gold_analysis_id: i64, verified_by: Option<&str>) -> Result<()> {
        let conn = self.lock_conn();

        if let Some(name) = verified_by {
            conn.execute(
                "UPDATE gold_analyses SET validation_status = 'verified', verified_by = ?2 WHERE id = ?1",
                params![gold_analysis_id, name],
            )?;
        } else {
            conn.execute(
                "UPDATE gold_analyses SET validation_status = 'verified' WHERE id = ?1",
                params![gold_analysis_id],
            )?;
        }

        Ok(())
    }

    /// Reject a gold analysis (set validation_status to 'rejected')
    pub fn reject_gold_analysis(&self, gold_analysis_id: i64, verified_by: Option<&str>) -> Result<()> {
        let conn = self.lock_conn();

        if let Some(name) = verified_by {
            conn.execute(
                "UPDATE gold_analyses SET validation_status = 'rejected', verified_by = ?2 WHERE id = ?1",
                params![gold_analysis_id, name],
            )?;
        } else {
            conn.execute(
                "UPDATE gold_analyses SET validation_status = 'rejected' WHERE id = ?1",
                params![gold_analysis_id],
            )?;
        }

        Ok(())
    }

    /// Reopen a rejected gold analysis (set validation_status back to 'pending')
    pub fn reopen_gold_analysis(&self, gold_analysis_id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE gold_analyses SET validation_status = 'pending', verified_by = NULL WHERE id = ?1",
            params![gold_analysis_id],
        )?;
        Ok(())
    }

    /// Check if an analysis meets criteria for auto-promotion to gold
    /// Criteria:
    /// - Rating >= 4 stars
    /// - Has 'accept' feedback (thumbs up)
    /// - No 'reject' feedback
    pub fn check_auto_promotion_eligibility(&self, analysis_id: i64) -> Result<bool> {
        let conn = self.lock_conn();

        // Check for reject feedback (disqualifies)
        let has_reject: i32 = conn.query_row(
            "SELECT COUNT(*) FROM analysis_feedback WHERE analysis_id = ?1 AND feedback_type = 'reject'",
            params![analysis_id],
            |row| row.get(0),
        )?;

        if has_reject > 0 {
            return Ok(false);
        }

        // Check for accept feedback (required)
        let has_accept: i32 = conn.query_row(
            "SELECT COUNT(*) FROM analysis_feedback WHERE analysis_id = ?1 AND feedback_type = 'accept'",
            params![analysis_id],
            |row| row.get(0),
        )?;

        if has_accept == 0 {
            return Ok(false);
        }

        // Check for rating >= 4 (if rating exists)
        let avg_rating: Option<f64> = conn.query_row(
            "SELECT AVG(rating) FROM analysis_feedback WHERE analysis_id = ?1 AND feedback_type = 'rating' AND rating IS NOT NULL",
            params![analysis_id],
            |row| row.get(0),
        ).ok();

        // If there are ratings, they must average >= 4
        if let Some(rating) = avg_rating {
            if rating < 4.0 {
                return Ok(false);
            }
        }

        // All criteria met
        Ok(true)
    }

    /// Auto-promote an analysis to gold if it meets criteria
    /// Returns true if promoted, false if criteria not met or already promoted
    pub fn auto_promote_if_eligible(&self, analysis_id: i64) -> Result<bool> {
        // Check if already promoted
        if self.is_gold_analysis(analysis_id)? {
            return Ok(false);
        }

        // Check eligibility
        if !self.check_auto_promotion_eligibility(analysis_id)? {
            return Ok(false);
        }

        // Promote
        self.promote_to_gold(analysis_id)?;
        Ok(true)
    }

    /// Get verified gold analyses with source analysis data for fine-tuning export
    /// Returns gold analyses joined with their source analysis full_data
    pub fn get_gold_analyses_for_export(&self) -> Result<Vec<GoldAnalysisExport>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT g.id, g.source_analysis_id, g.source_type, g.error_signature,
                    g.root_cause, g.suggested_fixes, g.component, g.severity,
                    g.validation_status, g.created_at, g.verified_by,
                    a.full_data, a.error_type, a.error_message, a.stack_trace
             FROM gold_analyses g
             LEFT JOIN analyses a ON g.source_analysis_id = a.id
             WHERE g.validation_status = 'verified'
             ORDER BY g.created_at DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(GoldAnalysisExport {
                id: row.get(0)?,
                source_analysis_id: row.get(1)?,
                source_type: row.get(2)?,
                error_signature: row.get(3)?,
                root_cause: row.get(4)?,
                suggested_fixes: row.get(5)?,
                component: row.get(6)?,
                severity: row.get(7)?,
                validation_status: row.get(8)?,
                created_at: row.get(9)?,
                verified_by: row.get(10)?,
                source_full_data: row.get(11)?,
                source_error_type: row.get(12)?,
                source_error_message: row.get(13)?,
                source_stack_trace: row.get(14)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }

        Ok(results)
    }

    /// Count verified gold analyses
    pub fn count_verified_gold_analyses(&self) -> Result<i64> {
        let conn = self.lock_conn();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM gold_analyses WHERE validation_status = 'verified'",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    // ========================================================================
    // JIRA Ticket Linking Methods (Phase 3)
    // ========================================================================

    /// Link a JIRA ticket to an analysis
    pub fn link_jira_ticket(
        &self,
        analysis_id: i64,
        jira_key: &str,
        jira_url: Option<&str>,
        jira_summary: Option<&str>,
        jira_status: Option<&str>,
        jira_priority: Option<&str>,
        link_type: &str,
        notes: Option<&str>,
    ) -> Result<i64> {
        let conn = self.lock_conn();

        conn.execute(
            "INSERT OR REPLACE INTO analysis_jira_links
             (analysis_id, jira_key, jira_url, jira_summary, jira_status, jira_priority, link_type, notes, linked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
            params![
                analysis_id,
                jira_key,
                jira_url,
                jira_summary,
                jira_status,
                jira_priority,
                link_type,
                notes,
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Unlink a JIRA ticket from an analysis
    pub fn unlink_jira_ticket(&self, analysis_id: i64, jira_key: &str) -> Result<bool> {
        let conn = self.lock_conn();

        let affected = conn.execute(
            "DELETE FROM analysis_jira_links WHERE analysis_id = ?1 AND jira_key = ?2",
            params![analysis_id, jira_key],
        )?;

        Ok(affected > 0)
    }

    /// Get all JIRA links for an analysis
    pub fn get_jira_links_for_analysis(&self, analysis_id: i64) -> Result<Vec<JiraLink>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, jira_key, jira_url, jira_summary, jira_status, jira_priority, link_type, linked_at, linked_by, notes
             FROM analysis_jira_links
             WHERE analysis_id = ?1
             ORDER BY linked_at DESC",
        )?;

        let rows = stmt.query_map([analysis_id], |row| {
            Ok(JiraLink {
                id: row.get(0)?,
                analysis_id: row.get(1)?,
                jira_key: row.get(2)?,
                jira_url: row.get(3)?,
                jira_summary: row.get(4)?,
                jira_status: row.get(5)?,
                jira_priority: row.get(6)?,
                link_type: row.get(7)?,
                linked_at: row.get(8)?,
                linked_by: row.get(9)?,
                notes: row.get(10)?,
            })
        })?;

        rows.collect()
    }

    /// Get all analyses linked to a specific JIRA ticket
    pub fn get_analyses_for_jira_ticket(&self, jira_key: &str) -> Result<Vec<(Analysis, JiraLink)>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT a.id, a.filename, a.file_size_kb, a.error_type, a.error_message, a.severity,
                    a.component, a.stack_trace, a.root_cause, a.suggested_fixes, a.confidence,
                    a.analyzed_at, a.ai_model, a.ai_provider, a.tokens_used, a.cost,
                    a.was_truncated, a.full_data, a.is_favorite, a.last_viewed_at, a.view_count,
                    a.analysis_duration_ms, a.analysis_type,
                    l.id, l.analysis_id, l.jira_key, l.jira_url, l.jira_summary, l.jira_status,
                    l.jira_priority, l.link_type, l.linked_at, l.linked_by, l.notes
             FROM analysis_jira_links l
             JOIN analyses a ON l.analysis_id = a.id
             WHERE l.jira_key = ?1 AND a.deleted_at IS NULL
             ORDER BY l.linked_at DESC",
        )?;

        let rows = stmt.query_map([jira_key], |row| {
            let analysis = Analysis {
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
            };

            let link = JiraLink {
                id: row.get(23)?,
                analysis_id: row.get(24)?,
                jira_key: row.get(25)?,
                jira_url: row.get(26)?,
                jira_summary: row.get(27)?,
                jira_status: row.get(28)?,
                jira_priority: row.get(29)?,
                link_type: row.get(30)?,
                linked_at: row.get(31)?,
                linked_by: row.get(32)?,
                notes: row.get(33)?,
            };

            Ok((analysis, link))
        })?;

        rows.collect()
    }

    /// Update JIRA ticket metadata (status, priority, summary) in links
    pub fn update_jira_link_metadata(
        &self,
        jira_key: &str,
        jira_summary: Option<&str>,
        jira_status: Option<&str>,
        jira_priority: Option<&str>,
    ) -> Result<usize> {
        let conn = self.lock_conn();

        let affected = conn.execute(
            "UPDATE analysis_jira_links
             SET jira_summary = COALESCE(?2, jira_summary),
                 jira_status = COALESCE(?3, jira_status),
                 jira_priority = COALESCE(?4, jira_priority)
             WHERE jira_key = ?1",
            params![jira_key, jira_summary, jira_status, jira_priority],
        )?;

        Ok(affected)
    }

    /// Count linked tickets for an analysis
    pub fn count_jira_links_for_analysis(&self, analysis_id: i64) -> Result<i64> {
        let conn = self.lock_conn();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM analysis_jira_links WHERE analysis_id = ?1",
            params![analysis_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Get all JIRA links across all analyses (for sync service)
    pub fn get_all_jira_links(&self) -> Result<Vec<JiraLink>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, jira_key, jira_url, jira_summary, jira_status, jira_priority, link_type, linked_at, linked_by, notes
             FROM analysis_jira_links
             ORDER BY jira_key, linked_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(JiraLink {
                id: row.get(0)?,
                analysis_id: row.get(1)?,
                jira_key: row.get(2)?,
                jira_url: row.get(3)?,
                jira_summary: row.get(4)?,
                jira_status: row.get(5)?,
                jira_priority: row.get(6)?,
                link_type: row.get(7)?,
                linked_at: row.get(8)?,
                linked_by: row.get(9)?,
                notes: row.get(10)?,
            })
        })?;

        rows.collect()
    }

    // =========================================================================
    // RAG Retrieval Chunks
    // These methods are prepared for native Rust RAG implementation (Phase 3).
    // Currently, RAG uses Python backend - these will be used when migrating
    // to native vector search.
    // =========================================================================

    /// Insert a retrieval chunk for RAG indexing.
    /// Used when indexing analyses, gold standards, or documentation for retrieval.
    #[allow(dead_code)]
    pub fn insert_retrieval_chunk(
        &self,
        source_type: &str,
        source_id: i64,
        chunk_index: i32,
        content: &str,
        embedding: Option<&[u8]>,
        embedding_model: Option<&str>,
        metadata_json: Option<&str>,
    ) -> Result<i64> {
        let conn = self.lock_conn();

        conn.execute(
            "INSERT INTO retrieval_chunks (source_type, source_id, chunk_index, content, embedding, embedding_model, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![source_type, source_id, chunk_index, content, embedding, embedding_model, metadata_json],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Get retrieval chunks for a source
    #[allow(dead_code)]
    pub fn get_retrieval_chunks(&self, source_type: &str, source_id: i64) -> Result<Vec<RetrievalChunk>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, source_type, source_id, chunk_index, content, embedding, embedding_model, metadata_json, created_at
             FROM retrieval_chunks
             WHERE source_type = ?1 AND source_id = ?2
             ORDER BY chunk_index ASC",
        )?;

        let rows = stmt.query_map(params![source_type, source_id], |row| {
            Ok(RetrievalChunk {
                id: row.get(0)?,
                source_type: row.get(1)?,
                source_id: row.get(2)?,
                chunk_index: row.get(3)?,
                content: row.get(4)?,
                embedding: row.get(5)?,
                embedding_model: row.get(6)?,
                metadata_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;

        rows.collect()
    }

    /// Get all chunks that have embeddings (for similarity search)
    #[allow(dead_code)]
    pub fn get_chunks_with_embeddings(&self) -> Result<Vec<RetrievalChunk>> {
        let conn = self.lock_conn();

        let mut stmt = conn.prepare(
            "SELECT id, source_type, source_id, chunk_index, content, embedding, embedding_model, metadata_json, created_at
             FROM retrieval_chunks
             WHERE embedding IS NOT NULL
             ORDER BY source_type, source_id, chunk_index",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(RetrievalChunk {
                id: row.get(0)?,
                source_type: row.get(1)?,
                source_id: row.get(2)?,
                chunk_index: row.get(3)?,
                content: row.get(4)?,
                embedding: row.get(5)?,
                embedding_model: row.get(6)?,
                metadata_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;

        rows.collect()
    }

    /// Update embedding for a chunk
    #[allow(dead_code)]
    pub fn update_chunk_embedding(
        &self,
        chunk_id: i64,
        embedding: &[u8],
        embedding_model: &str,
    ) -> Result<()> {
        let conn = self.lock_conn();

        conn.execute(
            "UPDATE retrieval_chunks SET embedding = ?2, embedding_model = ?3 WHERE id = ?1",
            params![chunk_id, embedding, embedding_model],
        )?;

        Ok(())
    }

    /// Delete chunks for a source (when re-indexing)
    #[allow(dead_code)]
    pub fn delete_retrieval_chunks(&self, source_type: &str, source_id: i64) -> Result<usize> {
        let conn = self.lock_conn();

        let affected = conn.execute(
            "DELETE FROM retrieval_chunks WHERE source_type = ?1 AND source_id = ?2",
            params![source_type, source_id],
        )?;

        Ok(affected)
    }

    /// Count total chunks in the system
    #[allow(dead_code)]
    pub fn count_retrieval_chunks(&self) -> Result<i64> {
        let conn = self.lock_conn();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM retrieval_chunks",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Count chunks with embeddings
    #[allow(dead_code)]
    pub fn count_chunks_with_embeddings(&self) -> Result<i64> {
        let conn = self.lock_conn();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM retrieval_chunks WHERE embedding IS NOT NULL",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    // =========================================================================
    // Chat Feedback Methods (Phase 4.2)
    // =========================================================================

    /// Store or update chat feedback (upsert by session_id + message_id)
    pub fn save_chat_feedback(
        &self,
        session_id: &str,
        message_id: &str,
        rating: &str,
        comment: Option<&str>,
        tools_used: Option<&str>,
        sources_cited: Option<&str>,
        query: Option<&str>,
        reason: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO chat_feedback (session_id, message_id, rating, comment, tools_used, sources_cited, query, reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(session_id, message_id) DO UPDATE SET
                rating = excluded.rating,
                comment = excluded.comment,
                reason = excluded.reason,
                created_at = datetime('now')",
            rusqlite::params![session_id, message_id, rating, comment, tools_used, sources_cited, query, reason],
        )?;
        Ok(())
    }

    /// Delete chat feedback for a specific message (unrate)
    pub fn delete_chat_feedback(&self, session_id: &str, message_id: &str) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "DELETE FROM chat_feedback WHERE session_id = ?1 AND message_id = ?2",
            rusqlite::params![session_id, message_id],
        )?;
        Ok(())
    }

    /// Get all positive feedback entries (for future retrieval boosting)
    #[allow(dead_code)]
    pub fn get_positive_feedback(&self, limit: usize) -> Result<Vec<ChatFeedbackEntry>> {
        let conn = self.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, message_id, rating, comment, tools_used, sources_cited, query, reason, created_at
             FROM chat_feedback WHERE rating = 'positive' ORDER BY created_at DESC LIMIT ?1",
        )?;
        let entries = stmt
            .query_map([limit as i64], |row| {
                Ok(ChatFeedbackEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    message_id: row.get(2)?,
                    rating: row.get(3)?,
                    comment: row.get(4)?,
                    tools_used: row.get(5)?,
                    sources_cited: row.get(6)?,
                    query: row.get(7)?,
                    reason: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    /// Get feedback statistics
    #[allow(dead_code)]
    pub fn get_feedback_stats(&self) -> Result<serde_json::Value> {
        let conn = self.lock_conn();
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chat_feedback",
            [],
            |row| row.get(0),
        )?;
        let positive: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chat_feedback WHERE rating = 'positive'",
            [],
            |row| row.get(0),
        )?;
        let negative: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chat_feedback WHERE rating = 'negative'",
            [],
            |row| row.get(0),
        )?;
        Ok(serde_json::json!({
            "total": total,
            "positive": positive,
            "negative": negative,
            "satisfaction_rate": if total > 0 { positive as f64 / total as f64 * 100.0 } else { 0.0 }
        }))
    }

    /// Get feedback-based boost scores for a set of analysis IDs.
    /// Returns a map of analysis_id -> score_multiplier.
    /// Positively-rated analyses get > 1.0, negatively-rated get < 1.0.
    pub fn get_feedback_scores_for_analyses(&self, ids: &[i64]) -> Result<HashMap<i64, f64>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }

        let conn = self.lock_conn();
        let mut scores = HashMap::new();

        // Query analysis_feedback for accept/reject counts per analysis
        let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT analysis_id, feedback_type, COUNT(*) as cnt \
             FROM analysis_feedback \
             WHERE analysis_id IN ({}) \
             GROUP BY analysis_id, feedback_type",
            placeholders.join(", ")
        );

        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids.iter().map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>).collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;

        // Build per-analysis accept/reject tallies
        let mut accepts: HashMap<i64, i64> = HashMap::new();
        let mut rejects: HashMap<i64, i64> = HashMap::new();

        for row in rows {
            let (aid, ftype, cnt) = row?;
            match ftype.as_str() {
                "accept" => { accepts.insert(aid, cnt); }
                "reject" => { rejects.insert(aid, cnt); }
                _ => {}
            }
        }

        // Compute multipliers
        for &id in ids {
            let acc = *accepts.get(&id).unwrap_or(&0);
            let rej = *rejects.get(&id).unwrap_or(&0);
            if acc > 0 || rej > 0 {
                // Simple formula: base 1.0, +0.2 per accept, -0.3 per reject, clamped
                let multiplier = (1.0 + (acc as f64 * 0.2) - (rej as f64 * 0.3))
                    .max(0.3)
                    .min(2.0);
                scores.insert(id, multiplier);
            }
        }

        Ok(scores)
    }

    // ========================================================================
    // Chat Sessions (Sprint 6)
    // ========================================================================

    pub fn save_chat_session(&self, id: &str, title: &str, created_at: i64, updated_at: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO chat_sessions (id, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at",
            params![id, title, created_at, updated_at],
        )?;
        Ok(())
    }

    pub fn save_chat_message(
        &self,
        id: &str,
        session_id: &str,
        role: &str,
        content: &str,
        sources_json: Option<&str>,
        timestamp: i64,
    ) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, sources_json, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, session_id, role, content, sources_json, timestamp],
        )?;
        Ok(())
    }

    pub fn get_chat_sessions(&self) -> Result<Vec<ChatSessionRecord>> {
        let conn = self.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, is_starred, tags, customer, won_version
             FROM chat_sessions ORDER BY updated_at DESC LIMIT 50",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ChatSessionRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                is_starred: row.get(4)?,
                tags: row.get(5)?,
                customer: row.get(6)?,
                won_version: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_chat_messages(&self, session_id: &str) -> Result<Vec<ChatMessageRecord>> {
        let conn = self.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, sources_json, timestamp
             FROM chat_messages WHERE session_id = ?1 ORDER BY timestamp ASC",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(ChatMessageRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                sources_json: row.get(4)?,
                timestamp: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_chat_session(&self, session_id: &str) -> Result<()> {
        let conn = self.lock_conn();
        // Messages cascade-delete via FK, but SQLite FK enforcement can be off —
        // explicitly delete messages first for safety.
        conn.execute("DELETE FROM chat_messages WHERE session_id = ?1", params![session_id])?;
        conn.execute("DELETE FROM chat_sessions WHERE id = ?1", params![session_id])?;
        Ok(())
    }

    pub fn update_chat_session_title(&self, session_id: &str, title: &str) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, chrono::Utc::now().timestamp_millis(), session_id],
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionRecord {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_starred: bool,
    pub tags: Option<String>,
    pub customer: Option<String>,
    pub won_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub sources_json: Option<String>,
    pub timestamp: i64,
}

/// Trend data point for analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendDataPoint {
    pub period: String,
    pub total: i32,
    pub critical_count: i32,
    pub high_count: i32,
    pub medium_count: i32,
    pub low_count: i32,
    pub whatson_count: i32,
    pub complete_count: i32,
    pub specialized_count: i32,
    pub total_cost: f64,
}

/// Error pattern count for analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPatternCount {
    pub signature: String,
    pub error_type: String,
    pub component: Option<String>,
    pub count: i32,
}

/// Chat feedback entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatFeedbackEntry {
    pub id: i64,
    pub session_id: String,
    pub message_id: String,
    pub rating: String,
    pub comment: Option<String>,
    pub tools_used: Option<String>,
    pub sources_cited: Option<String>,
    pub query: Option<String>,
    pub reason: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Gold Answers Types
// ============================================================================

/// A curated gold-standard Q&A pair saved from chat sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldAnswer {
    pub id: i64,
    pub question: String,
    pub answer: String,
    pub session_id: String,
    pub message_id: String,
    pub won_version: Option<String>,
    pub customer: Option<String>,
    pub tags: Option<String>,
    pub verified_by: Option<String>,
    pub tool_results_json: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Session Summary Types
// ============================================================================

/// AI-generated summary of a chat session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: i64,
    pub session_id: String,
    pub summary_markdown: String,
    pub topic: Option<String>,
    pub won_version: Option<String>,
    pub customer: Option<String>,
    pub is_indexed: bool,
    pub is_exported: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Release Notes Types & CRUD
// ============================================================================

/// Full release notes draft record
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesDraft {
    pub id: i64,
    pub fix_version: String,
    pub content_type: String,
    pub title: String,
    pub markdown_content: String,
    pub original_ai_content: Option<String>,
    pub ticket_keys: String,
    pub ticket_count: i32,
    pub jql_filter: Option<String>,
    pub module_filter: Option<String>,
    pub ai_model: String,
    pub ai_provider: String,
    pub tokens_used: i32,
    pub cost: f64,
    pub generation_duration_ms: Option<i32>,
    pub ai_insights: Option<String>,
    pub status: String,
    pub checklist_state: Option<String>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
    pub version: i32,
    pub parent_id: Option<i64>,
    pub is_manual_edit: bool,
    pub created_at: String,
    pub updated_at: String,
    pub published_at: Option<String>,
}

/// Summary record for list views
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesSummary {
    pub id: i64,
    pub fix_version: String,
    pub content_type: String,
    pub title: String,
    pub ticket_count: i32,
    pub status: String,
    pub version: i32,
    pub is_manual_edit: bool,
    pub ai_model: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Insert params for a new release notes draft
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertReleaseNotes {
    pub fix_version: String,
    pub content_type: String,
    pub title: String,
    pub markdown_content: String,
    pub original_ai_content: Option<String>,
    pub ticket_keys: String,
    pub ticket_count: i32,
    pub jql_filter: Option<String>,
    pub module_filter: Option<String>,
    pub ai_model: String,
    pub ai_provider: String,
    pub tokens_used: i32,
    pub cost: f64,
    pub generation_duration_ms: Option<i32>,
    pub ai_insights: Option<String>,
}

impl Database {
    // ========================================================================
    // Release Notes CRUD
    // ========================================================================

    pub fn insert_release_notes(&self, draft: &InsertReleaseNotes) -> Result<i64> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO release_notes (
                fix_version, content_type, title, markdown_content, original_ai_content,
                ticket_keys, ticket_count, jql_filter, module_filter,
                ai_model, ai_provider, tokens_used, cost, generation_duration_ms, ai_insights
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                draft.fix_version,
                draft.content_type,
                draft.title,
                draft.markdown_content,
                draft.original_ai_content,
                draft.ticket_keys,
                draft.ticket_count,
                draft.jql_filter,
                draft.module_filter,
                draft.ai_model,
                draft.ai_provider,
                draft.tokens_used,
                draft.cost,
                draft.generation_duration_ms,
                draft.ai_insights,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_release_notes(&self, id: i64) -> Result<Option<ReleaseNotesDraft>> {
        let conn = self.lock_conn();
        conn.query_row(
            "SELECT id, fix_version, content_type, title, markdown_content, original_ai_content,
                    ticket_keys, ticket_count, jql_filter, module_filter,
                    ai_model, ai_provider, tokens_used, cost, generation_duration_ms, ai_insights,
                    status, checklist_state, reviewed_by, reviewed_at,
                    version, parent_id, is_manual_edit, created_at, updated_at, published_at
             FROM release_notes WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| {
                Ok(ReleaseNotesDraft {
                    id: row.get(0)?,
                    fix_version: row.get(1)?,
                    content_type: row.get(2)?,
                    title: row.get(3)?,
                    markdown_content: row.get(4)?,
                    original_ai_content: row.get(5)?,
                    ticket_keys: row.get(6)?,
                    ticket_count: row.get(7)?,
                    jql_filter: row.get(8)?,
                    module_filter: row.get(9)?,
                    ai_model: row.get(10)?,
                    ai_provider: row.get(11)?,
                    tokens_used: row.get(12)?,
                    cost: row.get(13)?,
                    generation_duration_ms: row.get(14)?,
                    ai_insights: row.get(15)?,
                    status: row.get(16)?,
                    checklist_state: row.get(17)?,
                    reviewed_by: row.get(18)?,
                    reviewed_at: row.get(19)?,
                    version: row.get(20)?,
                    parent_id: row.get(21)?,
                    is_manual_edit: row.get::<_, i32>(22)? != 0,
                    created_at: row.get(23)?,
                    updated_at: row.get(24)?,
                    published_at: row.get(25)?,
                })
            },
        )
        .optional()
    }

    pub fn list_release_notes(
        &self,
        status_filter: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ReleaseNotesSummary>> {
        let conn = self.lock_conn();
        let (sql, has_status) = if status_filter.is_some() {
            (
                "SELECT id, fix_version, content_type, title, ticket_count, status,
                        version, is_manual_edit, ai_model, created_at, updated_at
                 FROM release_notes
                 WHERE deleted_at IS NULL AND status = ?1
                 ORDER BY updated_at DESC LIMIT ?2 OFFSET ?3",
                true,
            )
        } else {
            (
                "SELECT id, fix_version, content_type, title, ticket_count, status,
                        version, is_manual_edit, ai_model, created_at, updated_at
                 FROM release_notes
                 WHERE deleted_at IS NULL
                 ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2",
                false,
            )
        };

        let mut stmt = conn.prepare(sql)?;

        let map_row = |row: &rusqlite::Row| {
            Ok(ReleaseNotesSummary {
                id: row.get(0)?,
                fix_version: row.get(1)?,
                content_type: row.get(2)?,
                title: row.get(3)?,
                ticket_count: row.get(4)?,
                status: row.get(5)?,
                version: row.get(6)?,
                is_manual_edit: row.get::<_, i32>(7)? != 0,
                ai_model: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        };

        if has_status {
            stmt.query_map(params![status_filter.unwrap(), limit, offset], map_row)?
                .collect()
        } else {
            stmt.query_map(params![limit, offset], map_row)?
                .collect()
        }
    }

    pub fn update_release_notes_content(&self, id: i64, content: &str) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE release_notes SET markdown_content = ?1, is_manual_edit = 1,
                    updated_at = datetime('now') WHERE id = ?2 AND deleted_at IS NULL",
            params![content, id],
        )?;
        Ok(())
    }

    /// Update content + metadata after AI-driven incremental append.
    pub fn update_release_notes_after_append(
        &self,
        id: i64,
        content: &str,
        ticket_keys_json: &str,
        ticket_count: i32,
        tokens_delta: i32,
        cost_delta: f64,
        ai_insights: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE release_notes
             SET markdown_content = ?1,
                 ticket_keys = ?2,
                 ticket_count = ?3,
                 tokens_used = COALESCE(tokens_used, 0) + ?4,
                 cost = COALESCE(cost, 0.0) + ?5,
                 ai_insights = ?6,
                 updated_at = datetime('now')
             WHERE id = ?7 AND deleted_at IS NULL",
            params![
                content,
                ticket_keys_json,
                ticket_count,
                tokens_delta,
                cost_delta,
                ai_insights,
                id
            ],
        )?;
        Ok(())
    }

    pub fn update_release_notes_status(
        &self,
        id: i64,
        status: &str,
        reviewed_by: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock_conn();

        let current_status: String = conn.query_row(
            "SELECT status FROM release_notes WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| row.get(0),
        )?;

        let valid_transition = if current_status == status {
            true
        } else {
            matches!(
                (current_status.as_str(), status),
                ("draft", "in_review")
                    | ("in_review", "approved")
                    | ("approved", "published")
                    | ("published", "archived")
            )
        };

        if !valid_transition {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "Invalid status transition: {} -> {}",
                current_status, status
            )));
        }

        if matches!(status, "approved" | "published") {
            let checklist_state: Option<String> = conn.query_row(
                "SELECT checklist_state FROM release_notes WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| row.get(0),
            )?;

            let checklist_complete = checklist_state
                .as_deref()
                .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
                .and_then(|value| value.as_array().cloned())
                .map(|items| {
                    !items.is_empty()
                        && items.iter().all(|item| {
                            item.get("checked")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false)
                        })
                })
                .unwrap_or(false);

            if !checklist_complete {
                return Err(rusqlite::Error::InvalidParameterName(
                    "Checklist must be complete before approval/publication".to_string(),
                ));
            }
        }

        if status == "published" {
            conn.execute(
                "UPDATE release_notes SET status = ?1, reviewed_by = ?2,
                        reviewed_at = datetime('now'), published_at = datetime('now'),
                        updated_at = datetime('now')
                 WHERE id = ?3 AND deleted_at IS NULL",
                params![status, reviewed_by, id],
            )?;
        } else {
            conn.execute(
                "UPDATE release_notes SET status = ?1, reviewed_by = ?2,
                        reviewed_at = datetime('now'),
                        updated_at = datetime('now')
                 WHERE id = ?3 AND deleted_at IS NULL",
                params![status, reviewed_by, id],
            )?;
        }
        Ok(())
    }

    pub fn update_release_notes_checklist(&self, id: i64, checklist_json: &str) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE release_notes SET checklist_state = ?1, updated_at = datetime('now')
             WHERE id = ?2 AND deleted_at IS NULL",
            params![checklist_json, id],
        )?;
        Ok(())
    }

    pub fn soft_delete_release_notes(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE release_notes SET deleted_at = datetime('now')
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
        )?;
        Ok(())
    }
}

// ============================================================================
// Ask Hadron 2.0 CRUD (Gold Answers, Session Summaries, Chat Session Extensions)
// ============================================================================

impl Database {
    // ========================================================================
    // Gold Answers CRUD
    // ========================================================================

    pub fn save_gold_answer(
        &self,
        question: &str,
        answer: &str,
        session_id: &str,
        message_id: &str,
        won_version: Option<&str>,
        customer: Option<&str>,
        tags: Option<&str>,
        verified_by: Option<&str>,
        tool_results_json: Option<&str>,
    ) -> Result<i64> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO gold_answers (question, answer, session_id, message_id, won_version, customer, tags, verified_by, tool_results_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![question, answer, session_id, message_id, won_version, customer, tags, verified_by, tool_results_json],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_gold_answers(
        &self,
        limit: i64,
        offset: i64,
        customer_filter: Option<&str>,
        tag_filter: Option<&str>,
    ) -> Result<Vec<GoldAnswer>> {
        let conn = self.lock_conn();

        let mut sql = String::from(
            "SELECT id, question, answer, session_id, message_id, won_version, customer, tags, verified_by, tool_results_json, created_at
             FROM gold_answers WHERE 1=1",
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(customer) = customer_filter {
            sql.push_str(&format!(" AND customer LIKE ?{}", param_values.len() + 1));
            param_values.push(Box::new(format!("%{}%", customer)));
        }
        if let Some(tag) = tag_filter {
            sql.push_str(&format!(" AND tags LIKE ?{}", param_values.len() + 1));
            param_values.push(Box::new(format!("%{}%", tag)));
        }

        sql.push_str(&format!(
            " ORDER BY created_at DESC LIMIT ?{} OFFSET ?{}",
            param_values.len() + 1,
            param_values.len() + 2
        ));
        param_values.push(Box::new(limit));
        param_values.push(Box::new(offset));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok(GoldAnswer {
                id: row.get(0)?,
                question: row.get(1)?,
                answer: row.get(2)?,
                session_id: row.get(3)?,
                message_id: row.get(4)?,
                won_version: row.get(5)?,
                customer: row.get(6)?,
                tags: row.get(7)?,
                verified_by: row.get(8)?,
                tool_results_json: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?;
        rows.collect()
    }

    pub fn search_gold_answers(&self, query: &str, limit: i64) -> Result<Vec<GoldAnswer>> {
        let conn = self.lock_conn();
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, question, answer, session_id, message_id, won_version, customer, tags, verified_by, tool_results_json, created_at
             FROM gold_answers
             WHERE question LIKE ?1 OR answer LIKE ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], |row| {
            Ok(GoldAnswer {
                id: row.get(0)?,
                question: row.get(1)?,
                answer: row.get(2)?,
                session_id: row.get(3)?,
                message_id: row.get(4)?,
                won_version: row.get(5)?,
                customer: row.get(6)?,
                tags: row.get(7)?,
                verified_by: row.get(8)?,
                tool_results_json: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_gold_answer(&self, id: i64) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute("DELETE FROM gold_answers WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_gold_answers_for_export(
        &self,
        date_from: Option<&str>,
        date_to: Option<&str>,
        customer: Option<&str>,
        tags: Option<&str>,
    ) -> Result<Vec<GoldAnswer>> {
        let conn = self.lock_conn();

        let mut sql = String::from(
            "SELECT id, question, answer, session_id, message_id, won_version, customer, tags, verified_by, tool_results_json, created_at
             FROM gold_answers WHERE 1=1",
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(from) = date_from {
            sql.push_str(&format!(" AND created_at >= ?{}", param_values.len() + 1));
            param_values.push(Box::new(from.to_string()));
        }
        if let Some(to) = date_to {
            sql.push_str(&format!(" AND created_at <= ?{}", param_values.len() + 1));
            param_values.push(Box::new(to.to_string()));
        }
        if let Some(c) = customer {
            sql.push_str(&format!(" AND customer LIKE ?{}", param_values.len() + 1));
            param_values.push(Box::new(format!("%{}%", c)));
        }
        if let Some(t) = tags {
            sql.push_str(&format!(" AND tags LIKE ?{}", param_values.len() + 1));
            param_values.push(Box::new(format!("%{}%", t)));
        }

        sql.push_str(" ORDER BY created_at DESC");

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok(GoldAnswer {
                id: row.get(0)?,
                question: row.get(1)?,
                answer: row.get(2)?,
                session_id: row.get(3)?,
                message_id: row.get(4)?,
                won_version: row.get(5)?,
                customer: row.get(6)?,
                tags: row.get(7)?,
                verified_by: row.get(8)?,
                tool_results_json: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?;
        rows.collect()
    }

    // ========================================================================
    // Session Summaries CRUD
    // ========================================================================

    pub fn save_session_summary(
        &self,
        session_id: &str,
        summary_markdown: &str,
        topic: Option<&str>,
        won_version: Option<&str>,
        customer: Option<&str>,
    ) -> Result<i64> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO session_summaries (session_id, summary_markdown, topic, won_version, customer)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(session_id) DO UPDATE SET
                summary_markdown = excluded.summary_markdown,
                topic = excluded.topic,
                won_version = excluded.won_version,
                customer = excluded.customer,
                updated_at = datetime('now')",
            params![session_id, summary_markdown, topic, won_version, customer],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_session_summary(&self, session_id: &str) -> Result<Option<SessionSummary>> {
        let conn = self.lock_conn();
        conn.query_row(
            "SELECT id, session_id, summary_markdown, topic, won_version, customer, is_indexed, is_exported, created_at, updated_at
             FROM session_summaries WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    summary_markdown: row.get(2)?,
                    topic: row.get(3)?,
                    won_version: row.get(4)?,
                    customer: row.get(5)?,
                    is_indexed: row.get(6)?,
                    is_exported: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
    }

    pub fn get_summaries_for_export(
        &self,
        date_from: Option<&str>,
        date_to: Option<&str>,
        customer: Option<&str>,
        unexported_only: bool,
    ) -> Result<Vec<SessionSummary>> {
        let conn = self.lock_conn();

        let mut sql = String::from(
            "SELECT id, session_id, summary_markdown, topic, won_version, customer, is_indexed, is_exported, created_at, updated_at
             FROM session_summaries WHERE 1=1",
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if unexported_only {
            sql.push_str(" AND is_exported = 0");
        }
        if let Some(from) = date_from {
            sql.push_str(&format!(" AND created_at >= ?{}", param_values.len() + 1));
            param_values.push(Box::new(from.to_string()));
        }
        if let Some(to) = date_to {
            sql.push_str(&format!(" AND created_at <= ?{}", param_values.len() + 1));
            param_values.push(Box::new(to.to_string()));
        }
        if let Some(c) = customer {
            sql.push_str(&format!(" AND customer LIKE ?{}", param_values.len() + 1));
            param_values.push(Box::new(format!("%{}%", c)));
        }

        sql.push_str(" ORDER BY created_at DESC");

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok(SessionSummary {
                id: row.get(0)?,
                session_id: row.get(1)?,
                summary_markdown: row.get(2)?,
                topic: row.get(3)?,
                won_version: row.get(4)?,
                customer: row.get(5)?,
                is_indexed: row.get(6)?,
                is_exported: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect()
    }

    // ========================================================================
    // Chat Session Extensions (star, tag, metadata)
    // ========================================================================

    pub fn star_chat_session(&self, session_id: &str, starred: bool) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE chat_sessions SET is_starred = ?1, updated_at = ?2 WHERE id = ?3",
            params![starred, chrono::Utc::now().timestamp_millis(), session_id],
        )?;
        Ok(())
    }

    pub fn tag_chat_session(&self, session_id: &str, tags: &str) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE chat_sessions SET tags = ?1, updated_at = ?2 WHERE id = ?3",
            params![tags, chrono::Utc::now().timestamp_millis(), session_id],
        )?;
        Ok(())
    }

    pub fn update_chat_session_metadata(
        &self,
        session_id: &str,
        customer: Option<&str>,
        won_version: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE chat_sessions SET customer = ?1, won_version = ?2, updated_at = ?3 WHERE id = ?4",
            params![customer, won_version, chrono::Utc::now().timestamp_millis(), session_id],
        )?;
        Ok(())
    }
}
