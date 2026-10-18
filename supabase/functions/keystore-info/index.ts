// User-facing helper returning keystore status + a short-lived signed
// URL the UI can use to download a backup of the .jks file.
// Methods:
//   GET  → { exists, status, alias, sha1, sha256, generated_at, download_url? }
//   DELETE → removes both the DB row and the storage object (irreversible)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
};

function json(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withSentry("keystore-info", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE);

  if (req.method === "DELETE") {
    const { data: ks } = await admin.from("user_keystores").select("storage_path").eq("user_id", u.user.id).maybeSingle();
    if (ks?.storage_path) {
      await admin.storage.from("keystores").remove([ks.storage_path]);
    }
    await admin.from("user_keystores").delete().eq("user_id", u.user.id);
    return json({ ok: true });
  }

  const { data: ks } = await admin
    .from("user_keystores")
    .select("alias, status, sha1_fingerprint, sha256_fingerprint, generated_at, storage_path, full_name, org_name, country, validity_years")
    .eq("user_id", u.user.id)
    .maybeSingle();

  if (!ks) return json({ exists: false });

  let download_url: string | null = null;
  if (ks.status === "ready" && ks.storage_path) {
    const { data: signed } = await admin.storage
      .from("keystores")
      .createSignedUrl(ks.storage_path, 300, { download: `${ks.alias}.jks` });
    download_url = signed?.signedUrl ?? null;
  }

  return json({
    exists: true,
    status: ks.status,
    alias: ks.alias,
    sha1: ks.sha1_fingerprint,
    sha256: ks.sha256_fingerprint,
    generated_at: ks.generated_at,
    full_name: ks.full_name,
    org_name: ks.org_name,
    country: ks.country,
    validity_years: ks.validity_years,
    download_url,
  });
}));
