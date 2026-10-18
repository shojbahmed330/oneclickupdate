// Cross-device sync — subscribes to chat_messages + project_files realtime
// streams for the current project.
//
// Upgrade over last-write-wins: detects a CONFLICT when a remote change lands
// while the local tab is "dirty" (the user is actively composing / streaming
// an agent turn). Surfaces a hasRemoteChange flag the UI can use to render a
// banner asking the user to reload before they overwrite the other device.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Kind = "message" | "file" | "plan";

export function useCrossDeviceSync(
  projectId: string | null | undefined,
  onChange: (kind: Kind) => void,
) {
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`sync:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `project_id=eq.${projectId}` },
        () => onChange("message"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_files", filter: `project_id=eq.${projectId}` },
        () => onChange("file"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_plans", filter: `project_id=eq.${projectId}` },
        () => onChange("plan"),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, onChange]);
}

/**
 * Conflict-aware variant. Caller passes `isDirty` (true when the user is
 * composing or the agent is streaming locally). If a remote change arrives
 * while dirty, we hold it instead of auto-refetching — the UI shows a banner
 * and the user explicitly accepts via `resolve()`.
 */
export function useCrossDeviceSyncConflict(
  projectId: string | null | undefined,
  isDirty: boolean,
  refetch: () => void,
) {
  const [pendingKind, setPendingKind] = useState<Kind | null>(null);
  const dirtyRef = useRef(isDirty);
  useEffect(() => { dirtyRef.current = isDirty; }, [isDirty]);

  const onChange = useCallback((kind: Kind) => {
    if (dirtyRef.current) {
      // Hold the change — show conflict banner.
      setPendingKind((cur) => cur ?? kind);
    } else {
      // Safe to merge immediately.
      refetch();
    }
  }, [refetch]);

  useCrossDeviceSync(projectId, onChange);

  const resolve = useCallback(() => {
    setPendingKind(null);
    refetch();
  }, [refetch]);

  const dismiss = useCallback(() => setPendingKind(null), []);

  return { hasRemoteChange: pendingKind !== null, pendingKind, resolve, dismiss };
}
