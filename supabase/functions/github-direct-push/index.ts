// Direct GitHub push — bypasses the AI agent entirely so the GitHub button
// in the builder header costs ZERO AI tokens.
//
// Body: { projectId: string, message?: string, createIfMissing?: boolean,
//         repoName?: string, repoDescription?: string, private?: boolean }
//
// Behavior:
//   1. Authenticate the caller.
//   2. Look up their GitHub connection + this project's repo link.
//   3. If no link AND createIfMissing → create the repo via GitHub API and store the link.
//   4. Decrypt the user's GitHub token, ensure the project's Daytona sandbox is running,
//      and run the same git init/add/commit/push script as the agent's github_push tool.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, decrypt } from "../_shared/sboauth.ts";
import { wrapSandbox, getSandboxInfo, startSandbox, waitUntilToolboxReady } from "../_shared/daytona.ts";
import { pushFilesViaGithubApi } from "../_shared/githubApiPush.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("github-direct-push", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return json({ ok: false, error: "Auth required" }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ ok: false, error: "Invalid auth" }, 401);
    const userId = u.user.id;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body.projectId ?? "");
    const message = String(body.message ?? "chore: sync from OneClickStudio").slice(0, 300);
    const createIfMissing = body.createIfMissing !== false; // default true
    const rewriteHistory = body.rewriteHistory === true; // manual recovery for polluted first pushes
    const repoName = body.repoName ? String(body.repoName) : undefined;
    const repoDescription = String(body.repoDescription ?? "");
    const isPrivate = body.private !== false; // default true

    if (!projectId) return json({ ok: false, error: "projectId required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Connection check
    const { data: conn } = await admin
      .from("user_github_connections")
      .select("access_token_encrypted, github_username, github_email, revoked")
      .eq("user_id", userId)
      .maybeSingle();
    if (!conn || (conn as any).revoked) {
      return json({ ok: false, error: "GitHub not connected", code: "not_connected" }, 400);
    }
    const username = (conn as any).github_username as string;
    const email = (conn as any).github_email || `${username}@users.noreply.github.com`;
    const token = await decrypt((conn as any).access_token_encrypted);
    if (!token) return json({ ok: false, error: "Could not decrypt token" }, 500);

    // 2) Project ownership + link
    const { data: project } = await admin
      .from("projects")
      .select("id, user_id, name")
      .eq("id", projectId)
      .maybeSingle();
    if (!project || (project as any).user_id !== userId) {
      return json({ ok: false, error: "Project not found or not yours" }, 403);
    }

    let { data: link } = await admin
      .from("project_github_links")
      .select("repo_full_name, default_branch")
      .eq("project_id", projectId)
      .maybeSingle();

    // 3) Create repo if missing
    if (!link) {
      if (!createIfMissing) {
        return json({ ok: false, error: "No repo linked", code: "no_repo" }, 400);
      }
      const baseName = (repoName || (project as any).name || "lovable-project")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 90) || "lovable-project";

      const r = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "oneclickstudio",
        },
        body: JSON.stringify({
          name: baseName,
          description: repoDescription,
          private: isPrivate,
          auto_init: false,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        return json({ ok: false, error: j?.message || `GitHub ${r.status}` }, 400);
      }
      await admin.from("project_github_links").upsert({
        project_id: projectId,
        user_id: userId,
        repo_full_name: j.full_name,
        default_branch: j.default_branch || "main",
        updated_at: new Date().toISOString(),
      }, { onConflict: "project_id" });
      link = { repo_full_name: j.full_name, default_branch: j.default_branch || "main" } as any;
    }

    const repo = (link as any).repo_full_name as string;
    const branch = sanitizeBranch((link as any).default_branch as string);

    // 4) Sandbox-or-API push.
    //    Prefer the existing Daytona sandbox (full git history, faster for big
    //    repos). If no sandbox row exists OR the sandbox cannot start, fall back
    //    to the pure GitHub Git Data API path using project_files from the DB.
    const { data: ws } = await admin
      .from("daytona_workspaces")
      .select("workspace_id")
      .eq("project_id", projectId)
      .maybeSingle();
    const workspaceId = (ws as any)?.workspace_id as string | undefined;

    let useApiFallback = !workspaceId;
    let fallbackReason = workspaceId ? "" : "no_sandbox";

    if (workspaceId) {
      const info = await getSandboxInfo(workspaceId).catch(() => null);
      if (!info) {
        useApiFallback = true;
        fallbackReason = "sandbox_missing";
      }
    }

    if (useApiFallback) {
      const apiRes = await runApiFallback({
        admin, projectId, token, repo, branch,
        username, email, message,
        rewriteHistory,
      });
      if (apiRes) {
        await admin.from("project_github_links")
          .update({ last_push_at: new Date().toISOString() })
          .eq("project_id", projectId);
        return json({
          ...apiRes,
          repo_full_name: repo,
          branch,
          html_url: `https://github.com/${repo}`,
          via: "github_api",
          fallback_reason: fallbackReason,
        });
      }
      // runApiFallback returned null → no project_files snapshot to push from.
      return json({
        ok: false,
        error: "No sandbox and no saved project files to push.",
        code: "no_sandbox_no_files",
      }, 400);
    }

    const wsId = workspaceId!;
    const info = await getSandboxInfo(wsId);
    if (!info) return json({ ok: false, error: "Sandbox not found in Daytona" }, 400);
    const state = (info.state || "").toLowerCase();
    if (state !== "started" && state !== "running") {
      await startSandbox(wsId);
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const s = (await getSandboxInfo(wsId))?.state?.toLowerCase();
        if (s === "started" || s === "running") break;
      }
    }
    await waitUntilToolboxReady(wsId, 45);
    const sandbox = await wrapSandbox(wsId);
    const cwd = "/root/app";
    const ignoredPaths = ["node_modules", "dist", "build", ".next", "out", "coverage", ".turbo", ".cache", ".env", ".env.local", ".env.production", ".env.development", ".supabase/env"];
    const ignoredArgs = ignoredPaths.map(shellQuote).join(" ");
    const remoteUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
    const remoteBranch = `origin/${branch}`;
    const script = `#!/usr/bin/env bash
set -e
cd ${shellQuote(cwd)}
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init -b ${shellQuote(branch)}
git config user.email ${shellQuote(email)}
git config user.name ${shellQuote(username)}
git remote remove origin >/dev/null 2>&1 || true
git remote add origin ${shellQuote(remoteUrl)}
touch .gitignore
for pattern in 'node_modules/' 'dist/' 'build/' '.next/' 'out/' 'coverage/' '.turbo/' '.cache/' '.env' '.env.*' '*.local' '.DS_Store' '.supabase/env'; do
  grep -qxF "$pattern" .gitignore || printf '%s\n' "$pattern" >> .gitignore
done
git rm -r --cached --ignore-unmatch ${ignoredArgs} >/dev/null 2>&1 || true
git fetch origin ${shellQuote(branch)} >/tmp/github-direct-fetch.log 2>&1 || true
tail -n 10 /tmp/github-direct-fetch.log 2>/dev/null || true
if ${rewriteHistory ? "true" : "false"}; then
  echo 'REWRITE_HISTORY'
  git checkout --orphan __oneclickstudio_clean_push__
  git add -A
  git rm -r --cached --ignore-unmatch ${ignoredArgs} >/dev/null 2>&1 || true
  if git diff --cached --quiet; then
    git commit --allow-empty -m ${shellQuote(message)}
  else
    git commit -m ${shellQuote(message)}
  fi
  git branch -D ${shellQuote(branch)} >/dev/null 2>&1 || true
  git branch -m ${shellQuote(branch)}
  git push --force-with-lease -u origin ${shellQuote(branch)}
  git rev-parse HEAD
  exit 0
fi
if git rev-parse --verify ${shellQuote(remoteBranch)} >/dev/null 2>&1; then
  git branch -M ${shellQuote(branch)}
  git reset --soft ${shellQuote(remoteBranch)}
  git add -A
  git rm -r --cached --ignore-unmatch ${ignoredArgs} >/dev/null 2>&1 || true
  if git diff --cached --quiet; then
    echo 'NO_CHANGES'
  else
    git commit -m ${shellQuote(message)}
  fi
  git push -u origin ${shellQuote(branch)}
else
  echo 'NO_REMOTE_BRANCH_YET'
  git checkout --orphan __oneclickstudio_clean_push__
  git add -A
  git rm -r --cached --ignore-unmatch ${ignoredArgs} >/dev/null 2>&1 || true
  if git diff --cached --quiet; then
    git commit --allow-empty -m ${shellQuote(message)}
  else
    git commit -m ${shellQuote(message)}
  fi
  git branch -D ${shellQuote(branch)} >/dev/null 2>&1 || true
  git branch -m ${shellQuote(branch)}
  git push -u origin ${shellQuote(branch)}
fi
git rev-parse HEAD
`;

    await sandbox.writeFile("/tmp/github-direct-push.sh", script);
    const r = await sandbox.exec("bash /tmp/github-direct-push.sh", cwd, 300);
    const out = String((r as any).stdout ?? "").replaceAll(token, "***");
    const sha = (out.trim().split("\n").pop() || "").trim();

    await admin.from("project_github_links")
      .update({ last_push_at: new Date().toISOString() })
      .eq("project_id", projectId);

    const pushSucceeded = /new branch|branch .* set up to track|Everything up-to-date|\bmain -> main\b|\[new branch\]/i.test(out);
    const conflictLeft = !pushSucceeded && /CONFLICT|merge conflict|fix conflicts/i.test(out);
    const rejected = /\[rejected\]|non-fast-forward|pre-receive hook declined/i.test(out);
    const ok = (r as any).exitCode === 0 && !conflictLeft && !rejected && (!out.includes("error:") || pushSucceeded);

    return json({
      ok,
      repo_full_name: repo,
      branch,
      commit_sha: /^[a-f0-9]{40}$/i.test(sha) ? sha : null,
      html_url: `https://github.com/${repo}`,
      conflict: conflictLeft,
      output_tail: out.slice(-1500),
    });
  } catch (e) {
    console.error("[github-direct-push] error", e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
}));

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function sanitizeBranch(value: string) {
  const branch = String(value || "main").replace(/[^A-Za-z0-9._/-]/g, "-").replace(/^[-/.]+|[/.]+$/g, "");
  return branch || "main";
}

async function runApiFallback(args: {
  admin: ReturnType<typeof createClient>;
  projectId: string;
  token: string;
  repo: string;
  branch: string;
  username: string;
  email: string;
  message: string;
  rewriteHistory: boolean;
}): Promise<{ ok: boolean; commit_sha: string | null; output_tail: string; conflict?: boolean; error?: string } | null> {
  const { data: rows, error } = await args.admin
    .from("project_files")
    .select("path, content")
    .eq("project_id", args.projectId)
    .limit(5000);
  if (error || !rows || rows.length === 0) return null;
  const files = (rows as Array<{ path: string; content: string | null }>)
    .filter((r) => typeof r.path === "string" && r.path.length > 0)
    .map((r) => ({ path: r.path, content: String(r.content ?? "") }));
  if (files.length === 0) return null;

  const res = await pushFilesViaGithubApi({
    token: args.token,
    repoFullName: args.repo,
    branch: args.branch,
    authorName: args.username,
    authorEmail: args.email,
    message: args.message,
    files,
    rewriteHistory: args.rewriteHistory,
  });
  return {
    ok: res.ok,
    commit_sha: res.commit_sha,
    output_tail: res.log,
    conflict: res.conflict,
    error: res.error,
  };
}


function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
