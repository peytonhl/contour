"""Tests for the album-stream enrichment pipeline.

The story: when a user views an album we've never seen, /albums/{id}/streams
upserts an AlbumCache row with status="pending" and schedules a background
task (_enrich_album) that scrapes Kworb, falls back to Last.fm, and writes
the stream count back to the DB — flipping the row to "done" or "failed".

These tests pin down three things:
  1. _enrich_album opens its own DB session (not the request session) and
     successfully writes a Kworb result.
  2. When all sources miss, the row transitions "pending" → "failed" — not
     stuck in "pending" forever.
  3. _enrich_album takes only two args (album_id, meta) — the regression
     guard that caught the closed-session bug.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import AlbumCache


# ── Shared engine fixture ────────────────────────────────────────────────────
# _enrich_album opens its own session via `from database import AsyncSessionLocal`.
# For tests, we monkeypatch database.AsyncSessionLocal to bind to a single
# per-test in-memory engine, so the background-task write and the test
# assertion read the same DB.


@pytest_asyncio.fixture
async def shared_engine_and_session(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import database
    monkeypatch.setattr(database, "AsyncSessionLocal", SessionLocal)

    yield engine, SessionLocal

    await engine.dispose()


# ── Tests ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_enrich_album_writes_kworb_streams(shared_engine_and_session, monkeypatch):
    """Happy path: Kworb returns streams, row goes pending → done."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="utopia-id",
            name="UTOPIA",
            artist="Travis Scott",
            enrichment_status="pending",
        ))
        await s.commit()

    async def fake_kworb(artist_id, name):
        assert artist_id == "0Y5tJX1MQlPlqiwlOH1tJY"
        assert name == "UTOPIA"
        return 7_068_208_275

    monkeypatch.setattr("services.kworb.get_album_streams", fake_kworb)

    from routers.albums import _enrich_album
    await _enrich_album("utopia-id", {
        "id": "utopia-id",
        "name": "UTOPIA",
        "artists": ["Travis Scott"],
        "artist_ids": ["0Y5tJX1MQlPlqiwlOH1tJY"],
    })

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "utopia-id")
        )).scalar_one()
        assert row.enrichment_status == "done"
        assert row.kworb_streams == 7_068_208_275
        assert row.enriched_at is not None


@pytest.mark.asyncio
async def test_enrich_album_falls_back_to_lastfm(shared_engine_and_session, monkeypatch):
    """Kworb misses, Last.fm hits — row should still go to done."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="album-2",
            name="Some Album",
            artist="Some Artist",
            enrichment_status="pending",
        ))
        await s.commit()

    async def kworb_miss(artist_id, name):
        return None

    async def lastfm_hit(artist, album):
        return 5_000_000

    monkeypatch.setattr("services.kworb.get_album_streams", kworb_miss)
    monkeypatch.setattr("services.lastfm.get_album_playcount", lastfm_hit)

    from routers.albums import _enrich_album
    await _enrich_album("album-2", {
        "id": "album-2",
        "name": "Some Album",
        "artists": ["Some Artist"],
        "artist_ids": ["fake-artist-id"],
    })

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "album-2")
        )).scalar_one()
        assert row.enrichment_status == "done"
        assert row.kworb_streams == 5_000_000


@pytest.mark.asyncio
async def test_enrich_album_marks_failed_when_all_sources_miss(
    shared_engine_and_session, monkeypatch
):
    """The bug we're guarding against: row must NOT stay 'pending' when both
    Kworb and Last.fm return nothing. It should transition to 'failed' so the
    next /streams view auto-retries it via needs_enrichment()."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="obscure-id",
            name="Obscure",
            artist="Nobody",
            enrichment_status="pending",
        ))
        await s.commit()

    async def miss(*args, **kwargs):
        return None

    monkeypatch.setattr("services.kworb.get_album_streams", miss)
    monkeypatch.setattr("services.lastfm.get_album_playcount", miss)

    from routers.albums import _enrich_album
    await _enrich_album("obscure-id", {
        "id": "obscure-id",
        "name": "Obscure",
        "artists": ["Nobody"],
        "artist_ids": ["nobody-id"],
    })

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "obscure-id")
        )).scalar_one()
        # The critical assertion: status is NO LONGER "pending"
        assert row.enrichment_status == "failed"
        assert row.kworb_streams is None


@pytest.mark.asyncio
async def test_enrich_album_signature_does_not_accept_db(shared_engine_and_session):
    """Regression guard for the closed-session bug. _enrich_album must not
    accept a request-scoped session — callers should let it open its own.
    If a future refactor re-adds a `db` parameter, this test fails loudly."""
    import inspect
    from routers.albums import _enrich_album

    sig = inspect.signature(_enrich_album)
    params = list(sig.parameters)
    assert params == ["album_id", "meta"], (
        f"_enrich_album must take only (album_id, meta); got {params}. "
        "Re-introducing a `db` parameter brings back the closed-session bug — "
        "FastAPI tears down request sessions before BackgroundTasks run, and "
        "the write back to AlbumCache silently fails, leaving rows stuck in "
        "'pending' forever."
    )


@pytest.mark.asyncio
async def test_enrich_album_tries_each_credited_artist(shared_engine_and_session, monkeypatch):
    """For multi-artist albums, _enrich_album should try up to 3 credited
    artists for Kworb before falling back. The first hit wins."""
    _, SessionLocal = shared_engine_and_session

    async with SessionLocal() as s:
        s.add(AlbumCache(
            spotify_id="collab-id",
            name="Collab",
            artist="A, B, C",
            enrichment_status="pending",
        ))
        await s.commit()

    calls = []

    async def kworb_only_second_artist_has_data(artist_id, name):
        calls.append(artist_id)
        if artist_id == "B-id":
            return 1_234_567
        return None

    monkeypatch.setattr("services.kworb.get_album_streams", kworb_only_second_artist_has_data)

    from routers.albums import _enrich_album
    await _enrich_album("collab-id", {
        "id": "collab-id",
        "name": "Collab",
        "artists": ["A", "B", "C"],
        "artist_ids": ["A-id", "B-id", "C-id"],
    })

    async with SessionLocal() as s:
        row = (await s.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == "collab-id")
        )).scalar_one()
        assert row.enrichment_status == "done"
        assert row.kworb_streams == 1_234_567

    # Should have tried A first, then B (hit), then stopped.
    assert calls == ["A-id", "B-id"]
