"""reset cached track stream counts so the new Kworb parser repopulates them

The previous `get_artist_tracks_by_id` reused `_parse_album_page` to parse
Kworb's artist TRACKS page — but that page has a different column layout
(Peak Date / Title / Streams / Global / ...) than the artist albums page
(Album Name / Streams). The reused parser read cells[0] as the title
(getting "2020/03/20") and cells[1] as the streams (getting "Blinding
Lights", which int() rejected), so every track lookup silently returned
an empty list. Tracks fell through to the Last.fm fallback (added in
the same commit that exposed this bug) and got persisted with lifetime
SCROBBLE counts — ~100× lower than the real Spotify streams.

The next commit (this one) introduced `_parse_artist_tracks_page` which
reads from the correct columns. But existing rows enriched via the
buggy path show numbers like Blinding Lights = 38,601,500 (Last.fm
scrobbles), and `needs_enrichment()` returns False for status='done'
rows until the 24h TTL elapses — so the visible numbers wouldn't
self-correct until tomorrow without intervention.

This migration forces a re-enrichment by setting every album_cache
row that's ALSO present in track_cache (i.e. is a track, not an
album) back to `enrichment_status='pending'` and nulling its
kworb_streams. needs_enrichment() will return True on next request
and the new parser will write the correct Spotify-stream totals.

One-shot. No backfill on downgrade — re-running this migration would
just re-trigger re-enrichment, which is idempotent.

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-05-17
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'w3x4y5z6a7b8'
down_revision: Union[str, None] = 'v2w3x4y5z6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Reset every album_cache row that corresponds to a track. The IN
    # subquery against track_cache.spotify_id picks out only track rows
    # (album rows aren't in track_cache), so album enrichment is untouched.
    op.execute("""
        UPDATE album_cache
        SET enrichment_status = 'pending',
            kworb_streams = NULL,
            enriched_at = NULL
        WHERE spotify_id IN (SELECT spotify_id FROM track_cache)
    """)


def downgrade() -> None:
    # No-op: we can't restore the previously-cached (wrong) values, and
    # there's no reason to want to. needs_enrichment() will re-fetch on
    # next request via the corrected parser regardless of state here.
    pass
