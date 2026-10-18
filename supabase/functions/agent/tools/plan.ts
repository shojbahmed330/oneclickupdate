// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

// PROTOTYPE-FIRST: get_plan / propose_plan / approve_plan removed.
// The approved visual prototype (design_references rows) IS the plan.
// Agent builds screen-by-screen from list_design_references → get_design_reference.
// Only verify_routes is kept here as a QA helper.
export function makePlanTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    verify_routes: tool({
      description:
        "Runtime verification: HTTP-fetches each given route from the running dev server (localhost:5173 or :5174 inside sandbox) " +
        "and reports HTTP status + whether the response contains Vite error markers. Fails routes that 5xx, contain " +
        "'__vite-error-overlay', 'Failed to compile', 'does not provide an export named', or 'Uncaught ReferenceError'. " +
        "Call as part of the FINAL QA PASS with every route in the plan.",
      inputSchema: z.object({
        routes: z.array(z.string()).min(1).max(30).describe("Routes like ['/', '/login', '/feed']."),
        port: z.number().int().min(1024).max(65535).default(5173),
      }),
      execute: async ({ routes, port }) => {
        const results: Array<{ route: string; status: number; ok: boolean; problems: string[] }> = [];
        const errorPatterns = [
          "__vite-error-overlay",
          "Failed to compile",
          "does not provide an export named",
          "Uncaught ReferenceError",
          "Uncaught SyntaxError",
          "The requested module",
        ];
        for (const r of routes) {
          const route = r.startsWith("/") ? r : `/${r}`;
          try {
            const cmd = `curl -s -o /tmp/_vr.html -w '%{http_code}' http://localhost:${port}${route} && echo '|||' && head -c 8000 /tmp/_vr.html`;
            const out = await sandbox.exec(cmd, "/root", 20);
            const raw = (out as any).stdout ?? (out as any).result ?? String(out);
            const [codePart, htmlPart = ""] = String(raw).split("|||");
            const status = parseInt(String(codePart).trim(), 10) || 0;
            const problems: string[] = [];
            for (const p of errorPatterns) if (htmlPart.includes(p)) problems.push(p);
            if (status >= 500) problems.push(`HTTP ${status}`);
            results.push({ route, status, ok: status > 0 && status < 500 && problems.length === 0, problems });
          } catch (e) {
            results.push({ route, status: 0, ok: false, problems: [String((e as Error).message ?? e)] });
          }
        }
        const failed = results.filter((x) => !x.ok);
        return { ok: failed.length === 0, results, failed_count: failed.length };
      },
    }),
  };
}
