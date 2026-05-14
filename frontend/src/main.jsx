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

// Fade out the inline HTML boot splash now that React has mounted. The
// splash lives outside #root (see index.html) so React doesn't replace it
// on mount — instead we add a class here that runs the opacity transition
// in CSS. Done in a microtask so React's first paint commits BEFORE the
// fade starts; otherwise the splash could vanish before the app's first
// frame is on screen and the user sees a brief flash of empty bg.
//
// On native (Capacitor), the SplashScreen plugin is also still showing the
// LaunchScreen storyboard over the WebView — hide that here too. Without
// this call the plugin stays up forever (launchAutoHide: false). The
// storyboard and the HTML boot splash are visually identical (Georgia 52pt
// "Contour" on #08080a), so the user sees one continuous wordmark from
// process launch through to the React app fade-in. SplashScreen.hide() is
// a no-op on web, so it's safe to call unconditionally.
queueMicrotask(() => {
  document.getElementById("boot-splash")?.classList.add("boot-splash--done");
  SplashScreen.hide().catch(() => {});
});
