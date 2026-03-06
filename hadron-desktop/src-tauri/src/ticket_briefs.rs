//! CRUD data layer for the ticket_briefs table.
//!
//! Sprint 1: basic get / upsert / delete / engineer-feedback.
//! Sprint 2+: triage_json / brief_json populated by AI commands.

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketBrief {
    pub jira_key: String,
    pub title: String,
    pub customer: Option<String>,
    pub severity: Option<String>,
    pub category: Option<String>,
    pub tags: Option<String>,        // JSON array string e.g. '["infra","login"]'
    pub triage_json: Option<String>,
    pub brief_json: Option<String>,
    pub posted_to_jira: bool,
    pub posted_at: Option<String>,
    pub engineer_rating: Option<i64>,
    pub engineer_notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Insert or replace a ticket brief (upsert keyed on jira_key).
pub fn upsert_ticket_brief(conn: &Connection, brief: &TicketBrief) -> Result<()> {
    conn.execute(
        "INSERT INTO ticket_briefs (
            jira_key, title, customer, severity, category, tags,
            triage_json, brief_json, posted_to_jira, posted_at,
            engineer_rating, engineer_notes, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now'))
        ON CONFLICT(jira_key) DO UPDATE SET
            title           = excluded.title,
            customer        = excluded.customer,
            severity        = excluded.severity,
            category        = excluded.category,
            tags            = excluded.tags,
            triage_json     = excluded.triage_json,
            brief_json      = excluded.brief_json,
            posted_to_jira  = excluded.posted_to_jira,
            posted_at       = excluded.posted_at,
            engineer_rating = excluded.engineer_rating,
            engineer_notes  = excluded.engineer_notes,
            updated_at      = datetime('now')",
        params![
            brief.jira_key,
            brief.title,
            brief.customer,
            brief.severity,
            brief.category,
            brief.tags,
            brief.triage_json,
            brief.brief_json,
            brief.posted_to_jira as i64,
            brief.posted_at,
            brief.engineer_rating,
            brief.engineer_notes,
        ],
    )?;
    Ok(())
}

/// Fetch a single brief by JIRA key. Returns None if not found.
pub fn get_ticket_brief(conn: &Connection, jira_key: &str) -> Result<Option<TicketBrief>> {
    let mut stmt = conn.prepare(
        "SELECT jira_key, title, customer, severity, category, tags,
                triage_json, brief_json, posted_to_jira, posted_at,
                engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs WHERE jira_key = ?1",
    )?;

    let result = stmt.query_row(params![jira_key], |row| {
        Ok(TicketBrief {
            jira_key:        row.get(0)?,
            title:           row.get(1)?,
            customer:        row.get(2)?,
            severity:        row.get(3)?,
            category:        row.get(4)?,
            tags:            row.get(5)?,
            triage_json:     row.get(6)?,
            brief_json:      row.get(7)?,
            posted_to_jira:  row.get::<_, i64>(8)? != 0,
            posted_at:       row.get(9)?,
            engineer_rating: row.get(10)?,
            engineer_notes:  row.get(11)?,
            created_at:      row.get(12)?,
            updated_at:      row.get(13)?,
        })
    });

    match result {
        Ok(brief) => Ok(Some(brief)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Fetch multiple briefs by JIRA keys in a single query.
/// Returns only keys that have a stored brief (missing keys are omitted).
pub fn get_briefs_batch(conn: &Connection, jira_keys: &[String]) -> Result<Vec<TicketBrief>> {
    if jira_keys.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders: Vec<&str> = jira_keys.iter().map(|_| "?").collect();
    let sql = format!(
        "SELECT jira_key, title, customer, severity, category, tags,
                triage_json, brief_json, posted_to_jira, posted_at,
                engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs WHERE jira_key IN ({})",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = jira_keys
        .iter()
        .map(|k| k as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok(TicketBrief {
            jira_key:        row.get(0)?,
            title:           row.get(1)?,
            customer:        row.get(2)?,
            severity:        row.get(3)?,
            category:        row.get(4)?,
            tags:            row.get(5)?,
            triage_json:     row.get(6)?,
            brief_json:      row.get(7)?,
            posted_to_jira:  row.get::<_, i64>(8)? != 0,
            posted_at:       row.get(9)?,
            engineer_rating: row.get(10)?,
            engineer_notes:  row.get(11)?,
            created_at:      row.get(12)?,
            updated_at:      row.get(13)?,
        })
    })?;

    let mut briefs = Vec::new();
    for row in rows {
        briefs.push(row?);
    }
    Ok(briefs)
}

/// Fetch all ticket briefs, ordered by most recently updated first.
pub fn get_all_briefs(conn: &Connection) -> Result<Vec<TicketBrief>> {
    let mut stmt = conn.prepare(
        "SELECT jira_key, title, customer, severity, category, tags,
                triage_json, brief_json, posted_to_jira, posted_at,
                engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(TicketBrief {
            jira_key:        row.get(0)?,
            title:           row.get(1)?,
            customer:        row.get(2)?,
            severity:        row.get(3)?,
            category:        row.get(4)?,
            tags:            row.get(5)?,
            triage_json:     row.get(6)?,
            brief_json:      row.get(7)?,
            posted_to_jira:  row.get::<_, i64>(8)? != 0,
            posted_at:       row.get(9)?,
            engineer_rating: row.get(10)?,
            engineer_notes:  row.get(11)?,
            created_at:      row.get(12)?,
            updated_at:      row.get(13)?,
        })
    })?;

    rows.collect()
}

/// Delete a brief and its embeddings (CASCADE handles ticket_embeddings).
pub fn delete_ticket_brief(conn: &Connection, jira_key: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM ticket_briefs WHERE jira_key = ?1",
        params![jira_key],
    )?;
    Ok(())
}

/// Mark a ticket brief as posted to JIRA with current timestamp.
pub fn mark_posted_to_jira(conn: &Connection, jira_key: &str) -> Result<()> {
    conn.execute(
        "UPDATE ticket_briefs
         SET posted_to_jira = 1, posted_at = datetime('now'), updated_at = datetime('now')
         WHERE jira_key = ?1",
        params![jira_key],
    )?;
    Ok(())
}

/// Update engineer feedback fields only.
pub fn update_engineer_feedback(
    conn: &Connection,
    jira_key: &str,
    rating: Option<i64>,
    notes: Option<String>,
) -> Result<()> {
    conn.execute(
        "UPDATE ticket_briefs
         SET engineer_rating = ?2, engineer_notes = ?3, updated_at = datetime('now')
         WHERE jira_key = ?1",
        params![jira_key, rating, notes],
    )?;
    Ok(())
}
