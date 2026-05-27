import { useEffect, useRef, useState } from "react";

// ── PerfOverlay ───────────────────────────────────────────────────────────────
//
// Diagnostic overlay for swipe-deck smoothness investigations. Gated behind
// the `?perf=1` URL parameter (or the Settings → Diagnostics toggle for
// the native shell) so it never ships to real users.
//
// What it measures, and crucially, what it *holds*:
//   - FPS: current 1-second rolling average from requestAnimationFrame
//     ticks. Drops below ~55 are perceptible during a swipe.
//   - Min FPS over the last 5 seconds. THIS IS THE KEY METRIC for the
//     swipe-lag investigation — the current FPS recovers the moment you
//     lift your finger, so you can't screenshot it mid-swipe. The 5s
//     window holds the dip long enough to swipe, stop, look up, and
//     read the worst value the deck hit.
//   - Slow frames/sec (current) and peak over the last 5s.
//   - Long tasks: the last 5 main-thread tasks >50ms, with timestamps
//     showing how long ago they fired (auto-updates every 500ms). These
//     identify the specific JS execution windows that blocked rendering.
//   - Sparkline: last ~3s of FPS samples drawn as a polyline. The shape
//     of a swipe-induced dip is immediately obvious without reading
//     numbers.
//
// Window size of 5s chosen to comfortably outlast a typical swipe gesture
// (~200-400ms commit animation + the user's reaction time to look up at
// the corner of the screen). Tune via HISTORY_WINDOW_MS if it ever feels
// off.
const HISTORY_WINDOW_MS = 5000;
const SPARKLINE_SAMPLES = 60;       // ~3s at 20Hz sampling
const SPARKLINE_W = 110;
const SPARKLINE_H = 18;
const LONG_TASKS_KEEP = 5;
const LONG_TASKS_MAX_AGE_MS = 15000;

