"""
Local Embeddings Service
Phase 5: Offline embedding generation using OpenAI-compatible API (llama.cpp / llama-server)

This replaces OpenAI embeddings for fully offline operation.
Uses /v1/embeddings endpoint exposed by llama-server.
"""

import os
import json
import logging
from typing import List, Optional, Union
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


# ============================================================================
# Configuration
# ============================================================================

LLAMACPP_HOST = os.environ.get("LLAMACPP_HOST", "http://localhost:8080")
DEFAULT_MODEL = os.environ.get("HADRON_EMBEDDING_MODEL", "nomic-embed-text")
EMBEDDING_DIM = 768  # nomic-embed-text dimension

# Alternative local models
SUPPORTED_MODELS = {
    "nomic-embed-text": 768,
    "all-minilm": 384,
    "mxbai-embed-large": 1024,
}


# ============================================================================
# llama.cpp Embedding Client (OpenAI-compatible)
# ============================================================================

class LlamaCppEmbeddingClient:
    """Client for generating embeddings via llama-server's OpenAI-compatible API"""

    def __init__(
        self,
        host: str = LLAMACPP_HOST,
        model: str = DEFAULT_MODEL,
        timeout: float = 30.0,
    ):
        self.host = host.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._client = httpx.Client(timeout=timeout)
        self._available = None

    def is_available(self) -> bool:
        """Check if llama-server is running and serving embeddings"""
        if self._available is not None:
            return self._available

        try:
            response = self._client.get(f"{self.host}/v1/models")
            if response.status_code == 200:
                data = response.json()
                models = [m.get("id", "") for m in data.get("data", [])]
                self._available = len(models) > 0
                if self._available and self.model not in models and models:
                    # Use first available model
                    self.model = models[0]
                    logger.info(f"Using available embedding model: {self.model}")
                return self._available
            return False
        except Exception as e:
            logger.debug(f"llama-server not available: {e}")
            self._available = False
            return False

    def generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate embedding for a single text via /v1/embeddings"""
        if not self.is_available():
            return None

        try:
            response = self._client.post(
                f"{self.host}/v1/embeddings",
                json={"model": self.model, "input": text},
            )

            if response.status_code == 200:
                data = response.json()
                embeddings = data.get("data", [])
                if embeddings:
                    return embeddings[0].get("embedding")
            else:
                logger.error(f"Embedding request failed: {response.status_code}")
                return None

        except Exception as e:
            logger.error(f"Embedding generation failed: {e}")
            return None

    def generate_embeddings(self, texts: List[str]) -> List[Optional[List[float]]]:
        """Generate embeddings for multiple texts"""
        if not self.is_available():
            return [None] * len(texts)

        try:
            # llama-server supports batch input
            response = self._client.post(
                f"{self.host}/v1/embeddings",
                json={"model": self.model, "input": texts},
            )

            if response.status_code == 200:
                data = response.json()
                embeddings_data = data.get("data", [])
                # Sort by index to maintain order
                embeddings_data.sort(key=lambda x: x.get("index", 0))
                return [e.get("embedding") for e in embeddings_data]
            else:
                # Fallback to individual requests
                return [self.generate_embedding(text) for text in texts]

        except Exception as e:
            logger.error(f"Batch embedding generation failed: {e}")
            return [self.generate_embedding(text) for text in texts]

    @property
    def dimension(self) -> int:
        """Get embedding dimension for current model"""
        return SUPPORTED_MODELS.get(self.model, EMBEDDING_DIM)

    def close(self):
        """Close the HTTP client"""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


# ============================================================================
# Sentence Transformers Fallback
# ============================================================================

class SentenceTransformerClient:
    """Fallback to sentence-transformers if llama-server is unavailable"""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name
        self._model = None

    def _load_model(self):
        """Lazy load the model"""
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
                logger.info(f"Loading sentence-transformer model: {self.model_name}")
                self._model = SentenceTransformer(self.model_name)
            except ImportError:
                logger.error("sentence-transformers not installed")
                raise

    def is_available(self) -> bool:
        """Check if sentence-transformers is available"""
        try:
            self._load_model()
            return True
        except Exception:
            return False

    def generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate embedding for a single text"""
        self._load_model()
        embedding = self._model.encode(text)
        return embedding.tolist()

    def generate_embeddings(self, texts: List[str]) -> List[Optional[List[float]]]:
        """Generate embeddings for multiple texts"""
        self._load_model()
        embeddings = self._model.encode(texts)
        return [e.tolist() for e in embeddings]

    @property
    def dimension(self) -> int:
        """Get embedding dimension"""
        self._load_model()
        return self._model.get_sentence_embedding_dimension()


