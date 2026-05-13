"""Tests for the periodic enrichment sweeper (option B of the fix).

The sweeper is defense-in-depth: it picks up AlbumCache rows stuck on
'pending' or 'failed' and re-runs the enrichment pipeline. These tests
exercise the one-shot sweep_once() function — the run_forever() loop
itself is a thin wrapper around sweep_once + sleep, not worth testing
the infinite loop directly.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import AlbumCache


@pytest_asyncio.fixture
async def shared_engine_and_session(monkeypatch):
    """Bind database.AsyncSessionLocal to a per-test in-memory engine, so
    both the sweeper's internal session and the test assertions see the
    same DB."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import database
    monkeypatch.setattr(database, "AsyncSessionLocal", SessionLocal)

    yield engine, SessionLocal

    await engine.dispose()


@pytest_asyncio.fixture
def patch_externals(monkeypatch):
    """Stub Spotify, Kworb, Last.fm so the sweeper runs deterministically.
    Returns a dict of call counters the test can inspect."""
    calls = {"spotify": [], "kworb": [], "lastfm": []}

    async def fake_spotify_get_album(album_id):
        calls["spotify"].append(album_id)
        return {
            "id": album_id,
            "name": f"Album-{album_id}",
            "artists": [f"Artist-{album_id}"],
            "artist_ids": [f"artist-id-{album_id}"],
        }

    async def fake_kworb_get_streams(artist_id, name):
        calls["kworb"].append((artist_id, name))
        return 1_000_000  # always hits, simple happy path

    async def fake_lastfm_get_album(artist, album):
        calls["lastfm"].append((artist, album))
        return None

    monkeypatch.setattr("services.spotify.get_album", fake_spotify_get_album)
    monkeypatch.setattr("services.kworb.get_album_streams", fake_kworb_get_streams)
    monkeypatch.setattr("services.lastfm.get_album_playcount", fake_lastfm_get_album)
    return calls


# ── Tests ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sweeper_processes_pending_rows(shared_engine_and_session, patch_externals):
    """Pending rows should be picked up and transitioned to 'done'."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="alb-1",
            name="Stuck Album",
            artist="Stuck Artist",
            enrichment_status="pending",
        ))
        await s.commit()

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 1

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "alb-1")
        )).scalar_one()
        assert row.enrichment_status == "done"
        assert row.kworb_streams == 1_000_000


@pytest.mark.asyncio
async def test_sweeper_skips_recently_failed_rows(shared_engine_and_session, patch_externals):
    """A row that failed an hour ago shouldn't be retried — saves us from
    hammering Kworb when an album genuinely isn't there."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="alb-recent-fail",
            name="Just Failed",
            artist="Artist",
            enrichment_status="failed",
            enriched_at=datetime.utcnow() - timedelta(minutes=10),
        ))
        await s.commit()

    from services import enrichment_sweeper
    # default FAILED_RETRY_HOURS=6, this row is 10min old — should skip
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 0

    # Status should be unchanged (still failed, no new write)
    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "alb-recent-fail")
        )).scalar_one()
        assert row.enrichment_status == "failed"


@pytest.mark.asyncio
async def test_sweeper_retries_old_failed_rows(shared_engine_and_session, patch_externals):
    """A row that failed long enough ago SHOULD be retried — the source
    may have indexed the album in the meantime."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="alb-old-fail",
            name="Old Failure",
            artist="Artist",
            enrichment_status="failed",
            enriched_at=datetime.utcnow() - timedelta(hours=24),
        ))
        await s.commit()

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 1

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "alb-old-fail")
        )).scalar_one()
        assert row.enrichment_status == "done"
        assert row.kworb_streams == 1_000_000


@pytest.mark.asyncio
async def test_sweeper_respects_batch_size(shared_engine_and_session, patch_externals):
    """With more pending rows than batch_size, only batch_size are picked
    in one cycle. The rest stay pending for the next sweep."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        for i in range(5):
            s.add(AlbumCache(
                spotify_id=f"alb-{i}",
                name=f"Album {i}",
                artist="Artist",
                enrichment_status="pending",
            ))
        await s.commit()

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once(batch_size=2)
    assert processed == 2

    async with SessionLocal() as s:
        done_count = len((await s.execute(
            select(AlbumCache).where(AlbumCache.enrichment_status == "done")
        )).scalars().all())
        pending_count = len((await s.execute(
            select(AlbumCache).where(AlbumCache.enrichment_status == "pending")
        )).scalars().all())
        assert done_count == 2
        assert pending_count == 3


@pytest.mark.asyncio
async def test_sweeper_no_work_returns_zero(shared_engine_and_session, patch_externals):
    """Steady state: no stuck rows → sweep does nothing → returns 0.
    Spotify is never even called."""
    _, SessionLocal = shared_engine_and_session

    # All rows already done
    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="alb-done",
            name="All Good",
            artist="Artist",
            enrichment_status="done",
            kworb_streams=999_999,
            enriched_at=datetime.utcnow(),
        ))
        await s.commit()

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 0
    assert patch_externals["spotify"] == []  # no Spotify pressure when idle


@pytest.mark.asyncio
async def test_sweeper_marks_spotify_failure_as_failed(shared_engine_and_session, monkeypatch):
    """If Spotify fetch fails for a row, the sweeper should log AND mark the
    row as failed — otherwise the same broken ID sits at the top of the
    priority queue and burns the batch budget on it every cycle (this was
    the actual bug observed in production after the first A+B deploy)."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="alb-broken",
            name="Broken",
            artist="Artist",
            enrichment_status="pending",
        ))
        s.add(AlbumCache(
            spotify_id="alb-ok",
            name="OK",
            artist="Artist",
            enrichment_status="pending",
        ))
        await s.commit()

    async def selective_spotify(album_id):
        if album_id == "alb-broken":
            raise RuntimeError("simulated spotify failure")
        return {
            "id": album_id, "name": "OK", "artists": ["Artist"],
            "artist_ids": ["aid"],
        }

    async def kworb_hit(artist_id, name):
        return 500_000

    monkeypatch.setattr("services.spotify.get_album", selective_spotify)
    monkeypatch.setattr("services.kworb.get_album_streams", kworb_hit)

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 1  # alb-ok succeeded; alb-broken was marked failed

    async with SessionLocal() as s:
        ok_row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "alb-ok")
        )).scalar_one()
        broken_row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "alb-broken")
        )).scalar_one()
        assert ok_row.enrichment_status == "done"
        # Critical: broken row is no longer pending — it's failed with a
        # fresh timestamp, so it won't be re-picked for FAILED_RETRY_HOURS.
        assert broken_row.enrichment_status == "failed"
        assert broken_row.enriched_at is not None
