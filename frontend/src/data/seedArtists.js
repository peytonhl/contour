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
  { name: "BigXthaPlug", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5ebd6453796533f46670f34ceb8" },
  { name: "Tyla", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5eb69719e4164b893213a525d25" },
  { name: "Lil Durk", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5eb09791422702c3fa9780468d4" },
  { name: "Outkast", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5eb0cb3f95b9f8f7337e135a925" },
  { name: "Wiz Khalifa", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5ebc66b0a8c3268f0b6556f64a8" },
  { name: "Macklemore", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab6761610000e5eb488b3b242f97163a7f8e17b9" },
  { name: "House Of Pain", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/8a7bfc19ffcd5384221a81b3394c8b0c4959feaa" },
  { name: "Marco Cartwright", scene: "Hip-Hop / Rap", image: "https://i.scdn.co/image/ab67616d0000b27313d5586963f64ebc064a1bda" },
  // ── Pop ──
  { name: "Ariana Grande", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb766397ec42a573a53eb5fb87" },
  { name: "Bruno Mars", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5ebc7688aad1bf03986934d7e26" },
  { name: "Michael Jackson", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb997cc9a4aec335d46c9481fd" },
  { name: "Olivia Dean", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb5c7577ad44daeb7ce4b941a1" },
  { name: "EJAE", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb126261d917be27ceaf9046e3" },
  { name: "Harry Styles", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5ebe309f8c3056a59f20d0968ca" },
  { name: "Olivia Rodrigo", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5ebe654806251e2661def1f4e65" },
  { name: "G Flip", scene: "Pop", image: "https://i.scdn.co/image/ab6761610000e5eb77b9ae4945e9f784253b2af0" },
  // ── R&B / Soul ──
  { name: "The Gap Band", scene: "R&B / Soul", image: "https://i.scdn.co/image/968c983e1a7a274bee42653bb7c2f8e832ccd16e" },
  { name: "Bill Withers", scene: "R&B / Soul", image: "https://i.scdn.co/image/96b85aec6907206572527e1eeec6569d5e977a38" },
  { name: "Earth, Wind & Fire", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5eb9722e16a886767adf1178f92" },
  { name: "The Weeknd", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5ebc1719ac9e6a75c1c25835018" },
  { name: "Foster Sylvers", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab67616d0000b273a33024af69e0bcf087d3e20a" },
  { name: "Whitney Houston", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5ebcd9f60ab57585bf3b77ecc51" },
  { name: "Kehlani", scene: "R&B / Soul", image: "https://i.scdn.co/image/ab6761610000e5ebcf865d7d399a41e1bd036149" },
  // ── Indie / Alternative ──
  { name: "The Beaches", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5ebc011b6c30a684a084618e20b" },
  { name: "Ella Bright", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb2f824d51c925fa0bef13211b" },
  { name: "Noah Kahan", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb5b141d30d14fb78458dac5ce" },
  { name: "Mumford & Sons", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb00fe341805b27976b4302be0" },
  { name: "American Authors", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb76fa6126d926bd6302239aba" },
  { name: "Djo", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb4113d395582d3667b7978430" },
  { name: "Twenty One Pilots", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb61a7ea26d33ded218cd1e59d" },
  { name: "sombr", scene: "Indie / Alternative", image: "https://i.scdn.co/image/ab6761610000e5eb78edaa6468cae153565c2c97" },
  // ── Rock ──
  { name: "Dexter and The Moonrocks", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5eb78591b14cbfa7772f449a627" },
  { name: "Fleetwood Mac", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5ebc8752dd511cda8c31e9daee8" },
  { name: "A Perfect Circle", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5eb5011bfcb59463d911b3e6be1" },
  { name: "The Goo Goo Dolls", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5ebe7b66b8c4ba729848574df7a" },
  { name: "The Killers", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5eb207b21f3ed0ee96adce3166a" },
  { name: "CortexUS", scene: "Rock", image: "https://i.scdn.co/image/ab67616d0000b2737e3ec0e87322212e81550468" },
  { name: "AC/DC", scene: "Rock", image: "https://i.scdn.co/image/ab6761610000e5ebc4c77549095c86acb4e77b37" },
  // ── Electronic ──
  { name: "Josh Fawaz", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5eb36456dc85636c8b735e07793" },
  { name: "HUGEL", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5ebb02f6c6948dd082ff04b2a86" },
  { name: "Mizmo", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5ebcad39cb35ee5821a0c926548" },
  { name: "Empire Of The Sun", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5ebc806f3e714afa21861e20248" },
  { name: "M83", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5eb961ef259d6d8101edd2f80c0" },
  { name: "NOVEMBER KID", scene: "Electronic", image: "https://i.scdn.co/image/ab6761610000e5eb467e144c696842c30ebdcce5" },
  // ── Country / Folk ──
  { name: "Ella Langley", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5ebc4670378a4188c3174ef2ca9" },
  { name: "STELLA LEFTY", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5ebcbcd28b97defa1ada8c06d6c" },
  { name: "Riley Green", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5eb27756c7300095b1e65f3718a" },
  { name: "Cameron Whitcomb", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5eb712f78798ce31073c16673c8" },
  { name: "Luke Combs", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5eb147f54ed9d9d5f98efdfddd2" },
  { name: "Red Grizz", scene: "Country / Folk", image: "https://i.scdn.co/image/ab6761610000e5eb3bbe58d852ffc655c26a0409" },
  // ── Latin ──
  { name: "Don Omar", scene: "Latin", image: "https://i.scdn.co/image/ab6761610000e5eb7ef745018ee8093fb00cd71f" },
  { name: "Shakira", scene: "Latin", image: "https://i.scdn.co/image/ab6761610000e5eb17f15f351cba70561ad8bcac" },
  { name: "Bad Bunny", scene: "Latin", image: "https://i.scdn.co/image/ab6761610000e5eb81f47f44084e0a09b5f0fa13" },
  { name: "Emmanuel Cortes", scene: "Latin", image: "https://i.scdn.co/image/ab6761610000e5eb335d1e5be20da26177116e41" },
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
