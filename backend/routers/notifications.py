"""In-app notifications — follow, upvote, reply, mention.

This module also owns the push-notification register / preferences API
on the same /notifications prefix. Push fanout is triggered from
`create_notification` (the same helper other routers already call) so
adding a new in-app notification type automatically pushes too —
provided the recipient hasn't opted out via /notifications/preferences.
"""

import json as _json
from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import DeviceToken, Notification, User, Review
from routers.auth import decode_jwt
from services import push_sender

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Source of truth for which notification types can be toggled. Adding a
# new type means adding a string here AND the corresponding branch in
# services/push_sender.py's _short_body / _TYPE_TITLES.
NOTIFICATION_TYPES = ("follow", "upvote", "reply", "mention")


def _require_user(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_jwt(authorization[7:])


@router.get("")
async def get_notifications(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Return the 40 most recent notifications for the authenticated user."""
    user_id = _require_user(authorization)

    rows = (await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(40)
    )).scalars().all()

    if not rows:
        return []

    # Fetch actor info in bulk
    actor_ids = list({n.actor_id for n in rows})
    actors = (await db.execute(
        select(User).where(User.id.in_(actor_ids))
    )).scalars().all()
    actor_map = {u.id: {"id": u.id, "display_name": u.display_name, "image_url": u.image_url} for u in actors}

    # Fetch review context (entity_type / entity_id) for upvote/reply notifications
    review_ids = [n.review_id for n in rows if n.review_id is not None]
    review_map: dict = {}
    if review_ids:
        reviews = (await db.execute(
            select(Review).where(Review.id.in_(review_ids))
        )).scalars().all()
        review_map = {r.id: r for r in reviews}

    out = []
    for n in rows:
        review = review_map.get(n.review_id) if n.review_id else None
        out.append({
            "id": n.id,
            "type": n.type,
            "read": n.read,
            "created_at": n.created_at.isoformat() + "Z",
            "actor": actor_map.get(n.actor_id),
            "review_id": n.review_id,
            "entity_type": review.entity_type if review else n.entity_type,
            "entity_id": review.entity_id if review else n.entity_id,
        })

    return out


@router.get("/unread-count")
async def unread_count(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Lightweight endpoint — just returns the unread notification count."""
    user_id = _require_user(authorization)
    count = (await db.execute(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user_id, Notification.read == False)  # noqa: E712
    )).scalar()
    return {"count": count}


@router.post("/read-all")
async def mark_all_read(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read."""
    user_id = _require_user(authorization)
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read == False)  # noqa: E712
        .values(read=True)
    )
    await db.commit()
    return {"ok": True}


# ── Helper used by other routers ─────────────────────────────────────────────

async def create_notification(
    db: AsyncSession,
    *,
    user_id: str,
    type: str,
    actor_id: str,
    review_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> None:
    """Create a notification. Silently no-ops if user_id == actor_id.

    Also fires a push notification for the same event — fire-and-forget,
    so it doesn't block the calling request. The push sender consults the
    recipient's `notification_prefs` JSON and skips opted-out types
    itself; no need to pre-filter here.

    Push fans out to ALL device tokens the recipient has registered —
    multi-device users (phone + iPad, account-switch scenarios) all hear
    about it at once.
    """
    if user_id == actor_id:
        return

    # Type-specific dedup. The semantics differ by event:
    #
    #   follow: ONE notification per (recipient, actor) pair, ever. The
    #     event's meaning is "this person is now following you" — once
    #     delivered, a re-follow adds no new signal. Without this,
    #     a friend tapping Follow → Unfollow → Follow rapidly creates
    #     2+ rows AND fires 2+ pushes for the same final state.
    #     (Reported 2026-05-27 by Peyton: one follower showed up twice
    #     in the bell.)
    #
    #   upvote: ONE notification per (recipient, actor, review_id). Same
    #     reasoning — toggling an upvote off and back on doesn't deserve
    #     a fresh ping. Capping by review_id (not just actor) so an
    #     upvoter who hits several of your reviews still pings once
    #     per review.
    #
    #   reply / mention: NO dedup. Each reply is a separate authored
    #     piece of content and a separate event. Same for mentions —
    #     someone @-tagging you twice in different reviews should ping
    #     twice.
    #
    # Application-level dedup has a theoretical race (two requests
    # interleave between the SELECT and the INSERT). Acceptable here:
    # the worst case is two rows for one event, the realistic-case
    # repeat-tap pattern is fully covered, and a unique partial index
    # would need a migration we don't need to ship today.
    if type == "follow":
        existing = (await db.execute(
            select(Notification.id).where(
                Notification.user_id == user_id,
                Notification.type == "follow",
                Notification.actor_id == actor_id,
            ).limit(1)
        )).scalar_one_or_none()
        if existing is not None:
            return
    elif type == "upvote" and review_id is not None:
        existing = (await db.execute(
            select(Notification.id).where(
                Notification.user_id == user_id,
                Notification.type == "upvote",
                Notification.actor_id == actor_id,
                Notification.review_id == review_id,
            ).limit(1)
        )).scalar_one_or_none()
        if existing is not None:
            return

    db.add(Notification(
        user_id=user_id,
        type=type,
        actor_id=actor_id,
        review_id=review_id,
        entity_type=entity_type,
        entity_id=entity_id,
    ))
    # Caller is responsible for the DB commit; the push send doesn't need
    # the commit to have landed (it queries by user_id, not by the just-
    # inserted Notification row), so we can schedule it immediately.
    push_sender.send_for_notification(
        recipient_user_id=user_id,
        actor_user_id=actor_id,
        n_type=type,
        review_id=review_id,
        entity_type=entity_type,
        entity_id=entity_id,
    )


# ── Push token registration ──────────────────────────────────────────────────


class RegisterTokenBody(BaseModel):
    token: str
    platform: Literal["ios", "android"]


class PushTraceBody(BaseModel):
    state: str
    detail: Optional[str] = None


def _bucket_from_detail(detail: Optional[str]) -> str:
    """Pick which Redis bucket the trace goes in: native vs web. The
    client encodes `plat=ios|android|web` and `native=true|false` in the
    detail string (see pushNotifications.js::_writeDiag). Storing them
    separately so a web/Firefox check doesn't overwrite the iOS trace
    (which is the only one we actually care about for diagnosing push)."""
    if not detail:
        return "unknown"
    if "plat=ios" in detail or "plat=android" in detail or "native=true" in detail:
        return "native"
    if "plat=web" in detail or "native=false" in detail:
        return "web"
    return "unknown"


@router.post("/push-trace")
async def push_trace(
    body: PushTraceBody,
    authorization: Optional[str] = Header(None),
):
    """Receive a push-registration breadcrumb from the iOS / Android app.
    Stored in Redis under push_trace:{user_id}:{bucket} (bucket = native
    or web) with 24h TTL so we can diagnose "I'm not getting
    notifications" reports without needing Xcode debugger access.

    Each branch of the registration flow on the client posts here with a
    state token: plugin_loaded, perm_returned, register_called,
    reg_event_received, token_post_success, etc. Within a bucket, latest
    state wins (overwrites the key). ACROSS buckets the keys are
    separate — important because the iOS app's interesting trace
    sequence (plugin_loaded → register_called → ...) used to get
    trampled when the user opened contour-rosy.vercel.app from a
    desktop browser, which always posts skip_non_native.

    Read back via GET /notifications/diagnostic which returns both
    latest_native_trace and latest_web_trace.
    """
    user_id = _require_user(authorization)
    from datetime import datetime
    from services import redis_cache
    bucket = _bucket_from_detail(body.detail)
    record = {
        "state": body.state,
        "at": datetime.utcnow().isoformat() + "Z",
        "detail": body.detail,
        "bucket": bucket,
    }
    try:
        await redis_cache.set(f"push_trace:{user_id}:{bucket}", record, ttl=86400)
    except Exception:
        # Redis is best-effort — losing a breadcrumb is acceptable. The
        # localStorage write on the client is the durable copy.
        pass
    return {"ok": True}


@router.post("/register-token")
async def register_token(
    body: RegisterTokenBody,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Register or refresh a push token for the authenticated user.

    Same token registered twice = idempotent UPDATE last_seen. Same token
    under a different user (account switch on one device) = steals
    ownership to the new user_id so the old user stops receiving pushes
    on a device they're no longer signed into.
    """
    user_id = _require_user(authorization)
    token = body.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Empty token")

    from datetime import datetime
    existing = (await db.execute(
        select(DeviceToken).where(DeviceToken.token == token)
    )).scalar_one_or_none()
    if existing:
        existing.user_id = user_id
        existing.platform = body.platform
        existing.last_seen = datetime.utcnow()
    else:
        db.add(DeviceToken(
            user_id=user_id, token=token, platform=body.platform,
        ))
    await db.commit()
    return {"ok": True}


class UnregisterTokenBody(BaseModel):
    token: str


@router.post("/unregister-token")
async def unregister_token(
    body: UnregisterTokenBody,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Drop a push token. Called from the iOS app when the user signs out
    or revokes notification permission. Tolerates unknown tokens (no-op
    so the client doesn't have to track whether registration succeeded)."""
    user_id = _require_user(authorization)
    await db.execute(
        delete(DeviceToken).where(
            DeviceToken.token == body.token.strip(),
            DeviceToken.user_id == user_id,
        )
    )
    await db.commit()
    return {"ok": True}


# ── Notification preferences ─────────────────────────────────────────────────


def _default_prefs() -> dict:
    return {t: True for t in NOTIFICATION_TYPES}


def _load_prefs(stored: str | None) -> dict:
    """Read a user's stored prefs into a dense dict. Missing keys default
    to True (opt-in by default). Tolerates malformed JSON / wrong shape."""
    prefs = _default_prefs()
    if not stored:
        return prefs
    try:
        loaded = _json.loads(stored)
        if isinstance(loaded, dict):
            for t in NOTIFICATION_TYPES:
                v = loaded.get(t)
                if isinstance(v, bool):
                    prefs[t] = v
    except Exception:
        pass
    return prefs


@router.get("/preferences")
async def get_preferences(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Return per-type push toggles for the authenticated user. Always
    returns a dense dict — missing-from-storage keys default to True."""
    user_id = _require_user(authorization)
    user = (await db.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _load_prefs(user.notification_prefs)


class PreferencesBody(BaseModel):
    follow: Optional[bool] = None
    upvote: Optional[bool] = None
    reply: Optional[bool] = None
    mention: Optional[bool] = None


@router.put("/preferences")
async def update_preferences(
    body: PreferencesBody,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Partial update. Pass only the toggles the user is changing."""
    user_id = _require_user(authorization)
    user = (await db.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    current = _load_prefs(user.notification_prefs)
    updates = body.model_dump(exclude_none=True)
    current.update(updates)
    user.notification_prefs = _json.dumps(current)
    await db.commit()
    return current


@router.get("/diagnostic")
async def push_diagnostic(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Diagnostic for the authenticated user's push-notification state.
    Surfaces every failure point in the follow → push pipeline so a user
    who reports "I didn't get a push" can have it resolved in one curl
    instead of a Railway log dig. Reports:

      • Server-side push config: whether APNs env vars are all set
        (without this, no push fires for anyone regardless of prefs/
        tokens).
      • Device tokens: count + last-seen timestamp per token. If 0,
        the iOS app never called POST /notifications/register-token —
        possibly the user didn't grant push permission, or the
        register call failed silently.
      • Notification prefs: each type's enabled state (follow / upvote
        / reply / mention). If the type the user expected to push is
        false, the push is correctly skipped by design.
      • Recent notification count: how many Notification rows exist
        for this user, broken down by type. Lets us confirm that the
        in-app notification IS being created (i.e., the bug is purely
        in the push leg, not the create leg).
    """
    user_id = _require_user(authorization)
    user = (await db.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from services.push_sender import _config_ok as _push_config_ok
    server_push_ok = _push_config_ok()

    tokens = (await db.execute(
        select(DeviceToken).where(DeviceToken.user_id == user_id)
    )).scalars().all()
    token_summary = [
        {
            "platform": t.platform,
            "token_prefix": (t.token[:12] + "…") if t.token else None,
            "created_at": t.created_at.isoformat() + "Z" if t.created_at else None,
        }
        for t in tokens
    ]

    prefs = _load_prefs(user.notification_prefs)

    # In-app notifications for this user, last 50 rows, by type.
    notif_rows = (await db.execute(
        select(Notification.type, func.count(Notification.id))
        .where(Notification.user_id == user_id)
        .group_by(Notification.type)
    )).all()
    notif_counts = {row[0]: int(row[1]) for row in notif_rows}

    # Latest push-registration breadcrumb from the client, split by
    # platform bucket so a desktop browser check doesn't trample the
    # iOS app's trace. Posted via /notifications/push-trace from
    # pushNotifications.js on each branch of the iOS register flow.
    # Surfaces the EXACT failure mode without needing Xcode console
    # access — e.g. plugin_loaded then nothing means register never
    # fired; perm_not_granted with detail receive=denied means the
    # user has to flip the iOS Settings toggle; etc. See
    # pushNotifications.js for the full state list.
    from services import redis_cache
    native_trace = None
    web_trace = None
    legacy_trace = None
    try:
        native_trace = await redis_cache.get(f"push_trace:{user_id}:native")
    except Exception:
        pass
    try:
        web_trace = await redis_cache.get(f"push_trace:{user_id}:web")
    except Exception:
        pass
    try:
        # Old single-key format from the first push-trace deploy. Read
        # and surface so an in-flight diagnosis doesn't lose history
        # while clients on stale bundles still post to the old key.
        legacy_trace = await redis_cache.get(f"push_trace:{user_id}")
    except Exception:
        pass

    return {
        "server_push_configured": server_push_ok,
        "device_tokens": {
            "count": len(tokens),
            "samples": token_summary[:5],
        },
        "preferences": prefs,
        "in_app_notifications_by_type": notif_counts,
        "latest_native_trace": native_trace,
        "latest_web_trace": web_trace,
        "latest_legacy_trace": legacy_trace,
        "verdict": (
            "Push fully wired" if (server_push_ok and tokens and prefs.get("follow", True))
            else "Push will NOT fire — " + (
                "server APNs config missing" if not server_push_ok
                else "no device tokens registered (iOS app didn't call /notifications/register-token)" if not tokens
                else "user opted out of 'follow' notifications in preferences"
            )
        ),
    }
