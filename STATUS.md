# Social-First Pivot — Status

Tracking progress on the social-first pivot + GTM milestone.
See the milestone plan in chat for full task descriptions.

## Tasks

### ✅ Task 1 — Reposition era-adjustment as contextual
**Shipped:** 2026-05-11

- New `EraAdjustedStat` component (`frontend/src/components/EraAdjustedStat.jsx`) — inline
  hero stat with on-click popover; `onOpen` callback hook ready for the PostHog
  `era_adjustment_viewed` event (Task 2).
- `AlbumPage`: replaced the large `EraCallout` banner with the inline stat in the
  hero stats row; `TrajectoryChart` moved below the tracklist (below the fold).
- `TrackPage`: same pattern — inline stat in hero, chart moved below `ReviewSection`.
- `ArtistPage`: small inline "Era Score: X" badge next to the artist name
  (only renders when era-adjusted total is meaningfully higher than raw catalog total).
- `Layout`: primary nav reordered to **Feed → Search → For You → Profile** on the
  mobile bottom bar. Charts demoted to secondary position (still in desktop top nav and
  reachable via `/charts`). "Community" renamed to "Feed".
- Removed dead code: `EraCallout.jsx`, unused `ChartsIcon` in `Layout.jsx`.
- Normalization service, MAU table, and trajectory modeling were not touched.

Verification: `npx vite build` succeeds; no console errors expected.

### ⏳ Task 2 — PostHog + Vercel Analytics
Pending. Will gate on `VITE_POSTHOG_KEY` env var (Section A item 1).

### ⏳ Task 3 — Mobile UX audit and fixes
Pending.

### ⏳ Task 4 — Apple Music deep links
Pending. Will gate on Apple Music developer token (Section A item 8).

### ⏳ Task 5 — Sign in with Apple
Pending. Will gate on Apple Service ID + private key (Section A item 8).

### ⏳ Task 7 — Play Store packaging prep
Pending.

### ⏳ Task 8 — App Store packaging prep
Pending. Sequenced after Task 7.

### ⏳ Task 6 — Non-goals documented
Pending (slated for the end).

---

## Notes for Peyton

Each task below pushes incrementally to `social-first-pivot` and merges to `master`
directly (per CLAUDE.md and the chat-clarified workflow). Railway + Vercel will
auto-deploy on each `master` push.
