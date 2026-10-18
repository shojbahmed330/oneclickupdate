// Daytona sandbox warm-pool.
//
// Why: cold-creating a Daytona sandbox (createSandbox + waitUntilStarted +
// waitUntilToolboxReady) takes ~60-180s. Pre-warming a small pool means
// claiming one is a single SELECT/UPDATE (instant) and the user-perceived
// "first message" latency drops from minutes to seconds.
//
// Storage: `daytona_warm_pool` table (status: ready | claimed). When a project
// boots, claim() does `UPDATE ... WHERE status='ready' LIMIT 1 RETURNING ...`
// (atomic), then fires-and-forgets a refill so the pool stays at TARGET_SIZE.
//
// The pool stores raw "vite + react + ts" sandboxes WITHOUT scaffolding —
// the per-project scaffold/templates are layered on top after claim. This
// keeps pool entries generic and reusable.
//
// If the table doesn't exist (older deployments), every helper degrades to
// a no-op so the path falls back to cold createSandbox.

import type { createClient } from "npm:@supabase/supabase-js@2";
import { createSandbox, getSandboxInfo, type DaytonaSandbox, wrapSandbox } from "../_shared/daytona.ts";
import { DAYTONA_SNAPSHOT } from "./shared.ts";

const TARGET_POOL_SIZE = Number(Deno.env.get("DAYTONA_WARM_POOL_SIZE") || "5");
const MAX_REFILL_PER_CALL = 2; // refill in parallel so the pool recovers fast after a burst
const SANDBOX_AUTOSTOP_MIN = Number(Deno.env.get("DAYTONA_AUTOSTOP_MIN") || "240");

type SupaClient = ReturnType<typeof createClient>;

/** Try to claim a pre-warmed sandbox. Returns null if pool is empty or table missing. */
export async function claimWarmSandbox(supabase: SupaClient): Promise<DaytonaSandbox | null> {
  try {
    // Pull one ready row, mark claimed atomically.
    const { data, error } = await supabase
      .from("daytona_warm_pool")
      .select("id, workspace_id")
      .eq("status", "ready")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data?.workspace_id) return null;

    // Atomic claim: only succeed if still ready.
    const { data: claimed } = await supabase
      .from("daytona_warm_pool")
      .update({ status: "claimed", claimed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "ready")
      .select("workspace_id")
      .maybeSingle();
    if (!claimed?.workspace_id) return null;

    const id = claimed.workspace_id as string;
    // Confirm the sandbox is still healthy externally before handing it off.
    const info = await getSandboxInfo(id);
    if (!info) {
      // Pool entry is stale — drop it & let caller fall back.
      await supabase.from("daytona_warm_pool").delete().eq("id", data.id);
      return null;
    }
    // Drop the pool row; the workspace now belongs to the project.
    await supabase.from("daytona_warm_pool").delete().eq("id", data.id);
    return await wrapSandbox(id);
  } catch (e) {
    console.warn("[warm-pool] claim failed:", (e as Error).message);
    return null;
  }
}

/** Top-up the pool back to TARGET_POOL_SIZE. Safe to fire-and-forget. */
export async function refillPool(supabase: SupaClient): Promise<void> {
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
            // Pre-scaffold a generic vite-react-ts app so claim is truly instant.
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

/** Fire-and-forget refill (use after claim so pool stays warm). */
export function scheduleRefill(supabase: SupaClient): void {
  // Deno Deploy / Supabase Edge supports EdgeRuntime.waitUntil for background work.
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") {
    er.waitUntil(refillPool(supabase));
  } else {
    // Best-effort detached promise.
    refillPool(supabase).catch(() => {});
  }
}
