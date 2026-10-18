import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ProposalStatus = "pending" | "selected" | "cancelled" | "failed";

export interface ConnectorOption {
  name: string;
  tagline: string;
  why: string;
  pricing_note: string;
  docs_url: string;
  signup_url: string;
  required_secrets: { name: string; label: string; why: string; link_hint: string }[];
}

export interface ConnectorProposal {
  id: string;
  project_id: string;
  user_id: string;
  need_description: string;
  category: string;
  options: ConnectorOption[];
  selected_option_index: number | null;
  status: ProposalStatus;
  error_message: string | null;
  created_at: string;
}

export function useConnectorProposals(projectId: string | null | undefined) {
  const [proposals, setProposals] = useState<ConnectorProposal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      setProposals([]);
      setLoading(false);
      return;
    }
    let active = true;

    (async () => {
      const { data } = await supabase
        .from("connector_proposals")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!active) return;
      setProposals(((data ?? []) as unknown) as ConnectorProposal[]);
      setLoading(false);
    })();

    const ch = supabase
      .channel(`connector-proposals:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "connector_proposals", filter: `project_id=eq.${projectId}` },
        (payload) => {
          setProposals((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as ConnectorProposal;
              if (prev.find((r) => r.id === row.id)) return prev;
              return [row, ...prev].slice(0, 10);
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as ConnectorProposal;
              return prev.map((r) => (r.id === row.id ? row : r));
            }
            if (payload.eventType === "DELETE") {
              const row = payload.old as ConnectorProposal;
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

  const resolve = useCallback(
    async (proposalId: string, action: "select" | "cancel", optionIndex?: number) => {
      const { data, error } = await supabase.functions.invoke("connector-resolve", {
        body: { proposal_id: proposalId, action, option_index: optionIndex },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "Failed");
      return data;
    },
    [],
  );

  const pending = proposals.filter((p) => p.status === "pending");
  return { proposals, pending, loading, resolve };
}
