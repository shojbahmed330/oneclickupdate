import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TourStep {
  /** CSS selector for the element to highlight. Falls back to centered modal if missing. */
  target?: string;
  title: string;
  body: string;
  /** Preferred placement around the target. Auto-flips if no room. */
  placement?: "top" | "bottom" | "left" | "right" | "center";
}

interface TourProps {
  steps: TourStep[];
  storageKey: string;
  /** Auto-start when storageKey isn't set. Default true. */
  autoStart?: boolean;
  /** Optional delay (ms) before showing — lets the page mount first. */
  startDelay?: number;
}

const PADDING = 8;

export const Tour = ({ steps, storageKey, autoStart = true, startDelay = 600 }: TourProps) => {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Auto-start once per user
  useEffect(() => {
    if (!autoStart) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(storageKey)) return;
    const t = setTimeout(() => setActive(true), startDelay);
    return () => clearTimeout(t);
  }, [autoStart, storageKey, startDelay]);

  const current = steps[index];

  // Track target rect — re-measure on resize / scroll / step change
  useLayoutEffect(() => {
    if (!active || !current?.target) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector(current.target!) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      // Bring it into view if needed
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      setRect(el.getBoundingClientRect());
    };
    update();
    const t = setTimeout(update, 250); // after smooth scroll
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, current, index]);

  const finish = useCallback(() => {
    localStorage.setItem(storageKey, new Date().toISOString());
    setActive(false);
    setIndex(0);
  }, [storageKey]);

  const next = () => (index < steps.length - 1 ? setIndex(index + 1) : finish());
  const prev = () => index > 0 && setIndex(index - 1);

  if (!active || !current) return null;

  const placement = current.placement ?? (rect ? "bottom" : "center");
  const tipPos = computeTipPosition(rect, placement);

  return createPortal(
    <div className="fixed inset-0 z-[100] pointer-events-none animate-in fade-in duration-300">
      {/* Backdrop with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={next}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - PADDING}
                y={rect.top - PADDING}
                width={rect.width + PADDING * 2}
                height={rect.height + PADDING * 2}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#tour-mask)" />
        {rect && (
          <rect
            x={rect.left - PADDING}
            y={rect.top - PADDING}
            width={rect.width + PADDING * 2}
            height={rect.height + PADDING * 2}
            rx={10}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            className="animate-pulse"
          />
        )}
      </svg>

      {/* Tooltip card */}
      <div
        className={cn(
          "absolute pointer-events-auto w-[320px] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-background/95 backdrop-blur-xl shadow-2xl p-5",
          "animate-in fade-in slide-in-from-bottom-2 duration-300"
        )}
        style={tipPos}
      >
        <button
          onClick={finish}
          aria-label="Skip tour"
          className="absolute top-3 right-3 size-7 grid place-items-center rounded-full text-muted-foreground hover:bg-muted active:scale-95 transition"
        >
          <X size={14} />
        </button>

        <div className="flex items-center gap-1.5 mb-2">
          <div className="size-4 rounded-[5px] bg-primary/15 text-primary grid place-items-center">
            <Sparkles size={9} />
          </div>
          <span className="text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Tour · {index + 1} / {steps.length}
          </span>
        </div>

        <h3 className="font-display text-[18px] font-normal tracking-tight leading-snug mb-1.5">
          {current.title}
        </h3>
        <p className="text-[13.5px] leading-[1.55] text-muted-foreground mb-5">
          {current.body}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={finish}
            className="text-[12px] text-muted-foreground hover:text-foreground transition"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                onClick={prev}
                className="size-8 grid place-items-center rounded-full border border-border hover:bg-muted active:scale-95 transition"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            <button
              onClick={next}
              className="h-8 px-4 inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground text-[12.5px] font-medium hover:opacity-90 active:scale-95 transition"
            >
              {index === steps.length - 1 ? "Got it" : "Next"}
              {index < steps.length - 1 && <ArrowRight size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

function computeTipPosition(rect: DOMRect | null, placement: TourStep["placement"]): React.CSSProperties {
  const W = 320;
  const H = 180;
  const margin = 16;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  if (!rect || placement === "center") {
    return { left: `calc(50vw - ${W / 2}px)`, top: `calc(50vh - ${H / 2}px)` };
  }

  let top = 0, left = 0;
  switch (placement) {
    case "top":    top = rect.top - H - margin; left = rect.left + rect.width / 2 - W / 2; break;
    case "bottom": top = rect.bottom + margin;   left = rect.left + rect.width / 2 - W / 2; break;
    case "left":   left = rect.left - W - margin; top = rect.top + rect.height / 2 - H / 2; break;
    case "right":  left = rect.right + margin;   top = rect.top + rect.height / 2 - H / 2; break;
  }
  // Auto-flip if off-screen
  if (top < margin) top = rect.bottom + margin;
  if (top + H > vh - margin) top = Math.max(margin, rect.top - H - margin);
  if (left < margin) left = margin;
  if (left + W > vw - margin) left = vw - W - margin;
  return { top, left };
}
