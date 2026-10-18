// Project checkpoints hook — list, create, restore, and branch.
// Backed by `project_checkpoints` (snapshot of source files) and the
// `checkpoint-action` edge function that performs sandbox-side restore/branch.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Checkpoint = {
  id: string;
  label: string;
  source: string;
  file_count: number;
  total_bytes: number;
  created_at: string;
};

export function useCheckpoints(projectId: string | null) {
  const [items, setItems] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_checkpoints")
      .select("id,label,source,file_count,total_bytes,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(30);
    setLoading(false);
    if (error) {
      toast.error("Could not load checkpoints", { description: error.message });
      return;
    }
    setItems((data ?? []) as Checkpoint[]);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (label: string) => {
      if (!projectId) return;
      setBusyId("__create");
      const { data, error } = await supabase.functions.invoke("checkpoint-action", {
        body: { action: "create", projectId, label: label || "Manual checkpoint" },
      });
      setBusyId(null);
      if (error || !data?.ok) {
        toast.error("Checkpoint failed", { description: error?.message ?? data?.error });
        return;
      }
      toast.success(`Saved checkpoint (${data.file_count} files)`);
      refresh();
    },
    [projectId, refresh],
  );

  const restore = useCallback(
    async (id: string) => {
      if (!projectId) return;
      setBusyId(id);
      const { data, error } = await supabase.functions.invoke("checkpoint-action", {
        body: { action: "restore", projectId, checkpointId: id },
      });
      setBusyId(null);
      if (error || !data?.ok) {
        toast.error("Restore failed", { description: error?.message ?? data?.error });
        return;
      }
      toast.success(`Restored ${data.restored} files`, {
        description: "Reloading preview…",
      });
      // Soft reload of preview iframe via global event.
      window.dispatchEvent(new CustomEvent("agent-preview-reload"));
    },
    [projectId],
  );

  const branch = useCallback(
    async (id: string, name: string): Promise<string | null> => {
      if (!projectId) return null;
      setBusyId(id);
      const { data, error } = await supabase.functions.invoke("checkpoint-action", {
        body: { action: "branch", projectId, checkpointId: id, name: name || "Branch from checkpoint" },
      });
      setBusyId(null);
      if (error || !data?.ok) {
        toast.error("Branch failed", { description: error?.message ?? data?.error });
        return null;
      }
      toast.success("New project created from checkpoint");
      return data.newProjectId as string;
    },
    [projectId],
  );

  return { items, loading, busyId, refresh, create, restore, branch };
}
