"""add original_release_date columns to TrackCache + AlbumCache

Spotify's release_date is the catalog date — the date the song/album was
uploaded to Spotify, which is wildly wrong for remasters, reissues, and
catalog-migrated indie labels. A 1976 album reissued for its 30th
anniversary in 2006 shows up on Spotify as 2006-09-15. That noise was
feeding directly into the discover decade-preference ranker: users who
high-rated vintage music looked like they preferred 2000s/2010s music
because that's when the remasters were uploaded.

Apple Music's releaseDate is generally more reliable for older catalog
— Apple preserves original release years more carefully than Spotify.
When we already have an AppleMusicLink row matched for an entity, we
fetch Apple's releaseDate and store it here. The decade ranker then
prefers this column over Spotify's release_date via COALESCE.

Both columns are nullable — entities that aren't matched on Apple
Music yet (or whose Apple match doesn't include a release date) leave
this NULL and the ranker falls back to Spotify's date as before. No
backfill: existing rows get NULL initially; the lazy Apple Music
match flow fills them in as users browse.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'v2w3x4y5z6a7'
down_revision: Union[str, None] = 'u1v2w3x4y5z6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'track_cache',
        sa.Column('original_release_date', sa.String(length=16), nullable=True),
    )
    op.add_column(
        'album_cache',
        sa.Column('original_release_date', sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('album_cache', 'original_release_date')
    op.drop_column('track_cache', 'original_release_date')
