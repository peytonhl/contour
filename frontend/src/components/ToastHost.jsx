import { useEffect, useState } from "react";
import { TOAST_EVENT } from "../services/toast.js";
import { ACCENT_A } from "../theme.js";

// App-level toast host. Exists primarily to CONFIRM a replayed action after
// contextual auth ("Saved your rating for …") — that confirmation can't live on
// the originating screen because a Google redirect reloads the page. Listens for
// the contour:toast event (services/toast.js) and renders one message at a time.
export function ToastHost() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let hideTimer;
    function onToast(e) {
      const { message, kind, duration } = e.detail || {};
      if (!message) return;
      setToast({ message, kind: kind || "success" });
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setToast(null), duration || 3200);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!toast) return null;

  const isError = toast.kind === "error";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
        transform: "translateX(-50%)",
        zIndex: 400,
        maxWidth: "min(92vw, 420px)",
        padding: "12px 18px",
        borderRadius: "var(--radius-pill)",
        background: isError ? "rgba(40,16,16,0.96)" : "rgba(20,20,24,0.96)",
        border: `1px solid ${isError ? "var(--danger)" : ACCENT_A}`,
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
        textAlign: "center",
        boxShadow: "var(--shadow-3)",
        pointerEvents: "none",
      }}
    >
      {toast.message}
    </div>
  );
}
