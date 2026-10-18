// Pure GitHub Git Data API push — no sandbox required.
// Reads project files from the project_files table and writes a single commit
// to the target branch using blobs + tree + commit + ref endpoints.
//
// Designed as a fallback for github-direct-push when no Daytona sandbox exists
// or the sandbox failed to start. Suitable for small/medium repos (every file
// becomes one HTTP blob upload, so very large projects are slower).

const GH_API = "https://api.github.com";
const IGNORED_PREFIXES = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  "out/",
  "coverage/",
  ".turbo/",
  ".cache/",
  ".supabase/env",
];
const IGNORED_EXACT = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".DS_Store",
]);

const DEFAULT_GITIGNORE = `node_modules/
dist/
build/
.next/
out/
coverage/
.turbo/
.cache/
.env
.env.*
*.local
.DS_Store
.supabase/env
`;

type ProjectFile = { path: string; content: string };

function shouldSkip(path: string): boolean {
  if (IGNORED_EXACT.has(path)) return true;
  for (const p of IGNORED_PREFIXES) if (path.startsWith(p)) return true;
  if (/(^|\/)\.env(\.|$)/.test(path)) return true;
  if (/\.local$/.test(path)) return true;
  return false;
}

function uaHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "oneclickstudio",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function gh<T = any>(token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const r = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: { ...uaHeaders(token), ...(init?.headers as Record<string, string> | undefined) },
  });
  let data: any = null;
  try { data = await r.json(); } catch { /* empty body OK */ }
  return { ok: r.ok, status: r.status, data };
}

/**
 * Push all project files as a single commit on `branch`.
 * Returns commit SHA + a short log line for the UI.
 */
export async function pushFilesViaGithubApi(opts: {
  token: string;
  repoFullName: string;     // e.g. "user/repo"
  branch: string;           // e.g. "main"
  authorName: string;
  authorEmail: string;
  message: string;
  files: ProjectFile[];
  rewriteHistory?: boolean; // ignored by API path (single commit always)
}): Promise<{ ok: boolean; commit_sha: string | null; log: string; conflict?: boolean; error?: string }> {
  const { token, repoFullName, branch, authorName, authorEmail, message } = opts;

  // Filter + ensure .gitignore exists.
  const filtered = opts.files.filter((f) => !shouldSkip(f.path));
  if (!filtered.some((f) => f.path === ".gitignore")) {
    filtered.push({ path: ".gitignore", content: DEFAULT_GITIGNORE });
  }
  if (filtered.length === 0) {
    return { ok: false, commit_sha: null, log: "no files to push", error: "empty project" };
  }

  // 1. Resolve current branch ref (may not exist on first push).
  const refPath = `/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(branch)}`;
  const refRes = await gh<{ object?: { sha: string } }>(token, refPath);
  let parentCommitSha: string | null = null;
  let baseTreeSha: string | null = null;
  if (refRes.ok && refRes.data?.object?.sha) {
    parentCommitSha = refRes.data.object.sha;
    const commitRes = await gh<{ tree?: { sha: string } }>(
      token,
      `/repos/${repoFullName}/git/commits/${parentCommitSha}`,
    );
    if (commitRes.ok && commitRes.data?.tree?.sha) baseTreeSha = commitRes.data.tree.sha;
  } else if (refRes.status !== 404 && refRes.status !== 409) {
    return {
      ok: false,
      commit_sha: null,
      log: `ref lookup failed (${refRes.status})`,
      error: `GitHub ${refRes.status}`,
    };
  }

  // 2. Upload each file as a blob (base64-encoded so binary-ish content survives).
  //    Limit concurrency so we don't hammer the GitHub API.
  const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
  const concurrency = 6;
  let cursor = 0;
  let firstError: string | null = null;

  async function worker() {
    while (cursor < filtered.length && !firstError) {
      const idx = cursor++;
      const f = filtered[idx];
      const contentB64 = base64Encode(f.content);
      const blobRes = await gh<{ sha: string }>(token, `/repos/${repoFullName}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: contentB64, encoding: "base64" }),
      });
      if (!blobRes.ok || !blobRes.data?.sha) {
        firstError = `blob upload failed for ${f.path} (${blobRes.status})`;
        return;
      }
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blobRes.data.sha });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, filtered.length) }, worker));
  if (firstError) return { ok: false, commit_sha: null, log: firstError, error: firstError };

  // 3. Create a tree.
  //    When base_tree is null, GitHub creates a fresh tree (used on first push).
  const treeBody: Record<string, unknown> = { tree };
  if (baseTreeSha) treeBody.base_tree = baseTreeSha;
  const treeRes = await gh<{ sha: string }>(token, `/repos/${repoFullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify(treeBody),
  });
  if (!treeRes.ok || !treeRes.data?.sha) {
    return {
      ok: false,
      commit_sha: null,
      log: `tree creation failed (${treeRes.status})`,
      error: (treeRes.data as any)?.message || `GitHub ${treeRes.status}`,
    };
  }

  // 4. Create a commit.
  const commitBody: Record<string, unknown> = {
    message,
    tree: treeRes.data.sha,
    author: { name: authorName, email: authorEmail },
  };
  if (parentCommitSha) commitBody.parents = [parentCommitSha];
  const commitRes = await gh<{ sha: string }>(token, `/repos/${repoFullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify(commitBody),
  });
  if (!commitRes.ok || !commitRes.data?.sha) {
    return {
      ok: false,
      commit_sha: null,
      log: `commit creation failed (${commitRes.status})`,
      error: (commitRes.data as any)?.message || `GitHub ${commitRes.status}`,
    };
  }

  // 5. Update or create the branch ref.
  const newSha = commitRes.data.sha;
  if (parentCommitSha) {
    const upd = await gh(token, refPath, {
      method: "PATCH",
      body: JSON.stringify({ sha: newSha, force: false }),
    });
    if (!upd.ok) {
      // Non-fast-forward: caller needs to rebase. We do NOT force here.
      const conflict = upd.status === 422;
      return {
        ok: false,
        commit_sha: newSha,
        log: `ref update rejected (${upd.status})`,
        conflict,
        error: (upd.data as any)?.message || `GitHub ${upd.status}`,
      };
    }
  } else {
    const cre = await gh(token, `/repos/${repoFullName}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newSha }),
    });
    if (!cre.ok) {
      return {
        ok: false,
        commit_sha: newSha,
        log: `ref create failed (${cre.status})`,
        error: (cre.data as any)?.message || `GitHub ${cre.status}`,
      };
    }
  }

  return {
    ok: true,
    commit_sha: newSha,
    log: `Pushed ${filtered.length} files via API → ${newSha.slice(0, 7)}`,
  };
}

function base64Encode(str: string): string {
  // UTF-8 safe base64 in Deno.
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
