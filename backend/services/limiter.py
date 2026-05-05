"""Shared slowapi rate-limiter instance imported by main.py and routers."""
from slowapi import Limiter
from slowapi.util import get_remote_address


def _real_ip(request) -> str:
    """
    Return the genuine client IP even when behind Railway's reverse proxy.
    Railway sets X-Forwarded-For to the real client IP; fall back to the
    direct connection address if the header is absent (local dev).
    """
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(key_func=_real_ip)
