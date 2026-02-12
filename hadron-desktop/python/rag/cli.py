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


def cmd_kb_query(args):
    """Handle KB query command — query OpenSearch or local ChromaDB for KB docs."""
    input_data = read_stdin_payload()

    query = input_data.get("query")
    if not query:
        raise ValueError("Missing required field: query")

    mode = input_data.get("mode", "remote")
    won_version = input_data.get("won_version")
    customer = input_data.get("customer")
    top_k = input_data.get("top_k", 5)

    if mode == "local":
        from .kb_local import query_kb as local_query
        context = local_query(query=query, won_version=won_version, top_k=top_k)
    else:
        from .kb_retriever import query_kb as remote_query
        context = remote_query(
            host=input_data.get("opensearch_host", ""),
            port=int(input_data.get("opensearch_port", 443)),
            username=input_data.get("opensearch_user", ""),
            password=input_data.get("opensearch_pass", ""),
            use_ssl=input_data.get("opensearch_ssl", True),
            query=query,
            won_version=won_version,
            customer=customer,
            use_kb=input_data.get("use_kb", True),
            use_base_rns=input_data.get("use_base_rns", False),
            use_customer_rns=input_data.get("use_customer_rns", False),
            top_k=top_k,
        )

    print(json.dumps(context.model_dump(), indent=2))


def cmd_kb_test(args):
    """Handle KB test command — test OpenSearch connectivity."""
    input_data = read_stdin_payload()

    from .kb_client import KBOpenSearchClient

    try:
        client = KBOpenSearchClient(
            host=input_data.get("host", ""),
            port=int(input_data.get("port", 443)),
            username=input_data.get("username", ""),
            password=input_data.get("password", ""),
            use_ssl=input_data.get("use_ssl", True),
        )

        success = client.ping()
        indices = client.list_indices("kb-doc-*") if success else []
        client.close()

        print(json.dumps({
            "success": success,
            "message": "Connected successfully" if success else "Connection failed",
            "available_indices": indices,
        }, indent=2))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "message": str(e),
            "available_indices": [],
        }, indent=2))


def cmd_kb_indices(args):
    """Handle KB indices command — list available OpenSearch KB indices."""
    input_data = read_stdin_payload()

    from .kb_client import KBOpenSearchClient

    try:
        client = KBOpenSearchClient(
            host=input_data.get("host", ""),
            port=int(input_data.get("port", 443)),
            username=input_data.get("username", ""),
            password=input_data.get("password", ""),
            use_ssl=input_data.get("use_ssl", True),
        )

        indices = client.list_indices("kb-doc-*")
        client.close()
        print(json.dumps(indices, indent=2))
    except Exception as e:
        logger.error(f"Failed to list KB indices: {e}")
        print(json.dumps([], indent=2))


def cmd_kb_import(args):
    """Handle KB import command — import local HTML files into ChromaDB."""
    input_data = read_stdin_payload()

    root_path = input_data.get("root_path")
    won_version = input_data.get("won_version")
    if not root_path or not won_version:
        raise ValueError("Missing required fields: root_path, won_version")

    from .kb_local import index_kb_docs

    count = index_kb_docs(root_path, won_version)
    print(json.dumps({
        "indexed_chunks": count,
        "won_version": won_version,
    }, indent=2))


def cmd_kb_stats(args):
    """Handle KB stats command — get local KB store statistics."""
    from .kb_local import get_stats

    stats = get_stats()
    print(json.dumps(stats, indent=2))


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

    # KB Query command
    kb_query_parser = subparsers.add_parser("kb-query", help="Query KB docs/release notes")
    kb_query_parser.add_argument("--input", default="-", help="JSON input (or '-' for stdin)")
    kb_query_parser.set_defaults(func=cmd_kb_query)

    # KB Test command
    kb_test_parser = subparsers.add_parser("kb-test", help="Test OpenSearch connectivity")
    kb_test_parser.add_argument("--input", default="-", help="JSON input (or '-' for stdin)")
    kb_test_parser.set_defaults(func=cmd_kb_test)

    # KB Indices command
    kb_indices_parser = subparsers.add_parser("kb-indices", help="List available KB indices")
    kb_indices_parser.add_argument("--input", default="-", help="JSON input (or '-' for stdin)")
    kb_indices_parser.set_defaults(func=cmd_kb_indices)

    # KB Import command
    kb_import_parser = subparsers.add_parser("kb-import", help="Import local KB HTML files")
    kb_import_parser.add_argument("--input", default="-", help="JSON input (or '-' for stdin)")
    kb_import_parser.set_defaults(func=cmd_kb_import)

    # KB Stats command
    kb_stats_parser = subparsers.add_parser("kb-stats", help="Get local KB store statistics")
    kb_stats_parser.set_defaults(func=cmd_kb_stats)

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
