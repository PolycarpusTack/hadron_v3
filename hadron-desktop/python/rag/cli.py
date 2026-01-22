"""
CLI interface for RAG operations, called from Tauri/Rust.

Input/Output Protocol:
- Reads JSON from stdin containing: {"input": {...}, "api_key": "..."}
- Writes JSON results to stdout
- Logs errors to stderr
- Exits with non-zero code on failure
"""

import argparse
import json
import sys
import os
import logging
from typing import Dict, Any

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# Set OpenAI API key from stdin payload
_API_KEY = None


def set_api_key(api_key: str):
    """Set OpenAI API key for embeddings."""
    global _API_KEY
    _API_KEY = api_key
    os.environ["OPENAI_API_KEY"] = api_key


def get_api_key() -> str:
    """Get OpenAI API key."""
    if _API_KEY:
        return _API_KEY
    raise ValueError("API key not set")


def read_stdin_payload() -> Dict[str, Any]:
    """Read and parse JSON payload from stdin."""
    try:
        if sys.stdin.isatty():
            raise ValueError("Expected JSON input from stdin")

        stdin_data = sys.stdin.read()
        if not stdin_data.strip():
            raise ValueError("Empty stdin input")

        payload = json.loads(stdin_data)

        # Extract API key and input
        api_key = payload.get("api_key")
        if api_key:
            set_api_key(api_key)

        return payload.get("input", {})

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in stdin: {e}")
        raise
    except Exception as e:
        logger.error(f"Failed to read stdin: {e}")
        raise


def cmd_query(args):
    """Handle query command."""
    from .chroma_store import HadronChromaStore
    from .retrieval import HybridRetriever
    from .models import RetrievalFilters

    # Read input from stdin if args.input is "-"
    if args.input == "-":
        input_data = read_stdin_payload()
    else:
        input_data = json.loads(args.input)

    # Validate required fields
    if "query" not in input_data:
        raise ValueError("Missing required field: query")

    store = HadronChromaStore()
    retriever = HybridRetriever(store)

    filters = RetrievalFilters(
        component=input_data.get("component"),
        severity=input_data.get("severity"),
    )

    results = retriever.retrieve(
        query=input_data["query"],
        filters=filters,
        top_k=input_data.get("top_k", 5),
    )

    output = [r.model_dump() for r in results]
    print(json.dumps(output, indent=2))


def cmd_index(args):
    """Handle index command."""
    from .chroma_store import HadronChromaStore
    from .chunks import chunk_analysis
    from .embeddings import get_single_embedding
    from .models import RetrievalChunk, ChunkMetadata

    # Read analysis from stdin if args.input is "-"
    if args.input == "-":
        payload = read_stdin_payload()
        analysis = payload  # The entire input is the analysis
    else:
        analysis = json.loads(args.input)

    # Validate required fields
    if not analysis:
        raise ValueError("Missing analysis data")

    store = HadronChromaStore()
    chunks = chunk_analysis(analysis)

    if not chunks:
        logger.warning("No chunks generated from analysis")
        print(json.dumps({"indexed": 0, "ids": []}))
        return

    retrieval_chunks = []
    for chunk in chunks:
        try:
            # Generate embedding
            embedding = get_single_embedding(chunk["content"])

            retrieval_chunk = RetrievalChunk(
                id=f"analysis_{analysis.get('id', 0)}_{chunk['chunk_type']}",
                content=chunk["content"],
                embedding=embedding,
                metadata=ChunkMetadata(**chunk.get("metadata", {})),
                chunk_type=chunk.get("chunk_type", "unknown")
            )
            retrieval_chunks.append(retrieval_chunk)

        except Exception as e:
            logger.error(f"Failed to generate embedding for chunk {chunk['chunk_type']}: {e}")
            # Continue with other chunks

    if not retrieval_chunks:
        raise ValueError("Failed to generate embeddings for all chunks")

    ids = store.upsert(retrieval_chunks)
    print(json.dumps({"indexed": len(ids), "ids": ids}, indent=2))


def cmd_context(args):
    """Handle context building command."""
    from .chroma_store import HadronChromaStore
    from .retrieval import HybridRetriever
    from .models import RetrievalFilters

    # Read input from stdin if args.input is "-"
    if args.input == "-":
        input_data = read_stdin_payload()
    else:
        input_data = json.loads(args.input)

    # Validate required fields
    if "query" not in input_data:
        raise ValueError("Missing required field: query")

    store = HadronChromaStore()
    retriever = HybridRetriever(store)

    filters = RetrievalFilters(
        component=input_data.get("component"),
        severity=input_data.get("severity"),
    )

    context = retriever.build_rag_context(
        query=input_data["query"],
        filters=filters,
        top_k=input_data.get("top_k", 5),
    )

    print(json.dumps(context.model_dump(), indent=2))


def cmd_stats(args):
    """Handle stats command."""
    from .chroma_store import HadronChromaStore

    try:
        store = HadronChromaStore()

        # Get collection stats
        collection = store.collection
        count = collection.count()

        # Try to get metadata
        metadata = collection.metadata or {}

        stats = {
            "total_chunks": count,
            "total_analyses": metadata.get("total_analyses", 0),
            "gold_analyses": metadata.get("gold_analyses", 0),
            "storage_path": str(store.persist_directory),
        }

        print(json.dumps(stats, indent=2))

    except Exception as e:
        logger.warning(f"Failed to get stats: {e}")
        # Return empty stats instead of failing
        print(json.dumps({
            "total_chunks": 0,
            "total_analyses": 0,
            "gold_analyses": 0,
            "storage_path": "",
        }, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Hadron RAG CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Query command
    query_parser = subparsers.add_parser("query", help="Query the RAG store")
    query_parser.add_argument("--input", default="-", help="JSON input (or '-' for stdin)")
    query_parser.set_defaults(func=cmd_query)

    # Index command
    index_parser = subparsers.add_parser("index", help="Index an analysis")
    index_parser.add_argument("--input", default="-", help="JSON analysis (or '-' for stdin)")
    index_parser.set_defaults(func=cmd_index)

    # Context command
    context_parser = subparsers.add_parser("context", help="Build RAG context")
    context_parser.add_argument("--input", default="-", help="JSON input (or '-' for stdin)")
    context_parser.set_defaults(func=cmd_context)

    # Stats command
    stats_parser = subparsers.add_parser("stats", help="Get RAG store statistics")
    stats_parser.set_defaults(func=cmd_stats)

    args = parser.parse_args()

    try:
        args.func(args)
        sys.exit(0)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(130)

    except Exception as e:
        logger.error(f"Command failed: {e}", exc_info=True)
        # Print error to stderr for Rust to capture
        print(f"ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
