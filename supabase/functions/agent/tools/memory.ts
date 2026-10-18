// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeMemoryTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    recall: tool({
      description:
        "Load saved memories for THIS project. Core + user-level rules are ALREADY auto-injected into your context every turn — only call this when you need topical/archived rules or to search by keyword. Returns array of { scope, category, content }.",
      inputSchema: z.object({
        keyword: z.string().optional().describe("Optional substring to filter content (case-insensitive)."),
        include_archived: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(20),
      }).optional(),
      execute: async (args: any = {}) => {
        let q = ctx.supabase
          .from("project_memory")
          .select("scope, category, content, weight, updated_at, archived")
          .eq("user_id", ctx.userId)
          .or(`project_id.eq.${ctx.projectId},project_id.is.null`)
          .order("weight", { ascending: false })
          .order("last_used_at", { ascending: false })
          .limit(args.limit ?? 20);
        if (!args.include_archived) q = q.eq("archived", false);
        if (args.keyword) q = q.ilike("content", `%${args.keyword}%`);
        const { data, error } = await q;
        if (error) return { ok: false, error: error.message, memories: [] };
        return { ok: true, memories: data ?? [] };
      },
    }),
    remember: tool({
      description:
        "Save a DURABLE rule. Pick scope carefully:\n" +
        "  • core    — applies to EVERY turn of THIS project (design tokens, forbidden patterns, stack choices). Always-on.\n" +
        "  • user    — cross-project user preference (communication style, language, expertise). Project_id is NULL.\n" +
        "  • topical — feature/business rule that should only surface when relevant. Default.\n" +
        "Skip if a similar memory already exists (call recall first). Auto-trigger phrases ('never X', 'always X', 'korbe na') are ALREADY auto-saved as core — don't duplicate.",
      inputSchema: z.object({
        content: z.string().min(3).max(200),
        scope: z.enum(["core", "topical", "user"]).default("topical"),
        category: z.enum(["preference", "design", "feature", "constraint", "lesson", "bug"]).default("preference"),
        weight: z.number().int().min(1).max(10).default(3),
      }),
      execute: async ({ content, scope, category, weight }) => {
        const projectId = scope === "user" ? null : ctx.projectId;
        // Use upsert via insert with ignore-duplicate (unique partial index).
        const { data, error } = await ctx.supabase.from("project_memory").insert({
          project_id: projectId,
          user_id: ctx.userId,
          content,
          category,
          scope,
          weight,
          source: "agent",
        }).select().maybeSingle();
        if (error) {
          if (String(error.code) === "23505" || /duplicate/i.test(error.message ?? "")) {
            return { ok: true, deduped: true };
          }
          return { ok: false, error: error.message };
        }
        return { ok: true, saved: { content, scope, category, weight, id: data?.id } };
      },
    }),
    forget: tool({
      description:
        "Archive a memory the user no longer wants applied. Use when the user says 'forget that', 'cancel that rule', 'don't apply X anymore'. Pass either id (preferred) or a unique substring.",
      inputSchema: z.object({
        id: z.string().uuid().optional(),
        match: z.string().min(3).max(200).optional(),
      }),
      execute: async ({ id, match }) => {
        if (!id && !match) return { ok: false, error: "id or match required" };
        let q = ctx.supabase.from("project_memory").update({ archived: true }).eq("user_id", ctx.userId);
        if (id) q = q.eq("id", id);
        else if (match) q = q.ilike("content", `%${match}%`);
        const { data, error } = await q.select("id");
        if (error) return { ok: false, error: error.message };
        return { ok: true, archived: data?.length ?? 0 };
      },
    }),
    record_lesson: tool({
      description:
        "Project Knowledge Base — save a one-line LESSON after fixing a non-trivial bug. " +
        "Use AFTER heal/build_app finally goes ok:true following ≥2 failed iterations on the same root cause. " +
        "Format: 'When X, do Y because Z'. Auto-saved as scope='core' so it applies every future turn.",
      inputSchema: z.object({
        lesson: z.string().min(10).max(200),
        weight: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ lesson, weight }) => {
        const { error } = await ctx.supabase.from("project_memory").insert({
          project_id: ctx.projectId,
          user_id: ctx.userId,
          content: lesson,
          category: "lesson",
          scope: "core",
          weight,
          source: "agent_lesson",
        });
        if (error) {
          if (String(error.code) === "23505") return { ok: true, deduped: true };
          return { ok: false, error: error.message };
        }
        return { ok: true, saved: { lesson, weight } };
      },
    }),
  };
}
