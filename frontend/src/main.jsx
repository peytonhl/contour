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

// ── Lock the boot-splash wordmark to its t=0 flex-centered pixel position ──
//
// The wordmark previously stayed flex-centered inside #boot-splash
// (`position:fixed; inset:0`) for its whole life. On-device traces
// (2026-05-17) showed the wordmark sitting at y=352 from module-parse
// through SplashScreen.hide(), then jumping to y=392 between t=45ms and
// t=71ms — a 40px downward shift visible to the user as a twitch.
//
// Cause: the WebView's content area grew by ~80px in that window, almost
// certainly because Capacitor's contentInset:"always" is relaxed once
// SplashScreen.hide() resolves and the WebView re-measures into the
// full screen area below a translucent status bar. The flex-centered
// wordmark followed the new center.
//
// Fix: measure the wordmark's current bbox right here at module parse
// (when WebView is still in its initial-inset state — y=352 matches the
// native LaunchScreen storyboard's safe-area centerY), and pin it via
// `position:absolute; top:<px>; left:<px>`. Later WebView resizes don't
// reflow absolute-positioned descendants of #boot-splash since the
// splash itself stays inset:0; the wordmark stays put at its pinned
// pixel coordinates.
const _splashWord = document.getElementById("boot-splash-wordmark");
if (_splashWord) {
  const r = _splashWord.getBoundingClientRect();
  _splashWord.style.position = "absolute";
  _splashWord.style.top = `${r.top}px`;
  _splashWord.style.left = `${r.left}px`;
  _splashWord.style.width = `${r.width}px`;
  _splashWord.style.height = `${r.height}px`;
}

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
SplashScreen.hide({ fadeOutDuration: 0 }).catch(() => {});

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
  const start = performance.now();
  const MIN_HOLD_MS = 700;

  // Request Instrument Serif at 26px (Layout header size) and 76px (Era
  // Score) so both the header and the first signature stat have the font
  // ready when the splash drops. If document.fonts isn't available
  // (older WebView), fall back to a fixed delay so the splash still hides.
  const fontPromise = (document.fonts && document.fonts.load)
    ? Promise.all([
        document.fonts.load("400 26px 'Instrument Serif'"),
        document.fonts.load("400 76px 'Instrument Serif'"),
      ]).catch(() => {})
    : Promise.resolve();

  // Hard ceiling so a stalled font request never strands the user on the
  // splash forever — at 2s we drop the splash regardless and accept the
  // brief font-swap rather than blocking the whole app.
  const fontReady = Promise.race([
    fontPromise,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);

  fontReady.then(() => {
    const elapsed = performance.now() - start;
    const remaining = Math.max(0, MIN_HOLD_MS - elapsed);
    setTimeout(() => {
      const splash = document.getElementById("boot-splash");
      if (splash) splash.style.display = "none";
    }, remaining);
  });
});
