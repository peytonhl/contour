#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Monthly seed-artist roster refresh.
//
// Re-derives the onboarding artist picker list (frontend/src/data/seedArtists.js)
// from Apple's per-genre "Top Songs" RSS feeds, resolves each artist's photo via
// our own /artists/search endpoint (Spotify CDN, same shape the file already
// uses), and rewrites ONLY the `export const SEED_ARTISTS = [ … ]` block —
// leaving the hand-written header docs, SEED_ARTIST_SCENES, and
// groupedSeedArtists() untouched.
//
// Run by .github/workflows/refresh-seed-artists.yml on the 1st of each month
// (and on-demand via workflow_dispatch). The workflow opens a PR; nothing
// auto-merges, so a human reviews the new roster before it deploys.
//
// WHY APPLE RSS (and not Deezer or Last.fm):
//   • Deezer's /chart/{genre_id}/artists IGNORES the genre id — every genre
//     returns the identical global chart, itself full of SEO/spam artists
//     ("Thao Sam", "BETH COSTANZO"). Verified dead 2026-05-31.
//   • Last.fm tag.getTopArtists is clean + genre-segmented BUT needs an API key
//     we don't have configured (no LASTFM_API_KEY in env or repo secrets).
//   • Apple's legacy iTunes RSS (itunes.apple.com/us/rss/topsongs/genre=ID) is
//     KEYLESS, genuinely genre-segmented, and reflects what's CURRENTLY charting
//     — exactly what "re-derive the roster monthly" wants. Verified 2026-05-31.
//
// Apple returns collab labels ("BigXthaPlug & Ella Langley", "Drake, Future &
// Molly Santana"); we resolve the full label first, then fall back to the
// primary artist (the segment before & / feat / x). Every candidate is validated
// through /artists/search and dropped if it doesn't resolve to a real artist
// with a Spotify photo — the junk filter AND the source of the baked-in image.
//
// No API key required. Local testing:
//   node scripts/refresh-seed-artists.mjs --dry-run
//   → writes a preview file; the real seedArtists.js is left untouched.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.join(__dirname, "..", "frontend", "src", "data", "seedArtists.js");

const BACKEND = process.env.CONTOUR_BACKEND || "https://contour-production.up.railway.app";
const DRY_RUN = process.argv.includes("--dry-run");

// Scene → Apple iTunes genre id + how many artists to take. Order here is the
// order scenes appear in the picker (must stay in sync with SEED_ARTIST_SCENES
// in seedArtists.js — asserted below). Genre ids verified by eyeballing each
// feed's artists 2026-05-31:
//   18 Hip-Hop/Rap · 14 Pop · 15 R&B/Soul · 20 Alternative · 21 Rock ·
//    7 Electronic · 6 Country · 12 Latin
const SCENES = [
  { scene: "Hip-Hop / Rap",        genre: 18, count: 8 },
  { scene: "Pop",                  genre: 14, count: 8 },
  { scene: "R&B / Soul",           genre: 15, count: 7 },
  { scene: "Indie / Alternative",  genre: 20, count: 8 },
  { scene: "Rock",                 genre: 21, count: 7 },
  { scene: "Electronic",           genre: 7,  count: 6 },
  { scene: "Country / Folk",       genre: 6,  count: 6 },
  { scene: "Latin",                genre: 12, count: 4 },
];

// Always-keep pins (escape hatch for hand-curation). Names listed here are
// force-included in their scene even if they fall off the chart this month.
// Default empty — the roster is fully chart-derived. Add { name, scene } here
// if you want a recruiting-community favorite to never drop out.
const PINS = [
  // { name: "Phoebe Bridgers", scene: "Indie / Alternative" },
];

// Sanity floors — if a refresh comes back thinner than this (e.g. Apple feed
// outage, network blip in CI), ABORT without writing rather than nuke the
// roster down to a handful. The PR simply won't open that month.
const MIN_TOTAL = 30;
const MIN_PER_SCENE = 3;

