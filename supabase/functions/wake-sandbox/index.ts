// Wakes the Daytona sandbox for a project so the preview is hot when the user
// starts typing. Called from BuilderV2 on mount + a periodic heartbeat while
// the builder tab is open. Idempotent; cheap when the sandbox is already running.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSandboxInfo, startSandbox, wrapSandbox } from "../_shared/daytona.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEV_PORT = 5173;

Deno.serve(withSentry("wake-sandbox", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const token = auth.replace("Bearer ", "");
    const { data: claimsData, error: cerr } = await userClient.auth.getClaims(token);
    if (cerr || !claimsData?.claims?.sub) return json({ ok: false, error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const { project_id } = await req.json().catch(() => ({}));
    if (!project_id) return json({ ok: false, error: "project_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: ws } = await admin
      .from("daytona_workspaces")
      .select("workspace_id, user_id")
      .eq("project_id", project_id)
      .maybeSingle();

    // No sandbox yet — agent will create on first prompt. Nothing to wake.
    if (!ws?.workspace_id) return json({ ok: true, status: "no_sandbox" });
    if (ws.user_id !== userId) return json({ ok: false, error: "forbidden" }, 403);

    const id = ws.workspace_id as string;
    const info = await getSandboxInfo(id);
    if (!info) {
      await admin.from("daytona_workspaces").delete().eq("project_id", project_id);
      return json({ ok: true, status: "stale_sandbox_cleared" });
    }
    const state = (info?.state || "").toLowerCase();

    if (state === "stopped" || state === "archived") {
      await startSandbox(id);
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const s = (await getSandboxInfo(id))?.state?.toLowerCase();
        if (s === "started" || s === "running") break;
      }
      // Best-effort: bump last_used_at. Daytona's autoStopInterval also resets on activity.
      await admin
        .from("daytona_workspaces")
        .update({ last_used_at: new Date().toISOString() })
        .eq("project_id", project_id);
      return json({ ok: true, status: "starting", state, ...(await getPreviewPayload(admin, project_id, id)) });
    }

    // Running — just stamp last_used so any heartbeat-style logic sees activity.
    await admin
      .from("daytona_workspaces")
      .update({ last_used_at: new Date().toISOString() })
      .eq("project_id", project_id);
    return json({ ok: true, status: "running", state, ...(await getPreviewPayload(admin, project_id, id)) });
  } catch (e) {
    console.error("[wake-sandbox]", e);
    return json({ ok: false, error: (e as Error).message ?? String(e) }, 500);
  }
}));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getPreviewPayload(admin: ReturnType<typeof createClient>, projectId: string, sandboxId: string) {
  try {
    const sandbox = await wrapSandbox(sandboxId);
    const result = await startDevServerLocal(sandbox, "/root/app");
    if (!result?.url) return {};
    await admin.from("daytona_workspaces")
      .update({ preview_url: result.url, last_used_at: new Date().toISOString() })
      .eq("project_id", projectId);
    return { url: result.url, preview_url: result.url, preview: result.preview };
  } catch (e) {
    console.warn("[wake-sandbox] preview unavailable:", (e as Error).message);
    return {};
  }
}

async function isReady(sandbox: Awaited<ReturnType<typeof wrapSandbox>>, cwd: string) {
  const r = await sandbox.exec(
    `curl -fsS -o /dev/null -w '%{http_code}' http://localhost:${DEV_PORT} 2>/dev/null || echo 000`,
    cwd,
    5,
  );
  return String(r.stdout ?? "").trim() === "200";
}

async function startDevServerLocal(sandbox: Awaited<ReturnType<typeof wrapSandbox>>, cwd: string) {
  if (!(await isReady(sandbox, cwd))) {
    await sandbox.exec(
      `nohup npm run dev -- --host 0.0.0.0 --port ${DEV_PORT} > /tmp/dev.log 2>&1 < /dev/null &`,
      cwd,
      10,
    );
  }
  let ready = false;
  for (let i = 0; i < 30; i++) {
    ready = await isReady(sandbox, cwd);
    if (ready) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  const preview = ready ? await sandbox.getPreviewLink(DEV_PORT) : null;
  return { ok: ready, port: DEV_PORT, url: preview?.url, preview };
}
