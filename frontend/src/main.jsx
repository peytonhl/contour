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
// TEMPORARY (v2): splash-twitch instrumentation.
//
// First pass (commit e662cca) showed the wordmark snapping from x=8,y=8
// (default body margin + default font) to x=102,y=352 (flex-centered
// Georgia 52pt) between t=0 and t=26ms, caused by the boot-splash class
// rules not being applied on the first paint. Commit a7cbb3d inlined
// the splash styles so the element renders correctly from frame 0. The
// user reports a twitch is still present — but says they're not sure if
// it's the same one. This v2 overlay does three things to disambiguate:
//
//   1. Logs the actual outerHTML of the boot-splash element on first
//      tick. If we see the inline style attribute, the iPhone has the
//      new code; if we see class="boot-splash" with no inline styles,
//      the iPhone is on a cached old bundle and we have a delivery
//      problem, not a CSS problem.
//   2. Logs the wordmark bbox at every event (same as v1) so we can
//      see what's still moving. With inlined styles, the bbox at t=0
//      should already be centered — any snap would be from there to
//      its hide-time disappearance.
//   3. Logs the Layout-header wordmark bbox the moment it first has
//      width > 0. If this happens BEFORE the splash hides, React is
//      painting through the splash, which could expose the header
//      wordmark visually during the brand-moment.
//
// Build stamp is rendered in the splash itself ("build splash-v2") so
// you can confirm the iPhone is loading this code, not a cached older
// one, without having to read the overlay first.
//
// Remove this block + the #boot-debug element + the build stamp from
// index.html once we've diagnosed the residual snap.
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
  const splash = document.getElementById("boot-splash");
  const splashWord = splash ? splash.firstElementChild : null;
  const headerWord = document.querySelector(".app-header span");
  const fmtRect = (el) => {
    if (!el) return "—";
    const r = el.getBoundingClientRect();
    return `x=${r.left.toFixed(0)} y=${r.top.toFixed(0)} w=${r.width.toFixed(0)} h=${r.height.toFixed(0)}`;
  };
  const splashDisplay = splash ? getComputedStyle(splash).display : "—";
  const line = document.createElement("div");
  line.textContent =
    `+${t}ms ${label}\n` +
    `      splash.display=${splashDisplay} splashWord=${fmtRect(splashWord)}\n` +
    `      headerWord=${fmtRect(headerWord)}`;
  _bootDebugEl.appendChild(line);
  _bootDebugEl.scrollTop = _bootDebugEl.scrollHeight;
}

// First log line: dump the actual splash element HTML so we can verify
// the iPhone is running this build (style attribute present) vs a
// cached older one (class only).
(() => {
  const splash = document.getElementById("boot-splash");
  if (!splash || !_bootDebugEl) return;
  const head = document.createElement("div");
  const hasInlineStyle = splash.hasAttribute("style");
  head.textContent =
    `splash.outerHTML starts with: ${splash.outerHTML.slice(0, 90)}…\n` +
    `inline style attr present: ${hasInlineStyle}`;
  head.style.color = hasInlineStyle ? "#6effa3" : "#ff8a8a";
  _bootDebugEl.appendChild(head);
})();

_bootDebug("module parse");

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
      requestAnimationFrame(() => _bootDebug("AFTER splash display:none"));
    }, remaining);
  });
});

// Auto-fade the debug overlay 12s in so it doesn't permanently disfigure
// the app. Longer than v1 (8s) because we now log more events.
setTimeout(() => {
  if (_bootDebugDismissed || !_bootDebugEl) return;
  _bootDebugEl.style.opacity = "0";
  setTimeout(() => {
    _bootDebugEl.style.display = "none";
    _bootDebugDismissed = true;
  }, 400);
}, 12000);
