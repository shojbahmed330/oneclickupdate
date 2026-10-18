// User action on an agent secret request: provide value or decline.
// On "provide" we push the secret to the user's linked Supabase project via
// the Management API so it becomes a runtime env var in their edge functions.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { getValidAccessToken, SBOAUTH_API_BASE, logOp } from "../_shared/sboauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const Body = z.object({
  request_id: z.string().uuid(),
  action: z.enum(["provide", "decline", "cancel"]),
  value: z.string().min(1).max(10_000).optional(),
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
    if (!parsed.success) {
      return json({ ok: false, error: parsed.error.flatten() }, 400);
    }
    const { request_id, action, value } = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: reqRow, error: reqErr } = await admin
      .from("agent_secret_requests")
      .select("*")
      .eq("id", request_id)
      .maybeSingle();
    if (reqErr || !reqRow) return json({ ok: false, error: "request not found" }, 404);
    if (reqRow.user_id !== uid) return json({ ok: false, error: "forbidden" }, 403);
    if (reqRow.status !== "pending") {
      return json({ ok: false, error: `already ${reqRow.status}` }, 409);
    }

    if (action === "decline" || action === "cancel") {
      await admin
        .from("agent_secret_requests")
        .update({ status: action === "decline" ? "declined" : "cancelled", fulfilled_at: new Date().toISOString() })
        .eq("id", request_id);
      return json({ ok: true, status: action === "decline" ? "declined" : "cancelled" });
    }

    // action === "provide"
    if (!value || !value.trim()) return json({ ok: false, error: "value required" }, 400);
    if (!/^[A-Z][A-Z0-9_]*$/.test(reqRow.secret_name)) {
      return json({ ok: false, error: "invalid secret_name format" }, 400);
    }

    // Push secret to user's linked downstream Supabase project
    const { data: link } = await admin
      .from("project_supabase_links")
      .select("supabase_project_ref")
      .eq("project_id", reqRow.project_id)
      .maybeSingle();
    if (!link?.supabase_project_ref) {
      await admin.from("agent_secret_requests").update({
        status: "declined",
        error_message: "No backend connected — connect Lovable Cloud first.",
        fulfilled_at: new Date().toISOString(),
      }).eq("id", request_id);
      return json({ ok: false, error: "no backend linked to this project" }, 400);
    }

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(admin, uid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "auth failed";
      return json({ ok: false, error: msg }, 502);
    }

    const mgmtResp = await fetch(
      `${SBOAUTH_API_BASE}/projects/${link.supabase_project_ref}/secrets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ name: reqRow.secret_name, value: value.trim() }]),
      },
    );

    if (!mgmtResp.ok) {
      const txt = await mgmtResp.text();
      await admin.from("agent_secret_requests").update({
        error_message: `Push failed [${mgmtResp.status}]: ${txt.slice(0, 300)}`,
      }).eq("id", request_id);
      await logOp(admin, uid, "secret.push", "error", reqRow.secret_name, { status: mgmtResp.status });
      return json({ ok: false, error: `push failed [${mgmtResp.status}]` }, 502);
    }

    await admin.from("agent_secret_requests").update({
      status: "provided",
      fulfilled_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", request_id);
    await logOp(admin, uid, "secret.push", "success", reqRow.secret_name);

    return json({ ok: true, status: "provided", secret_name: reqRow.secret_name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return json({ ok: false, error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
