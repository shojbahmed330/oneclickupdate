import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * MobileLayout — Android-style phone shell.
 * - Centers content at max-width 430px on tablet/desktop (mockup-feel).
 * - Uses 100dvh + safe-area-inset to never get cut off by notch / home bar.
 * - Sticky header / bottom nav slot via children composition.
 *
 * Usage:
 *   <MobileLayout header={<TopBar/>} bottomNav={<BottomNav/>}>
 *     <Page />
 *   </MobileLayout>
 */
interface Props {
  children: ReactNode;
  header?: ReactNode;
  bottomNav?: ReactNode;
  className?: string;
  scrollable?: boolean; // default true
}

export function MobileLayout({
  children,
  header,
  bottomNav,
  className,
  scrollable = true,
}: Props) {
  return (
    <div className="min-h-[100dvh] w-full bg-muted/30 flex justify-center">
      <div
        className={cn(
          "relative w-full max-w-[430px] min-h-[100dvh] bg-background",
          "flex flex-col shadow-xl shadow-black/5",
          className,
        )}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {header && (
          <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b border-border/60">
            {header}
          </div>
        )}
        <main
          className={cn(
            "flex-1",
            scrollable && "overflow-y-auto overscroll-contain",
            bottomNav &&
              "pb-[calc(64px+env(safe-area-inset-bottom)+16px)]",
          )}
        >
          {children}
        </main>
        {bottomNav && (
          <div
            className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-40 bg-background border-t border-border/60"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {bottomNav}
          </div>
        )}
      </div>
    </div>
  );
}
