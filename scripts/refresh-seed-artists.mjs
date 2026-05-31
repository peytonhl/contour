#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Monthly seed-artist roster refresh.
//
// Re-derives the onboarding artist picker list (frontend/src/data/seedArtists.js)
// from Apple's per-genre "Top Songs" RSS feeds, resolves each artist's photo via
// our own /artists/search endpoint (Spotify CDN, same shape the file already
// uses), and rewrites ONLY the `export const SEED_ARTISTS = [ … ]` block —
// leaving the hand-written header docs, scene list, and grouping fn untouched.
//
// Run by .github/workflows/refresh-seed-artists.yml on the 1st of each month
// (and on-demand via workflow_dispatch). The workflow opens a PR, emails Peyton,
// and — on SCHEDULED runs only — auto-merges when the change is clean
// (autoMergeEligible below). Manual runs always open a PR for review.
//
// WHY APPLE RSS (and not Deezer or Last.fm):
//   • Deezer's /chart/{genre_id}/artists IGNORES the genre id — every genre
//     returns the identical global chart, full of SEO/spam. Verified dead
//     2026-05-31.
//   • Last.fm tag.getTopArtists is clean but needs an API key we don't have
//     configured (no LASTFM_API_KEY in env or repo secrets).
//   • Apple's legacy iTunes RSS is KEYLESS, genuinely genre-segmented, and
//     reflects current charts — verified end-to-end 2026-05-31.
//
// FAKE-ARTIST GUARD: Apple returns collab labels ("Drake, Future & Molly
// Santana") and the occasional SEO oddity. Every candidate is resolved through
// /artists/search and kept ONLY when it CONFIDENTLY matches a real Spotify
// artist (exact normalized name, or one name a clean substring of the other)
// AND that artist has a Spotify photo. We do NOT fall back to "first search
// hit" — that was the path that let a mis-resolved/wrong artist slip in. Names
// that don't confidently resolve are dropped.
//
// Honest limit: Spotify strips artist popularity at our API tier, so a name
// that's genuinely charting but obscure can still pass (it's a real artist with
// a real photo — just not famous). Chart-order bias (we take the top of each
// genre feed), the monthly PR review, and the PINS list are the safeguards for
// that; this script can't rank by fame.
//
// No API key required. Local testing:
//   node scripts/refresh-seed-artists.mjs --dry-run
//   → writes a preview file + _quality.json; the real seedArtists.js is
//     left untouched.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const SEED_FILE = path.join(REPO_ROOT, "frontend", "src", "data", "seedArtists.js");
const QUALITY_FILE = path.join(REPO_ROOT, "_quality.json");

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

// Always-keep pins (escape hatch for hand-curation). Names here are force-
// included in their scene even if they fall off the chart this month. Default
// empty — fully chart-derived. Add { name, scene } to protect a favorite.
const PINS = [
  // { name: "Phoebe Bridgers", scene: "Indie / Alternative" },
];

// Sanity floors — if a refresh comes back thinner than this (Apple outage, CI
// network blip, or the confident-match filter dropping too much), ABORT without
// writing rather than nuke the roster. The PR simply won't open that month.
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

// Retry-with-backoff. Both sources can throw a transient 429/503/empty body; an
// unattended monthly run must ride through that rather than treat it as "this
// artist doesn't exist" and silently thin the roster. 3 tries, 1.5s → 3s → 6s.
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
// → "Drake". Only used as a fallback when the full label doesn't resolve.
function primaryArtist(label) {
  return String(label)
    .split(/\s+(?:&|feat\.?|featuring|with|x|vs\.?|,)\s+/i)[0]
    .trim();
}

// A search hit "confidently" matches the query when the normalized names are
// equal, or one is a clean substring of the other with the shorter being
// >= 4 chars (guards against "Eve" matching "Steve", etc.). NO blind
// first-hit fallback — that's the anti-fake-artist rule.
function confidentMatch(queryNorm, candidateName) {
  const cand = norm(candidateName);
  if (!cand || !queryNorm) return false;
  if (cand === queryNorm) return true;
  const [short, long] = cand.length <= queryNorm.length ? [cand, queryNorm] : [queryNorm, cand];
  return short.length >= 4 && long.includes(short);
}

// Resolve an artist label to { name (canonical), image } via /artists/search.
// Tries the full label, then the primary artist. Returns null unless a hit
// CONFIDENTLY matches and has a Spotify photo — dropping the candidate.
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
    const pick = arts.find((a) => confidentMatch(want, a.name));
    if (!pick) continue; // no confident match for this query → try primary, else drop
    const image = pick.image_url || pick.image;
    if (!image || !/^https:\/\/i\.scdn\.co\/image\//.test(image)) continue;
    return { name: pick.name, image };
  }
  return null;
}

