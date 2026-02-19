//! In-memory LRU Embedding Cache
//!
//! Caches embedding vectors to avoid redundant OpenAI API calls for repeated
//! or similar queries within the same session. Uses `parking_lot::RwLock`
//! for concurrent read access, with a 5-minute TTL and max 500 entries.

use parking_lot::RwLock;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const MAX_ENTRIES: usize = 500;
const TTL: Duration = Duration::from_secs(300); // 5 minutes

/// A single cached embedding with its creation timestamp.
struct CacheEntry {
    embedding: Vec<f64>,
    created_at: Instant,
}

/// Thread-safe in-memory embedding cache.
pub struct EmbeddingCache {
    entries: RwLock<HashMap<String, CacheEntry>>,
}

impl EmbeddingCache {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// Look up a cached embedding by text key. Returns `None` if missing or expired.
    pub fn get(&self, text: &str) -> Option<Vec<f64>> {
        let entries = self.entries.read();
        if let Some(entry) = entries.get(text) {
            if entry.created_at.elapsed() < TTL {
                return Some(entry.embedding.clone());
            }
        }
        None
    }

    /// Store an embedding in the cache. Evicts expired entries if at capacity.
    pub fn put(&self, text: String, embedding: Vec<f64>) {
        let mut entries = self.entries.write();

        // Evict expired entries if at capacity
        if entries.len() >= MAX_ENTRIES {
            let now = Instant::now();
            entries.retain(|_, v| now.duration_since(v.created_at) < TTL);
        }

        // If still at capacity after eviction, remove oldest entry
        if entries.len() >= MAX_ENTRIES {
            if let Some(oldest_key) = entries
                .iter()
                .min_by_key(|(_, v)| v.created_at)
                .map(|(k, _)| k.clone())
            {
                entries.remove(&oldest_key);
            }
        }

        entries.insert(
            text,
            CacheEntry {
                embedding,
                created_at: Instant::now(),
            },
        );
    }

    /// Number of entries currently in the cache.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.read().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_put_and_get() {
        let cache = EmbeddingCache::new();
        let emb = vec![1.0, 2.0, 3.0];
        cache.put("hello".to_string(), emb.clone());
        assert_eq!(cache.get("hello"), Some(emb));
        assert_eq!(cache.get("missing"), None);
    }

    #[test]
    fn test_cache_eviction_at_capacity() {
        let cache = EmbeddingCache::new();
        for i in 0..MAX_ENTRIES {
            cache.put(format!("key-{}", i), vec![i as f64]);
        }
        assert_eq!(cache.len(), MAX_ENTRIES);

        // Adding one more should evict the oldest
        cache.put("overflow".to_string(), vec![999.0]);
        assert_eq!(cache.len(), MAX_ENTRIES);
        assert_eq!(cache.get("overflow"), Some(vec![999.0]));
    }
}
