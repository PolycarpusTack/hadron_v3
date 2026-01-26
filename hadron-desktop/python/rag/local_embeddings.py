"""
Local Embeddings Service
Phase 5: Offline embedding generation using nomic-embed-text via Ollama

This replaces OpenAI embeddings for fully offline operation.
"""

import os
import json
import logging
import subprocess
from typing import List, Optional, Union
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


# ============================================================================
# Configuration
# ============================================================================

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_MODEL = os.environ.get("HADRON_EMBEDDING_MODEL", "nomic-embed-text")
EMBEDDING_DIM = 768  # nomic-embed-text dimension

# Alternative local models (must be pulled first)
SUPPORTED_MODELS = {
    "nomic-embed-text": 768,
    "all-minilm": 384,
    "mxbai-embed-large": 1024,
}


# ============================================================================
# Ollama Client
# ============================================================================

class OllamaEmbeddingClient:
    """Client for generating embeddings via Ollama"""

    def __init__(
        self,
        host: str = OLLAMA_HOST,
        model: str = DEFAULT_MODEL,
        timeout: float = 30.0,
    ):
        self.host = host.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._client = httpx.Client(timeout=timeout)
        self._available = None

    def is_available(self) -> bool:
        """Check if Ollama is running and model is available"""
        if self._available is not None:
            return self._available

        try:
            response = self._client.get(f"{self.host}/api/tags")
            if response.status_code == 200:
                data = response.json()
                models = [m["name"].split(":")[0] for m in data.get("models", [])]
                self._available = self.model in models
                if not self._available:
                    logger.warning(f"Model {self.model} not found. Available: {models}")
                return self._available
            return False
        except Exception as e:
            logger.debug(f"Ollama not available: {e}")
            self._available = False
            return False

    def pull_model(self) -> bool:
        """Pull the embedding model"""
        logger.info(f"Pulling model: {self.model}")
        try:
            result = subprocess.run(
                ["ollama", "pull", self.model],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                self._available = True
                return True
            logger.error(f"Failed to pull model: {result.stderr}")
            return False
        except FileNotFoundError:
            logger.error("Ollama CLI not found")
            return False

    def generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate embedding for a single text"""
        if not self.is_available():
            return None

        try:
            response = self._client.post(
                f"{self.host}/api/embeddings",
                json={"model": self.model, "prompt": text},
            )

            if response.status_code == 200:
                data = response.json()
                return data.get("embedding")
            else:
                logger.error(f"Embedding request failed: {response.status_code}")
                return None

        except Exception as e:
            logger.error(f"Embedding generation failed: {e}")
            return None

    def generate_embeddings(self, texts: List[str]) -> List[Optional[List[float]]]:
        """Generate embeddings for multiple texts"""
        embeddings = []
        for text in texts:
            embedding = self.generate_embedding(text)
            embeddings.append(embedding)
        return embeddings

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
    """Fallback to sentence-transformers if Ollama is unavailable"""

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
    Tries Ollama first, falls back to sentence-transformers.
    """

    def __init__(
        self,
        ollama_model: str = DEFAULT_MODEL,
        fallback_model: str = "all-MiniLM-L6-v2",
        ollama_host: str = OLLAMA_HOST,
    ):
        self.ollama = OllamaEmbeddingClient(host=ollama_host, model=ollama_model)
        self.fallback = SentenceTransformerClient(fallback_model)
        self._use_ollama = None

    def _select_backend(self) -> bool:
        """Select which backend to use"""
        if self._use_ollama is not None:
            return self._use_ollama

        if self.ollama.is_available():
            logger.info(f"Using Ollama embeddings: {self.ollama.model}")
            self._use_ollama = True
        elif self.fallback.is_available():
            logger.info(f"Using sentence-transformers: {self.fallback.model_name}")
            self._use_ollama = False
        else:
            raise RuntimeError("No embedding backend available")

        return self._use_ollama

    def generate(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        """
        Generate embeddings for text(s).

        Args:
            text: Single string or list of strings

        Returns:
            Single embedding or list of embeddings
        """
        use_ollama = self._select_backend()

        if isinstance(text, str):
            if use_ollama:
                return self.ollama.generate_embedding(text)
            else:
                return self.fallback.generate_embedding(text)
        else:
            if use_ollama:
                return self.ollama.generate_embeddings(text)
            else:
                return self.fallback.generate_embeddings(text)

    @property
    def dimension(self) -> int:
        """Get embedding dimension"""
        use_ollama = self._select_backend()
        if use_ollama:
            return self.ollama.dimension
        else:
            return self.fallback.dimension

    @property
    def model_name(self) -> str:
        """Get current model name"""
        use_ollama = self._select_backend()
        if use_ollama:
            return f"ollama:{self.ollama.model}"
        else:
            return f"sentence-transformers:{self.fallback.model_name}"

    def ensure_model(self) -> bool:
        """Ensure embedding model is available, pulling if necessary"""
        if self.ollama.is_available():
            return True

        # Try to pull Ollama model
        if self.ollama.pull_model():
            self._use_ollama = True
            return True

        # Fall back to sentence-transformers
        if self.fallback.is_available():
            self._use_ollama = False
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
        print("Install Ollama and run: ollama pull nomic-embed-text")
        print("Or install: pip install sentence-transformers")
