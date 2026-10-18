// Browser-probe tools for the agent — runtime introspection of the
// running preview (console, network, screenshot). Built on top of a
// playwright probe script executed inside the Daytona sandbox.

import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "./daytona.ts";
import { PROBE_SCRIPT, PROBE_INSTALL } from "./browserProbe.ts";
import { computeScreenshotDiff } from "./visualDiff.ts";

async function ensureProbe(sandbox: DaytonaSandbox, cwd: string) {
  // Write the probe script every call (cheap) but install only once.
  await sandbox.writeFile("/tmp/_probe.mjs", PROBE_SCRIPT);
  await sandbox.exec(PROBE_INSTALL, cwd, 600);
}

async function runProbe(
  sandbox: DaytonaSandbox,
  cwd: string,
  args: Record<string, unknown>,
): Promise<any> {
  await ensureProbe(sandbox, cwd);
  const json = JSON.stringify(args).replace(/'/g, `'\\''`);
  const r = await sandbox.exec(
    `cd /tmp && NODE_PATH=/tmp/node_modules node /tmp/_probe.mjs '${json}'`,
    cwd,
    60,
  );
  const raw = String((r as any).stdout ?? (r as any).result ?? "").trim();
  // probe writes a single JSON blob to stdout — extract last { ... }
  const m = raw.match(/\{[\s\S]*\}\s*$/);
  if (!m) return { ok: false, error: "probe produced no JSON", raw: raw.slice(-600) };
  try { return JSON.parse(m[0]); } catch (e) {
    return { ok: false, error: "probe JSON parse failed: " + String((e as Error).message), raw: raw.slice(-600) };
  }
}

export function buildBrowserTools(sandbox: DaytonaSandbox, cwd = "/root/app", projectId = "default") {
  const localUrl = (route: string, port = 5173) => {
    const r = route.startsWith("/") ? route : `/${route}`;
    return `http://localhost:${port}${r}`;
  };

  return {
    read_console_logs: tool({
      description:
        "Open the running preview in headless Chromium, navigate to the given route, " +
        "and return browser console messages + uncaught errors. Use this to debug runtime issues " +
        "that don't show up in the Vite dev log (white-screen, undefined refs, hydration mismatches).",
      inputSchema: z.object({
        route: z.string().default("/"),
        port: z.number().int().default(5173),
        wait_ms: z.number().int().default(4000),
      }),
      execute: async ({ route, port, wait_ms }) => {
        const res = await runProbe(sandbox, cwd, { mode: "console", url: localUrl(route, port), waitMs: wait_ms });
        return {
          ok: res.ok && res.errors?.length === 0,
          console: res.console ?? [],
          errors: res.errors ?? [],
        };
      },
    }),

    read_network: tool({
      description:
        "Open the running preview in headless Chromium and return the network requests it makes " +
        "(method, url, status, resource type) plus failed requests. Use to debug 404s, CORS, broken API calls.",
      inputSchema: z.object({
        route: z.string().default("/"),
        port: z.number().int().default(5173),
        wait_ms: z.number().int().default(4000),
      }),
      execute: async ({ route, port, wait_ms }) => {
        const res = await runProbe(sandbox, cwd, { mode: "network", url: localUrl(route, port), waitMs: wait_ms });
        const reqs = (res.network ?? []) as Array<any>;
        const failed = reqs.filter((r) => r.phase === "failed" || (r.status ?? 0) >= 400);
        return { ok: res.ok, requests: reqs, failed_count: failed.length, failed };
      },
    }),

    screenshot_preview: tool({
      description:
        "Take a PNG screenshot of the running preview at the given route in mobile (390x844) viewport by default. " +
        "Returns a base64 PNG and the in-sandbox path. Use to visually verify a screen after building it.",
      inputSchema: z.object({
        route: z.string().default("/"),
        port: z.number().int().default(5173),
        width: z.number().int().default(390),
        height: z.number().int().default(844),
        wait_ms: z.number().int().default(2500),
      }),
      execute: async ({ route, port, width, height, wait_ms }) => {
        const screenshotPath = `/tmp/_shot_${Date.now()}.png`;
        const res = await runProbe(sandbox, cwd, {
          mode: "screenshot",
          url: localUrl(route, port),
          viewport: { width, height },
          waitMs: wait_ms,
          screenshotPath,
        });
        return {
          ok: res.ok,
          path: res.screenshotPath ?? null,
          imageBase64: res.screenshotBase64 ?? null,
          mediaType: "image/png",
          errors: res.errors ?? [],
        };
      },
    }),

    screenshot_diff: tool({
      description:
        "Visual-regression QA. Takes a screenshot of the route, compares to a stored baseline (saved per route on first call), " +
        "and runs heuristics for blank-screen / monochrome / bottom-nav-clip detection — even with NO baseline yet. " +
        "First call on a route: saves baseline, returns ok:true unless heuristics flag the screen as broken. " +
        "Subsequent calls: returns diff_pct + ok:false if pixel mismatch > threshold (default 5%). " +
        "Use this in the FINAL QA pass instead of (or in addition to) screenshot_preview. " +
        "If a regression is intentional (redesign), include 're_baseline:true' to overwrite the baseline.",
      inputSchema: z.object({
        route: z.string().default("/"),
        port: z.number().int().default(5173),
        width: z.number().int().default(390),
        height: z.number().int().default(844),
        wait_ms: z.number().int().default(2500),
        label: z.string().optional().describe("Optional baseline tag, e.g. 'logged-in', to keep multiple baselines per route."),
        threshold: z.number().min(0.005).max(0.5).default(0.05),
        re_baseline: z.boolean().default(false).describe("Force-overwrite the baseline before comparing."),
      }),
      execute: async ({ route, port, width, height, wait_ms, label, threshold, re_baseline }) => {
        const screenshotPath = `/tmp/_shot_${Date.now()}.png`;
        const probe = await runProbe(sandbox, cwd, {
          mode: "screenshot",
          url: localUrl(route, port),
          viewport: { width, height },
          waitMs: wait_ms,
          screenshotPath,
        });
        if (!probe.ok || !probe.screenshotPath) {
          return { ok: false, error: probe.error ?? "screenshot failed", probe_errors: probe.errors ?? [] };
        }
        if (re_baseline) {
          const { baselinePath } = await import("./visualDiff.ts");
          const blPath = baselinePath(projectId, route, label);
          try { await sandbox.exec(`rm -f '${blPath}'`, cwd, 5); } catch { /* ignore */ }
        }
        const diff = await computeScreenshotDiff({
          sandbox, cwd, projectId, route, label,
          currentPath: probe.screenshotPath,
          threshold,
        });
        return { ...diff, route, label: label ?? null };
      },
    }),
  };
}
