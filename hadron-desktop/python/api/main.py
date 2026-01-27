"""
Hadron Intelligence REST API
Phase 4: FastAPI service for crash analysis and knowledge base access

Run with: uvicorn api.main:app --reload
"""

import os
import sys
import time
import json
from datetime import datetime
from typing import Optional, List
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

import structlog

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from api.models import (
    AnalyzeRequest, AnalyzeResponse,
    SearchRequest, SearchResponse, SearchResult,
    FeedbackRequest, FeedbackResponse,
    IngestRequest, IngestResponse,
    ExportRequest, ExportResponse, DatasetStatistics,
    HealthResponse, StatsResponse,
    SuggestedFix, SimilarCase
)
from api.auth import get_api_key, require_permission, APIKeyInfo, generate_api_key, list_api_keys
from api import database as db

# Optional RAG imports
try:
    from rag.embeddings import generate_embedding
    from rag.chroma_store import ChromaStore
    RAG_AVAILABLE = True
except ImportError:
    RAG_AVAILABLE = False

# Optional AI service (for actual analysis)
try:
    import openai
    OPENAI_AVAILABLE = bool(os.environ.get("OPENAI_API_KEY"))
except ImportError:
    OPENAI_AVAILABLE = False

logger = structlog.get_logger()

# ============================================================================
# Application Setup
# ============================================================================

