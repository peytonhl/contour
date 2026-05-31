// ── Onboarding seed-artist list ───────────────────────────────────────────────
//
// HAND-TUNED, SWAPPABLE source of truth for the onboarding artist picker
// (OnboardingModal step 1). The user picks a few artists they love; those
// names are sent to /discover/feed as `seed_artists` and seed the first
// cold-start batches via the Last.fm artist-similarity graph (the picked
// artists AND their neighbors). See backend/routers/discover.py
// `_fetch_similar_artist_tracks`.
//
// HOW TO EDIT (intentionally trivial — Peyton tunes this per recruiting
// community):
//   • `name` is the ONLY field that matters to the backend. It is sent
//     verbatim to Last.fm's similarity graph, which is fuzzy/forgiving on
//     spelling and casing — but prefer the artist's canonical spelling
//     (e.g. "Tyler, The Creator", "Beyoncé") for the cleanest matches.
//   • `scene` controls which section the artist appears under in the picker
//     and the section ordering follows SEED_ARTIST_SCENES below. Add a new
//     scene by adding artists with a new `scene` string AND listing it in
//     SEED_ARTIST_SCENES.
//   • `image` is the artist photo shown as a circular avatar on the chip.
//     These are Spotify CDN URLs (https://i.scdn.co/image/...) resolved once
//     from our own /artists/search endpoint and baked in here so onboarding
//     does ZERO image lookups at runtime (that endpoint is rate-limited and
//     ~50 lookups on picker-mount would blow it). OPTIONAL: omit it and the
//     chip falls back to a brand monogram of the artist's initials (a dead
//     CDN URL also falls back via onError), so you can add a name without
//     hunting down a URL. To refresh after editing the list, hit
//     /artists/search?q=<name> for each and copy the `image` field.
//
// This list is STATIC by design. There is NO auto-refresh (deliberately
// out of scope per the onboarding-rework spec) — edit this file and ship.
//
// NOTE: names flow through the `seed_artists` query param PIPE-delimited
// (not comma — "Tyler, The Creator" has a comma). The plumbing handles
// that; you don't need to escape anything here.

