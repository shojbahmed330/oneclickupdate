import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppBuild = {
  id: string;
  project_id: string;
  user_id: string;
  platform: "android" | "ios";
  status: "queued" | "preparing" | "building" | "uploading" | "ready" | "failed" | "cancelled";
  app_name: string;
  package_id: string;
  version_name: string;
  version_code: number;
  github_run_id: string | null;
  github_run_url: string | null;
  download_url: string | null;
  aab_download_url: string | null;
  signing_mode: "debug" | "release";
  keystore_sha1: string | null;
  file_size_bytes: number | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppBuildStep = {
  id: string;
  build_id: string;
  step_key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail: string | null;
  step_order: number;
  started_at: string | null;
  finished_at: string | null;
};

const ACTIVE_STATUSES: AppBuild["status"][] = ["queued", "preparing", "building", "uploading"];

// Subscribe to a single build (status + steps) in realtime via TanStack Query.
export function useBuildLive(buildId: string | null) {
  const qc = useQueryClient();

  const buildQ = useQuery({
    queryKey: ["app_build", buildId],
    enabled: !!buildId,
    refetchInterval: (query) => {
      const status = (query.state.data as AppBuild | null | undefined)?.status;
      return status && ACTIVE_STATUSES.includes(status) ? 3000 : false;
    },
    queryFn: async () => {
      const { data } = await supabase.from("app_builds").select("*").eq("id", buildId!).maybeSingle();
      const localBuild = (data as AppBuild) ?? null;
      if (!localBuild || !ACTIVE_STATUSES.includes(localBuild.status)) return localBuild;
      const synced = await supabase.functions.invoke("build-status", { body: { buildId } });
      if (synced.data?.steps) qc.setQueryData(["app_build_steps", buildId], synced.data.steps as AppBuildStep[]);
      return (synced.data?.build as AppBuild) ?? localBuild;
    },
  });

  const stepsQ = useQuery({
    queryKey: ["app_build_steps", buildId],
    enabled: !!buildId,
    refetchInterval: buildQ.data && ACTIVE_STATUSES.includes(buildQ.data.status) ? 3000 : false,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_build_steps")
        .select("*")
        .eq("build_id", buildId!)
        .order("step_order", { ascending: true });
      return (data as AppBuildStep[]) ?? [];
    },
  });

  useEffect(() => {
    if (!buildId) return;
    const ch = supabase
      .channel(`build:${buildId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_builds", filter: `id=eq.${buildId}` },
        (payload) => {
          if (payload.new) qc.setQueryData(["app_build", buildId], payload.new as AppBuild);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_build_steps", filter: `build_id=eq.${buildId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["app_build_steps", buildId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [buildId, qc]);

  return { build: buildQ.data ?? null, steps: stepsQ.data ?? [] };
}

// Active (in-flight) build for a project — picks the latest non-terminal one.
export function useActiveBuild(projectId: string | null) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["active_build", projectId],
    enabled: !!projectId,
    refetchInterval: (query) => (query.state.data ? 3000 : false),
    queryFn: async () => {
      const { data } = await supabase
        .from("app_builds")
        .select("*")
        .eq("project_id", projectId!)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as AppBuild) ?? null;
    },
  });

  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`active-build:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_builds", filter: `project_id=eq.${projectId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["active_build", projectId] });
          qc.invalidateQueries({ queryKey: ["project_builds", projectId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [projectId, qc]);

  return {
    activeBuild: q.data ?? null,
    refresh: () => qc.invalidateQueries({ queryKey: ["active_build", projectId] }),
  };
}

// List recent builds for a project
export function useProjectBuilds(projectId: string | null) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["project_builds", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_builds")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(10);
      return (data as AppBuild[]) ?? [];
    },
  });

  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`project-builds:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_builds", filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ["project_builds", projectId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [projectId, qc]);

  return {
    builds: q.data ?? [],
    loading: q.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ["project_builds", projectId] }),
  };
}
