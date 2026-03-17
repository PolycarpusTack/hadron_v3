//! Ticket embedding storage and cosine-similarity search.
//!
//! Sprint 4: stores OpenAI embeddings as little-endian f64 BLOBs in SQLite,
//! provides brute-force cosine similarity ranking over all stored embeddings.

use rusqlite::{params, Connection, Result};
use serde::Serialize;

/// Expected embedding dimension (OpenAI text-embedding-3-small).
#[allow(dead_code)]
pub const EMBEDDING_DIM: usize = 1536;

// ---- Serialization: Vec<f64> <-> BLOB (little-endian f64 bytes) ----------------

pub fn embedding_to_blob(embedding: &[f64]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

pub fn blob_to_embedding(blob: &[u8]) -> Vec<f64> {
    // chunks_exact(8) guarantees each chunk is exactly 8 bytes,
    // so try_into().unwrap() is safe — it can never fail.
    blob.chunks_exact(8)
        .map(|chunk| {
            let arr: [u8; 8] = chunk.try_into().expect("chunks_exact(8) guarantees 8 bytes");
            f64::from_le_bytes(arr)
        })
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
/// Wrapped in a transaction so DELETE+INSERT is atomic.
pub fn upsert_embedding(
    conn: &Connection,
    jira_key: &str,
    embedding: &[f64],
    source_text: &str,
) -> Result<()> {
    let blob = embedding_to_blob(embedding);
    conn.execute_batch("BEGIN IMMEDIATE")?;

    let result = (|| {
        conn.execute(
            "DELETE FROM ticket_embeddings WHERE jira_key = ?1",
            params![jira_key],
        )?;
        conn.execute(
            "INSERT INTO ticket_embeddings (jira_key, embedding, source_text) VALUES (?1, ?2, ?3)",
            params![jira_key, blob, source_text],
        )?;
        Ok(())
    })();

    match result {
        Ok(()) => match conn.execute_batch("COMMIT") {
            Ok(()) => Ok(()),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        },
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
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
#[cfg(test)]
mod tests {
    use super::*;

    /// Roundtrip: embedding → blob → embedding preserves values exactly.
    #[test]
    fn test_embedding_roundtrip() {
        let original = vec![1.0, -2.5, 3.14159, 0.0, f64::MIN, f64::MAX];
        let blob = embedding_to_blob(&original);
        assert_eq!(blob.len(), original.len() * 8);
        let restored = blob_to_embedding(&blob);
        assert_eq!(original, restored);
    }

    /// Empty embedding roundtrips to empty.
    #[test]
    fn test_empty_embedding_roundtrip() {
        let blob = embedding_to_blob(&[]);
        assert!(blob.is_empty());
        let restored = blob_to_embedding(&blob);
        assert!(restored.is_empty());
    }

    /// blob_to_embedding silently drops trailing bytes that don't form a full f64.
    #[test]
    fn test_blob_to_embedding_partial_bytes() {
        let blob = vec![0u8; 11]; // 8 + 3 trailing bytes
        let result = blob_to_embedding(&blob);
        assert_eq!(result.len(), 1); // only 1 complete f64
    }

    /// Cosine similarity of identical vectors is 1.0.
    #[test]
    fn test_cosine_similarity_identical() {
        let v = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&v, &v);
        assert!((sim - 1.0).abs() < 1e-10);
    }

    /// Cosine similarity of orthogonal vectors is 0.0.
    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!((cosine_similarity(&a, &b)).abs() < 1e-10);
    }

    /// Cosine similarity of opposite vectors is -1.0.
    #[test]
    fn test_cosine_similarity_opposite() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![-1.0, -2.0, -3.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim + 1.0).abs() < 1e-10);
    }

    /// Zero vector returns 0.0, not NaN.
    #[test]
    fn test_cosine_similarity_zero_vector() {
        let a = vec![1.0, 2.0];
        let zero = vec![0.0, 0.0];
        assert_eq!(cosine_similarity(&a, &zero), 0.0);
        assert_eq!(cosine_similarity(&zero, &a), 0.0);
        assert_eq!(cosine_similarity(&zero, &zero), 0.0);
    }

    /// Mismatched lengths: zip truncates to shorter, should not panic.
    #[test]
    fn test_cosine_similarity_mismatched_lengths() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![1.0, 2.0];
        // Should not panic — zip stops at shorter
        let _ = cosine_similarity(&a, &b);
    }

    /// NaN in embedding doesn't cause panic (returns NaN similarity).
    #[test]
    fn test_cosine_similarity_with_nan() {
        let a = vec![1.0, f64::NAN, 3.0];
        let b = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.is_nan());
    }
}

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
        if embedding.len() != query_embedding.len() {
            log::warn!(
                "Skipping embedding for {}: dimension mismatch (got {}, expected {})",
                jira_key, embedding.len(), query_embedding.len()
            );
            continue;
        }
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