async function buildRoster() {
  const entries = [];
  const seen = new Set(); // dedupe across scenes by canonical name

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
      if (seen.has(norm(r.name))) continue;
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
  const m = src.match(/export const SEED_ARTIST_SCENES = \[([\s\S]*?)\]/);
  if (!m) throw new Error("SEED_ARTIST_SCENES not found in seed file");
  const declared = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const missing = SCENES.map((s) => s.scene).filter((s) => !declared.includes(s));
  if (missing.length) {
    throw new Error(`SCENES not in SEED_ARTIST_SCENES: ${missing.join(", ")} — update one to match the other`);
  }
}

// Names inside the OLD `export const SEED_ARTISTS = [ … ]` block, scoped to the
// block (NOT the whole file) so header-comment text can't pollute the diff.
function namesInBlock(block) {
  return [...block.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
}

async function main() {
  const src = fs.readFileSync(SEED_FILE, "utf8");
  validateSceneSync(src);

  const startMarker = "export const SEED_ARTISTS = [";
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) throw new Error("SEED_ARTISTS marker not found");
  const endIdx = src.indexOf("\n];", startIdx);
  if (endIdx === -1) throw new Error("end of SEED_ARTISTS array not found");
  const before = src.slice(0, startIdx);
  const oldBlock = src.slice(startIdx, endIdx);
  const after = src.slice(endIdx + 3); // skip "\n];"

  console.log(`Refreshing roster from Apple genre charts (backend: ${BACKEND})…`);
  const entries = await buildRoster();

  const perScene = {};
  for (const e of entries) perScene[e.scene] = (perScene[e.scene] || 0) + 1;

  const thinScenes = SCENES.filter((s) => (perScene[s.scene] || 0) < MIN_PER_SCENE)
    .map((s) => `${s.scene}=${perScene[s.scene] || 0}`);
  if (entries.length < MIN_TOTAL || thinScenes.length) {
    console.error(
      `ABORT: roster too thin (total=${entries.length}, min=${MIN_TOTAL}` +
      (thinScenes.length ? `; under-${MIN_PER_SCENE} scenes: ${thinScenes.join(", ")}` : "") +
      "). Not writing — likely a transient Apple/backend issue or the confident-match filter dropped too much."
    );
    process.exit(2);
  }

  const block = renderBlock(entries);
  const next = before + block + after;

  // ── Diff vs current (block-scoped) — informational only ──
  const oldNames = namesInBlock(oldBlock);
  const newNames = entries.map((e) => e.name);
  const oldSet = new Set(oldNames.map(norm));
  const newSet = new Set(newNames.map(norm));
  const added = newNames.filter((n) => !oldSet.has(norm(n)));
  const removed = oldNames.filter((n) => !newSet.has(norm(n)));
  const kept = oldNames.filter((n) => newSet.has(norm(n))).length;
  const unionChanged = added.length + removed.length;
  const churn = unionChanged === 0 ? 0 : unionChanged / (kept + added.length + removed.length);

  // Auto-merge gate: purely about QUALITY, not how much changed. Every entry is
  // already a confident Spotify match with a photo (resolveArtist guarantees
  // it), so the remaining checks are: there's a change, all photos valid, all
  // scenes balanced, total above the floor. NO churn limit by design — a big
  // monthly shake-up is fine as long as the artists are real. (Manual runs
  // still open a PR for review; only the scheduled run consults this to merge.)
  const allImagesValid = entries.every((e) => /^https:\/\/i\.scdn\.co\/image\//.test(e.image || ""));
  const allScenesBalanced = SCENES.every((s) => (perScene[s.scene] || 0) >= MIN_PER_SCENE);
  const changed = next !== src;
  const autoMergeEligible = changed && allImagesValid && allScenesBalanced && entries.length >= MIN_TOTAL;

  const quality = {
    changed,
    total: entries.length,
    perScene,
    added,
    removed,
    keptCount: kept,
    churn: Number(churn.toFixed(3)), // reported for the PR body; NOT a gate
    allImagesValid,
    allScenesBalanced,
    autoMergeEligible,
  };
  fs.writeFileSync(QUALITY_FILE, JSON.stringify(quality, null, 1));

  console.log(`\n── Summary ──`);
  console.log(`total: ${entries.length}  kept ${kept}  added ${added.length}  removed ${removed.length}  churn ${(churn * 100).toFixed(0)}% (info)`);
  if (added.length) console.log(`  + ${added.join(", ")}`);
  if (removed.length) console.log(`  - ${removed.join(", ")}`);
  console.log(`autoMergeEligible: ${autoMergeEligible} (imagesValid ${allImagesValid}, balanced ${allScenesBalanced}, total>=${MIN_TOTAL})`);

  if (DRY_RUN) {
    fs.writeFileSync(path.join(REPO_ROOT, "seedArtists.preview.js"), next, "utf8");
    console.log(`\n[dry-run] wrote preview + _quality.json (real file untouched)`);
    return;
  }

  if (!changed) {
    console.log("\nNo change — roster identical to current. Nothing to write.");
    fs.writeFileSync(path.join(REPO_ROOT, ".seed-refresh-nochange"), "1");
    return;
  }
  fs.writeFileSync(SEED_FILE, next, "utf8");
  console.log(`\nWrote ${SEED_FILE}`);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
