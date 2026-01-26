"""
Hadron API Authentication
API key-based authentication for the REST API
"""

import os
import hashlib
import secrets
from typing import Optional
from datetime import datetime, timedelta

from fastapi import HTTPException, Security, Depends
from fastapi.security import APIKeyHeader, APIKeyQuery
from pydantic import BaseModel
from pydantic_settings import BaseSettings


# ============================================================================
# Configuration
# ============================================================================

class AuthSettings(BaseSettings):
    """Authentication settings from environment"""
    api_key_header: str = "X-API-Key"
    api_key_query: str = "api_key"
    api_keys_file: str = "api_keys.json"
    master_key_env: str = "HADRON_API_MASTER_KEY"
    allow_anonymous: bool = False
    rate_limit_per_minute: int = 60

    class Config:
        env_prefix = "HADRON_AUTH_"


settings = AuthSettings()


# ============================================================================
# API Key Storage
# ============================================================================

class APIKeyInfo(BaseModel):
    """API key metadata"""
    key_hash: str
    name: str
    created_at: datetime
    expires_at: Optional[datetime] = None
    permissions: list[str] = ["read", "analyze"]
    rate_limit: Optional[int] = None
    is_active: bool = True
    last_used: Optional[datetime] = None
    usage_count: int = 0


# In-memory key store (in production, use a database)
_api_keys: dict[str, APIKeyInfo] = {}
_rate_limits: dict[str, list[datetime]] = {}


def _hash_key(key: str) -> str:
    """Hash an API key for secure storage"""
    return hashlib.sha256(key.encode()).hexdigest()


def generate_api_key(
    name: str,
    permissions: list[str] = None,
    expires_days: Optional[int] = None,
    rate_limit: Optional[int] = None
) -> tuple[str, APIKeyInfo]:
    """Generate a new API key"""
    # Generate a secure random key
    key = f"hdk_{secrets.token_urlsafe(32)}"
    key_hash = _hash_key(key)

    expires_at = None
    if expires_days:
        expires_at = datetime.utcnow() + timedelta(days=expires_days)

    info = APIKeyInfo(
        key_hash=key_hash,
        name=name,
        created_at=datetime.utcnow(),
        expires_at=expires_at,
        permissions=permissions or ["read", "analyze"],
        rate_limit=rate_limit,
        is_active=True
    )

    _api_keys[key_hash] = info
    return key, info


def validate_api_key(key: str) -> Optional[APIKeyInfo]:
    """Validate an API key and return its info"""
    key_hash = _hash_key(key)

    info = _api_keys.get(key_hash)
    if not info:
        return None

    if not info.is_active:
        return None

    if info.expires_at and datetime.utcnow() > info.expires_at:
        return None

    # Update usage stats
    info.last_used = datetime.utcnow()
    info.usage_count += 1

    return info


def check_rate_limit(key_hash: str, limit: int) -> bool:
    """Check if key is within rate limit"""
    now = datetime.utcnow()
    minute_ago = now - timedelta(minutes=1)

    # Get or create rate limit tracker
    if key_hash not in _rate_limits:
        _rate_limits[key_hash] = []

    # Clean old entries
    _rate_limits[key_hash] = [t for t in _rate_limits[key_hash] if t > minute_ago]

    # Check limit
    if len(_rate_limits[key_hash]) >= limit:
        return False

    # Record this request
    _rate_limits[key_hash].append(now)
    return True


def revoke_api_key(key_hash: str) -> bool:
    """Revoke an API key"""
    if key_hash in _api_keys:
        _api_keys[key_hash].is_active = False
        return True
    return False


def list_api_keys() -> list[dict]:
    """List all API keys (without the actual keys)"""
    return [
        {
            "key_hash": k[:16] + "...",
            "name": v.name,
            "created_at": v.created_at.isoformat(),
            "expires_at": v.expires_at.isoformat() if v.expires_at else None,
            "permissions": v.permissions,
            "is_active": v.is_active,
            "usage_count": v.usage_count,
            "last_used": v.last_used.isoformat() if v.last_used else None
        }
        for k, v in _api_keys.items()
    ]


# ============================================================================
# FastAPI Dependencies
# ============================================================================

api_key_header = APIKeyHeader(name=settings.api_key_header, auto_error=False)
api_key_query = APIKeyQuery(name=settings.api_key_query, auto_error=False)


async def get_api_key(
    header_key: Optional[str] = Security(api_key_header),
    query_key: Optional[str] = Security(api_key_query)
) -> Optional[APIKeyInfo]:
    """Extract and validate API key from request"""

    # Check header first, then query param
    key = header_key or query_key

    # Check master key from environment
    master_key = os.environ.get(settings.master_key_env)
    if master_key and key == master_key:
        return APIKeyInfo(
            key_hash="master",
            name="Master Key",
            created_at=datetime.utcnow(),
            permissions=["read", "write", "analyze", "admin"],
            is_active=True
        )

    if not key:
        if settings.allow_anonymous:
            return None
        raise HTTPException(
            status_code=401,
            detail="API key required. Provide via X-API-Key header or api_key query parameter."
        )

    # Validate key
    info = validate_api_key(key)
    if not info:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired API key"
        )

    # Check rate limit
    limit = info.rate_limit or settings.rate_limit_per_minute
    if not check_rate_limit(info.key_hash, limit):
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded ({limit} requests/minute)"
        )

    return info


def require_permission(permission: str):
    """Dependency factory to require specific permission"""
    async def check_permission(
        api_key: Optional[APIKeyInfo] = Depends(get_api_key)
    ) -> APIKeyInfo:
        if not api_key:
            raise HTTPException(status_code=401, detail="Authentication required")

        if permission not in api_key.permissions and "admin" not in api_key.permissions:
            raise HTTPException(
                status_code=403,
                detail=f"Permission '{permission}' required"
            )

        return api_key

    return check_permission


# ============================================================================
# Initialize Default Keys
# ============================================================================

def init_default_keys():
    """Initialize default API keys for development"""
    # Development key (only if no keys exist and in dev mode)
    if not _api_keys and os.environ.get("HADRON_ENV", "development") == "development":
        key, info = generate_api_key(
            name="Development Key",
            permissions=["read", "write", "analyze"],
            rate_limit=1000
        )
        print(f"Generated development API key: {key}")
        print("Set HADRON_API_MASTER_KEY environment variable for production use.")


# Initialize on import in development
if os.environ.get("HADRON_ENV", "development") == "development":
    init_default_keys()
