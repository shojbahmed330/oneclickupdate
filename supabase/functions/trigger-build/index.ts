// Triggers a GitHub Actions workflow_dispatch on the central build repo.
// Creates an app_builds row + step rows, then dispatches the workflow with
// a payload containing the build_id and a callback URL the action will hit
// to report progress.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { wrapSandbox, getSandboxInfo, startSandbox } from "../_shared/daytona.ts";
import { withSentry } from "../_shared/sentry.ts";

// Pulls every text file from the Daytona sandbox at /root/app and upserts it
// into project_files so build-files can serve them to the GitHub Action.
// Skips heavy / generated directories and binary files.
async function syncSandboxFilesToDb(
  admin: any,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<number> {
  // Make sure the sandbox is awake before we try to read.
  const info = await getSandboxInfo(workspaceId);
  if (info) {
    const state = (info.state || "").toLowerCase();
    if (state === "stopped" || state === "archived") {
      await startSandbox(workspaceId);
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = (await getSandboxInfo(workspaceId))?.state?.toLowerCase();
        if (s === "started" || s === "running") break;
      }
    }
  }
  const sb = await wrapSandbox(workspaceId);
  const cwd = "/root/app";
  // Enumerate text-ish project files. Exclude lockfiles + generated dirs.
  const findCmd =
    `cd ${cwd} && find . -type f ` +
    `-not -path './node_modules/*' ` +
    `-not -path './.git/*' ` +
    `-not -path './dist/*' ` +
    `-not -path './build/*' ` +
    `-not -path './.next/*' ` +
    `-not -path './.cache/*' ` +
    `-not -path './.turbo/*' ` +
    `-not -path './android/build/*' ` +
    `-not -path './android/app/build/*' ` +
    `-not -path './ios/build/*' ` +
    `-size -300k ` +
    `| sed 's|^\\./||' | head -2000`;
  const res = await sb.exec(`bash -lc ${JSON.stringify(findCmd)}`, undefined, 60);
  const paths = res.stdout.split("\n").map((p) => p.trim()).filter(Boolean);
  if (paths.length === 0) return 0;

  // Read files in small parallel batches.
  const BATCH = 10;
  const rows: Array<{ project_id: string; user_id: string; path: string; content: string }> = [];
  for (let i = 0; i < paths.length; i += BATCH) {
    const slice = paths.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (p) => {
        try {
          const content = await sb.readFile(`${cwd}/${p}`);
          return { p, content };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (!r) continue;
      // Skip obviously-binary blobs that snuck through.
      if (/\u0000/.test(r.content.slice(0, 2048))) continue;
      rows.push({ project_id: projectId, user_id: userId, path: r.p, content: r.content });
    }
  }
  if (rows.length === 0) return 0;

  // Replace the snapshot atomically: clear then insert in chunks.
  await admin.from("project_files").delete().eq("project_id", projectId);
  const INSERT_CHUNK = 200;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await admin.from("project_files").insert(rows.slice(i, i + INSERT_CHUNK));
    if (error) throw new Error(`project_files insert failed: ${error.message}`);
  }
  return rows.length;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STEPS: Array<{ key: string; label: string; order: number }> = [
  { key: "queued",       label: "Queued on GitHub Actions",          order: 1 },
  { key: "checkout",     label: "Preparing build environment",       order: 2 },
  { key: "inject",       label: "Injecting your project files",      order: 3 },
  { key: "install",      label: "Installing dependencies",           order: 4 },
  { key: "web_build",    label: "Building web bundle (Vite)",        order: 5 },
  { key: "cap_sync",     label: "Capacitor sync (Android)",          order: 6 },
  { key: "gradle",       label: "Compiling APK with Gradle",         order: 7 },
  { key: "upload",       label: "Uploading to GitHub Release",       order: 8 },
  { key: "ready",        label: "APK ready to download",             order: 9 },
];

if (import.meta.main) {
  Deno.serve(withSentry("trigger-build", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const PAT = Deno.env.get("GITHUB_BUILD_PAT");
    const rawRepo = Deno.env.get("GITHUB_BUILD_REPO");
    const REPO = normalizeGitHubRepo(rawRepo);
    const WEBHOOK_SECRET = Deno.env.get("GITHUB_WEBHOOK_SECRET");
    const WORKFLOW = Deno.env.get("GITHUB_BUILD_WORKFLOW")?.trim() || "build-apk.yml";
    const BUILD_REF = Deno.env.get("GITHUB_BUILD_REF")?.trim() || "main";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!PAT || !rawRepo || !WEBHOOK_SECRET) {
      return json({ error: "Build service not configured. Missing GITHUB_BUILD_PAT / GITHUB_BUILD_REPO / GITHUB_WEBHOOK_SECRET." }, 500);
    }
    if (!REPO) {
      return json({ error: "Build service not configured. GITHUB_BUILD_REPO must be an 'owner/repo' pair or a full GitHub repository URL." }, 500);
    }

    // Authenticate caller
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body.projectId;
    const platform: "android" | "ios" = body.platform === "ios" ? "ios" : "android";
    // New explicit selector. Falls back to legacy signingMode for older clients.
    //   apk-debug    → unsigned/debug-signed APK (sideload, fastest)
    //   apk-release  → signed release APK (shareable, no Play Store)
    //   aab-release  → signed AAB (Google Play upload only)
    type BuildTarget = "apk-debug" | "apk-release" | "aab-release";
    const allowedTargets: BuildTarget[] = ["apk-debug", "apk-release", "aab-release"];
    let buildTarget: BuildTarget;
    if (allowedTargets.includes(body.buildTarget)) {
      buildTarget = body.buildTarget as BuildTarget;
    } else {
      buildTarget = body.signingMode === "release" ? "apk-release" : "apk-debug";
    }
    const signingMode: "debug" | "release" = buildTarget === "apk-debug" ? "debug" : "release";
    if (!projectId) return json({ error: "projectId required" }, 400);
    if (platform === "ios") return json({ error: "iOS build not yet enabled. Android only for now." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verify project ownership + load project + files
    const { data: project, error: projErr } = await admin
      .from("projects")
      .select("id, user_id, name, description")
      .eq("id", projectId)
      .single();
    if (projErr || !project) return json({ error: "Project not found" }, 404);
    if (project.user_id !== user.id) return json({ error: "Not your project" }, 403);

    const { data: ws } = await admin
      .from("daytona_workspaces")
      .select("workspace_id")
      .eq("project_id", projectId)
      .maybeSingle();

    // The live preview runs from the Daytona sandbox. Always refresh the build
    // snapshot from that sandbox first, otherwise APKs can use an older DB copy
    // and look different from the mobile preview.
    if (ws?.workspace_id) {
      try {
        await syncSandboxFilesToDb(admin, ws.workspace_id as string, projectId, user.id);
      } catch (e) {
        return json({
          error: "Could not sync latest preview files before build",
          detail: e instanceof Error ? e.message : String(e),
        }, 500);
      }
    }

    const { data: files, error: filesErr } = await admin
      .from("project_files")
      .select("path, content")
      .eq("project_id", projectId);
    if (filesErr) return json({ error: "Could not load project files" }, 500);
    if (!files?.length) {
      return json({
        error: "Project has no files to build",
        detail: ws?.workspace_id
          ? "Sandbox at /root/app is empty. Generate your app in the Builder first."
          : "No code has been generated yet. Open the Builder and create your app first.",
      }, 400);
    }

    // ── Concurrent build guard ─────────────────────────────────────────
    // GitHub Actions queues parallel workflow_dispatch calls, so a user
    // hammering "Build" can drain their concurrency credits and fan out
    // identical APKs they'll never use. Cap to MAX_CONCURRENT in-flight
    // builds per user across all of their projects.
    const MAX_CONCURRENT = 2;
    const { data: activeBuilds } = await admin
      .from("app_builds")
      .select("id, project_id, status, started_at")
      .eq("user_id", user.id)
      .in("status", ["queued", "running"])
      .order("started_at", { ascending: false });

    if (activeBuilds && activeBuilds.length >= MAX_CONCURRENT) {
      return json({
        error: "concurrent_limit",
        message: `You already have ${activeBuilds.length} build${activeBuilds.length === 1 ? "" : "s"} in progress. Wait for one to finish before starting another.`,
        active_builds: activeBuilds.map((b) => ({
          id: b.id,
          project_id: b.project_id,
          status: b.status,
          started_at: b.started_at,
        })),
        limit: MAX_CONCURRENT,
      }, 409);
    }

    // App branding (custom name / package id / version / logo / splash) —
    // falls back to safe defaults derived from the project + user id.
    const { data: branding } = await admin
      .from("app_branding")
      .select("app_name, package_id, version_name, version_code, logo_path, splash_path, splash_bg_color, adaptive_bg_color")
      .eq("project_id", projectId)
      .maybeSingle();

    const safeId = (user.id.replace(/-/g, "")).slice(0, 12);
    const appName = (branding?.app_name || project.name || "My App").slice(0, 40);
    const packageId = branding?.package_id || `app.lovable.u${safeId}`;
    const versionName = branding?.version_name || "1.0.0";

    // Auto-increment versionCode for release builds. Play Store rejects any
    // upload whose versionCode is ≤ a previously published one, so we look up
    // the highest versionCode ever used for this package_id (across all of
    // the user's projects) and bump by 1. Debug builds don't need bumping.
    let versionCode = branding?.version_code ?? 1;
    if (signingMode === "release") {
      const { data: lastBuild } = await admin
        .from("app_builds")
        .select("version_code")
        .eq("user_id", user.id)
        .eq("package_id", packageId)
        .eq("signing_mode", "release")
        .order("version_code", { ascending: false })
        .limit(1)
        .maybeSingle();
      const next = Math.max(versionCode, (lastBuild?.version_code ?? 0) + 1);
      versionCode = next;
      // Persist the bumped code on app_branding so the Branding tab UI shows
      // the next-build value (user can still override manually).
      if (branding) {
        await admin.from("app_branding")
          .update({ version_code: next })
          .eq("project_id", projectId);
      }
    }

    // Release-mode requires that the user has at least configured a keystore.
    // The .jks file itself may not yet exist (first release build generates it
    // inside the GH Action and uploads it back), but the config row must.
    if (signingMode === "release") {
      const { data: ks } = await admin
        .from("user_keystores")
        .select("id, status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!ks) {
        return json({
          error: "no_keystore",
          needs_keystore: true,
          build_target: buildTarget,
          message: "Set up a signing keystore before building for Play Store.",
        }, 200);
      }
    }

    // Create build row
    const { data: build, error: buildErr } = await admin
      .from("app_builds")
      .insert({
        project_id: projectId,
        user_id: user.id,
        platform,
        status: "queued",
        app_name: appName,
        package_id: packageId,
        version_name: versionName,
        version_code: versionCode,
        signing_mode: signingMode,
        build_target: buildTarget,
        logo_path: branding?.logo_path ?? null,
        splash_path: branding?.splash_path ?? null,
        adaptive_bg_color: branding?.adaptive_bg_color ?? null,
        splash_bg_color: branding?.splash_bg_color ?? null,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (buildErr || !build) return json({ error: "Could not create build record", detail: buildErr?.message }, 500);

    // Seed steps
    await admin.from("app_build_steps").insert(
      STEPS.map((s) => ({
        build_id: build.id,
        step_key: s.key,
        label: s.label,
        step_order: s.order,
        status: s.key === "queued" ? "running" : "pending",
        started_at: s.key === "queued" ? new Date().toISOString() : null,
      })),
    );

    // Build payload for GitHub Action.
    // Files are sent compressed-base64 via the webhook fetch (GH Actions will pull it back),
    // but workflow_dispatch inputs are limited (~64KB). So we publish files as a separate
    // signed-fetch endpoint: the action calls /functions/v1/build-files?build_id=... with the secret.
    const callbackUrl = `${SUPABASE_URL}/functions/v1/build-webhook`;
    const filesUrl = `${SUPABASE_URL}/functions/v1/build-files?build_id=${build.id}`;
    const keystoreUrl = `${SUPABASE_URL}/functions/v1/keystore-action?build_id=${build.id}`;

    const baseInputs: Record<string, string> = {
      build_id: build.id,
      app_name: appName,
      package_id: packageId,
      version_name: versionName,
      version_code: String(versionCode),
      signing_mode: signingMode,
      callback_url: callbackUrl,
      files_url: filesUrl,
      keystore_url: keystoreUrl,
      webhook_secret: WEBHOOK_SECRET,
    };

    const dispatch = (inputs: Record<string, string>) =>
      fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${encodeURIComponent(WORKFLOW)}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PAT}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: BUILD_REF, inputs }),
        },
      );

    // Try with build_target first; if the build repo still has the old workflow
    // (no build_target input), GitHub returns 422 "Unexpected inputs". Retry
    // without it for legacy compatibility — except for aab-release, which the
    // old workflow can't handle and would silently produce an APK.
    let dispatchRes = await dispatch({ ...baseInputs, build_target: buildTarget });
    if (dispatchRes.status === 422) {
      const errTxt = await dispatchRes.text();
      if (/Unexpected inputs/i.test(errTxt) && /build_target/.test(errTxt)) {
        if (buildTarget === "aab-release") {
          await admin
            .from("app_builds")
            .update({
              status: "failed",
              error_message: "Your build repo workflow is outdated. Update .github/workflows/build-apk.yml in your build repo to enable AAB (Play Store) builds.",
              finished_at: new Date().toISOString(),
            })
            .eq("id", build.id);
          return json({
            error: "workflow_outdated",
            message: "Update your build repo's .github/workflows/build-apk.yml to the latest version to enable Play Store AAB builds. Test/Release APK still work.",
          }, 409);
        }
        // Legacy fallback for APK targets — old workflow handles them fine.
        dispatchRes = await dispatch(baseInputs);
      } else {
        // Re-attach the consumed body for the error path below.
        dispatchRes = new Response(errTxt, { status: 422, statusText: dispatchRes.statusText });
      }
    }


    if (!dispatchRes.ok) {
      const txt = await dispatchRes.text();
      const failureDetail = `GitHub dispatch failed for ${REPO}/${WORKFLOW}@${BUILD_REF}: ${dispatchRes.status} ${txt.slice(0, 220)}`;
      await admin
        .from("app_builds")
        .update({ status: "failed", error_message: failureDetail, finished_at: new Date().toISOString() })
        .eq("id", build.id);
      await admin
        .from("app_build_steps")
        .update({ status: "failed", finished_at: new Date().toISOString(), detail: `${dispatchRes.status} ${txt.slice(0, 200)}` })
        .eq("build_id", build.id)
        .eq("step_key", "queued");
      return json({ error: "Failed to dispatch GitHub workflow", detail: txt.slice(0, 300) }, 502);
    }

    return json({ build_id: build.id, status: "queued" }, 200);
  } catch (e: unknown) {
    console.error("trigger-build error", e);
    return json({ error: "Internal error", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
  }));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function normalizeGitHubRepo(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim().replace(/\.git$/i, "");
  const slugMatch = trimmed.match(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  if (slugMatch) return trimmed;

  try {
    const url = new URL(trimmed);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;

    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    const normalizedRepo = repo?.replace(/\.git$/i, "");
    if (!owner || !normalizedRepo) return null;

    return `${owner}/${normalizedRepo}`;
  } catch {
    return null;
  }
}
