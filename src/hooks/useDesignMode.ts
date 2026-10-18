import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Status = "idle" | "planning" | "generating" | "preview" | "saving" | "error";

export interface ScreenPlan {
  key: string;
  label: string;
  purpose?: string;
}

export interface ScreenState extends ScreenPlan {
  html: string | null;
  status: "pending" | "generating" | "ready" | "error";
  error?: string;
}

export interface DesignModeState {
  status: Status;
  prompt: string | null;
  screens: ScreenState[];
  activeIndex: number;
  error: string | null;
}

const initial: DesignModeState = {
  status: "idle",
  prompt: null,
  screens: [],
  activeIndex: 0,
  error: null,
};

export function useDesignMode(projectId: string) {
  const [state, setState] = useState<DesignModeState>(initial);

  // Generate one screen and update its slot
  const generateOneScreen = useCallback(
    async (prompt: string, screen: ScreenPlan, styleHint?: string) => {
      setState((s) => ({
        ...s,
        screens: s.screens.map((sc) =>
          sc.key === screen.key ? { ...sc, status: "generating", error: undefined } : sc,
        ),
      }));
      try {
        const { data, error } = await supabase.functions.invoke("design-prototype", {
          body: { mode: "screen", prompt, screen, styleHint },
        });
        if (error) throw error;
        if (!data?.html) throw new Error("No HTML returned");
        setState((s) => ({
          ...s,
          screens: s.screens.map((sc) =>
            sc.key === screen.key ? { ...sc, status: "ready", html: data.html } : sc,
          ),
        }));
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setState((s) => ({
          ...s,
          screens: s.screens.map((sc) =>
            sc.key === screen.key ? { ...sc, status: "error", error: msg } : sc,
          ),
        }));
      }
    },
    [],
  );

  // Full flow: plan → fan-out generate
  const generate = useCallback(
    async (prompt: string) => {
      setState({ ...initial, status: "planning", prompt });
      try {
        const { data, error } = await supabase.functions.invoke("design-prototype", {
          body: { mode: "plan", prompt },
        });
        if (error) throw error;
        const plan: ScreenPlan[] = data?.screens ?? [];
        if (!plan.length) throw new Error("No screens returned by planner");

        const screens: ScreenState[] = plan.map((p) => ({
          ...p,
          html: null,
          status: "pending",
        }));
        setState((s) => ({ ...s, status: "generating", screens, activeIndex: 0 }));

        // Fan out — first screen sets the style; the rest get a style hint
        await generateOneScreen(prompt, plan[0]);
        const styleHint = `Use the SAME palette, typography, and component style as the "${plan[0].label}" screen for this app.`;
        await Promise.all(plan.slice(1).map((p) => generateOneScreen(prompt, p, styleHint)));

        setState((s) => ({ ...s, status: "preview" }));
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setState((s) => ({ ...s, status: "error", error: msg }));
        toast.error("Design preview failed", { description: msg });
      }
    },
    [generateOneScreen],
  );

  const regenerateScreen = useCallback(
    (key: string) => {
      if (!state.prompt) return;
      const screen = state.screens.find((s) => s.key === key);
      if (!screen) return;
      const firstReady = state.screens.find((s) => s.status === "ready" && s.key !== key);
      const styleHint = firstReady
        ? `Use the SAME palette, typography, and component style as the "${firstReady.label}" screen.`
        : undefined;
      void generateOneScreen(state.prompt, screen, styleHint);
    },
    [state.prompt, state.screens, generateOneScreen],
  );

  const regenerateAll = useCallback(() => {
    if (!state.prompt) return;
    void generate(state.prompt);
  }, [state.prompt, generate]);

  const setActiveIndex = useCallback((i: number) => {
    setState((s) => ({ ...s, activeIndex: Math.max(0, Math.min(s.screens.length - 1, i)) }));
  }, []);

  const dismiss = useCallback(() => setState(initial), []);

  /**
   * Save all ready screens to design_references and return the slim agent prompt
   * that does NOT inline any HTML. Agent fetches via list_design_references tool.
   */
  const approveAndBuildPrompt = useCallback(async (): Promise<string | null> => {
    const ready = state.screens.filter((s) => s.status === "ready" && s.html);
    if (!state.prompt || ready.length === 0) return null;
    setState((s) => ({ ...s, status: "saving" }));
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) throw new Error("Not authenticated");

      // Wipe any existing references for this project, then insert fresh batch
      await supabase.from("design_references").delete().eq("project_id", projectId);

      const rows = ready.map((s, i) => ({
        project_id: projectId,
        user_id: uid,
        prompt: state.prompt!,
        html: s.html!,
        model: "anthropic/claude-opus-4.7",
        screen_key: s.key,
        screen_label: s.label,
        screen_index: i,
      }));
      const { error } = await supabase.from("design_references").insert(rows);
      if (error) throw error;

      const slimPrompt = [
        state.prompt,
        "",
        `📐 [Design reference attached — ${ready.length} screen${ready.length > 1 ? "s" : ""}]`,
        `I've approved a multi-screen mobile HTML prototype for this project. Screens: ${ready.map((s) => `"${s.label}"`).join(", ")}.`,
        "",
        "⚠️ PROTOTYPE-FIRST MODE — DO NOT call `propose_plan` / `get_plan` / `approve_plan`. The prototype IS the plan. Skip the planning phase entirely.",
        "",
        "Workflow this turn:",
        "1. Call `list_design_references` ONCE to see all screens.",
        "2. For each screen: `get_design_reference` → convert to a React route/page that matches its layout, palette, typography, spacing, and component structure as closely as possible. Make it responsive (reference is mobile-first 390px).",
        "3. Wire real backend persistence with Lovable Cloud (Supabase) — NEVER localStorage for app data.",
        "4. Build all screens in one cohesive app with shared design tokens (semantic colors only, no text-white/black/gray-*).",
      ].join("\n");

      setState(initial);
      return slimPrompt;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setState((s) => ({ ...s, status: "error", error: msg }));
      toast.error("Couldn't save design reference", { description: msg });
      return null;
    }
  }, [projectId, state.prompt, state.screens]);

  return {
    state,
    generate,
    regenerateScreen,
    regenerateAll,
    setActiveIndex,
    dismiss,
    approveAndBuildPrompt,
  };
}
