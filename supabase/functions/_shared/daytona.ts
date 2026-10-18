// Daytona sandbox adapter — thin wrapper over Daytona REST API.
// Designed so the Sandbox interface stays decoupled from Daytona specifics.

// Preview URLs are wrapped through daytona-preview so the browser can load
// Daytona sandboxes without the first-visit warning page.

const DAYTONA_API_URL = Deno.env.get("DAYTONA_API_URL") || "https://app.daytona.io/api";
// The Daytona toolbox (in-sandbox file/process API) lives on a different host
// than the sandbox management API. Sandbox CRUD = app.daytona.io/api/sandbox/*,
// while files/process/etc. live on proxy.app.daytona.io/toolbox/{id}/*.
// BUG FIX: Ensure trailing slash is stripped so paths like /toolbox/{id}/... are correct.
const DAYTONA_TOOLBOX_URL = normalizeToolboxUrl(
  Deno.env.get("DAYTONA_TOOLBOX_URL") || "https://proxy.app.daytona.io",
);

const DAYTONA_API_KEY = Deno.env.get("DAYTONA_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";

function toPreviewProxyUrl(url: string): string {
  // Return Daytona's signed preview URL as-is.
  //
  // Why not the Supabase `daytona-preview` proxy here:
  // The Supabase edge gateway force-downgrades function HTML responses to
  // `Content-Type: text/plain` + `nosniff`. That breaks "open in new tab"
  // and any direct copy-paste of the URL — the browser shows raw HTML source.
  //
  // The iframe in AgentPreview wraps this URL into the proxy on the client
  // side and uses a `blob:` document with the correct `text/html` type, which
  // bypasses both the Daytona warning page and the gateway content-type
  // override — but only for the iframe path. Direct browser navigation must
  // hit Daytona straight, even if it shows the one-time warning page.
  return url;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PreviewLink {
  url: string;
  token: string;
}

export interface DaytonaSandbox {
  id: string;
  exec(command: string, cwd?: string, timeoutSec?: number): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  deleteFile(path: string): Promise<void>;
  listDir(path: string): Promise<Array<{ name: string; isDir: boolean }>>;
  getPreviewLink(port: number): Promise<PreviewLink>;
  destroy(): Promise<void>;
}

type DaytonaSandboxInfo = { id: string; state: string; toolboxProxyUrl?: string };

function normalizeToolboxUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  // If the management API URL is accidentally configured as the toolbox URL,
  // switch to Daytona's proxy host. `/api/toolbox/...` returns 404.
  return trimmed.replace(/^https:\/\/app\.daytona\.io\/api$/, "https://proxy.app.daytona.io");
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  return apiRaw<T>(`${DAYTONA_API_URL}${path}`, init);
}

async function toolboxApi<T = any>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  return apiRaw<T>(`${baseUrl}${path}`, init);
}

