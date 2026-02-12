"""
Local ChromaDB-based KB store for offline WHATS'ON documentation.

Stores KB HTML docs in a separate ChromaDB collection (`hadron_kb_docs`)
using text-embedding-3-small (Hadron's standard embedding model).
"""

import os
import re
import logging
import time
from pathlib import Path
from typing import List, Optional

from .embeddings import get_single_embedding, get_embeddings
from .chunks import chunk_text_by_tokens
from .models import KBResult, KBContext

logger = logging.getLogger(__name__)

KB_CHROMA_DIR = os.path.join(os.path.expanduser("~"), ".hadron", "chroma_kb")
KB_COLLECTION_NAME = "hadron_kb_docs"


def _strip_html(html: str) -> str:
    """Basic HTML tag removal for plain text extraction."""
    # Remove script and style elements
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _get_store():
    """Get or create the KB ChromaDB collection."""
    try:
        import chromadb
        from chromadb.config import Settings
    except ImportError:
        raise ImportError("chromadb not installed. Run: pip install chromadb")

    os.makedirs(KB_CHROMA_DIR, exist_ok=True)

    client = chromadb.PersistentClient(
        path=KB_CHROMA_DIR,
        settings=Settings(anonymized_telemetry=False),
    )

    collection = client.get_or_create_collection(
        name=KB_COLLECTION_NAME,
        embedding_function=None,
        metadata={"hnsw:space": "cosine"},
    )

    return client, collection


def index_kb_docs(root_path: str, won_version: str) -> int:
    """
    Import KB HTML files from a local directory into ChromaDB.

    Walks HTML files under root_path, strips HTML, chunks text,
    generates embeddings, and upserts into the KB collection.

    Returns the number of indexed chunks.
    """
    root = Path(root_path)
    if not root.is_dir():
        raise ValueError(f"KB root path is not a directory: {root_path}")

    _, collection = _get_store()

    html_files = list(root.rglob("*.html")) + list(root.rglob("*.htm"))
    if not html_files:
        logger.warning(f"No HTML files found in {root_path}")
        return 0

    logger.info(f"Found {len(html_files)} HTML files in {root_path}")

    total_chunks = 0

    for html_file in html_files:
        try:
            content = html_file.read_text(encoding="utf-8", errors="replace")
            plain_text = _strip_html(content)

            if len(plain_text) < 50:
                continue

            # Extract page title from filename or <title> tag
            title_match = re.search(r"<title[^>]*>(.*?)</title>", content, re.IGNORECASE | re.DOTALL)
            page_title = title_match.group(1).strip() if title_match else html_file.stem

            # Chunk the text
            text_chunks = chunk_text_by_tokens(plain_text, chunk_size=500, overlap=50)

            if not text_chunks:
                continue

            # Generate embeddings (uses text-embedding-3-small, Hadron's standard)
            embeddings = get_embeddings(text_chunks)

            # Build IDs and metadata
            ids = []
            metadatas = []
            for i, _ in enumerate(text_chunks):
                chunk_id = f"kb_{won_version}_{html_file.stem}_{i}"
                ids.append(chunk_id)
                metadatas.append({
                    "won_version": won_version,
                    "page_title": page_title,
                    "source_file": str(html_file.relative_to(root)),
                    "source_type": "knowledge_base",
                    "chunk_index": i,
                })

            # Upsert into ChromaDB
            collection.upsert(
                ids=ids,
                embeddings=embeddings,
                documents=text_chunks,
                metadatas=metadatas,
            )

            total_chunks += len(text_chunks)
            logger.info(f"Indexed {len(text_chunks)} chunks from {html_file.name}")

        except Exception as e:
            logger.error(f"Failed to index {html_file}: {e}")
            continue

    logger.info(f"Indexed {total_chunks} total chunks for version {won_version}")
    return total_chunks


def query_kb(
    query: str,
    won_version: Optional[str] = None,
    top_k: int = 5,
) -> KBContext:
    """
    Query the local KB ChromaDB collection.

    Returns matching KB documents with optional version filtering.
    """
    start = time.time()

    _, collection = _get_store()

    if collection.count() == 0:
        return KBContext(source_mode="local")

    # Generate embedding for the query
    vector = get_single_embedding(query)
    if not vector:
        return KBContext(source_mode="local")

    # Build where filter for version
    where_filter = None
    if won_version:
        where_filter = {"won_version": won_version}

    try:
        results = collection.query(
            query_embeddings=[vector],
            n_results=top_k,
            where=where_filter,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as e:
        logger.error(f"Local KB query failed: {e}")
        return KBContext(source_mode="local")

    kb_results = []
    if results and results["documents"] and results["documents"][0]:
        for i, doc in enumerate(results["documents"][0]):
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            # ChromaDB returns distances (lower=better), convert to similarity score
            distance = results["distances"][0][i] if results["distances"] else 1.0
            score = max(0.0, 1.0 - distance)

            kb_results.append(
                KBResult(
                    text=doc,
                    page_title=meta.get("page_title", ""),
                    won_version=meta.get("won_version", ""),
                    score=score,
                    source_type="knowledge_base",
                )
            )

    elapsed_ms = int((time.time() - start) * 1000)

    return KBContext(
        kb_results=kb_results,
        retrieval_time_ms=elapsed_ms,
        source_mode="local",
    )


def get_stats() -> dict:
    """Get statistics about the local KB store."""
    try:
        _, collection = _get_store()
        count = collection.count()

        # Get unique versions from metadata
        versions = set()
        if count > 0:
            # Sample metadata to find indexed versions
            sample = collection.get(limit=min(count, 100), include=["metadatas"])
            if sample and sample["metadatas"]:
                for meta in sample["metadatas"]:
                    if meta and "won_version" in meta:
                        versions.add(meta["won_version"])

        return {
            "total_chunks": count,
            "indexed_versions": sorted(versions),
            "storage_path": KB_CHROMA_DIR,
        }
    except Exception as e:
        logger.warning(f"Failed to get KB stats: {e}")
        return {
            "total_chunks": 0,
            "indexed_versions": [],
            "storage_path": KB_CHROMA_DIR,
        }
