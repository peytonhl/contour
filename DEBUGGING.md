# Debugging — Methodology + Runbooks

Written after the 2026-05-13/14 swipe-deck debugging session that took ~4
hours and 6+ Vercel pushes to land a one-line fix. The lessons here would
have collapsed that to ~30 minutes. Read this before debugging mobile UI,
CSS layout, or anything iOS-specific.

---

## Core principles

### 1. Confirm the bug location before patching

Before any code change, answer these:

- **Does the bug exist on `master` / prod, or only on your branch?**
  If you don't know, your branch's "regression" might be pre-existing.
  Visit `contour-rosy.vercel.app` and reproduce. If it's broken there too,
  your branch isn't introducing the bug — stop pushing fixes to your branch
  and debug master.

- **Has the bug been verified on the same surface the user is testing?**
  iPhone Safari ≠ Firefox iOS ≠ Capacitor app ≠ Desktop browser. WebKit is
  the same, but URL bars / safe-area handling differ. Match the user's
  surface, or test all three.

- **What changed between the last working state and now?** `git log --oneline -10 <file>` on the affected file. Bisect from there.

If you don't have a confirmed reproduction on a known surface against a
known commit, you're guessing. Stop and clarify.

### 2. Bisect by *removing*, not by adding

The temptation when a fix doesn't work is to layer on another fix. Don't.

- Each new fix can introduce its own regression
- You end up with no idea which of N changes was the actual problem
- Tonight's session: we shipped a "render-time clamp" AND a "non-passive
  touchmove listener" together. Both broke things; one of them broke
  forward swipe. We couldn't tell which until we reverted one at a time.

**Correct pattern:**
1. Identify the smallest change that introduced the bug
2. Revert exactly that change
3. Verify the bug is gone
4. If still present, the bug was elsewhere — keep reverting

The session's actual fix was *removing* one CSS line (`contain: layout
paint`). Every "fix" we pushed before that was adding stuff that didn't
help. Working backward toward the master baseline is faster than forward.

### 3. Make state visible before guessing about state

You cannot debug what you cannot see. Mobile Safari/Firefox does not give
you the JS console without a Mac tethered. Your tools:

- **On-device debug overlay** — see [Mobile gesture debugging](#mobile-gesture-debugging) below
- **Visible color-coded indicators** for component mount state
- **Live state readout** as a red/black box in a corner

The session breakthrough was when we added the overlay and the user
reported `idx:1 drag:0 t:N d:Y tracks:10` — that told us the state machine
worked perfectly, and the bug had to be render-side. Until then we were
flailing.

---

## Mobile gesture debugging

When debugging swipe / touch / gesture behavior on iPhone:

### Build a state-readout overlay

Drop this into the component being debugged. It's intentionally ugly — that
means it's visible.

```jsx
<div style={{
  position: "fixed", top: 8, right: 8, zIndex: 9999,
  background: "rgba(255,0,0,0.85)", color: "#fff",
  padding: "4px 8px", borderRadius: 4,
  fontSize: 11, fontFamily: "monospace", lineHeight: 1.3,
  pointerEvents: "none",
}}>
  idx:{activeIdx} drag:{dragOffset.toFixed(0)} t:{transitioning?"Y":"N"} d:{dragging?"Y":"N"}<br/>
  tracks:{tracks.length} active:{tracks[activeIdx]?.name?.slice(0,18)}
</div>
```

### Walk the gesture chain with concrete readings

Ask the user for 4 readings, not vague impressions:

1. **Initial state** (before touching) — confirms the component mounted with
   the expected starting values
2. **Mid-drag** (finger down, moving, before lifting) — confirms touchmove
   fires and state updates respond
3. **Right after lifting** — confirms touchend triggers the navigation
   commit (transitioning goes Y, then completes)
4. **A few seconds later** — confirms the final committed state is stable
   and doesn't drift

If any reading doesn't match the expectation, the bug is in the
corresponding handler. If all readings match but the visual is wrong, the
bug is render-side.

### When state is right but render is wrong

That means the DOM has the right tree but it's invisible. Add visual
markers to the rendered tree:

```jsx
{/* Bright color banner inside each card so we can see if cards render */}
<div style={{
  position: "absolute", top: 0, left: 0, right: 0, height: 60,
  zIndex: 99999, background: i === 0 ? "magenta" : "cyan",
  pointerEvents: "none",
}}>
  i={i} {i === activeIdx ? "ACTIVE" : "neighbor"}
