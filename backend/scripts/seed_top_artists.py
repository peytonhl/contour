"""One-time seeder: fetch discographies for the top artists and persist to DB.

Run once on Railway via:
    railway run python scripts/seed_top_artists.py

How it works:
  1. For each artist name, searches Spotify to resolve the artist ID.
  2. Fetches their full discography (/artists/{id}/albums).
  3. Persists albums to AlbumCache and stamps ArtistCache with a timestamp.

Safety features:
  - Skips artists already fetched within the last 7 days (idempotent / safe to re-run).
  - 1.5-second delay between Spotify calls (~40/min, well under rate limits).
  - Backs off on 429 for however long Spotify asks (capped at 120s), then continues.
  - Never crashes — errors are logged and the script moves on.

Estimated runtime: ~50 minutes for 300 artists (two calls each: search + discography).
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta

import httpx
from sqlalchemy import select

from database import AsyncSessionLocal
from models import AlbumCache as AlbumCacheModel, ArtistCache
from services import spotify as spotify_svc

# ── Artist list ───────────────────────────────────────────────────────────────
# Organized by genre. Names are matched against Spotify's artist search — exact
# spelling matters. Add/remove freely; the script is idempotent.

ARTIST_NAMES = [
    # ── Hip-Hop / Rap ─────────────────────────────────────────────────────────
    "Drake", "Kendrick Lamar", "J. Cole", "Travis Scott", "Future",
    "Lil Baby", "21 Savage", "Don Toliver", "Playboi Carti", "Gunna",
    "Kanye West", "Post Malone", "Lil Uzi Vert", "Juice WRLD", "Lil Durk",
    "Nicki Minaj", "Cardi B", "Eminem", "Jay-Z", "Lil Wayne",
    "Young Thug", "Meek Mill", "A$AP Rocky", "Big Sean", "2 Chainz",
    "Wale", "Rick Ross", "Pusha T", "Mac Miller", "Childish Gambino",
    "Tyler, the Creator", "Earl Sweatshirt", "Action Bronson", "Logic",
    "NF", "Rod Wave", "Kevin Gates", "Polo G", "NBA YoungBoy",
    "Kodkodak Black", "DaBaby", "Roddy Ricch", "Lil Tjay", "Pop Smoke",
    "Jack Harlow", "Fivio Foreign", "Fabolous", "Jadakiss", "Lloyd Banks",
    "Nas", "Jay-Z", "Rakim", "Big L", "Big Pun",
    "Notorious B.I.G.", "Tupac Shakur", "Snoop Dogg", "Dr. Dre", "Ice Cube",
    "DMX", "Ja Rule", "Lloyd", "Bryson Tiller", "Wale",
    "Trippie Redd", "6lack", "Lil Skies", "YNW Melly", "Lil Keed",
    "Gunna", "Lil Baby", "Moneybagg Yo", "EST Gee", "42 Dugg",
    "Mozzy", "G Herbo", "Polo G", "Calboy", "Lil Durk",
    "Chance the Rapper", "Big K.R.I.T.", "Isaiah Rashad", "ScHoolboy Q",
    "Ab-Soul", "Jay Rock", "Vince Staples", "Joey Bada$$", "flatbush zombies",
    "Earthgang", "J.I.D", "6LACK", "Dreamville", "Bas",

    # ── R&B / Soul ────────────────────────────────────────────────────────────
    "Frank Ocean", "SZA", "The Weeknd", "Usher", "Beyoncé",
    "Summer Walker", "Jhené Aiko", "H.E.R.", "Tinashe", "Kehlani",
    "Daniel Caesar", "Giveon", "Lucky Daye", "Ari Lennox", "Snoh Aalegra",
    "Ella Mai", "Brent Faiyaz", "Omar Apollo", "Pink Sweat$", "Emotional Oranges",
    "dvsn", "Partynextdoor", "dvsn", "Joyce Wrice", "Amber Mark",
    "Solange", "Erykah Badu", "D'Angelo", "Maxwell", "Maxwell",
    "Alicia Keys", "John Legend", "Mary J. Blige", "R. Kelly", "Mariah Carey",
    "Whitney Houston", "Aretha Franklin", "Stevie Wonder", "Al Green",

    # ── Pop ───────────────────────────────────────────────────────────────────
    "Taylor Swift", "Ariana Grande", "Billie Eilish", "Dua Lipa",
    "Olivia Rodrigo", "Justin Bieber", "Bruno Mars", "Ed Sheeran",
    "Harry Styles", "Doja Cat", "Selena Gomez", "Shawn Mendes",
    "Camila Cabello", "Halsey", "Lorde", "Charli XCX", "Troye Sivan",
    "Lizzo", "Demi Lovato", "Miley Cyrus", "Katy Perry", "Lady Gaga",
    "Rihanna", "Adele", "Sam Smith", "Sia", "P!nk",
    "Coldplay", "Imagine Dragons", "OneRepublic", "Maroon 5", "Train",
    "Jonas Brothers", "Niall Horan", "Zayn", "Liam Payne",
    "Ava Max", "Tate McRae", "Gracie Abrams", "Sabrina Carpenter",
    "Conan Gray", "Clairo", "Beabadoobee", "Phoebe Bridgers",
    "Hozier", "Dermot Kennedy", "Lewis Capaldi", "James Arthur",

    # ── Rock / Alternative ────────────────────────────────────────────────────
    "The Beatles", "Led Zeppelin", "Pink Floyd", "The Rolling Stones",
    "Nirvana", "Pearl Jam", "Soundgarden", "Alice in Chains",
    "Red Hot Chili Peppers", "Foo Fighters", "Green Day", "Blink-182",
    "Weezer", "The Smashing Pumpkins", "Radiohead", "Oasis",
    "Arctic Monkeys", "The Strokes", "Interpol", "Yeah Yeah Yeahs",
    "Bloc Party", "Franz Ferdinand", "The Killers", "Kings of Leon",
    "Florence + the Machine", "The National", "Bon Iver", "Sufjan Stevens",
    "Vampire Weekend", "MGMT", "Tame Impala", "Beach House",
    "Mac DeMarco", "Alex G", "Soccer Mommy", "snail mail",
    "boygenius", "Big Thief", "Sharon Van Etten", "Angel Olsen",
    "Fleetwood Mac", "Stevie Nicks", "Eagles", "Tom Petty",
    "Bruce Springsteen", "Bob Dylan", "Neil Young", "Joni Mitchell",
    "Metallica", "Slayer", "Black Sabbath", "Ozzy Osbourne",
    "Tool", "System of a Down", "Rage Against the Machine",
    "Linkin Park", "Evanescence", "30 Seconds to Mars",
    "My Chemical Romance", "Fall Out Boy", "Panic! at the Disco",
    "Twenty One Pilots", "Paramore", "Hayley Williams",
    "5 Seconds of Summer", "All Time Low", "The Maine",
    "The 1975", "Glass Animals", "Jungle", "MGMT", "Phoenix",
    "LCD Soundsystem", "Hot Chip", "Caribou", "Four Tet",

    # ── Classic Rock / Legacy ─────────────────────────────────────────────────
    "Queen", "David Bowie", "Elton John", "AC/DC", "Aerosmith",
    "The Who", "The Doors", "Jimi Hendrix", "Janis Joplin",
    "Creedence Clearwater Revival", "Lynyrd Skynyrd", "ZZ Top",
    "Bob Marley", "Johnny Cash", "Willie Nelson", "Dolly Parton",
    "Frank Sinatra", "Nat King Cole", "Tony Bennett", "Dean Martin",
    "Miles Davis", "John Coltrane", "Louis Armstrong", "Ella Fitzgerald",
    "Michael Jackson", "Prince", "James Brown", "Ray Charles",
    "Aretha Franklin", "Marvin Gaye", "Al Green", "Otis Redding",

    # ── Electronic / Dance ────────────────────────────────────────────────────
    "Daft Punk", "Calvin Harris", "Marshmello", "The Chainsmokers",
    "Diplo", "Skrillex", "Deadmau5", "Avicii", "Zedd",
    "Martin Garrix", "David Guetta", "Tiësto", "Kygo",
    "Disclosure", "Flume", "Kaytranada", "Sohn", "James Blake",
    "Jamie xx", "Mount Kimbie", "Bonobo", "Tycho", "Moby",
    "Aphex Twin", "Burial", "Arca", "Kelela", "FKA twigs",

    # ── Country ───────────────────────────────────────────────────────────────
    "Morgan Wallen", "Luke Combs", "Zach Bryan", "Chris Stapleton",
    "Kane Brown", "Carrie Underwood", "Kenny Chesney", "Tim McGraw",
    "Garth Brooks", "George Strait", "Alan Jackson", "Brad Paisley",
    "Blake Shelton", "Miranda Lambert", "Kacey Musgraves", "Maren Morris",
    "Cody Johnson", "Tyler Childers", "Sturgill Simpson", "Jason Isbell",
    "Eric Church", "Luke Bryan", "Florida Georgia Line", "Dan + Shay",

    # ── Latin ─────────────────────────────────────────────────────────────────
    "Bad Bunny", "J Balvin", "Maluma", "Ozuna", "Daddy Yankee",
    "Shakira", "Enrique Iglesias", "Marc Anthony", "Ricky Martin",
    "Karol G", "Rosalía", "Camilo", "Rauw Alejandro", "Myke Towers",
    "Sech", "Jhay Cortez", "Anuel AA", "Arcangel",

    # ── K-Pop / Global ────────────────────────────────────────────────────────
    "BTS", "BLACKPINK", "Stray Kids", "Twice", "Aespa",
    "EXO", "NCT 127", "Red Velvet", "IU", "G-Dragon",
]

# Deduplicate while preserving order
seen_names: set[str] = set()
ARTISTS: list[str] = []
for n in ARTIST_NAMES:
    key = n.lower()
    if key not in seen_names:
        seen_names.add(key)
        ARTISTS.append(n)


async def _fetch_with_backoff(artist_id: str) -> list[dict]:
    """Fetch discography with manual backoff on 429 (the wrapper already handles short ones)."""
    for attempt in range(3):
        try:
            result = await spotify_svc.get_artist_albums_limited(artist_id, limit=50)
            return result or []
        except Exception as exc:
            msg = str(exc)
            if "429" in msg and attempt < 2:
                wait = 30 * (attempt + 1)
                print(f"  [429] backing off {wait}s...", flush=True)
                await asyncio.sleep(wait)
            else:
                raise
    return []


async def seed():
    skipped = 0
    fetched = 0
    failed = 0
    total = len(ARTISTS)
    freshness_cutoff = datetime.utcnow() - timedelta(days=7)

    print(f"[seed] Starting: {total} unique artists", flush=True)
    print(f"[seed] Estimated time: ~{total * 3 // 60} minutes at 1.5s/call\n", flush=True)

    for i, name in enumerate(ARTISTS, 1):
        # ── Step 1: Search for artist ID ──────────────────────────────────────
        try:
            results = await spotify_svc.search_artists(name, limit=1)
        except Exception as exc:
            print(f"[{i}/{total}] ERROR searching '{name}': {exc}", flush=True)
            failed += 1
            await asyncio.sleep(2)
            continue

        if not results:
            print(f"[{i}/{total}] NOT FOUND: {name}", flush=True)
            failed += 1
            await asyncio.sleep(1.5)
            continue

        artist_id = results[0]["id"]
        resolved_name = results[0].get("name", name)

        # Validate the match is actually this artist (not a soundalike)
        if resolved_name.lower() != name.lower():
            print(f"[{i}/{total}] SKIP mismatch: searched '{name}', got '{resolved_name}'", flush=True)
            await asyncio.sleep(1.5)
            continue

        # ── Step 2: Check freshness ────────────────────────────────────────────
        async with AsyncSessionLocal() as session:
            artist_row = (await session.execute(
                select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
            )).scalar_one_or_none()

            if (
                artist_row is not None
                and artist_row.discography_fetched_at is not None
                and artist_row.discography_fetched_at > freshness_cutoff
            ):
                print(f"[{i}/{total}] SKIP (fresh): {name}", flush=True)
                skipped += 1
                await asyncio.sleep(0.5)
                continue

        # ── Step 3: Fetch discography ──────────────────────────────────────────
        await asyncio.sleep(1.5)  # rate limit buffer before discography call

        try:
            albums = await _fetch_with_backoff(artist_id)
        except Exception as exc:
            print(f"[{i}/{total}] ERROR fetching discography for '{name}': {exc}", flush=True)
            failed += 1
            await asyncio.sleep(5)
            continue

        if not albums:
            print(f"[{i}/{total}] EMPTY discography: {name}", flush=True)
            failed += 1
            await asyncio.sleep(1.5)
            continue

        # ── Step 4: Persist ────────────────────────────────────────────────────
        async with AsyncSessionLocal() as session:
            new_count = 0
            for a in albums:
                existing = (await session.execute(
                    select(AlbumCacheModel).where(AlbumCacheModel.spotify_id == a["id"])
                )).scalar_one_or_none()
                if existing is None:
                    primary_artist = a.get("artists", [resolved_name])[0]
                    session.add(AlbumCacheModel(
                        spotify_id=a["id"],
                        name=a["name"],
                        artist=primary_artist,
                        release_date=a.get("release_date"),
                        release_date_precision=a.get("release_date_precision"),
                        popularity=a.get("popularity"),
                        image_url=a.get("image_url"),
                        enrichment_status="pending",
                    ))
                    new_count += 1

            # Upsert artist_cache
            artist_row = (await session.execute(
                select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
            )).scalar_one_or_none()
            if artist_row:
                artist_row.discography_fetched_at = datetime.utcnow()
                artist_row.name = resolved_name
            else:
                session.add(ArtistCache(
                    spotify_id=artist_id,
                    name=resolved_name,
                    discography_fetched_at=datetime.utcnow(),
                ))

            await session.commit()

        fetched += 1
        print(f"[{i}/{total}] OK  {name} — {len(albums)} albums, {new_count} new", flush=True)

        await asyncio.sleep(1.5)

    print(f"\n[seed] Complete — fetched={fetched}, skipped={skipped}, failed={failed}", flush=True)


if __name__ == "__main__":
    asyncio.run(seed())
