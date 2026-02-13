"""
Offline Analysis Service
Phase 5: Local AI analysis using llama.cpp and local RAG

This provides the same interface as the cloud-based analysis but runs entirely locally.
"""

import json
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

import httpx

from .config import OfflineConfig, OfflineMode

# Import local embeddings
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from rag.local_embeddings import LocalEmbeddings, is_available as embeddings_available

logger = logging.getLogger(__name__)


@dataclass
class OfflineAnalysisResult:
    """Result from offline analysis"""
    error_type: str
    severity: str
    root_cause: str
    suggested_fixes: List[str]
    component: Optional[str] = None
    confidence: float = 0.0
    similar_cases: List[Dict] = None
    model_used: str = ""
    processing_time_ms: int = 0


class OfflineAnalysisService:
    """
    Local analysis service using llama.cpp (llama-server).
    Provides the same interface as cloud-based analysis.
    Uses OpenAI-compatible API at localhost:8080.
    """

    def __init__(self, config: Optional[OfflineConfig] = None):
        self.config = config or OfflineConfig.from_env()
        self._client = httpx.Client(timeout=self.config.llamacpp.timeout)
        self._embeddings = LocalEmbeddings(
            ollama_model=self.config.llamacpp.embedding_model,
        )
        self._available = None

    def is_available(self) -> bool:
        """Check if offline analysis is available"""
        if self._available is not None:
            return self._available

        try:
            # Check llama-server via OpenAI-compatible endpoint
            response = self._client.get(f"{self.config.llamacpp.host}/v1/models")
            if response.status_code != 200:
                self._available = False
                return False

            # Check that at least one model is loaded
            data = response.json()
            models = data.get("data", [])

            if not models:
                logger.warning("No models loaded in llama-server")
                self._available = False
                return False

            # Use first available model if configured model not found
            model_ids = [m.get("id", "") for m in models]
            if self.config.llamacpp.model not in model_ids and model_ids:
                self.config.llamacpp.model = model_ids[0]
                logger.info(f"Using available model: {self.config.llamacpp.model}")

            self._available = True
            return True

        except Exception as e:
            logger.error(f"Offline service check failed: {e}")
            self._available = False
            return False

    def analyze(
        self,
        content: str,
        content_type: str = "crash_log",
        rag_context: Optional[List[Dict]] = None,
    ) -> OfflineAnalysisResult:
        """
        Analyze crash content using local llama.cpp model.

        Args:
            content: Crash log or ticket content
            content_type: Type of content ('crash_log' or 'jira_ticket')
            rag_context: Optional similar cases from RAG

        Returns:
            OfflineAnalysisResult with analysis
        """
        import time
        start_time = time.time()

        # Build prompt
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(content, content_type, rag_context)

        # Call llama-server via OpenAI-compatible API
        try:
            response = self._client.post(
                f"{self.config.llamacpp.host}/v1/chat/completions",
                json={
                    "model": self.config.llamacpp.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": self.config.llamacpp.temperature,
                    "max_tokens": self.config.llamacpp.max_tokens,
                    "response_format": {"type": "json_object"},
                },
            )

            if response.status_code != 200:
                raise Exception(f"llama-server request failed: {response.status_code}")

            result = response.json()
            response_text = result["choices"][0]["message"]["content"]

            # Parse JSON response
            try:
                analysis = json.loads(response_text)
            except json.JSONDecodeError:
                # Try to extract JSON from response
                analysis = self._extract_json(response_text)

            processing_time = int((time.time() - start_time) * 1000)

            return OfflineAnalysisResult(
                error_type=analysis.get("error_type", "Unknown"),
                severity=analysis.get("severity", "medium"),
                root_cause=analysis.get("root_cause", response_text[:500]),
                suggested_fixes=analysis.get("suggested_fixes", []),
                component=analysis.get("component"),
                confidence=analysis.get("confidence", 0.7),
                similar_cases=rag_context,
                model_used=self.config.llamacpp.model,
                processing_time_ms=processing_time,
            )

        except Exception as e:
            logger.error(f"Offline analysis failed: {e}")
            return OfflineAnalysisResult(
                error_type="AnalysisError",
                severity="unknown",
                root_cause=f"Analysis failed: {e}",
                suggested_fixes=["Please check the crash log manually"],
                confidence=0.0,
                model_used=self.config.llamacpp.model,
                processing_time_ms=int((time.time() - start_time) * 1000),
            )

    def _build_system_prompt(self) -> str:
        """Build system prompt for analysis"""
        return """You are a WHATS'ON broadcast management system crash analysis expert.
Analyze the provided crash log and return a JSON response with:

{
    "error_type": "The specific error class/type",
    "severity": "critical|high|medium|low",
    "root_cause": "Technical explanation of what caused the crash",
    "suggested_fixes": ["Fix 1", "Fix 2", "Fix 3"],
    "component": "The WHATS'ON component affected (EPG, Rights, Scheduling, etc.)",
    "confidence": 0.0-1.0
}

Be specific about class/method references. Provide actionable fixes."""

    def _build_user_prompt(
        self,
        content: str,
        content_type: str,
        rag_context: Optional[List[Dict]],
    ) -> str:
        """Build user prompt with content and context"""
        prompt = f"Analyze this {content_type}:\n\n{content[:4000]}\n\n"

        if rag_context:
            prompt += "Similar historical cases for reference:\n"
            for i, case in enumerate(rag_context[:3], 1):
                prompt += f"\n{i}. {case.get('error_type', 'Unknown')}\n"
                prompt += f"   Root cause: {case.get('root_cause', 'N/A')[:200]}\n"
                prompt += f"   Resolution: {case.get('fix', 'N/A')[:200]}\n"

        prompt += "\nProvide your analysis as JSON."
        return prompt

    def _extract_json(self, text: str) -> Dict:
        """Try to extract JSON from text response"""
        # Look for JSON block
        import re
        json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except (json.JSONDecodeError, ValueError):
                pass

        # Return structured fallback
        return {
            "error_type": "Unknown",
            "severity": "medium",
            "root_cause": text[:500],
            "suggested_fixes": [],
            "confidence": 0.5,
        }

    def get_similar_cases(
        self,
        query: str,
        top_k: int = 5,
    ) -> List[Dict]:
        """
        Get similar cases using local RAG.

        Args:
            query: Search query (crash content or description)
            top_k: Number of results to return

        Returns:
            List of similar cases with metadata
        """
        if not embeddings_available():
            return []

        try:
            # Generate query embedding
            query_embedding = self._embeddings.generate(query[:1000])
            if not query_embedding:
                return []

            # TODO: Search local vector store
            # For now, return empty - would integrate with local FAISS/ChromaDB
            logger.debug("Local RAG search not yet implemented")
            return []

        except Exception as e:
            logger.error(f"RAG search failed: {e}")
            return []

    def close(self):
        """Close the HTTP client"""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