app = FastAPI(
    title="Hadron Intelligence API",
    description="""
REST API for the Hadron crash analysis platform.

## Features

- **Analyze**: Submit crash logs or JIRA tickets for AI-powered analysis
- **Search**: Query the knowledge base for similar historical cases
- **Feedback**: Submit corrections and ratings to improve the system
- **Export**: Export training data for model fine-tuning

## Authentication

All endpoints require an API key. Provide it via:
- `X-API-Key` header (recommended)
- `api_key` query parameter

Contact your administrator to obtain an API key.
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("HADRON_CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Track startup time for uptime calculation
_startup_time = datetime.utcnow()
_request_count = 0


# ============================================================================
# Health & Status Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse, tags=["Status"])
async def health_check():
    """
    Check API health status.

    Returns service health including database connectivity and feature availability.
    """
    # Check database
    try:
        stats = db.get_database_statistics()
        db_connected = True
    except Exception as e:
        logger.error("Database health check failed", error=str(e))
        db_connected = False

    # Calculate uptime
    uptime = int((datetime.utcnow() - _startup_time).total_seconds())

    status = "healthy"
    if not db_connected:
        status = "unhealthy"
    elif not OPENAI_AVAILABLE:
        status = "degraded"

    return HealthResponse(
        status=status,
        version="1.0.0",
        database_connected=db_connected,
        rag_available=RAG_AVAILABLE,
        model_available=OPENAI_AVAILABLE,
        uptime_seconds=uptime
    )


@app.get("/stats", response_model=StatsResponse, tags=["Status"])
async def get_stats(api_key: APIKeyInfo = Depends(get_api_key)):
    """
    Get service statistics.

    Returns aggregate statistics about analyses, feedback, and usage.
    """
    global _request_count
    _request_count += 1

    try:
        stats = db.get_database_statistics()
        gold_stats = db.get_gold_statistics()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    return StatsResponse(
        total_analyses=stats.get("total_analyses", 0),
        gold_analyses=gold_stats.get("verified", 0),
        total_feedback=stats.get("total_feedback", 0),
        rag_chunks=stats.get("rag_chunks", 0),
        avg_analysis_time_ms=0.0,  # TODO: Track this
        requests_today=_request_count
    )


# ============================================================================
# Analysis Endpoints
# ============================================================================

@app.post("/analyze", response_model=AnalyzeResponse, tags=["Analysis"])
async def analyze_content(
    request: AnalyzeRequest,
    background_tasks: BackgroundTasks,
    api_key: APIKeyInfo = Depends(require_permission("analyze"))
):
    """
    Analyze crash log or JIRA ticket content.

    Performs AI-powered analysis with optional RAG enhancement for similar case retrieval.

    - **content**: The crash log or ticket text to analyze
    - **content_type**: Either 'crash_log' or 'jira_ticket'
    - **metadata**: Optional context (component, customer_id, version)
    - **options**: Analysis options (use_rag, max_similar_cases)
    """
    global _request_count
    _request_count += 1
    start_time = time.time()

    # Extract options
    options = request.options or {}
    use_rag = options.get("use_rag", True) and RAG_AVAILABLE
    max_similar = options.get("max_similar_cases", 5)

    # Get similar cases if RAG enabled
    similar_cases: List[SimilarCase] = []
    citations: List[str] = []

    if use_rag:
        try:
            # Search for similar analyses
            similar = db.search_analyses(
                query=request.content[:500],  # Use first 500 chars as query
                component=request.metadata.get("component") if request.metadata else None,
                limit=max_similar
            )
            for i, case in enumerate(similar):
                similar_cases.append(SimilarCase(
                    id=case["id"],
                    source_type="crash",
                    error_type=case.get("error_type", "Unknown"),
                    component=case.get("component"),
                    similarity_score=0.8 - (i * 0.1),  # Placeholder score
                    root_cause=case.get("root_cause", "")[:200],
                    suggested_fix=None,
                    is_gold=False
                ))
                if case.get("root_cause"):
                    citations.append(f"Case #{case['id']}: {case.get('error_type', 'Unknown')}")
        except Exception as e:
            logger.warning("RAG retrieval failed", error=str(e))

    # Perform analysis (mock for now, integrate with actual AI service)
    if OPENAI_AVAILABLE:
        try:
            analysis = await _perform_ai_analysis(request.content, request.content_type, similar_cases)
        except Exception as e:
            logger.error("AI analysis failed", error=str(e))
            analysis = _create_mock_analysis(request.content)
    else:
        analysis = _create_mock_analysis(request.content)

    # Calculate processing time
    processing_time = int((time.time() - start_time) * 1000)

    # Optionally save to database in background
    if options.get("save_to_db", True):
        background_tasks.add_task(
            _save_analysis_background,
            request,
            analysis,
            similar_cases
        )

    return AnalyzeResponse(
        analysis_id=None,  # Set after background save
        classification=analysis["classification"],
        root_cause=analysis["root_cause"],
        suggested_fixes=[SuggestedFix(**f) for f in analysis["suggested_fixes"]],
        similar_cases=similar_cases,
        confidence=analysis["confidence"],
        citations=citations,
        processing_time_ms=processing_time
    )


async def _perform_ai_analysis(
    content: str,
    content_type: str,
    similar_cases: List[SimilarCase]
) -> dict:
    """Perform actual AI analysis using OpenAI"""
    client = openai.OpenAI()

    # Build context from similar cases
    context = ""
    if similar_cases:
        context = "\n\n## Similar Historical Cases:\n"
        for i, case in enumerate(similar_cases, 1):
            context += f"\n### Case {i} ({case.similarity_score:.0%} match)\n"
            context += f"- Error: {case.error_type}\n"
            context += f"- Component: {case.component or 'Unknown'}\n"
            context += f"- Root Cause: {case.root_cause[:200]}\n"

    system_prompt = """You are a WHATS'ON broadcast management system crash analysis expert.
Analyze the provided content and return a JSON response with:
- classification: {component, severity, error_type, symptoms}
- root_cause: {technical, plain_english}
- suggested_fixes: [{title, description, confidence, steps}]
- confidence: overall confidence 0-1

Use insights from similar cases when available. Be specific and actionable."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Analyze this {content_type}:\n\n{content}{context}"}
        ],
        response_format={"type": "json_object"},
        temperature=0.3
    )

    return json.loads(response.choices[0].message.content)


