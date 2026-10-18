// User selected an option from a connector_proposals row, OR cancelled it.
// On select: spawn an agent_secret_requests row per required_secret in the
// chosen option. The chat UI's SecretRequestStack will pick them up via
// realtime — the user fills each in once, then the agent resumes the build.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const Body = z.object({
  proposal_id: z.string().uuid(),
  action: z.enum(["select", "cancel"]),
  option_index: z.number().int().min(0).max(10).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ ok: false, error: "invalid token" }, 401);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ ok: false, error: parsed.error.flatten() }, 400);
    const { proposal_id, action, option_index } = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: row } = await admin
      .from("connector_proposals").select("*").eq("id", proposal_id).maybeSingle();
    if (!row) return json({ ok: false, error: "not found" }, 404);
    if ((row as any).user_id !== uid) return json({ ok: false, error: "forbidden" }, 403);
    if ((row as any).status !== "pending") {
      return json({ ok: false, error: `already ${(row as any).status}` }, 409);
    }

    if (action === "cancel") {
      await admin.from("connector_proposals").update({ status: "cancelled" }).eq("id", proposal_id);
      return json({ ok: true, status: "cancelled" });
    }

    // action === "select"
    const opts = Array.isArray((row as any).options) ? (row as any).options : [];
    const idx = option_index ?? -1;
    if (idx < 0 || idx >= opts.length) return json({ ok: false, error: "invalid option_index" }, 400);
    const chosen = opts[idx];

    const secrets = Array.isArray(chosen?.required_secrets) ? chosen.required_secrets : [];
    if (secrets.length === 0) {
      await admin.from("connector_proposals").update({
        status: "failed",
        error_message: "Selected option has no required_secrets",
      }).eq("id", proposal_id);
      return json({ ok: false, error: "no secrets in option" }, 400);
    }

    // Bulk-create secret requests (dedupe against pending)
    const inserts: any[] = [];
    for (const s of secrets) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(String(s.name || ""))) continue;
      const { data: dup } = await admin
        .from("agent_secret_requests")
        .select("id")
        .eq("project_id", (row as any).project_id)
        .eq("secret_name", s.name)
        .eq("status", "pending")
        .maybeSingle();
      if (dup) continue;
      inserts.push({
        project_id: (row as any).project_id,
        user_id: uid,
        run_id: (row as any).run_id ?? null,
        secret_name: s.name,
        label: s.label ?? s.name,
        why_needed: `${chosen.name}: ${s.why ?? ""}`.trim(),
        link_hint: s.link_hint ?? "",
        doc_url: chosen.docs_url ?? "",
        status: "pending",
      });
    }

    if (inserts.length > 0) {
      const { error: insErr } = await admin.from("agent_secret_requests").insert(inserts);
      if (insErr) return json({ ok: false, error: insErr.message }, 500);
    }

    await admin.from("connector_proposals").update({
      status: "selected",
      selected_option_index: idx,
    }).eq("id", proposal_id);

    return json({
      ok: true,
      status: "selected",
      provider: chosen.name,
      secrets_requested: inserts.length,
      secret_names: inserts.map((i) => i.secret_name),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
