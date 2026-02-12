"""
Remote KNN retrieval from OpenSearch for WHATS'ON Knowledge Base.

Uses text-embedding-3-large (matching the chatbot's indexing model)
for OpenSearch KNN queries. Query structure adapted from the chatbot's
vector_store.py retrieve_documents method.
"""

import logging
import time
from typing import List, Optional

from .kb_client import KBOpenSearchClient
from .embeddings import get_single_embedding
from .models import KBResult, KBContext

logger = logging.getLogger(__name__)

# OpenSearch KB uses text-embedding-3-large with 3072 dimensions
KB_EMBEDDING_MODEL = "text-embedding-3-large"
KB_EMBEDDING_DIMENSION = 3072

# Field names matching the chatbot's index schema
EMBEDDING_FIELD = "embedding"
VERSION_SORTABLE_FIELD = "won_version_for_sorting"
VERSION_FIELD = "won_version"
CUSTOMER_FIELD = "customer"


def _build_knn_query(
    vector: List[float],
    k: int = 5,
    won_version_min: Optional[str] = None,
    won_version_max: Optional[str] = None,
) -> dict:
    """Build an OpenSearch KNN query with optional version range filter."""
    query = {
        "size": k,
        "query": {
            "knn": {
                EMBEDDING_FIELD: {
                    "vector": vector,
                    "k": k,
                }
            }
        },
    }

    # Add version range filter if specified
    version_range = {}
    if won_version_min is not None:
        version_range["gte"] = won_version_min
    if won_version_max is not None:
        version_range["lte"] = won_version_max

    if version_range:
        query["query"]["knn"][EMBEDDING_FIELD]["filter"] = {
            "bool": {
                "must": {
                    "range": {VERSION_SORTABLE_FIELD: version_range}
                }
            }
        }

    return query


def retrieve_kb_docs(
    client: KBOpenSearchClient,
    query: str,
    won_version: Optional[str] = None,
    top_k: int = 5,
) -> List[KBResult]:
    """
    Retrieve KB documentation from OpenSearch.

    Queries the `kb-doc-{version}` index using KNN similarity search.
    """
    # Determine index name
    if won_version:
        index_name = f"kb-doc-{won_version}"
        if not client.index_exists(index_name):
            logger.warning(f"KB index '{index_name}' not found, trying wildcard")
            index_name = "kb-doc-*"
    else:
        index_name = "kb-doc-*"

    # Generate embedding using the same model as the chatbot's indexer
    vector = get_single_embedding(query, model=KB_EMBEDDING_MODEL, dimensions=KB_EMBEDDING_DIMENSION)
    if not vector:
        logger.warning("Failed to generate embedding for KB query")
        return []

    # Build and execute KNN query
    body = _build_knn_query(vector, k=top_k)

    try:
        response = client.search(index=index_name, body=body)
    except Exception as e:
        logger.error(f"KB search failed on index '{index_name}': {e}")
        return []

    # Parse results
    results = []
    for hit in response.get("hits", {}).get("hits", []):
        source = hit.get("_source", {})
        results.append(
            KBResult(
                text=source.get("text", source.get("content", "")),
                link=source.get("link", source.get("url", "")),
                page_title=source.get("page_title", source.get("title", "")),
                won_version=source.get(VERSION_FIELD, ""),
                score=hit.get("_score", 0.0),
                source_type="knowledge_base",
            )
        )

    return results


def retrieve_release_notes(
    client: KBOpenSearchClient,
    query: str,
    customer: Optional[str] = None,
    version_min: Optional[str] = None,
    version_max: Optional[str] = None,
    top_k: int = 5,
) -> List[KBResult]:
    """
    Retrieve release notes from OpenSearch.

    Queries `base-release-notes` or `{customer}-release-notes` index.
    """
    # Determine index name
    if customer:
        index_name = f"{customer}-release-notes"
        source_type = "customer_release_notes"
    else:
        index_name = "base-release-notes"
        source_type = "base_release_notes"

    if not client.index_exists(index_name):
        logger.warning(f"Release notes index '{index_name}' not found")
        return []

    # Generate embedding
    vector = get_single_embedding(query, model=KB_EMBEDDING_MODEL, dimensions=KB_EMBEDDING_DIMENSION)
    if not vector:
        return []

    # Build and execute KNN query with version range
    body = _build_knn_query(
        vector,
        k=top_k,
        won_version_min=version_min,
        won_version_max=version_max,
    )

    try:
        response = client.search(index=index_name, body=body)
    except Exception as e:
        logger.error(f"Release notes search failed on '{index_name}': {e}")
        return []

    results = []
    for hit in response.get("hits", {}).get("hits", []):
        source = hit.get("_source", {})
        results.append(
            KBResult(
                text=source.get("text", source.get("content", "")),
                link=source.get("link", source.get("url", "")),
                page_title=source.get("page_title", source.get("title", "")),
                won_version=source.get(VERSION_FIELD, ""),
                customer=customer or "",
                score=hit.get("_score", 0.0),
                source_type=source_type,
            )
        )

    return results


def query_kb(
    host: str,
    port: int,
    username: str,
    password: str,
    use_ssl: bool,
    query: str,
    won_version: Optional[str] = None,
    customer: Optional[str] = None,
    use_kb: bool = True,
    use_base_rns: bool = False,
    use_customer_rns: bool = False,
    top_k: int = 5,
) -> KBContext:
    """
    High-level function to query KB and/or release notes.

    Returns a KBContext combining results from all requested sources.
    """
    start = time.time()

    client = KBOpenSearchClient(
        host=host, port=port, username=username, password=password, use_ssl=use_ssl
    )

    kb_results: List[KBResult] = []
    rn_results: List[KBResult] = []

    try:
        if use_kb:
            kb_results = retrieve_kb_docs(client, query, won_version=won_version, top_k=top_k)

        if use_base_rns:
            rn_results.extend(
                retrieve_release_notes(client, query, customer=None, top_k=top_k)
            )

        if use_customer_rns and customer:
            rn_results.extend(
                retrieve_release_notes(client, query, customer=customer, top_k=top_k)
            )
    finally:
        client.close()

    elapsed_ms = int((time.time() - start) * 1000)

    return KBContext(
        kb_results=kb_results,
        release_note_results=rn_results,
        retrieval_time_ms=elapsed_ms,
        source_mode="remote",
    )
