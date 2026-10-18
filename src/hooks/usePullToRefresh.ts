import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

/**
 * usePullToRefresh — attach to a scroll container.
 * Returns { pulling, distance, bind } — spread `bind` onto the scroll element.
 *
 * const { pulling, distance, bind } = usePullToRefresh(async () => { await refetch(); });
 * <div {...bind} className="overflow-y-auto h-full">
 *   <RefreshIndicator visible={pulling} progress={distance/threshold} />
 *   ...
 * </div>
 */
const THRESHOLD = 70;
const MAX_PULL = 110;

export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const startY = useRef<number | null>(null);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (distance >= THRESHOLD && !triggeredRef.current) {
      triggeredRef.current = true;
      haptic("medium");
    }
  }, [distance]);

  const bind = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      const el = e.currentTarget;
      if (el.scrollTop > 0 || refreshing) return;
      startY.current = e.touches[0].clientY;
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0) setDistance(Math.min(dy * 0.5, MAX_PULL));
    },
    onTouchEnd: async () => {
      const past = distance >= THRESHOLD;
      startY.current = null;
      if (past) {
        setRefreshing(true);
        setDistance(THRESHOLD);
        try { await onRefresh(); } finally {
          setRefreshing(false);
          setDistance(0);
          triggeredRef.current = false;
        }
      } else {
        setDistance(0);
        triggeredRef.current = false;
      }
    },
  };

  return { pulling: distance > 0, refreshing, distance, threshold: THRESHOLD, bind };
}
