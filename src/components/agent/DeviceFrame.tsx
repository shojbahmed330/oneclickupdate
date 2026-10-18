import { useEffect, useRef, useState } from "react";
import { Monitor, Tablet, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export type DeviceMode = "desktop" | "tablet" | "mobile";

export const DEVICE_DIMENSIONS: Record<DeviceMode, { w: number; h: number; label: string }> = {
  desktop: { w: 0, h: 0, label: "Desktop" }, // full size
  tablet: { w: 820, h: 1180, label: 'iPad 11"' },
  mobile: { w: 390, h: 844, label: "iPhone 14" },
};

interface ToggleProps {
  mode: DeviceMode;
  onChange: (m: DeviceMode) => void;
}

export const DeviceToggle = ({ mode, onChange }: ToggleProps) => {
  const items: { key: DeviceMode; icon: any }[] = [
    { key: "desktop", icon: Monitor },
    { key: "tablet", icon: Tablet },
    { key: "mobile", icon: Smartphone },
  ];
  return (
    <div className="flex items-center rounded-full border border-border bg-background/85 backdrop-blur-md shadow-lg overflow-hidden">
      {items.map(({ key, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={DEVICE_DIMENSIONS[key].label}
          className={cn(
            "px-2.5 py-1.5 transition-all active:scale-95",
            mode === key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
};

interface FrameProps {
  mode: DeviceMode;
  children: React.ReactNode;
}

/** Wraps the preview iframe in a realistic phone/tablet bezel. */
export const DeviceFrame = ({ mode, children }: FrameProps) => {
  if (mode === "desktop") {
    return <div className="h-full w-full">{children}</div>;
  }

  const { w, h, label } = DEVICE_DIMENSIONS[mode];
  const isPhone = mode === "mobile";

  // Scale the bezel by viewport: cap by both available width AND height so
  // the entire phone (incl. bezel) fits without scrolling on small screens.
  // We rely on aspect-ratio so width follows w/h, and the iframe inside
  // simply fills 100% of its parent.
  const padPx = isPhone ? 12 : 16;
  const totalW = w + padPx * 2;
  const totalH = h + padPx * 2 + 24; // +24 for label below

  // Compute the largest scale that fits both width and height of the wrapper.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const s = Math.min(rect.width / totalW, rect.height / totalH, 1.4);
      setScale(s > 0 ? s : 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [totalW, totalH]);

  return (
    <div ref={wrapperRef} className="h-full w-full bg-muted/40 grid place-items-center p-2 overflow-hidden">
      <div
        style={{ width: totalW * scale, height: totalH * scale }}
        className="relative"
      >
        <div
          style={{
            width: totalW,
            height: totalH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          className="absolute top-0 left-0 flex flex-col items-center gap-2"
        >
          <div
            className={cn(
              "relative bg-foreground/90 dark:bg-foreground/95 shadow-2xl",
              isPhone ? "rounded-[2.75rem]" : "rounded-[2rem]",
            )}
            style={{ padding: padPx }}
          >
            {isPhone && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 h-5 w-24 rounded-b-2xl bg-foreground/95" />
            )}
            <div
              className={cn(
                "relative bg-background overflow-hidden",
                isPhone ? "rounded-[2rem]" : "rounded-[1.25rem]",
              )}
              style={{ width: w, height: h }}
            >
              {children}
            </div>
          </div>
          <span className="text-xs text-muted-foreground font-medium">
            {label} · {w}×{h}
          </span>
        </div>
      </div>
    </div>
  );
};
