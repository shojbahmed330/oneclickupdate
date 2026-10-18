import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * Floating Action Button — Material 3.
 * 56×56 circle, primary tint, sits above bottom-nav clearance, ripple via active:scale.
 * `extended` shows a pill with label.
 */
interface Props {
  onClick?: () => void;
  icon?: ReactNode;
  label?: string;
  extended?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function FAB({ onClick, icon, label, extended, className, ariaLabel }: Props) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label ?? "Action"}
      onClick={() => {
        haptic("light");
        onClick?.();
      }}
      className={cn(
        "fixed z-40 right-4 grid place-items-center",
        "bg-primary text-primary-foreground shadow-lg shadow-primary/30",
        "active:scale-90 transition-transform duration-150",
        extended
          ? "h-14 px-5 rounded-full gap-2 flex items-center font-medium"
          : "h-14 w-14 rounded-2xl",
        className,
      )}
      style={{
        bottom: `calc(64px + env(safe-area-inset-bottom) + 20px)`,
      }}
    >
      <span className="grid place-items-center">{icon ?? <Plus className="h-6 w-6" />}</span>
      {extended && label && <span>{label}</span>}
    </button>
  );
}
