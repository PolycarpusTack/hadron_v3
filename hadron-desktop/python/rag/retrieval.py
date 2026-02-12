"""
Hybrid retrieval combining vector similarity and BM25.
"""

import os
import sqlite3
from typing import List, Optional, Dict, Any
import logging

from .models import QueryResult, RetrievalFilters, SimilarCase, RAGContext, ChunkMetadata
from .chroma_store import HadronChromaStore

logger = logging.getLogger(__name__)


class HybridRetriever:
    """
    Hybrid retriever combining Chroma vector search with SQLite FTS.

    Score = α × BM25_score + (1-α) × cosine_similarity
    """

    def __init__(
        self,
        chroma_store: HadronChromaStore,
        sqlite_path: Optional[str] = None,
        alpha: float = 0.3,  # Weight for BM25 (0.3 = favor vector)
    ):
        """
        Initialize hybrid retriever.

        Args:
            chroma_store: Chroma vector store instance
            sqlite_path: Path to SQLite database with FTS tables
            alpha: Weight for BM25 scores (0-1)
        """
        self.vector_store = chroma_store
        self.sqlite_path = sqlite_path or self._get_default_sqlite_path()
        self.alpha = alpha

    def _get_default_sqlite_path(self) -> str:
        """Get default Hadron SQLite database path."""
        if os.name == "nt":  # Windows
            base = os.environ.get("APPDATA", os.path.expanduser("~"))
        else:  # Unix
            base = os.environ.get("XDG_DATA_HOME", os.path.join(os.path.expanduser("~"), ".local", "share"))

        return os.path.join(base, "hadron", "analyses.db")

    def retrieve(
        self,
        query: str,
        filters: Optional[RetrievalFilters] = None,
        top_k: int = 5,
    ) -> List[QueryResult]:
        """
        Retrieve similar content using hybrid search.

        Args:
            query: Search query
            filters: Optional filters
            top_k: Number of results to return

        Returns:
            List of QueryResult objects sorted by combined score
        """
        filters = filters or RetrievalFilters()

        # Get vector results
        vector_filter = self._filters_to_dict(filters)
        vector_results = self.vector_store.query(query, top_k * 3, vector_filter)

        # Get BM25 results from SQLite FTS5
        bm25_results = self._bm25_search(query, filters, top_k * 3)

        # Merge and rerank
        merged = self._merge_results(bm25_results, vector_results)

        # Filter by minimum score
        if filters.min_score > 0:
            merged = [r for r in merged if r.score >= filters.min_score]

        # Return top_k
        return sorted(merged, key=lambda x: x.score, reverse=True)[:top_k]

    def build_rag_context(
        self,
        query: str,
        filters: Optional[RetrievalFilters] = None,
        top_k: int = 5,
    ) -> RAGContext:
        """
        Build RAG context for analysis enhancement.

        Args:
            query: Search query (typically crash log excerpt)
            filters: Optional filters
            top_k: Number of similar cases to retrieve

        Returns:
            RAGContext with similar analyses and gold matches
        """
        import time
        start = time.time()

        results = self.retrieve(query, filters, top_k)

        similar_analyses = []
        gold_matches = []

        for i, result in enumerate(results):
            case = SimilarCase(
                analysis_id=result.metadata.source_id or 0,
                similarity_score=result.score,
                root_cause=result.content[:500],  # Truncate for context
                suggested_fixes=[],  # Would need to fetch from DB
                is_gold=result.metadata.is_gold,
                citation_id=f"Case #{i + 1}",
                component=result.metadata.component,
                severity=result.metadata.severity,
            )

            if result.metadata.is_gold:
                gold_matches.append(case)
            similar_analyses.append(case)

        # Calculate confidence boost based on gold matches
        confidence_boost = min(len(gold_matches) * 0.1, 0.3)

        elapsed_ms = int((time.time() - start) * 1000)

        return RAGContext(
            similar_analyses=similar_analyses,
            gold_matches=gold_matches,
            confidence_boost=confidence_boost,
            retrieval_time_ms=elapsed_ms,
        )

    def _bm25_search(
        self,
        query: str,
        filters: RetrievalFilters,
        limit: int,
    ) -> List[QueryResult]:
        """Search using SQLite FTS5."""
        results = []

        if not os.path.exists(self.sqlite_path):
            logger.warning(f"SQLite database not found: {self.sqlite_path}")
            return results

        try:
            conn = sqlite3.connect(self.sqlite_path)
            cursor = conn.cursor()

            # Use FTS5 if available, fall back to LIKE
            try:
                # Try FTS5 search on analyses_fts
                # Strip FTS5 special characters (AND, OR, NOT, NEAR, *, ^, ")
                # Keep only word characters and spaces for safe matching
                import re as _re
                fts_query = _re.sub(r'[^\w\s]', ' ', query).strip()
                if not fts_query:
                    fts_query = '""'  # Empty query safety
                cursor.execute("""
                    SELECT a.id, a.root_cause, a.error_type, a.component, a.severity,
                           bm25(analyses_fts) as score
                    FROM analyses_fts
                    JOIN analyses a ON analyses_fts.rowid = a.id
                    WHERE analyses_fts MATCH ?
                    AND a.deleted_at IS NULL
                    ORDER BY score
                    LIMIT ?
                """, (fts_query, limit))

            except sqlite3.OperationalError:
                # Fall back to LIKE search
                like_query = f"%{query}%"
                cursor.execute("""
                    SELECT id, root_cause, error_type, component, severity, 0.5 as score
                    FROM analyses
                    WHERE (root_cause LIKE ? OR error_type LIKE ? OR error_message LIKE ?)
                    AND deleted_at IS NULL
                    LIMIT ?
                """, (like_query, like_query, like_query, limit))

            for row in cursor.fetchall():
                results.append(QueryResult(
                    id=str(row[0]),
                    content=row[1] or "",
                    score=abs(row[5]) if row[5] else 0.5,  # BM25 returns negative scores
                    metadata=ChunkMetadata(
                        source_id=row[0],
                        error_type=row[2],
                        component=row[3],
                        severity=row[4],
                        source_type="analysis"
                    )
                ))

            conn.close()

        except Exception as e:
            logger.error(f"BM25 search failed: {e}")

        return results

    def _merge_results(
        self,
        bm25_results: List[QueryResult],
        vector_results: List[QueryResult],
    ) -> List[QueryResult]:
        """Merge BM25 and vector results with weighted scoring."""
        merged: Dict[str, QueryResult] = {}

        # Normalize scores
        bm25_max = max((r.score for r in bm25_results), default=1)
        vector_max = max((r.score for r in vector_results), default=1)

        # Add BM25 results (normalized)
        for r in bm25_results:
            norm_score = r.score / bm25_max if bm25_max > 0 else 0
            merged[r.id] = QueryResult(
                id=r.id,
                content=r.content,
                score=self.alpha * norm_score,
                metadata=r.metadata
            )

        # Add/update with vector results (normalized)
        for r in vector_results:
            norm_score = r.score / vector_max if vector_max > 0 else 0
            if r.id in merged:
                merged[r.id].score += (1 - self.alpha) * norm_score
            else:
                merged[r.id] = QueryResult(
                    id=r.id,
                    content=r.content,
                    score=(1 - self.alpha) * norm_score,
                    metadata=r.metadata
                )

        return list(merged.values())

    def _filters_to_dict(self, filters: RetrievalFilters) -> Dict[str, Any]:
        """Convert RetrievalFilters to dict for Chroma."""
        result = {}

        if filters.component:
            result["component"] = filters.component
        if filters.severity:
            result["severity"] = filters.severity
        if filters.source_type:
            result["source_type"] = filters.source_type
        if filters.only_gold:
            result["is_gold"] = True

        return result
