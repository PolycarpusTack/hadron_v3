"""
Embedding generation using OpenAI API.

Adapted from: chatgpt-retrieval-plugin/services/openai.py
"""

import os
from typing import List, Optional
import logging

from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

logger = logging.getLogger(__name__)

# Configuration
EMBEDDING_MODEL = os.environ.get("HADRON_EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSION = int(os.environ.get("HADRON_EMBEDDING_DIMENSION", "1536"))
BATCH_SIZE = int(os.environ.get("HADRON_EMBEDDING_BATCH_SIZE", "100"))


def get_openai_client():
    """Get OpenAI client, importing only when needed."""
    try:
        import openai
        return openai.OpenAI()
    except ImportError:
        raise ImportError("openai package not installed. Run: pip install openai")


def _get_retryable_exceptions():
    """Get OpenAI exceptions that should trigger retries."""
    try:
        from openai import RateLimitError, APIError, APIConnectionError
        return (RateLimitError, APIError, APIConnectionError)
    except ImportError:
        return (Exception,)  # Fallback


@retry(
    retry=retry_if_exception_type(_get_retryable_exceptions()),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    before_sleep=lambda retry_state: logger.warning(
        f"Retrying embedding request (attempt {retry_state.attempt_number})..."
    ),
)
def _create_embeddings_with_retry(client, model: str, batch: List[str], dimensions: Optional[int]):
    """Internal function with retry logic for embedding creation."""
    return client.embeddings.create(
        model=model,
        input=batch,
        dimensions=dimensions if dimensions and "3" in model else None,
    )


def get_embeddings(
    texts: List[str],
    model: str = EMBEDDING_MODEL,
    dimensions: int = EMBEDDING_DIMENSION,
) -> List[List[float]]:
    """
    Generate embeddings for a list of texts using OpenAI API.

    Args:
        texts: List of texts to embed
        model: OpenAI embedding model to use
        dimensions: Embedding dimension (for models that support it)

    Returns:
        List of embedding vectors

    Raises:
        ValueError: If dimensions is not positive
        ImportError: If openai package is not installed
    """
    if not texts:
        return []

    if dimensions <= 0:
        raise ValueError("dimensions must be positive")

    client = get_openai_client()

    all_embeddings = []

    # Process in batches
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i:i + BATCH_SIZE]

        try:
            response = _create_embeddings_with_retry(client, model, batch, dimensions)
            batch_embeddings = [item.embedding for item in response.data]
            all_embeddings.extend(batch_embeddings)

        except Exception as e:
            logger.error(f"Failed to generate embeddings after retries: {e}")
            raise

    return all_embeddings


def get_single_embedding(
    text: str,
    model: str = EMBEDDING_MODEL,
    dimensions: int = EMBEDDING_DIMENSION,
) -> List[float]:
    """
    Generate embedding for a single text.

    Args:
        text: Text to embed
        model: OpenAI embedding model to use
        dimensions: Embedding dimension

    Returns:
        Embedding vector
    """
    embeddings = get_embeddings([text], model, dimensions)
    return embeddings[0] if embeddings else []


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    import math

    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    norm1 = math.sqrt(sum(a * a for a in vec1))
    norm2 = math.sqrt(sum(b * b for b in vec2))

    if norm1 == 0 or norm2 == 0:
        return 0.0

    return dot_product / (norm1 * norm2)