export function PerfOverlay() {
  const [fps, setFps] = useState(60);
  const [minFps, setMinFps] = useState(60);
  const [slow, setSlow] = useState(0);
  const [peakSlow, setPeakSlow] = useState(0);
  const [longTasks, setLongTasks] = useState([]);
  const [sparkPath, setSparkPath] = useState("");
  // tick used purely to force a re-render every 500ms so "Xs ago"
  // timestamps on the long-task list stay current without the
  // long-task observer having to fire.
  const [, setNowTick] = useState(0);

  const frameTimesRef = useRef([]);   // [{ t, dt }] frames in last 1s
  const historyRef = useRef([]);      // [{ t, fps, slow }] one sample per second, kept for HISTORY_WINDOW_MS
  const sparkRef = useRef([]);        // [fps] last SPARKLINE_SAMPLES samples at ~20Hz
  const lastTimeRef = useRef(performance.now());
  const lastHistoryAtRef = useRef(0);
  const lastSparkAtRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    function tick(now) {
      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // Rolling 1-second frame-time window for current FPS / slow count.
      const arr = frameTimesRef.current;
      arr.push({ t: now, dt });
      const cutoff1s = now - 1000;
      while (arr.length && arr[0].t < cutoff1s) arr.shift();
      const currentFps = arr.length;
      const currentSlow = arr.filter((f) => f.dt > 20).length;
      setFps(currentFps);
      setSlow(currentSlow);

      // Sparkline sampling — push the current FPS reading every 50ms
      // (~20Hz). At this rate a typical swipe (~300ms) shows up as 6
      // samples, enough to render a visible dip in a 60-sample buffer.
      if (now - lastSparkAtRef.current > 50) {
        lastSparkAtRef.current = now;
        const spark = sparkRef.current;
        spark.push(currentFps);
        if (spark.length > SPARKLINE_SAMPLES) spark.shift();
        // Build the polyline path. Y axis: 0fps → SPARKLINE_H, 60fps → 0.
        // Cap at 60 — values above just clamp visually (some browsers can
        // briefly report 65+ on fractional-frame windows).
        const stepX = SPARKLINE_W / Math.max(SPARKLINE_SAMPLES - 1, 1);
        const points = spark
          .map((f, i) => `${(i * stepX).toFixed(1)},${(SPARKLINE_H - Math.min(f, 60) / 60 * SPARKLINE_H).toFixed(1)}`)
          .join(" ");
        setSparkPath(points);
      }

      // History — one entry per second for the rolling-min calculation.
      if (now - lastHistoryAtRef.current > 1000) {
        lastHistoryAtRef.current = now;
        const hist = historyRef.current;
        hist.push({ t: now, fps: currentFps, slow: currentSlow });
        const cutoff = now - HISTORY_WINDOW_MS;
        while (hist.length && hist[0].t < cutoff) hist.shift();
        if (hist.length) {
          setMinFps(Math.min(...hist.map((h) => h.fps)));
          setPeakSlow(Math.max(...hist.map((h) => h.slow)));
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Drive the "Xs ago" timestamps on the long-task list. 500ms cadence
  // is fine — sub-second resolution isn't useful for tasks that happened
  // 8 seconds ago. Also prunes entries older than LONG_TASKS_MAX_AGE_MS
  // so the panel doesn't fill with stale entries.
  useEffect(() => {
    const id = setInterval(() => {
      setNowTick((n) => n + 1);
      setLongTasks((prev) => {
        const now = performance.now();
        const fresh = prev.filter((t) => now - t.t < LONG_TASKS_MAX_AGE_MS);
        return fresh.length === prev.length ? prev : fresh;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let observer;
    try {
      observer = new PerformanceObserver((list) => {
        const now = performance.now();
        const entries = list.getEntries().map((e) => ({
          duration: Math.round(e.duration),
          t: now,
        }));
        setLongTasks((prev) => [...entries, ...prev].slice(0, LONG_TASKS_KEEP));
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask entry type not supported (Safari, older browsers) — just
      // skip the long-task panel; FPS/min/sparkline still work.
    }
    return () => { try { observer?.disconnect(); } catch {} };
  }, []);

  // Color the FPS readouts so glancing at the overlay tells you whether
  // things are healthy without reading the number.
  function fpsColor(v) { return v >= 55 ? "#34d399" : v >= 40 ? "#fbbf24" : "#f87171"; }
  function slowColor(v) { return v === 0 ? "rgba(255,255,255,0.6)" : v < 5 ? "#fbbf24" : "#f87171"; }
  function durColor(ms) { return ms > 100 ? "#f87171" : "#fbbf24"; }

  const nowTs = performance.now();

  return (
    <div style={{
      position: "fixed",
      top: 8, right: 8,
      zIndex: 999,
      background: "rgba(0,0,0,0.78)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: 6,
      padding: "6px 10px",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11, lineHeight: 1.4,
      color: "rgba(255,255,255,0.85)",
      minWidth: 158,
      pointerEvents: "none",
      userSelect: "none",
    }}>
      {/* Current + 5-second-min on the same row so a glance reads as
          "smooth now, but it dipped to X during the last swipe." */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span>FPS</span>
        <span>
          <span style={{ color: fpsColor(fps), fontWeight: 700 }}>{fps}</span>
          <span style={{ color: "rgba(255,255,255,0.4)" }}> · min </span>
          <span style={{ color: fpsColor(minFps), fontWeight: 700 }}>{minFps}</span>
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span>Slow/s</span>
        <span>
          <span style={{ color: slowColor(slow) }}>{slow}</span>
          <span style={{ color: "rgba(255,255,255,0.4)" }}> · peak </span>
          <span style={{ color: slowColor(peakSlow) }}>{peakSlow}</span>
        </span>
      </div>

      {/* Sparkline — visualize the dip shape. 50fps reference line drawn
          dim so you can see at a glance whether the line dipped below it. */}
      {sparkPath && (
        <svg
          width={SPARKLINE_W} height={SPARKLINE_H}
          style={{ display: "block", marginTop: 3 }}
          aria-hidden
        >
          <line
            x1={0} x2={SPARKLINE_W}
            y1={SPARKLINE_H - (50 / 60) * SPARKLINE_H}
            y2={SPARKLINE_H - (50 / 60) * SPARKLINE_H}
            stroke="rgba(255,255,255,0.18)" strokeDasharray="2 2" strokeWidth={1}
          />
          <polyline
            fill="none"
            stroke="#fbbf24"
            strokeWidth={1.2}
            points={sparkPath}
          />
        </svg>
      )}

      {longTasks.length > 0 && (
        <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
          <div style={{ color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>Long tasks</div>
          {longTasks.map((t, i) => {
            const ageSec = Math.max(0, Math.round((nowTs - t.t) / 100) / 10);
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", color: durColor(t.duration) }}>
                <span>{t.duration}ms</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{ageSec}s ago</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Hint so a future-me reading this for the first time knows what
          they're looking at without re-opening the source. Subtle enough
          not to dominate the panel. */}
      <div style={{ marginTop: 4, fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
        5s window · resets on reload
      </div>
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
