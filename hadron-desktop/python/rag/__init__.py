"""
Hadron RAG (Retrieval-Augmented Generation) Module

This module provides embedding generation, vector storage, and retrieval
capabilities for the Hadron Intelligence Platform.
"""

from .embeddings import get_embeddings, get_single_embedding
from .chunks import chunk_crash_log, chunk_analysis
from .chroma_store import HadronChromaStore
from .retrieval import HybridRetriever
from .models import (
    RetrievalChunk,
    ChunkMetadata,
    QueryResult,
    RetrievalFilters,
)

__all__ = [
    "get_embeddings",
    "get_single_embedding",
    "chunk_crash_log",
    "chunk_analysis",
    "HadronChromaStore",
    "HybridRetriever",
    "RetrievalChunk",
    "ChunkMetadata",
    "QueryResult",
    "RetrievalFilters",
]

__version__ = "0.1.0"
