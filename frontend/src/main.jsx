import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SplashScreen } from "@capacitor/splash-screen";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { initAnalytics } from "./services/analytics.js";
import { registerServiceWorker } from "./sw-register.js";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { prefetchInitialFeed } from "./services/feedPrefetch.js";
// Side-effect import: registers every gated-action replay before any auth can
// complete, so replayPendingIntent() always finds a handler. See replays.js.
import "./services/replays.js";
import App from "./App.jsx";
import "./index.css";

initAnalytics();

// Fire the first /discover/feed request RIGHT NOW, before React even
// mounts. The network round-trip overlaps with the rest of the boot
// (createRoot, AuthProvider, Suspense, ForYouFeed mount). By the time
// ForYouFeed's useEffect runs, the response is already in flight or
// done — fetchBatch consumes the in-flight promise via
// consumeInitialFeed() instead of starting a fresh round-trip.
//
// Net effect: visible "Tuning your feed" duration drops from the
// ~1-2s waterfall (mount → effect → fetch) to whatever raw network
// time remains after the boot work overlaps. On warm Redis cache
// hits the user sees the deck land in <300ms; on cold misses it's
// roughly the same as before but the spinner shows less because
// React mounted later.
//
// Idempotent — safe even if some path later imports + calls this
// again. See services/feedPrefetch.js for the full contract.
prefetchInitialFeed();

// Cache JS/CSS bundles for instant repeat-launch. Skipped in dev to avoid
// fighting Vite HMR. First launch is unaffected; second-and-beyond cold
// starts load the bundle from disk in ~10ms instead of the network.
registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* Top-level ErrorBoundary catches uncaught render exceptions
        anywhere in the tree. Without it, a single ReferenceError
        during a resume-render path unmounts the entire app and the
        WKWebView shows its default white background (the "white
        screen on resume" failure mode). See ErrorBoundary.jsx for
        the rationale + the limits of what error boundaries catch. */}
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Analytics />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
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
  // Brand-pause is gone. The previous 350ms hold for first-launch
  // users was a deliberate "brand moment" but the user has now
  // reported "initial load takes a few seconds too long" twice,
  // so the moment is over. The HTML splash + native LaunchScreen
  // remain pixel-aligned, so dropping the splash the instant the
  // font is ready (or 600ms ceiling, whichever first) still hands
  // off cleanly — there just isn't a deliberate hold after the
  // wordmark is ready.
  const MIN_HOLD_MS = 0;

  // Request Instrument Serif at 26px (Layout header size) and 76px
  // (Era Score) so both the header and the first signature stat
  // have the font ready when the splash drops. If document.fonts
  // isn't available (older WebView), fall back to a fixed delay so
  // the splash still hides.
  const fontPromise = (document.fonts && document.fonts.load)
    ? Promise.all([
        document.fonts.load("400 26px 'Instrument Serif'"),
        document.fonts.load("400 76px 'Instrument Serif'"),
      ]).catch(() => {})
    : Promise.resolve();

  // Hard ceiling on the font wait. Was 2000ms; reduced to 600ms
  // after the "initial load too long on mobile" report. On a slow
  // cellular connection, Google Fonts can take >2s — under the old
  // ceiling that was 2 full seconds of splash. The Layout header
  // will swap from Iowan Old Style (iOS serif fallback) to
  // Instrument Serif when the font finally arrives; that's a
  // tolerable single-glyph-shift well after the user has reached
  // the app, much better than stranding them on the splash.
  const fontReady = Promise.race([
    fontPromise,
    new Promise((resolve) => setTimeout(resolve, 600)),
  ]);

  fontReady.then(() => {
    // Mark fonts as loaded. App.jsx's top-level useEffect (which
    // fires once React has actually mounted and committed) reads
    // this flag and hides the splash. Gating on BOTH React-mounted
    // AND fontReady together is the right correctness condition:
    // hiding earlier risks a header font-swap flash; hiding later
    // is fine because the inline-HTML recovery overlay in
    // index.html is the safety net if React never mounts at all.
    window.__contour_fonts_ready = true;
    window.dispatchEvent(new CustomEvent("contour:fonts-ready"));
    // eslint-disable-next-line no-unused-vars
    const elapsed = performance.now() - start;
  });
  // The "hide splash 3.5s after main.jsx parsed" watchdog that
  // used to live here was removed because it could fire before
  // React actually rendered on slow cellular boots, leaving the
  // user staring at a black <body> for several seconds (the
  // resume-then-black-screen bug, reported 2026-05-25). The
  // recovery story now has two layers:
  //   1. Happy path: App.jsx hides splash on its first useEffect
  //      AND fontReady has fired. Both signals = ready to reveal.
  //   2. Stuck path: index.html's inline 12s watchdog shows a
  //      tappable "Reload" overlay if #root is still empty. That
  //      works even if main.jsx never parsed at all.
});
