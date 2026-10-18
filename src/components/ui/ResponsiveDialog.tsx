import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BottomSheet } from "@/components/mobile/BottomSheet";
import { cn } from "@/lib/utils";

/**
 * ResponsiveDialog — Dialog on desktop, BottomSheet on mobile.
 * Same API as a simple Dialog: open/onOpenChange/title/children.
 * Use for confirmations, edit forms, bulk actions, filters.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function ResponsiveDialog({ open, onOpenChange, title, description, children, className }: Props) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title={title} description={description} className={className}>
        {children}
      </BottomSheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto", className)}>
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </DialogHeader>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}
