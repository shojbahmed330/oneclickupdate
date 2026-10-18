import { NavLink, useLocation } from "react-router-dom";
import { LayoutGrid, FolderKanban, ShoppingBag, LifeBuoy, User } from "lucide-react";
import { m, LayoutGroup } from "framer-motion";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * App-wide BottomNav — refined editorial pass.
 * 5 tabs, 64px height. Active indicator is a spring-physics pill that
 * morphs between tabs via framer-motion `layoutId`. Inactive labels fade
 * to subtle, active label uses primary + tighter weight.
 */
const TABS = [
  { to: "/", icon: LayoutGrid, label: "Home" },
  { to: "/projects", icon: FolderKanban, label: "Projects" },
  { to: "/shop", icon: ShoppingBag, label: "Shop" },
  { to: "/support", icon: LifeBuoy, label: "Support" },
  { to: "/profile", icon: User, label: "Profile" },
] as const;

const HIDE_PREFIXES = ["/dashboard", "/builder", "/auth", "/admin"];

export function BottomNav() {
  const { pathname } = useLocation();
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <LayoutGroup id="bottom-nav">
      <nav className="h-16 grid grid-cols-5 px-1" role="navigation" aria-label="Primary">
        {TABS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={() => haptic("selection")}
            className={({ isActive }) =>
              cn(
                "relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[10.5px] font-semibold tracking-[-0.005em]",
                "active:scale-[0.92] transition-transform duration-150",
                isActive ? "text-primary" : "text-muted-foreground/80",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative flex items-center justify-center h-8 w-14 rounded-full">
                  {isActive && (
                    <m.span
                      layoutId="bottom-nav-pill"
                      className="absolute inset-0 rounded-full bg-primary/15 border border-primary/25"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <Icon
                    className={cn("relative h-5 w-5 transition-transform", isActive && "scale-110")}
                    strokeWidth={isActive ? 2.4 : 1.7}
                  />
                </span>
                <span className={cn("transition-opacity", !isActive && "opacity-70")}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </LayoutGroup>
  );
}
