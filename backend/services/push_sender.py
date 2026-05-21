"""APNs HTTP/2 push sender.

Sends a single push notification per device token. Self-contained — no
3rd-party APNs library, just `httpx` (HTTP/2) + `PyJWT` (ES256 signing).

Configuration via env vars on Railway:
  APNS_TEAM_ID      — 10-char Apple Developer Team ID
  APNS_KEY_ID       — 10-char APNs auth key ID (from the .p8 file name)
  APNS_PRIVATE_KEY  — full contents of the .p8 file (-----BEGIN…-----END)
                      Newlines must be preserved. Railway env vars handle
                      multi-line values fine; check Railway → Variables →
                      "Raw Editor" if pasting fails.
  APNS_BUNDLE_ID    — iOS app bundle identifier (the apns-topic header)
  APNS_USE_SANDBOX  — "true" while testing via TestFlight / Codemagic
                      builds; "false" or unset for App Store production.

If any of the required vars are missing the sender SILENTLY no-ops with a
single startup-log warning. In-app notifications continue working — only
the push fanout degrades. This lets us merge the code to master without
breaking anything before the APNs key is provisioned.

Operationally:
  - JWT cached for 50 min (APNs accepts up to 60 min); refresh on miss.
  - 410 Gone from APNs → delete the token row from device_tokens.
  - 4xx other than 410 → log + drop the push (don't retry).
  - 5xx / connection error → log + drop. APNs has its own retry/queue;
    we don't keep our own.

We intentionally do NOT block on the APNs response when called from the
notification fanout path — see `send_for_notification` which schedules
the actual delivery as an asyncio.create_task so the user-facing request
returns immediately.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Iterable, Optional

import httpx
import jwt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import DeviceToken, User

logger = logging.getLogger(__name__)


# ── Config ───────────────────────────────────────────────────────────────────


def _env(name: str) -> str | None:
    v = os.environ.get(name)
    return v.strip() if v else None


def _config_ok() -> bool:
    return all(
        _env(k) for k in ("APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY", "APNS_BUNDLE_ID")
    )


def _apns_base_url() -> str:
    # api.sandbox is for development builds (TestFlight included until App
    # Store release per Apple's docs). api.push is for App Store release.
    sandbox = (_env("APNS_USE_SANDBOX") or "true").lower() in ("1", "true", "yes")
    return (
        "https://api.sandbox.push.apple.com"
        if sandbox
        else "https://api.push.apple.com"
    )


# ── JWT (ES256) ──────────────────────────────────────────────────────────────

_jwt_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


def _make_apns_jwt() -> str | None:
    """Mint or return the cached APNs auth JWT. None if config missing."""
    if not _config_ok():
        return None
    now = time.time()
    cached = _jwt_cache.get("token")
    if cached and now < _jwt_cache.get("expires_at", 0):
        return cached
    team_id = _env("APNS_TEAM_ID")
    key_id = _env("APNS_KEY_ID")
    private_key = _env("APNS_PRIVATE_KEY")
    # ES256 requires the PyJWT[crypto] extras — `cryptography` package
    # provides the underlying signing. The crypto package is pinned in
    # requirements.txt as a peer of PyJWT.
    token = jwt.encode(
        {"iss": team_id, "iat": int(now)},
        private_key,
        algorithm="ES256",
        headers={"kid": key_id},
    )
    # APNs accepts tokens up to ~1h. Refresh at 50 min to stay safe.
    _jwt_cache["token"] = token
    _jwt_cache["expires_at"] = now + 50 * 60
    return token


# ── Shared HTTP/2 client ─────────────────────────────────────────────────────

_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    """Lazily build a single HTTP/2 AsyncClient. APNs requires HTTP/2 —
    `http2=True` here depends on the `h2` package being installed (added
    to requirements.txt alongside this module)."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(http2=True, timeout=10.0)
    return _client