# ============================================================================
# Unified Interface
# ============================================================================

class LocalEmbeddings:
    """
    Unified local embedding interface.
    Tries llama-server first, falls back to sentence-transformers.
    """

    def __init__(
        self,
        ollama_model: str = DEFAULT_MODEL,
        fallback_model: str = "all-MiniLM-L6-v2",
        ollama_host: str = LLAMACPP_HOST,
    ):
        # Keep parameter names for backward compatibility
        self.llamacpp = LlamaCppEmbeddingClient(host=ollama_host, model=ollama_model)
        self.fallback = SentenceTransformerClient(fallback_model)
        self._use_llamacpp = None

    def _select_backend(self) -> bool:
        """Select which backend to use. Returns True for llama.cpp."""
        if self._use_llamacpp is not None:
            return self._use_llamacpp

        if self.llamacpp.is_available():
            logger.info(f"Using llama.cpp embeddings: {self.llamacpp.model}")
            self._use_llamacpp = True
        elif self.fallback.is_available():
            logger.info(f"Using sentence-transformers: {self.fallback.model_name}")
            self._use_llamacpp = False
        else:
            raise RuntimeError("No embedding backend available")

        return self._use_llamacpp

    def generate(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        """
        Generate embeddings for text(s).

        Args:
            text: Single string or list of strings

        Returns:
            Single embedding or list of embeddings
        """
        use_llamacpp = self._select_backend()

        if isinstance(text, str):
            if use_llamacpp:
                return self.llamacpp.generate_embedding(text)
            else:
                return self.fallback.generate_embedding(text)
        else:
            if use_llamacpp:
                return self.llamacpp.generate_embeddings(text)
            else:
                return self.fallback.generate_embeddings(text)

    @property
    def dimension(self) -> int:
        """Get embedding dimension"""
        use_llamacpp = self._select_backend()
        if use_llamacpp:
            return self.llamacpp.dimension
        else:
            return self.fallback.dimension

    @property
    def model_name(self) -> str:
        """Get current model name"""
        use_llamacpp = self._select_backend()
        if use_llamacpp:
            return f"llamacpp:{self.llamacpp.model}"
        else:
            return f"sentence-transformers:{self.fallback.model_name}"

    def ensure_model(self) -> bool:
        """Ensure embedding model is available"""
        if self.llamacpp.is_available():
            return True

        # Fall back to sentence-transformers
        if self.fallback.is_available():
            self._use_llamacpp = False
            return True

        return False


# ============================================================================
# Module-level functions (compatible with existing RAG code)
# ============================================================================

_default_client: Optional[LocalEmbeddings] = None


def get_client() -> LocalEmbeddings:
    """Get or create the default embedding client"""
    global _default_client
    if _default_client is None:
        _default_client = LocalEmbeddings()
    return _default_client


def generate_embedding(text: str) -> Optional[List[float]]:
    """Generate embedding for text using local model"""
    return get_client().generate(text)


def generate_embeddings(texts: List[str]) -> List[Optional[List[float]]]:
    """Generate embeddings for multiple texts"""
    return get_client().generate(texts)


def get_embedding_dimension() -> int:
    """Get the embedding dimension"""
    return get_client().dimension


def is_available() -> bool:
    """Check if local embeddings are available"""
    try:
        return get_client().ensure_model()
    except Exception:
        return False


# ============================================================================
# CLI for testing
# ============================================================================

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
    else:
        text = "This is a test sentence for embedding generation."

    print(f"Testing local embeddings...")
    print(f"Text: {text}")

    client = LocalEmbeddings()

    if client.ensure_model():
        print(f"Using: {client.model_name}")
        print(f"Dimension: {client.dimension}")

        embedding = client.generate(text)
        if embedding:
            print(f"Embedding (first 10): {embedding[:10]}")
            print(f"Embedding length: {len(embedding)}")
        else:
            print("Failed to generate embedding")
    else:
        print("No embedding backend available")
        print("Ensure llama-server is running with an embedding model:")
        print("  llama-server -m nomic-embed-text.gguf --host 127.0.0.1 --port 8080 --embedding")
        print("Or install: pip install sentence-transformers")
