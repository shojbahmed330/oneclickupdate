// Receives the finished APK binary from the GitHub Actions workflow and
// stores it in the public `apk-builds` bucket. Returns the direct public URL
// so users can download the APK file itself (not a zip wrapper).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-build-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(withSentry("build-upload-apk", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SECRET = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  const SECRET_PREV = Deno.env.get("GITHUB_WEBHOOK_SECRET_PREVIOUS");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SECRET) return json({ error: "Webhook not configured" }, 500);

  const provided = req.headers.get("x-build-secret");
  if (provided !== SECRET && !(SECRET_PREV && provided === SECRET_PREV)) {
    return json({ error: "Forbidden" }, 403);
  }

  const url = new URL(req.url);
  const buildId = url.searchParams.get("build_id");
  const kind = (url.searchParams.get("kind") || "apk").toLowerCase(); // apk | aab
  if (!buildId) return json({ error: "build_id required" }, 400);

  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0) return json({ error: "empty body" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Rename output file to use the user's branded app_name + version, so the
  // downloaded file is e.g. "Calculatro-Pro-1.0.0.aab" instead of "app-release.aab".
  const { data: build } = await admin
    .from("app_builds")
    .select("app_name, version_name")
    .eq("id", buildId)
    .maybeSingle();
  const ext = kind === "aab" ? "aab" : "apk";
  const slug = String(build?.app_name || "app")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "app";
  const ver = String(build?.version_name || "").replace(/[^0-9.]/g, "");
  const filename = ver ? `${slug}-${ver}.${ext}` : `${slug}.${ext}`;
  const path = `${buildId}/${filename}`;
  const contentType = kind === "aab"
    ? "application/octet-stream"
    : "application/vnd.android.package-archive";

  const { error } = await admin.storage.from("apk-builds").upload(path, buf, {
    contentType,
    upsert: true,
  });
  if (error) return json({ error: "Upload failed", detail: error.message }, 500);

  // Bucket is now private — issue a long-lived signed URL (7 days) so APK download
  // links keep working without exposing the bucket to unauthenticated browsing.
  const { data: signed, error: signErr } = await admin.storage
    .from("apk-builds")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signErr || !signed?.signedUrl) {
    return json({ error: "Sign failed", detail: signErr?.message }, 500);
  }
  return json({ url: signed.signedUrl, size: buf.byteLength, path });
}));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
