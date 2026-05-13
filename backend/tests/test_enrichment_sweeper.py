"""Tests for the periodic enrichment sweeper.

The sweeper is defense-in-depth: it picks up AlbumCache rows stuck on
'pending' or 'failed' and re-runs the enrichment pipeline on each. It
builds meta directly from AlbumCache row data + the hardcoded
_ARTIST_IDS map — it does NOT call spotify.get_album, because in
production that endpoint has been intermittently 404'ing for our
credential and that dependency would stall the sweeper.
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
    """Stub Kworb / Last.fm so the sweeper runs deterministically. Returns
    a dict of call traces the test can inspect."""
    calls = {"kworb": [], "lastfm": [], "spotify": []}

    async def fake_kworb_get_streams(artist_id, name):
        calls["kworb"].append((artist_id, name))
        return 1_000_000  # always hits — simple happy path

    async def fake_lastfm_get_album(artist, album):
        calls["lastfm"].append((artist, album))
        return None

    async def fake_spotify_get_album(album_id):
        # The sweeper must NOT call this anymore — track it to assert
        # the new dependency-free behavior.
        calls["spotify"].append(album_id)
        raise AssertionError("sweeper should not call spotify.get_album")

    monkeypatch.setattr("services.kworb.get_album_streams", fake_kworb_get_streams)
    monkeypatch.setattr("services.lastfm.get_album_playcount", fake_lastfm_get_album)
    monkeypatch.setattr("services.spotify.get_album", fake_spotify_get_album)
    return calls


# ── Tests ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sweeper_processes_pending_row_via_artist_id_map(
    shared_engine_and_session, patch_externals
):
    """Travis Scott is in _ARTIST_IDS, so the sweeper resolves him → his
    Spotify artist ID → Kworb → 'done'. No Spotify metadata call is made."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="utopia-id",
            name="UTOPIA",
            artist="Travis Scott",
            enrichment_status="pending",
        ))
        await s.commit()

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 1

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "utopia-id")
        )).scalar_one()
        assert row.enrichment_status == "done"
        assert row.kworb_streams == 1_000_000

    # Kworb was called with Travis Scott's real Spotify ID (from _ARTIST_IDS),
    # not the album's Spotify ID — proves the map was consulted.
    assert any(
        artist_id == "0Y5tJX1MQlPlqiwlOH1tJY" for artist_id, _ in patch_externals["kworb"]
    )
    # Critically: spotify.get_album was NEVER called.
    assert patch_externals["spotify"] == []


@pytest.mark.asyncio
async def test_sweeper_falls_through_to_lastfm_when_artist_not_in_map(
    shared_engine_and_session, monkeypatch
):
    """Obscure artist not in _ARTIST_IDS → artist_ids is empty → Kworb is
    skipped → Last.fm is called with the artist name. Still no Spotify
    call. If Last.fm hits, row → done."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="obscure-id",
            name="Obscure Album",
            artist="Some Indie Band Nobody Knows",
            enrichment_status="pending",
        ))
        await s.commit()

    async def kworb_should_not_be_called(*args, **kwargs):
        raise AssertionError("Kworb should not be called without an artist_id")

    async def lastfm_hit(artist, album):
        return 250_000

    async def spotify_should_not_be_called(album_id):
        raise AssertionError("sweeper should not call spotify.get_album")

    monkeypatch.setattr("services.kworb.get_album_streams", kworb_should_not_be_called)
    monkeypatch.setattr("services.lastfm.get_album_playcount", lastfm_hit)
    monkeypatch.setattr("services.spotify.get_album", spotify_should_not_be_called)

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 1

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "obscure-id")
        )).scalar_one()
        assert row.enrichment_status == "done"
        assert row.kworb_streams == 250_000


@pytest.mark.asyncio
async def test_sweeper_marks_row_failed_when_both_sources_miss(
    shared_engine_and_session, monkeypatch
):
    """Unknown artist + Last.fm miss → row → failed (with timestamp).
    The 6h FAILED_RETRY_HOURS cooldown keeps it from being re-picked on
    every cycle."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="ghost-id",
            name="Ghost",
            artist="Anonymous",
            enrichment_status="pending",
        ))
        await s.commit()

    async def miss(*args, **kwargs):
        return None

    async def spotify_should_not_be_called(album_id):
        raise AssertionError("sweeper should not call spotify.get_album")

    monkeypatch.setattr("services.kworb.get_album_streams", miss)
    monkeypatch.setattr("services.lastfm.get_album_playcount", miss)
    monkeypatch.setattr("services.spotify.get_album", spotify_should_not_be_called)

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 1  # sweeper ran _enrich_album even though it found nothing

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "ghost-id")
        )).scalar_one()
        # Critical: status is NOT 'pending' anymore — it's 'failed' with a
        # timestamp, which gates re-retries via FAILED_RETRY_HOURS.
        assert row.enrichment_status == "failed"
        assert row.enriched_at is not None


@pytest.mark.asyncio
async def test_sweeper_skips_recently_failed_rows(
    shared_engine_and_session, patch_externals
):
    """A row that failed an hour ago shouldn't be retried — the
    failed_retry_hours window guards against hammering."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="alb-recent-fail",
            name="Just Failed",
            artist="Travis Scott",
            enrichment_status="failed",
            enriched_at=datetime.utcnow() - timedelta(minutes=10),
        ))
        await s.commit()

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 0

    # Verify Kworb was never even called — the row was filtered out by the
    # WHERE clause before any external pressure.
    assert patch_externals["kworb"] == []


@pytest.mark.asyncio
async def test_sweeper_retries_old_failed_rows(
    shared_engine_and_session, patch_externals
):
    """A row that failed long enough ago SHOULD be retried."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="alb-old-fail",
            name="Old Failure",
            artist="Travis Scott",
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
                artist="Travis Scott",
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
    Kworb is never called."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="alb-done",
            name="All Good",
            artist="Travis Scott",
            enrichment_status="done",
            kworb_streams=999_999,
            enriched_at=datetime.utcnow(),
        ))
        await s.commit()

    from services import enrichment_sweeper
    processed = await enrichment_sweeper.sweep_once()
    assert processed == 0
    assert patch_externals["kworb"] == []
