// Specialized Tool Ecosystem (Layer 5).
// One consolidated module — token-light, lazy-deferred via tools/index.ts.
//
// Adds:
//  - doc_search        (Lovable / library docs via AI gateway w/ web grounding)
//  - edit_image        (image-to-image edit via gemini-image-preview)
//  - parse_document    (PDF / CSV / DOCX → text, sandbox-side)
//  - db_query          (read-only SELECT via supabase-run-sql)
//  - gen_migration     (write timestamped migration file)
//  - edge_logs         (recent supabase_operation_logs for this project)
//  - security_scan     (RLS + secret-leak heuristic scan)
//  - read_analytics    (recent agent_runs / token usage for this project)
//  - cross_project_read (list/read files from caller's other projects)
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { SUPABASE_URL } from "../shared.ts";

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export function makeSpecializedTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    // ── 1. Doc / library search ────────────────────────────────
    doc_search: tool({
      description:
        "Search Lovable docs OR a specific library's docs / error message. Returns concise answer with citations. " +
        "Use BEFORE guessing on unfamiliar APIs (shadcn, framer-motion, supabase, react-query…) or cryptic errors.",
      inputSchema: z.object({
        query: z.string(),
        scope: z.enum(["lovable", "library", "error"]).default("library"),
      }),
      execute: async ({ query, scope }) => {
        const key = Deno.env.get("LOVABLE_API_KEY");
        if (!key) return { ok: false, error: "LOVABLE_API_KEY missing" };
        const sys = scope === "lovable"
          ? "You answer questions about Lovable (docs.lovable.dev) features, pricing, and usage. Cite sources."
          : scope === "error"
          ? "You diagnose programming errors. Find the root cause from official docs / GitHub issues. Cite sources."
          : "You answer library/API questions from official docs. Be concise, show minimal code, cite sources.";
        const r = await fetch(LOVABLE_GATEWAY, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: query },
            ],
          }),
        });
        const data = await r.json();
        return { ok: r.ok, answer: data?.choices?.[0]?.message?.content ?? data };
      },
    }),

    // ── 2. Image editing ──────────────────────────────────────
    edit_image: tool({
      description:
        "Edit an existing image in the project (input_path) with a text prompt. Saves to output_path. " +
        "Use for: removing backgrounds, color changes, recoloring logos, style transfer on assets.",
      inputSchema: z.object({
        input_path: z.string().describe("Existing image path in repo, e.g. src/assets/hero.png"),
        output_path: z.string().describe("Where to write the edited image"),
        prompt: z.string().describe("Edit instruction, e.g. 'remove background, keep subject'"),
      }),
      execute: async ({ input_path, output_path, prompt }) => {
        const key = Deno.env.get("LOVABLE_API_KEY");
        if (!key) return { ok: false, error: "LOVABLE_API_KEY missing" };
        // Read the source image as base64 from the sandbox
        const src = `${cwd}/${input_path}`;
        const r0 = await sandbox.exec(`base64 -w0 '${src}' 2>/dev/null | head -c 6000000`, cwd, 30);
        const b64src = String((r0 as any).stdout ?? (r0 as any).result ?? "").trim();
        if (!b64src) return { ok: false, error: `cannot read ${input_path}` };
        const ext = (input_path.split(".").pop() || "png").toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        const r = await fetch(LOVABLE_GATEWAY, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image-preview",
            modalities: ["image", "text"],
            messages: [{
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${mime};base64,${b64src}` } },
              ],
            }],
          }),
        });
        if (!r.ok) return { ok: false, error: `gateway ${r.status}: ${(await r.text()).slice(0, 300)}` };
        const data = await r.json();
        const b64: string | undefined =
          data?.choices?.[0]?.message?.images?.[0]?.image_url?.url?.split(",").pop();
        if (!b64) return { ok: false, error: "no image returned" };
        const dst = `${cwd}/${output_path}`;
        await sandbox.exec(
          `mkdir -p "$(dirname '${dst}')" && echo '${b64}' | base64 -d > '${dst}'`, cwd, 60,
        );
        return { ok: true, path: output_path };
      },
    }),

    // ── 3. Document parser ────────────────────────────────────
    parse_document: tool({
      description:
        "Parse PDF/CSV/DOCX/TXT inside the sandbox repo and return extracted text (truncated to 12 KB). " +
        "Auto-detects by extension. For CSV, returns header + first 50 rows.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const ext = (path.split(".").pop() || "").toLowerCase();
        const f = `${cwd}/${path}`;
        let cmd = "";
        if (ext === "pdf") cmd = `pdftotext -layout '${f}' - 2>/dev/null | head -c 12000`;
        else if (ext === "docx") cmd = `pandoc '${f}' -t plain 2>/dev/null | head -c 12000`;
        else if (ext === "csv") cmd = `head -n 51 '${f}' | head -c 12000`;
        else cmd = `head -c 12000 '${f}'`;
        const r = await sandbox.exec(cmd, cwd, 60);
        const text = String((r as any).stdout ?? (r as any).result ?? "");
        if (!text.trim()) {
          return { ok: false, error: `Empty / unreadable. For PDF install poppler, for DOCX install pandoc.` };
        }
        return { ok: true, ext, text, truncated: text.length >= 12000 };
      },
    }),

    // ── 4. Database read-only query ───────────────────────────
    db_query: tool({
      description:
        "Run a READ-ONLY SELECT query on the user's linked Supabase project. " +
        "Refuses anything that isn't a single SELECT. For DDL/DML use supabase_sql.",
      inputSchema: z.object({ sql: z.string() }),
      execute: async ({ sql }) => {
        const trimmed = sql.trim().replace(/;+\s*$/, "");
        if (!/^select\s/i.test(trimmed) || /;/.test(trimmed)) {
          return { ok: false, error: "db_query allows ONE SELECT statement only." };
        }
        const r = await fetch(`${SUPABASE_URL}/functions/v1/supabase-run-sql`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.userToken}` },
          body: JSON.stringify({ project_id: ctx.projectId, sql: trimmed + " LIMIT 200" }),
        });
        const text = await r.text();
        try { return JSON.parse(text); } catch { return { ok: false, error: text.slice(0, 400) }; }
      },
    }),

    // ── 5. Generate migration file ────────────────────────────
    gen_migration: tool({
      description:
        "Write a timestamped SQL file under supabase/migrations/ in the sandbox. " +
        "Use to RECORD a schema change you've already validated with supabase_sql, so it's reproducible.",
      inputSchema: z.object({
        name: z.string().regex(/^[a-z0-9_]+$/, "snake_case lowercase"),
        sql: z.string().min(5),
      }),
      execute: async ({ name, sql }) => {
        const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
        const path = `supabase/migrations/${stamp}_${name}.sql`;
        await sandbox.writeFile(`${cwd}/${path}`, sql.endsWith("\n") ? sql : sql + "\n");
        return { ok: true, path };
      },
    }),

    // ── 6. Edge function operation logs ───────────────────────
    edge_logs: tool({
      description:
        "Return the last N supabase operation logs (SQL runs, edge deploys, errors) for this project. " +
        "Use to debug 'why did my migration / function fail'.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(15) }),
      execute: async ({ limit }) => {
        const { data, error } = await ctx.supabase
          .from("supabase_operation_logs")
          .select("operation,status,request_summary,error_message,created_at")
          .eq("project_id", ctx.projectId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return { ok: false, error: error.message };
        return { ok: true, logs: data ?? [] };
      },
    }),

    // ── 7. Security scan (RLS + secret leak heuristic) ────────
    security_scan: tool({
      description:
        "Scan: (a) every public.* table for RLS-enabled + ≥1 policy, (b) repo files for hardcoded secrets " +
        "(AWS keys, OpenAI sk-..., bearer tokens, .env contents). Returns list of findings with severity. " +
        "Run BEFORE telling user to publish.",
      inputSchema: z.object({}),
      execute: async () => {
        const findings: Array<{ severity: "high"|"medium"|"low"; kind: string; detail: string }> = [];

        // (a) RLS check via cached schema
        const { data: link } = await ctx.supabase
          .from("project_supabase_links")
          .select("schema_cache")
          .eq("project_id", ctx.projectId)
          .maybeSingle();
        const tables = ((link as any)?.schema_cache?.tables ?? []) as Array<{ name: string; rls_enabled?: boolean; policy_count?: number }>;
        for (const t of tables) {
          if (t.rls_enabled === false) findings.push({ severity: "high", kind: "rls_disabled", detail: `public.${t.name} has RLS DISABLED` });
          else if ((t.policy_count ?? 0) === 0) findings.push({ severity: "high", kind: "no_policies", detail: `public.${t.name} has RLS but ZERO policies — nothing is accessible` });
        }

        // (b) Secret-leak grep
        const patterns = [
          { re: "AKIA[0-9A-Z]{16}", kind: "aws_key" },
          { re: "sk-[A-Za-z0-9]{20,}", kind: "openai_key" },
          { re: "ghp_[A-Za-z0-9]{20,}", kind: "github_pat" },
          { re: "Bearer [A-Za-z0-9._-]{30,}", kind: "bearer_token" },
        ];
        for (const p of patterns) {
          const r = await sandbox.exec(
            `grep -rIE --include='*.{ts,tsx,js,jsx,json,env}' --exclude-dir=node_modules --exclude-dir=.git -l '${p.re}' . 2>/dev/null | head -n 5`,
            cwd, 30,
          );
          const hits = String((r as any).stdout ?? (r as any).result ?? "").split("\n").filter(Boolean);
          for (const h of hits) findings.push({ severity: "high", kind: p.kind, detail: `${p.kind} pattern in ${h}` });
        }

        return { ok: true, count: findings.length, findings };
      },
    }),

    // ── 8. Project analytics reader ───────────────────────────
    read_analytics: tool({
      description:
        "Return recent usage stats for THIS project: agent runs, total tokens, success/error counts, top errors. " +
        "Use when user asks 'how much have I used / what's failing most'.",
      inputSchema: z.object({ days: z.number().int().min(1).max(30).default(7) }),
      execute: async ({ days }) => {
        const since = new Date(Date.now() - days * 86400_000).toISOString();
        const { data: runs } = await ctx.supabase
          .from("agent_runs")
          .select("status,total_tokens,prompt_tokens,completion_tokens,error_message,created_at")
          .eq("project_id", ctx.projectId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500);
        const list = runs ?? [];
        let totalTokens = 0, errors = 0, success = 0;
        const errCounts = new Map<string, number>();
        for (const r of list) {
          totalTokens += (r as any).total_tokens || 0;
          if ((r as any).status === "completed") success++;
          if ((r as any).error_message) {
            errors++;
            const key = String((r as any).error_message).slice(0, 80);
            errCounts.set(key, (errCounts.get(key) ?? 0) + 1);
          }
        }
        const topErrors = [...errCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([msg, n]) => ({ msg, count: n }));
        return { ok: true, days, runs: list.length, success, errors, totalTokens, topErrors };
      },
    }),

    // ── 9. Cross-project read ─────────────────────────────────
    cross_project_list: tool({
      description: "List the caller's OTHER projects (id, name) — for copying patterns/components.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await ctx.supabase
          .from("projects")
          .select("id,name,updated_at")
          .eq("user_id", ctx.userId)
          .neq("id", ctx.projectId)
          .order("updated_at", { ascending: false })
          .limit(20);
        if (error) return { ok: false, error: error.message };
        return { ok: true, projects: data ?? [] };
      },
    }),
    cross_project_read_file: tool({
      description:
        "Read a file from one of the caller's OTHER projects (must own it). Use after cross_project_list. " +
        "Useful for copying a working component / pattern into this project.",
      inputSchema: z.object({
        project_id: z.string().uuid(),
        path: z.string(),
      }),
      execute: async ({ project_id, path }) => {
        if (project_id === ctx.projectId) return { ok: false, error: "use read_file for current project" };
        // Ownership check
        const { data: proj } = await ctx.supabase
          .from("projects").select("id").eq("id", project_id).eq("user_id", ctx.userId).maybeSingle();
        if (!proj) return { ok: false, error: "project not found or not owned by you" };
        const { data, error } = await ctx.supabase
          .from("project_files")
          .select("path,content")
          .eq("project_id", project_id)
          .eq("path", path)
          .maybeSingle();
        if (error) return { ok: false, error: error.message };
        if (!data) return { ok: false, error: "file not found in that project" };
        return { ok: true, path: (data as any).path, content: String((data as any).content).slice(0, 30_000) };
      },
    }),
  };
}
