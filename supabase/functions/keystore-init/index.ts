// Saves the user's keystore configuration. Passwords are AES-GCM
// encrypted before storage. The actual .jks file is generated on the
// next release build inside the GitHub Action (see keystore-fetch).
//
// POST body: { alias, storePassword, keyPassword, fullName, orgName,
//              orgUnit, city, state, country, validityYears }
// Response: { ok, sha1, sha256, status }
//
// IMPORTANT: An existing keystore is NEVER replaced silently — Play
// Store rejects updates signed with a different key. To rotate, the
// user must explicitly DELETE first (separate confirmation flow).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encryptString } from "../_shared/keystoreCrypto.ts";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withSentry("keystore-init", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const alias = String(body.alias ?? "app").trim().slice(0, 32) || "app";
    const storePassword = String(body.storePassword ?? "");
    const keyPassword = String(body.keyPassword ?? storePassword);
    if (storePassword.length < 6) return json({ error: "Store password must be ≥6 chars" }, 400);
    if (keyPassword.length < 6) return json({ error: "Key password must be ≥6 chars" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: existing } = await admin
      .from("user_keystores")
      .select("id, status")
      .eq("user_id", u.user.id)
      .maybeSingle();
    if (existing && existing.status === "ready") {
      return json({ error: "Keystore already exists. Delete it first to regenerate (Play Store apps cannot change keys)." }, 409);
    }

    const storeEnc = await encryptString(storePassword);
    const keyEnc = await encryptString(keyPassword);

    const row = {
      user_id: u.user.id,
      alias,
      store_password_encrypted: storeEnc,
      key_password_encrypted: keyEnc,
      full_name: String(body.fullName ?? "App Owner").slice(0, 80),
      org_name: String(body.orgName ?? "Lovable User").slice(0, 80),
      org_unit: String(body.orgUnit ?? "Apps").slice(0, 80),
      city: String(body.city ?? "NA").slice(0, 60),
      state: String(body.state ?? "NA").slice(0, 60),
      country: String(body.country ?? "US").slice(0, 4).toUpperCase(),
      validity_years: Math.max(10, Math.min(50, Number(body.validityYears ?? 30))),
      status: "pending",
    };

    if (existing) {
      await admin.from("user_keystores").update(row).eq("id", existing.id);
    } else {
      await admin.from("user_keystores").insert(row);
    }
    return json({ ok: true, status: "pending", message: "Keystore will be generated on your next release build." });
  } catch (e: any) {
    console.error("[keystore-init] error", e);
    return json({ error: "Internal error", detail: e?.message }, 500);
  }
}));
