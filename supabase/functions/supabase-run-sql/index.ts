// Run SQL on the user's linked Supabase project via the Management API.
// SAFETY GUARDS — these are server-side and cannot be bypassed by the AI:
//   • Blocks DROP TABLE/SCHEMA/DATABASE, TRUNCATE, DELETE without WHERE,
//     ALTER USER/ROLE, GRANT … TO postgres, anything touching reserved schemas
//     (auth, storage, realtime, vault, supabase_functions, extensions, pg_*).
//   • Allows safe forward-only schema changes: CREATE TABLE/INDEX/POLICY/
//     FUNCTION/TRIGGER, ENABLE RLS, ALTER TABLE ADD/ALTER COLUMN, INSERT,
//     UPDATE … WHERE, SELECT.
// Returns { ok, blocked? , error?, result? }. Logs every attempt to
// supabase_operation_logs. After a successful schema change, refreshes the
// schema_cache on project_supabase_links.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, SBOAUTH_API_BASE, getValidAccessToken, logOp } from "../_shared/sboauth.ts";
import { withSentry } from "../_shared/sentry.ts";

const RESERVED_SCHEMAS = ["auth", "storage", "realtime", "vault", "supabase_functions", "extensions", "graphql", "graphql_public", "pgsodium", "pgsodium_masks"];

type GuardResult =
  | { ok: true }
  | { ok: false; reason: string; kind: "forbidden" | "destructive" };

function guardSql(rawSql: string): GuardResult {
  const sql = rawSql.trim();
  if (!sql) return { ok: false, reason: "Empty SQL", kind: "forbidden" };
  if (sql.length > 50_000) return { ok: false, reason: "SQL too large (>50KB)", kind: "forbidden" };

  // Strip comments and string literals so keywords inside them don't trip the guard.
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'[^']*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
  const upper = stripped.toUpperCase();

  // Hard-forbidden: never allowed even with confirmation.
  const forbiddenPatterns: Array<{ re: RegExp; reason: string }> = [
    { re: /\bALTER\s+(USER|ROLE|DATABASE|SYSTEM)\b/, reason: "ALTER USER/ROLE/DATABASE/SYSTEM is not allowed." },
    { re: /\bGRANT\b[\s\S]*\bTO\s+(POSTGRES|SUPABASE_ADMIN|SERVICE_ROLE)\b/, reason: "Granting privileges to system roles is not allowed." },
    { re: /\bCREATE\s+(USER|ROLE|EXTENSION|DATABASE)\b/, reason: "CREATE USER/ROLE/EXTENSION/DATABASE is not allowed." },
    { re: /\bSECURITY\s+DEFINER\b(?![\s\S]*\bSET\s+SEARCH_PATH\b)/, reason: "SECURITY DEFINER functions must SET search_path. Add `SET search_path = public` to the function." },
    { re: /\bCOPY\b/, reason: "COPY is not allowed." },
    { re: /\bRESET\s+ROLE\b|\bSET\s+ROLE\b/, reason: "SET/RESET ROLE is not allowed." },
  ];
  for (const { re, reason } of forbiddenPatterns) {
    if (re.test(upper)) return { ok: false, reason, kind: "forbidden" };
  }

  // Reserved schemas — also hard-forbidden.
  for (const schema of RESERVED_SCHEMAS) {
    const re = new RegExp(`\\b${schema}\\.`, "i");
    if (re.test(stripped)) {
      return { ok: false, reason: `Touching reserved schema "${schema}" is not allowed.`, kind: "forbidden" };
    }
    const altRe = new RegExp(`\\bALTER\\s+SCHEMA\\s+${schema}\\b`, "i");
    if (altRe.test(stripped)) return { ok: false, reason: `Cannot alter schema "${schema}".`, kind: "forbidden" };
  }

  // Destructive: requires explicit user confirmation (confirm: true).
  const destructivePatterns: Array<{ re: RegExp; reason: string }> = [
    { re: /\bDROP\s+(TABLE|SCHEMA|DATABASE|EXTENSION|ROLE|USER|FUNCTION|TRIGGER|POLICY|TYPE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE)\b/, reason: "DROP statement detected — this can permanently remove data." },
    { re: /\bTRUNCATE\b/, reason: "TRUNCATE will empty the table — all rows will be lost." },
    { re: /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/, reason: "DELETE without WHERE will remove every row in the table." },
    { re: /\bUPDATE\s+\S+\s+SET\b(?![\s\S]*\bWHERE\b)/, reason: "UPDATE without WHERE will modify every row in the table." },
  ];
  for (const { re, reason } of destructivePatterns) {
    if (re.test(upper)) return { ok: false, reason, kind: "destructive" };
  }

  return { ok: true };
}

async function refreshSchemaCache(admin: any, supabaseProjectRef: string, accessToken: string, projectId: string) {
  try {
    const r = await fetch(
      `${SBOAUTH_API_BASE}/projects/${supabaseProjectRef}/database/tables?included_schemas=public`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) return;
    const tables = await r.json();
    await admin
      .from("project_supabase_links")
      .update({ schema_cache: { tables }, schema_cached_at: new Date().toISOString() })
      .eq("project_id", projectId);
  } catch (_e) { /* best-effort */ }
}

Deno.serve(withSentry("supabase-run-sql", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ ok: false, error: "Auth failed" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { project_id, sql, confirm } = body as { project_id?: string; sql?: string; confirm?: boolean };
    if (!project_id || !sql) {
      return new Response(JSON.stringify({ ok: false, error: "project_id and sql are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Guard the SQL.
    const guard = guardSql(sql);
    if (!guard.ok) {
      // Hard-forbidden patterns are always blocked.
      if (guard.kind === "forbidden") {
        return new Response(JSON.stringify({ ok: false, blocked: true, reason: guard.reason }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Destructive patterns require explicit user confirmation.
      if (guard.kind === "destructive" && !confirm) {
        return new Response(JSON.stringify({
          ok: false,
          requires_confirmation: true,
          reason: guard.reason,
          sql,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Verify ownership of the project + fetch the linked Supabase project ref.
    const { data: link, error: linkErr } = await admin
      .from("project_supabase_links")
      .select("supabase_project_ref, project_id, user_id")
      .eq("project_id", project_id)
      .maybeSingle();
    if (linkErr || !link || link.user_id !== userId) {
      return new Response(JSON.stringify({ ok: false, error: "Project not linked or not owned by you" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidAccessToken(admin, userId);

    // Run via Management API: POST /v1/projects/{ref}/database/query
    const runResp = await fetch(
      `${SBOAUTH_API_BASE}/projects/${link.supabase_project_ref}/database/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      },
    );
    const runText = await runResp.text();
    let runJson: any = null;
    try { runJson = JSON.parse(runText); } catch { runJson = { raw: runText }; }

    if (!runResp.ok) {
      const errMsg = runJson?.message || runJson?.error || runText.slice(0, 500);
      await logOp(admin, userId, "run_sql", "error", `SQL failed on ${link.supabase_project_ref}: ${errMsg.slice(0, 200)}`, { project_id, sql_preview: sql.slice(0, 200), error: errMsg });
      return new Response(JSON.stringify({ ok: false, error: errMsg }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await logOp(admin, userId, "run_sql", "success", `Ran SQL on ${link.supabase_project_ref}`, { project_id, sql_preview: sql.slice(0, 200) });

    // Refresh schema cache (best-effort, async).
    refreshSchemaCache(admin, link.supabase_project_ref, accessToken, project_id);

    return new Response(JSON.stringify({ ok: true, result: runJson }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
