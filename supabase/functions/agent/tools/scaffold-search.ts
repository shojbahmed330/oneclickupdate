// scaffold_search — one call, writes a complete Postgres FTS setup for a table:
//   • tsvector generated column
//   • GIN index
//   • search_<table>(query text, lim int) SQL function returning ranked rows
//   • optional React hook at src/hooks/use<Table>Search.ts
// Agent uses this instead of hand-writing FTS DDL via supabase_ddl every time.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { SUPABASE_URL } from "../shared.ts";

export function makeScaffoldSearchTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    scaffold_search: tool({
      description:
        "Add full-text search to an existing Postgres table in one shot. " +
        "Creates a tsvector generated column, GIN index, a `search_<table>(q,lim)` SQL function, " +
        "and (optional) a typed React hook. Use AFTER the table exists. " +
        "Idempotent — safe to call twice.",
      inputSchema: z.object({
        table: z.string().regex(/^[a-z_][a-z0-9_]*$/),
        columns: z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).min(1).max(6)
          .describe("Text columns to index, e.g. ['title','body']"),
        language: z.string().default("english"),
        write_hook: z.boolean().default(true),
      }),
      execute: async ({ table, columns, language, write_hook }) => {
        const weights = ["A", "B", "C", "D"];
        const vectorExpr = columns
          .map((c, i) => `setweight(to_tsvector('${language}', coalesce(${c},'')), '${weights[Math.min(i, 3)]}')`)
          .join(" || ");

        const sql = `
-- FTS scaffold for public.${table}
ALTER TABLE public.${table}
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (${vectorExpr}) STORED;

CREATE INDEX IF NOT EXISTS ${table}_search_tsv_idx
  ON public.${table} USING GIN (search_tsv);

CREATE OR REPLACE FUNCTION public.search_${table}(q text, lim int DEFAULT 20)
RETURNS SETOF public.${table}
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT *
  FROM public.${table}
  WHERE search_tsv @@ websearch_to_tsquery('${language}', q)
  ORDER BY ts_rank(search_tsv, websearch_to_tsquery('${language}', q)) DESC
  LIMIT lim;
$$;
`.trim();

        // Run via supabase-run-sql edge function (same path supabase_ddl uses)
        const r = await fetch(`${SUPABASE_URL}/functions/v1/supabase-run-sql`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.userToken}` },
          body: JSON.stringify({ project_id: ctx.projectId, sql }),
        });
        const ddlText = await r.text();
        let ddlBody: any; try { ddlBody = JSON.parse(ddlText); } catch { ddlBody = { ok: false, error: ddlText.slice(0, 400) }; }
        if (!ddlBody?.ok) return { ok: false, stage: "ddl", error: ddlBody?.error ?? ddlText.slice(0, 400) };

        let hookPath: string | null = null;
        if (write_hook) {
          const pascal = table.split("_").map((s) => s[0]?.toUpperCase() + s.slice(1)).join("");
          hookPath = `src/hooks/use${pascal}Search.ts`;
          const hook = `import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function use${pascal}Search(query: string, limit = 20) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_${table}", { q, lim: limit });
      if (active) { setResults(data ?? []); setLoading(false); }
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [query, limit]);

  return { results, loading };
}
`;
          await sandbox.exec(
            `mkdir -p "${cwd}/src/hooks" && cat > "${cwd}/${hookPath}" <<'EOF'\n${hook}\nEOF`,
            cwd,
            30,
          );
        }

        return {
          ok: true,
          table,
          columns,
          rpc: `search_${table}`,
          hook_path: hookPath,
          usage_hint: write_hook
            ? `Call \`supabase.rpc("search_${table}", { q, lim: 20 })\` or use the new hook.`
            : `Call \`supabase.rpc("search_${table}", { q, lim: 20 })\`.`,
        };
      },
    }),
  };
}
