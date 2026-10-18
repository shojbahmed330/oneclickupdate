import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * BottomSheet — preferred over Dialog on mobile per design rules.
 * Wraps shadcn Sheet (side="bottom") with rounded top, drag handle,
 * and safe-area padding. Use for confirmations, pickers, action menus.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function BottomSheet({ open, onOpenChange, title, description, children, className }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "rounded-t-2xl border-t border-border/60 max-h-[90dvh] overflow-y-auto",
          "px-4 pt-2",
          className,
        )}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        {/* Drag handle */}
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        {(title || description) && (
          <SheetHeader className="text-left">
            {title && <SheetTitle className="text-lg">{title}</SheetTitle>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </SheetHeader>
        )}
        <div className="mt-3">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
