"""
Chroma vector store for Hadron RAG.

Adapted from: chatgpt-retrieval-plugin/datastore/providers/chroma_datastore.py
"""

import os
from typing import List, Optional, Dict, Any
import logging

from .models import RetrievalChunk, ChunkMetadata, QueryResult
from .embeddings import get_single_embedding

logger = logging.getLogger(__name__)

# Configuration
CHROMA_PERSISTENCE_DIR = os.environ.get(
    "HADRON_CHROMA_DIR",
    os.path.join(os.path.expanduser("~"), ".hadron", "chroma")
)
CHROMA_COLLECTION_NAME = os.environ.get("HADRON_CHROMA_COLLECTION", "hadron_analyses")


class HadronChromaStore:
    """Vector store using Chroma for similarity search."""

    def __init__(
        self,
        persistence_dir: str = CHROMA_PERSISTENCE_DIR,
        collection_name: str = CHROMA_COLLECTION_NAME,
    ):
        """
        Initialize Chroma store.

        Args:
            persistence_dir: Directory for persistent storage
            collection_name: Name of the Chroma collection
        """
        try:
            import chromadb
            from chromadb.config import Settings
        except ImportError:
            raise ImportError("chromadb not installed. Run: pip install chromadb")

        # Validate persistence directory (prevent path traversal)
        abs_path = os.path.abspath(persistence_dir)
        expected_base = os.path.abspath(os.path.expanduser("~"))
        if not abs_path.startswith(expected_base):
            raise ValueError("Invalid persistence directory: path must be under user home")

        # Ensure directory exists
        os.makedirs(abs_path, exist_ok=True)

        # Initialize Chroma client with persistence (updated API for ChromaDB 1.0+)
        self._client = chromadb.PersistentClient(
            path=abs_path,
            settings=Settings(anonymized_telemetry=False)
        )

        # Get or create collection
        self._collection = self._client.get_or_create_collection(
            name=collection_name,
            embedding_function=None,  # We provide embeddings ourselves
            metadata={"hnsw:space": "cosine"}  # Use cosine similarity
        )

        logger.info(f"Initialized Chroma store: {persistence_dir}, collection: {collection_name}")

    def upsert(self, chunks: List[RetrievalChunk]) -> List[str]:
        """
        Insert or update chunks in the store.

        Args:
            chunks: List of RetrievalChunk objects with embeddings

        Returns:
            List of chunk IDs that were upserted
        """
        if not chunks:
            return []

        ids = [chunk.id for chunk in chunks]
        embeddings = [chunk.embedding for chunk in chunks if chunk.embedding]
        documents = [chunk.content for chunk in chunks]
        metadatas = [chunk.metadata.model_dump() for chunk in chunks]

        if len(embeddings) != len(chunks):
            raise ValueError("All chunks must have embeddings for upsert")

        self._collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas
        )

        logger.info(f"Upserted {len(ids)} chunks")
        return ids

    def query(
        self,
        query_text: str,
        top_k: int = 5,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[QueryResult]:
        """
        Query the store for similar chunks.

        Args:
            query_text: Text to search for
            top_k: Number of results to return
            filters: Optional metadata filters

        Returns:
            List of QueryResult objects sorted by similarity
        """
        # Generate query embedding
        query_embedding = get_single_embedding(query_text)

        # Build where clause from filters
        where_clause = self._build_where_clause(filters) if filters else None

        # Query Chroma
        results = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, self._collection.count()) if self._collection.count() > 0 else top_k,
            where=where_clause,
            include=["documents", "distances", "metadatas"]
        )

        return self._process_results(results)

    def delete(self, ids: List[str]) -> bool:
        """
        Delete chunks by ID.

        Args:
            ids: List of chunk IDs to delete

        Returns:
            True if successful
        """
        if not ids:
            return True

        self._collection.delete(ids=ids)
        logger.info(f"Deleted {len(ids)} chunks")
        return True

    def count(self) -> int:
        """Get total number of chunks in the store."""
        return self._collection.count()

    def _build_where_clause(self, filters: Dict[str, Any]) -> Optional[Dict]:
        """Build Chroma where clause from filters dict."""
        conditions = []

        for key, value in filters.items():
            if value is not None and key not in ("min_score", "date_after"):
                conditions.append({key: value})

        if not conditions:
            return None
        elif len(conditions) == 1:
            return conditions[0]
        else:
            return {"$and": conditions}

    def _process_results(self, results: Dict) -> List[QueryResult]:
        """Process Chroma results into QueryResult objects."""
        output = []

        if not results.get("ids") or not results["ids"][0]:
            return output

        ids = results["ids"][0]
        documents = results["documents"][0]
        distances = results["distances"][0]
        metadatas = results["metadatas"][0]

        for id_, doc, distance, metadata in zip(ids, documents, distances, metadatas):
            # Convert distance to similarity score
            # Chroma returns L2 distance by default, convert to similarity
            similarity = 1.0 / (1.0 + max(0.0, distance))

            output.append(QueryResult(
                id=id_,
                content=doc,
                score=similarity,
                metadata=ChunkMetadata(**metadata) if metadata else ChunkMetadata()
            ))

        return output

    def persist(self):
        """Persist the database to disk."""
        self._client.persist()
        logger.info("Persisted Chroma database")
