import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { setLastProjectId, clearLastProjectId } from "@/lib/lastProject";

export interface AgentProjectState {
  id: string | null;
  name: string;
  initialMessages: any[];
  loading: boolean;
}

/**
 * Loads (or creates) a project row and its prior chat messages for the
 * new Daytona-backed agent. Keeps state tiny — the agent runtime owns the
 * sandbox & files.
 */
export function useAgentProject(routeId: string | undefined): AgentProjectState {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<AgentProjectState>({
    id: null,
    name: "New chat",
    initialMessages: [],
    loading: true,
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    let cancelled = false;

    const ensure = async () => {
      try {
        let id = routeId ?? null;
        let name = "New chat";

        if (!id) {
          const { data, error } = await supabase
            .from("projects")
            .insert({ user_id: user.id, name: "New chat" })
            .select("id, name")
            .single();
          if (error) throw error;
          id = data.id;
          name = data.name;
          navigate(`/dashboard/${id}`, { replace: true });
        } else {
          const { data, error } = await supabase
            .from("projects")
            .select("id, name, user_id")
            .eq("id", id)
            .maybeSingle();
          if (error) throw error;
          if (!data) {
            // Project no longer exists (deleted, or stale lastProjectId).
            // Clear the pointer so future `/` / `/dashboard` visits don't
            // keep trying to open it, but stay on the page so the user can
            // decide what to do instead of yanking them away mid-build.
            clearLastProjectId();
            toast.error("Could not load project — please refresh");
            if (!cancelled) setState((s) => ({ ...s, loading: false }));
            return;
          }
          name = data.name;
        }

        // Remember this as the active workspace.
        if (id) setLastProjectId(id);

        const { data: rows } = await supabase
          .from("chat_messages")
          .select("id, role, content, parts, created_at, status, run_id, metadata")
          .eq("project_id", id!)
          .order("created_at", { ascending: true });

        // Convert persisted parts into UIMessage parts.
        // Assistant rows are persisted as AI-SDK ModelMessage[] (each entry has
        // {role, content:[{type:'text'|'tool-call'|'tool-result', ...}]}).
        // The UI expects flat UIMessage parts ({type:'text'|'tool-xxx'|...}).
        const toUIParts = (raw: any, fallbackText: string): any[] => {
          if (!Array.isArray(raw) || raw.length === 0) {
            return [{ type: "text", text: fallbackText ?? "" }];
          }
          // Already UI parts? (have `type` at top level, no `role`)
          if (raw[0] && typeof raw[0].type === "string" && !("role" in raw[0])) {
            return raw;
          }
          // ModelMessage[] → flatten content blocks.
          const out: any[] = [];
          // Pair tool-calls with tool-results by toolCallId.
          const toolResults = new Map<string, any>();
          for (const m of raw) {
            const content = Array.isArray(m?.content) ? m.content : [];
            for (const c of content) {
              if (c?.type === "tool-result" && c.toolCallId) {
                toolResults.set(c.toolCallId, c);
              }
            }
          }
          for (const m of raw) {
            const content = Array.isArray(m?.content) ? m.content : [];
            for (const c of content) {
              if (c?.type === "text" && typeof c.text === "string") {
                out.push({ type: "text", text: c.text });
              } else if (c?.type === "reasoning" && typeof c.text === "string") {
                out.push({ type: "reasoning", text: c.text });
              } else if (c?.type === "tool-call") {
                const tr = toolResults.get(c.toolCallId);
                out.push({
                  type: `tool-${c.toolName}`,
                  toolCallId: c.toolCallId,
                  state: tr ? "output-available" : "input-available",
                  input: c.input ?? c.args,
                  ...(tr ? { output: tr.output ?? tr.result } : {}),
                });
              }
            }
          }
          return out.length > 0 ? out : [{ type: "text", text: fallbackText ?? "" }];
        };

        const initial = (rows ?? []).flatMap((r: any) => {
          const parts = toUIParts(r.parts, r.content ?? "");
          // Only drop assistant rows that are TRULY empty (no text, no tool
          // calls). Interrupted / failed runs that produced partial output
          // stay visible — that's what the user wants on reload.
          if (r.role === "assistant") {
            const hasAnything = parts.some(
              (p: any) =>
                (p?.type === "text" && String(p.text ?? "").trim().length > 0) ||
                (typeof p?.type === "string" && p.type.startsWith("tool-")),
            );
            if (!hasAnything) return [];
          }
          return [{
            id: r.id,
            role: r.role,
            metadata: {
              ...(r.metadata ?? {}),
              ...(r.status && r.status !== "complete" ? { status: r.status } : {}),
            },
            parts,
          }];
        });

        if (!cancelled) {
          setState({ id, name, initialMessages: initial, loading: false });
        }
      } catch (err: any) {
        console.error("[useAgentProject]", err);
        toast.error(err?.message ?? "Could not load project");
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    };

    void ensure();
    return () => {
      cancelled = true;
    };
    // Depend on user.id (stable string), not the user object itself —
    // otherwise auth refresh re-creates the object reference and re-runs the
    // effect mid-build, which previously could redirect away on a transient
    // failure.
  }, [routeId, user?.id, authLoading, navigate]);

  return state;
}
