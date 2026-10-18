import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

/**
 * useSwipeBack — iOS-style edge swipe right to navigate back.
 * Trigger zone = leftmost 24px; min horizontal distance 80px and dx > 2*dy.
 * Falls back gracefully when no history (navigates to fallback path).
 */
export function useSwipeBack(fallback = "/", enabled = true) {
  const navigate = useNavigate();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t.clientX > 24) return;
      start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.current.x;
      const dy = Math.abs(t.clientY - start.current.y);
      const dt = Date.now() - start.current.t;
      start.current = null;
      if (dx > 80 && dx > dy * 2 && dt < 600) {
        if (window.history.length > 1) navigate(-1);
        else navigate(fallback);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [navigate, fallback, enabled]);
}
