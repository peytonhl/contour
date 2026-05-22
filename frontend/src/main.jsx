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
// Two nested rAFs before calling .hide() — guarantees iOS WebKit has
// actually committed at least two paint frames of the HTML splash
// before the native LaunchScreen starts fading. Without this, WebKit's
// lazy compositing skipped painting the WebView entirely while the
// opaque native splash covered it; the native then faded over 150ms
// with NOTHING painted underneath, the WebView didn't catch up until
// after the fade finished, and the user saw the logo "blink"
// (fade out + brief blank + reappear in the same place — exactly
// what the user reported 2026-05-19 after the position fixes landed).
//
// fadeOutDuration: 150 — the position-matching JS in index.html lands
// the HTML wordmark on the LaunchScreen storyboard's safeArea center,
// so the cross-fade shows the SAME wordmark at the SAME pixel and is
// visually invisible. With WebKit definitely painted by the time the
// fade starts, the fade has a stable image behind it.
//
// SplashScreen.hide() is a no-op on web — safe to call unconditionally.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {});
  });
});

// Snap the HTML boot splash off (display:none) once two conditions are met:
//   a) Instrument Serif (the Layout header's font) has finished loading.
//   b) The wordmark has been on screen for at least MIN_HOLD_MS (brand moment).
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
// after the wordmark has been stable feels like an intentional reveal
// instead of a cross-fade ghost.
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
// MIN_HOLD_MS — was 700ms (deliberate "brand moment"). Reduced to 350ms
// on first launch after feedback that the wait felt slow, and dropped
// to 0 for repeat visits where the SW is already controlling the page
// (= user has been here before; the brand reinforcement is unnecessary
// every time). The font-load wait still floors the actual hide, so the
// Layout-header flash regression can't come back.
//
// requestAnimationFrame gates the timer on React's first paint: we want
// the brand moment to start counting from when the wordmark is actually
// on screen, not from the moment main.jsx parsed.
requestAnimationFrame(() => {
  const start = performance.now();
  // SW-controlled = repeat visit (the SW takes control on the SECOND load;
  // first load registers but doesn't control). Returning users skip the
  // brand pause entirely — they don't need re-introducing to the wordmark.
  const isRepeatLoad = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  const MIN_HOLD_MS = isRepeatLoad ? 0 : 350;

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
