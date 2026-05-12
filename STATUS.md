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

### ✅ Task 2 — PostHog + Vercel Analytics
**Shipped:** 2026-05-11

- Installed `posthog-js` + `@vercel/analytics`.
- New `frontend/src/services/analytics.js` — thin wrapper. Silent no-op when
  `VITE_POSTHOG_KEY` is unset, so all `analytics.*()` calls are safe to leave in
  the code regardless of environment. Defaults host to `us.i.posthog.com`;
  override with `VITE_POSTHOG_HOST`.
- `main.jsx` initializes PostHog (autocapture + pageview + pageleave on) and
  wraps `<App />` with Vercel's `<Analytics />` component.
- `AuthContext` calls `identify` on login + after page reload with a stored
  token; `reset` on logout. First time a user is seen on a given device fires
  `signup_completed` with the appropriate provider.
- Google callback now passes `?provider=google` to `/auth/success` so the
  signup event gets a clean attribution; the frontend falls back to `"google"`
  if the param is absent (covers in-flight sessions during deploy).
- Twelve named events wired across the app. Catalog documented in `README.md`
  under the new "Analytics" section.
- `apple_music_link_clicked` will be wired in Task 4; everything else fires now.

Verification: production build succeeds (998 KB / 285 KB gzipped — +200 KB from
the new SDKs, acceptable for a launch SDK pair).


### ✅ Task 3 — Mobile UX audit and fixes (code-confident)
**Shipped:** 2026-05-11

**Fixed:**
- **Bottom nav tap targets:** explicit `min-height: 44px` on every tab (matches
  iOS HIG; the 56px bar already cleared it, but inline-style guarantees it per tab).
- **Above-the-fold rating CTA:** `★ Rate` is now the primary hero action on
  AlbumPage / TrackPage (purple/accent), Compare demoted to outlined secondary.
  Clicking smooth-scrolls to the `#rate-section` anchor on the ReviewSection.
- **Tighter hero/body padding on mobile:** new `.entity-hero` and `.entity-body`
  CSS classes override the desktop 36px/28px paddings with 20px/18px on viewports
  ≤ 640px, pulling the rating section ~30–40px closer to the fold.
- **Search input keyboard polish:** added `type="search"`, `inputMode="search"`,
  `enterKeyHint="search"`, plus `autoCapitalize`/`autoCorrect`/`spellCheck` off —
  gives mobile users the "Search" enter key and no autocorrect noise.

**Audited, no change needed:**
- Onboarding modal — skippable (backdrop click + explicit Skip button), all
  network calls are `.catch(() => {})` so it never blocks on errors. ✓
- Star widget — uses PointerEvents with `touchAction: "none"` + `userSelect: "none"`,
  single onPointerUp / onPointerMove handlers, no double-trigger risk. ✓
- iOS 16px input zoom prevention — already in place via `index.css` media query. ✓
- 300ms tap delay — already disabled via `touch-action: manipulation`. ✓
- Rating tap count — already 1 tap from album/track page to rating saved
  (excluding navigation onto the page itself). ✓

**Requires device verification (Peyton):**
- ForYouPage TikTok-style scroll smoothness — no obvious code issue but jank is
  device-dependent. If it stutters on a real phone, follow-up fix would add
  `will-change: transform` + `transform: translateZ(0)` to active cards.
- Search results overlap with keyboard on smaller iPhones — iOS Safari's visual
  viewport adjustment should handle this, but please confirm typing a query and
  scrolling the results dropdown feels right.
- Mobile hero padding tightening — visually verify the new spacing feels
  balanced; easy to dial in further if it looks cramped.

### ⏳ Task 4 — Apple Music deep links
Pending. Will gate on Apple Music developer token (Section A item 8).

### ✅ Task 5 — Sign in with Apple (skeleton, env-gated)
**Shipped:** 2026-05-11

End-to-end skeleton lands now. The endpoint, model, migration, frontend
button, and the full 10-case test suite are all in place. Flipping the
`APPLE_CLIENT_ID` env var on backend + `VITE_APPLE_CLIENT_ID` on frontend
activates everything — no further code work needed once you have the
Services ID from the Apple Developer portal.

**Backend:**
- `backend/services/apple_auth.py` — fetches and 24h-caches Apple's JWKS,
  verifies RS256-signed identity tokens (iss / aud / exp / nonce), and
  exposes `is_private_relay_email()` so callers don't link cross-provider
  accounts via privaterelay.appleid.com aliases. `jwks_fetcher` is injectable
  for tests.
- `backend/models.py` — new nullable unique `apple_sub` column on User.
- `backend/migrations/versions/i9j0k1l2m3n4_add_apple_sub.py` — Alembic
  migration adds the column + unique index. Will run automatically on next
  Railway deploy.
- `backend/routers/auth.py` — new `POST /auth/apple` endpoint with the full
  account-linking logic. Returns `503` when `APPLE_CLIENT_ID` is unset so the
  frontend can probe + hide the button. The Google `/auth/callback` was also
  extended with the mirror-image linking pass (if Google email matches an
  existing apple_sub user → link, don't duplicate). Private relay emails are
  excluded from cross-provider linking on both sides.
- `backend/requirements.txt` — added `cryptography` (PyJWT needs it for RS256),
  plus `pytest` / `pytest-asyncio` / `asgi-lifespan` for the test suite.

**Frontend:**
- `frontend/src/components/AppleSignInButton.jsx` — lazy-loads Apple's JS lib
  (`appleid.auth.js`), runs the popup flow with a fresh nonce, and POSTs the
  identity token + nonce + first-auth name to `/auth/apple`. Renders `null`
  when `VITE_APPLE_CLIENT_ID` is unset.
- Wired into `Layout.jsx` (desktop top nav + mobile header) and the SearchPage
  sign-in nudge, beside the Google button.
- `api.js` got an `appleSignIn(token, nonce, name)` helper.

**Tests (10/10 passing locally):**
- `backend/tests/test_auth_linking.py` covers all 10 scenarios specified —
  Google-fresh / Apple-fresh signups, both linking directions, private relay
  isolation, idempotent repeat sign-in, and the four token-validation
  failure modes (signature / exp / aud / iss).
- `backend/tests/conftest.py` provides an RSA keypair, JWKS monkeypatch,
  Google httpx mock, and a per-test in-memory SQLite session with the
  schema rebuilt every test.
- Run locally:
  `cd backend && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements.txt && pytest`

**Manual test checklist for live activation (run once keys are set):**
- [ ] Click Apple button on desktop → Apple popup opens, returns to home logged in.
- [ ] Same on iOS Safari mobile.
- [ ] Existing Google user signs in with Apple (same email) → no duplicate user
      (verify via /auth/profile or DB).
- [ ] Existing Apple user signs in with Google (same email) → no duplicate.
- [ ] Sign in with Apple, choose "Hide my email" → new account is created with
      relay email; sign in again with same Apple ID → same account returned.
- [ ] `signup_completed` event fires with `auth_provider=apple` in PostHog.

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
