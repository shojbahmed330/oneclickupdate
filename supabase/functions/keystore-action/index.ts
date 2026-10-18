// GitHub-Action-facing keystore endpoint. Authenticated by the shared
// build secret (same as build-files / build-webhook).
//
// GET  ?build_id=… &action=fetch
//   → { has_keystore, alias, store_password, key_password,
//       jks_base64?, dname, validity_years, needs_generation }
//   When needs_generation=true the action runs `keytool -genkey` and
//   posts the resulting .jks back via action=upload.
//
// POST ?build_id=… &action=upload
//   body: { jks_base64, sha1, sha256 }
//   → persists the file in `keystores/<user_id>/app.jks`, marks status=ready.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptString } from "../_shared/keystoreCrypto.ts";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-build-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function json(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(withSentry("keystore-action", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SECRET = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  const SECRET_PREV = Deno.env.get("GITHUB_WEBHOOK_SECRET_PREVIOUS");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SECRET) return json({ error: "Not configured" }, 500);

  const provided = req.headers.get("x-build-secret");
  const ok = provided === SECRET || (!!SECRET_PREV && provided === SECRET_PREV);
  if (!ok) return json({ error: "Forbidden" }, 403);

  const url = new URL(req.url);
  const buildId = url.searchParams.get("build_id");
  const action = url.searchParams.get("action") ?? "fetch";
  if (!buildId) return json({ error: "build_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: build } = await admin
    .from("app_builds")
    .select("id, user_id, signing_mode")
    .eq("id", buildId)
    .single();
  if (!build) return json({ error: "Build not found" }, 404);

  const { data: ks } = await admin
    .from("user_keystores")
    .select("*")
    .eq("user_id", build.user_id)
    .maybeSingle();

  if (action === "fetch") {
    if (!ks) return json({ has_keystore: false });
    const storePassword = await decryptString(ks.store_password_encrypted);
    const keyPassword = await decryptString(ks.key_password_encrypted);

    let jks_base64: string | null = null;
    let needs_generation = ks.status !== "ready" || !ks.storage_path;
    if (!needs_generation) {
      const { data: file } = await admin.storage.from("keystores").download(ks.storage_path);
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        jks_base64 = btoa(bin);
      } else {
        needs_generation = true;
      }
    }

    // X.500 distinguished name for keytool -dname
    const dname = `CN=${esc(ks.full_name)}, OU=${esc(ks.org_unit)}, O=${esc(ks.org_name)}, L=${esc(ks.city)}, ST=${esc(ks.state)}, C=${esc(ks.country)}`;
    return json({
      has_keystore: true,
      alias: ks.alias,
      store_password: storePassword,
      key_password: keyPassword,
      jks_base64,
      dname,
      validity_days: ks.validity_years * 365,
      needs_generation,
    });
  }

  if (action === "upload") {
    if (!ks) return json({ error: "no keystore record — call keystore-init first" }, 400);
    const body = await req.json().catch(() => ({}));
    const b64 = String(body.jks_base64 ?? "");
    if (!b64) return json({ error: "jks_base64 required" }, 400);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const path = `${build.user_id}/app.jks`;
    const { error: upErr } = await admin.storage
      .from("keystores")
      .upload(path, bytes, { contentType: "application/octet-stream", upsert: true });
    if (upErr) return json({ error: "upload failed", detail: upErr.message }, 500);

    await admin.from("user_keystores").update({
      storage_path: path,
      sha1_fingerprint: String(body.sha1 ?? "").slice(0, 200),
      sha256_fingerprint: String(body.sha256 ?? "").slice(0, 200),
      status: "ready",
      generated_at: new Date().toISOString(),
    }).eq("id", ks.id);

    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
}));

function esc(s: string) {
  // Escape RDN special chars per RFC 2253
  return String(s ?? "").replace(/([,+"\\<>;=])/g, "\\$1");
}
