// Shared sandbox lifecycle helpers. Lives in _shared so any edge function
// (agent, checkpoint-action, etc.) can attach to the per-project Daytona
// workspace without cross-function imports (which the bundler rejects).
import type { createClient } from "npm:@supabase/supabase-js@2";
import {
  createSandbox,
  wrapSandbox,
  getSandboxInfo,
  startSandbox,
  waitUntilToolboxReady,
  isToolboxNotReadyError,
  type DaytonaSandbox,
} from "./daytona.ts";
import { PICKER_RUNTIME_JS } from "./pickerRuntime.ts";

const DAYTONA_SNAPSHOT = Deno.env.get("DAYTONA_SNAPSHOT") || "";
// Larger default pool: 2 was empty whenever 3+ users opened a project at once.
// Override via DAYTONA_WARM_POOL_SIZE env if cost becomes a concern.
const TARGET_POOL_SIZE = Number(Deno.env.get("DAYTONA_WARM_POOL_SIZE") || "5");
const MAX_REFILL_PER_CALL = 2;
// 4h auto-stop instead of 1h — far fewer cold restarts when a user
// steps away for lunch and comes back.
const SANDBOX_AUTOSTOP_MIN = Number(Deno.env.get("DAYTONA_AUTOSTOP_MIN") || "240");

type SupaClient = ReturnType<typeof createClient>;

async function ensureRunning(id: string): Promise<void> {
  const info = await getSandboxInfo(id);
  if (!info) return;
  const state = (info.state || "").toLowerCase();
  if (state === "started" || state === "running") return;
  if (state === "stopped" || state === "archived") {
    await startSandbox(id);
    // Poll every 1s for up to 60s — twice as responsive as the old 2s/30 loop
    // and returns the moment the sandbox is up (median ~5-10s).
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = (await getSandboxInfo(id))?.state?.toLowerCase();
      if (s === "started" || s === "running") return;
    }
  }
}

