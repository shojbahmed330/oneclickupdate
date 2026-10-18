import { useLocation } from "react-router-dom";
import { BottomNav } from "@/components/mobile/BottomNav";
import { useSwipeBack } from "@/hooks/useSwipeBack";

/**
 * MobileShell — global wrapper enabling:
 *  - app-wide BottomNav (auto-hides on builder/auth/admin routes via BottomNav rules)
 *  - iOS-style edge-swipe-back gesture
 *  - bottom padding so content never sits under the nav
 *
 * Mounted once in App.tsx around the <Routes>.
 */
export function MobileShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const HIDE_EXACT = ["/"];
  const HIDE_PREFIX = ["/dashboard", "/builder", "/auth", "/admin", "/onboarding", "/splash"];
  const showNav =
    !HIDE_EXACT.includes(pathname) && !HIDE_PREFIX.some((p) => pathname.startsWith(p));
  // Edge-swipe-back only on user-facing routes — never on builder/auth/admin
  // where horizontal touches inside panels would otherwise yank the user back
  // to /projects mid-build.
  useSwipeBack("/", showNav);

  return (
    <>
      <div className={showNav ? "pb-[calc(64px+env(safe-area-inset-bottom)+8px)] md:pb-0" : undefined}>
        {children}
      </div>
      {showNav && (
        <div
          className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur-md border-t border-border/60"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto max-w-[430px]">
            <BottomNav />
          </div>
        </div>
      )}
    </>
  );
}
