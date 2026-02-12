"""
Text chunking utilities for crash logs and analyses.

Adapted from: chatgpt-retrieval-plugin/services/chunks.py
"""

import re
import json
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

# Try to import tiktoken, fall back to simple splitting if not available
try:
    import tiktoken
    TOKENIZER = tiktoken.get_encoding("cl100k_base")
    HAS_TIKTOKEN = True
except ImportError:
    TOKENIZER = None
    HAS_TIKTOKEN = False
    logger.warning("tiktoken not available, using character-based chunking")

# Configuration
CHUNK_SIZE = 500  # Tokens (larger for crash logs)
MIN_CHUNK_SIZE_CHARS = 200
MIN_CHUNK_LENGTH_TO_EMBED = 10
MAX_CHUNKS = 50


def count_tokens(text: str) -> int:
    """Count tokens in text."""
    if HAS_TIKTOKEN:
        return len(TOKENIZER.encode(text, disallowed_special=()))
    return len(text) // 4  # Rough approximation


def chunk_text_by_tokens(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = 50,
) -> List[str]:
    """
    Split text into chunks by token count.

    Args:
        text: Text to chunk
        chunk_size: Target size in tokens
        overlap: Number of tokens to overlap between chunks

    Returns:
        List of text chunks
    """
    if not text or not text.strip():
        return []

    if HAS_TIKTOKEN:
        tokens = TOKENIZER.encode(text, disallowed_special=())
        chunks = []
        start = 0

        while start < len(tokens) and len(chunks) < MAX_CHUNKS:
            end = min(start + chunk_size, len(tokens))
            chunk_tokens = tokens[start:end]
            chunk_text = TOKENIZER.decode(chunk_tokens).strip()

            if len(chunk_text) >= MIN_CHUNK_LENGTH_TO_EMBED:
                chunks.append(chunk_text)

            start = end - overlap if end < len(tokens) else end

        return chunks
    else:
        # Fallback: character-based chunking
        char_chunk_size = chunk_size * 4  # Approximate
        char_overlap = overlap * 4
        chunks = []
        start = 0

        while start < len(text) and len(chunks) < MAX_CHUNKS:
            end = min(start + char_chunk_size, len(text))
            chunk = text[start:end].strip()

            if len(chunk) >= MIN_CHUNK_LENGTH_TO_EMBED:
                chunks.append(chunk)

            start = end - char_overlap if end < len(text) else end

        return chunks


def chunk_crash_log(content: str, chunk_size: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Chunk a crash log into semantic sections.

    Strategy:
    1. Try to identify and preserve stack trace as single chunk
    2. Preserve error message section
    3. Chunk remaining content by tokens

    Args:
        content: Crash log content
        chunk_size: Optional custom chunk size in tokens

    Returns:
        List of chunk dicts with 'content' and 'chunk_type'
    """
    size = chunk_size or CHUNK_SIZE
    chunks = []

    # Pattern to identify stack trace section
    stack_patterns = [
        r"(Stack:.*?)(?=\n\n|\nEnvironment:|\nMemory:|\Z)",
        r"(Traceback.*?)(?=\n\n|\Z)",
        r"(at [\w.$]+\(.*?\)\n)+",
    ]

    remaining = content

    # Try to extract stack trace
    for pattern in stack_patterns:
        match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
        if match:
            stack_trace = match.group(0).strip()
            if len(stack_trace) >= MIN_CHUNK_LENGTH_TO_EMBED:
                chunks.append({
                    "content": stack_trace,
                    "chunk_type": "stack_trace"
                })
                remaining = content[:match.start()] + content[match.end():]
            break

    # Extract error message (usually at the beginning)
    error_match = re.search(
        r"(Error:.*?(?:\n|$)|Exception:.*?(?:\n|$)|MessageNotUnderstood:.*?(?:\n|$))",
        content,
        re.IGNORECASE
    )
    if error_match:
        error_section = error_match.group(0).strip()
        if len(error_section) >= MIN_CHUNK_LENGTH_TO_EMBED:
            chunks.append({
                "content": error_section,
                "chunk_type": "error_message"
            })

    # Chunk remaining content
    if remaining.strip():
        text_chunks = chunk_text_by_tokens(remaining, size)
        for i, text in enumerate(text_chunks):
            chunks.append({
                "content": text,
                "chunk_type": f"content_{i}"
            })

    return chunks


def chunk_analysis(analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Create retrieval chunks from a completed analysis.

    Creates targeted chunks for different retrieval scenarios:
    1. Solution chunk: root_cause + suggested_fixes (primary retrieval target)
    2. Full analysis chunk: complete JSON for detailed context

    Args:
        analysis: Analysis dict with root_cause, suggested_fixes, etc.

    Returns:
        List of chunk dicts with content, chunk_type, and metadata
    """
    chunks = []

    # Extract metadata for all chunks
    metadata = {
        "error_type": analysis.get("error_type"),
        "component": analysis.get("component"),
        "severity": analysis.get("severity"),
        "source_id": analysis.get("id"),
        "source_type": "analysis",
    }

    # Chunk 1: Root cause + suggested fixes (primary retrieval target)
    root_cause = analysis.get("root_cause", "")
    fixes = analysis.get("suggested_fixes", [])

    if isinstance(fixes, str):
        try:
            fixes = json.loads(fixes)
        except (json.JSONDecodeError, ValueError):
            fixes = [fixes] if fixes else []

    if root_cause or fixes:
        solution_content = f"Root Cause: {root_cause}\n\n"
        if fixes:
            solution_content += "Suggested Fixes:\n"
            for i, fix in enumerate(fixes, 1):
                solution_content += f"{i}. {fix}\n"

        chunks.append({
            "content": solution_content.strip(),
            "chunk_type": "solution",
            "metadata": metadata
        })

    # Chunk 2: Full analysis JSON (for detailed retrieval)
    # Only include key fields to keep size manageable
    full_data = {
        "error_type": analysis.get("error_type"),
        "error_message": analysis.get("error_message"),
        "severity": analysis.get("severity"),
        "component": analysis.get("component"),
        "root_cause": root_cause,
        "suggested_fixes": fixes,
    }

    full_content = json.dumps(full_data, indent=2)
    if len(full_content) >= MIN_CHUNK_LENGTH_TO_EMBED:
        chunks.append({
            "content": full_content,
            "chunk_type": "full_analysis",
            "metadata": metadata
        })

    return chunks
