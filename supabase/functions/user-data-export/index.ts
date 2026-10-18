// GDPR data export — returns a single JSON file containing every row the
// signed-in user owns across all major tables. The user calls this from
// Profile → Privacy. We never include other users' data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Tables owned by the user via a `user_id` column. Per-RLS we'd be limited
// to these anyway when calling with the user's JWT, but we double-check
// server-side and use the service role to also pull related metadata.
const USER_TABLES = [
  "profiles",
  "projects",
  "project_files",
  "project_plans",
  "project_publish_configs",
  "project_github_links",
  "project_supabase_links",
  "project_checkpoints",
  "chat_messages",
  "agent_runs",
  "agent_run_steps",
  "background_tasks",
  "feature_flags",
  "notifications",
  "orders",
  "credit_transactions",
  "invoices",
  "app_branding",
  "app_builds",
  "daytona_workspaces",
] as const;

Deno.serve(withSentry("user-data-export", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const dump: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at },
    tables: {},
  };

  for (const t of USER_TABLES) {
    const { data, error } = await admin.from(t).select("*").eq("user_id", user.id);
    (dump.tables as Record<string, unknown>)[t] = error ? { error: error.message } : data;
  }

  // Credits balance (separate table indexed differently)
  const { data: credits } = await admin.from("user_credits").select("*").eq("user_id", user.id).maybeSingle();
  (dump.tables as Record<string, unknown>)["user_credits"] = credits ?? null;

  return new Response(JSON.stringify(dump, null, 2), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="oneclick-studio-data-${user.id}.json"`,
    },
  });
}));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
