// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { computeDepImpact } from "../../_shared/depGraph.ts";
import { fingerprint, getRunState, topErrors, type ParsedError } from "./_runState.ts";
import { enrichErrors } from "./_errorContext.ts";

export function makeHealTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    heal: tool({
      description:
        "Read the dev-server log + run typecheck and return STRUCTURED errors with parsed { file, line, col, message, kind }. " +
        "Call AFTER any meaningful edit. If errors are returned, fix them with edit_file/write_file then call heal again. " +
        "MAX 5 iterations per turn — and if the SAME errors come back twice, this tool will refuse and ask you to stop. " +
        "Returns { ok, errors:[], warnings:[], iteration, repeated, hiddenCount, hint }.",
      inputSchema: z.object({
        include_warnings: z.boolean().default(false),
      }),
      execute: async ({ include_warnings }) => {
        const state = getRunState(ctx);
        state.healIter += 1;

        // 1. Tail dev log (60 lines is plenty — most errors are at the bottom)
        let logTail = "";
        try {
          const r = await sandbox.exec("tail -n 60 /tmp/dev.log 2>/dev/null || true", cwd, 10);
          logTail = String((r as any).stdout ?? (r as any).result ?? "");
        } catch { /* ignore */ }

        // 2. Run typecheck — head -n 60 (was 200 → ~3000 tokens; now ~900)
        let tscOut = "";
        try {
          const r = await sandbox.exec("npx --no-install tsc --noEmit 2>&1 | head -n 60", cwd, 90);
          tscOut = String((r as any).stdout ?? (r as any).result ?? "");
        } catch (e) { tscOut = String((e as Error).message ?? e); }

        const errors: ParsedError[] = [];
        const warnings: Array<{ message: string; raw: string }> = [];

        const tscRe = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)$/gm;
        for (const m of tscOut.matchAll(tscRe)) {
          const entry = { file: m[1], line: +m[2], col: +m[3], message: m[5], kind: "ts", raw: m[0] };
          if (m[4] === "error") errors.push(entry); else warnings.push({ message: m[5], raw: m[0] });
        }
        const viteRe = /\[(?:plugin|vite)[^\]]*\][^\n]*?([^\s:]+\.[tj]sx?)(?::(\d+))?(?::(\d+))?[^\n]*?\n([^\n]+)/g;
        for (const m of logTail.matchAll(viteRe)) {
          errors.push({ file: m[1], line: m[2] ? +m[2] : undefined, col: m[3] ? +m[3] : undefined, message: m[4]?.trim() ?? "Vite error", kind: "vite", raw: m[0].slice(0, 400) });
        }
        const failRe = /^(?:.*?(?:Failed to compile|Module not found|does not provide an export named|Cannot find module)[^\n]*)$/gm;
        for (const m of logTail.matchAll(failRe)) {
          errors.push({ message: m[0].trim().slice(0, 240), kind: "build", raw: m[0].slice(0, 400) });
        }
        const runtimeRe = /^(?:.*Uncaught\s+(?:Reference|Type|Syntax)Error[^\n]+)$/gm;
        for (const m of logTail.matchAll(runtimeRe)) {
          errors.push({ message: m[0].trim().slice(0, 240), kind: "runtime", raw: m[0].slice(0, 400) });
        }

        // Dedupe within this run
        const seen = new Set<string>();
        const unique = errors.filter((e) => {
          const k = `${e.kind}|${e.file ?? ""}|${e.line ?? ""}|${e.message.slice(0, 80)}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        // Cross-iteration dedupe: same fingerprint as last call?
        const fp = fingerprint(unique);
        const repeated = state.healIter > 1 && fp === state.lastHealFingerprint && unique.length > 0;
        state.lastHealFingerprint = fp;

        if (repeated) {
          return {
            ok: false,
            iteration: state.healIter,
            repeated: true,
            errors: [],
            errorCount: unique.length,
            hint: `[heal #${state.healIter}: same ${unique.length} error(s) as previous iteration]. STOP retrying — change strategy (read the relevant file, ask the user, or pivot).`,
          };
        }

        // Top-N (10), prioritising files edited this turn
        const { shown, hiddenCount, relatedTotal, unrelatedTotal } = topErrors(unique, state.editedFiles, 10);

        // Enrich shown errors with file snippets + category + hint (saves a read_file round-trip).
        const { enriched, hasRuntime } = await enrichErrors(sandbox, cwd, shown);

        return {
          ok: unique.length === 0,
          iteration: state.healIter,
          repeated: false,
          errors: enriched,
          errorCount: unique.length,
          hiddenCount,
          relatedTotal,
          unrelatedTotal,
          warnings: include_warnings ? warnings : [],
          ...(hasRuntime ? { runtime_advice: "Runtime errors detected — call read_console_logs (browser tool) for the JS stack and read_network for failed requests, then fix at the reported file/line." } : {}),
          hint: unique.length === 0
            ? "All clean. Move on."
            : `Iteration ${state.healIter}/5. Showing ${enriched.length} of ${unique.length} error(s) with file snippets + category + hint` +
              (hiddenCount ? ` (${hiddenCount} hidden — fix top first, rerun heal).` : ".") +
              (state.healIter >= 5 ? " HARD CAP REACHED — stop and tell the user." : ""),
        };
      },
    }),

    dep_graph_impact: tool({
      description:
        "Per-file dependency-aware planner. Given a list of files you intend to edit/rename/delete, returns the importer files that will likely break. " +
        "Call BEFORE renaming exported symbols, deleting files, changing prop signatures of shared components, or refactoring hooks/types. " +
        "Returns { changed, direct_importers, transitive, exported_symbols, hint }. " +
        "If importers exist, INCLUDE them in your edit batch (multi_edit) — don't ship a half-broken refactor. " +
        "Note: dynamic imports (import('...')) are not detected.",
      inputSchema: z.object({
        changed_paths: z.array(z.string().min(1)).min(1).max(20).describe("Project-relative paths, e.g. ['src/components/Button.tsx']"),
        max_results: z.number().int().min(1).max(100).default(30),
        transitive_depth: z.number().int().min(1).max(4).default(2),
      }),
      execute: async ({ changed_paths, max_results, transitive_depth }) => {
        try {
          const r = await computeDepImpact(sandbox, cwd, changed_paths, {
            maxResults: max_results,
            transitiveDepth: transitive_depth,
          });
          return { ok: true, ...r };
        } catch (e) {
          return { ok: false, error: String((e as Error).message ?? e) };
        }
      },
    }),
  };
}
