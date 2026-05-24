"""Structured logging for silently-handled exceptions.

Use `log_silent_error(context, error, **extra)` inside an `except` block where
the failure is intentionally swallowed for UX reasons (e.g. fallback path,
optional enrichment, freshness probe) but you'd still want a paper trail in
Railway logs / Sentry when patterns emerge.

The contract mirrors the frontend's `logSilentError` (frontend/src/utils/
observability.js) — same naming, same call shape — so a Compare-flow style
bug that previously went invisible can be triaged across the stack with one
search ("silent_error" or the specific `context` string).

Logs at WARNING level — visible in Railway by default without polluting INFO
streams. Cheap; no I/O off the worker. If we later wire Sentry, this is the
single chokepoint to point at it.
"""

import logging
from typing import Any

_log = logging.getLogger("contour.silent")


def log_silent_error(context: str, error: BaseException, **extra: Any) -> None:
    """Log a silently-handled exception with a stable context string.

    Args:
        context: short, stable string identifying the call site. Use the
            same convention as analytics events (snake_case with surface
            prefix, e.g. "apple_music_album_meta_spotify_fetch").
        error: the caught exception. Type + message are extracted; the
            full traceback is logged at DEBUG only to keep WARNING
            volume manageable.
        **extra: any additional structured context (entity_id, etc.) —
            included as KV in the log line.
    """
    extras = " ".join(f"{k}={v!r}" for k, v in extra.items())
    _log.warning(
        "silent_error context=%s error_type=%s error=%s %s",
        context,
        type(error).__name__,
        error,
        extras,
    )
    # Full traceback at DEBUG so it's available when running locally with
    # LOG_LEVEL=DEBUG but doesn't bloat production WARNING logs.
    _log.debug("silent_error traceback for context=%s", context, exc_info=error)
