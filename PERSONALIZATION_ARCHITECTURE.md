# Contour Personalization Architecture

## Current State — 5-Tier Discovery Feed

```mermaid
flowchart TD
    A([🎵 User opens For You feed]) --> B

    subgraph B["Taste Resolution — in priority order"]
        direction LR
        B1["① Server\nUserTasteProfile\ngenres + liked_artist_ids"]
        B2["② localStorage\ngenres + liked_artists"]
        B3["③ No prefs\ncold-start"]
    end

    B --> F

    subgraph F["Feed Generation Pipeline"]
        T1["Tier 1 · Related Artists\nmost personalized"]
        T2["Tier 2 · Genre Search"]
        T3["Tier 3 · Global Top 50"]
        T4["Tier 4 · New Releases"]
        T5["Tier 5 · Keyword Fallbacks\nguarantees results"]
    end

    F --> G["🔵 Dedup + Exclusion\nexclude rated tracks · deduplicate"]
    G --> H["🟢 Deezer Preview Enrichment\nfills missing preview_url"]
    H --> I(["↩ Return ≤10 tracks"])
```

### Signals used today
| Signal | Source | Weight |
|---|---|---|
| Liked artist IDs (≥4★) | User ratings → DB taste profile | High |
| Genre preferences | Onboarding picker + ratings → DB | Medium |
| Global popularity | Spotify Top 50 | Low (baseline) |
| Recency | New releases | Low (filler) |

### Current limitations
- Tiers 3 & 5 return the same tracks for every user — no novelty for power users
- No negative signals (skip / dislike)
- No collaborative filtering ("users like you also liked…")
- No diversity cap — can flood the feed with one artist
- Cold-start requires 5 ratings before personalization kicks in

---

## Proposed Future State — Layered Personalization

```mermaid
flowchart TD
    subgraph SIG["① Signal Collection"]
        direction LR
        SE["Explicit\nratings · reviews\nonboarding genres\nskip / dislike ★"]
        SI["Implicit\nplay duration ★\npage views ★\nsearch queries ★"]
        SS["Social\nfollows · shares\nliked reviews ★"]
    end

    SIG --> PS

    PS[("② Profile Store\nRedis + Postgres\n──────────────────\ngenre_weights map ★\nliked_artist_ids\ndisliked_artist_ids ★\nlistened_track_ids 30d ★\nera_preference map ★")]

    PS --> CG

    subgraph CG["③ Candidate Generation"]
        CA["Source A · Collaborative Filtering ★\ntaste-twin rated tracks"]
        CB["Source B · Related Artists\n2nd-degree expansion ★"]
        CC["Source C · Genre + Era Search\nera-biased queries ★"]
        CD["Source D · Community Trending ★\ntop-rated last 7 days"]
        CE["Source E · Global Baseline\nSpotify Top 50 + new releases"]
    end

    CG --> RL

    subgraph RL["④ Ranking + Diversity"]
        RS["Score = genre_match × artist_affinity\n× recency_decay × era_alignment"]
        RD["Diversity caps\nmax 2 tracks / artist · min 3 genres / batch ★"]
        RX["Hard exclusions\nrated tracks · disliked artists · heard < 30d ★"]
    end

    RL --> OUT(["↩ Return ≤10 ranked tracks"])
```

> ★ = new or improved vs current state

### Roadmap

#### Short-term (< 1 sprint)
- [ ] **Dislike / skip button** on For You cards → negative artist weight in taste profile
- [ ] **Diversity cap** — max 2 tracks per artist per batch (1-line change in `_add()`)
- [ ] **Genre weight map** instead of binary list — 4★ = +0.3, 5★ = +0.5, 1★ = −0.4

#### Medium-term (1–2 sprints)
- [ ] **Community trending tier** — query `ratings` for tracks with most 4–5★ in last 7 days
- [ ] **2nd-degree related artists** — one extra async call per liked artist
- [ ] **Era preference detection** — infer preferred decades from rated tracks' release years

#### Long-term
- [ ] **Collaborative filtering** — cosine similarity on genre_weight vectors; requires ~1K+ active raters
- [ ] **Audio feature embeddings** — Spotify audio features API (tempo, energy, valence) for proximity-based recommendations
- [ ] **Sequence-aware ranking** — avoid repeating the same session opener every time
