"""
Keeper Secrets Manager SDK integration for Hadron API.

Resolves API keys (e.g., OpenAI) from Keeper Secrets Manager using the same
keeper-config.json that the Rust/Tauri frontend creates during token binding.
Falls back gracefully when the SDK is not installed or config is missing.
"""

import logging
import os
import platform
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# Lazy SDK import guard (matches RAG import pattern in main.py)
try:
    from keeper_secrets_manager_core import SecretsManager
    from keeper_secrets_manager_core.storage import FileKeyValueStorage
    _KSM_AVAILABLE = True
except ImportError:
    _KSM_AVAILABLE = False

# Module-level cache: {uid: (value, timestamp)}
_cache: Dict[str, Tuple[Optional[str], float]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 300  # 5 minutes, matching Rust's 300s


def get_keeper_config_path() -> Path:
    """
    Resolve platform-specific path to keeper-config.json.

    Matches Rust's dirs::data_dir().join("Hadron").join("keeper-config.json"):
      - Windows: %APPDATA%/Hadron/keeper-config.json
      - macOS:   ~/Library/Application Support/Hadron/keeper-config.json
      - Linux:   ~/.local/share/Hadron/keeper-config.json
    """
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif system == "Darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "Hadron" / "keeper-config.json"


def is_keeper_available() -> bool:
    """Check if Keeper SDK is importable AND config file exists on disk."""
    if not _KSM_AVAILABLE:
        return False
    config_path = get_keeper_config_path()
    return config_path.exists()


def get_secret_by_uid(uid: str) -> Optional[str]:
    """
    Retrieve a secret value from Keeper by record UID.

    Uses an in-memory cache with 5-minute TTL. Extracts the value using field
    priority matching keeper_service.rs:341-344:
      1. password (standard field)
      2. API Key (custom field)
      3. api_key (custom field)
      4. apiKey  (custom field)

    Never logs secret values, only UIDs/titles.
    """
    if not _KSM_AVAILABLE:
        return None

    now = time.monotonic()

    # Check cache
    with _cache_lock:
        if uid in _cache:
            value, ts = _cache[uid]
            if now - ts < _CACHE_TTL:
                logger.debug("Keeper cache hit for UID %s", uid)
                return value

    # Cache miss — fetch from Keeper
    config_path = get_keeper_config_path()
    if not config_path.exists():
        logger.warning("Keeper config not found at %s", config_path)
        return None

    try:
        storage = FileKeyValueStorage(config_file_location=str(config_path))
        sm = SecretsManager(config=storage)
        records = sm.get_secrets(uids=[uid])

        if not records:
            logger.warning("No Keeper record found for UID %s", uid)
            with _cache_lock:
                _cache[uid] = (None, now)
            return None

        record = records[0]
        value = _extract_secret_value(record)

        if value:
            logger.info("Resolved secret from Keeper record UID %s (title: %s)",
                        uid, record.title)
        else:
            logger.warning("No usable secret field in Keeper record UID %s", uid)

        with _cache_lock:
            _cache[uid] = (value, now)

        return value

    except Exception:
        logger.exception("Failed to fetch secret from Keeper for UID %s", uid)
        return None


def _extract_secret_value(record) -> Optional[str]:
    """
    Extract the secret value from a Keeper record using field priority:
      1. password (standard field)
      2. API Key / api_key / apiKey (custom fields)
    """
    # Try standard password field
    password = record.field("password", single=True)
    if password:
        return password

    # Try custom fields with known labels
    for label in ("API Key", "api_key", "apiKey"):
        try:
            value = record.custom_field(label, single=True)
            if value:
                return value
        except Exception:
            continue

    return None


def clear_cache() -> None:
    """Clear the in-memory secret cache."""
    with _cache_lock:
        _cache.clear()
    logger.debug("Keeper secret cache cleared")
