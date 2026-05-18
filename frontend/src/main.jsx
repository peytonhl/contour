import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SplashScreen } from "@capacitor/splash-screen";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { initAnalytics } from "./services/analytics.js";
import { registerServiceWorker } from "./sw-register.js";
import App from "./App.jsx";
import "./index.css";

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY: splash-twitch diagnostic instrumentation.
//
// Two persistent fixes for the "Contour wordmark snaps around on launch"
// bug have shipped and both have been reported as not working. Per the
// debugging discipline in CLAUDE.md ("before writing a fix, instrument"),
// we now make the runtime state visible on screen so iOS users can
// screen-record the launch and we can read off the actual event
// sequence + wordmark coordinates instead of guessing.
//
// This block records into the #boot-debug overlay (see index.html):
//   - module-parse time (t≈0)
//   - native SplashScreen.hide() returned
//   - requestAnimationFrame fired
//   - document.fonts.ready resolved
//   - Instrument Serif specific load() resolved
//   - boot splash actually set display:none
//   - the boot-splash wordmark's getBoundingClientRect at each event
//   - the Layout-header wordmark's bbox once React renders it (polled)
//
// Remove this entire block (plus the .boot-debug styles + element in
// index.html) once we've diagnosed the snap. Search for "boot-debug" to
// find every touch point.
// ─────────────────────────────────────────────────────────────────────────────
const _bootDebugStart = performance.now();
const _bootDebugEl = document.getElementById("boot-debug");
let _bootDebugDismissed = false;

if (_bootDebugEl) {
  _bootDebugEl.addEventListener("click", () => {
    _bootDebugDismissed = true;
    _bootDebugEl.style.display = "none";
  });
}

function _bootDebug(label) {
  if (_bootDebugDismissed || !_bootDebugEl) return;
  const t = (performance.now() - _bootDebugStart).toFixed(0).padStart(4, " ");
  const splashWord = document.querySelector(".boot-splash__wordmark");
  const headerWord = document.querySelector(".app-header span");
  const fmtRect = (el) => {
    if (!el) return "—";
    const r = el.getBoundingClientRect();
    return `x=${r.left.toFixed(0)} y=${r.top.toFixed(0)} w=${r.width.toFixed(0)} h=${r.height.toFixed(0)}`;
  };
  const splash = document.getElementById("boot-splash");
  const splashDisplay = splash ? getComputedStyle(splash).display : "—";
  const line = document.createElement("div");
  line.textContent =
    `+${t}ms ${label}\n` +
    `      splash.display=${splashDisplay} splashWord=${fmtRect(splashWord)}\n` +
    `      headerWord=${fmtRect(headerWord)}`;
  _bootDebugEl.appendChild(line);
  _bootDebugEl.scrollTop = _bootDebugEl.scrollHeight;
}

_bootDebug("module parse");

// Poll for the Layout-header wordmark to appear (it materialises only
// after React mounts the Layout component). Logs the first time we see
// it so we can correlate against the splash-hide moment.
let _headerSeen = false;
const _headerPoll = setInterval(() => {
  if (_headerSeen || _bootDebugDismissed) {
    clearInterval(_headerPoll);
    return;
  }
  const headerWord = document.querySelector(".app-header span");
  if (headerWord && headerWord.getBoundingClientRect().width > 0) {
    _headerSeen = true;
    _bootDebug("layout header wordmark mounted");
    clearInterval(_headerPoll);
  }
}, 50);

initAnalytics();

// Cache JS/CSS bundles for instant repeat-launch. Skipped in dev to avoid
// fighting Vite HMR. First launch is unaffected; second-and-beyond cold
// starts load the bundle from disk in ~10ms instead of the network.
registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Analytics />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

// Hide the native LaunchScreen so the WebView (with our matching HTML boot
// splash) is visible. Without this the plugin stays up forever
// (launchAutoHide: false). The storyboard and the HTML boot splash are
// visually identical (Georgia 52pt "Contour" on #08080a), so the user sees
// one continuous wordmark from process launch through to here.
//
// fadeOutDuration: 0 — SNAP off, don't cross-fade. The plugin's default
// 200ms fade exposed both the native splash (fading) and the HTML splash
// (already at full opacity behind it) simultaneously; sub-pixel positioning
// differences between the storyboard's centerY and the HTML's flex-center
// inside the safe-area-inset showed up during the fade as the wordmark
// "ghosting" or "jumping." Pair this with the boot splash's negative
// safe-area offsets in index.html which align the two centers, and the
// snap is invisible.
//
// SplashScreen.hide() is a no-op on web — safe to call unconditionally.
SplashScreen.hide({ fadeOutDuration: 0 })
  .then(() => _bootDebug("native SplashScreen.hide resolved"))
  .catch(() => _bootDebug("native SplashScreen.hide rejected"));

