// Daytona sandbox lifecycle: ensure the workspace for a project exists,
// is running, and has the Lovable picker runtime installed.
import type { createClient } from "npm:@supabase/supabase-js@2";
import {
  createSandbox,
  wrapSandbox,
  getSandboxInfo,
  startSandbox,
  waitUntilToolboxReady,
  isToolboxNotReadyError,
  type DaytonaSandbox,
} from "../_shared/daytona.ts";
import { PICKER_RUNTIME_JS } from "../_shared/pickerRuntime.ts";
import { DAYTONA_SNAPSHOT } from "./shared.ts";
import { claimWarmSandbox, scheduleRefill } from "./_warmPool.ts";

const SANDBOX_AUTOSTOP_MIN = Number(Deno.env.get("DAYTONA_AUTOSTOP_MIN") || "240");

export async function ensureRunning(id: string): Promise<void> {
  const info = await getSandboxInfo(id);
  if (!info) return;
  const state = (info.state || "").toLowerCase();
  if (state === "started" || state === "running") return;
  if (state === "stopped" || state === "archived") {
    await startSandbox(id);
    // 1s polling × 60 attempts — sandboxes typically resume in 5-15s,
    // so this returns much faster than the old 2s × 30 loop.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = (await getSandboxInfo(id))?.state?.toLowerCase();
      if (s === "started" || s === "running") return;
    }
  }
}

async function installPickerRuntime(sandbox: DaytonaSandbox): Promise<void> {
  // Idempotent — re-running just rewrites the same files.
  try {
    await sandbox.exec("mkdir -p /root/app/public && rm -f /root/app/public/lovable-picker.js", "/root", 10);
    await sandbox.writeFile("/root/app/public/oneclickstudio-picker.js", PICKER_RUNTIME_JS);
    let indexHtml = await sandbox.readFile("/root/app/index.html").catch(() => "");
    if (indexHtml) {
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

export async function getOrCreateSandbox(
  supabase: ReturnType<typeof createClient>,
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
        console.warn(`[agent] stale Daytona toolbox ${id}; recreating for project ${projectId}`);
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
    // Row outlived the external sandbox (user deleted/archived it). Drop & recreate.
    console.warn(`[agent] stale Daytona workspace ${id}; recreating for project ${projectId}`);
    await supabase.from("daytona_workspaces").delete().eq("project_id", projectId);
  }

  // Try the warm-pool first — eliminates ~60-180s of cold-create latency.
  let sandbox = await claimWarmSandbox(supabase);
  let fromPool = !!sandbox;

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
    console.log(`[agent] claimed warm sandbox ${sandbox.id} for project ${projectId}`);
  }

  await installPickerRuntime(sandbox);

  await supabase.from("daytona_workspaces").insert({
    project_id: projectId,
    user_id: userId,
    workspace_id: sandbox.id,
    status: "ready",
  });

  // If we drained the pool, top it back up in the background so the next user benefits.
  if (fromPool) scheduleRefill(supabase);

  return sandbox;
}
