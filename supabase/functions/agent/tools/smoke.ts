// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { startDevServer } from "./devServer.ts";

export function makeSmokeTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    e2e_smoke_test: tool({
      description:
        "Run a quick HTTP smoke test against the running dev server: fetches each route, reports HTTP status + first H1 text + presence of any console.error in the HTML. " +
        "Use AFTER build_app passes for any non-trivial change. Returns { ok, results:[{path,status,title,issues}] }.",
      inputSchema: z.object({
        paths: z.union([z.array(z.string()), z.string()]).default(["/"]).describe("Routes to probe, e.g. ['/', '/login', '/dashboard']"),
      }),
      execute: async ({ paths }) => {
        const routePaths = normalizePaths(paths);
        // Ensure dev server running
        const ps = await sandbox.exec("pgrep -f 'vite' >/dev/null && echo Y || echo N", cwd, 5);
        const running = String((ps as any).stdout ?? (ps as any).result ?? "").trim() === "Y";
        if (!running) {
          await startDevServer(sandbox, cwd);
        }

        const results: Array<{ path: string; status: number; title?: string; issues: string[] }> = [];
        for (const p of routePaths) {
          const safe = p.replace(/'/g, "");
          const r = await sandbox.exec(`curl -fsS -o /tmp/__page.html -w '%{http_code}' 'http://localhost:5173${safe}' 2>/dev/null || echo 000`, cwd, 30);
          const status = parseInt(String((r as any).stdout ?? (r as any).result ?? "000").trim(), 10) || 0;
          const html = await sandbox.readFile("/tmp/__page.html").catch(() => "");
          const titleMatch = html.match(/<h1[^>]*>([^<]{1,120})<\/h1>/i);
          const issues: string[] = [];
          if (status !== 200) issues.push(`HTTP ${status}`);
          if (/Uncaught|TypeError|ReferenceError|SyntaxError/.test(html)) issues.push("Error keyword in HTML");
          if (html.length < 300) issues.push("Empty/blank HTML");
          results.push({ path: p, status, title: titleMatch?.[1]?.trim(), issues });
        }
        const ok = results.every((r) => r.status === 200 && r.issues.length === 0);
        return { ok, results, hint: ok ? "All routes respond healthy." : "Fix routes flagged with issues, then run heal + build_app + e2e_smoke_test again." };
      },
    }),

    think: tool({
      description:
        "Internal scratch-pad for planning — no side-effects. Use to outline a multi-step plan before executing tools.",
      inputSchema: z.object({ thought: z.string() }),
      execute: async ({ thought }) => ({ ok: true, noted: thought.slice(0, 400) }),
    }),
  };
}

function normalizePaths(paths: string[] | string): string[] {
  if (Array.isArray(paths)) return paths;
  try {
    const parsed = JSON.parse(paths);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Plain route string, e.g. "/".
  }
  return [paths];
}
