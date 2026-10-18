import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STEP_MAP: Array<[string, string]> = [
  ["fetch project files", "checkout"],
  ["apply custom branding", "inject"],
  ["install deps", "install"],
  ["vite build", "web_build"],
  ["capacitor sync", "cap_sync"],
  ["build apk", "gradle"],
  ["upload apk", "upload"],
];

Deno.serve(withSentry("build-status", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PAT = Deno.env.get("GITHUB_BUILD_PAT");
    const REPO = normalizeGitHubRepo(Deno.env.get("GITHUB_BUILD_REPO"));
    const WORKFLOW = Deno.env.get("GITHUB_BUILD_WORKFLOW")?.trim() || "build-apk.yml";
    const BUILD_REF = Deno.env.get("GITHUB_BUILD_REF")?.trim() || "main";

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return json({ error: "Unauthorized" }, 401);

    const { buildId } = await req.json().catch(() => ({}));
    if (!buildId) return json({ error: "buildId required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: build } = await admin.from("app_builds").select("*").eq("id", buildId).maybeSingle();
    if (!build) return json({ error: "Build not found" }, 404);
    if (build.user_id !== userData.user.id) return json({ error: "Forbidden" }, 403);

    const needsApkRepair = build.status === "ready" && needsDirectApkRepair(build);
    if (PAT && REPO && (["queued", "preparing", "building", "uploading"].includes(build.status) || needsApkRepair)) {
      try {
        await syncFromGitHub(admin, { PAT, REPO, WORKFLOW, BUILD_REF }, build);
      } catch (syncErr) {
        // Transient GitHub API errors (HTTP/2 drops, rate limits) shouldn't 500 the poller.
        console.warn("build-status sync skipped:", syncErr instanceof Error ? syncErr.message : String(syncErr));
      }
    }

    return json(await loadBuildState(admin, buildId));
  } catch (e) {
    console.error("build-status error", e);
    return json({ error: "Internal error", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
}));

async function syncFromGitHub(admin: any, cfg: any, build: any) {
  const run = build.github_run_id
    ? await gh(cfg, `/actions/runs/${build.github_run_id}`)
    : await findRunForBuild(admin, cfg, build);
  if (!run) return;

  const updatedBuild = await admin.from("app_builds").select("status, error_message").eq("id", build.id).maybeSingle();
  if (updatedBuild.data?.status === "failed") return;

  await admin.from("app_builds").update({
    github_run_id: String(run.id),
    github_run_url: run.html_url,
    status: run.status === "queued" ? "queued" : run.status === "completed" ? build.status : "building",
  }).eq("id", build.id);

  const jobs = await gh(cfg, `/actions/runs/${run.id}/jobs?per_page=50`).catch(() => null);
  const steps = jobs?.jobs?.flatMap((job: any) => job.steps ?? []) ?? [];
  for (const step of steps) {
    const key = mapStep(step.name);
    if (!key) continue;
    await admin.from("app_build_steps").update({
      status: mapStatus(step.status, step.conclusion),
      started_at: step.started_at ?? null,
      finished_at: step.completed_at ?? null,
      detail: step.conclusion && step.conclusion !== "success" ? step.conclusion : null,
    }).eq("build_id", build.id).eq("step_key", key);
  }

  if (run.status !== "completed") return;
  if (run.conclusion === "success") {
    const artifact = await findApkArtifact(cfg, run.id);
    const uploaded = artifact ? await uploadArtifactApkToStorage(admin, cfg, build, artifact).catch((e) => {
      console.error("artifact-to-apk upload failed", e);
      return null;
    }) : null;
    const afterUpload = await admin.from("app_builds").select("status").eq("id", build.id).maybeSingle();
    if (afterUpload.data?.status === "failed") return;
    // Mark any still-pending/running steps as done since the run succeeded.
    await admin.from("app_build_steps")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("build_id", build.id)
      .in("status", ["pending", "running"]);
    await admin.from("app_builds").update({
      status: "ready",
      download_url: uploaded?.url ?? build.download_url ?? artifact?.archive_download_url ?? null,
      file_size_bytes: uploaded?.size ?? build.file_size_bytes ?? null,
      finished_at: new Date().toISOString(),
    }).eq("id", build.id);
  } else {
    await admin.from("app_builds").update({
      status: run.conclusion === "cancelled" ? "cancelled" : "failed",
      error_message: `GitHub Actions ${run.conclusion ?? "failed"}`,
      finished_at: new Date().toISOString(),
    }).eq("id", build.id);
    await admin.from("app_build_steps").update({ status: "failed", finished_at: new Date().toISOString() })
      .eq("build_id", build.id).in("status", ["pending", "running"]);
  }
}

async function findRunForBuild(admin: any, cfg: any, build: any) {
  const runs = await gh(cfg, `/actions/workflows/${encodeURIComponent(cfg.WORKFLOW)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(cfg.BUILD_REF)}&per_page=20`);
  const started = new Date(build.started_at ?? build.created_at).getTime() - 120_000;
  const { data: assigned } = await admin.from("app_builds").select("github_run_id").not("github_run_id", "is", null).neq("id", build.id);
  const used = new Set((assigned ?? []).map((b: any) => String(b.github_run_id)));
  return (runs.workflow_runs ?? []).reverse().find((run: any) =>
    new Date(run.created_at).getTime() >= started && !used.has(String(run.id)),
  );
}

async function findApkArtifact(cfg: any, runId: string) {
  const artifacts = await gh(cfg, `/actions/runs/${runId}/artifacts`).catch(() => null);
  return (artifacts?.artifacts ?? []).find((a: any) => !a.expired && /apk/i.test(a.name));
}

async function uploadArtifactApkToStorage(admin: any, cfg: any, build: any, artifact: any) {
  if (!needsDirectApkRepair(build)) return null;
  const res = await fetch(artifact.archive_download_url, {
    headers: { Authorization: `Bearer ${cfg.PAT}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`artifact download ${res.status}: ${await res.text()}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const apk = await firstApkFromZip(zip);
  if (!apk) throw new Error("APK not found inside artifact zip");
  if (build.signing_mode === "debug" && /unsigned/i.test(apk.name)) {
    await admin.from("app_builds").update({
      status: "failed",
      error_message: "Build repo is still using the old workflow and produced an unsigned APK. Copy the latest .github/workflows/build-apk.yml, then rebuild.",
      finished_at: new Date().toISOString(),
    }).eq("id", build.id);
    return null;
  }
  const path = `${build.id}/${apk.name.split("/").pop() || "app-debug.apk"}`;
  const { error } = await admin.storage.from("apk-builds").upload(path, apk.bytes, {
    contentType: "application/vnd.android.package-archive",
    upsert: true,
  });
  if (error) throw new Error(error.message);
  // Bucket is private — return a 7-day signed URL instead of a public URL.
  const { data: signed, error: signErr } = await admin.storage
    .from("apk-builds")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signErr || !signed?.signedUrl) throw new Error(signErr?.message || "sign failed");
  return { url: signed.signedUrl, size: apk.bytes.byteLength };
}

function isGitHubArtifactUrl(value: unknown) {
  return typeof value === "string" && /github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+\/artifacts\/\d+/i.test(value);
}

function needsDirectApkRepair(build: any) {
  const url = String(build.download_url ?? "");
  return isGitHubArtifactUrl(url) || /unsigned\.apk(?:$|[?#])/i.test(url) || Number(build.file_size_bytes ?? 1) <= 0;
}

async function firstApkFromZip(zip: Uint8Array): Promise<{ name: string; bytes: Uint8Array } | null> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let pos = 0;
  while (pos + 30 <= zip.length && view.getUint32(pos, true) === 0x04034b50) {
    const method = view.getUint16(pos + 8, true);
    const compressedSize = view.getUint32(pos + 18, true);
    const uncompressedSize = view.getUint32(pos + 22, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const nameStart = pos + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zip.length) return null;
    const name = new TextDecoder().decode(zip.slice(nameStart, nameStart + nameLen));
    const data = zip.slice(dataStart, dataEnd);
    if (/\.apk$/i.test(name)) {
      if (method === 0) return { name, bytes: data };
      if (method === 8) return { name, bytes: await inflateRaw(data, uncompressedSize) };
      throw new Error(`Unsupported zip compression method ${method}`);
    }
    pos = dataEnd;
  }
  return null;
}

async function inflateRaw(data: Uint8Array, expectedSize: number) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (expectedSize && bytes.byteLength !== expectedSize) throw new Error("Inflated APK size mismatch");
  return bytes;
}

async function loadBuildState(admin: any, buildId: string) {
  const [{ data: build }, { data: steps }] = await Promise.all([
    admin.from("app_builds").select("*").eq("id", buildId).maybeSingle(),
    admin.from("app_build_steps").select("*").eq("build_id", buildId).order("step_order", { ascending: true }),
  ]);
  return { build, steps: steps ?? [] };
}

async function gh(cfg: any, path: string) {
  const url = `https://api.github.com/repos/${cfg.REPO}${path}`;
  const headers = { Authorization: `Bearer ${cfg.PAT}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry on transient network/HTTP2 errors
      if (!/http2|SendRequest|connection|network|ECONNRESET|fetch failed/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function mapStep(name: string) {
  const n = name.toLowerCase();
  return STEP_MAP.find(([needle]) => n.includes(needle))?.[1] ?? null;
}

function mapStatus(status: string, conclusion?: string) {
  if (status !== "completed") return status === "in_progress" ? "running" : "pending";
  if (conclusion === "success") return "done";
  if (conclusion === "skipped") return "skipped";
  return "failed";
}

function normalizeGitHubRepo(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.git$/i, "");
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    return owner && repo ? `${owner}/${repo.replace(/\.git$/i, "")}` : null;
  } catch { return null; }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}