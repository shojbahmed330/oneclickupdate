// CRUD for app_branding (per project). Used by AppBrandingDialog.
// GET    ?projectId=...  → current branding row + signed URLs for logo/splash
// POST   { projectId, app_name, package_id, version_name, version_code, splash_bg_color, adaptive_bg_color }
//   → upsert. Logo/splash uploads are done client-side directly to the
//     'app-branding' bucket and the resulting paths are sent here as
//     logo_path / splash_path (or null to clear).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

Deno.serve(withSentry("branding-config", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: ud, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ud.user) return json({ error: "Unauthorized" }, 401);
  const user = ud.user;
  const admin = createClient(SUPABASE_URL, SERVICE);

  const url = new URL(req.url);

  if (req.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return json({ error: "projectId required" }, 400);
    const { data: proj } = await admin.from("projects").select("id,user_id,name").eq("id", projectId).maybeSingle();
    if (!proj || proj.user_id !== user.id) return json({ error: "Not your project" }, 403);

    const { data: row } = await admin.from("app_branding").select("*").eq("project_id", projectId).maybeSingle();

    let logo_url: string | null = null;
    let splash_url: string | null = null;
    if (row?.logo_path) {
      const { data } = await admin.storage.from("app-branding").createSignedUrl(row.logo_path, 60 * 30);
      logo_url = data?.signedUrl ?? null;
    }
    if (row?.splash_path) {
      const { data } = await admin.storage.from("app-branding").createSignedUrl(row.splash_path, 60 * 30);
      splash_url = data?.signedUrl ?? null;
    }

    // Default suggestion if no row yet
    const safeUid = user.id.replace(/-/g, "").slice(0, 12);
    const defaults = {
      app_name: proj.name || "My App",
      package_id: `app.lovable.u${safeUid}`,
      version_name: "1.0.0",
      version_code: 1,
      splash_bg_color: "#FFFFFF",
      adaptive_bg_color: "#FFFFFF",
    };

    return json({ branding: row ?? null, defaults, logo_url, splash_url });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const projectId = body.projectId;
    if (!projectId) return json({ error: "projectId required" }, 400);
    const { data: proj } = await admin.from("projects").select("id,user_id").eq("id", projectId).maybeSingle();
    if (!proj || proj.user_id !== user.id) return json({ error: "Not your project" }, 403);

    const app_name = String(body.app_name ?? "").trim().slice(0, 40);
    const package_id = String(body.package_id ?? "").trim().toLowerCase();
    const version_name = String(body.version_name ?? "1.0.0").trim().slice(0, 20);
    const version_code = Math.max(1, Math.floor(Number(body.version_code ?? 1)));
    const splash_bg_color = sanitizeHex(body.splash_bg_color, "#FFFFFF");
    const adaptive_bg_color = sanitizeHex(body.adaptive_bg_color, "#FFFFFF");

    if (!app_name) return json({ error: "app_name required" }, 400);
    if (!PKG_RE.test(package_id)) return json({ error: "Invalid package id (e.g. com.you.appname)" }, 400);
    if (!/^\d+(\.\d+){0,2}$/.test(version_name)) return json({ error: "version_name must look like 1.0.0" }, 400);

    const logo_path = typeof body.logo_path === "string" ? body.logo_path : undefined;
    const splash_path = typeof body.splash_path === "string" ? body.splash_path : undefined;

    // Validate any provided paths actually live under {user_id}/{project_id}/
    const prefix = `${user.id}/${projectId}/`;
    for (const p of [logo_path, splash_path]) {
      if (p && !p.startsWith(prefix)) return json({ error: "Invalid asset path" }, 400);
    }

    const upsert: any = {
      project_id: projectId, user_id: user.id,
      app_name, package_id, version_name, version_code,
      splash_bg_color, adaptive_bg_color,
    };
    if (logo_path !== undefined) upsert.logo_path = logo_path || null;
    if (splash_path !== undefined) upsert.splash_path = splash_path || null;

    const { data, error } = await admin
      .from("app_branding")
      .upsert(upsert, { onConflict: "project_id" })
      .select("*")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, branding: data });
  }

  return json({ error: "Method not allowed" }, 405);
}));

function sanitizeHex(v: unknown, fallback: string) {
  if (typeof v !== "string") return fallback;
  const m = v.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toUpperCase()}` : fallback;
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