</div>
```

If the banner is visible after a gesture → DOM mounted, child component is
the bug. If the banner is missing → DOM not mounted OR clipped by ancestor.

---

## CSS containment + transforms — the trap we hit

The 2026-05-14 forward-swipe bug was `contain: layout paint` on the deck
wrapper. Per CSS spec, paint containment behaves like `overflow: hidden`
against the element's **un-transformed** border box.

If children are positioned via `transform: translate3d`, they sit at
positions that are *visually* offset from the element's static box. Paint
containment clips against the static box, not the visual position. Result:
children that should be visible (because the parent transformed) get
paint-clipped instead.

**Symptoms:**
- Parent looks fine in dev tools
- Children are in the DOM, mounted, with correct state
- But the visual area is blank or shows the parent's background
- Only happens after a transform takes effect

**Fix:** drop `contain: paint` (and usually `contain: layout` along with
it). If you need paint isolation for perf, do it at the parent of the
transformed wrapper, not on the transformed wrapper itself.

**Where else this can bite:**
- TikTok-style swipe decks (it bit us here)
- Carousels with translate-based sliding
- Modal/sheet animations using transform
- Any element where children are positioned by transform but the parent
  isn't moving

---

## iOS Safari + viewport / safe-area quirks

iOS Safari has behaviors that don't exist in other browsers:

### URL bar collapses on upward gestures

Even when the document has `overflow: hidden` and shouldn't be scrolling,
iOS Safari opportunistically hides the URL bar on upward swipes. This
changes:

- Layout viewport height (gets larger)
- `env(safe-area-inset-top)` value (may shift)
- `position: fixed` elements anchored to `top: env(safe-area-inset-top)`
  re-anchor and may expose a gap above

**Detection:** if a chrome element looks fine before a swipe but a gap
appears after, this is very likely the cause.

**Fix pattern:** anchor full-bleed surfaces to `top: 0`, then push content
below the status bar via `paddingTop: env(safe-area-inset-top)`. The
background extends into the safe area as continuous chrome instead of
re-anchoring on URL-bar state changes.

```jsx
<div style={{
  position: "fixed",
  top: 0,                                       // not env(safe-area-inset-top)
  left: 0, right: 0,
  bottom: "calc(56px + env(safe-area-inset-bottom, 0px))",
}}>
  <header style={{
    paddingTop: "env(safe-area-inset-top, 0px)", // push content below notch
  }}>
    {/* content */}
  </header>
</div>
```

### `touch-action: none` can suppress your gesture handlers

We tried `touch-action: none` to kill the rubber-band on a swipe deck.
That suppressed the touchend → JS-advance gesture sequence entirely —
forward swipe broke completely. Use `touch-action: pan-y` for vertical
swipe decks; iOS will still let your touchstart/move/end handlers fire.

### `position: fixed` on body breaks deck gestures

Tried this to suppress rubber-band. Killed forward swipe in some
hard-to-diagnose way. Use `overflow: hidden` on body+html if you must,
or accept the rubber-band visual as a lower-priority issue.

---

## Local dev for mobile testing

When you need to iterate fast on the iPhone without pushing to Vercel:

### Stack

- Vite dev server with `--host` flag, exposes on the LAN IP
- Public tunnel so the phone can reach it on cellular too (AT&T routers
  enable AP isolation by default, blocking phone → laptop on Wi-Fi)
- iPhone Safari (or Firefox iOS — same WebKit) hitting the tunnel URL

### Setup steps

1. **In `frontend/vite.config.js`**, enable allowedHosts:

   ```js
   server: {
     allowedHosts: true,  // Vite 5+ blocks unknown Host headers by default
     proxy: {
       // Catch-all regex for all backend prefixes — simpler than listing each
       "^/(albums|tracks|artists|compare|comparisons|ratings|reviews|users|featured|feed|search|discover|leaderboard|notifications|taste|lists|imports|backlog|blocks|disliked|admin|trending|reports|health|auth|saved-comparisons)(/|$)": {
         target: "https://contour-production.up.railway.app",
         changeOrigin: true,
         secure: true,
       },
     },
   }
   ```

2. **In `frontend/.env.development.local`** (gitignored, overrides
   `.env.local`):

   ```
   VITE_API_URL=
   ```

   Empty value forces same-origin API calls that get proxied. **If you set
   it to the Railway URL directly, you'll hit CORS** because tunnel hosts
   aren't in the backend allowlist.

3. **Start Vite:**

   ```powershell
   cd frontend
   npm install   # only if you haven't
   npm run dev -- --host
   ```

4. **Start a public tunnel** (in a separate terminal):

   ```powershell
   npx --yes tunnelmole 5173
   ```

   Tunnelmole works without signup or interstitial. Localtunnel works but
   has a "tunnel password" interstitial that's annoying. Ngrok works but
   requires a signup. The tunnel prints a URL like
   `https://<random>-ip-<your-ip>.tunnelmole.net`.

