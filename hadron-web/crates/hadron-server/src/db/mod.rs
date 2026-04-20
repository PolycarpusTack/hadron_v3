//! Database query functions for PostgreSQL via sqlx.

use chrono::{DateTime, Utc};
use hadron_core::error::{HadronError, HadronResult};
use hadron_core::models::*;
use sqlx::PgPool;
use uuid::Uuid;

// ============================================================================
// Dev User Seeding
// ============================================================================

pub async fn seed_dev_user(pool: &PgPool) -> Result<(), sqlx::Error> {
    let dev_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
    sqlx::query(
        "INSERT INTO users (id, azure_oid, email, display_name, role)
         VALUES ($1, 'dev-admin', 'dev@hadron.local', 'Dev Admin', 'admin')
         ON CONFLICT (azure_oid) DO NOTHING",
    )
    .bind(dev_id)
    .execute(pool)
    .await?;

    sqlx::query("INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(dev_id)
        .execute(pool)
        .await?;

    tracing::info!("Dev admin user seeded (id: {dev_id})");
    Ok(())
}

// ============================================================================
// Analyses
// ============================================================================

pub async fn get_analyses_paginated(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<AnalysisSummary>, i64)> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analyses WHERE user_id = $1 AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<AnalysisSummaryRow> = sqlx::query_as(
        "SELECT id, filename, error_type, severity, component, confidence, is_favorite, analyzed_at
         FROM analyses
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY analyzed_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let summaries = rows
        .into_iter()
        .map(|r| AnalysisSummary {
            id: r.id,
            filename: r.filename,
            error_type: r.error_type,
            severity: r.severity,
            component: r.component,
            confidence: r.confidence,
            is_favorite: r.is_favorite,
            analyzed_at: r.analyzed_at,
        })
        .collect();

    Ok((summaries, total.0))
}

pub async fn get_analysis_by_id(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
) -> HadronResult<Analysis> {
    let row: AnalysisRow = sqlx::query_as(
        "SELECT id, user_id, filename, file_size_kb, error_type, error_message,
                severity, component, stack_trace, root_cause, suggested_fixes,
                confidence, ai_model, ai_provider, tokens_used, cost,
                analysis_duration_ms, is_favorite, view_count, error_signature,
                full_data, analyzed_at, created_at, updated_at
         FROM analyses
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Analysis {id} not found")))?;

    // Increment view count
    sqlx::query(
        "UPDATE analyses SET view_count = view_count + 1, last_viewed_at = now() WHERE id = $1",
    )
    .bind(id)
    .execute(pool)
    .await
    .ok(); // Non-critical, don't fail the request

    Ok(row.into())
}

pub async fn insert_analysis(
    pool: &PgPool,
    user_id: Uuid,
    analysis: &AnalysisResponse,
    filename: &str,
    file_size_kb: Option<f64>,
    full_data: Option<&serde_json::Value>,
) -> HadronResult<i64> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO analyses (
            user_id, filename, file_size_kb, error_type, error_message,
            severity, root_cause, suggested_fixes, confidence, component,
            ai_model, ai_provider, tokens_used, cost, analysis_duration_ms, full_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id",
    )
    .bind(user_id)
    .bind(filename)
    .bind(file_size_kb)
    .bind(&analysis.error_type)
    .bind(&analysis.error_message)
    .bind(&analysis.severity)
    .bind(&analysis.root_cause)
    .bind(&analysis.suggested_fixes)
    .bind(&analysis.confidence)
    .bind(&analysis.component)
    .bind::<Option<&str>>(None) // ai_model — set by analysis service
    .bind::<Option<&str>>(None) // ai_provider
    .bind(analysis.tokens_used)
    .bind(analysis.cost)
    .bind(analysis.duration_ms)
    .bind(full_data)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.0)
}

pub async fn delete_analysis(pool: &PgPool, id: i64, user_id: Uuid) -> HadronResult<()> {
    let result = sqlx::query(
        "UPDATE analyses SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!("Analysis {id} not found")));
    }

    Ok(())
}

pub async fn toggle_favorite(pool: &PgPool, id: i64, user_id: Uuid) -> HadronResult<bool> {
    let row: (bool,) = sqlx::query_as(
        "UPDATE analyses SET is_favorite = NOT is_favorite
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING is_favorite",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Analysis {id} not found")))?;

    Ok(row.0)
}

pub async fn search_analyses(
    pool: &PgPool,
    user_id: Uuid,
    query: &str,
    limit: i64,
) -> HadronResult<Vec<AnalysisSummary>> {
    let rows: Vec<AnalysisSummaryRow> = sqlx::query_as(
        "SELECT id, filename, error_type, severity, component, confidence, is_favorite, analyzed_at
         FROM analyses
         WHERE user_id = $1
           AND deleted_at IS NULL
           AND search_vector @@ plainto_tsquery('english', $2)
         ORDER BY ts_rank(search_vector, plainto_tsquery('english', $2)) DESC
         LIMIT $3",
    )
    .bind(user_id)
    .bind(query)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// FTS search scoped to a specific analysis_type (e.g. "sentry", "performance").
pub async fn search_analyses_by_type(
    pool: &PgPool,
    user_id: Uuid,
    analysis_type: &str,
    query: &str,
    limit: i64,
) -> HadronResult<Vec<AnalysisSummary>> {
    let rows: Vec<AnalysisSummaryRow> = sqlx::query_as(
        "SELECT id, filename, error_type, severity, component, confidence, is_favorite, analyzed_at
         FROM analyses
         WHERE user_id = $1
           AND analysis_type = $2
           AND deleted_at IS NULL
           AND search_vector @@ plainto_tsquery('english', $3)
         ORDER BY ts_rank(search_vector, plainto_tsquery('english', $3)) DESC
         LIMIT $4",
    )
    .bind(user_id)
    .bind(analysis_type)
    .bind(query)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Fetch a single analysis by id, scoped to a specific analysis_type.
pub async fn get_analysis_by_id_and_type(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
    analysis_type: &str,
) -> HadronResult<Option<hadron_core::models::Analysis>> {
    let row: Option<AnalysisRow> = sqlx::query_as(
        "SELECT id, user_id, filename, file_size_kb, error_type, error_message,
                severity, component, stack_trace, root_cause, suggested_fixes,
                confidence, ai_model, ai_provider, tokens_used, cost,
                analysis_duration_ms, is_favorite, view_count, error_signature,
                full_data, analyzed_at, created_at, updated_at
         FROM analyses
         WHERE id = $1 AND user_id = $2 AND analysis_type = $3 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .bind(analysis_type)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.map(Into::into))
}

// ============================================================================
// Chat Sessions
// ============================================================================

pub async fn get_chat_sessions(
    pool: &PgPool,
    user_id: Uuid,
) -> HadronResult<Vec<ChatSession>> {
    let rows: Vec<ChatSessionRow> = sqlx::query_as(
        "SELECT id, user_id, title, created_at, updated_at
         FROM chat_sessions
         WHERE user_id = $1
         ORDER BY updated_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn verify_session_ownership(
    pool: &PgPool,
    session_id: &str,
    user_id: Uuid,
) -> HadronResult<bool> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1",
    )
    .bind(session_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;
    Ok(row.is_some())
}

pub async fn create_chat_session(
    pool: &PgPool,
    user_id: Uuid,
    title: &str,
) -> HadronResult<ChatSession> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    sqlx::query(
        "INSERT INTO chat_sessions (id, user_id, title) VALUES ($1, $2, $3)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(title)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(ChatSession {
        id,
        user_id,
        title: title.to_string(),
        created_at: now,
        updated_at: now,
    })
}

pub async fn save_chat_message(
    pool: &PgPool,
    session_id: &str,
    role: &str,
    content: &str,
) -> HadronResult<()> {
    sqlx::query(
        "INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)",
    )
    .bind(session_id)
    .bind(role)
    .bind(content)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    // Update session timestamp
    sqlx::query("UPDATE chat_sessions SET updated_at = now() WHERE id = $1")
        .bind(session_id)
        .execute(pool)
        .await
        .ok();

    Ok(())
}

pub async fn get_chat_messages(
    pool: &PgPool,
    session_id: &str,
    user_id: Uuid,
) -> HadronResult<Vec<ChatMessage>> {
    // Verify ownership
    let exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2",
    )
    .bind(session_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if exists.is_none() {
        return Err(HadronError::not_found("Chat session not found"));
    }

    let rows: Vec<ChatMessageRow> = sqlx::query_as(
        "SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|r| ChatMessage {
            role: r.role,
            content: r.content,
        })
        .collect())
}

// ============================================================================
// Settings
// ============================================================================