async function installPickerRuntime(sandbox: DaytonaSandbox): Promise<void> {
  try {
    await sandbox.exec("mkdir -p /root/app/public && rm -f /root/app/public/lovable-picker.js", "/root", 10);
    await sandbox.writeFile("/root/app/public/oneclickstudio-picker.js", PICKER_RUNTIME_JS);
    let indexHtml = await sandbox.readFile("/root/app/index.html").catch(() => "");
    if (indexHtml) {
      // migrate any prior <script src="/lovable-picker.js"> tag
      indexHtml = indexHtml.replace(/\s*<script[^>]*src=["']\/lovable-picker\.js["'][^>]*><\/script>/g, "");
      if (!indexHtml.includes("oneclickstudio-picker.js")) {
        indexHtml = indexHtml.replace(
          "</head>",
          '    <script defer src="/oneclickstudio-picker.js"></script>\n  </head>',
        );
      }
      await sandbox.writeFile("/root/app/index.html", indexHtml);
    }
  } catch (e) {
    console.warn("[picker-runtime] install failed:", (e as Error).message);
  }
}

async function claimWarmSandbox(supabase: SupaClient): Promise<DaytonaSandbox | null> {
  try {
    const { data, error } = await supabase
      .from("daytona_warm_pool")
      .select("id, workspace_id")
      .eq("status", "ready")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data?.workspace_id) return null;
    const { data: claimed } = await supabase
      .from("daytona_warm_pool")
      .update({ status: "claimed", claimed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "ready")
      .select("workspace_id")
      .maybeSingle();
    if (!claimed?.workspace_id) return null;
    const id = claimed.workspace_id as string;
    const info = await getSandboxInfo(id);
    if (!info) {
      await supabase.from("daytona_warm_pool").delete().eq("id", data.id);
      return null;
    }
    await supabase.from("daytona_warm_pool").delete().eq("id", data.id);
    return await wrapSandbox(id);
  } catch (e) {
    console.warn("[warm-pool] claim failed:", (e as Error).message);
    return null;
  }
}

async function refillPool(supabase: SupaClient): Promise<void> {
  try {
    const { count } = await supabase
      .from("daytona_warm_pool")
      .select("id", { count: "exact", head: true })
      .eq("status", "ready");
    const need = Math.min(MAX_REFILL_PER_CALL, TARGET_POOL_SIZE - (count ?? 0));
    if (need <= 0) return;
    // Refill in parallel — sequential 60-180s creates would mean the pool
    // stays empty for minutes after a burst of claims.
    await Promise.all(
      Array.from({ length: need }, async () => {
        try {
          const sandbox = await createSandbox({
            ...(DAYTONA_SNAPSHOT ? { snapshot: DAYTONA_SNAPSHOT } : { language: "typescript" }),
            isPublic: true,
            label: "warm-pool",
            envVars: { NODE_ENV: "development" },
            autoStopInterval: SANDBOX_AUTOSTOP_MIN,
            autoArchiveInterval: 10080,
          });
          if (!DAYTONA_SNAPSHOT) {
            await sandbox.exec("npm create vite@latest app -- --template react-ts -y", "/root", 180);
            await sandbox.exec("cd app && npm install", "/root", 300);
          }
          await supabase.from("daytona_warm_pool").insert({
            workspace_id: sandbox.id,
            status: "ready",
          });
        } catch (e) {
          console.warn("[warm-pool] single refill failed:", (e as Error).message);
        }
      }),
    );
  } catch (e) {
    console.warn("[warm-pool] refill failed:", (e as Error).message);
  }
}

function scheduleRefill(supabase: SupaClient): void {
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") {
    er.waitUntil(refillPool(supabase));
  } else {
    refillPool(supabase).catch(() => {});
  }
}

export async function getOrCreateSandbox(
  supabase: SupaClient,
  projectId: string,
  userId: string,
): Promise<DaytonaSandbox> {
  const { data: existing } = await supabase
    .from("daytona_workspaces")
    .select("workspace_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing?.workspace_id) {
    const id = existing.workspace_id as string;
    const info = await getSandboxInfo(id);
    if (info) {
      await ensureRunning(id);
      try {
        await waitUntilToolboxReady(id, 45);
      } catch (err) {
        if (!isToolboxNotReadyError(err)) throw err;
        console.warn(`[sandbox] stale Daytona toolbox ${id}; recreating for project ${projectId}`);
        await supabase.from("daytona_workspaces").delete().eq("project_id", projectId);
      }
      const stillExisting = await supabase
        .from("daytona_workspaces")
        .select("workspace_id")
        .eq("project_id", projectId)
        .maybeSingle();
      if (!stillExisting.data?.workspace_id) {
        return getOrCreateSandbox(supabase, projectId, userId);
      }
      await supabase.from("daytona_workspaces")
        .update({ last_used_at: new Date().toISOString() })
        .eq("project_id", projectId);
      return await wrapSandbox(id);
    }
    console.warn(`[sandbox] stale Daytona workspace ${id}; recreating for project ${projectId}`);
    await supabase.from("daytona_workspaces").delete().eq("project_id", projectId);
  }

  let sandbox = await claimWarmSandbox(supabase);
  const fromPool = !!sandbox;

  if (!sandbox) {
    sandbox = await createSandbox({
      ...(DAYTONA_SNAPSHOT ? { snapshot: DAYTONA_SNAPSHOT } : { language: "typescript" }),
      isPublic: true,
      label: projectId,
      envVars: { NODE_ENV: "development" },
      autoStopInterval: SANDBOX_AUTOSTOP_MIN,
      autoArchiveInterval: 10080,
    });
    if (!DAYTONA_SNAPSHOT) {
      await sandbox.exec("npm create vite@latest app -- --template react-ts -y", "/root", 180);
      await sandbox.exec("cd app && npm install", "/root", 300);
    }
  } else {
    console.log(`[sandbox] claimed warm sandbox ${sandbox.id} for project ${projectId}`);
  }

  await installPickerRuntime(sandbox);

  await supabase.from("daytona_workspaces").insert({
    project_id: projectId,
    user_id: userId,
    workspace_id: sandbox.id,
    status: "ready",
  });

  if (fromPool) scheduleRefill(supabase);

  return sandbox;
}
