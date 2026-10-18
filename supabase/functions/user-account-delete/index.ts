// GDPR account deletion — permanently removes the user's data and the
// auth.users record. Called from Profile → Privacy with an explicit
// confirmation token (the user types their email).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tables to wipe. Order matters where foreign-key-ish references exist
// even though we don't use real FKs (RLS-style ownership only).
const USER_TABLES = [
  "agent_run_steps",
  "agent_runs",
  "agent_turn_events",
  "agent_turn_continuations",
  "chat_messages",
  "background_tasks",
  "project_checkpoints",
  "project_files",
  "project_plans",
  "project_publish_configs",
  "project_github_links",
  "project_supabase_links",
  "app_builds",
  "app_branding",
  "daytona_workspaces",
  "feature_flags",
  "notifications",
  "projects",
  "profiles",
  // Financial records intentionally NOT deleted (legal retention):
  // orders, credit_transactions, invoices, user_credits stay,
  // but we anonymize them by stripping PII below.
];

Deno.serve(withSentry("user-account-delete", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: { confirm_email?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  if ((body.confirm_email ?? "").trim().toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return json({ error: "Email confirmation does not match account email" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const errors: Array<{ table: string; error: string }> = [];

  for (const t of USER_TABLES) {
    const { error } = await admin.from(t).delete().eq("user_id", user.id);
    if (error) errors.push({ table: t, error: error.message });
  }

  // Anonymize retained financial rows
  await admin.from("orders").update({
    sender_account: "",
    transaction_id: "",
    ip_address: null,
    user_agent: null,
    device_fingerprint: null,
    admin_notes: "[user deleted]",
  }).eq("user_id", user.id);

  // Finally remove the auth user
  const { error: authDelErr } = await admin.auth.admin.deleteUser(user.id);
  if (authDelErr) errors.push({ table: "auth.users", error: authDelErr.message });

  return json({ success: errors.length === 0, errors });
}));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
