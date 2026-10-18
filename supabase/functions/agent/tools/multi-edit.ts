// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { capDiffText, diffStats } from "../diff.ts";
import { getRunState } from "./_runState.ts";
import { autoValidateAfterEdit } from "./_autoValidate.ts";
import { checkRiskyEdit } from "./_riskyEditGuard.ts";
import { cachedReadFile, invalidatePath } from "./_sandboxCache.ts";

export function makeMultiEditTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    multi_edit: tool({
      description:
        "Apply multiple search/replace edits to a single file atomically. " +
        "Each edit's `search` must match exactly once unless replace_all is true. " +
        "If any edit fails, NO changes are written.",
      inputSchema: z.object({
        path: z.string(),
        edits: z
          .array(z.object({ search: z.string().min(1), replace: z.string(), replace_all: z.boolean().default(false) }))
          .min(1),
      }),
      execute: async ({ path, edits }) => {
        const full = `${cwd}/${path}`;
        const original = await cachedReadFile(sandbox, ctx, full);
        let content = original;
        const applied: number[] = [];
        for (let i = 0; i < edits.length; i++) {
          const { search, replace, replace_all } = edits[i];
          const occ = content.split(search).length - 1;
          if (occ === 0) return { ok: false, error: `edit ${i}: search not found`, applied };
          if (occ > 1 && !replace_all) return { ok: false, error: `edit ${i}: matched ${occ} times`, applied };
          content = replace_all ? content.split(search).join(replace) : content.replace(search, replace);
          applied.push(occ);
        }
        await sandbox.writeFile(full, content);
        invalidatePath(ctx, full);
        getRunState(ctx).editedFiles.add(path);
        const d = diffStats(original, content);
        const validation = await autoValidateAfterEdit(sandbox, cwd, path, ctx);
        const riskyEdit = await checkRiskyEdit(sandbox, cwd, path, ctx, { isNewFile: false });
        return {
          ok: true,
          path,
          kind: "modified",
          edits: applied.length,
          additions: d.additions,
          deletions: d.deletions,
          before: capDiffText(original),
          after: capDiffText(content),
          ...(validation ? { validation } : {}),
          ...(riskyEdit ? { riskyEdit } : {}),
        };
      },
    }),

    // ── File ops extras ───────────────────────────────────────
    copy_file: tool({
      description: "Copy a file or directory inside the project.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: async ({ from, to }) =>
        sandbox.exec(`mkdir -p "$(dirname '${cwd}/${to}')" && cp -r '${cwd}/${from}' '${cwd}/${to}'`, cwd, 30),
    }),
    make_dir: tool({
      description: "Create a directory (recursive).",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => sandbox.exec(`mkdir -p '${cwd}/${path}'`, cwd, 10),
    }),
  };
}