export const SEED_ARTISTS = [
  // ── Hip-Hop / Rap ──
  { name: "Drake", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5eb4293385d324db8558179afd9" },
  { name: "Kendrick Lamar", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5eb39ba6dcd4355c03de0b50918" },
  { name: "Travis Scott", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5eb19c2790744c792d05570bb71" },
  { name: "Playboi Carti", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5ebba50ca67ffc3097f6ea1710a" },
  { name: "J. Cole", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5ebc401ea77e86ee984b1ba9fc2" },
  { name: "Tyler, The Creator", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5ebdf2728294ff77dd11eeb18fb" },
  { name: "Kanye West", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5eb6e835a500e791bf9c27a422a" },
  { name: "Mac Miller", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5ebed3b89aa602145fde71a163a" },

  // ── Pop ──
  { name: "Taylor Swift", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5ebe2e8e7ff002a4afda1c7147e" },
  { name: "Billie Eilish", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb4a21b4760d2ecb7b0dcdc8da" },
  { name: "Ariana Grande", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb766397ec42a573a53eb5fb87" },
  { name: "Olivia Rodrigo", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5ebe654806251e2661def1f4e65" },
  { name: "Dua Lipa", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb0c68f6c95232e716f0abee8d" },
  { name: "Charli XCX", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb6fa76436a2bba83b9f1d6fd1" },
  { name: "Lana Del Rey", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5ebb99cacf8acd5378206767261" },
  { name: "Sabrina Carpenter", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb78e45cfa4697ce3c437cb455" },

  // ── R&B / Soul ──
  { name: "The Weeknd", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5ebc1719ac9e6a75c1c25835018" },
  { name: "SZA", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5ebfd0a9fb6c252a3ba44079acf" },
  { name: "Frank Ocean", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5ebee3123e593174208f9754fab" },
  { name: "Daniel Caesar", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5ebe4d94f7cbebb17504c25d419" },
  { name: "Steve Lacy", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5eb7e3150cffbfda40c6eaf28dd" },
  { name: "Brent Faiyaz", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5eb582fbf712f5b6a9bf65d9b84" },
  { name: "Beyoncé", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5eb7eaa373538359164b843f7c0" },

  // ── Indie / Alternative ──
  { name: "Tame Impala", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5ebe412a782245eb20d9626c601" },
  { name: "Arctic Monkeys", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb7da39dea0a72f581535fb11f" },
  { name: "The Strokes", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5ebc3b137793230f4043feb0089" },
  { name: "Mac DeMarco", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5ebc9aca5b6d4c528caf75e8a1d" },
  { name: "Clairo", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb4804c4a44c85afea1a72d1bd" },
  { name: "Beabadoobee", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5ebf40305a6273b3e0a514cc8da" },
  { name: "Phoebe Bridgers", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb626686e362d30246e816cc5b" },
  { name: "Boygenius", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb1a6373c01e8b86e289859f57" },

  // ── Rock ──
  { name: "Radiohead", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5eb4104fbd80f1f795728abbd59" },
  { name: "Pink Floyd", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5eb3c9e8c67b087ba0cb5923b78" },
  { name: "Fleetwood Mac", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5ebc8752dd511cda8c31e9daee8" },
  { name: "Led Zeppelin", scene: "Rock", image: "https://i.scdn.co/image/207803ce008388d3427a685254f9de6a8f61dc2e" },
  { name: "Nirvana", scene: "Rock", image: "https://i.scdn.co/image/84282c28d851a700132356381fcfbadc67ff498b" },
  { name: "The Beatles", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5ebe9348cc01ff5d55971b22433" },
  { name: "Red Hot Chili Peppers", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5ebc33cc15260b767ddec982ce8" },

  // ── Electronic ──
  { name: "Daft Punk", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5ebd3aa7cc0e419b6c459b08e8e" },
  { name: "Fred again..", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5eb01b452c9ac75fbf1ae1e5256" },
  { name: "ODESZA", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5eb9f4a0cbfcc9b274344681ccb" },
  { name: "Flume", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5ebd6ec6e1162ee709ad829cf82" },
  { name: "Disclosure", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5eb0b084ede947f009beade9a6a" },
  { name: "Aphex Twin", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5ebaa3c91d792eb520a5d58daa5" },

  // ── Country / Folk ──
  { name: "Zach Bryan", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5ebc742fbc057bdbc64834a6cdc" },
  { name: "Noah Kahan", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5eb5b141d30d14fb78458dac5ce" },
  { name: "Morgan Wallen", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5eb47de0bbc22f08b5ebe14bd6e" },
  { name: "Hozier", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5ebad85a585103dfc2f3439119a" },
  { name: "Bon Iver", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5ebfa1d9471f2a10a3a5da1a646" },

  // ── Latin ──
  { name: "Bad Bunny", scene: "Latin", image: "https://i.scdn.co/image/ab6761610000e5eb81f47f44084e0a09b5f0fa13" },
  { name: "Karol G", scene: "Latin", image: "https://i.scdn.co/image/ab6761610000e5eb66041ce9eb4497057cbc3496" },
  { name: "Peso Pluma", scene: "Latin", image: "https://i.scdn.co/image/ab6761610000e5ebe5283f5b671cf618b82a2696" },
  { name: "Rauw Alejandro", scene: "Latin", image: "https://i.scdn.co/image/ab6761610000e5eb6d72db3fd29576caa9cb821f" },
];

// Section order for the picker. Any artist whose `scene` is not listed here
// is still shown — appended under its scene name after these — so a typo'd
// scene never hides an artist; it just lands in its own trailing section.
export const SEED_ARTIST_SCENES = [
  "Hip-Hop / Rap",
  "Pop",
  "R&B / Soul",
  "Indie / Alternative",
  "Rock",
  "Electronic",
  "Country / Folk",
  "Latin",
];

// Group SEED_ARTISTS by scene in SEED_ARTIST_SCENES order, trailing any
// unlisted scenes at the end (in first-seen order). Returns
// [{ scene, artists: [...] }] for the picker to render as sections.
export function groupedSeedArtists() {
  const byScene = new Map();
  for (const a of SEED_ARTISTS) {
    if (!byScene.has(a.scene)) byScene.set(a.scene, []);
    byScene.get(a.scene).push(a);
  }
  const ordered = [];
  for (const scene of SEED_ARTIST_SCENES) {
    if (byScene.has(scene)) {
      ordered.push({ scene, artists: byScene.get(scene) });
      byScene.delete(scene);
    }
  }
  // Trailing unlisted scenes (defensive — keeps typo'd scenes visible).
  for (const [scene, artists] of byScene) ordered.push({ scene, artists });
  return ordered;
}
