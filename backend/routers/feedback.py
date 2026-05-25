"""
User feedback endpoint → SMTP email to the operator.

POST /feedback accepts a short message + optional reply-to email and
sends a transactional email to FEEDBACK_TO_EMAIL via Gmail SMTP. The
operator (contour.app.demo@gmail.com by default) sees each submission
as an email in their inbox with the user's email — if provided — set
as Reply-To so they can respond directly.

The SMTP send runs in a thread executor (stdlib smtplib is blocking)
and is fire-and-forget from the request's POV — the user gets an
immediate {"ok": True} regardless of whether the SMTP transaction
ultimately succeeded. Delivery failures are logged at error level so
they're visible in Railway logs; we don't surface them to the user
because they'd just retry and double the spam load on Gmail's relay.

Configuration via env vars (all set on Railway):
  SMTP_HOST           default smtp.gmail.com
  SMTP_PORT           default 587 (STARTTLS — NOT 465/SSL)
  SMTP_USER           the Gmail address sending the mail
                      (typically the same as FEEDBACK_TO_EMAIL)
  SMTP_PASS           a Gmail *App Password* — NOT the account password.
                      Generate at https://myaccount.google.com/apppasswords
                      with 2-Step Verification enabled. Plain-password
                      auth is blocked by Google for SMTP.
  FEEDBACK_TO_EMAIL   destination address (default contour.app.demo@gmail.com)
  FEEDBACK_FROM_EMAIL From header (default SMTP_USER)

If SMTP_USER or SMTP_PASS aren't set, the endpoint still returns 200
but logs a warning — useful for local dev where we don't want every
backend run to require credentials, while still letting the frontend
form validate against a live endpoint.
"""

import asyncio
import logging
import os
import smtplib
from email.message import EmailMessage
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from routers.auth import optional_user_id
from services.limiter import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["feedback"])

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
FEEDBACK_TO_EMAIL = os.environ.get("FEEDBACK_TO_EMAIL", "contour.app.demo@gmail.com")
FEEDBACK_FROM_EMAIL = os.environ.get("FEEDBACK_FROM_EMAIL", SMTP_USER or FEEDBACK_TO_EMAIL)


class FeedbackIn(BaseModel):
    # Optional — if the user provides an email we set it as Reply-To
    # so the operator can respond directly. Loose validation here; the
    # serious check is whether it parses as something replyable, which
    # we test inline with a simple "contains @" gate so unicode addresses
    # (admittedly rare) aren't dropped.
    email: str = Field(default="", max_length=200)
    # Bounded so a hostile client can't paste a megabyte of garbage.
    # 2000 is generous for a real feedback message but small enough that
    # the SMTP transaction stays under a second.
    message: str = Field(..., min_length=1, max_length=2000)


def _send_email_sync(subject: str, body: str, reply_to: Optional[str]) -> tuple[bool, Optional[str]]:
    """Blocking SMTP send. Called from a thread executor so the event
    loop stays responsive — stdlib smtplib is sync-only.

    Returns (ok, error_str). Never raises so the calling background
    task logs uniformly regardless of outcome.
    """
    if not SMTP_USER or not SMTP_PASS:
        return False, "SMTP_USER/SMTP_PASS not configured"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = FEEDBACK_FROM_EMAIL
    msg["To"] = FEEDBACK_TO_EMAIL
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body)

    try:
        # Port 587 + STARTTLS is the modern Gmail path. Port 465 (implicit
        # SSL) also works but requires smtplib.SMTP_SSL which has a
        # different connect handshake.
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(SMTP_USER, SMTP_PASS)
            smtp.send_message(msg)
        return True, None
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


async def _send_and_log(subject: str, body: str, reply_to: Optional[str]) -> None:
    """Run the SMTP send in a worker thread and log the result. Background
    task — the request handler does not await this."""
    loop = asyncio.get_event_loop()
    ok, err = await loop.run_in_executor(None, _send_email_sync, subject, body, reply_to)
    if ok:
        logger.info("feedback: email sent (to=%s, reply_to=%s)", FEEDBACK_TO_EMAIL, reply_to)
    else:
        logger.error("feedback: SMTP send failed — %s", err)


@router.post("")
@limiter.limit("5/minute")
async def submit_feedback(
    request: Request,
    body: FeedbackIn,
    user_id: Optional[str] = Depends(optional_user_id),
):
    """Accept user feedback, kick off SMTP email to the operator.

    Returns {"ok": True} as soon as the message is queued for sending.
    SMTP delivery happens in a background task so a slow Gmail relay
    doesn't block the response. Delivery failures are logged only.
    """
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is required")

    email = (body.email or "").strip()
    # Loose validity gate — must contain @ and not exceed length cap.
    # We don't try to enforce strict RFC 5322 because edge cases
    # (Unicode local-parts, etc.) routinely fail strict regex.
    reply_to = email if email and "@" in email and len(email) <= 200 else None

    # Compose subject + body. Including the user_id (when signed in) and
    # the source IP gives the operator enough context to triage without
    # exposing more than what we already log server-side.
    who = f"user {user_id}" if user_id else "anonymous"
    subject = f"[Contour feedback] {who}"
    ip = request.client.host if request.client else "?"

    payload = "\n".join([
        f"From email: {email or '(none provided)'}",
        f"Auth: {who}",
        f"IP: {ip}",
        "",
        "----- message -----",
        text,
    ])

    # Fire-and-forget. The task is a strong reference held by the event
    # loop; we deliberately don't store it (no cleanup needed — runs to
    # completion in seconds and self-removes).
    asyncio.create_task(_send_and_log(subject, payload, reply_to))

    return {"ok": True}