def _create_mock_analysis(content: str) -> dict:
    """Create a mock analysis when AI is unavailable"""
    # Extract error type from content if possible
    error_type = "UnknownError"
    if "MessageNotUnderstood" in content:
        error_type = "MessageNotUnderstood"
    elif "NullPointer" in content or "nil" in content.lower():
        error_type = "NullPointerException"
    elif "Timeout" in content or "timeout" in content.lower():
        error_type = "TimeoutError"

    return {
        "classification": {
            "component": "Unknown",
            "severity": "medium",
            "error_type": error_type,
            "symptoms": []
        },
        "root_cause": {
            "technical": "Unable to perform AI analysis - service unavailable",
            "plain_english": "The analysis service is currently unavailable. Please try again later."
        },
        "suggested_fixes": [
            {
                "title": "Manual Review Required",
                "description": "Please review this crash log manually as automated analysis is unavailable.",
                "confidence": 0.3,
                "steps": ["Review stack trace", "Check recent changes", "Contact support if needed"]
            }
        ],
        "confidence": 0.3
    }


def _save_analysis_background(
    request: AnalyzeRequest,
    analysis: dict,
    similar_cases: List[SimilarCase]
):
    """Save analysis to database in background"""
    try:
        db.save_analysis(
            filename=f"api_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            error_type=analysis["classification"].get("error_type", "Unknown"),
            severity=analysis["classification"].get("severity", "medium"),
            root_cause=analysis["root_cause"].get("technical", ""),
            suggested_fixes=analysis["suggested_fixes"],
            component=analysis["classification"].get("component"),
            crash_content=request.content[:10000],  # Limit stored content
            analysis_source="api",
            analysis_model="gpt-4o-mini" if OPENAI_AVAILABLE else "mock"
        )
        logger.info("Saved analysis to database")
    except Exception as e:
        logger.error("Failed to save analysis", error=str(e))


# ============================================================================
# Search Endpoints
# ============================================================================

