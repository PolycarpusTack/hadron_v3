//! Ticket embedding storage and cosine-similarity search.
//!
//! Sprint 4: stores OpenAI embeddings as little-endian f64 BLOBs in SQLite,
//! provides brute-force cosine similarity ranking over all stored embeddings.

use rusqlite::{params, Connection, Result};
use serde::Serialize;

// ---- Serialization: Vec<f64> <-> BLOB (little-endian f64 bytes) ----------------

pub fn embedding_to_blob(embedding: &[f64]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

pub fn blob_to_embedding(blob: &[u8]) -> Vec<f64> {
    blob.chunks_exact(8)
        .map(|chunk| f64::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
}

// ---- Cosine similarity ----------------------------------------------------------

pub fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        0.0
    } else {
        dot / (mag_a * mag_b)
    }
}

// ---- CRUD -----------------------------------------------------------------------

/// Upsert an embedding for a ticket (one embedding per jira_key).
/// Deletes any existing row first, then inserts.
pub fn upsert_embedding(
    conn: &Connection,
    jira_key: &str,
    embedding: &[f64],
    source_text: &str,
) -> Result<()> {
    conn.execute(
        "DELETE FROM ticket_embeddings WHERE jira_key = ?1",
        params![jira_key],
    )?;

    let blob = embedding_to_blob(embedding);
    conn.execute(
        "INSERT INTO ticket_embeddings (jira_key, embedding, source_text) VALUES (?1, ?2, ?3)",
        params![jira_key, blob, source_text],
    )?;

    Ok(())
}

/// Check whether an embedding exists for a given ticket.
pub fn has_embedding(conn: &Connection, jira_key: &str) -> Result<bool> {
    conn.query_row(
        "SELECT COUNT(*) FROM ticket_embeddings WHERE jira_key = ?1",
        params![jira_key],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
}

/// Retrieve the embedding vector for a ticket.
pub fn get_embedding_for_ticket(
    conn: &Connection,
    jira_key: &str,
) -> Result<Option<Vec<f64>>> {
    let mut stmt = conn.prepare(
        "SELECT embedding FROM ticket_embeddings WHERE jira_key = ?1",
    )?;

    let mut rows = stmt.query_map(params![jira_key], |row| {
        let blob: Vec<u8> = row.get(0)?;
        Ok(blob_to_embedding(&blob))
    })?;

    match rows.next() {
        Some(Ok(emb)) => Ok(Some(emb)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

// ---- Similarity search -----------------------------------------------------------

/// Result of a similarity search.
#[derive(Debug, Clone, Serialize)]
pub struct SimilarTicketMatch {
    pub jira_key: String,
    pub title: String,
    pub similarity: f64,
    pub severity: Option<String>,
    pub category: Option<String>,
}

/// Find tickets similar to the given embedding vector.
/// Returns up to `limit` results above `threshold`, excluding `exclude_key`.
pub fn find_similar(
    conn: &Connection,
    query_embedding: &[f64],
    exclude_key: &str,
    threshold: f64,
    limit: usize,
) -> Result<Vec<SimilarTicketMatch>> {
    let mut stmt = conn.prepare(
        "SELECT e.jira_key, e.embedding, b.title, b.severity, b.category
         FROM ticket_embeddings e
         JOIN ticket_briefs b ON b.jira_key = e.jira_key
         WHERE e.jira_key != ?1",
    )?;

    let rows = stmt.query_map(params![exclude_key], |row| {
        let jira_key: String = row.get(0)?;
        let blob: Vec<u8> = row.get(1)?;
        let title: String = row.get(2)?;
        let severity: Option<String> = row.get(3)?;
        let category: Option<String> = row.get(4)?;
        Ok((jira_key, blob, title, severity, category))
    })?;

    let mut matches: Vec<SimilarTicketMatch> = Vec::new();

    for row in rows {
        let (jira_key, blob, title, severity, category) = row?;
        let embedding = blob_to_embedding(&blob);
        let sim = cosine_similarity(query_embedding, &embedding);
        if sim >= threshold {
            matches.push(SimilarTicketMatch {
                jira_key,
                title,
                similarity: sim,
                severity,
                category,
            });
        }
    }

    matches.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    matches.truncate(limit);

    Ok(matches)
}
