// Mandatory safety check before write_file / multi_edit on a "shared" file.
// Surfaces dependency importers in the SAME tool response so the agent
// extends its edit batch instead of shipping a half-broken refactor.
//
// "Shared" = lives in src/components/ui|src/hooks|src/lib|src/types|src/store
// or has 2+ importers across the project.
//
// Token-conservative: only runs on shared paths, returns ≤6 importer paths.

import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import { computeDepImpact } from "../../_shared/depGraph.ts";
import { getRunState } from "./_runState.ts";

const SHARED_RX = /^src\/(components\/(ui|shared|layout)|hooks|lib|types|store|integrations)\//;

export interface RiskyEditWarning {
  level: "warn" | "info";
  message: string;
  importers: string[];
  total_importers: number;
  advice: string;
}

export async function checkRiskyEdit(
  sandbox: DaytonaSandbox,
  cwd: string,
  path: string,
  ctx: any,
  opts: { isNewFile?: boolean } = {},
): Promise<RiskyEditWarning | null> {
  // Skip new files (no existing importers) and non-shared paths.
  if (opts.isNewFile) return null;
  if (!SHARED_RX.test(path) && !/\.(tsx?|jsx?)$/.test(path)) return null;

  try {
    const r = await computeDepImpact(sandbox, cwd, [path], { maxResults: 12, transitiveDepth: 1 });
    const total = r.direct_importers.length;
    if (total === 0) return null;

    const state = getRunState(ctx);
    const editedThisTurn = new Set([...state.editedFiles]);
    const notIncluded = r.direct_importers.filter((p) => !editedThisTurn.has(p));
    if (notIncluded.length === 0) return null; // user already touched all importers

    // Lightweight info if only 1-2 importers, warn if more.
    const level: "warn" | "info" = notIncluded.length >= 3 ? "warn" : "info";
    return {
      level,
      message:
        `🕸 Shared file edit — ${total} file(s) import \`${path}\`, ${notIncluded.length} not yet edited this turn.`,
      importers: notIncluded.slice(0, 6),
      total_importers: total,
      advice:
        level === "warn"
          ? "Likely refactor: if you changed an exported signature/prop/name, USE multi_edit to update the importers in the SAME batch — don't ship a half-broken refactor. If purely internal change (no API change), ignore this hint."
          : "If your change altered an exported symbol's signature/name, also update the importer(s). Otherwise, ignore.",
    };
  } catch {
    return null;
  }
}
