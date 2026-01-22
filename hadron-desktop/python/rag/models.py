"""
Pydantic models for the RAG system.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class ChunkMetadata(BaseModel):
    """Metadata associated with a retrieval chunk."""
    component: Optional[str] = None
    severity: Optional[str] = None
    error_type: Optional[str] = None
    version: Optional[str] = None
    source_type: Optional[str] = None  # "analysis", "gold", "ticket", "documentation"
    source_id: Optional[int] = None
    is_gold: bool = False


class RetrievalChunk(BaseModel):
    """A chunk of content stored in the vector database."""
    id: str
    content: str
    embedding: Optional[List[float]] = None
    metadata: ChunkMetadata = Field(default_factory=ChunkMetadata)
    chunk_type: str = "full"  # "solution", "stack_trace", "full_analysis"


class QueryResult(BaseModel):
    """A single result from a retrieval query."""
    id: str
    content: str
    score: float
    metadata: ChunkMetadata = Field(default_factory=ChunkMetadata)


class RetrievalFilters(BaseModel):
    """Filters for retrieval queries."""
    component: Optional[str] = None
    severity: Optional[str] = None
    source_type: Optional[str] = None
    only_gold: bool = False
    min_score: float = 0.0
    date_after: Optional[str] = None


class SimilarCase(BaseModel):
    """A similar historical case returned by RAG."""
    analysis_id: int
    similarity_score: float
    root_cause: str
    suggested_fixes: List[str]
    is_gold: bool
    citation_id: str
    component: Optional[str] = None
    severity: Optional[str] = None


class RAGContext(BaseModel):
    """Context retrieved by RAG for enhancing analysis."""
    similar_analyses: List[SimilarCase] = Field(default_factory=list)
    gold_matches: List[SimilarCase] = Field(default_factory=list)
    confidence_boost: float = 0.0
    retrieval_time_ms: Optional[int] = None
