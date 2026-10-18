// Project state versioning — checkpoint + revert tools.
//
// A checkpoint is a JSON snapshot of every tracked source file in the
// sandbox (excluding node_modules / dist / .git). Stored in the
// `project_checkpoints` table. Revert writes the snapshot back to the
// sandbox, overwriting current contents.
//
// Designed to be cheap: the agent calls `checkpoint` BEFORE risky multi-file
// edits, then `revert_checkpoint` if something blew up.

import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

const MAX_FILES = 400;
const MAX_BYTES_PER_FILE = 60_000;
const MAX_TOTAL_BYTES = 6_000_000; // ~6 MB cap per checkpoint

async function listTrackedFiles(sandbox: DaytonaSandbox, cwd: string): Promise<string[]> {
  const r = await sandbox.exec(
    `find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -path ./build -prune -o -path ./android -prune -o -path ./ios -prune -o -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.md' \\) -print 2>/dev/null | head -n ${MAX_FILES}`,
    cwd, 20,
  );
  const raw = String((r as any).stdout ?? (r as any).result ?? "").trim();
  return raw ? raw.split("\n").map((p) => p.replace(/^\.\//, "")) : [];
}

export function makeVersioningTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    checkpoint: tool({
      description:
        "Snapshot the project state (all tracked source files). Returns a checkpoint_id. " +
        "Call this BEFORE large refactors / multi-file rewrites so you can revert if it breaks. " +
        "Cheap to use — keep snapshots small by calling it on logical milestones, not every edit.",
      inputSchema: z.object({
        label: z.string().min(1).max(120).describe("Short human-readable note: 'before-router-refactor'"),
      }),
      execute: async ({ label }) => {
        const paths = await listTrackedFiles(sandbox, cwd);
        const files: { p: string; c: string }[] = [];
        let total = 0;
        for (const p of paths) {
          try {
            const c = await sandbox.readFile(`${cwd}/${p}`);
            if (c.length > MAX_BYTES_PER_FILE) continue;
            if (total + c.length > MAX_TOTAL_BYTES) break;
            files.push({ p, c });
            total += c.length;
          } catch { /* skip */ }
        }
        const { data, error } = await ctx.supabase
          .from("project_checkpoints")
          .insert({
            project_id: ctx.projectId,
            user_id: ctx.userId,
            label,
            source: "agent",
            files,
            file_count: files.length,
            total_bytes: total,
          })
          .select("id, created_at")
          .single();
        if (error) return { ok: false, error: error.message };
        return { ok: true, checkpoint_id: data.id, file_count: files.length, total_bytes: total, label };
      },
    }),

    list_checkpoints: tool({
      description: "List recent project checkpoints (id, label, file_count, created_at).",
      inputSchema: z.object({ limit: z.number().min(1).max(20).default(8) }),
      execute: async ({ limit }) => {
        const { data, error } = await ctx.supabase
          .from("project_checkpoints")
          .select("id, label, source, file_count, total_bytes, created_at")
          .eq("project_id", ctx.projectId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return { ok: false, error: error.message };
        return { ok: true, checkpoints: data ?? [] };
      },
    }),

    revert_checkpoint: tool({
      description:
        "Restore a previous checkpoint by id. Overwrites current files in the sandbox with the snapshot. " +
        "DESTRUCTIVE — call list_checkpoints first to confirm the right id, and tell the user what you're rolling back.",
      inputSchema: z.object({
        checkpoint_id: z.string().uuid(),
      }),
      execute: async ({ checkpoint_id }) => {
        const { data, error } = await ctx.supabase
          .from("project_checkpoints")
          .select("files, label, file_count")
          .eq("id", checkpoint_id)
          .eq("project_id", ctx.projectId)
          .maybeSingle();
        if (error) return { ok: false, error: error.message };
        if (!data) return { ok: false, error: "checkpoint not found" };
        const files = (data.files as { p: string; c: string }[]) ?? [];
        let written = 0;
        for (const f of files) {
          try {
            await sandbox.writeFile(`${cwd}/${f.p}`, f.c);
            written++;
          } catch { /* skip */ }
        }
        return { ok: true, restored: written, total: files.length, label: data.label };
      },
    }),
  };
}