pub async fn get_user_settings(
    pool: &PgPool,
    user_id: Uuid,
) -> HadronResult<serde_json::Value> {
    let row: Option<(serde_json::Value,)> =
        sqlx::query_as("SELECT settings FROM user_settings WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.map(|r| r.0).unwrap_or(serde_json::json!({})))
}

pub async fn update_user_settings(
    pool: &PgPool,
    user_id: Uuid,
    settings: &serde_json::Value,
) -> HadronResult<()> {
    sqlx::query(
        "INSERT INTO user_settings (user_id, settings)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET settings = $2",
    )
    .bind(user_id)
    .bind(settings)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

// ============================================================================
// Admin: User Management
// ============================================================================

pub async fn list_users(pool: &PgPool) -> HadronResult<Vec<User>> {
    let rows: Vec<UserListRow> = sqlx::query_as(
        "SELECT id, azure_oid, email, display_name, role::text, team_id, is_active, created_at, last_login_at
         FROM users ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn update_user_role(
    pool: &PgPool,
    user_id: Uuid,
    role: Role,
) -> HadronResult<()> {
    let result = sqlx::query("UPDATE users SET role = $1::user_role WHERE id = $2")
        .bind(role.as_str())
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found("User not found"));
    }

    Ok(())
}

// ============================================================================
// Team / Lead: shared analysis feed
// ============================================================================

/// Get analyses from all team members (for leads viewing team history).
pub async fn get_team_analyses(
    pool: &PgPool,
    team_id: Uuid,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<TeamAnalysisSummary>, i64)> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)
         FROM analyses a JOIN users u ON a.user_id = u.id
         WHERE u.team_id = $1 AND a.deleted_at IS NULL",
    )
    .bind(team_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<TeamAnalysisRow> = sqlx::query_as(
        "SELECT a.id, a.filename, a.error_type, a.severity, a.component, a.confidence,
                a.is_favorite, a.analyzed_at, u.display_name as analyst_name
         FROM analyses a
         JOIN users u ON a.user_id = u.id
         WHERE u.team_id = $1 AND a.deleted_at IS NULL
         ORDER BY a.analyzed_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(team_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let summaries = rows.into_iter().map(Into::into).collect();
    Ok((summaries, total.0))
}

/// Get all analyses across the platform (for admins).
pub async fn get_all_analyses(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<TeamAnalysisSummary>, i64)> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<TeamAnalysisRow> = sqlx::query_as(
        "SELECT a.id, a.filename, a.error_type, a.severity, a.component, a.confidence,
                a.is_favorite, a.analyzed_at, u.display_name as analyst_name
         FROM analyses a
         JOIN users u ON a.user_id = u.id
         WHERE a.deleted_at IS NULL
         ORDER BY a.analyzed_at DESC
         LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let summaries = rows.into_iter().map(Into::into).collect();
    Ok((summaries, total.0))
}

// ============================================================================
// Release Notes
// ============================================================================

pub async fn create_release_note(
    pool: &PgPool,
    user_id: Uuid,
    title: &str,
    version: Option<&str>,
    content: &str,
    format: &str,
) -> HadronResult<ReleaseNote> {
    let row: ReleaseNoteRow = sqlx::query_as(
        "INSERT INTO release_notes (user_id, title, version, content, format)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, title, version, content, format, is_published, created_at, updated_at, ai_insights,
                   status, checklist_state, reviewed_by, reviewed_at, published_at, markdown_content",
    )
    .bind(user_id)
    .bind(title)
    .bind(version)
    .bind(content)
    .bind(format)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.into())
}

pub async fn get_release_notes(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<ReleaseNote>, i64)> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM release_notes WHERE user_id = $1 AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<ReleaseNoteRow> = sqlx::query_as(
        "SELECT id, user_id, title, version, content, format, is_published, created_at, updated_at, ai_insights,
                status, checklist_state, reviewed_by, reviewed_at, published_at, markdown_content
         FROM release_notes
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

/// Fetch a release note by ID without filtering by user_id.
/// Used by leads/admins who need to access notes they don't own (approval, compliance, publish).
pub async fn get_release_note_by_id(pool: &PgPool, id: i64) -> HadronResult<ReleaseNote> {
    let row: ReleaseNoteRow = sqlx::query_as(
        "SELECT id, user_id, title, version, content, format, is_published, created_at, updated_at, ai_insights,
                status, checklist_state, reviewed_by, reviewed_at, published_at, markdown_content
         FROM release_notes
         WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Release note {id} not found")))?;

    Ok(row.into())
}

pub async fn get_release_note(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
) -> HadronResult<ReleaseNote> {
    let row: ReleaseNoteRow = sqlx::query_as(
        "SELECT id, user_id, title, version, content, format, is_published, created_at, updated_at, ai_insights,
                status, checklist_state, reviewed_by, reviewed_at, published_at, markdown_content
         FROM release_notes
         WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Release note {id} not found")))?;

    Ok(row.into())
}

/// Fetch a release note by fix version string. Returns the most recent match.
pub async fn get_release_note_by_version(
    pool: &PgPool,
    user_id: Uuid,
    fix_version: &str,
) -> HadronResult<Option<ReleaseNote>> {
    let row: Option<ReleaseNoteRow> = sqlx::query_as(
        "SELECT id, user_id, title, version, content, format, is_published, created_at, updated_at, ai_insights,
                status, checklist_state, reviewed_by, reviewed_at, published_at, markdown_content
         FROM release_notes
         WHERE user_id = $1 AND version = $2 AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(user_id)
    .bind(fix_version)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.map(Into::into))
}

pub async fn update_release_note(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
    title: Option<&str>,
    version: Option<&str>,
    content: Option<&str>,
    format: Option<&str>,
) -> HadronResult<ReleaseNote> {
    // First verify ownership
    let _existing = get_release_note(pool, id, user_id).await?;

    // Build dynamic update
    let row: ReleaseNoteRow = sqlx::query_as(
        "UPDATE release_notes
         SET title = COALESCE($3, title),
             version = COALESCE($4, version),
             content = COALESCE($5, content),
             format = COALESCE($6, format)
         WHERE id = $1 AND user_id = $2
         RETURNING id, user_id, title, version, content, format, is_published, created_at, updated_at, ai_insights,
                   status, checklist_state, reviewed_by, reviewed_at, published_at, markdown_content",
    )
    .bind(id)
    .bind(user_id)
    .bind(title)
    .bind(version)
    .bind(content)
    .bind(format)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.into())
}

pub async fn delete_release_note(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
) -> HadronResult<()> {
    let result = sqlx::query(
        "DELETE FROM release_notes WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!("Release note {id} not found")));
    }

    Ok(())
}

pub async fn publish_release_note(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
) -> HadronResult<ReleaseNote> {
    let row: ReleaseNoteRow = sqlx::query_as(
        "UPDATE release_notes
         SET is_published = TRUE
         WHERE id = $1 AND user_id = $2
         RETURNING id, user_id, title, version, content, format, is_published, created_at, updated_at, ai_insights,
                   status, checklist_state, reviewed_by, reviewed_at, published_at, markdown_content",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Release note {id} not found")))?;

    Ok(row.into())
}

pub async fn update_release_note_status(
    pool: &PgPool,
    id: i64,
    _user_id: Uuid,
    status: &str,
    reviewed_by: Option<Uuid>,
    reviewed_at: Option<DateTime<Utc>>,
    published_at: Option<DateTime<Utc>>,
) -> HadronResult<()> {
    let result = sqlx::query(
        "UPDATE release_notes
         SET status = $1, reviewed_by = $2, reviewed_at = $3, published_at = $4
         WHERE id = $5 AND deleted_at IS NULL",
    )
    .bind(status)
    .bind(reviewed_by)
    .bind(reviewed_at)
    .bind(published_at)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!("Release note {id} not found")));
    }

    Ok(())
}

pub async fn update_release_note_checklist(
    pool: &PgPool,
    id: i64,
    user_id: Uuid,
    checklist: &serde_json::Value,
) -> HadronResult<()> {
    let result = sqlx::query(
        "UPDATE release_notes
         SET checklist_state = $1
         WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL",
    )
    .bind(checklist)
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!("Release note {id} not found")));
    }

    Ok(())
}

pub async fn get_release_note_owner(pool: &PgPool, id: i64) -> HadronResult<Uuid> {
    let row: (Uuid,) = sqlx::query_as(
        "SELECT user_id FROM release_notes WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Release note {id} not found")))?;

    Ok(row.0)
}

// ============================================================================
// Embeddings (pgvector)
// ============================================================================

/// Store an embedding vector for a source entity.
///
/// `owner_user_id` scopes the row to a user so tenant-aware lookups can
/// filter on it. Pass `None` for sources that are shared by product design
/// (currently `ticket` and `release_note`); pass `Some(user_id)` for
/// private per-user sources (currently `analysis`).
pub async fn store_embedding(
    pool: &PgPool,
    source_id: i64,
    source_type: &str,
    embedding: &[f32],
    content: &str,
    metadata: Option<&serde_json::Value>,
    owner_user_id: Option<Uuid>,
) -> HadronResult<i64> {
    // Convert Vec<f32> to pgvector format string: [0.1,0.2,...]
    let vec_str = format!(
        "[{}]",
        embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    let row: (i64,) = sqlx::query_as(
        "INSERT INTO embeddings (source_type, source_id, chunk_index, content, embedding, metadata, owner_user_id)
         VALUES ($1, $2, 0, $3, $4::vector, $5, $6)
         ON CONFLICT (source_type, source_id, chunk_index) DO UPDATE
         SET embedding = $4::vector, content = $3, metadata = $5, owner_user_id = $6
         RETURNING id",
    )
    .bind(source_type)
    .bind(source_id)
    .bind(content)
    .bind(&vec_str)
    .bind(metadata)
    .bind(owner_user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.0)
}

/// Find analyses similar to the given embedding vector, scoped to the
/// calling user's own corpus.
///
/// N2 (2026-04-20 pass-2 audit): the neighbour query previously had no
/// ownership filter, so an analyst running "find similar" on one of
/// their own analyses could receive filename / error_type / severity
/// snippets drawn from every other user's analyses. Uses the
/// `owner_user_id` column added to `embeddings` by migration 018.
pub async fn find_similar_analyses(
    pool: &PgPool,
    embedding: &[f32],
    owner_user_id: Uuid,
    limit: i64,
    threshold: f64,
    exclude_analysis_id: Option<i64>,
) -> HadronResult<Vec<SimilarAnalysis>> {
    let vec_str = format!(
        "[{}]",
        embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    let exclude_id = exclude_analysis_id.unwrap_or(-1);

    let rows: Vec<SimilarAnalysisRow> = sqlx::query_as(
        "SELECT a.id, a.filename, a.error_type, a.severity,
                1 - (e.embedding <=> $1::vector) as similarity
         FROM embeddings e
         JOIN analyses a ON e.source_id = a.id AND e.source_type = 'analysis'
         WHERE a.deleted_at IS NULL
           AND e.owner_user_id = $2
           AND a.id != $5
           AND 1 - (e.embedding <=> $1::vector) > $3
         ORDER BY e.embedding <=> $1::vector
         LIMIT $4",
    )
    .bind(&vec_str)
    .bind(owner_user_id)
    .bind(threshold)
    .bind(limit)
    .bind(exclude_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Check if a source entity already has an embedding.
#[allow(dead_code)]
pub async fn has_embedding(pool: &PgPool, source_id: i64, source_type: &str) -> HadronResult<bool> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM embeddings WHERE source_id = $1 AND source_type = $2 LIMIT 1",
    )
    .bind(source_id)
    .bind(source_type)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.is_some())
}

/// Get the embedding vector for an analysis.
pub async fn get_embedding(pool: &PgPool, source_id: i64, source_type: &str) -> HadronResult<Option<Vec<f32>>> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT embedding::text FROM embeddings WHERE source_id = $1 AND source_type = $2",
    )
    .bind(source_id)
    .bind(source_type)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    match row {
        Some((vec_str,)) => {
            let trimmed = vec_str.trim_start_matches('[').trim_end_matches(']');
            let embedding: Vec<f32> = trimmed
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            Ok(Some(embedding))
        }
        None => Ok(None),
    }
}

/// Generic vector search across all (or a filtered) source type.
///
/// Returns rows as `(source_id, source_type, content, distance)` where
/// `distance` is the cosine distance (0 = identical, 2 = opposite).
/// Lower distance = more similar.
///
/// * `source_type` — when `Some`, restricts to that single source type.
/// * `owner_user_id` — when `Some`, restricts to rows owned by that user.
///   Rows with `NULL` owner (shared sources like `ticket`, `release_note`)
///   are excluded when this filter is active. Callers that want shared
///   data must pass `None` and restrict via `source_type` instead.
pub async fn vector_search(
    pool: &PgPool,
    query_embedding: &[f32],
    limit: i64,
    source_type: Option<&str>,
    owner_user_id: Option<Uuid>,
) -> HadronResult<Vec<(i64, String, String, f64)>> {
    let vec_str = format!(
        "[{}]",
        query_embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    let rows: Vec<(i64, String, String, f64)> = match (source_type, owner_user_id) {
        (Some(st), Some(uid)) => sqlx::query_as(
            "SELECT source_id, source_type, content, (embedding <=> $1::vector) AS distance
             FROM embeddings
             WHERE source_type = $2 AND owner_user_id = $3
             ORDER BY embedding <=> $1::vector
             LIMIT $4",
        )
        .bind(&vec_str)
        .bind(st)
        .bind(uid)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?,
        (Some(st), None) => sqlx::query_as(
            "SELECT source_id, source_type, content, (embedding <=> $1::vector) AS distance
             FROM embeddings
             WHERE source_type = $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3",
        )
        .bind(&vec_str)
        .bind(st)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?,
        (None, Some(uid)) => sqlx::query_as(
            "SELECT source_id, source_type, content, (embedding <=> $1::vector) AS distance
             FROM embeddings
             WHERE owner_user_id = $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3",
        )
        .bind(&vec_str)
        .bind(uid)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?,
        (None, None) => sqlx::query_as(
            "SELECT source_id, source_type, content, (embedding <=> $1::vector) AS distance
             FROM embeddings
             ORDER BY embedding <=> $1::vector
             LIMIT $2",
        )
        .bind(&vec_str)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?,
    };

    Ok(rows)
}

/// Return `(total_analyses, embedded_analyses)` counts for coverage reporting.
pub async fn get_embedding_coverage(pool: &PgPool) -> HadronResult<(i64, i64)> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let embedded: (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT source_id) FROM embeddings WHERE source_type = 'analysis'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok((total.0, embedded.0))
}

