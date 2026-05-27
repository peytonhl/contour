import { useEffect, useRef, useState } from "react";

// ── PerfOverlay ───────────────────────────────────────────────────────────────
//
// Diagnostic overlay for swipe-deck smoothness investigations. Gated behind
// the `?perf=1` URL parameter so it never ships to real users.
//
// What it measures:
//   - FPS: rolling 1-second window from requestAnimationFrame ticks. Drops
//     below ~50 are perceptible during a swipe.
//   - Dropped frames: per the rAF stream, how many frames came in with a
//     dt > 20ms (= below 50fps) in the last second. Sustained > 0 during
//     swipe = stutter the user can feel.
//   - Long tasks: any browser task >50ms. These are the things that cause
//     dropped frames. The overlay shows the last 3 with their duration.
//
// Why these three: rAF FPS tells you whether the user-perceived motion is
// smooth. Long tasks tell you WHY when it isn't — they identify the
// specific JS execution windows that blocked the main thread. Together
// they distinguish "GPU/composite stutter" from "JS overhead stutter."
//
// Usage: navigate to any page with `?perf=1` appended. The overlay sits in
// the top-right of the viewport, ~120×64px, glass background so the cover
// art shows through.
export function PerfOverlay() {
  const [fps, setFps] = useState(60);
  const [dropped, setDropped] = useState(0);
  const [longTasks, setLongTasks] = useState([]);
  const frameTimesRef = useRef([]);
  const lastTimeRef = useRef(performance.now());
  const rafRef = useRef(null);

  useEffect(() => {
    function tick(now) {
      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;

      const arr = frameTimesRef.current;
      arr.push({ t: now, dt });
      // Drop frames older than 1 second
      const cutoff = now - 1000;
      while (arr.length && arr[0].t < cutoff) arr.shift();

      // FPS = frames in last second
      const frames = arr.length;
      // Dropped = how many of those frames came in slower than 50fps (>20ms)
      const slow = arr.filter((f) => f.dt > 20).length;

      setFps(frames);
      setDropped(slow);

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let observer;
    try {
      observer = new PerformanceObserver((list) => {
        const entries = list.getEntries().map((e) => ({
          name: e.name,
          duration: Math.round(e.duration),
          // attribution is supported only on some browsers; fall back to "—"
          source: e.attribution?.[0]?.containerSrc || e.attribution?.[0]?.containerName || "—",
        }));
        setLongTasks((prev) => [...entries, ...prev].slice(0, 3));
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask entry type not supported (Safari, older browsers) — just
      // skip the long-task panel; FPS/dropped still work.
    }
    return () => { try { observer?.disconnect(); } catch {} };
  }, []);

  // Color the FPS readout so glancing at the overlay tells you whether
  // things are healthy without reading the number.
  const fpsColor = fps >= 55 ? "#34d399" : fps >= 40 ? "#fbbf24" : "#f87171";
  const dropColor = dropped === 0 ? "rgba(255,255,255,0.6)" : dropped < 5 ? "#fbbf24" : "#f87171";

  return (
    <div style={{
      position: "fixed",
      top: 8, right: 8,
      zIndex: 999,
      background: "rgba(0,0,0,0.72)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: 6,
      padding: "6px 10px",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11, lineHeight: 1.4,
      color: "rgba(255,255,255,0.85)",
      minWidth: 140,
      pointerEvents: "none",
      userSelect: "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>FPS</span>
        <span style={{ color: fpsColor, fontWeight: 700 }}>{fps}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Slow frames/sec</span>
        <span style={{ color: dropColor }}>{dropped}</span>
      </div>
      {longTasks.length > 0 && (
        <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
          <div style={{ color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>Long tasks</div>
          {longTasks.map((t, i) => (
            <div key={i} style={{ color: t.duration > 100 ? "#f87171" : "#fbbf24" }}>
              {t.duration}ms
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// localStorage key for the in-app toggle (Settings → Diagnostics →
// "Show performance overlay"). The URL `?perf=1` gate also writes this
// key so URL-set + Settings-set are the same source of truth — useful
// when the URL is hit on a phone Safari tab and we want the value to
// persist into the WKWebView shell that the Capacitor app loads from
// the same origin (it doesn't, those WebViews don't share storage, but
// future-us might find it useful for desktop workflows).
const PERF_OVERLAY_KEY = "contour_perf_overlay_v1";

export function isPerfOverlayEnabled() {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(PERF_OVERLAY_KEY) === "1"; }
  catch { return false; }
}

export function setPerfOverlayEnabled(on) {
  try {
    if (on) localStorage.setItem(PERF_OVERLAY_KEY, "1");
    else localStorage.removeItem(PERF_OVERLAY_KEY);
  } catch { /* localStorage may be full or disabled */ }
}

// Decides whether App.jsx should mount the overlay. Two gates, either
// flips it on:
//   - `?perf=1` in the URL — convenient for desktop browser sessions and
//     also writes the localStorage key on first hit so refreshes keep it
//     on without re-typing the param
//   - localStorage flag set via the Settings toggle — the only way to
//     enable the overlay inside the native Capacitor shell, which has
//     no URL bar
//
// Reads happen at App-render time so the gate decision is made before
// `<PerfOverlay />` mounts and starts its rAF loop.
export function isPerfMode() {
  if (typeof window === "undefined") return false;
  try {
    const urlGate = new URLSearchParams(window.location.search).get("perf") === "1";
    if (urlGate) {
      // Persist so the next plain `/` load keeps it on without the param.
      // A page that explicitly passes `?perf=0` clears it.
      setPerfOverlayEnabled(true);
      return true;
    }
    const urlOff = new URLSearchParams(window.location.search).get("perf") === "0";
    if (urlOff) {
      setPerfOverlayEnabled(false);
      return false;
    }
    return isPerfOverlayEnabled();
  } catch {
    return false;
  }
}
