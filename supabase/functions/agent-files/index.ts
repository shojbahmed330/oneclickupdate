// Read-only sandbox file browser used by the Builder "Code" tab.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { wrapSandbox, getSandboxInfo, startSandbox } from "../_shared/daytona.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function ensureRunning(id: string) {
  const info = await getSandboxInfo(id);
  if (!info) return;
  const state = (info.state || "").toLowerCase();
  if (state === "stopped" || state === "archived") {
    await startSandbox(id);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const s = (await getSandboxInfo(id))?.state?.toLowerCase();
      if (s === "started" || s === "running") return;
    }
  }
}

Deno.serve(withSentry("agent-files", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "auth required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: u } = await supabase.auth.getUser(token);
    if (!u.user) return new Response(JSON.stringify({ error: "invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const body = await req.json() as { projectId: string; action: "list" | "read"; path?: string };
    const { projectId, action, path = "." } = body;
    if (!projectId || !action) {
      return new Response(JSON.stringify({ error: "projectId and action required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: proj } = await supabase.from("projects").select("user_id").eq("id", projectId).maybeSingle();
    if (!proj || proj.user_id !== u.user.id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ws } = await supabase
      .from("daytona_workspaces").select("workspace_id").eq("project_id", projectId).maybeSingle();
    if (!ws?.workspace_id) {
      return new Response(JSON.stringify({ ok: true, items: [], empty: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await ensureRunning(ws.workspace_id as string);
    const sb = await wrapSandbox(ws.workspace_id as string);
    const cwd = "/root/app";

    if (action === "list") {
      const safe = path.replace(/^\/+/, "").replace(/\.\.+/g, "");
      const full = safe === "." || safe === "" ? cwd : `${cwd}/${safe}`;
      const items = await sb.listDir(full);
      // Filter heavy / noise dirs at the project root
      const filtered = items.filter((i) =>
        !["node_modules", ".git", "dist", ".next", ".turbo", ".cache"].includes(i.name)
      );
      return new Response(JSON.stringify({ ok: true, items: filtered, path: safe }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "read") {
      if (!path) throw new Error("path required");
      const safe = path.replace(/^\/+/, "").replace(/\.\.+/g, "");
      const content = await sb.readFile(`${cwd}/${safe}`);
      // Cap at 256 KB so we never blow the response
      const truncated = content.length > 262_144;
      return new Response(JSON.stringify({
        ok: true,
        path: safe,
        content: truncated ? content.slice(0, 262_144) : content,
        truncated,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error).message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
