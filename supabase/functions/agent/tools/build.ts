// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { startDevServer } from "./devServer.ts";

export function makeBuildTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    uninstall_dep: tool({
      description: "Uninstall one or more npm packages.",
      inputSchema: z.object({ packages: z.array(z.string()).min(1) }),
      execute: async ({ packages }) => sandbox.exec(`npm uninstall ${packages.join(" ")}`, cwd, 180),
    }),
    npm_script: tool({
      description: "Run a script defined in package.json (npm run <name>).",
      inputSchema: z.object({ name: z.string(), timeout_sec: z.number().default(300) }),
      execute: async ({ name, timeout_sec }) => {
        if (name.trim() === "dev") return startDevServer(sandbox, cwd);
        return sandbox.exec(`npm run ${name}`, cwd, timeout_sec);
      },
    }),
    read_package_json: tool({
      description: "Read and parse package.json (scripts + deps).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const raw = await sandbox.readFile(`${cwd}/package.json`);
          const pkg = JSON.parse(raw);
          return {
            ok: true,
            name: pkg.name,
            version: pkg.version,
            scripts: pkg.scripts ?? {},
            dependencies: pkg.dependencies ?? {},
            devDependencies: pkg.devDependencies ?? {},
          };
        } catch (e) {
          return { ok: false, error: String((e as Error).message || e) };
        }
      },
    }),

    // ── Quality / build ───────────────────────────────────────
    typecheck: tool({
      description: "Run TypeScript type-check (tsc --noEmit). Returns diagnostics.",
      inputSchema: z.object({}),
      execute: async () => sandbox.exec("npx -y tsc --noEmit --pretty false 2>&1 | head -n 60", cwd, 240),
    }),
    lint: tool({
      description: "Run ESLint over the project.",
      inputSchema: z.object({ path: z.string().default("src") }),
      execute: async ({ path }) =>
        sandbox.exec(`npx -y eslint '${path}' --no-error-on-unmatched-pattern 2>&1 | head -n 60`, cwd, 180),
    }),
    format: tool({
      description: "Format files with Prettier (writes in place).",
      inputSchema: z.object({ pattern: z.string().default("src/**/*.{ts,tsx,css}") }),
      execute: async ({ pattern }) => sandbox.exec(`npx -y prettier --write '${pattern}'`, cwd, 120),
    }),
    run_tests: tool({
      description: "Run vitest once and return output tail.",
      inputSchema: z.object({ pattern: z.string().default("") }),
      execute: async ({ pattern }) =>
        sandbox.exec(`npx -y vitest run ${pattern} 2>&1 | tail -n 200`, cwd, 300),
    }),
    generate_tests: tool({
      description:
        "Auto-create a Vitest spec file for a component/module. Ensures vitest + @testing-library/react + jsdom are installed, " +
        "writes vitest.config.ts and src/test/setup.ts if missing, then writes the spec file you provide and runs it once. " +
        "Returns { ok, spec_path, test_output }. Use this AFTER you've designed what to test — " +
        "pass `spec_content` as a complete vitest test file (imports, describe/it, render + assertions).",
      inputSchema: z.object({
        target_path: z.string().describe("Source file under test, e.g. 'src/components/Button.tsx'"),
        spec_path: z.string().optional().describe("Spec file path. Defaults to sibling .test.tsx of target_path."),
        spec_content: z.string().min(20).describe("Full vitest spec file contents."),
        run_after_write: z.boolean().default(true),
      }),
      execute: async ({ target_path, spec_path, spec_content, run_after_write }) => {
        // 1. Ensure vitest deps
        const pkgRaw = await sandbox.readFile(`${cwd}/package.json`).catch(() => "");
        let needsInstall = false;
        try {
          const pkg = JSON.parse(pkgRaw || "{}");
          const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
          if (!all.vitest || !all["@testing-library/react"] || !all.jsdom || !all["@testing-library/jest-dom"]) {
            needsInstall = true;
          }
        } catch { needsInstall = true; }
        if (needsInstall) {
          await sandbox.exec(
            `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react-swc`,
            cwd, 360,
          );
        }

        // 2. Ensure vitest.config.ts
        const cfgPath = `${cwd}/vitest.config.ts`;
        const cfgExists = await sandbox.exec(`test -f '${cfgPath}' && echo Y || echo N`, cwd, 5);
        const cfgFlag = String((cfgExists as any).stdout ?? (cfgExists as any).result ?? "").trim();
        if (cfgFlag !== "Y") {
          await sandbox.writeFile(cfgPath, `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
`);
        }

        // 3. Ensure setup file
        const setupPath = `${cwd}/src/test/setup.ts`;
        const setupExists = await sandbox.exec(`test -f '${setupPath}' && echo Y || echo N`, cwd, 5);
        const setupFlag = String((setupExists as any).stdout ?? (setupExists as any).result ?? "").trim();
        if (setupFlag !== "Y") {
          await sandbox.writeFile(setupPath, `import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
`);
        }

        // 4. Write spec
        const finalSpecPath = spec_path
          ?? target_path.replace(/\.(tsx?|jsx?)$/, ".test.$1");
        await sandbox.writeFile(`${cwd}/${finalSpecPath}`, spec_content);

        // 5. Run
        let test_output = "(skipped)";
        if (run_after_write) {
          const r = await sandbox.exec(`npx -y vitest run '${finalSpecPath}' 2>&1 | tail -n 120`, cwd, 240);
          test_output = String((r as any).stdout ?? (r as any).result ?? "").slice(-4000);
        }
        return { ok: true, spec_path: finalSpecPath, installed_deps: needsInstall, test_output };
      },
    }),
  };
}
