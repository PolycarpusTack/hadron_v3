"""
Hadron API Database Access
SQLite database operations for the REST API
"""

import os
import sqlite3
import json
from contextlib import contextmanager
from typing import Optional, List, Any
from datetime import datetime
from pathlib import Path

import structlog

logger = structlog.get_logger()


# ============================================================================
# Database Connection
# ============================================================================

def get_database_path() -> Path:
    """Get the Hadron database path"""
    # Check environment variable first
    db_path = os.environ.get("HADRON_DATABASE_PATH")
    if db_path:
        return Path(db_path)

    # Default paths by platform
    if os.name == "nt":  # Windows
        base = Path(os.environ.get("APPDATA", "")) / "com.hadron.desktop"
    else:  # Linux/Mac
        base = Path.home() / ".local" / "share" / "com.hadron.desktop"

    return base / "hadron.db"


@contextmanager
def get_connection():
    """Get a database connection with proper settings"""
    db_path = get_database_path()

    if not db_path.exists():
        raise FileNotFoundError(f"Database not found at {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        yield conn
    finally:
        conn.close()


# ============================================================================
# Analysis Operations
# ============================================================================

def get_analysis_by_id(analysis_id: int) -> Optional[dict]:
    """Get a single analysis by ID"""
    with get_connection() as conn:
        cursor = conn.execute(
            """SELECT id, filename, error_type, severity, root_cause, suggested_fixes,
                      component, analysis_source, analysis_model, created_at,
                      is_favorite, crash_content, feedback_status
               FROM analyses
               WHERE id = ? AND archived_at IS NULL""",
            (analysis_id,)
        )
        row = cursor.fetchone()
        if row:
            return dict(row)
    return None


def save_analysis(
    filename: str,
    error_type: str,
    severity: str,
    root_cause: str,
    suggested_fixes: list,
    component: Optional[str] = None,
    crash_content: Optional[str] = None,
    analysis_source: str = "api",
    analysis_model: str = "unknown"
) -> int:
    """Save a new analysis to the database"""
    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO analyses
               (filename, error_type, severity, root_cause, suggested_fixes,
                component, crash_content, analysis_source, analysis_model)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                filename,
                error_type,
                severity,
                root_cause,
                json.dumps(suggested_fixes),
                component,
                crash_content,
                analysis_source,
                analysis_model
            )
        )
        conn.commit()
        return cursor.lastrowid


def search_analyses(
    query: str,
    component: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 10
) -> List[dict]:
    """Search analyses using FTS5"""
    with get_connection() as conn:
        # Build the query
        sql = """
            SELECT a.id, a.filename, a.error_type, a.severity, a.root_cause,
                   a.component, a.created_at
            FROM analyses a
            JOIN analyses_fts fts ON fts.rowid = a.id
            WHERE analyses_fts MATCH ?
            AND a.archived_at IS NULL
        """
        params: list = [query]

        if component:
            sql += " AND a.component = ?"
            params.append(component)

        if severity:
            sql += " AND a.severity = ?"
            params.append(severity)

        sql += " ORDER BY rank LIMIT ?"
        params.append(limit)

        cursor = conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]


# ============================================================================
# Gold Analysis Operations
# ============================================================================

def get_gold_analyses(
    verified_only: bool = True,
    component: Optional[str] = None,
    severity: Optional[str] = None,
    limit: Optional[int] = None
) -> List[dict]:
    """Get gold analyses with optional filters"""
    with get_connection() as conn:
        sql = """
            SELECT g.id, g.source_analysis_id, g.source_type, g.error_signature,
                   g.root_cause, g.suggested_fixes, g.component, g.severity,
                   g.validation_status, g.created_at, g.verified_by,
                   g.times_referenced, g.success_rate
            FROM gold_analyses g
            WHERE 1=1
        """
        params: list = []

        if verified_only:
            sql += " AND g.validation_status = 'verified'"

        if component:
            sql += " AND g.component = ?"
            params.append(component)

        if severity:
            sql += " AND g.severity = ?"
            params.append(severity)

        sql += " ORDER BY g.created_at DESC"

        if limit:
            sql += " LIMIT ?"
            params.append(limit)

        cursor = conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]


def get_gold_statistics() -> dict:
    """Get statistics about gold analyses"""
    with get_connection() as conn:
        stats = {}

        # Total counts
        cursor = conn.execute("SELECT COUNT(*) FROM gold_analyses")
        stats["total"] = cursor.fetchone()[0]

        cursor = conn.execute(
            "SELECT COUNT(*) FROM gold_analyses WHERE validation_status = 'verified'"
        )
        stats["verified"] = cursor.fetchone()[0]

        cursor = conn.execute(
            "SELECT COUNT(*) FROM gold_analyses WHERE validation_status = 'pending'"
        )
        stats["pending"] = cursor.fetchone()[0]

        # By component
        cursor = conn.execute(
            """SELECT component, COUNT(*) as count
               FROM gold_analyses
               WHERE validation_status = 'verified'
               GROUP BY component"""
        )
        stats["by_component"] = {row[0] or "unknown": row[1] for row in cursor.fetchall()}

        # By severity
        cursor = conn.execute(
            """SELECT severity, COUNT(*) as count
               FROM gold_analyses
               WHERE validation_status = 'verified'
               GROUP BY severity"""
        )
        stats["by_severity"] = {row[0] or "unknown": row[1] for row in cursor.fetchall()}

        # Average success rate
        cursor = conn.execute(
            """SELECT AVG(success_rate) FROM gold_analyses
               WHERE validation_status = 'verified' AND success_rate IS NOT NULL"""
        )
        avg_rate = cursor.fetchone()[0]
        stats["avg_success_rate"] = round(avg_rate, 2) if avg_rate else None

        return stats


