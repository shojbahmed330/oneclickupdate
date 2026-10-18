// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { SUPABASE_URL } from "../shared.ts";
import { rlsHintFor } from "../../_shared/safetyGuards.ts";

export function makeSupabaseDdlTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    supabase_schema: tool({
      description:
        "Read the CURRENT schema of the user's linked Supabase project (cached after last SQL run). " +
        "Returns tables in the public schema with their columns + types. ALWAYS call this BEFORE creating tables, " +
        "so you don't conflict with existing ones. Returns { linked:false } if no Supabase project is linked yet.",
      inputSchema: z.object({}).optional(),
      execute: async () => {
        const { data: link } = await ctx.supabase
          .from("project_supabase_links")
          .select("supabase_project_ref, supabase_project_name, api_url, schema_cache, schema_cached_at")
          .eq("project_id", ctx.projectId)
          .maybeSingle();
        if (!link) {
          return {
            linked: false,
            hint: "User has not linked a Supabase project yet. Tell them to open the Supabase panel and link one before you can create tables.",
          };
        }
        const tables = (link as any).schema_cache?.tables ?? [];
        return {
          linked: true,
          project_ref: (link as any).supabase_project_ref,
          project_name: (link as any).supabase_project_name,
          api_url: (link as any).api_url,
          schema_cached_at: (link as any).schema_cached_at,
          tables,
        };
      },
    }),
    supabase_sql: tool({
      description:
        "Run SQL on the user's LINKED Supabase project (their own backend, not yours). " +
        "Use for: CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX, ENABLE RLS, CREATE POLICY, " +
        "CREATE FUNCTION (with SET search_path), CREATE TRIGGER, INSERT seed rows, UPDATE … WHERE. " +
        "Server BLOCKS forbidden ops (touching auth/storage/realtime/vault, ALTER USER/ROLE, GRANT to system roles, " +
        "CREATE EXTENSION/USER/ROLE/DATABASE). " +
        "DESTRUCTIVE ops (DROP, TRUNCATE, DELETE/UPDATE without WHERE) return { requires_confirmation: true } — " +
        "the user must approve in the UI before they actually run. Tell the user clearly what will be lost and wait. " +
        "ALWAYS: enable RLS on every public.* table you create, and add policies that scope rows to auth.uid(). " +
        "Store roles in a separate user_roles table — NEVER on profiles. After success, schema cache auto-refreshes — " +
        "call supabase_schema again if you need updated info. Returns { ok, blocked?, requires_confirmation?, reason?, error?, result? }.",
      inputSchema: z.object({
        sql: z.string().min(1).describe("Single statement OR multi-statement SQL block. Use ; to separate."),
        rationale: z.string().optional().describe("One-line why — for the activity log."),
      }),
      execute: async ({ sql }) => {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/supabase-run-sql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ctx.userToken}`,
          },
          body: JSON.stringify({ project_id: ctx.projectId, sql }),
        });
        const text = await r.text();
        const rls_hint = rlsHintFor(sql);
        try {
          const j = JSON.parse(text);
          return rls_hint ? { ...j, rls_hint } : j;
        } catch {
          return { ok: false, error: text.slice(0, 500), ...(rls_hint ? { rls_hint } : {}) };
        }
      },
    }),

    // ── High-level structured Supabase migrations ────────────────
    // These wrap supabase_sql with hard-coded safe templates so the model
    // can't forget RLS, search_path, or timestamps. PREFER these over
    // hand-written SQL for the common cases.
    supabase_create_table: tool({
      description:
        "Create a public.<name> table the SAFE way: auto-adds id (uuid PK), created_at, updated_at, " +
        "auto-attaches an updated_at trigger, ENABLES RLS, and (when owned_by_user=true) adds user_id + the four owner policies. " +
        "Use this instead of raw supabase_sql for new tables. Skip id/created_at/updated_at/user_id in columns — added automatically.",
      inputSchema: z.object({
        name: z.string().regex(/^[a-z_][a-z0-9_]*$/, "snake_case only"),
        owned_by_user: z.boolean().default(true),
        columns: z.array(z.object({
          name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
          type: z.string().describe("Postgres type, e.g. text, integer, boolean, jsonb, numeric(10,2), timestamptz"),
          nullable: z.boolean().default(true),
          default: z.string().optional().describe("Raw SQL default, e.g. \"'pending'\" or 'false'"),
          unique: z.boolean().default(false),
        })).min(1),
        public_read: z.boolean().default(false),
      }),
      execute: async ({ name, owned_by_user, columns, public_read }) => {
        const cols = columns.map((c) => {
          const parts = [`  ${c.name} ${c.type}`];
          if (!c.nullable) parts.push("NOT NULL");
          if (c.default !== undefined) parts.push(`DEFAULT ${c.default}`);
          if (c.unique) parts.push("UNIQUE");
          return parts.join(" ");
        }).join(",\n");

        const userIdLine = owned_by_user
          ? `  user_id uuid NOT NULL DEFAULT auth.uid(),\n`
          : "";

        const ownerPolicies = owned_by_user ? `
CREATE POLICY "${name}_owner_select" ON public.${name}
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "${name}_owner_insert" ON public.${name}
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "${name}_owner_update" ON public.${name}
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "${name}_owner_delete" ON public.${name}
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
` : "";

        const publicReadPolicy = public_read ? `
CREATE POLICY "${name}_public_read" ON public.${name}
  FOR SELECT TO anon, authenticated USING (true);
` : "";

        const sql = `
CREATE TABLE IF NOT EXISTS public.${name} (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
${userIdLine}${cols},
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS ${name}_set_updated_at ON public.${name};
CREATE TRIGGER ${name}_set_updated_at
  BEFORE UPDATE ON public.${name}
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
${ownerPolicies}${publicReadPolicy}`.trim();

        const r = await fetch(`${SUPABASE_URL}/functions/v1/supabase-run-sql`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.userToken}` },
          body: JSON.stringify({ project_id: ctx.projectId, sql }),
        });
        const text = await r.text();
        try { const j = JSON.parse(text); return { ...j, sql_used: sql }; }
        catch { return { ok: false, error: text.slice(0, 500), sql_used: sql }; }
      },
    }),
    supabase_add_policy: tool({
      description:
        "Add an RLS policy to an existing public.<table> via named template. " +
        "template = 'owner_all' (4 owner policies), 'public_read' (anon SELECT), 'admin_all' (uses public.has_role), or 'custom'.",
      inputSchema: z.object({
        table: z.string().regex(/^[a-z_][a-z0-9_]*$/),
        template: z.enum(["owner_all", "public_read", "admin_all", "custom"]),
        custom_name: z.string().optional(),
        custom_op: z.enum(["SELECT","INSERT","UPDATE","DELETE","ALL"]).optional(),
        custom_using: z.string().optional(),
        custom_check: z.string().optional(),
      }),
      execute: async ({ table, template, custom_name, custom_op, custom_using, custom_check }) => {
        let sql = "";
        if (template === "owner_all") {
          sql = `
CREATE POLICY "${table}_owner_select" ON public.${table} FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "${table}_owner_insert" ON public.${table} FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "${table}_owner_update" ON public.${table} FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "${table}_owner_delete" ON public.${table} FOR DELETE TO authenticated USING (auth.uid() = user_id);
`.trim();
        } else if (template === "public_read") {
          sql = `CREATE POLICY "${table}_public_read" ON public.${table} FOR SELECT TO anon, authenticated USING (true);`;
        } else if (template === "admin_all") {
          sql = `CREATE POLICY "${table}_admin_all" ON public.${table} FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));`;
        } else {
          if (!custom_name || !custom_op) return { ok: false, error: "custom requires custom_name + custom_op" };
          const usingPart = custom_using ? `USING (${custom_using})` : "";
          const checkPart = custom_check ? `WITH CHECK (${custom_check})` : "";
          sql = `CREATE POLICY "${custom_name}" ON public.${table} FOR ${custom_op} TO authenticated ${usingPart} ${checkPart};`.trim();
        }
        const r = await fetch(`${SUPABASE_URL}/functions/v1/supabase-run-sql`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.userToken}` },
          body: JSON.stringify({ project_id: ctx.projectId, sql }),
        });
        const text = await r.text();
        try { const j = JSON.parse(text); return { ...j, sql_used: sql }; }
        catch { return { ok: false, error: text.slice(0, 500), sql_used: sql }; }
      },
    }),
  };
}