async def shutdown() -> None:
    """Close the HTTP/2 client on app shutdown. Optional — called from
    main.py's shutdown hook if registered."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ── Send path ────────────────────────────────────────────────────────────────


def _build_payload(*, title: str, body: str, extra: dict) -> dict:
    """Standard APNs JSON payload. `extra` lives at the top level so the
    iOS app can branch on type + route on tap.

    `mutable-content: 1` opens the door to a Notification Service Extension
    later (rich media, server-decrypted text, etc.) — we don't ship one
    today but the flag is cheap to set."""
    return {
        "aps": {
            "alert": {"title": title, "body": body},
            "sound": "default",
            "mutable-content": 1,
        },
        **extra,
    }


async def _send_one(
    db: AsyncSession,
    *,
    token: str,
    payload: dict,
    push_type: str = "alert",
) -> None:
    """Push to a single token. Drops the token row on 410 Gone."""
    jwt_token = _make_apns_jwt()
    if not jwt_token:
        return
    bundle_id = _env("APNS_BUNDLE_ID")
    headers = {
        "authorization": f"bearer {jwt_token}",
        "apns-topic": bundle_id,
        "apns-push-type": push_type,
        "apns-priority": "10",
        # apns-expiration 0 = deliver immediately, drop if device offline.
        # For social notifications this is the right default; we don't want
        # a 12-hour-stale "X replied to your review" landing tomorrow.
        "apns-expiration": "0",
    }
    url = f"{_apns_base_url()}/3/device/{token}"

    try:
        resp = await _get_client().post(url, headers=headers, content=json.dumps(payload))
    except httpx.HTTPError as exc:
        logger.warning("APNs send failed (network): %s", exc)
        return

    if resp.status_code == 200:
        return

    if resp.status_code == 410:
        # Apple has invalidated this token — uninstalled app, expired,
        # rotated. Best to drop it so we don't keep retrying.
        await db.execute(delete(DeviceToken).where(DeviceToken.token == token))
        await db.commit()
        logger.info("APNs 410 — dropped stale token %s…", token[:8])
        return

    # Other 4xx / 5xx — log + drop. APNs has its own retry queue; we don't
    # mirror one. The response body is JSON like {"reason": "BadDeviceToken"}.
    try:
        detail = resp.json()
    except Exception:
        detail = resp.text[:200]
    logger.warning("APNs %d for token %s…: %s", resp.status_code, token[:8], detail)


# ── Public entry from create_notification ────────────────────────────────────


_TYPE_TITLES = {
    "follow": "New follower",
    "upvote": "Your review got an upvote",
    "reply": "New reply",
    "mention": "You were mentioned",
}


def _short_body(actor_display_name: str, n_type: str) -> str:
    name = actor_display_name or "Someone"
    if n_type == "follow":
        return f"{name} started following you"
    if n_type == "upvote":
        return f"{name} upvoted your review"
    if n_type == "reply":
        return f"{name} replied to your review"
    if n_type == "mention":
        return f"{name} mentioned you"
    return f"{name} did something on Contour"


def _prefs_allow(prefs_json: str | None, n_type: str) -> bool:
    """User opted into push for `n_type`? Default = True for every type.
    Only an explicit `{"<type>": false}` opts out."""
    if not prefs_json:
        return True
    try:
        prefs = json.loads(prefs_json)
    except Exception:
        return True
    if not isinstance(prefs, dict):
        return True
    return prefs.get(n_type, True) is not False


async def _do_send_for_notification(
    *,
    recipient_user_id: str,
    actor_user_id: str,
    n_type: str,
    review_id: int | None,
    entity_type: str | None,
    entity_id: str | None,
) -> None:
    """Owns its own DB session so it's safe to run as a fire-and-forget
    asyncio.create_task from the request handler. Querying both the
    recipient (for prefs) and their tokens (for fanout) — then sending
    in parallel.
    """
    if not _config_ok():
        return
    async with AsyncSessionLocal() as db:
        recipient = (await db.execute(
            select(User).where(User.id == recipient_user_id)
        )).scalar_one_or_none()
        if recipient is None:
            return
        if not _prefs_allow(recipient.notification_prefs, n_type):
            return

        actor = (await db.execute(
            select(User).where(User.id == actor_user_id)
        )).scalar_one_or_none()
        actor_name = actor.display_name if actor else "Someone"

        tokens = (await db.execute(
            select(DeviceToken).where(DeviceToken.user_id == recipient_user_id)
        )).scalars().all()
        if not tokens:
            return

        payload = _build_payload(
            title=_TYPE_TITLES.get(n_type, "Contour"),
            body=_short_body(actor_name, n_type),
            extra={
                # Used by the iOS app's notification-tap handler to deep
                # link into the right entity / review.
                "type": n_type,
                "actor_id": actor_user_id,
                "review_id": review_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
            },
        )

        # Send to every device in parallel; each call individually
        # catches exceptions so one bad token doesn't poison the rest.
        await asyncio.gather(
            *[_send_one(db, token=t.token, payload=payload) for t in tokens],
            return_exceptions=True,
        )


def send_for_notification(
    *,
    recipient_user_id: str,
    actor_user_id: str,
    n_type: str,
    review_id: int | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> None:
    """Fire-and-forget push send. Schedules the real work on the event
    loop and returns immediately — the user-facing HTTP request that
    triggered the notification doesn't pay the cost of a TLS handshake +
    HTTP/2 round-trip to Apple.

    Safe to call from sync or async contexts; if no loop is running
    (test path / standalone script) it's a no-op. The strong-ref pattern
    avoids the 'Task was destroyed but it is pending' GC bug — we don't
    need the result so leaking the task ref to the event loop is fine,
    but we do `add_done_callback` to surface exceptions in logs.
    """
    if not _config_ok():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_do_send_for_notification(
        recipient_user_id=recipient_user_id,
        actor_user_id=actor_user_id,
        n_type=n_type,
        review_id=review_id,
        entity_type=entity_type,
        entity_id=entity_id,
    ))
    def _log_exc(t: asyncio.Task) -> None:
        if t.cancelled():
            return
        exc = t.exception()
        if exc:
            logger.warning("push_sender task failed: %s", exc)
    task.add_done_callback(_log_exc)


def warn_if_disabled() -> None:
    """Called from main.py startup. Emits a single warning line if APNs
    config is incomplete so we have a clear signal in the Railway logs
    that pushes are not currently flowing."""
    if not _config_ok():
        missing = [k for k in (
            "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY", "APNS_BUNDLE_ID"
        ) if not _env(k)]
        logger.warning(
            "Push notifications DISABLED — missing env vars: %s",
            ", ".join(missing),
        )