# ============================================================================
# Module-level functions
# ============================================================================

_service: Optional[OfflineAnalysisService] = None


def get_service() -> OfflineAnalysisService:
    """Get or create the default offline service"""
    global _service
    if _service is None:
        _service = OfflineAnalysisService()
    return _service


def analyze_offline(
    content: str,
    content_type: str = "crash_log",
    use_rag: bool = True,
) -> OfflineAnalysisResult:
    """
    Analyze content using local offline service.

    Args:
        content: Crash log or ticket content
        content_type: Type of content
        use_rag: Whether to include RAG context

    Returns:
        OfflineAnalysisResult
    """
    service = get_service()

    if not service.is_available():
        raise RuntimeError("Offline analysis service not available")

    # Get RAG context if enabled
    rag_context = None
    if use_rag:
        rag_context = service.get_similar_cases(content)

    return service.analyze(content, content_type, rag_context)


def is_offline_mode_available() -> bool:
    """Check if offline mode is available"""
    return get_service().is_available()


# ============================================================================
# CLI for testing
# ============================================================================

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)

    service = OfflineAnalysisService()

    print("Checking offline service availability...")
    if service.is_available():
        print(f"Service available using model: {service.config.llamacpp.model}")

        test_content = """
MessageNotUnderstood: BMProgramSegmentDurations>>calculateTotalDuration
Error occurred while processing schedule data.
Stack trace:
  BMProgramSegmentDurations>>calculateTotalDuration
  BMProgramSegment>>duration
  BMScheduleEntry>>validate
"""

        print("\nAnalyzing test crash log...")
        result = service.analyze(test_content)

        print(f"\nResults:")
        print(f"  Error Type: {result.error_type}")
        print(f"  Severity: {result.severity}")
        print(f"  Root Cause: {result.root_cause[:200]}")
        print(f"  Fixes: {result.suggested_fixes}")
        print(f"  Confidence: {result.confidence}")
        print(f"  Processing Time: {result.processing_time_ms}ms")
    else:
        print("Offline service not available")
        print("Ensure llama-server is running:")
        print("  llama-server -m your-model.gguf --port 8080")
