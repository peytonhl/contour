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
//   • `image` is currently UNUSED — chips are text-only labels. The field is
//     kept on the data shape so photo tiles can be added later without a
//     data migration.
//
// This list is STATIC by design. There is NO auto-refresh (deliberately
// out of scope per the onboarding-rework spec) — edit this file and ship.
//
// NOTE: names flow through the `seed_artists` query param PIPE-delimited
// (not comma — "Tyler, The Creator" has a comma). The plumbing handles
// that; you don't need to escape anything here.

export const SEED_ARTISTS = [
  // ── Hip-Hop / Rap ──
  { name: "Drake",               scene: "Hip-Hop / Rap" },
  { name: "Kendrick Lamar",      scene: "Hip-Hop / Rap" },
  { name: "Travis Scott",        scene: "Hip-Hop / Rap" },
  { name: "Playboi Carti",       scene: "Hip-Hop / Rap" },
  { name: "J. Cole",             scene: "Hip-Hop / Rap" },
  { name: "Tyler, The Creator",  scene: "Hip-Hop / Rap" },
  { name: "Kanye West",          scene: "Hip-Hop / Rap" },
  { name: "Mac Miller",          scene: "Hip-Hop / Rap" },

  // ── Pop ──
  { name: "Taylor Swift",        scene: "Pop" },
  { name: "Billie Eilish",       scene: "Pop" },
  { name: "Ariana Grande",       scene: "Pop" },
  { name: "Olivia Rodrigo",      scene: "Pop" },
  { name: "Dua Lipa",            scene: "Pop" },
  { name: "Charli XCX",          scene: "Pop" },
  { name: "Lana Del Rey",        scene: "Pop" },
  { name: "Sabrina Carpenter",   scene: "Pop" },

  // ── R&B / Soul ──
  { name: "The Weeknd",          scene: "R&B / Soul" },
  { name: "SZA",                 scene: "R&B / Soul" },
  { name: "Frank Ocean",         scene: "R&B / Soul" },
  { name: "Daniel Caesar",       scene: "R&B / Soul" },
  { name: "Steve Lacy",          scene: "R&B / Soul" },
  { name: "Brent Faiyaz",        scene: "R&B / Soul" },
  { name: "Beyoncé",             scene: "R&B / Soul" },

  // ── Indie / Alternative ──
  { name: "Tame Impala",         scene: "Indie / Alternative" },
  { name: "Arctic Monkeys",      scene: "Indie / Alternative" },
  { name: "The Strokes",         scene: "Indie / Alternative" },
  { name: "Mac DeMarco",         scene: "Indie / Alternative" },
  { name: "Clairo",              scene: "Indie / Alternative" },
  { name: "Beabadoobee",         scene: "Indie / Alternative" },
  { name: "Phoebe Bridgers",     scene: "Indie / Alternative" },
  { name: "Boygenius",           scene: "Indie / Alternative" },

  // ── Rock ──
  { name: "Radiohead",           scene: "Rock" },
  { name: "Pink Floyd",          scene: "Rock" },
  { name: "Fleetwood Mac",       scene: "Rock" },
  { name: "Led Zeppelin",        scene: "Rock" },
  { name: "Nirvana",             scene: "Rock" },
  { name: "The Beatles",         scene: "Rock" },
  { name: "Red Hot Chili Peppers", scene: "Rock" },

  // ── Electronic ──
  { name: "Daft Punk",           scene: "Electronic" },
  { name: "Fred again..",        scene: "Electronic" },
  { name: "ODESZA",              scene: "Electronic" },
  { name: "Flume",               scene: "Electronic" },
  { name: "Disclosure",          scene: "Electronic" },
  { name: "Aphex Twin",          scene: "Electronic" },

  // ── Country / Folk ──
  { name: "Zach Bryan",          scene: "Country / Folk" },
  { name: "Noah Kahan",          scene: "Country / Folk" },
  { name: "Morgan Wallen",       scene: "Country / Folk" },
  { name: "Hozier",              scene: "Country / Folk" },
  { name: "Bon Iver",            scene: "Country / Folk" },

  // ── Latin ──
  { name: "Bad Bunny",           scene: "Latin" },
  { name: "Karol G",             scene: "Latin" },
  { name: "Peso Pluma",          scene: "Latin" },
  { name: "Rauw Alejandro",      scene: "Latin" },
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
