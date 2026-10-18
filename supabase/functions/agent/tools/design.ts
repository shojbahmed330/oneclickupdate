// Design reference tools — fetch user-approved mobile HTML prototypes from
// `design_references`. Each project can have multiple screens (login, home,
// cart, etc.). HTML is heavy (~6–10k tokens/screen), so it's stored separately
// and NOT carried in every turn's context.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeDesignTools(_sandbox: DaytonaSandbox, ctx: ToolCtx, _cwd: string) {
  return {
    list_design_references: tool({
      description:
        "List all user-approved mobile screen prototypes for THIS project (labels + keys only, no HTML). " +
        "Call this ONCE at the start when the user's prompt mentions '[Design reference attached]'. " +
        "Then call `get_design_reference` per-screen as you build the corresponding React route.",
      inputSchema: z.object({}).optional(),
      execute: async () => {
        const { data, error } = await ctx.supabase
          .from("design_references")
          .select("screen_key, screen_label, screen_index, model, created_at")
          .eq("project_id", ctx.projectId)
          .eq("user_id", ctx.userId)
          .order("screen_index", { ascending: true });
        if (error) return { ok: false, error: error.message };
        if (!data || data.length === 0) return { ok: false, reason: "no design references saved for this project" };
        return { ok: true, count: data.length, screens: data };
      },
    }),

    get_design_reference: tool({
      description:
        "Fetch the HTML prototype for one specific screen of THIS project. " +
        "Pass the `screen_key` from `list_design_references` (e.g. 'login', 'home', 'cart'). " +
        "If no key is passed, returns the first/main screen. " +
        "Use the returned HTML to match layout, colors, typography, spacing, and component " +
        "structure as closely as possible when writing the React + Tailwind version of that screen.",
      inputSchema: z.object({
        screen_key: z.string().optional().describe("kebab-case screen key like 'home' or 'cart'; omit to get the first screen"),
      }).optional(),
      execute: async (args) => {
        const key = args?.screen_key;
        let q = ctx.supabase
          .from("design_references")
          .select("prompt, html, model, screen_key, screen_label, screen_index, created_at")
          .eq("project_id", ctx.projectId)
          .eq("user_id", ctx.userId);
        if (key) q = q.eq("screen_key", key);
        else q = q.order("screen_index", { ascending: true }).limit(1);
        const { data, error } = await q.maybeSingle();
        if (error) return { ok: false, error: error.message };
        if (!data) return { ok: false, reason: key ? `no screen with key '${key}'` : "no design references saved" };
        return {
          ok: true,
          screen_key: data.screen_key,
          screen_label: data.screen_label,
          prompt: data.prompt,
          html: data.html,
          model: data.model,
          html_size_chars: data.html?.length ?? 0,
        };
      },
    }),
  };
}