async function apiRaw<T>(url: string, init: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${DAYTONA_API_KEY}`,
    ...((init.headers as Record<string, string>) || {}),
  };
  if (!headers["Content-Type"] && init.body && typeof init.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Daytona API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export async function createSandbox(opts: {
  snapshot?: string;
  language?: "typescript" | "javascript" | "python";
  envVars?: Record<string, string>;
  isPublic?: boolean;
  label?: string;
  autoStopInterval?: number; // minutes of idle before auto-stop (0 = never)
  autoArchiveInterval?: number; // minutes after stop before archive (0 = default)
}): Promise<DaytonaSandbox> {
  const created = await api<{ id: string }>("/sandbox", {
    method: "POST",
    body: JSON.stringify({
      ...(opts.snapshot ? { snapshot: opts.snapshot } : {}),
      ...(opts.snapshot ? {} : { language: opts.language || "typescript" }),
      envVars: opts.envVars || {},
      public: opts.isPublic ?? true,
      labels: opts.label ? { project: opts.label } : undefined,
      autoStopInterval: opts.autoStopInterval ?? 60,
      autoArchiveInterval: opts.autoArchiveInterval ?? 10080, // 7 days
    }),
  });
  // Daytona returns the id immediately; wait for both sandbox state and the
  // toolbox API because /toolbox/{id}/... can still 404 briefly after started.
  await waitUntilStarted(created.id);
  await waitUntilToolboxReady(created.id);
  return await wrapSandbox(created.id);
}

function isNotFoundError(err: unknown): boolean {
  const message = String((err as Error)?.message || err || "");
  return message.includes("Daytona API 404") || message.includes('"statusCode":404');
}

// BUG FIX: Also treat 502/503/504 as transient "not ready" errors worth retrying,
// not just 404. Previously a 503 during startup would immediately throw and crash.
function isTransientError(err: unknown): boolean {
  const message = String((err as Error)?.message || err || "");
  return (
    isNotFoundError(err) ||
    message.includes("Daytona API 502") ||
    message.includes("Daytona API 503") ||
    message.includes("Daytona API 504") ||
    message.includes("fetch failed") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET")
  );
}

export function isToolboxNotReadyError(err: unknown): boolean {
  const message = String((err as Error)?.message || err || "");
  return isTransientError(err) && (message.includes("/toolbox/") || message.includes("/files"));
}

// BUG FIX: Increased maxSeconds from 90 → 150 because cold sandbox boot
// can take over 90s on a busy cluster.
async function waitUntilStarted(id: string, maxSeconds = 150): Promise<void> {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const info = await getSandboxInfo(id);
    const state = (info?.state || "").toLowerCase();
    if (state === "started" || state === "running") return;
    if (state === "error" || state === "failed") {
      throw new Error(`Daytona sandbox ${id} failed to start (state=${state})`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Daytona sandbox ${id} did not become ready within ${maxSeconds}s`);
}