@app.get("/search", response_model=SearchResponse, tags=["Search"])
async def search_knowledge_base(
    query: str = Query(..., min_length=3, description="Search query"),
    component: Optional[str] = Query(None, description="Filter by component"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    limit: int = Query(10, ge=1, le=100, description="Maximum results"),
    api_key: APIKeyInfo = Depends(require_permission("read"))
):
    """
    Search the knowledge base for similar cases.

    Performs full-text search with optional filters.
    """
    global _request_count
    _request_count += 1
    start_time = time.time()

    try:
        results = db.search_analyses(
            query=query,
            component=component,
            severity=severity,
            limit=limit
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")

    search_results = []
    for i, r in enumerate(results):
        search_results.append(SearchResult(
            id=r["id"],
            source_type="crash",
            score=1.0 - (i * 0.05),  # Placeholder ranking score
            title=r.get("filename", "Unknown"),
            content_preview=r.get("root_cause", "")[:200],
            metadata={
                "error_type": r.get("error_type"),
                "severity": r.get("severity"),
                "component": r.get("component")
            },
            created_at=r.get("created_at")
        ))

    search_time = int((time.time() - start_time) * 1000)

    return SearchResponse(
        query=query,
        total_results=len(search_results),
        results=search_results,
        search_time_ms=search_time
    )


@app.post("/search", response_model=SearchResponse, tags=["Search"])
async def search_knowledge_base_post(
    request: SearchRequest,
    api_key: APIKeyInfo = Depends(require_permission("read"))
):
    """
    Search the knowledge base (POST version with full options).
    """
    return await search_knowledge_base(
        query=request.query,
        component=request.component,
        severity=request.severity,
        limit=request.limit,
        api_key=api_key
    )


# ============================================================================
# Feedback Endpoints
# ============================================================================

@app.post("/feedback", response_model=FeedbackResponse, tags=["Feedback"])
async def submit_feedback(
    request: FeedbackRequest,
    background_tasks: BackgroundTasks,
    api_key: APIKeyInfo = Depends(require_permission("write"))
):
    """
    Submit feedback on an analysis.

    Feedback types:
    - **accept**: Mark analysis as correct
    - **reject**: Mark analysis as incorrect
    - **edit**: Provide corrected values
    - **rating**: Rate analysis quality (1-5)

    High-quality analyses may be auto-promoted to gold status.
    """
    global _request_count
    _request_count += 1

    # Verify analysis exists
    analysis = db.get_analysis_by_id(request.analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Save feedback
    try:
        feedback_id = db.save_feedback(
            analysis_id=request.analysis_id,
            feedback_type=request.feedback_type,
            field_name=request.field_name,
            original_value=request.original_value,
            new_value=request.new_value,
            rating=request.rating,
            user_id=api_key.name if api_key else None
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {e}")

    # Check for auto-promotion eligibility
    auto_promoted = False
    if request.feedback_type == "rating" and request.rating and request.rating >= 4:
        eligibility = db.check_auto_promotion_eligibility(request.analysis_id)
        if eligibility.get("eligible"):
            # Queue promotion in background
            background_tasks.add_task(_promote_to_gold, request.analysis_id)
            auto_promoted = True

    return FeedbackResponse(
        feedback_id=feedback_id,
        message=f"Feedback recorded successfully",
        auto_promoted=auto_promoted
    )


def _promote_to_gold(analysis_id: int):
    """Promote analysis to gold in background"""
    # This would call the actual promotion logic
    logger.info("Auto-promoting analysis to gold", analysis_id=analysis_id)


# ============================================================================
# Export Endpoints
# ============================================================================

@app.post("/export", response_model=ExportResponse, tags=["Export"])
async def export_training_data(
    request: ExportRequest,
    api_key: APIKeyInfo = Depends(require_permission("read"))
):
    """
    Export gold analyses for fine-tuning.

    Generates JSONL in OpenAI fine-tuning format with options for:
    - Dataset balancing across components/severities
    - Train/test split
    - Format selection
    """
    global _request_count
    _request_count += 1

    # Get gold analyses
    try:
        gold_analyses = db.get_gold_analyses(
            verified_only=not request.include_pending,
            component=request.component_filter[0] if request.component_filter and len(request.component_filter) == 1 else None,
            severity=request.severity_filter[0] if request.severity_filter and len(request.severity_filter) == 1 else None
        )
        stats = db.get_gold_statistics()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    if not gold_analyses:
        raise HTTPException(status_code=404, detail="No gold analyses found matching criteria")

    # Apply filters
    if request.component_filter and len(request.component_filter) > 1:
        gold_analyses = [g for g in gold_analyses if g.get("component") in request.component_filter]

    if request.severity_filter and len(request.severity_filter) > 1:
        gold_analyses = [g for g in gold_analyses if g.get("severity") in request.severity_filter]

    # Balance dataset if requested
    if request.balance_dataset:
        gold_analyses = _balance_dataset(gold_analyses)

    # Limit if specified
    if request.max_examples and len(gold_analyses) > request.max_examples:
        gold_analyses = gold_analyses[:request.max_examples]

    # Split into train/test
    split_idx = int(len(gold_analyses) * (1 - request.test_split))
    train_set = gold_analyses[:split_idx]
    test_set = gold_analyses[split_idx:]

    # Generate JSONL
    if request.format == "openai_chat":
        train_jsonl = _generate_openai_chat_jsonl(train_set)
        test_jsonl = _generate_openai_chat_jsonl(test_set)
    else:
        # Default to openai_chat
        train_jsonl = _generate_openai_chat_jsonl(train_set)
        test_jsonl = _generate_openai_chat_jsonl(test_set)

    # Build statistics
    dataset_stats = DatasetStatistics(
        total_examples=len(gold_analyses),
        by_component=stats.get("by_component", {}),
        by_severity=stats.get("by_severity", {}),
        verified_count=stats.get("verified", 0),
        pending_count=stats.get("pending", 0),
        avg_rating=stats.get("avg_success_rate")
    )

    return ExportResponse(
        total_exported=len(gold_analyses),
        train_count=len(train_set),
        test_count=len(test_set),
        format=request.format,
        statistics=dataset_stats,
        content=train_jsonl  # Return training set content
    )


def _balance_dataset(analyses: List[dict]) -> List[dict]:
    """Balance dataset across components"""
    from collections import defaultdict
    import random

    by_component = defaultdict(list)
    for a in analyses:
        by_component[a.get("component", "unknown")].append(a)

    # Find minimum count
    min_count = min(len(v) for v in by_component.values()) if by_component else 0

    # Sample equally from each component
    balanced = []
    for component, items in by_component.items():
        balanced.extend(random.sample(items, min(len(items), min_count)))

    random.shuffle(balanced)
    return balanced


def _generate_openai_chat_jsonl(analyses: List[dict]) -> str:
    """Generate OpenAI chat fine-tuning JSONL"""
    system_prompt = """You are a WHATS'ON broadcast management system crash analysis expert.
Analyze Smalltalk crash logs and provide structured analysis with root cause and fixes."""

    lines = []
    for a in analyses:
        conversation = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Analyze: {a.get('error_signature', '')}"},
                {"role": "assistant", "content": json.dumps({
                    "root_cause": a.get("root_cause", ""),
                    "suggested_fixes": json.loads(a.get("suggested_fixes", "[]")),
                    "component": a.get("component"),
                    "severity": a.get("severity")
                })}
            ]
        }
        lines.append(json.dumps(conversation))

    return "\n".join(lines)


# ============================================================================
# Admin Endpoints
# ============================================================================

@app.post("/admin/keys", tags=["Admin"])
async def create_api_key_endpoint(
    name: str = Query(..., description="Key name/description"),
    permissions: str = Query("read,analyze", description="Comma-separated permissions"),
    expires_days: Optional[int] = Query(None, description="Days until expiration"),
    api_key: APIKeyInfo = Depends(require_permission("admin"))
):
    """
    Create a new API key (admin only).
    """
    perms = [p.strip() for p in permissions.split(",")]
    key, info = generate_api_key(
        name=name,
        permissions=perms,
        expires_days=expires_days
    )

    return {
        "api_key": key,
        "name": info.name,
        "permissions": info.permissions,
        "expires_at": info.expires_at.isoformat() if info.expires_at else None,
        "message": "Store this key securely - it cannot be retrieved later"
    }


@app.get("/admin/keys", tags=["Admin"])
async def list_api_keys_endpoint(
    api_key: APIKeyInfo = Depends(require_permission("admin"))
):
    """
    List all API keys (admin only).
    """
    return {"keys": list_api_keys()}


# ============================================================================
# OpenAPI Extensions
# ============================================================================

@app.get("/openapi.yaml", response_class=PlainTextResponse, include_in_schema=False)
async def get_openapi_yaml():
    """Get OpenAPI spec in YAML format"""
    import yaml
    return yaml.dump(app.openapi(), default_flow_style=False)


# ============================================================================
# Startup/Shutdown
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info("Hadron API starting up")

    # Verify database connection
    try:
        db_path = db.get_database_path()
        logger.info("Database path", path=str(db_path))
        if db_path.exists():
            stats = db.get_database_statistics()
            logger.info("Database connected", analyses=stats.get("total_analyses", 0))
        else:
            logger.warning("Database not found", path=str(db_path))
    except Exception as e:
        logger.error("Database initialization failed", error=str(e))


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Hadron API shutting down")


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("HADRON_API_PORT", 8000))
    host = os.environ.get("HADRON_API_HOST", "0.0.0.0")

    uvicorn.run(
        "api.main:app",
        host=host,
        port=port,
        reload=os.environ.get("HADRON_ENV", "development") == "development"
    )
