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
// SplashScreen.hide() is a no-op on web — safe to call unconditionally.
SplashScreen.hide().catch(() => {});

// Snap the HTML boot splash off (display:none) after a brand-moment window.
// We deliberately do NOT cross-fade — that produced a "logo jumping around"
// glitch on mobile (reported 2026-05-16). Here's what was happening:
//
//   1. Boot splash: Georgia 52pt "Contour" CENTERED on #08080a.
//   2. React Layout header: Instrument Serif 26pt "Contour" TOP-LEFT.
//
// During a 320ms opacity transition on the boot splash, intermediate
// opacities (~0.3–0.7) made BOTH wordmarks visible at the same time, in
// different positions, in different fonts. The eye reads two
// simultaneous wordmarks-at-different-positions as the logo translating
// or "jumping around." A clean display:none snap after the wordmark has
// been stable for 700ms feels like an intentional reveal instead of a
// cross-fade ghost.
//
// requestAnimationFrame gates the timer on React's first paint: we want
// the brand moment to start counting from when the wordmark is actually
// on screen, not from the moment main.jsx parsed.
requestAnimationFrame(() => {
  setTimeout(() => {
    const splash = document.getElementById("boot-splash");
    if (splash) splash.style.display = "none";
  }, 700);
});
