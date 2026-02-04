"""
Hadron API Models
Pydantic schemas for request/response validation
"""

from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field


# ============================================================================
# Common Types
# ============================================================================

class Symptom(BaseModel):
    """Detected symptom in crash analysis"""
    type: str = Field(..., description="Symptom type: error_code, behavior, performance, data_issue, integration")
    description: str = Field(..., description="Symptom description")
    entities: Optional[List[str]] = Field(default=None, description="Affected entities")


class SuggestedFix(BaseModel):
    """Suggested fix for a crash"""
    title: str = Field(..., description="Fix title")
    description: str = Field(..., description="Detailed fix description")
    confidence: Optional[float] = Field(default=None, ge=0, le=1, description="Confidence score 0-1")
    steps: Optional[List[str]] = Field(default=None, description="Step-by-step instructions")


class SimilarCase(BaseModel):
    """Similar historical case reference"""
    id: int = Field(..., description="Case ID")
    source_type: str = Field(..., description="Source type: crash, ticket, gold")
    error_type: str = Field(..., description="Error type")
    component: Optional[str] = Field(default=None, description="Component")
    similarity_score: float = Field(..., ge=0, le=1, description="Similarity score 0-1")
    root_cause: str = Field(..., description="Root cause summary")
    suggested_fix: Optional[str] = Field(default=None, description="Primary suggested fix")
    is_gold: bool = Field(default=False, description="Whether this is a verified gold analysis")


# ============================================================================
# Analysis Endpoints
# ============================================================================

class AnalyzeRequest(BaseModel):
    """Request to analyze crash content"""
    content: str = Field(..., min_length=10, description="Crash log content or ticket description")
    content_type: Literal["crash_log", "jira_ticket"] = Field(
        default="crash_log",
        description="Type of content to analyze"
    )
    metadata: Optional[dict] = Field(
        default=None,
        description="Optional metadata: component, customer_id, version, jira_key"
    )
    options: Optional[dict] = Field(
        default=None,
        description="Analysis options: use_rag, max_similar_cases, include_documentation"
    )


class AnalyzeResponse(BaseModel):
    """Analysis result"""
    analysis_id: Optional[int] = Field(default=None, description="Analysis ID if saved")
    classification: dict = Field(..., description="Classification: component, severity, error_type, symptoms")
    root_cause: dict = Field(..., description="Root cause: technical, plain_english")
    suggested_fixes: List[SuggestedFix] = Field(..., description="Suggested fixes")
    similar_cases: List[SimilarCase] = Field(default=[], description="Similar historical cases")
    confidence: float = Field(..., ge=0, le=1, description="Overall confidence score")
    citations: List[str] = Field(default=[], description="References to similar cases used")
    processing_time_ms: int = Field(..., description="Processing time in milliseconds")


# ============================================================================
# Search Endpoints
# ============================================================================

class SearchRequest(BaseModel):
    """Search knowledge base request"""
    query: str = Field(..., min_length=3, description="Search query")
    component: Optional[str] = Field(default=None, description="Filter by component")
    severity: Optional[str] = Field(default=None, description="Filter by severity")
    source_types: Optional[List[str]] = Field(
        default=None,
        description="Filter by source types: crash, ticket, gold, documentation"
    )
    limit: int = Field(default=10, ge=1, le=100, description="Maximum results to return")
    include_embeddings: bool = Field(default=False, description="Include embedding vectors in response")


class SearchResult(BaseModel):
    """Single search result"""
    id: int = Field(..., description="Record ID")
    source_type: str = Field(..., description="Source type")
    score: float = Field(..., ge=0, le=1, description="Relevance score")
    title: str = Field(..., description="Result title/summary")
    content_preview: str = Field(..., description="Content preview (truncated)")
    metadata: dict = Field(default={}, description="Additional metadata")
    created_at: Optional[datetime] = Field(default=None, description="Creation timestamp")


class SearchResponse(BaseModel):
    """Search results"""
    query: str = Field(..., description="Original query")
    total_results: int = Field(..., description="Total matching results")
    results: List[SearchResult] = Field(..., description="Search results")
    search_time_ms: int = Field(..., description="Search time in milliseconds")


# ============================================================================
# Feedback Endpoints
# ============================================================================

