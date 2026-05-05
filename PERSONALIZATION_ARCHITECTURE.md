# Contour Personalization Architecture

## Current State — 5-Tier Discovery Feed

```
User opens For You feed
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  Taste Inputs (resolved in order)                       │
│                                                         │
│  1. Server-side UserTasteProfile (logged-in users)      │
│     └─ genres[]  +  liked_artist_ids[]                  │
│  2. Client localStorage fallback (logged-out / cold)    │
│     └─ genres[]  +  liked_artists[]                     │
│  3. No preferences → cold-start baseline                │
└────────────────────────┬────────────────────────────────┘
                         │
        ┌────────────────▼─────────────────┐
        │   Feed generation pipeline       │
        │                                  │
        │  Tier 1 ─ Related-artist tracks  │ ← most personal
        │    get_related_artists(artist)    │
        │    get_artist_top_tracks(related) │
        │                                  │
        │  Tier 2 ─ Genre keyword search   │
        │    search_tracks_by_genre(genre)  │
        │                                  │
        │  Tier 3 ─ Global Top 50 baseline │ ← always fires
        │    get_global_top_tracks()        │
        │                                  │
        │  Tier 4 ─ New releases filler    │
        │    get_new_releases()             │
        │                                  │
        │  Tier 5 ─ Keyword fallbacks      │ ← guarantees results
        │    search_tracks("pop hits", …)  │
        └────────────────┬─────────────────┘
                         │
        ┌────────────────▼─────────────────┐
        │  Deduplication + exclusion       │
        │  • exclude rated tracks (DB)     │
        │  • deduplicate within batch      │
        └────────────────┬─────────────────┘
                         │
        ┌────────────────▼─────────────────┐
        │  Deezer preview enrichment       │
        │  (fills missing preview_url)     │
        └────────────────┬─────────────────┘
                         │
                  Return ≤10 tracks
```

### Signals used today
| Signal | Source | Weight |
|---|---|---|
| Liked artist IDs (≥4★) | User ratings → DB taste profile | High |
| Genre preferences | Onboarding picker + ratings → DB | Medium |
| Global popularity | Spotify Top 50 | Low (baseline only) |
| Recency | New releases | Low (filler) |

### Limitations
- Tier 3/5 produces the same ~50 tracks for every user → lacks novelty for power users
- No explicit negative signals (skip / dislike)
- No collaborative filtering ("users like you also liked…")
- Genre strings are coarse (e.g. "pop" covers wildly different sounds)
- Cold-start requires 5 ratings before personalization kicks in
- No diversity enforcement (could serve 10 Drake songs from related artists)

---

## Proposed Future State — Layered Personalization

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Signal Collection Layer                        │
│                                                                        │
│  Explicit                    Implicit                  Social          │
│  ─────────                   ────────                  ──────          │
│  Star ratings (1-5)          Preview play duration    Follows         │
│  Written reviews             Track page views         Liked reviews    │
│  Onboarding genres           Album page visits        Shared tracks    │
│  Explicit skip / dislike     Search queries                            │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────┐
│                         Profile Store (Redis + Postgres)              │
│                                                                        │
│  UserTasteProfile v2                                                   │
│  ├── genre_weights: {pop: 0.8, indie: 0.6, hip-hop: 0.2, …}          │
│  ├── liked_artist_ids: [id1, id2, …]                                  │
│  ├── disliked_artist_ids: [id3, …]           ← new                   │
│  ├── listened_track_ids: Set (30d window)    ← new                   │
│  └── era_preference: {decade: weight, …}     ← new (optional)        │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────┐
│                     Candidate Generation Layer                         │
│                                                                        │
│  Source A — Collaborative Filtering (new)                             │
│    Find users with similar taste profiles → sample their highly-      │
│    rated tracks → surface tracks rated 4-5★ by taste-twins           │
│                                                                        │
│  Source B — Related Artists (existing, improved)                      │
│    Expand to 2nd-degree related artists; weight by genre overlap      │
│                                                                        │
│  Source C — Genre + Era Search (existing, improved)                   │
│    Use era_preference to bias toward specific decades                  │
│                                                                        │
│  Source D — Contour Community Trending (new)                          │
│    Tracks with most ★ ratings in last 7 days across all users        │
│    (rewards engaged community content, not just Spotify popularity)   │
│                                                                        │
│  Source E — Global Baseline (existing)                                │
│    Spotify Top 50 + new releases                                      │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────┐
│                         Ranking + Diversity Layer                      │
│                                                                        │
│  Score each candidate:                                                 │
│    score = genre_match × artist_affinity × recency_decay              │
│           × (1 - already_heard_penalty)                               │
│           × era_alignment                                             │
│                                                                        │
│  Diversity rules (prevent artist/genre floods):                        │
│    • Max 2 tracks per artist per batch                                 │
│    • Min 3 distinct genres per 10-card batch                           │
│    • Alternate era decade every 5 cards (optional)                    │
│                                                                        │
│  Hard exclusions:                                                      │
│    • Tracks the user has rated                                        │
│    • Tracks from disliked artists                                     │
│    • Tracks heard in last 30 days (soft, not hard)                    │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                          Return ≤10 tracks (ranked)
```

### Proposed signal roadmap

#### Short-term (< 1 sprint)
- [ ] **Explicit dislike / skip button** — surface on the For You card; sets a negative weight for that artist in the taste profile
- [ ] **Diversity cap** — max 2 tracks per artist per feed batch (already easy to add in `_add()`)
- [ ] **Genre weight map** instead of binary genre list — 4★ = +0.3, 5★ = +0.5, 1★ = −0.4

#### Medium-term (1-2 sprints)
- [ ] **Community trending tier** — query `ratings` table for tracks with most 4-5★ ratings in last 7d
- [ ] **2nd-degree related artists** — current code fetches related artists of liked artists; extend to also fetch related artists of *those* related artists (1 extra async call)
- [ ] **Era preference detection** — infer preferred decades from rated tracks' release dates; bias searches accordingly

#### Long-term / ambitious
- [ ] **Collaborative filtering** — cluster users by taste vector similarity (cosine sim on genre_weights); pull highly-rated tracks from user clusters. Requires enough ratings density (~1K+ active users).
- [ ] **Audio feature embeddings** — use Spotify's audio features API (tempo, danceability, valence, energy) to build a track embedding; recommend by proximity in embedding space
- [ ] **Sequence-aware ranking** — model what the user listened to *in the last session* to avoid starting each session the same way

### Why these priorities
Diversity cap and dislike button have the highest perceived-quality-per-effort ratio. A single disliked artist producing 10 consecutive cards destroys trust in the feed.  
Community trending rewards Contour's own community engagement and surfaces tracks outside the Spotify popularity bubble — which is the core differentiation.
