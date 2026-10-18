// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { startDevServer } from "./devServer.ts";
import { fingerprint, getRunState, topErrors, type ParsedError } from "./_runState.ts";

export function makeOpsTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    build_app: tool({
      description:
        "Run a production build (vite build) and return STRUCTURED diagnostics: { ok, errors:[{file,line,col,message,kind}], iteration, repeated, hiddenCount, hint }. " +
        "MANDATORY before declaring a non-trivial change done. If errors[] is non-empty, fix the relevant files then call build_app again. " +
        "Hard cap: 3 retries per turn. If the SAME errors come back twice, this tool refuses and asks you to change strategy.",
      inputSchema: z.object({}),
      execute: async () => {
        const state = getRunState(ctx);
        state.buildIter += 1;

        const r = await sandbox.exec("npm run build 2>&1 | tail -n 120", cwd, 600);
        const out = String((r as any).stdout ?? (r as any).result ?? "");
        const errors: ParsedError[] = [];

        const viteRe = /(?:^|\n)(?:\[vite[^\]]*\]\s*)?([^\s:()]+\.[tj]sx?)[\s:()]*(?:\((\d+)[,:](\d+)\))?[^\n]*?:\s*(.+)/gi;
        for (const m of out.matchAll(viteRe)) {
          const msg = (m[4] ?? "").trim();
          if (!msg || msg.length < 4) continue;
          if (/^node_modules\//.test(m[1])) continue;
          errors.push({ file: m[1], line: m[2] ? +m[2] : undefined, col: m[3] ? +m[3] : undefined, message: msg.slice(0, 300), kind: "build", raw: m[0].slice(0, 400) });
        }
        const resolveRe = /(?:Could not resolve|is not exported by|Module not found)[^\n]+/g;
        for (const m of out.matchAll(resolveRe)) {
          errors.push({ message: m[0].trim().slice(0, 300), kind: "resolve", raw: m[0].slice(0, 400) });
        }
        const tscRe = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/gm;
        for (const m of out.matchAll(tscRe)) {
          errors.push({ file: m[1], line: +m[2], col: +m[3], message: m[4], kind: "ts", raw: m[0] });
        }

        const failed = /(?:error during build|build failed|✘|exit\s+(?:code\s+)?[1-9])/i.test(out)
          || errors.length > 0;

        const seen = new Set<string>();
        const unique = errors.filter((e) => {
          const k = `${e.kind}|${e.file ?? ""}|${e.line ?? ""}|${e.message.slice(0, 80)}`;
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });

        // Cross-iteration dedupe
        const fp = fingerprint(unique);
        const repeated = state.buildIter > 1 && fp === state.lastBuildFingerprint && unique.length > 0;
        state.lastBuildFingerprint = fp;

        if (repeated) {
          return {
            ok: false,
            iteration: state.buildIter,
            repeated: true,
            errorCount: unique.length,
            errors: [],
            hint: `[build #${state.buildIter}: same ${unique.length} error(s) as previous build]. STOP retrying — read the actual file, change approach, or ask the user.`,
          };
        }

        // Top 10, prefer errors in files edited this turn (hide unrelated pre-existing)
        const { shown, hiddenCount, relatedTotal, unrelatedTotal } = topErrors(unique, state.editedFiles, 10);

        return {
          ok: !failed && unique.length === 0,
          iteration: state.buildIter,
          repeated: false,
          errors: shown,
          errorCount: unique.length,
          hiddenCount,
          relatedTotal,
          unrelatedTotal,
          // Compact tail (was 2000 → ~500 tokens; now ~200) — only when failed.
          output_tail: !failed ? undefined : out.slice(-800),
          hint: !failed
            ? "Build succeeded. Safe to declare done."
            : unique.length > 0
              ? `Build failed. Showing ${shown.length} of ${unique.length} error(s)` +
                (hiddenCount ? ` (${hiddenCount} hidden${unrelatedTotal ? `, ${unrelatedTotal} unrelated to this turn's edits` : ""}).` : ".") +
                ` Iteration ${state.buildIter}/3.`
              : "Build failed but no errors parsed — read output_tail.",
        };
      },
    }),

    // ── Dev-server lifecycle ──────────────────────────────────
    stop_dev_server: tool({
      description: "Stop the running Vite dev server.",
      inputSchema: z.object({}),
      execute: async () => sandbox.exec("pkill -f 'vite' || true", cwd, 10),
    }),
    restart_dev_server: tool({
      description: "Stop and restart the Vite dev server on port 5173.",
      inputSchema: z.object({}),
      execute: async () => startDevServer(sandbox, cwd, true),
    }),

    // ── Process control ───────────────────────────────────────
    list_processes: tool({
      description: "List running processes.",
      inputSchema: z.object({}),
      execute: async () => sandbox.exec("ps aux | head -n 40", cwd, 10),
    }),
    kill_process: tool({
      description: "Kill a process by PID or pattern.",
      inputSchema: z.object({ pid: z.number().optional(), pattern: z.string().optional() }),
      execute: async ({ pid, pattern }) => {
        if (pid) return sandbox.exec(`kill -9 ${pid} || true`, cwd, 10);
        if (pattern) return sandbox.exec(`pkill -9 -f '${pattern}' || true`, cwd, 10);
        return { ok: false, error: "pid or pattern required" };
      },
    }),

    // ── Git diagnostics ───────────────────────────────────────
    git_status: tool({
      description: "git status (porcelain).",
      inputSchema: z.object({}),
      execute: async () => sandbox.exec("git status --porcelain=v1 -b 2>&1 || true", cwd, 15),
    }),
    git_diff: tool({
      description: "git diff for changed files (truncated).",
      inputSchema: z.object({ path: z.string().default("") }),
      execute: async ({ path }) => sandbox.exec(`git diff --stat ${path}; echo '---'; git diff ${path} | head -n 400`, cwd, 30),
    }),

    // ── Download / archive ────────────────────────────────────
    download_file: tool({
      description: "Download a URL into the project at the given path.",
      inputSchema: z.object({ url: z.string().url(), path: z.string() }),
      execute: async ({ url, path }) =>
        sandbox.exec(`mkdir -p "$(dirname '${cwd}/${path}')" && curl -fsSL '${url}' -o '${cwd}/${path}'`, cwd, 120),
    }),
    extract_archive: tool({
      description: "Extract a .zip or .tar.gz archive into a destination directory.",
      inputSchema: z.object({ archive: z.string(), dest: z.string().default(".") }),
      execute: async ({ archive, dest }) => {
        const a = `${cwd}/${archive}`;
        const d = `${cwd}/${dest}`;
        const cmd = archive.endsWith(".zip")
          ? `mkdir -p '${d}' && unzip -o '${a}' -d '${d}'`
          : `mkdir -p '${d}' && tar -xzf '${a}' -C '${d}'`;
        return sandbox.exec(cmd, cwd, 120);
      },
    }),

  };
}
