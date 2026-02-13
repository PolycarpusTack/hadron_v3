"""
Offline Deployment Configuration
Phase 5: Settings for fully offline Hadron operation (using llama.cpp)
"""

import os
from dataclasses import dataclass, field
from typing import Optional, List
from pathlib import Path
from enum import Enum


class OfflineMode(Enum):
    """Offline operation modes"""
    DISABLED = "disabled"  # Use cloud APIs
    HYBRID = "hybrid"      # Use local when available, fallback to cloud
    FULL = "full"          # Fully offline, no external calls


@dataclass
class LlamaCppSettings:
    """llama.cpp (llama-server) service configuration"""
    host: str = "http://localhost:8080"
    model: str = "hadron:v1"  # Fine-tuned model
    embedding_model: str = "nomic-embed-text"
    timeout: float = 120.0
    max_tokens: int = 4096
    temperature: float = 0.3


@dataclass
class RAGSettings:
    """Local RAG configuration"""
    vector_db_path: str = "~/.hadron/vectors"
    chunk_size: int = 512
    chunk_overlap: int = 50
    top_k: int = 5
    similarity_threshold: float = 0.7


@dataclass
class CacheSettings:
    """Local caching configuration"""
    enabled: bool = True
    cache_dir: str = "~/.hadron/cache"
    max_size_mb: int = 500
    ttl_hours: int = 24 * 7  # 1 week


@dataclass
class OfflineConfig:
    """Complete offline deployment configuration"""
    mode: OfflineMode = OfflineMode.HYBRID
    llamacpp: LlamaCppSettings = field(default_factory=LlamaCppSettings)
    rag: RAGSettings = field(default_factory=RAGSettings)
    cache: CacheSettings = field(default_factory=CacheSettings)

    # Hardware requirements
    min_ram_gb: int = 16
    min_vram_gb: int = 8
    recommended_gpu: str = "RTX 3060 or better"

    def validate(self) -> List[str]:
        """Validate configuration and return list of issues"""
        issues = []

        # Check llama-server availability via OpenAI-compatible endpoint
        import httpx
        try:
            response = httpx.get(f"{self.llamacpp.host}/v1/models", timeout=5.0)
            if response.status_code != 200:
                issues.append(f"llama-server not responding at {self.llamacpp.host}")
        except Exception as e:
            issues.append(f"Cannot connect to llama-server: {e}")

        # Check paths exist
        cache_path = Path(self.cache.cache_dir).expanduser()
        if not cache_path.parent.exists():
            issues.append(f"Cache directory parent does not exist: {cache_path.parent}")

        vector_path = Path(self.rag.vector_db_path).expanduser()
        if not vector_path.parent.exists():
            issues.append(f"Vector DB directory parent does not exist: {vector_path.parent}")

        return issues

    def to_env_vars(self) -> dict:
        """Export configuration as environment variables"""
        return {
            "HADRON_OFFLINE_MODE": self.mode.value,
            "LLAMACPP_HOST": self.llamacpp.host,
            "HADRON_LLAMACPP_MODEL": self.llamacpp.model,
            "HADRON_EMBEDDING_MODEL": self.llamacpp.embedding_model,
            "HADRON_VECTOR_DB_PATH": str(Path(self.rag.vector_db_path).expanduser()),
            "HADRON_CACHE_DIR": str(Path(self.cache.cache_dir).expanduser()),
            "HADRON_CACHE_ENABLED": str(self.cache.enabled).lower(),
        }

    @classmethod
    def from_env(cls) -> "OfflineConfig":
        """Create configuration from environment variables"""
        mode_str = os.environ.get("HADRON_OFFLINE_MODE", "hybrid")
        try:
            mode = OfflineMode(mode_str)
        except ValueError:
            mode = OfflineMode.HYBRID

        llamacpp = LlamaCppSettings(
            host=os.environ.get("LLAMACPP_HOST", "http://localhost:8080"),
            model=os.environ.get("HADRON_LLAMACPP_MODEL", "hadron:v1"),
            embedding_model=os.environ.get("HADRON_EMBEDDING_MODEL", "nomic-embed-text"),
        )

        rag = RAGSettings(
            vector_db_path=os.environ.get("HADRON_VECTOR_DB_PATH", "~/.hadron/vectors"),
        )

        cache = CacheSettings(
            enabled=os.environ.get("HADRON_CACHE_ENABLED", "true").lower() == "true",
            cache_dir=os.environ.get("HADRON_CACHE_DIR", "~/.hadron/cache"),
        )

        return cls(mode=mode, llamacpp=llamacpp, rag=rag, cache=cache)


def get_default_config() -> OfflineConfig:
    """Get default offline configuration"""
    return OfflineConfig()


def is_offline_available() -> bool:
    """Check if offline mode is available"""
    config = OfflineConfig.from_env()
    issues = config.validate()
    return len(issues) == 0
