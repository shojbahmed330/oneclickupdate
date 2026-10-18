// test_coverage — runs vitest with coverage and returns a structured summary
// so the heal loop can target the lowest-covered files. Auto-installs the
// @vitest/coverage-v8 reporter if missing.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

interface FileSummary {
  file: string;
  lines_pct: number;
  branches_pct: number;
  functions_pct: number;
}

export function makeTestCoverageTools(sandbox: DaytonaSandbox, _ctx: ToolCtx, cwd: string) {
  return {
    test_coverage: tool({
      description:
        "Run vitest with coverage (@vitest/coverage-v8) and return a structured summary: " +
        "{ ok, total: {lines,branches,functions,statements}, low_coverage_files: [{file,lines_pct,...}], threshold_failed }. " +
        "Use during FINAL QA on big features to identify untested files BEFORE calling generate_tests on them. " +
        "Pass `min_lines` to fail when total line coverage is below that percent (default 60).",
      inputSchema: z.object({
        min_lines: z.number().int().min(0).max(100).default(60),
        focus_paths: z.array(z.string()).max(20).optional()
          .describe("Optional glob paths to scope the run, e.g. ['src/lib/**','src/hooks/**']"),
      }),
      execute: async ({ min_lines, focus_paths }) => {
        // Ensure coverage reporter is installed
        const checkRes = await sandbox.exec(
          `test -d "${cwd}/node_modules/@vitest/coverage-v8" && echo Y || echo N`,
          cwd, 5,
        );
        const hasCov = String((checkRes as any).stdout ?? "").trim() === "Y";
        if (!hasCov) {
          await sandbox.exec(`cd "${cwd}" && bun add -d @vitest/coverage-v8`, cwd, 120);
        }

        const scope = (focus_paths ?? []).map((p) => `'${p.replace(/'/g, "")}'`).join(" ");
        const cmd =
          `cd "${cwd}" && bunx vitest run --coverage --coverage.reporter=json-summary ` +
          `--coverage.reporter=text ${scope} 2>&1 | tail -c 4000 ; ` +
          `echo "===SUMMARY===" ; cat coverage/coverage-summary.json 2>/dev/null || echo '{}'`;
        const res = await sandbox.exec(cmd, cwd, 240);
        const out = String((res as any).stdout ?? (res as any).result ?? "");
        const [logPart, summaryPart = "{}"] = out.split("===SUMMARY===");

        let summary: any = {};
        try { summary = JSON.parse(summaryPart.trim() || "{}"); } catch { summary = {}; }

        const total = summary?.total ?? {};
        const totals = {
          lines: Number(total?.lines?.pct ?? 0),
          branches: Number(total?.branches?.pct ?? 0),
          functions: Number(total?.functions?.pct ?? 0),
          statements: Number(total?.statements?.pct ?? 0),
        };

        const files: FileSummary[] = [];
        for (const [k, v] of Object.entries(summary ?? {})) {
          if (k === "total") continue;
          const m = v as any;
          files.push({
            file: k.replace(cwd + "/", ""),
            lines_pct: Number(m?.lines?.pct ?? 0),
            branches_pct: Number(m?.branches?.pct ?? 0),
            functions_pct: Number(m?.functions?.pct ?? 0),
          });
        }
        const low = files
          .filter((f) => f.lines_pct < min_lines)
          .sort((a, b) => a.lines_pct - b.lines_pct)
          .slice(0, 15);

        const ok = totals.lines >= min_lines && low.length === 0 && files.length > 0;
        return {
          ok,
          total: totals,
          file_count: files.length,
          low_coverage_files: low,
          threshold_failed: totals.lines < min_lines,
          min_lines,
          hint: ok
            ? "Coverage meets threshold."
            : files.length === 0
              ? "No coverage data — vitest run probably failed. Check log tail."
              : `Lines coverage ${totals.lines}% < ${min_lines}%. Call generate_tests for the listed low_coverage_files.`,
          log_tail: logPart.slice(-1500),
        };
      },
    }),
  };
}
