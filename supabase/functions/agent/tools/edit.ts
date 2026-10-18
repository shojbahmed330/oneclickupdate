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

export function makeEditTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    edit_file: tool({
      description:
        "Targeted search-and-replace edit. Use INSTEAD OF write_file for small changes (color, prop, copy, single block). " +
        "`search` must match EXACTLY once in the file. Set `replace_all: true` to allow multiple matches. " +
        "Returns the number of replacements made.",
      inputSchema: z.object({
        path: z.string(),
        search: z.string().min(1),
        replace: z.string(),
        replace_all: z.boolean().default(false),
      }),
      execute: async ({ path, search, replace, replace_all }) => {
        const full = `${cwd}/${path}`;
        const content = await cachedReadFile(sandbox, ctx, full);
        const occurrences = content.split(search).length - 1;
        if (occurrences === 0) {
          return { ok: false, error: "search string not found", occurrences: 0 };
        }
        if (occurrences > 1 && !replace_all) {
          return {
            ok: false,
            error: `search matched ${occurrences} times — make it unique or pass replace_all: true`,
            occurrences,
          };
        }
        const next = replace_all ? content.split(search).join(replace) : content.replace(search, replace);
        await sandbox.writeFile(full, next);
        invalidatePath(ctx, full);
        getRunState(ctx).editedFiles.add(path);
        const d = diffStats(content, next);
        const validation = await autoValidateAfterEdit(sandbox, cwd, path, ctx);
        const riskyEdit = await checkRiskyEdit(sandbox, cwd, path, ctx, { isNewFile: false });
        return {
          ok: true,
          path,
          kind: "modified",
          replacements: occurrences,
          additions: d.additions,
          deletions: d.deletions,
          before: capDiffText(content),
          after: capDiffText(next),
          ...(validation ? { validation } : {}),
          ...(riskyEdit ? { riskyEdit } : {}),
        };
      },
    }),
    move_file: tool({
      description: "Rename or move a project file.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: async ({ from, to }) =>
        sandbox.exec(`mkdir -p "$(dirname '${cwd}/${to}')" && mv '${cwd}/${from}' '${cwd}/${to}'`, cwd, 30),
    }),
  };
}
