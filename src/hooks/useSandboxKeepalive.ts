import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Keeps the Daytona sandbox warm while the builder tab is open.
 * - Wakes immediately on mount (covers cold-start after idle stop).
 * - Heartbeats every 5 min while the tab is visible so Daytona's
 *   auto-stop timer keeps resetting.
 */
export function useSandboxKeepalive(projectId: string | null | undefined) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;

    const ping = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const { data } = await supabase.functions.invoke("wake-sandbox", { body: { project_id: projectId } });
        const url = (data as any)?.url ?? (data as any)?.preview_url ?? (data as any)?.preview?.url;
        if (!cancelled && typeof url === "string") setPreviewUrl(url);
      } catch {
        /* best-effort — silent */
      }
    };

    void ping();
    const id = window.setInterval(ping, 5 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === "visible") void ping(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [projectId]);

  return previewUrl;
}
