import { m, AnimatePresence } from "framer-motion";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Wraps route children in a quick fade-in.
 *
 * Note: We deliberately drop the exit animation. With `mode="wait"` the old
 * page would block the new page's mount for the full exit duration, which
 * felt like a slow navigation. A short fade-in on the new page keeps the
 * polish without the perceived lag. `popLayout` lets the next page mount
 * immediately while any leftover animations finish in place.
 */
export const PageTransition = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  // Key on the FIRST path segment only. Otherwise navigating between
  // /dashboard/A → /dashboard/B (or any same-section transition) would
  // unmount the whole Builder subtree, killing the in-flight AI stream.
  const sectionKey = "/" + (location.pathname.split("/")[1] || "");
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <m.div
        key={sectionKey}
        initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="min-h-full"
      >
        {children}
      </m.div>
    </AnimatePresence>
  );
};

/** Stagger container — children automatically cascade in. */
export const StaggerGroup = ({
  children,
  delay = 0,
  stagger = 0.06,
  className,
}: {
  children: ReactNode;
  delay?: number;
  stagger?: number;
  className?: string;
}) => (
  <m.div
    className={className}
    initial="hidden"
    animate="show"
    variants={{
      hidden: {},
      show: { transition: { staggerChildren: stagger, delayChildren: delay } },
    }}
  >
    {children}
  </m.div>
);

export const StaggerItem = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <m.div
    className={className}
    variants={{
      hidden: { opacity: 0, y: 12 },
      show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
      },
    }}
  >
    {children}
  </m.div>
);