// Snap the HTML boot splash off (display:none) once two conditions are met:
//   a) Instrument Serif (the Layout header's font) has finished loading.
//   b) The wordmark has been on screen for at least 700ms (brand moment).
//
// We deliberately do NOT cross-fade — that produced a "logo jumping around"
// glitch on mobile (reported 2026-05-16). Here's what was happening:
//
//   1. Boot splash: Georgia 52pt "Contour" CENTERED on #08080a.
//   2. React Layout header: Instrument Serif 26pt "Contour" TOP-LEFT.
//
// During a 320ms opacity transition on the boot splash, intermediate
// opacities (~0.3–0.7) made BOTH wordmarks visible at the same time, in
// different positions, in different fonts. A clean display:none snap
// after the wordmark has been stable for 700ms feels like an intentional
// reveal instead of a cross-fade ghost.
//
// The font-load wait fixes a SECOND snap that survived the cross-fade
// fix: Instrument Serif is loaded via Google Fonts with display=swap,
// so when the boot splash hid before the font arrived, the Layout
// header rendered "Contour" in Iowan Old Style (the iOS serif
// fallback), then a few hundred ms later swapped to Instrument Serif —
// a visible glyph shift that reads as the title "snapping around"
// AFTER the splash already hid. Waiting until document.fonts has the
// face ready means the Layout wordmark is correct on first paint.
//
// requestAnimationFrame gates the timer on React's first paint: we want
// the brand moment to start counting from when the wordmark is actually
// on screen, not from the moment main.jsx parsed.
requestAnimationFrame(() => {
  _bootDebug("rAF (first paint window)");
  const start = performance.now();
  const MIN_HOLD_MS = 700;

  // Also log when fonts.ready resolves — separate signal from the
  // specific Instrument Serif load() promises below, since fonts.ready
  // resolves when ALL pending font fetches finish (or none are pending).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => _bootDebug("document.fonts.ready"));
  }

  // Request Instrument Serif at 26px (Layout header size) and 76px (Era
  // Score) so both the header and the first signature stat have the font
  // ready when the splash drops. If document.fonts isn't available
  // (older WebView), fall back to a fixed delay so the splash still hides.
  const fontPromise = (document.fonts && document.fonts.load)
    ? Promise.all([
        document.fonts.load("400 26px 'Instrument Serif'"),
        document.fonts.load("400 76px 'Instrument Serif'"),
      ]).then(() => _bootDebug("Instrument Serif loaded"))
       .catch(() => _bootDebug("Instrument Serif load rejected"))
    : Promise.resolve();

  // Hard ceiling so a stalled font request never strands the user on the
  // splash forever — at 2s we drop the splash regardless and accept the
  // brief font-swap rather than blocking the whole app.
  const fontReady = Promise.race([
    fontPromise,
    new Promise((resolve) => setTimeout(() => {
      _bootDebug("2s font ceiling tripped");
      resolve();
    }, 2000)),
  ]);

  fontReady.then(() => {
    const elapsed = performance.now() - start;
    const remaining = Math.max(0, MIN_HOLD_MS - elapsed);
    _bootDebug(`font gate cleared, waiting ${remaining.toFixed(0)}ms for brand-moment`);
    setTimeout(() => {
      _bootDebug("BEFORE splash display:none");
      const splash = document.getElementById("boot-splash");
      if (splash) splash.style.display = "none";
      // Capture state immediately after the snap — measure on the next
      // frame so layout has settled. This is the moment the user
      // perceives as the wordmark "snapping around"; the bbox of the
      // Layout header wordmark relative to where the boot-splash
      // wordmark just was tells us exactly how far / which axis it moved.
      requestAnimationFrame(() => _bootDebug("AFTER splash display:none"));
    }, remaining);
  });
});

// Auto-dismiss the debug overlay 5 seconds after launch settles so it
// doesn't permanently disfigure the app for regular users — leaves
// enough time to capture the snap in a screen recording.
setTimeout(() => {
  if (_bootDebugDismissed || !_bootDebugEl) return;
  _bootDebugEl.classList.add("fading");
  setTimeout(() => {
    _bootDebugEl.style.display = "none";
    _bootDebugDismissed = true;
  }, 400);
}, 8000);