/// Fetch analyses that have no embedding yet, up to `limit` rows.
///
/// Returns `(id, user_id, error_type, root_cause, component)` for each row.
/// `user_id` is required by the embedding backfill so new rows are
/// tenant-scoped (owner_user_id on embeddings).
pub async fn get_unembedded_analyses(
    pool: &PgPool,
    limit: i64,
) -> HadronResult<Vec<(i64, Uuid, Option<String>, Option<String>, Option<String>)>> {
    let rows = sqlx::query_as(
        "SELECT a.id, a.user_id, a.error_type, a.root_cause, a.component
         FROM analyses a
         LEFT JOIN embeddings e
           ON e.source_type = 'analysis' AND e.source_id = a.id
         WHERE a.deleted_at IS NULL AND e.id IS NULL
         LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows)
}

// ============================================================================
// Audit Log
// ============================================================================

pub async fn write_audit_log(
    pool: &PgPool,
    user_id: Uuid,
    action: &str,
    resource_type: &str,
    resource_id: Option<&str>,
    details: &serde_json::Value,
    ip_address: Option<&str>,
) -> HadronResult<()> {
    sqlx::query(
        "INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6::inet)",
    )
    .bind(user_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(details)
    .bind(ip_address)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

pub async fn get_audit_log(
    pool: &PgPool,
    limit: i64,
    offset: i64,
    action_filter: Option<&str>,
) -> HadronResult<Vec<AuditLogEntry>> {
    let rows: Vec<AuditLogRow> = if let Some(action) = action_filter {
        sqlx::query_as(
            "SELECT al.id, al.user_id, u.display_name, al.action, al.resource_type,
                    al.resource_id, al.details, al.ip_address, al.created_at
             FROM audit_log al
             JOIN users u ON al.user_id = u.id
             WHERE al.action LIKE $1
             ORDER BY al.created_at DESC
             LIMIT $2 OFFSET $3",
        )
        .bind(format!("{action}%"))
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?
    } else {
        sqlx::query_as(
            "SELECT al.id, al.user_id, u.display_name, al.action, al.resource_type,
                    al.resource_id, al.details, al.ip_address, al.created_at
             FROM audit_log al
             JOIN users u ON al.user_id = u.id
             ORDER BY al.created_at DESC
             LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?
    };

    Ok(rows.into_iter().map(Into::into).collect())
}

// ============================================================================
// Internal row types for sqlx
// ============================================================================

#[derive(sqlx::FromRow)]
struct AnalysisSummaryRow {
    id: i64,
    filename: String,
    error_type: Option<String>,
    severity: Option<String>,
    component: Option<String>,
    confidence: Option<String>,
    is_favorite: bool,
    analyzed_at: DateTime<Utc>,
}

impl From<AnalysisSummaryRow> for AnalysisSummary {
    fn from(r: AnalysisSummaryRow) -> Self {
        Self {
            id: r.id,
            filename: r.filename,
            error_type: r.error_type,
            severity: r.severity,
            component: r.component,
            confidence: r.confidence,
            is_favorite: r.is_favorite,
            analyzed_at: r.analyzed_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct AnalysisRow {
    id: i64,
    user_id: Uuid,
    filename: String,
    file_size_kb: Option<f64>,
    error_type: Option<String>,
    error_message: Option<String>,
    severity: Option<String>,
    component: Option<String>,
    stack_trace: Option<String>,
    root_cause: Option<String>,
    suggested_fixes: Option<serde_json::Value>,
    confidence: Option<String>,
    ai_model: Option<String>,
    ai_provider: Option<String>,
    tokens_used: Option<i64>,
    cost: Option<f64>,
    analysis_duration_ms: Option<i64>,
    is_favorite: bool,
    view_count: i32,
    error_signature: Option<String>,
    full_data: Option<serde_json::Value>,
    analyzed_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<AnalysisRow> for Analysis {
    fn from(r: AnalysisRow) -> Self {
        Self {
            id: r.id,
            user_id: r.user_id,
            filename: r.filename,
            file_size_kb: r.file_size_kb,
            error_type: r.error_type,
            error_message: r.error_message,
            severity: r.severity,
            component: r.component,
            stack_trace: r.stack_trace,
            root_cause: r.root_cause,
            suggested_fixes: r.suggested_fixes,
            confidence: r.confidence,
            ai_model: r.ai_model,
            ai_provider: r.ai_provider,
            tokens_used: r.tokens_used,
            cost: r.cost,
            analysis_duration_ms: r.analysis_duration_ms,
            is_favorite: r.is_favorite,
            view_count: r.view_count,
            error_signature: r.error_signature,
            full_data: r.full_data,
            analyzed_at: r.analyzed_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct ChatSessionRow {
    id: String,
    user_id: Uuid,
    title: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<ChatSessionRow> for ChatSession {
    fn from(r: ChatSessionRow) -> Self {
        Self {
            id: r.id,
            user_id: r.user_id,
            title: r.title,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct ChatMessageRow {
    role: String,
    content: String,
}

#[derive(sqlx::FromRow)]
struct TeamAnalysisRow {
    id: i64,
    filename: String,
    error_type: Option<String>,
    severity: Option<String>,
    component: Option<String>,
    confidence: Option<String>,
    is_favorite: bool,
    analyzed_at: DateTime<Utc>,
    analyst_name: String,
}

impl From<TeamAnalysisRow> for TeamAnalysisSummary {
    fn from(r: TeamAnalysisRow) -> Self {
        Self {
            id: r.id,
            filename: r.filename,
            error_type: r.error_type,
            severity: r.severity,
            component: r.component,
            confidence: r.confidence,
            is_favorite: r.is_favorite,
            analyzed_at: r.analyzed_at,
            analyst_name: r.analyst_name,
        }
    }
}

#[derive(sqlx::FromRow)]
struct AuditLogRow {
    id: i64,
    user_id: Uuid,
    display_name: String,
    action: String,
    resource_type: String,
    resource_id: Option<String>,
    details: serde_json::Value,
    ip_address: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<AuditLogRow> for AuditLogEntry {
    fn from(r: AuditLogRow) -> Self {
        Self {
            id: r.id,
            user_id: r.user_id,
            user_name: r.display_name,
            action: r.action,
            resource_type: r.resource_type,
            resource_id: r.resource_id,
            details: r.details,
            ip_address: r.ip_address,
            created_at: r.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct UserListRow {
    id: Uuid,
    azure_oid: String,
    email: String,
    display_name: String,
    role: String,
    team_id: Option<Uuid>,
    is_active: bool,
    created_at: DateTime<Utc>,
    last_login_at: Option<DateTime<Utc>>,
}

// ---- Release note row types ----

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNote {
    pub id: i64,
    pub user_id: Uuid,
    pub title: String,
    pub version: Option<String>,
    pub content: String,
    pub format: String,
    pub is_published: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub ai_insights: Option<serde_json::Value>,
    pub status: Option<String>,
    pub checklist_state: Option<serde_json::Value>,
    pub reviewed_by: Option<Uuid>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub published_at: Option<DateTime<Utc>>,
    pub markdown_content: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ReleaseNoteRow {
    id: i64,
    user_id: Uuid,
    title: String,
    version: Option<String>,
    content: String,
    format: String,
    is_published: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    ai_insights: Option<serde_json::Value>,
    status: Option<String>,
    checklist_state: Option<serde_json::Value>,
    reviewed_by: Option<Uuid>,
    reviewed_at: Option<DateTime<Utc>>,
    published_at: Option<DateTime<Utc>>,
    markdown_content: Option<String>,
}

impl From<ReleaseNoteRow> for ReleaseNote {
    fn from(r: ReleaseNoteRow) -> Self {
        Self {
            id: r.id,
            user_id: r.user_id,
            title: r.title,
            version: r.version,
            content: r.content,
            format: r.format,
            is_published: r.is_published,
            created_at: r.created_at,
            updated_at: r.updated_at,
            ai_insights: r.ai_insights,
            status: r.status,
            checklist_state: r.checklist_state,
            reviewed_by: r.reviewed_by,
            reviewed_at: r.reviewed_at,
            published_at: r.published_at,
            markdown_content: r.markdown_content,
        }
    }
}

// ---- Embedding row types ----

/// Similar analysis result from pgvector search.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarAnalysis {
    pub id: i64,
    pub filename: String,
    pub error_type: Option<String>,
    pub severity: Option<String>,
    pub similarity: f64,
}

#[derive(sqlx::FromRow)]
struct SimilarAnalysisRow {
    id: i64,
    filename: String,
    error_type: Option<String>,
    severity: Option<String>,
    similarity: f64,
}

impl From<SimilarAnalysisRow> for SimilarAnalysis {
    fn from(r: SimilarAnalysisRow) -> Self {
        Self {
            id: r.id,
            filename: r.filename,
            error_type: r.error_type,
            severity: r.severity,
            similarity: r.similarity,
        }
    }
}

// ============================================================================
// Tags
// ============================================================================

pub async fn list_tags(pool: &PgPool) -> HadronResult<Vec<Tag>> {
    let rows: Vec<TagRow> = sqlx::query_as(
        "SELECT id, name, color, usage_count, created_at FROM tags ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn create_tag(pool: &PgPool, name: &str, color: Option<&str>) -> HadronResult<Tag> {
    let row: TagRow = sqlx::query_as(
        "INSERT INTO tags (name, color) VALUES ($1, $2)
         RETURNING id, name, color, usage_count, created_at",
    )
    .bind(name)
    .bind(color)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        if e.to_string().contains("unique") || e.to_string().contains("duplicate") {
            HadronError::Conflict(format!("Tag '{name}' already exists"))
        } else {
            HadronError::database(e.to_string())
        }
    })?;

    Ok(row.into())
}

pub async fn update_tag(
    pool: &PgPool,
    id: i32,
    name: Option<&str>,
    color: Option<&str>,
) -> HadronResult<Tag> {
    let row: TagRow = sqlx::query_as(
        "UPDATE tags SET name = COALESCE($2, name), color = COALESCE($3, color)
         WHERE id = $1
         RETURNING id, name, color, usage_count, created_at",
    )
    .bind(id)
    .bind(name)
    .bind(color)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Tag {id} not found")))?;

    Ok(row.into())
}

pub async fn delete_tag(pool: &PgPool, id: i32) -> HadronResult<()> {
    let result = sqlx::query("DELETE FROM tags WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!("Tag {id} not found")));
    }

    Ok(())
}

pub async fn get_analysis_tags(pool: &PgPool, analysis_id: i64) -> HadronResult<Vec<Tag>> {
    let rows: Vec<TagRow> = sqlx::query_as(
        "SELECT t.id, t.name, t.color, t.usage_count, t.created_at
         FROM tags t
         JOIN analysis_tags at ON t.id = at.tag_id
         WHERE at.analysis_id = $1
         ORDER BY t.name",
    )
    .bind(analysis_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn set_analysis_tags(
    pool: &PgPool,
    analysis_id: i64,
    user_id: Uuid,
    tag_ids: &[i32],
) -> HadronResult<Vec<Tag>> {
    // Verify analysis ownership
    let exists: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM analyses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(analysis_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if exists.is_none() {
        return Err(HadronError::not_found(format!(
            "Analysis {analysis_id} not found"
        )));
    }

    // Get old tags for decrementing usage counts
    let old_tags: Vec<(i32,)> = sqlx::query_as(
        "SELECT tag_id FROM analysis_tags WHERE analysis_id = $1",
    )
    .bind(analysis_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    // Remove old tags
    sqlx::query("DELETE FROM analysis_tags WHERE analysis_id = $1")
        .bind(analysis_id)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    // Decrement old usage counts
    for (old_id,) in &old_tags {
        sqlx::query("UPDATE tags SET usage_count = GREATEST(0, usage_count - 1) WHERE id = $1")
            .bind(old_id)
            .execute(pool)
            .await
            .ok();
    }

    // Insert new tags
    for tag_id in tag_ids {
        sqlx::query("INSERT INTO analysis_tags (analysis_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(analysis_id)
            .bind(tag_id)
            .execute(pool)
            .await
            .map_err(|e| HadronError::database(e.to_string()))?;

        sqlx::query("UPDATE tags SET usage_count = usage_count + 1 WHERE id = $1")
            .bind(tag_id)
            .execute(pool)
            .await
            .ok();
    }

    get_analysis_tags(pool, analysis_id).await
}

// ============================================================================
// Notes
// ============================================================================

pub async fn get_analysis_notes(
    pool: &PgPool,
    analysis_id: i64,
) -> HadronResult<Vec<AnalysisNote>> {
    let rows: Vec<NoteRow> = sqlx::query_as(
        "SELECT n.id, n.analysis_id, n.user_id, u.display_name as user_name,
                n.content, n.created_at, n.updated_at
         FROM analysis_notes n
         JOIN users u ON n.user_id = u.id
         WHERE n.analysis_id = $1
         ORDER BY n.created_at DESC",
    )
    .bind(analysis_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn create_note(
    pool: &PgPool,
    analysis_id: i64,
    user_id: Uuid,
    content: &str,
) -> HadronResult<AnalysisNote> {
    // Ownership is enforced by the caller (route handler calls
    // get_analysis_by_id with the requesting user's id first). This
    // function only re-verifies the analysis row exists so we don't
    // FK-violate if the analysis was deleted in between.
    let exists: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM analyses WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(analysis_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if exists.is_none() {
        return Err(HadronError::not_found(format!(
            "Analysis {analysis_id} not found"
        )));
    }

    let row: NoteRow = sqlx::query_as(
        "WITH inserted AS (
            INSERT INTO analysis_notes (analysis_id, user_id, content)
            VALUES ($1, $2, $3)
            RETURNING id, analysis_id, user_id, content, created_at, updated_at
         )
         SELECT i.id, i.analysis_id, i.user_id, u.display_name as user_name,
                i.content, i.created_at, i.updated_at
         FROM inserted i
         JOIN users u ON i.user_id = u.id",
    )
    .bind(analysis_id)
    .bind(user_id)
    .bind(content)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.into())
}

pub async fn update_note(
    pool: &PgPool,
    note_id: i64,
    user_id: Uuid,
    content: &str,
) -> HadronResult<AnalysisNote> {
    let row: NoteRow = sqlx::query_as(
        "WITH updated AS (
            UPDATE analysis_notes SET content = $3
            WHERE id = $1 AND user_id = $2
            RETURNING id, analysis_id, user_id, content, created_at, updated_at
         )
         SELECT u2.id, u2.analysis_id, u2.user_id, us.display_name as user_name,
                u2.content, u2.created_at, u2.updated_at
         FROM updated u2
         JOIN users us ON u2.user_id = us.id",
    )
    .bind(note_id)
    .bind(user_id)
    .bind(content)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Note {note_id} not found or not owned by you")))?;

    Ok(row.into())
}

pub async fn delete_note(pool: &PgPool, note_id: i64, user_id: Uuid) -> HadronResult<()> {
    let result = sqlx::query(
        "DELETE FROM analysis_notes WHERE id = $1 AND user_id = $2",
    )
    .bind(note_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!(
            "Note {note_id} not found or not owned by you"
        )));
    }

    Ok(())
}

// ============================================================================
// Archive & Restore
// ============================================================================

pub async fn restore_analysis(pool: &PgPool, id: i64, user_id: Uuid) -> HadronResult<()> {
    let result = sqlx::query(
        "UPDATE analyses SET deleted_at = NULL WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!(
            "Archived analysis {id} not found"
        )));
    }

    Ok(())
}

pub async fn get_archived_analyses(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<AnalysisSummary>, i64)> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analyses WHERE user_id = $1 AND deleted_at IS NOT NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<AnalysisSummaryRow> = sqlx::query_as(
        "SELECT id, filename, error_type, severity, component, confidence, is_favorite, analyzed_at
         FROM analyses
         WHERE user_id = $1 AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

pub async fn permanent_delete_analysis(pool: &PgPool, id: i64, user_id: Uuid) -> HadronResult<()> {
    let result = sqlx::query("DELETE FROM analyses WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!(
            "Analysis {id} not found"
        )));
    }

    Ok(())
}

// ============================================================================
// Crash Signatures
// ============================================================================

pub async fn upsert_crash_signature(
    pool: &PgPool,
    sig: &CrashSignature,
) -> HadronResult<()> {
    let components_json = serde_json::to_value(&sig.components)
        .map_err(|e| HadronError::internal(e.to_string()))?;

    sqlx::query(
        "INSERT INTO crash_signatures (hash, canonical, components_json, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (hash) DO UPDATE
         SET last_seen_at = now(),
             occurrence_count = crash_signatures.occurrence_count + 1",
    )
    .bind(&sig.hash)
    .bind(&sig.canonical)
    .bind(&components_json)
    .bind(&sig.status)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

pub async fn link_analysis_signature(
    pool: &PgPool,
    analysis_id: i64,
    signature_hash: &str,
) -> HadronResult<()> {
    sqlx::query(
        "INSERT INTO analysis_signatures (analysis_id, signature_hash)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING",
    )
    .bind(analysis_id)
    .bind(signature_hash)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

pub async fn get_crash_signatures(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<CrashSignatureRow>, i64)> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM crash_signatures")
        .fetch_one(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<CrashSignatureRow> = sqlx::query_as(
        "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                occurrence_count, linked_ticket_id, linked_ticket_url, status
         FROM crash_signatures
         ORDER BY last_seen_at DESC
         LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok((rows, total.0))
}

pub async fn get_signature_by_hash(
    pool: &PgPool,
    hash: &str,
) -> HadronResult<CrashSignatureRow> {
    let row: CrashSignatureRow = sqlx::query_as(
        "SELECT hash, canonical, components_json, first_seen_at, last_seen_at,
                occurrence_count, linked_ticket_id, linked_ticket_url, status
         FROM crash_signatures WHERE hash = $1",
    )
    .bind(hash)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Signature {hash} not found")))?;

    Ok(row)
}

pub async fn get_signature_analyses(
    pool: &PgPool,
    hash: &str,
) -> HadronResult<Vec<AnalysisSummary>> {
    let rows: Vec<AnalysisSummaryRow> = sqlx::query_as(
        "SELECT a.id, a.filename, a.error_type, a.severity, a.component,
                a.confidence, a.is_favorite, a.analyzed_at
         FROM analyses a
         JOIN analysis_signatures asig ON a.id = asig.analysis_id
         WHERE asig.signature_hash = $1 AND a.deleted_at IS NULL
         ORDER BY a.analyzed_at DESC",
    )
    .bind(hash)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn update_signature_status(
    pool: &PgPool,
    hash: &str,
    status: &str,
) -> HadronResult<()> {
    let result = sqlx::query(
        "UPDATE crash_signatures SET status = $2, updated_at = now() WHERE hash = $1",
    )
    .bind(hash)
    .bind(status)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!(
            "Signature {hash} not found"
        )));
    }

    Ok(())
}

pub async fn link_signature_ticket(
    pool: &PgPool,
    hash: &str,
    ticket_id: Option<&str>,
    ticket_url: Option<&str>,
) -> HadronResult<()> {
    let result = sqlx::query(
        "UPDATE crash_signatures SET linked_ticket_id = $2, linked_ticket_url = $3, updated_at = now() WHERE hash = $1",
    )
    .bind(hash)
    .bind(ticket_id)
    .bind(ticket_url)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!(
            "Signature {hash} not found"
        )));
    }

    Ok(())
}

// ============================================================================
// Feedback
// ============================================================================

pub async fn submit_feedback(
    pool: &PgPool,
    analysis_id: i64,
    user_id: Uuid,
    req: &SubmitFeedbackRequest,
) -> HadronResult<AnalysisFeedback> {
    let row: FeedbackRow = sqlx::query_as(
        "INSERT INTO analysis_feedback (analysis_id, user_id, feedback_type, field_name, original_value, corrected_value, rating, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (analysis_id, user_id, feedback_type)
             WHERE feedback_type IN ('thumbs_up', 'thumbs_down')
         DO UPDATE SET comment = EXCLUDED.comment, rating = EXCLUDED.rating
         RETURNING id, analysis_id, user_id, feedback_type, field_name, original_value, corrected_value, rating, comment, created_at",
    )
    .bind(analysis_id)
    .bind(user_id)
    .bind(&req.feedback_type)
    .bind(&req.field_name)
    .bind(&req.original_value)
    .bind(&req.corrected_value)
    .bind(req.rating)
    .bind(&req.comment)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.into())
}

pub async fn get_analysis_feedback(
    pool: &PgPool,
    analysis_id: i64,
) -> HadronResult<Vec<AnalysisFeedback>> {
    let rows: Vec<FeedbackRow> = sqlx::query_as(
        "SELECT id, analysis_id, user_id, feedback_type, field_name, original_value, corrected_value, rating, comment, created_at
         FROM analysis_feedback
         WHERE analysis_id = $1
         ORDER BY created_at DESC",
    )
    .bind(analysis_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn get_feedback_summary(
    pool: &PgPool,
    analysis_id: i64,
) -> HadronResult<FeedbackSummary> {
    let thumbs_up: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analysis_feedback WHERE analysis_id = $1 AND feedback_type = 'thumbs_up'",
    )
    .bind(analysis_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let thumbs_down: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analysis_feedback WHERE analysis_id = $1 AND feedback_type = 'thumbs_down'",
    )
    .bind(analysis_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let corrections: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analysis_feedback WHERE analysis_id = $1 AND feedback_type = 'correction'",
    )
    .bind(analysis_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let avg_rating: (Option<f64>,) = sqlx::query_as(
        "SELECT AVG(rating::double precision) FROM analysis_feedback WHERE analysis_id = $1 AND rating IS NOT NULL",
    )
    .bind(analysis_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(FeedbackSummary {
        thumbs_up: thumbs_up.0,
        thumbs_down: thumbs_down.0,
        corrections: corrections.0,
        average_rating: avg_rating.0,
    })
}

pub async fn delete_feedback(pool: &PgPool, feedback_id: i64, user_id: Uuid) -> HadronResult<()> {
    let result = sqlx::query(
        "DELETE FROM analysis_feedback WHERE id = $1 AND user_id = $2",
    )
    .bind(feedback_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(format!(
            "Feedback {feedback_id} not found"
        )));
    }

    Ok(())
}

// ============================================================================
// Gold Standard
// ============================================================================

pub async fn promote_to_gold(
    pool: &PgPool,
    analysis_id: i64,
    promoted_by: Uuid,
    quality_score: Option<i16>,
) -> HadronResult<GoldAnalysis> {
    let row: GoldAnalysisRow = sqlx::query_as(
        "WITH inserted AS (
            INSERT INTO gold_analyses (analysis_id, promoted_by, quality_score)
            VALUES ($1, $2, $3)
            RETURNING id, analysis_id, promoted_by, verified_by, verification_status,
                      verification_notes, quality_score, promoted_at, verified_at
         )
         SELECT i.id, i.analysis_id, i.promoted_by, i.verified_by, i.verification_status,
                i.verification_notes, i.quality_score, i.promoted_at, i.verified_at,
                a.filename, a.error_type, a.severity, u.display_name as promoter_name
         FROM inserted i
         JOIN analyses a ON i.analysis_id = a.id
         JOIN users u ON i.promoted_by = u.id",
    )
    .bind(analysis_id)
    .bind(promoted_by)
    .bind(quality_score)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        if e.to_string().contains("unique") || e.to_string().contains("duplicate") {
            HadronError::Conflict("Analysis is already promoted to gold".to_string())
        } else {
            HadronError::database(e.to_string())
        }
    })?;

    Ok(row.into())
}

pub async fn verify_gold(
    pool: &PgPool,
    gold_id: i64,
    verified_by: Uuid,
    status: &str,
    notes: Option<&str>,
    quality_score: Option<i16>,
) -> HadronResult<GoldAnalysis> {
    let row: GoldAnalysisRow = sqlx::query_as(
        "WITH updated AS (
            UPDATE gold_analyses
            SET verified_by = $2, verification_status = $3, verification_notes = $4,
                quality_score = COALESCE($5, quality_score), verified_at = now()
            WHERE id = $1
            RETURNING id, analysis_id, promoted_by, verified_by, verification_status,
                      verification_notes, quality_score, promoted_at, verified_at
         )
         SELECT u2.id, u2.analysis_id, u2.promoted_by, u2.verified_by, u2.verification_status,
                u2.verification_notes, u2.quality_score, u2.promoted_at, u2.verified_at,
                a.filename, a.error_type, a.severity, us.display_name as promoter_name
         FROM updated u2
         JOIN analyses a ON u2.analysis_id = a.id
         JOIN users us ON u2.promoted_by = us.id",
    )
    .bind(gold_id)
    .bind(verified_by)
    .bind(status)
    .bind(notes)
    .bind(quality_score)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?
    .ok_or_else(|| HadronError::not_found(format!("Gold analysis {gold_id} not found")))?;

    Ok(row.into())
}

pub async fn list_gold_analyses(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<GoldAnalysis>, i64)> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM gold_analyses")
        .fetch_one(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    let rows: Vec<GoldAnalysisRow> = sqlx::query_as(
        "SELECT g.id, g.analysis_id, g.promoted_by, g.verified_by, g.verification_status,
                g.verification_notes, g.quality_score, g.promoted_at, g.verified_at,
                a.filename, a.error_type, a.severity, u.display_name as promoter_name
         FROM gold_analyses g
         JOIN analyses a ON g.analysis_id = a.id
         JOIN users u ON g.promoted_by = u.id
         ORDER BY g.promoted_at DESC
         LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

pub async fn demote_gold(pool: &PgPool, analysis_id: i64) -> HadronResult<()> {
    let result = sqlx::query("DELETE FROM gold_analyses WHERE analysis_id = $1")
        .bind(analysis_id)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(HadronError::not_found(
            "Analysis is not in gold standard".to_string(),
        ));
    }

    Ok(())
}

// ============================================================================
// Advanced Search
// ============================================================================

pub async fn advanced_search_analyses(
    pool: &PgPool,
    user_id: Uuid,
    req: &AdvancedSearchRequest,
) -> HadronResult<(Vec<AnalysisSummary>, i64)> {
    let limit = req.limit.unwrap_or(50).min(200);
    let offset = req.offset.unwrap_or(0).max(0);

    // Build dynamic WHERE clause
    let mut conditions = vec!["a.user_id = $1".to_string(), "a.deleted_at IS NULL".to_string()];
    let mut param_idx = 2u32;

    // We build the query string dynamically but use parameterized values
    // For simplicity with mixed types, use a string-based approach with careful escaping
    let query_parts: Vec<String> = Vec::new();
    let count_parts: Vec<String> = Vec::new();

    // Full-text search
    if let Some(ref q) = req.q {
        if !q.is_empty() {
            conditions.push(format!(
                "a.search_vector @@ plainto_tsquery('english', ${param_idx})"
            ));
            param_idx += 1;
            let _ = q; // will bind later
        }
    }

    // Severity filter
    if let Some(ref severities) = req.severity {
        if !severities.is_empty() {
            let placeholders: Vec<String> = severities
                .iter()
                .map(|_| {
                    let p = format!("${param_idx}");
                    param_idx += 1;
                    p
                })
                .collect();
            conditions.push(format!("a.severity IN ({})", placeholders.join(",")));
        }
    }

    // Component filter
    if let Some(ref components) = req.component {
        if !components.is_empty() {
            let placeholders: Vec<String> = components
                .iter()
                .map(|_| {
                    let p = format!("${param_idx}");
                    param_idx += 1;
                    p
                })
                .collect();
            conditions.push(format!("a.component IN ({})", placeholders.join(",")));
        }
    }

    // Tag filter
    if let Some(ref tags) = req.tags {
        if !tags.is_empty() {
            let placeholders: Vec<String> = tags
                .iter()
                .map(|_| {
                    let p = format!("${param_idx}");
                    param_idx += 1;
                    p
                })
                .collect();
            conditions.push(format!(
                "EXISTS (SELECT 1 FROM analysis_tags at WHERE at.analysis_id = a.id AND at.tag_id IN ({}))",
                placeholders.join(",")
            ));
        }
    }

    // Date filters
    if let Some(ref from) = req.date_from {
        if !from.is_empty() {
            conditions.push(format!("a.analyzed_at >= ${param_idx}::timestamptz"));
            param_idx += 1;
        }
    }
    if let Some(ref to) = req.date_to {
        if !to.is_empty() {
            conditions.push(format!("a.analyzed_at <= ${param_idx}::timestamptz"));
            param_idx += 1;
        }
    }

    // Favorite filter
    if let Some(fav) = req.is_favorite {
        if fav {
            conditions.push("a.is_favorite = true".to_string());
        }
    }

    // Signature filter
    if let Some(has_sig) = req.has_signature {
        if has_sig {
            conditions.push("a.error_signature IS NOT NULL".to_string());
        }
    }

    let where_clause = conditions.join(" AND ");

    // Sort
    let sort_col = match req.sort_by.as_deref() {
        Some("severity") => "a.severity",
        Some("filename") => "a.filename",
        Some("errorType") => "a.error_type",
        _ => "a.analyzed_at",
    };
    let sort_dir = match req.sort_order.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM analyses a WHERE {where_clause}"
    );
    let data_sql = format!(
        "SELECT a.id, a.filename, a.error_type, a.severity, a.component, a.confidence, a.is_favorite, a.analyzed_at
         FROM analyses a
         WHERE {where_clause}
         ORDER BY {sort_col} {sort_dir}
         LIMIT ${param_idx} OFFSET ${}",
        param_idx + 1
    );

    // Build queries with dynamic bindings
    let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
    let mut data_query = sqlx::query_as::<_, AnalysisSummaryRow>(&data_sql);

    // Bind $1 = user_id
    count_query = count_query.bind(user_id);
    data_query = data_query.bind(user_id);

    // Bind search text
    if let Some(ref q) = req.q {
        if !q.is_empty() {
            count_query = count_query.bind(q.as_str());
            data_query = data_query.bind(q.as_str());
        }
    }

    // Bind severities
    if let Some(ref severities) = req.severity {
        for s in severities {
            count_query = count_query.bind(s.as_str());
            data_query = data_query.bind(s.as_str());
        }
    }

    // Bind components
    if let Some(ref components) = req.component {
        for c in components {
            count_query = count_query.bind(c.as_str());
            data_query = data_query.bind(c.as_str());
        }
    }

    // Bind tag IDs
    if let Some(ref tags) = req.tags {
        for t in tags {
            count_query = count_query.bind(*t);
            data_query = data_query.bind(*t);
        }
    }

    // Bind date_from
    if let Some(ref from) = req.date_from {
        if !from.is_empty() {
            count_query = count_query.bind(from.as_str());
            data_query = data_query.bind(from.as_str());
        }
    }

    // Bind date_to
    if let Some(ref to) = req.date_to {
        if !to.is_empty() {
            count_query = count_query.bind(to.as_str());
            data_query = data_query.bind(to.as_str());
        }
    }

    // Bind limit and offset (data query only)
    data_query = data_query.bind(limit).bind(offset);

    let total = count_query
        .fetch_one(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    let rows = data_query
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    let _ = query_parts;
    let _ = count_parts;

    Ok((rows.into_iter().map(Into::into).collect(), total.0))
}

// ============================================================================
// Analytics
// ============================================================================

pub async fn get_analytics_dashboard(
    pool: &PgPool,
    user_id: Option<Uuid>,
    team_id: Option<Uuid>,
    days: i64,
) -> HadronResult<AnalyticsDashboard> {
    // Determine the WHERE clause fragment and the bind value ($1).
    // Priority: user_id > team_id > global (no filter).
    let (user_filter, bind_id) = if let Some(uid) = user_id {
        ("AND user_id = $1", Some(uid))
    } else if let Some(tid) = team_id {
        (
            "AND user_id IN (SELECT id FROM users WHERE team_id = $1)",
            Some(tid),
        )
    } else {
        ("", None)
    };

    // Total analyses
    let total_sql = format!("SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL {user_filter}");
    let mut total_q = sqlx::query_as::<_, (i64,)>(&total_sql);
    if let Some(id) = bind_id {
        total_q = total_q.bind(id);
    }
    let total = total_q.fetch_one(pool).await.map_err(|e| HadronError::database(e.to_string()))?.0;

    // This week
    let week_sql = format!(
        "SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= now() - interval '7 days' {user_filter}"
    );
    let mut week_q = sqlx::query_as::<_, (i64,)>(&week_sql);
    if let Some(id) = bind_id {
        week_q = week_q.bind(id);
    }
    let this_week = week_q.fetch_one(pool).await.map_err(|e| HadronError::database(e.to_string()))?.0;

    // This month
    let month_sql = format!(
        "SELECT COUNT(*) FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= now() - interval '30 days' {user_filter}"
    );
    let mut month_q = sqlx::query_as::<_, (i64,)>(&month_sql);
    if let Some(id) = bind_id {
        month_q = month_q.bind(id);
    }
    let this_month = month_q.fetch_one(pool).await.map_err(|e| HadronError::database(e.to_string()))?.0;

    // Severity distribution
    let sev_sql = format!(
        "SELECT COALESCE(severity, 'UNKNOWN') as label, COUNT(*) as count
         FROM analyses WHERE deleted_at IS NULL {user_filter}
         GROUP BY severity ORDER BY count DESC"
    );
    let mut sev_q = sqlx::query_as::<_, CountByFieldRow>(&sev_sql);
    if let Some(id) = bind_id {
        sev_q = sev_q.bind(id);
    }
    let severity_distribution: Vec<CountByField> = sev_q
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?
        .into_iter()
        .map(Into::into)
        .collect();

    // Component distribution
    let comp_sql = format!(
        "SELECT COALESCE(component, 'Unknown') as label, COUNT(*) as count
         FROM analyses WHERE deleted_at IS NULL {user_filter}
         GROUP BY component ORDER BY count DESC LIMIT 10"
    );
    let mut comp_q = sqlx::query_as::<_, CountByFieldRow>(&comp_sql);
    if let Some(id) = bind_id {
        comp_q = comp_q.bind(id);
    }
    let component_distribution: Vec<CountByField> = comp_q
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?
        .into_iter()
        .map(Into::into)
        .collect();

    // Error type top
    let et_sql = format!(
        "SELECT COALESCE(error_type, 'Unknown') as label, COUNT(*) as count
         FROM analyses WHERE deleted_at IS NULL {user_filter}
         GROUP BY error_type ORDER BY count DESC LIMIT 10"
    );
    let mut et_q = sqlx::query_as::<_, CountByFieldRow>(&et_sql);
    if let Some(id) = bind_id {
        et_q = et_q.bind(id);
    }
    let error_type_top: Vec<CountByField> = et_q
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?
        .into_iter()
        .map(Into::into)
        .collect();

    // Daily trend
    let trend_sql = format!(
        "SELECT to_char(analyzed_at::date, 'YYYY-MM-DD') as label, COUNT(*) as count
         FROM analyses
         WHERE deleted_at IS NULL AND analyzed_at >= now() - interval '{days} days' {user_filter}
         GROUP BY analyzed_at::date
         ORDER BY analyzed_at::date"
    );
    let mut trend_q = sqlx::query_as::<_, CountByFieldRow>(&trend_sql);
    if let Some(id) = bind_id {
        trend_q = trend_q.bind(id);
    }
    let daily_trend: Vec<DailyCount> = trend_q
        .fetch_all(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?
        .into_iter()
        .map(|r| DailyCount {
            date: r.label,
            count: r.count,
        })
        .collect();

    Ok(AnalyticsDashboard {
        total_analyses: total,
        this_week,
        this_month,
        severity_distribution,
        component_distribution,
        error_type_top,
        daily_trend,
    })
}

// ============================================================================
// Bulk Operations
// ============================================================================

pub async fn bulk_archive(pool: &PgPool, ids: &[i64], user_id: Uuid) -> HadronResult<i64> {
    let mut affected = 0i64;
    for id in ids {
        let result = sqlx::query(
            "UPDATE analyses SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;
        affected += result.rows_affected() as i64;
    }
    Ok(affected)
}

pub async fn bulk_restore(pool: &PgPool, ids: &[i64], user_id: Uuid) -> HadronResult<i64> {
    let mut affected = 0i64;
    for id in ids {
        let result = sqlx::query(
            "UPDATE analyses SET deleted_at = NULL WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL",
        )
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;
        affected += result.rows_affected() as i64;
    }
    Ok(affected)
}

pub async fn bulk_set_favorite(
    pool: &PgPool,
    ids: &[i64],
    user_id: Uuid,
    favorite: bool,
) -> HadronResult<i64> {
    let mut affected = 0i64;
    for id in ids {
        let result = sqlx::query(
            "UPDATE analyses SET is_favorite = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(user_id)
        .bind(favorite)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;
        affected += result.rows_affected() as i64;
    }
    Ok(affected)
}

pub async fn bulk_add_tags(
    pool: &PgPool,
    ids: &[i64],
    user_id: Uuid,
    tag_ids: &[i32],
) -> HadronResult<i64> {
    let mut affected = 0i64;
    for analysis_id in ids {
        // Verify ownership
        let exists: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM analyses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(analysis_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

        if exists.is_some() {
            for tag_id in tag_ids {
                let result = sqlx::query(
                    "INSERT INTO analysis_tags (analysis_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                )
                .bind(analysis_id)
                .bind(tag_id)
                .execute(pool)
                .await
                .map_err(|e| HadronError::database(e.to_string()))?;
                if result.rows_affected() > 0 {
                    sqlx::query("UPDATE tags SET usage_count = usage_count + 1 WHERE id = $1")
                        .bind(tag_id)
                        .execute(pool)
                        .await
                        .ok();
                }
            }
            affected += 1;
        }
    }
    Ok(affected)
}

// ============================================================================
// Global Settings (for patterns) — JSON value variant
// ============================================================================

/// Get a global setting as a JSON value (used by pattern rules stored as JSON arrays).
pub async fn get_global_setting_json(pool: &PgPool, key: &str) -> HadronResult<Option<serde_json::Value>> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM global_settings WHERE key = $1",
    )
    .bind(key)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    match row {
        None => Ok(None),
        Some((s,)) if s.is_empty() => Ok(None),
        Some((s,)) => {
            let v: serde_json::Value = serde_json::from_str(&s)
                .map_err(|e| HadronError::database(format!("JSON parse error for key {key}: {e}")))?;
            Ok(Some(v))
        }
    }
}

/// Set a global setting from a JSON value (used by pattern rules stored as JSON arrays).
pub async fn set_global_setting_json(pool: &PgPool, key: &str, value: &serde_json::Value) -> HadronResult<()> {
    let text = serde_json::to_string(value)
        .map_err(|e| HadronError::database(format!("JSON serialize error: {e}")))?;
    sqlx::query(
        "INSERT INTO global_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()",
    )
    .bind(key)
    .bind(text)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

// ============================================================================
// Training Data Export
// ============================================================================

pub async fn get_verified_gold_training_data(
    pool: &PgPool,
) -> HadronResult<Vec<Analysis>> {
    let rows: Vec<AnalysisRow> = sqlx::query_as(
        "SELECT a.id, a.user_id, a.filename, a.file_size_kb, a.error_type, a.error_message,
                a.severity, a.component, a.stack_trace, a.root_cause, a.suggested_fixes,
                a.confidence, a.ai_model, a.ai_provider, a.tokens_used, a.cost,
                a.analysis_duration_ms, a.is_favorite, a.view_count, a.error_signature,
                a.full_data, a.analyzed_at, a.created_at, a.updated_at
         FROM analyses a
         JOIN gold_analyses g ON a.id = g.analysis_id
         WHERE g.verification_status = 'verified' AND a.deleted_at IS NULL
         ORDER BY g.verified_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(Into::into).collect())
}

// ============================================================================
// Additional row types for new features
// ============================================================================

#[derive(sqlx::FromRow)]
struct TagRow {
    id: i32,
    name: String,
    color: Option<String>,
    usage_count: i32,
    created_at: DateTime<Utc>,
}

impl From<TagRow> for Tag {
    fn from(r: TagRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            color: r.color,
            usage_count: r.usage_count,
            created_at: r.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct NoteRow {
    id: i64,
    analysis_id: i64,
    user_id: Uuid,
    user_name: String,
    content: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<NoteRow> for AnalysisNote {
    fn from(r: NoteRow) -> Self {
        Self {
            id: r.id,
            analysis_id: r.analysis_id,
            user_id: r.user_id,
            user_name: r.user_name,
            content: r.content,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct CrashSignatureRow {
    pub hash: String,
    pub canonical: String,
    pub components_json: serde_json::Value,
    pub first_seen_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub occurrence_count: i32,
    pub linked_ticket_id: Option<String>,
    pub linked_ticket_url: Option<String>,
    pub status: String,
}

#[derive(sqlx::FromRow)]
struct FeedbackRow {
    id: i64,
    analysis_id: i64,
    user_id: Uuid,
    feedback_type: String,
    field_name: Option<String>,
    original_value: Option<String>,
    corrected_value: Option<String>,
    rating: Option<i16>,
    comment: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<FeedbackRow> for AnalysisFeedback {
    fn from(r: FeedbackRow) -> Self {
        Self {
            id: r.id,
            analysis_id: r.analysis_id,
            user_id: r.user_id,
            feedback_type: r.feedback_type,
            field_name: r.field_name,
            original_value: r.original_value,
            corrected_value: r.corrected_value,
            rating: r.rating,
            comment: r.comment,
            created_at: r.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct GoldAnalysisRow {
    id: i64,
    analysis_id: i64,
    promoted_by: Uuid,
    verified_by: Option<Uuid>,
    verification_status: String,
    verification_notes: Option<String>,
    quality_score: Option<i16>,
    promoted_at: DateTime<Utc>,
    verified_at: Option<DateTime<Utc>>,
    filename: Option<String>,
    error_type: Option<String>,
    severity: Option<String>,
    promoter_name: Option<String>,
}

impl From<GoldAnalysisRow> for GoldAnalysis {
    fn from(r: GoldAnalysisRow) -> Self {
        Self {
            id: r.id,
            analysis_id: r.analysis_id,
            promoted_by: r.promoted_by,
            verified_by: r.verified_by,
            verification_status: r.verification_status,
            verification_notes: r.verification_notes,
            quality_score: r.quality_score,
            promoted_at: r.promoted_at,
            verified_at: r.verified_at,
            filename: r.filename,
            error_type: r.error_type,
            severity: r.severity,
            promoter_name: r.promoter_name,
        }
    }
}

#[derive(sqlx::FromRow)]
struct CountByFieldRow {
    label: String,
    count: i64,
}

impl From<CountByFieldRow> for CountByField {
    fn from(r: CountByFieldRow) -> Self {
        Self {
            label: r.label,
            count: r.count,
        }
    }
}

impl From<UserListRow> for User {
    fn from(r: UserListRow) -> Self {
        Self {
            id: r.id,
            azure_oid: r.azure_oid,
            email: r.email,
            display_name: r.display_name,
            role: r.role.parse().unwrap_or(Role::Analyst),
            team_id: r.team_id,
            is_active: r.is_active,
            created_at: r.created_at,
            last_login_at: r.last_login_at,
        }
    }
}

// ============================================================================
// Global Settings
// ============================================================================

pub async fn get_global_setting(pool: &PgPool, key: &str) -> HadronResult<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM global_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.map(|(v,)| v))
}

pub async fn set_global_setting(
    pool: &PgPool,
    key: &str,
    value: &str,
    user_id: Uuid,
) -> HadronResult<()> {
    sqlx::query(
        "INSERT INTO global_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3",
    )
    .bind(key)
    .bind(value)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

/// Load server-side AI configuration from global_settings.
/// Returns None if no API key is configured for the active provider.
pub async fn get_server_ai_config(
    pool: &PgPool,
) -> HadronResult<Option<crate::ai::AiConfig>> {
    use crate::ai::{AiConfig, AiProvider};

    let provider_str = get_global_setting(pool, "ai_provider")
        .await?
        .unwrap_or_else(|| "openai".to_string());

    let provider = AiProvider::from_str(&provider_str);

    let (key_setting, model_setting) = match provider {
        AiProvider::OpenAi => ("ai_api_key_openai", "ai_model_openai"),
        AiProvider::Anthropic => ("ai_api_key_anthropic", "ai_model_anthropic"),
    };

    let encrypted_key = get_global_setting(pool, key_setting).await?;
    let model = get_global_setting(pool, model_setting)
        .await?
        .unwrap_or_else(|| match provider {
            AiProvider::OpenAi => "gpt-4o".to_string(),
            AiProvider::Anthropic => "claude-sonnet-4-20250514".to_string(),
        });

    // Decrypt the API key — empty means not configured
    let api_key = match encrypted_key {
        Some(enc) if !enc.is_empty() => crate::crypto::decrypt_value(&enc)?,
        _ => return Ok(None),
    };

    if api_key.is_empty() {
        return Ok(None);
    }

    Ok(Some(AiConfig {
        provider,
        api_key,
        model,
    }))
}

// ============================================================================
// Ticket Briefs
// ============================================================================

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TicketBriefRow {
    pub jira_key: String,
    pub title: String,
    pub severity: Option<String>,
    pub category: Option<String>,
    pub tags: Option<String>,
    pub triage_json: Option<String>,
    pub brief_json: Option<String>,
    pub posted_to_jira: bool,
    pub posted_at: Option<DateTime<Utc>>,
    pub engineer_rating: Option<i16>,
    pub engineer_notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn upsert_ticket_brief(
    pool: &PgPool,
    jira_key: &str,
    title: &str,
    severity: Option<&str>,
    category: Option<&str>,
    tags: Option<&str>,
    triage_json: Option<&str>,
    brief_json: Option<&str>,
) -> HadronResult<()> {
    sqlx::query(
        "INSERT INTO ticket_briefs (jira_key, title, severity, category, tags, triage_json, brief_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (jira_key) DO UPDATE SET
            title = EXCLUDED.title,
            severity = COALESCE(EXCLUDED.severity, ticket_briefs.severity),
            category = COALESCE(EXCLUDED.category, ticket_briefs.category),
            tags = COALESCE(EXCLUDED.tags, ticket_briefs.tags),
            triage_json = COALESCE(EXCLUDED.triage_json, ticket_briefs.triage_json),
            brief_json = COALESCE(EXCLUDED.brief_json, ticket_briefs.brief_json),
            updated_at = NOW()",
    )
    .bind(jira_key)
    .bind(title)
    .bind(severity)
    .bind(category)
    .bind(tags)
    .bind(triage_json)
    .bind(brief_json)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

pub async fn get_ticket_brief(
    pool: &PgPool,
    jira_key: &str,
) -> HadronResult<Option<TicketBriefRow>> {
    let row = sqlx::query_as::<_, TicketBriefRow>(
        "SELECT jira_key, title, severity, category, tags, triage_json, brief_json,
                posted_to_jira, posted_at, engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs WHERE jira_key = $1",
    )
    .bind(jira_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row)
}

pub async fn search_ticket_briefs(
    pool: &PgPool,
    query: &str,
    severity: Option<&str>,
    category: Option<&str>,
    limit: i64,
) -> HadronResult<Vec<TicketBriefRow>> {
    let rows = sqlx::query_as::<_, TicketBriefRow>(
        "SELECT jira_key, title, severity, category, tags, triage_json, brief_json,
                posted_to_jira, posted_at, engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs
         WHERE (title ILIKE '%' || $1 || '%' OR brief_json ILIKE '%' || $1 || '%')
           AND ($2::text IS NULL OR severity = $2)
           AND ($3::text IS NULL OR category = $3)
         ORDER BY updated_at DESC
         LIMIT $4",
    )
    .bind(query)
    .bind(severity)
    .bind(category)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows)
}

pub async fn get_ticket_briefs_batch(
    pool: &PgPool,
    jira_keys: &[String],
) -> HadronResult<Vec<TicketBriefRow>> {
    if jira_keys.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query_as::<_, TicketBriefRow>(
        "SELECT jira_key, title, severity, category, tags, triage_json, brief_json,
                posted_to_jira, posted_at, engineer_rating, engineer_notes, created_at, updated_at
         FROM ticket_briefs WHERE jira_key = ANY($1)",
    )
    .bind(jira_keys)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows)
}

pub async fn delete_ticket_brief(pool: &PgPool, jira_key: &str) -> HadronResult<()> {
    sqlx::query("DELETE FROM ticket_briefs WHERE jira_key = $1")
        .bind(jira_key)
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

// ============================================================================
// Ticket Embeddings (duplicate detection)
// ============================================================================

/// Deterministic hash of a JIRA key to use as source_id in the embeddings table.
///
/// Uses SHA-256 truncated to 8 bytes. Previously used `DefaultHasher`,
/// which the standard library documents as "will almost certainly change"
/// across Rust versions and is not collision-resistant — both properties
/// that matter here, because the same source_id across binaries must
/// resolve to the same ticket, and because an attacker who can create
/// JIRA tickets should not be able to grind keys that collide with a
/// target ticket and overwrite its embedding via the `ON CONFLICT` path.
///
/// The high bit is masked off so the i64 stays non-negative (the column
/// is BIGINT and existing rows used the cast from u64). `max(1)` ensures
/// we never return 0, which historically carried "sentinel" meaning in
/// several callers.
///
/// Fixes F6 from the 2026-04-20 security audit. Existing ticket
/// embeddings that were stored under the old hash will need to be
/// re-embedded; fresh JIRA polls will repopulate them on next visit.
pub fn jira_key_to_source_id(jira_key: &str) -> i64 {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(jira_key.as_bytes());
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&digest[..8]);
    // Clear the sign bit, then avoid zero for safety.
    let as_u64 = u64::from_be_bytes(buf) & 0x7FFF_FFFF_FFFF_FFFF;
    (as_u64 as i64).max(1)
}

/// Build embedding text from brief data (AI-generated fields preferred) or raw ticket data.
pub fn build_ticket_embedding_text(
    title: &str,
    description: &str,
    brief_json: Option<&str>,
) -> String {
    // Try to extract AI-generated fields from brief_json
    if let Some(json_str) = brief_json {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
            let mut parts = Vec::new();

            if let Some(summary) = val.pointer("/analysis/plain_summary").and_then(|v| v.as_str()) {
                if !summary.is_empty() {
                    parts.push(summary.to_string());
                }
            }
            if let Some(root_cause) = val.pointer("/analysis/technical/root_cause").and_then(|v| v.as_str()) {
                if !root_cause.is_empty() {
                    parts.push(root_cause.to_string());
                }
            }
            if let Some(impact) = val.pointer("/triage/customer_impact").and_then(|v| v.as_str()) {
                if !impact.is_empty() {
                    parts.push(impact.to_string());
                }
            }

            if !parts.is_empty() {
                return format!("{}\n\n{}", title, parts.join("\n\n"));
            }
        }
    }

    // Fallback: title + description
    if description.is_empty() {
        title.to_string()
    } else {
        format!("{}\n\n{}", title, description)
    }
}

/// Store a ticket embedding in the existing embeddings table with source_type='ticket'.
///
/// Ticket embeddings are **shared** across all users by product design
/// (ticket briefs are an org-wide knowledge base). `owner_user_id` is
/// therefore always `None` for this source type.
pub async fn store_ticket_embedding(
    pool: &PgPool,
    jira_key: &str,
    embedding: &[f32],
    content: &str,
) -> HadronResult<i64> {
    let source_id = jira_key_to_source_id(jira_key);
    let metadata = serde_json::json!({ "jira_key": jira_key });
    store_embedding(pool, source_id, "ticket", embedding, content, Some(&metadata), None).await
}

/// Result of a similar ticket search.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarTicketMatch {
    pub jira_key: String,
    pub title: String,
    pub similarity: f64,
    pub severity: Option<String>,
    pub category: Option<String>,
}

/// Find tickets similar to the given embedding vector.
pub async fn find_similar_tickets(
    pool: &PgPool,
    embedding: &[f32],
    exclude_key: &str,
    threshold: f64,
    limit: i64,
) -> HadronResult<Vec<SimilarTicketMatch>> {
    let vec_str = format!(
        "[{}]",
        embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    let exclude_source_id = jira_key_to_source_id(exclude_key);

    let rows: Vec<(String, String, f64, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT
            (e.metadata->>'jira_key')::text as jira_key,
            COALESCE(tb.title, '') as title,
            1 - (e.embedding <=> $1::vector) as similarity,
            tb.severity,
            tb.category
         FROM embeddings e
         LEFT JOIN ticket_briefs tb ON (e.metadata->>'jira_key') = tb.jira_key
         WHERE e.source_type = 'ticket'
           AND e.source_id != $4
           AND 1 - (e.embedding <=> $1::vector) > $3
         ORDER BY e.embedding <=> $1::vector
         LIMIT $2",
    )
    .bind(&vec_str)
    .bind(limit)
    .bind(threshold)
    .bind(exclude_source_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|(jira_key, title, similarity, severity, category)| SimilarTicketMatch {
            jira_key,
            title,
            similarity,
            severity,
            category,
        })
        .collect())
}

// ============================================================================
// JIRA Round-Trip (posting + feedback)
// ============================================================================

/// Mark a ticket brief as posted to JIRA.
pub async fn mark_posted_to_jira(pool: &PgPool, jira_key: &str) -> HadronResult<()> {
    sqlx::query(
        "UPDATE ticket_briefs SET posted_to_jira = true, posted_at = NOW(), updated_at = NOW()
         WHERE jira_key = $1",
    )
    .bind(jira_key)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

/// Update engineer feedback on a ticket brief.
pub async fn update_engineer_feedback(
    pool: &PgPool,
    jira_key: &str,
    rating: Option<i16>,
    notes: Option<&str>,
) -> HadronResult<()> {
    sqlx::query(
        "UPDATE ticket_briefs SET
            engineer_rating = COALESCE($2, engineer_rating),
            engineer_notes = COALESCE($3, engineer_notes),
            updated_at = NOW()
         WHERE jira_key = $1",
    )
    .bind(jira_key)
    .bind(rating)
    .bind(notes)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

// ============================================================================
// JIRA Poller Config
// ============================================================================

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PollerConfigRow {
    pub enabled: bool,
    pub jql_filter: String,
    pub interval_mins: i32,
    pub last_polled_at: Option<chrono::DateTime<chrono::Utc>>,
    pub jira_base_url: String,
    pub jira_email: String,
    pub jira_api_token: String,
}

pub async fn get_poller_config(pool: &PgPool) -> HadronResult<PollerConfigRow> {
    let row = sqlx::query_as::<_, PollerConfigRow>(
        "SELECT enabled, jql_filter, interval_mins, last_polled_at,
                jira_base_url, jira_email, jira_api_token
         FROM jira_poller_config WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row)
}

pub async fn update_poller_config(
    pool: &PgPool,
    enabled: Option<bool>,
    jql_filter: Option<&str>,
    interval_mins: Option<i32>,
    jira_base_url: Option<&str>,
    jira_email: Option<&str>,
    jira_api_token: Option<&str>,
    user_id: Uuid,
) -> HadronResult<()> {
    sqlx::query(
        "UPDATE jira_poller_config SET
            enabled = COALESCE($1, enabled),
            jql_filter = COALESCE($2, jql_filter),
            interval_mins = COALESCE($3, interval_mins),
            jira_base_url = COALESCE($4, jira_base_url),
            jira_email = COALESCE($5, jira_email),
            jira_api_token = COALESCE($6, jira_api_token),
            updated_by = $7,
            updated_at = NOW()
         WHERE id = 1",
    )
    .bind(enabled)
    .bind(jql_filter)
    .bind(interval_mins)
    .bind(jira_base_url)
    .bind(jira_email)
    .bind(jira_api_token)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

pub async fn update_poller_last_polled(pool: &PgPool) -> HadronResult<()> {
    sqlx::query("UPDATE jira_poller_config SET last_polled_at = NOW() WHERE id = 1")
        .execute(pool)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;
    Ok(())
}

// ============================================================================
// User Project Subscriptions
// ============================================================================

pub async fn get_user_subscriptions(
    pool: &PgPool,
    user_id: Uuid,
) -> HadronResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT project_key FROM user_project_subscriptions WHERE user_id = $1 ORDER BY project_key",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(rows.into_iter().map(|(k,)| k).collect())
}

pub async fn set_user_subscriptions(
    pool: &PgPool,
    user_id: Uuid,
    project_keys: &[String],
) -> HadronResult<()> {
    // Delete all existing, then insert new
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    sqlx::query("DELETE FROM user_project_subscriptions WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    for key in project_keys {
        sqlx::query(
            "INSERT INTO user_project_subscriptions (user_id, project_key) VALUES ($1, $2)",
        )
        .bind(user_id)
        .bind(key)
        .execute(&mut *tx)
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(())
}

// ============================================================================
// Sentry Configuration & Analysis Persistence
// ============================================================================

/// Load Sentry config from global_settings. Returns None if any required field is missing.
pub async fn get_sentry_config(
    pool: &PgPool,
) -> HadronResult<Option<hadron_core::models::SentryConfig>> {
    let base_url = get_global_setting(pool, "sentry_base_url")
        .await?
        .unwrap_or_default();
    let organization = get_global_setting(pool, "sentry_organization")
        .await?
        .unwrap_or_default();
    let encrypted_token = get_global_setting(pool, "sentry_auth_token")
        .await?
        .unwrap_or_default();

    if base_url.is_empty() || organization.is_empty() || encrypted_token.is_empty() {
        return Ok(None);
    }

    let auth_token = crate::crypto::decrypt_value(&encrypted_token)?;

    Ok(Some(hadron_core::models::SentryConfig {
        base_url,
        auth_token,
        organization,
    }))
}

/// Insert a Sentry analysis record into the analyses table.
pub async fn insert_sentry_analysis(
    pool: &PgPool,
    user_id: Uuid,
    filename: &str,
    error_type: Option<&str>,
    error_message: Option<&str>,
    severity: Option<&str>,
    root_cause: Option<&str>,
    suggested_fixes: Option<&serde_json::Value>,
    confidence: Option<&str>,
    component: Option<&str>,
    full_data: Option<&serde_json::Value>,
) -> HadronResult<i64> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO analyses (
            user_id, filename, analysis_type, error_type, error_message,
            severity, root_cause, suggested_fixes, confidence, component, full_data
         ) VALUES ($1, $2, 'sentry', $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id",
    )
    .bind(user_id)
    .bind(filename)
    .bind(error_type)
    .bind(error_message)
    .bind(severity)
    .bind(root_cause)
    .bind(suggested_fixes)
    .bind(confidence)
    .bind(component)
    .bind(full_data)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.0)
}

// ============================================================================
// JIRA Config Helper
// ============================================================================

/// Load JIRA config from the poller_config table, decrypting the API token.
///
/// Returns a `JiraConfig` with an empty `project_key` (caller should set it).
/// Returns `HadronError::Validation` if JIRA has not been configured.
pub async fn get_jira_config_from_poller(
    pool: &PgPool,
) -> HadronResult<crate::integrations::jira::JiraConfig> {
    let poller = get_poller_config(pool).await?;
    if poller.jira_base_url.is_empty() || poller.jira_email.is_empty() || poller.jira_api_token.is_empty() {
        return Err(HadronError::validation(
            "JIRA is not configured. Set up JIRA in the admin panel.",
        ));
    }
    let api_token = crate::crypto::decrypt_value(&poller.jira_api_token)?;
    Ok(crate::integrations::jira::JiraConfig {
        base_url: poller.jira_base_url,
        email: poller.jira_email,
        api_token,
        project_key: String::new(),
    })
}

// ============================================================================
// AI Release Notes Persistence
// ============================================================================

/// Insert an AI-generated release note into the release_notes table.
///
/// Sets `content`, `markdown_content`, and `original_ai_content` all to
/// `markdown_content` on creation (the editor may diverge later).
#[allow(clippy::too_many_arguments)]
pub async fn insert_ai_release_note(
    pool: &PgPool,
    user_id: Uuid,
    title: &str,
    fix_version: &str,
    content_type: &str,
    markdown_content: &str,
    ticket_keys: &serde_json::Value,
    ticket_count: i32,
    jql_filter: Option<&str>,
    module_filter: Option<&serde_json::Value>,
    ai_model: Option<&str>,
    ai_provider: Option<&str>,
    tokens_used: i64,
    cost: f64,
    generation_duration_ms: i64,
    ai_insights: Option<&serde_json::Value>,
) -> HadronResult<i64> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO release_notes (
            user_id, title, fix_version, content_type,
            content, markdown_content, original_ai_content,
            format, status,
            ticket_keys, ticket_count,
            jql_filter, module_filter,
            ai_model, ai_provider,
            tokens_used, cost, generation_duration_ms,
            ai_insights
         ) VALUES (
            $1, $2, $3, $4,
            $5, $5, $5,
            'markdown', 'draft',
            $6, $7,
            $8, $9,
            $10, $11,
            $12, $13, $14,
            $15
         )
         RETURNING id",
    )
    .bind(user_id)
    .bind(title)
    .bind(fix_version)
    .bind(content_type)
    .bind(markdown_content)
    .bind(ticket_keys)
    .bind(ticket_count)
    .bind(jql_filter)
    .bind(module_filter)
    .bind(ai_model)
    .bind(ai_provider)
    .bind(tokens_used)
    .bind(cost)
    .bind(generation_duration_ms)
    .bind(ai_insights)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    Ok(row.0)
}

/// Paginated list of Sentry analyses for a user.
/// Returns (rows as JSON, total count).
pub async fn get_sentry_analyses(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<serde_json::Value>, i64)> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analyses
         WHERE user_id = $1 AND analysis_type = 'sentry' AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let rows = sqlx::query(
        "SELECT id, filename, error_type, severity, confidence, component, full_data, analyzed_at
         FROM analyses
         WHERE user_id = $1 AND analysis_type = 'sentry' AND deleted_at IS NULL
         ORDER BY analyzed_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let items: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            use sqlx::Row;
            let analyzed_at: chrono::DateTime<chrono::Utc> = row.get("analyzed_at");
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "filename": row.get::<String, _>("filename"),
                "errorType": row.get::<Option<String>, _>("error_type"),
                "severity": row.get::<Option<String>, _>("severity"),
                "confidence": row.get::<Option<String>, _>("confidence"),
                "component": row.get::<Option<String>, _>("component"),
                "analyzedAt": analyzed_at.to_rfc3339(),
            })
        })
        .collect();

    Ok((items, total.0))
}

/// Insert a performance trace analysis record.
pub async fn insert_performance_analysis(
    pool: &PgPool,
    user_id: Uuid,
    filename: &str,
    severity: Option<&str>,
    component: Option<&str>,
    full_data: Option<&serde_json::Value>,
) -> HadronResult<i64> {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO analyses (user_id, filename, analysis_type, severity, component, full_data)
         VALUES ($1, $2, 'performance', $3, $4, $5) RETURNING id",
    )
    .bind(user_id)
    .bind(filename)
    .bind(severity)
    .bind(component)
    .bind(full_data)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;
    Ok(row.0)
}

/// Paginated list of performance analyses for a user.
/// Returns (rows as JSON, total count).
pub async fn get_performance_analyses(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> HadronResult<(Vec<serde_json::Value>, i64)> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM analyses WHERE user_id = $1 AND analysis_type = 'performance' AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let rows = sqlx::query(
        "SELECT id, filename, severity, component, full_data, analyzed_at
         FROM analyses WHERE user_id = $1 AND analysis_type = 'performance' AND deleted_at IS NULL
         ORDER BY analyzed_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| HadronError::database(e.to_string()))?;

    let items: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            use sqlx::Row;
            let analyzed_at: chrono::DateTime<chrono::Utc> = row.get("analyzed_at");
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "filename": row.get::<String, _>("filename"),
                "severity": row.get::<Option<String>, _>("severity"),
                "component": row.get::<Option<String>, _>("component"),
                "analyzedAt": analyzed_at.to_rfc3339(),
            })
        })
        .collect();

    Ok((items, count.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jira_key_to_source_id_is_deterministic() {
        assert_eq!(
            jira_key_to_source_id("PROJ-1234"),
            jira_key_to_source_id("PROJ-1234")
        );
    }

    #[test]
    fn jira_key_to_source_id_is_always_positive_and_nonzero() {
        // A representative sample of keys, long + short, ensures the sign-bit
        // mask and max(1) guard hold for all SHA-256 prefixes we might see.
        for key in [
            "A-1",
            "PROJ-1",
            "PROJ-99999",
            "SEC-2026-04-20",
            "VERY-LONG-PROJECT-NAME-1",
            "",
        ] {
            let id = jira_key_to_source_id(key);
            assert!(id > 0, "expected positive for {key}, got {id}");
        }
    }

    #[test]
    fn jira_key_to_source_id_distinguishes_case_and_content() {
        assert_ne!(
            jira_key_to_source_id("PROJ-1"),
            jira_key_to_source_id("PROJ-2")
        );
        assert_ne!(
            jira_key_to_source_id("PROJ-1"),
            jira_key_to_source_id("proj-1")
        );
    }

    #[test]
    fn jira_key_to_source_id_matches_expected_sha256_prefix() {
        // Freeze the algorithm: SHA-256 of "PROJ-1", first 8 bytes, sign bit
        // cleared. If this ever changes we've broken existing ticket
        // embeddings across deployments, which is a migration event, not
        // a refactor.
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(b"PROJ-1");
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&digest[..8]);
        let expected = (u64::from_be_bytes(buf) & 0x7FFF_FFFF_FFFF_FFFF) as i64;
        let expected = expected.max(1);
        assert_eq!(jira_key_to_source_id("PROJ-1"), expected);
    }
}