# ============================================================================
# Feedback Operations
# ============================================================================

def save_feedback(
    analysis_id: int,
    feedback_type: str,
    field_name: Optional[str] = None,
    original_value: Optional[str] = None,
    new_value: Optional[str] = None,
    rating: Optional[int] = None,
    user_id: Optional[str] = None
) -> int:
    """Save feedback for an analysis"""
    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO analysis_feedback
               (analysis_id, feedback_type, field_name, original_value, new_value, rating, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (analysis_id, feedback_type, field_name, original_value, new_value, rating, user_id)
        )
        conn.commit()
        return cursor.lastrowid


def get_feedback_for_analysis(analysis_id: int) -> List[dict]:
    """Get all feedback for an analysis"""
    with get_connection() as conn:
        cursor = conn.execute(
            """SELECT id, feedback_type, field_name, original_value, new_value,
                      rating, feedback_at, user_id
               FROM analysis_feedback
               WHERE analysis_id = ?
               ORDER BY feedback_at DESC""",
            (analysis_id,)
        )
        return [dict(row) for row in cursor.fetchall()]


def check_auto_promotion_eligibility(analysis_id: int) -> dict:
    """Check if analysis is eligible for auto-promotion to gold"""
    with get_connection() as conn:
        # Get the analysis
        cursor = conn.execute(
            "SELECT * FROM analyses WHERE id = ?",
            (analysis_id,)
        )
        analysis = cursor.fetchone()
        if not analysis:
            return {"eligible": False, "reason": "Analysis not found"}

        # Check for high rating
        cursor = conn.execute(
            """SELECT AVG(rating) FROM analysis_feedback
               WHERE analysis_id = ? AND feedback_type = 'rating' AND rating IS NOT NULL""",
            (analysis_id,)
        )
        avg_rating = cursor.fetchone()[0]

        # Check for rejections
        cursor = conn.execute(
            """SELECT COUNT(*) FROM analysis_feedback
               WHERE analysis_id = ? AND feedback_type = 'reject'""",
            (analysis_id,)
        )
        rejections = cursor.fetchone()[0]

        # Check for edits
        cursor = conn.execute(
            """SELECT COUNT(*) FROM analysis_feedback
               WHERE analysis_id = ? AND feedback_type = 'edit'""",
            (analysis_id,)
        )
        edits = cursor.fetchone()[0]

        # Eligibility criteria
        if rejections > 0:
            return {"eligible": False, "reason": "Has rejection feedback"}

        if edits > 0:
            return {"eligible": False, "reason": "Has edit corrections"}

        if avg_rating is None or avg_rating < 4.0:
            return {
                "eligible": False,
                "reason": f"Rating too low ({avg_rating or 'none'}), needs 4.0+"
            }

        return {
            "eligible": True,
            "reason": f"Eligible: rating {round(avg_rating, 1)}, no rejections/edits"
        }


# ============================================================================
# RAG/Chunk Operations
# ============================================================================

def get_retrieval_chunks(
    source_type: Optional[str] = None,
    limit: int = 100
) -> List[dict]:
    """Get retrieval chunks for RAG"""
    with get_connection() as conn:
        sql = """
            SELECT id, source_type, source_id, chunk_index, content,
                   embedding_model, metadata_json, created_at
            FROM retrieval_chunks
            WHERE embedding IS NOT NULL
        """
        params: list = []

        if source_type:
            sql += " AND source_type = ?"
            params.append(source_type)

        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        cursor = conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]


def count_retrieval_chunks() -> int:
    """Count total retrieval chunks"""
    with get_connection() as conn:
        cursor = conn.execute(
            "SELECT COUNT(*) FROM retrieval_chunks WHERE embedding IS NOT NULL"
        )
        return cursor.fetchone()[0]


# ============================================================================
# Statistics
# ============================================================================

def get_database_statistics() -> dict:
    """Get overall database statistics"""
    with get_connection() as conn:
        stats = {}

        # Total analyses
        cursor = conn.execute(
            "SELECT COUNT(*) FROM analyses WHERE archived_at IS NULL"
        )
        stats["total_analyses"] = cursor.fetchone()[0]

        # Gold analyses
        cursor = conn.execute("SELECT COUNT(*) FROM gold_analyses")
        stats["gold_analyses"] = cursor.fetchone()[0]

        # Total feedback
        cursor = conn.execute("SELECT COUNT(*) FROM analysis_feedback")
        stats["total_feedback"] = cursor.fetchone()[0]

        # RAG chunks
        cursor = conn.execute(
            "SELECT COUNT(*) FROM retrieval_chunks WHERE embedding IS NOT NULL"
        )
        stats["rag_chunks"] = cursor.fetchone()[0]

        # Average analysis count by severity
        cursor = conn.execute(
            """SELECT severity, COUNT(*)
               FROM analyses
               WHERE archived_at IS NULL
               GROUP BY severity"""
        )
        stats["by_severity"] = {row[0]: row[1] for row in cursor.fetchall()}

        # Recent activity (last 7 days)
        cursor = conn.execute(
            """SELECT COUNT(*) FROM analyses
               WHERE created_at > datetime('now', '-7 days')"""
        )
        stats["analyses_last_7_days"] = cursor.fetchone()[0]

        return stats
