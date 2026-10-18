// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import { SUPABASE_URL, type ToolCtx } from "../shared.ts";

export function makeGithubTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    github_status: tool({
      description:
        "Check if the user has connected GitHub and whether THIS project is linked to a repo. " +
        "Returns { connected, github_username?, linked, repo_full_name?, default_branch? }. " +
        "Call BEFORE any github_* operation.",
      inputSchema: z.object({}).optional(),
      execute: async () => {
        const { data: conn } = await ctx.supabase
          .from("user_github_connections")
          .select("github_username, scopes, revoked")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        const connected = !!conn && !(conn as any).revoked;
        const { data: link } = await ctx.supabase
          .from("project_github_links")
          .select("repo_full_name, default_branch, last_push_at")
          .eq("project_id", ctx.projectId)
          .maybeSingle();
        return {
          connected,
          github_username: (conn as any)?.github_username ?? null,
          scopes: (conn as any)?.scopes ?? [],
          linked: !!link,
          repo_full_name: (link as any)?.repo_full_name ?? null,
          default_branch: (link as any)?.default_branch ?? "main",
          last_push_at: (link as any)?.last_push_at ?? null,
          hint: connected ? null : "Tell the user to click 'Connect GitHub' in the builder header. They must complete OAuth before you can push.",
        };
      },
    }),
    github_init_repo: tool({
      description:
        "Create a NEW GitHub repo under the connected user's account and link it to this project. " +
        "Use only when github_status returns linked:false. After this, the agent can call github_push.",
      inputSchema: z.object({
        name: z.string().min(1).max(100).describe("Repo name (no spaces). Will be slugified."),
        description: z.string().max(350).default(""),
        private: z.boolean().default(true),
      }),
      execute: async ({ name, description, private: isPrivate }) => {
        const { data: conn } = await ctx.supabase
          .from("user_github_connections")
          .select("access_token_encrypted, github_username, revoked")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (!conn || (conn as any).revoked) return { ok: false, error: "GitHub not connected" };

        const decryptResp = await fetch(`${SUPABASE_URL}/functions/v1/github-helper-decrypt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.userToken}` },
          body: JSON.stringify({ op: "decrypt_my_token" }),
        });
        const { token } = await decryptResp.json().catch(() => ({}));
        if (!token) return { ok: false, error: "Could not load token (decrypt failed)" };

        const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
        const r = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "lovable-bd" },
          body: JSON.stringify({ name: slug, description, private: isPrivate, auto_init: false }),
        });
        const j = await r.json();
        if (!r.ok) return { ok: false, error: j?.message || `GitHub ${r.status}` };

        await ctx.supabase.from("project_github_links").upsert({
          project_id: ctx.projectId,
          user_id: ctx.userId,
          repo_full_name: j.full_name,
          default_branch: j.default_branch || "main",
          updated_at: new Date().toISOString(),
        }, { onConflict: "project_id" });

        return { ok: true, repo_full_name: j.full_name, html_url: j.html_url, clone_url: j.clone_url };
      },
    }),
    github_push: tool({
      description:
        "Commit ALL current sandbox changes and push to the linked GitHub repo. " +
        "Initializes git if needed, configures user.email/name from the GitHub account, sets remote with the connected token, " +
        "creates a commit with the given message, and pushes to default_branch. " +
        "Returns { ok, commit_sha?, repo_full_name? }. Always call github_status first.",
      inputSchema: z.object({
        message: z.string().min(1).max(300).describe("Commit message — concise, present-tense, e.g. 'feat: add login screen'."),
      }),
      execute: async ({ message }) => {
        const { data: conn } = await ctx.supabase
          .from("user_github_connections")
          .select("access_token_encrypted, github_username, github_email, revoked")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (!conn || (conn as any).revoked) return { ok: false, error: "GitHub not connected" };
        const { data: link } = await ctx.supabase
          .from("project_github_links")
          .select("repo_full_name, default_branch")
          .eq("project_id", ctx.projectId)
          .maybeSingle();
        if (!link) return { ok: false, error: "No repo linked. Call github_init_repo first." };

        const decryptResp = await fetch(`${SUPABASE_URL}/functions/v1/github-helper-decrypt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.userToken}` },
          body: JSON.stringify({ op: "decrypt_my_token" }),
        });
        const { token } = await decryptResp.json().catch(() => ({}));
        if (!token) return { ok: false, error: "Could not load token" };

        const repo = (link as any).repo_full_name as string;
        const branch = (link as any).default_branch as string;
        const username = (conn as any).github_username as string;
        const email = (conn as any).github_email || `${username}@users.noreply.github.com`;
        const safeMsg = message.replace(/'/g, "'\\''");

        const script = [
          `cd ${cwd}`,
          `git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init -b ${branch}`,
          `git config user.email '${email}'`,
          `git config user.name '${username}'`,
          `git config pull.rebase true`,
          `git config rebase.autoStash true`,
          `git remote remove origin 2>/dev/null || true`,
          `git remote add origin https://x-access-token:${token}@github.com/${repo}.git`,
          `printf 'node_modules/\\ndist/\\n.env\\n.env.local\\n' > .gitignore`,
          `git add -A`,
          `git commit -m '${safeMsg}' || echo 'NO_CHANGES'`,
          `git branch -M ${branch}`,
          // Try fetch+rebase to absorb remote changes; ignore failure for first push.
          `git fetch origin ${branch} 2>&1 | tail -n 5 || true`,
          `git rev-parse --verify origin/${branch} >/dev/null 2>&1 && git rebase origin/${branch} 2>&1 | tail -n 20 || echo 'NO_REMOTE_BRANCH_YET'`,
          // If rebase left conflicts, abort and fall back to merge -X theirs (prefer local edits).
          `if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then git rebase --abort 2>/dev/null; git pull --no-rebase -X theirs origin ${branch} --no-edit 2>&1 | tail -n 10 || true; fi`,
          `git push -u origin ${branch} 2>&1`,
          `git rev-parse HEAD`,
        ].join(" && ");

        try {
          const r = await sandbox.exec(`bash -lc "${script.replace(/"/g, '\\"')}"`, cwd, 300);
          const out = String((r as any).stdout ?? (r as any).result ?? "");
          const sha = (out.trim().split("\n").pop() || "").trim();
          await ctx.supabase.from("project_github_links")
            .update({ last_push_at: new Date().toISOString() })
            .eq("project_id", ctx.projectId);
          const conflictLeft = /CONFLICT|merge conflict|fix conflicts/i.test(out);
          const rejected = /\[rejected\]|non-fast-forward/i.test(out);
          return {
            ok: !conflictLeft && !rejected && !out.includes("error:"),
            repo_full_name: repo,
            branch,
            commit_sha: /^[a-f0-9]{40}$/i.test(sha) ? sha : null,
            conflict_resolution: conflictLeft ? "manual_required" : (out.includes("NO_REMOTE_BRANCH_YET") ? "first_push" : "auto_rebased_or_merged"),
            output_tail: out.slice(-1200),
            hint: conflictLeft
              ? "Merge conflict couldn't be auto-resolved. Tell the user to pull locally, resolve conflicts, then push, or run github_push again with a different commit message."
              : null,
          };
        } catch (e) {
          return { ok: false, error: String((e as Error).message ?? e) };
        }
      },
    }),
  };
}