const SLEEP_MS = 1500; // throttle /artists/search (rate-limited)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSONOnce(url, { timeout = 20000, ua = "contour-seed-refresh/1.0" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Retry-with-backoff. Both sources (Apple RSS, our /artists/search) can throw a
// transient 429/503/empty body; an unattended monthly run must ride through
// that rather than treat it as "this artist doesn't exist" and silently thin
// the roster. 3 tries, 1.5s → 3s → 6s.
async function getJSON(url, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const d = await getJSONOnce(url, opts);
      if (d && typeof d === "object") return d;
      lastErr = new Error("empty/non-object response");
    } catch (e) {
      lastErr = e;
    }
    await sleep(1500 * 2 ** attempt);
  }
  throw lastErr;
}

// Top artists currently charting in an Apple genre, in chart order, deduped.
async function appleGenreArtists(genreId, limit) {
  const u = `https://itunes.apple.com/us/rss/topsongs/limit=${limit}/genre=${genreId}/json`;
  const d = await getJSON(u);
  const out = [];
  for (const e of d?.feed?.entry || []) {
    const a = e?.["im:artist"]?.label;
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

// "BigXthaPlug & Ella Langley" → "BigXthaPlug"; "Drake, Future & Molly Santana"
// → "Drake". Leaves a solo name (incl. "Tyler, The Creator", which we resolve
// as the full label first) untouched. Only used as a fallback when the full
// label doesn't resolve.
function primaryArtist(label) {
  return String(label)
    .split(/\s+(?:&|feat\.?|featuring|with|x|vs\.?|,)\s+/i)[0]
    .trim();
}

// Resolve an artist label to { name (canonical), image } via /artists/search.
// Tries the full label, then the primary artist. Returns null if neither
// resolves to a real artist with a Spotify photo — dropping the candidate.
async function resolveArtist(label) {
  const tries = [label];
  const primary = primaryArtist(label);
  if (primary && norm(primary) !== norm(label)) tries.push(primary);

  for (const q of tries) {
    let arts;
    try {
      const d = await getJSON(`${BACKEND}/artists/search?q=${encodeURIComponent(q)}`);
      arts = Array.isArray(d) ? d : d?.artists || [];
    } catch (e) {
      console.warn(`  ! search failed for ${q}: ${e.message}`);
      continue;
    }
    const want = norm(q);
    const pick =
      arts.find((a) => norm(a.name) === want) ||
      arts.find((a) => norm(a.name).includes(want) || want.includes(norm(a.name))) ||
      arts[0];
    if (!pick) continue;
    const image = pick.image_url || pick.image;
    if (!image || !/^https:\/\/i\.scdn\.co\/image\//.test(image)) continue;
    const canonical = pick.name && norm(pick.name).length ? pick.name : q;
    return { name: canonical, image };
  }
  return null;
}

async function buildRoster() {
  const entries = [];
  const seen = new Set(); // dedupe across scenes by canonical name

  // Pins first so a pinned artist claims its slot/scene.
  for (const pin of PINS) {
    const r = await resolveArtist(pin.name);
    await sleep(SLEEP_MS);
    if (r && !seen.has(norm(r.name))) {
      seen.add(norm(r.name));
      entries.push({ name: r.name, scene: pin.scene, image: r.image });
      console.log(`  [pin] ${pin.scene}: ${r.name}`);
    } else {
      console.warn(`  ! pin unresolved: ${pin.name}`);
    }
  }

  for (const { scene, genre, count } of SCENES) {
    // Overfetch (collabs + dupes + unresolvable names thin the list out).
    let names = [];
    try {
      names = await appleGenreArtists(genre, Math.max(count * 4, 25));
    } catch (e) {
      console.warn(`  ! apple genre ${genre} failed: ${e.message}`);
    }

    let kept = entries.filter((e) => e.scene === scene).length; // pins already in
    for (const nm of names) {
      if (kept >= count) break;
      if (seen.has(norm(nm))) continue;
      const r = await resolveArtist(nm);
      await sleep(SLEEP_MS);
      if (!r) continue;
      if (seen.has(norm(r.name))) continue; // canonical-name dupe across scenes
      seen.add(norm(r.name));
      entries.push({ name: r.name, scene, image: r.image });
      kept++;
      console.log(`  ${scene}: ${r.name}`);
    }
  }
  return entries;
}

function renderBlock(entries) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const lines = ["export const SEED_ARTISTS = ["];
  for (const { scene } of SCENES) {
    const inScene = entries.filter((e) => e.scene === scene);
    if (!inScene.length) continue;
    lines.push(`  // ── ${scene} ──`);
    for (const e of inScene) {
      lines.push(`  { name: "${esc(e.name)}", scene: "${esc(e.scene)}", image: "${e.image}" },`);
    }
  }
  // any pinned/unknown scene not in SCENES order, appended
  const known = new Set(SCENES.map((s) => s.scene));
  const extras = entries.filter((e) => !known.has(e.scene));
  if (extras.length) {
    lines.push("  // ── Other ──");
    for (const e of extras) {
      lines.push(`  { name: "${esc(e.name)}", scene: "${esc(e.scene)}", image: "${e.image}" },`);
    }
  }
  lines.push("];");
  return lines.join("\n");
}

function validateSceneSync(src) {
  // The scenes we generate must all exist in SEED_ARTIST_SCENES, else the
  // picker would render them in a trailing fallback section.
  const m = src.match(/export const SEED_ARTIST_SCENES = \[([\s\S]*?)\]/);
  if (!m) throw new Error("SEED_ARTIST_SCENES not found in seed file");
  const declared = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const missing = SCENES.map((s) => s.scene).filter((s) => !declared.includes(s));
  if (missing.length) {
    throw new Error(`SCENES not in SEED_ARTIST_SCENES: ${missing.join(", ")} — update one to match the other`);
  }
}

async function main() {
  const src = fs.readFileSync(SEED_FILE, "utf8");
  validateSceneSync(src);

  // Locate the existing SEED_ARTISTS array block to replace it in place.
  const startMarker = "export const SEED_ARTISTS = [";
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) throw new Error("SEED_ARTISTS marker not found");
  const endIdx = src.indexOf("\n];", startIdx);
  if (endIdx === -1) throw new Error("end of SEED_ARTISTS array not found");
  const before = src.slice(0, startIdx);
  const after = src.slice(endIdx + 3); // skip "\n];"

  console.log(`Refreshing roster from Apple genre charts (backend: ${BACKEND})…`);
  const entries = await buildRoster();

  // Sanity floors.
  const perScene = {};
  for (const e of entries) perScene[e.scene] = (perScene[e.scene] || 0) + 1;
  if (process.env.SEED_DIAG) {
    fs.writeFileSync(
      path.join(__dirname, "..", "_diag.json"),
      JSON.stringify({ total: entries.length, perScene }, null, 1)
    );
  }
  const thinScenes = SCENES.filter((s) => (perScene[s.scene] || 0) < MIN_PER_SCENE)
    .map((s) => `${s.scene}=${perScene[s.scene] || 0}`);
  if (entries.length < MIN_TOTAL || thinScenes.length) {
    console.error(
      `ABORT: roster too thin (total=${entries.length}, min=${MIN_TOTAL}` +
      (thinScenes.length ? `; under-${MIN_PER_SCENE} scenes: ${thinScenes.join(", ")}` : "") +
      "). Not writing — likely a transient Apple/backend issue."
    );
    process.exit(2);
  }

  const block = renderBlock(entries);
  const next = before + block + after;

  // Count diff vs current for the summary.
  const oldNames = [...src.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1])
    .filter((n) => src.indexOf(`name: "${n}"`) < src.indexOf("SEED_ARTIST_SCENES"));
  const newNames = entries.map((e) => e.name);
  const added = newNames.filter((n) => !oldNames.includes(n));
  const removed = oldNames.filter((n) => !newNames.includes(n));

  console.log(`\n── Summary ──`);
  console.log(`total: ${entries.length}  (added ${added.length}, removed ${removed.length})`);
  if (added.length) console.log(`  + ${added.join(", ")}`);
  if (removed.length) console.log(`  - ${removed.join(", ")}`);

  if (DRY_RUN) {
    const tmp = path.join(__dirname, "..", "seedArtists.preview.js");
    fs.writeFileSync(tmp, next, "utf8");
    console.log(`\n[dry-run] wrote preview to ${tmp} (real file untouched)`);
    return;
  }

  if (next === src) {
    console.log("\nNo change — roster identical to current. Nothing to write.");
    fs.writeFileSync(path.join(__dirname, "..", ".seed-refresh-nochange"), "1");
    return;
  }
  fs.writeFileSync(SEED_FILE, next, "utf8");
  console.log(`\nWrote ${SEED_FILE}`);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
