"""@-mention parsing + resolution.

Pure server-side: takes a free-text body, extracts @-tokens, resolves them
case-insensitively against the User table (display_name is unique per the
y5z6a7b8c9d0 migration), and returns the resulting user IDs. Used at write
time on reviews and review replies — see routers/ratings.py.

Why the regex doesn't allow spaces in mention tokens: display names can
contain spaces (the auth.py PATCH validator allows `[A-Za-z0-9 _.-]`), but
a bare `@name with space` is ambiguous to parse — when does the mention
end? For the MVP we accept only space-free tokens, which covers ~all
real-world social handles. Users whose display name has spaces can still
be referenced via the frontend autocomplete picking them directly (the
frontend can post the resolved ID alongside the body), but for now we
parse-on-write from the body alone. Document the limitation in the UI.

Storage shape (Review.mention_user_ids, ReviewReply.mention_user_ids):
  JSON-encoded list[str] of user IDs in first-appearance order.
  Null / missing = no mentions.
"""

import json
import re
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import User


# Token: starts with letter/digit/underscore (so `@-foo` doesn't match);
# total length 2–30 (matches the display_name validator in auth.py);
# trailing lookahead ensures we don't grab a partial of a longer token
# like `peyton.dev` when the user typed `@peyton`.
#
# Leading group captures the char (or empty start) BEFORE the @ so the
# regex doesn't match emails (`foo@bar` won't match because `o` is in
# the allowed-prefix-block class).
_MENTION_RE = re.compile(
    r"(^|[^A-Za-z0-9_.\-])"           # boundary: start or non-name char
    r"@([A-Za-z0-9_][A-Za-z0-9_.\-]{1,29})"  # the token (group 2)
    r"(?![A-Za-z0-9_.\-])"            # no more name chars after
)


def extract_mention_tokens(body: str) -> list[str]:
    """Return the list of @-token strings (without the leading @), in
    order of first appearance, deduplicated case-insensitively.

    Pure function — no DB access. Use this when you want to know what
    the user TYPED; pair with `resolve_mentions` to map to user IDs.
    """
    if not body:
        return []
    seen_lower: set[str] = set()
    out: list[str] = []
    for m in _MENTION_RE.finditer(body):
        token = m.group(2)
        low = token.lower()
        if low in seen_lower:
            continue
        seen_lower.add(low)
        out.append(token)
    return out


async def resolve_combined_mentions(
    db: AsyncSession,
    body: str,
    *,
    client_user_ids: list[str] | None = None,
    exclude_user_id: str | None = None,
    max_mentions: int = 25,
) -> list[str]:
    """Resolve mentions from BOTH the explicit client-provided ID list
    AND a regex parse of `body`, returning the deduplicated union in
    stable order.

    The frontend autocomplete passes `client_user_ids` because the
    server-side regex can't handle multi-word display names (e.g.
    "@Adam Zhang" — the parser stops at the space). The autocomplete
    already knows the picked user's ID, so we just trust it after
    validating the user exists and isn't the actor.

    Bare typed @-tokens that the user did NOT pick via autocomplete
    still go through the regex path, so single-word mentions like
    `@peyton` keep working even without an explicit picked entry.
    """
    # 1. Regex-parse the body for single-word tokens (existing behavior).
    parsed = await resolve_mentions(
        db, body,
        exclude_user_id=exclude_user_id,
        max_mentions=max_mentions,
    )

    # 2. Validate the client-supplied IDs against the User table so a
    # malicious client can't poke arbitrary IDs into the list.
    validated_client: list[str] = []
    if client_user_ids:
        # Cap at max_mentions to defend against spam.
        unique_client = []
        seen: set[str] = set()
        for cid in client_user_ids:
            if not isinstance(cid, str) or not cid:
                continue
            if cid in seen:
                continue
            seen.add(cid)
            unique_client.append(cid)
            if len(unique_client) >= max_mentions:
                break
        if unique_client:
            real = (await db.execute(
                select(User.id).where(User.id.in_(unique_client))
            )).scalars().all()
            real_set = set(real)
            for cid in unique_client:
                if cid in real_set and cid != exclude_user_id:
                    validated_client.append(cid)

    # 3. Union in stable order: explicit picks first (they're the
    # primary source of truth — the user actually picked them via UI),
    # then any regex-only finds that the picks didn't already cover.
    out: list[str] = []
    seen: set[str] = set()
    for uid in validated_client + parsed:
        if uid in seen:
            continue
        seen.add(uid)
        out.append(uid)
        if len(out) >= max_mentions:
            break
    return out


async def resolve_mentions(
    db: AsyncSession,
    body: str,
    *,
    exclude_user_id: str | None = None,
    max_mentions: int = 25,
) -> list[str]:
    """Parse @-tokens out of `body`, look up matching users by
    case-insensitive display_name, and return the matched user IDs in
    first-appearance order.

    Unmatched tokens (no user with that name) are silently dropped — the
    UI will render the token as plain text. Caller passes the actor's
    own user ID via `exclude_user_id` so users can't @-mention themselves
    into a notification (a self-mention is fine in the rendered text;
    it just doesn't fan out a notification).

    `max_mentions` caps how many distinct users a single body can
    notify, defending against pathological "@everyone @everyone..." spam
    bodies. The first N tokens win.
    """
    tokens = extract_mention_tokens(body)
    if not tokens:
        return []
    tokens = tokens[:max_mentions]

    lowered = [t.lower() for t in tokens]
    rows = (await db.execute(
        select(User.id, User.display_name).where(
            func.lower(User.display_name).in_(lowered)
        )
    )).all()
    # display_name is case-insensitively unique post-migration, so each
    # lowered token maps to at most one user. Build the map and walk the
    # original token order to preserve "first appearance" semantics.
    by_lower = {dn.lower(): uid for uid, dn in rows}
    seen_ids: set[str] = set()
    out: list[str] = []
    for low in lowered:
        uid = by_lower.get(low)
        if uid is None:
            continue
        if uid == exclude_user_id:
            continue
        if uid in seen_ids:
            continue
        seen_ids.add(uid)
        out.append(uid)
    return out


def dump_ids(ids: Iterable[str]) -> str | None:
    """JSON-encode a list of user IDs for storage. Returns None for empty
    so the column stays NULL (cheaper to read, distinguishes "no
    mentions" from "empty list")."""
    ids = list(ids)
    if not ids:
        return None
    return json.dumps(ids)


def load_ids(stored: str | None) -> list[str]:
    """Read a stored mention_user_ids column back into a Python list.
    Tolerates None / malformed JSON / non-list values — returns [] in
    those cases so a corrupted row doesn't break a review render."""
    if not stored:
        return []
    try:
        v = json.loads(stored)
    except Exception:
        return []
    if not isinstance(v, list):
        return []
    return [str(x) for x in v if isinstance(x, (str, int))]
