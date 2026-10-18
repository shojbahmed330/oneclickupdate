import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SecretRequestStatus = "pending" | "provided" | "declined" | "cancelled";

export interface AgentSecretRequest {
  id: string;
  project_id: string;
  user_id: string;
  secret_name: string;
  label: string;
  why_needed: string;
  link_hint: string;
  doc_url: string;
  status: SecretRequestStatus;
  fulfilled_at: string | null;
  error_message: string | null;
  created_at: string;
}

/**
 * Subscribes to agent_secret_requests for a project and exposes
 * the live list + a submit() helper.
 */
export function useAgentSecretRequests(projectId: string | null | undefined) {
  const [requests, setRequests] = useState<AgentSecretRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial load + realtime
  useEffect(() => {
    if (!projectId) {
      setRequests([]);
      setLoading(false);
      return;
    }
    let active = true;

    (async () => {
      const { data } = await supabase
        .from("agent_secret_requests")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!active) return;
      setRequests((data ?? []) as AgentSecretRequest[]);
      setLoading(false);
    })();

    const ch = supabase
      .channel(`secret-requests:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_secret_requests",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          setRequests((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as AgentSecretRequest;
              if (prev.find((r) => r.id === row.id)) return prev;
              return [row, ...prev].slice(0, 20);
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as AgentSecretRequest;
              return prev.map((r) => (r.id === row.id ? row : r));
            }
            if (payload.eventType === "DELETE") {
              const row = payload.old as AgentSecretRequest;
              return prev.filter((r) => r.id !== row.id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [projectId]);

  const submit = useCallback(
    async (requestId: string, action: "provide" | "decline" | "cancel", value?: string) => {
      const { data, error } = await supabase.functions.invoke("agent-secret-action", {
        body: { request_id: requestId, action, value },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "Failed");
      return data;
    },
    [],
  );

  const pending = requests.filter((r) => r.status === "pending");

  return { requests, pending, loading, submit };
}