class FeedbackRequest(BaseModel):
    """Submit feedback on an analysis"""
    analysis_id: int = Field(..., description="Analysis ID to provide feedback for")
    feedback_type: Literal["accept", "reject", "edit", "rating"] = Field(
        ...,
        description="Type of feedback"
    )
    field_name: Optional[str] = Field(
        default=None,
        description="Field being edited (for edit feedback)"
    )
    original_value: Optional[str] = Field(default=None, description="Original value (for edit)")
    new_value: Optional[str] = Field(default=None, description="New/corrected value (for edit)")
    rating: Optional[int] = Field(default=None, ge=1, le=5, description="Rating 1-5 (for rating feedback)")
    notes: Optional[str] = Field(default=None, description="Additional notes")


class FeedbackResponse(BaseModel):
    """Feedback submission result"""
    feedback_id: int = Field(..., description="Created feedback ID")
    message: str = Field(..., description="Status message")
    auto_promoted: bool = Field(default=False, description="Whether analysis was auto-promoted to gold")


# ============================================================================
# Ingest Endpoints
# ============================================================================

class IngestRequest(BaseModel):
    """Add content to knowledge base"""
    source_type: Literal["crash", "ticket", "documentation", "runbook"] = Field(
        ...,
        description="Type of content to ingest"
    )
    content: str = Field(..., min_length=10, description="Content to ingest")
    title: Optional[str] = Field(default=None, description="Content title")
    metadata: Optional[dict] = Field(default=None, description="Additional metadata")
    generate_embedding: bool = Field(default=True, description="Generate embedding for RAG")


class IngestResponse(BaseModel):
    """Ingest result"""
    id: int = Field(..., description="Created record ID")
    source_type: str = Field(..., description="Source type")
    chunks_created: int = Field(default=0, description="Number of chunks created for RAG")
    message: str = Field(..., description="Status message")


# ============================================================================
# Export Endpoints
# ============================================================================

class ExportRequest(BaseModel):
    """Export training data request"""
    format: Literal["openai_chat", "openai_completion", "alpaca", "jsonl"] = Field(
        default="openai_chat",
        description="Export format"
    )
    include_pending: bool = Field(default=False, description="Include pending (unverified) gold analyses")
    component_filter: Optional[List[str]] = Field(default=None, description="Filter by components")
    severity_filter: Optional[List[str]] = Field(default=None, description="Filter by severities")
    balance_dataset: bool = Field(default=False, description="Balance examples across components")
    max_examples: Optional[int] = Field(default=None, ge=1, description="Maximum examples to export")
    test_split: float = Field(default=0.1, ge=0, le=0.5, description="Fraction for test set")


class DatasetStatistics(BaseModel):
    """Dataset statistics"""
    total_examples: int = Field(..., description="Total examples")
    by_component: dict = Field(..., description="Count by component")
    by_severity: dict = Field(..., description="Count by severity")
    verified_count: int = Field(..., description="Verified examples")
    pending_count: int = Field(..., description="Pending examples")
    avg_rating: Optional[float] = Field(default=None, description="Average rating")


class ExportResponse(BaseModel):
    """Export result"""
    total_exported: int = Field(..., description="Total examples exported")
    train_count: int = Field(..., description="Training set count")
    test_count: int = Field(..., description="Test set count")
    format: str = Field(..., description="Export format used")
    statistics: DatasetStatistics = Field(..., description="Dataset statistics")
    file_path: Optional[str] = Field(default=None, description="Output file path if saved")
    content: Optional[str] = Field(default=None, description="JSONL content if not saved to file")


# ============================================================================
# Health & Status
# ============================================================================

class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(..., description="Service status: healthy, degraded, unhealthy")
    version: str = Field(..., description="API version")
    database_connected: bool = Field(..., description="Database connection status")
    rag_available: bool = Field(..., description="RAG service availability")
    model_available: bool = Field(..., description="AI model availability")
    keeper_available: bool = Field(default=False, description="Keeper Secrets Manager availability")
    uptime_seconds: int = Field(..., description="Service uptime in seconds")


class StatsResponse(BaseModel):
    """Service statistics"""
    total_analyses: int = Field(..., description="Total analyses in database")
    gold_analyses: int = Field(..., description="Gold (verified) analyses")
    total_feedback: int = Field(..., description="Total feedback records")
    rag_chunks: int = Field(..., description="RAG chunks indexed")
    avg_analysis_time_ms: float = Field(..., description="Average analysis time")
    requests_today: int = Field(..., description="API requests today")
