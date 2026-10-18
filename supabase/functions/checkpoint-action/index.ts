// Checkpoint actions: create / restore / branch.
//
// - create   → snapshot all tracked sandbox files into project_checkpoints
// - restore  → write a snapshot's files back into the current sandbox
// - branch   → create a brand-new project + sandbox seeded with the snapshot
//
// All three respect RLS by validating the caller owns the project (and the
// target checkpoint, if applicable). The snapshot row itself is read with
// service-role to keep file payloads off the client until the action runs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";
import { getOrCreateSandbox } from "../_shared/sandboxLifecycle.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CWD = "/root/app";
const MAX_FILES = 400;
const MAX_BYTES_PER_FILE = 60_000;
const MAX_TOTAL_BYTES = 6_000_000;

const Body = z.union([
  z.object({ action: z.literal("create"), projectId: z.string().uuid(), label: z.string().min(1).max(160) }),
  z.object({ action: z.literal("restore"), projectId: z.string().uuid(), checkpointId: z.string().uuid() }),
  z.object({
    action: z.literal("branch"),
    projectId: z.string().uuid(),
    checkpointId: z.string().uuid(),
    name: z.string().min(1).max(120),
  }),
]);

Deno.serve(withSentry("checkpoint-action", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Authenticate the caller via the JWT in the Authorization header.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
    const body = parsed.data;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Confirm ownership of the source project.
    const { data: project } = await admin
      .from("projects")
      .select("id,user_id,name")
      .eq("id", body.projectId)
      .maybeSingle();
    if (!project || project.user_id !== userId) return json({ error: "Project not found" }, 404);

    if (body.action === "create") {
      const sandbox = await getOrCreateSandbox(admin as any, body.projectId, userId);
      const files = await snapshotSandbox(sandbox);
      const { data: ins, error } = await admin
        .from("project_checkpoints")
        .insert({
          project_id: body.projectId,
          user_id: userId,
          label: body.label,
          source: "manual",
          files,
          file_count: files.length,
          total_bytes: files.reduce((n, f) => n + f.c.length, 0),
        })
        .select("id, file_count")
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, checkpoint_id: ins.id, file_count: ins.file_count });
    }

    if (body.action === "restore") {
      const { data: cp } = await admin
        .from("project_checkpoints")
        .select("files,user_id,project_id")
        .eq("id", body.checkpointId)
        .maybeSingle();
      if (!cp || cp.user_id !== userId || cp.project_id !== body.projectId) {
        return json({ error: "Checkpoint not found" }, 404);
      }
      const sandbox = await getOrCreateSandbox(admin as any, body.projectId, userId);
      const files = (cp.files as Array<{ p: string; c: string }>) ?? [];
      let restored = 0;
      for (const f of files) {
        try {
          await sandbox.writeFile(`${CWD}/${f.p}`, f.c);
          restored++;
        } catch { /* ignore individual write errors */ }
      }
      return json({ ok: true, restored, total: files.length });
    }

    // branch: create a new project, seed sandbox with snapshot files.
    const { data: cp } = await admin
      .from("project_checkpoints")
      .select("files,user_id")
      .eq("id", body.checkpointId)
      .maybeSingle();
    if (!cp || cp.user_id !== userId) return json({ error: "Checkpoint not found" }, 404);

    const { data: newProject, error: pErr } = await admin
      .from("projects")
      .insert({ user_id: userId, name: body.name, description: `Branched from ${project.name}` })
      .select("id")
      .single();
    if (pErr) return json({ error: pErr.message }, 500);

    const newSandbox = await getOrCreateSandbox(admin as any, newProject.id, userId);
    const files = (cp.files as Array<{ p: string; c: string }>) ?? [];
    for (const f of files) {
      try { await newSandbox.writeFile(`${CWD}/${f.p}`, f.c); } catch { /* skip */ }
    }
    // Snapshot the seed too so the new project has its own t=0.
    await admin.from("project_checkpoints").insert({
      project_id: newProject.id,
      user_id: userId,
      label: `Seeded from branch (${body.name})`,
      source: "branch",
      files,
      file_count: files.length,
      total_bytes: files.reduce((n, f) => n + f.c.length, 0),
    });
    return json({ ok: true, newProjectId: newProject.id });
  } catch (e) {
    console.error("[checkpoint-action]", e);
    return json({ error: (e as Error).message }, 500);
  }
}));

async function snapshotSandbox(sandbox: any) {
  const r = await sandbox.exec(
    `find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -path ./build -prune -o -path ./android -prune -o -path ./ios -prune -o -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.md' \\) -print 2>/dev/null | head -n ${MAX_FILES}`,
    CWD, 30,
  );
  const raw = String((r as any).stdout ?? (r as any).result ?? "").trim();
  const paths = raw ? raw.split("\n").map((p) => p.replace(/^.\//, "")) : [];
  const files: { p: string; c: string }[] = [];
  let total = 0;
  for (const p of paths) {
    try {
      const c: string = await sandbox.readFile(`${CWD}/${p}`);
      if (c.length > MAX_BYTES_PER_FILE) continue;
      if (total + c.length > MAX_TOTAL_BYTES) break;
      files.push({ p, c });
      total += c.length;
    } catch { /* skip unreadable */ }
  }
  return files;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