5. **On the iPhone**, open that URL in Safari. HMR pushes file edits to
   the phone in ~1 second.

### Gotchas we hit

- **`.env.local` overrides `.env.development.local` in some cases**: Vite's
  env precedence is `.env` < `.env.local` < `.env.[mode]` < `.env.[mode].local`.
  Setting `VITE_API_URL=` (empty) in `.env.development.local` overrides a
  populated `.env.local`, but a commented-out line does NOT override —
  you have to set the var to empty, not just comment it.
- **CORS blocks direct hits to the Railway origin** from tunnel hostnames.
  The Vite proxy fixes this by making API calls same-origin from the
  browser's view. Don't try to point `VITE_API_URL` directly at Railway.
- **Capacitor iOS app can't see this preview**. The app loads
  `https://contour-rosy.vercel.app` hard-coded in `capacitor.config.json`.
  For testing in the app shell, you need to push to a Vercel branch and
  open the preview URL in Safari — the app shell itself only loads prod.
- **Firefox iOS = WebKit underneath**, so it behaves like Safari for
  gesture / CSS / viewport bugs. Useful as a secondary test.

---

## Vercel preview vs production

### Two URL types per branch

Vercel generates two kinds of URLs for any preview deployment:

- **Stable branch URL**: `contour-rosy-git-<branch-slug>-<owner>.vercel.app`
  — always serves the latest commit on the branch. When you push, this URL
  updates. Use this for ongoing testing.
- **Deployment-specific URL**: `contour-rosy-<hash>-<owner>.vercel.app` —
  pins to one specific build. Doesn't change when you push new commits.
  Useful for sharing a known state with someone, but if you bookmark this,
  you'll be looking at stale code after the next push.

If a user says "the preview is broken" check which URL form they're on.
We wasted ~15 minutes once because a hashed URL was bookmarked.

### Production state can lie

`master` is supposed to deploy automatically, but Vercel has a "promote to
production" action in the dashboard. If someone clicks that on a preview
deployment, prod will be serving that preview's code, not master.

Verify current production via the API:

```bash
gh api "repos/peytonhl/contour/deployments?per_page=5" --jq \
  '.[] | {sha: .sha[0:7], env: .environment, ref: .ref}'
```

Look for `env: "gallant-unity / production"` — that's the current prod sha.
Compare to `master` tip; if they differ, somebody promoted a preview.

### Rate limits (now moot since Pro)

The Hobby tier had a 100-build-per-day soft cap. We hit it during one
debugging session. **The app is now on Pro ($20/mo)** which has a 6000
build-minute monthly limit; you shouldn't hit it from normal iteration.

---

## React 18 + StrictMode gotchas in dev

`<StrictMode>` wraps the app in `main.jsx`. In **development only**, React
18 intentionally double-invokes:

- Component renders
- Effects (run, clean up, run again)
- Refs (called twice on mount)

This is to surface bugs (impure renders, missing cleanup). It can ALSO
confuse stateful gesture handlers — touchstart fires once, but the
component might have remounted between touchstart and touchmove, causing
the touchStartRef to be null.

**Symptom:** dev behavior differs from prod. Always test on a preview
deployment before assuming a bug is in your code.

**Fix:** if your handler closures need to survive a remount, use refs
(`useRef`) instead of state. Refs are stable across StrictMode remounts.

---

## Diagnostic checklist for "X is broken on mobile"

Walk this in order — each step is cheap and rules out a class of cause:

1. **Reproduce on the user's exact surface.** Same browser, same URL form,
   same iOS version if you can. If you can't reproduce, you can't fix.
2. **Reproduce on prod.** If the bug exists on prod, your branch isn't
   the cause. Stop iterating on the branch.
3. **Identify the regression commit.** `git log --oneline -10 <file>`,
   then check each one against the symptom.
4. **Build the on-screen debug overlay.** Get concrete state readings
   from the user, not vague descriptions.
5. **Disambiguate state vs render.** If state is right but render is
   wrong, the bug is CSS / containment / clipping. If state is wrong,
   the bug is in your event handlers.
6. **Bisect by reverting.** Smallest possible change to confirm the
   regression candidate, not new fixes.
7. **Build locally** (`npm run build` in `frontend/`) before pushing to
   make sure your fix compiles — JSX errors only show at build time.
8. **Test on the local tunnel before pushing.** HMR-driven iteration
   on the phone is 60× faster than push-and-wait.
9. **Push minimal commits.** One concept per commit. Easier to revert,
   easier to read in git log.
10. **Update this doc** if you learn something new the hard way.
