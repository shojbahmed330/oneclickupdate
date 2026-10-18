// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { capDiffText, diffStats } from "../diff.ts";
import { getRunState } from "./_runState.ts";
import { isDevServerCommand, startDevServer } from "./devServer.ts";
import { validateWriteContent } from "./_validateContent.ts";
import { autoValidateAfterEdit } from "./_autoValidate.ts";
import { checkRiskyEdit } from "./_riskyEditGuard.ts";
import { cachedListDir, cachedReadFile, invalidateAll, invalidatePath } from "./_sandboxCache.ts";

export function makeCoreTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    list_dir: tool({
      description:
        "List files & folders at a project-relative path. Returns an empty " +
        "array when the path does not exist (does NOT throw) — treat that as " +
        "“directory not yet created” and proceed (e.g. create files with " +
        "write_file, which auto-creates parent dirs).",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async ({ path }) => {
        const full = `${cwd}/${path}`.replace(/\/+$/, "");
        const entries = await cachedListDir(sandbox, ctx, full);
        return { path, entries, count: entries.length };
      },
    }),
    read_file: tool({
      description: "Read a file from the project.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => ({ content: await cachedReadFile(sandbox, ctx, `${cwd}/${path}`) }),
    }),
    write_file: tool({
      description:
        "Create or overwrite exactly ONE project file with the COMPLETE file body. " +
        "Never call write_file with partial content, chunks, or multiple files at once. " +
        "If you are changing an existing file or recovering from a rejected write, prefer edit_file for a small targeted patch.",
      // `content` is intentionally optional at the schema level — when the
      // model emits write_file with no `content` (truncated tool-call JSON,
      // or the model meant edit_file), Zod would otherwise throw
      // InvalidToolInputError and kill the whole stream ("Error in input
      // stream" in the UI, no Stop button works). By accepting it and
      // rejecting inside execute we keep the loop alive and give the model
      // a readable error to recover from.
      inputSchema: z.object({ path: z.string(), content: z.string().optional() }),
      execute: async ({ path, content }) => {
        const full = `${cwd}/${path}`;
        if (typeof content !== "string") {
          return {
            ok: false,
            path,
            error:
              `write_file called for "${path}" with NO \`content\` field. ` +
              `write_file requires the COMPLETE file body as a string. ` +
              `If you only want to change a small part of an existing file, use edit_file instead. ` +
              `If you want to overwrite the file, call write_file again with the full content.`,
            skipped: true,
          };
        }
        // Refuse to persist obviously truncated code (token-cap mid-stream).
        const v = validateWriteContent(path, content);
        if (!v.ok) {
          return {
            ok: false,
            path,
            error:
              `write_file rejected: ${v.reason}. The file was NOT saved. ` +
              `Do NOT retry the same payload. First read_file("${path}") if it exists, then either use edit_file for a targeted fix or call write_file once with the complete file content.`,
            skipped: true,
          };
        }
        // 🩹 PLATFORM AUTO-FIX: every Vite+Tailwind app needs `@tailwind base/components/utilities`
        // in its main CSS entry, otherwise NO utility class works (flex/grid/bg-*) and the whole
        // UI renders as raw HTML. Models routinely forget this when writing index.css from scratch.
        // Detect the main CSS file and prepend missing directives.
        if (/(?:^|\/)(?:index|globals?|app|main|styles)\.css$/i.test(path)) {
          const hasBase = /@tailwind\s+base/i.test(content);
          const hasComp = /@tailwind\s+components/i.test(content);
          const hasUtil = /@tailwind\s+utilities/i.test(content);
          if (!(hasBase && hasComp && hasUtil)) {
            const directives = [
              !hasBase && "@tailwind base;",
              !hasComp && "@tailwind components;",
              !hasUtil && "@tailwind utilities;",
            ].filter(Boolean).join("\n");
            content = `${directives}\n\n${content}`;
          }
        }
        let before = "";
        try { before = await sandbox.readFile(full); } catch { before = ""; }
        const isNewFile = before === "";
        await sandbox.writeFile(full, content);
        invalidatePath(ctx, full);
        getRunState(ctx).editedFiles.add(path);
        const d = diffStats(before, content);
        const validation = await autoValidateAfterEdit(sandbox, cwd, path, ctx);
        const riskyEdit = await checkRiskyEdit(sandbox, cwd, path, ctx, { isNewFile });
        return {
          ok: true,
          path,
          kind: before ? "modified" : "created",
          additions: d.additions,
          deletions: d.deletions,
          before: capDiffText(before),
          after: capDiffText(content),
          ...(validation ? { validation } : {}),
          ...(riskyEdit ? { riskyEdit } : {}),
        };
      },
    }),
    delete_file: tool({
      description: "Delete a project file.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const full = `${cwd}/${path}`;
        await sandbox.deleteFile(full);
        invalidatePath(ctx, full);
        return { ok: true };
      },
    }),
    run_command: tool({
      description: "Run a shell command in the project root.",
      inputSchema: z.object({ command: z.string(), timeout_sec: z.number().default(120) }),
      execute: async ({ command, timeout_sec }) => {
        if (isDevServerCommand(command)) return startDevServer(sandbox, cwd);
        // run_command can mutate anything → blow the whole read cache.
        invalidateAll(ctx);
        return sandbox.exec(command, cwd, timeout_sec);
      },
    }),
    install_dep: tool({
      description:
        "Install one or more npm packages. Auto-resolves peer-dependency conflicts: " +
        "if the default install fails with ERESOLVE / peer dep error, retries with " +
        "--legacy-peer-deps, then --force. Returns { ok, strategy, output, advice? }.",
      inputSchema: z.object({ packages: z.array(z.string()).min(1), dev: z.boolean().default(false) }),
      execute: async ({ packages, dev }) => {
        const flag = dev ? "-D " : "";
        const pkgs = packages.join(" ");
        const strategies: Array<{ name: string; cmd: string }> = [
          { name: "default",          cmd: `npm install ${flag}${pkgs}` },
          { name: "legacy-peer-deps", cmd: `npm install --legacy-peer-deps ${flag}${pkgs}` },
          { name: "force",            cmd: `npm install --force ${flag}${pkgs}` },
        ];
        const attempts: Array<{ strategy: string; ok: boolean; tail: string }> = [];
        for (const s of strategies) {
          const r: any = await sandbox.exec(`${s.cmd} 2>&1 | tail -n 40`, cwd, 300);
          const out = String(r.stdout ?? r.result ?? "");
          const exitCode = Number(r.exitCode ?? r.exit_code ?? 0);
          // npm prints "ERESOLVE" or "peer dep" on conflict; non-zero exit = real failure.
          const conflict = /ERESOLVE|peer dep|peerDependencies|conflicting peer/i.test(out);
          const ok = exitCode === 0 && !/npm error|npm ERR!/i.test(out);
          attempts.push({ strategy: s.name, ok, tail: out.slice(-800) });
          if (ok) {
            return {
              ok: true,
              strategy: s.name,
              output: out,
              ...(s.name !== "default" ? { advice: `Resolved peer-dep conflict using --${s.name}. Verify the app still builds (run heal/build_app) — peer-dep mismatches can cause subtle runtime bugs.` } : {}),
            };
          }
          // Only escalate to next strategy if this looks like a peer-dep conflict.
          if (!conflict) break;
        }
        return {
          ok: false,
          strategy: attempts[attempts.length - 1].strategy,
          attempts,
          advice:
            "All install strategies failed. Read the last attempt's output for the conflict, then either " +
            "(a) install a compatible version explicitly (e.g. install_dep ['pkg@^X.Y']), " +
            "(b) bump/downgrade the conflicting peer, or " +
            "(c) ask the user how to proceed if framework-level conflict.",
        };
      },
    }),
    start_dev_server: tool({
      description: "Start `npm run dev` in the background on port 5173.",
      inputSchema: z.object({}),
      execute: async () => startDevServer(sandbox, cwd),
    }),
    get_preview_url: tool({
      description: "Get the public preview URL for the running dev server.",
      inputSchema: z.object({ port: z.number().default(5173) }),
      execute: async ({ port }) => sandbox.getPreviewLink(port),
    }),
  };
}
