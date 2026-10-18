import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * SwipeToDelete — drag list item left to reveal a destructive action.
 * Threshold = 80px to confirm; release < threshold snaps back.
 *
 * <SwipeToDelete onDelete={() => removeItem(id)}>
 *   <ListRow ... />
 * </SwipeToDelete>
 */
interface Props {
  children: ReactNode;
  onDelete: () => void;
  threshold?: number;
  className?: string;
}

export function SwipeToDelete({ children, onDelete, threshold = 80, className }: Props) {
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);

  const onStart = (e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
  };
  const onMove = (e: TouchEvent) => {
    if (startX.current == null) return;
    const delta = e.touches[0].clientX - startX.current;
    if (delta < 0) setDx(Math.max(delta, -160));
  };
  const onEnd = () => {
    if (Math.abs(dx) >= threshold) {
      haptic("medium");
      onDelete();
    }
    setDx(0);
    startX.current = null;
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div className="absolute inset-y-0 right-0 w-32 grid place-items-center bg-destructive text-destructive-foreground">
        <Trash2 className="h-5 w-5" />
      </div>
      <div
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 200ms" : "none" }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
}
