// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeSearchTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    search_code: tool({
      description: "Ripgrep-style content search across the project. Returns matching file:line:text.",
      inputSchema: z.object({
        query: z.string(),
        path: z.string().default("src"),
        max_results: z.number().default(80),
      }),
      execute: async ({ query, path, max_results }) => {
        const safe = query.replace(/'/g, `'\\''`);
        return sandbox.exec(
          `grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.css' --include='*.html' --include='*.json' '${safe}' ${path} | head -n ${max_results}`,
          cwd,
          30,
        );
      },
    }),
    glob_files: tool({
      description: "Find files by glob pattern (e.g. 'src/**/*.tsx').",
      inputSchema: z.object({ pattern: z.string(), max_results: z.number().default(200) }),
      execute: async ({ pattern, max_results }) =>
        sandbox.exec(`find . -path ./node_modules -prune -o -type f -name '${pattern.split("/").pop()}' -print | head -n ${max_results}`, cwd, 30),
    }),

    project_tree: tool({
      description:
        "On-demand project file tree. Returns user-source files (src/**, supabase/functions/**, root configs) " +
        "grouped by directory, skipping node_modules/dist/build/.git, *.test.*, *.d.ts, lockfiles. " +
        "Call this once at the start of a turn if you need to know what exists — the per-turn context no longer " +
        "auto-injects the tree to save tokens.",
      inputSchema: z.object({
        path: z.string().default(".").describe("Root to walk (project-relative)."),
        max_files: z.number().int().min(10).max(500).default(120),
      }),
      execute: async ({ path, max_files }) => {
        const r = await sandbox.exec(
          `find ${path} -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -path ./build -prune -o -path ./.next -prune -o -path ./android -prune -o -path ./ios -prune -o -type f \\( -name '*.tsx' -o -name '*.ts' -o -name '*.css' -o -name '*.html' -o -name 'package.json' -o -name 'tailwind.config.*' -o -name 'vite.config.*' -o -name 'tsconfig*.json' -o -name 'capacitor.config.*' -o -name '*.md' \\) ! -name '*.test.*' ! -name '*.spec.*' ! -name '*.d.ts' -print 2>/dev/null | sort | head -n ${max_files}`,
          cwd, 15,
        );
        const raw = String((r as any).stdout ?? (r as any).result ?? "").trim();
        if (!raw) return { tree: "", count: 0 };
        const paths = raw.split("\n").map((p) => p.replace(/^\.\//, ""));
        // Group by directory for compact rendering.
        const byDir = new Map<string, string[]>();
        for (const p of paths) {
          const idx = p.lastIndexOf("/");
          const dir = idx === -1 ? "." : p.slice(0, idx);
          const file = idx === -1 ? p : p.slice(idx + 1);
          if (!byDir.has(dir)) byDir.set(dir, []);
          byDir.get(dir)!.push(file);
        }
        const lines: string[] = [];
        for (const [dir, files] of [...byDir.entries()].sort()) {
          lines.push(`${dir}/  ${files.join(", ")}`);
        }
        return { tree: lines.join("\n"), count: paths.length };
      },
    }),

    // ── Dev-server diagnostics ────────────────────────────────
    read_dev_log: tool({
      description: "Read the tail of the Vite dev-server log to debug build/HMR errors.",
      inputSchema: z.object({ lines: z.number().default(120) }),
      execute: async ({ lines }) => sandbox.exec(`tail -n ${lines} /tmp/dev.log || true`, cwd, 10),
    }),
  };
}
