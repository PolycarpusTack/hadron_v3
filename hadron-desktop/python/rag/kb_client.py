"""
Minimal synchronous OpenSearch client for WHATS'ON Knowledge Base.

Adapted from the Mediagenix Analyst Chatbot's opensearch_mgx.py but
simplified for subprocess-based usage (no async, no singleton pattern).
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class KBOpenSearchClient:
    """Synchronous OpenSearch client for KB/Release Notes indices."""

    def __init__(
        self,
        host: str,
        port: int = 443,
        username: str = "",
        password: str = "",
        use_ssl: bool = True,
    ):
        try:
            from opensearchpy import OpenSearch, RequestsHttpConnection
        except ImportError:
            raise ImportError(
                "opensearch-py not installed. Run: pip install opensearch-py"
            )

        self._client = OpenSearch(
            hosts=[{"host": host, "port": port}],
            http_auth=(username, password) if username else None,
            use_ssl=use_ssl,
            verify_certs=use_ssl,
            connection_class=RequestsHttpConnection,
            pool_maxsize=5,
            timeout=15,
        )
        self._host = host
        self._port = port

    def ping(self) -> bool:
        """Test connectivity to the OpenSearch cluster."""
        try:
            return self._client.ping()
        except Exception as e:
            logger.warning(f"OpenSearch ping failed: {e}")
            return False

    def search(self, index: str, body: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a search query against an index."""
        return self._client.search(index=index, body=body)

    def index_exists(self, index: str) -> bool:
        """Check if an index exists."""
        try:
            return self._client.indices.exists(index=index)
        except Exception:
            return False

    def list_indices(self, pattern: str = "kb-doc-*") -> List[str]:
        """List indices matching a pattern."""
        try:
            result = self._client.indices.get(index=pattern)
            return sorted(result.keys()) if result else []
        except Exception as e:
            logger.warning(f"Failed to list indices for pattern '{pattern}': {e}")
            return []

    def close(self):
        """Close the client connection."""
        try:
            self._client.close()
        except Exception:
            pass