// BUG FIX: Use isTransientError instead of isNotFoundError so 502/503/504
// during toolbox startup are retried rather than immediately thrown.
// BUG FIX: Increased maxSeconds from 90 → 120.
export async function waitUntilToolboxReady(id: string, maxSeconds = 120): Promise<void> {
  const deadline = Date.now() + maxSeconds * 1000;
  let lastError = "toolbox not ready";
  const baseUrl = await getToolboxBaseUrl(id);
  while (Date.now() < deadline) {
    try {
      await toolboxApi(baseUrl, `/files?path=${encodeURIComponent("/root")}`);
      return;
    } catch (err) {
      lastError = String((err as Error)?.message || err);
      // BUG FIX: Was `isNotFoundError` — now also retries on 502/503/504.
      if (!isTransientError(err)) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(
    `Daytona sandbox ${id} toolbox did not become ready within ${maxSeconds}s: ${lastError}`,
  );
}

export async function getSandboxInfo(id: string): Promise<DaytonaSandboxInfo | null> {
  try {
    return await api<DaytonaSandboxInfo>(`/sandbox/${id}`);
  } catch {
    return null;
  }
}

export async function startSandbox(id: string): Promise<void> {
  await api(`/sandbox/${id}/start`, { method: "POST" });
}

export async function stopSandbox(id: string): Promise<void> {
  await api(`/sandbox/${id}/stop`, { method: "POST" });
}

async function getToolboxBaseUrl(id: string): Promise<string> {
  const info = await getSandboxInfo(id);
  const proxy = normalizeToolboxUrl(info?.toolboxProxyUrl || DAYTONA_TOOLBOX_URL);
  return `${proxy}/${id}`;
}

export async function wrapSandbox(id: string): Promise<DaytonaSandbox> {
  const toolboxBaseUrl = await getToolboxBaseUrl(id);
  return {
    id,
    async exec(command, cwd, timeoutSec = 120) {
      const res = await toolboxApi<{
        // BUG FIX: Daytona API may return either `result` or `stdout` depending
        // on version — handle both so exec never silently returns empty string.
        result?: string;
        stdout?: string;
        exitCode?: number;
        exit_code?: number;
      }>(toolboxBaseUrl, `/process/execute`, {
        method: "POST",
        body: JSON.stringify({ command, cwd, timeout: timeoutSec }),
      });
      return {
        stdout: res.stdout ?? res.result ?? "",
        stderr: "",
        exitCode: res.exitCode ?? res.exit_code ?? 0,
      };
    },

    async writeFile(path, content) {
      // Daytona file upload is multipart/form-data with raw `file` field.
      // BUG FIX: path.split("/").pop() returns "" for paths ending in "/".
      // Use a safer filename extraction with a guaranteed non-empty fallback.
      const filename = path.split("/").filter(Boolean).pop() || "file";
      const form = new FormData();
      form.append("file", new Blob([content]), filename);
      await toolboxApi(toolboxBaseUrl, `/files/upload?path=${encodeURIComponent(path)}`, {
        method: "POST",
        body: form,
      });
    },

    async readFile(path) {
      // Returns raw file bytes/text, not JSON.
      const res = await fetch(
        `${toolboxBaseUrl}/files/download?path=${encodeURIComponent(path)}`,
        { headers: { Authorization: `Bearer ${DAYTONA_API_KEY}` } },
      );
      if (res.status === 404) {
        throw new Error(`ENOENT: file not found at ${path}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Daytona API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
      }
      return await res.text();
    },

    async deleteFile(path) {
      try {
        await toolboxApi(toolboxBaseUrl, `/files?path=${encodeURIComponent(path)}`, {
          method: "DELETE",
        });
      } catch (err) {
        // Idempotent delete: missing file is fine.
        if (isNotFoundError(err)) return;
        throw err;
      }
    },

    async listDir(path) {
      // BUG FIX: Daytona may return { files: [...] } instead of a bare array.
      // Handle both shapes so listing never silently returns [].
      // BUG FIX: A non-existent path returns 404 — surface this as an empty
      // listing with `exists:false` instead of throwing, so the agent doesn't
      // spiral into a "Try to fix" loop on a brand-new sandbox where the path
      // (e.g. `src/`) just hasn't been created yet.
      try {
        const res = await toolboxApi<
          Array<{ name: string; isDir: boolean }> | { files: Array<{ name: string; isDir: boolean }> }
        >(toolboxBaseUrl, `/files?path=${encodeURIComponent(path)}`);

        if (Array.isArray(res)) return res;
        if (res && typeof res === "object" && "files" in res && Array.isArray(res.files)) {
          return res.files;
        }
        return [];
      } catch (err) {
        if (isNotFoundError(err)) return [];
        throw err;
      }
    },

    async getPreviewLink(port) {
      // Use Daytona's signed preview URL, then wrap it in our preview proxy.
      // Browser iframes cannot send `X-Daytona-Skip-Preview-Warning`, so the
      // proxy adds that header and rewrites Vite asset paths back through it.
      try {
        const res = await api<{ url: string; token: string }>(
          `/sandbox/${id}/ports/${port}/signed-preview-url?expiresInSeconds=86400`,
        );
        return { url: toPreviewProxyUrl(res.url), token: res.token };
      } catch (err) {
        if (!isNotFoundError(err)) throw err;
        // Fallbacks for older Daytona deployments.
        try {
          const res = await api<{ url: string; token: string }>(
            `/sandbox/${id}/ports/${port}/preview-url`,
          );
          return { url: toPreviewProxyUrl(res.url), token: res.token };
        } catch (err2) {
          if (!isNotFoundError(err2)) throw err2;
          const res = await api<{ url: string; token: string }>(
            `/sandbox/${id}/preview-link/${port}`,
          );
          return { url: toPreviewProxyUrl(res.url), token: res.token };
        }
      }
    },

    async destroy() {
      await api(`/sandbox/${id}`, { method: "DELETE" });
    },
  };
}
