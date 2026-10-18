import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PICKER_RUNTIME_JS } from "../_shared/pickerRuntime.ts";
import { withSentry } from "../_shared/sentry.ts";

const DAYTONA_API_URL = Deno.env.get("DAYTONA_API_URL") || "https://app.daytona.io/api";
const DAYTONA_API_KEY = Deno.env.get("DAYTONA_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// ============================================================================
// Helpers
// ============================================================================

function decodeBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

function isDaytonaPreviewHost(hostname: string): boolean {
  return (
    /(^|\.)daytona\.work$/i.test(hostname) ||
    /(^|\.)daytonaproxy\d*\.net$/i.test(hostname) ||
    /(^|\.)daytona\.app$/i.test(hostname) ||
    /(^|\.)daytonaapp\.io$/i.test(hostname) ||
    /^\d+-[0-9a-z-]{8,}\./i.test(hostname)
  );
}

function isSafePreviewTarget(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && isDaytonaPreviewHost(url.hostname);
  } catch {
    return false;
  }
}

function normalizeTarget(value: string): URL | null {
  if (!isSafePreviewTarget(value)) return null;
  const url = new URL(value);
  url.protocol = "https:";
  return url;
}

async function resolveSandboxId(prefix: string): Promise<string | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data } = await admin
    .from("daytona_workspaces")
    .select("workspace_id")
    .ilike("workspace_id", `${prefix}%`)
    .limit(1)
    .maybeSingle();
  return (data?.workspace_id as string | undefined) ?? null;
}

async function getFreshSignedUrl(value: string): Promise<string | null> {
  if (!DAYTONA_API_KEY) return null;
  const match = value.match(/^https?:\/\/(?<port>\d+)-(?<id>[a-z0-9-]{8,64})(?:\.|$)/i);
  const port = match?.groups?.port;
  let id = match?.groups?.id;
  if (!port || !id) return null;
  if (id.length < 36) id = (await resolveSandboxId(id)) ?? id;

  const res = await fetch(
    `${DAYTONA_API_URL}/sandbox/${id}/ports/${port}/signed-preview-url?expiresInSeconds=86400`,
    { headers: { Authorization: `Bearer ${DAYTONA_API_KEY}` } },
  );
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { url?: string } | null;
  return json?.url ?? null;
}

// ============================================================================
// Entry
// ============================================================================

Deno.serve(withSentry("daytona-preview", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestUrl = new URL(req.url);
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const functionIndex = parts.lastIndexOf("daytona-preview");
  const encodedIndex = functionIndex >= 0 ? functionIndex + 1 : parts.length - 1;
  const encodedTarget = parts[encodedIndex] || "";
  const proxiedPath = parts.slice(encodedIndex + 1).join("/");
  const decodedTarget = decodeBase64Url(encodedTarget);

  if (!decodedTarget) return expiredResponse();

  const target = normalizeTarget(decodedTarget);
  const freshUrl = await getFreshSignedUrl(decodedTarget).catch(() => null);
  const upstreamBase = freshUrl ? new URL(freshUrl) : target;
  if (!upstreamBase) return expiredResponse();

  // WebSocket upgrade (Vite HMR)
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return proxyWebSocket(req, upstreamBase, proxiedPath, requestUrl);
  }

  return proxyHttp(req, upstreamBase, requestUrl, encodedTarget, proxiedPath);
}));

function expiredResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "preview_link_expired",
      message: "This preview link is from an older build. Ask the agent to run the app again to generate a fresh preview URL.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================================================
// HTTP proxy
// ============================================================================

async function proxyHttp(
  req: Request,
  upstreamBase: URL,
  requestUrl: URL,
  encodedTarget: string,
  proxiedPath: string,
): Promise<Response> {
  const target = new URL(upstreamBase.toString());
  // Daytona's signed preview host can return 404 for `/` while the Vite app is
  // available at `/index.html`. The builder preview always requests the proxy
  // root first, so serve the SPA entry explicitly for that root request.
  target.pathname = proxiedPath ? `/${proxiedPath}` : "/index.html";
  target.search = "";
  if (requestUrl.search) {
    const params = new URLSearchParams(requestUrl.search);
    params.forEach((value, key) => target.searchParams.append(key, value));
  }
  target.protocol = "https:";

  // Retry transient upstream failures (502/503/504 + network errors). Daytona's
  // signed-preview proxy frequently returns 502 in the first few seconds after
  // a sandbox resumes — before Vite is fully bound to :5173. Backoff: 0.6s/1.5s/3s.
  const isIdempotent = req.method === "GET" || req.method === "HEAD";
  const delays = isIdempotent ? [600, 1500, 3000] : [];
  let upstream: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers: proxyRequestHeaders(req.headers),
        body: isIdempotent ? undefined : req.body,
        redirect: "manual",
      });
      if (!isIdempotent) break;
      if (upstream.status !== 502 && upstream.status !== 503 && upstream.status !== 504) break;
      if (attempt === delays.length) break;
      try { await upstream.body?.cancel(); } catch { /* ignore */ }
    } catch (err) {
      lastErr = err;
      if (attempt === delays.length) break;
    }
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
  if (!upstream) {
    return new Response(
      JSON.stringify({ error: "upstream_unreachable", message: String(lastErr ?? "fetch failed") }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const location = upstream.headers.get("location");
    if (location) {
      const next = new URL(location, target);
      if (isSafePreviewTarget(next.href)) {
        return proxyHttp(req, next, requestUrl, encodedTarget, "");
      }
    }
  }

  const headers = new Headers(upstream.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  for (const h of [
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
  ]) headers.delete(h);

  const contentType = headers.get("content-type") || "";
  const proxyBase = `${requestUrl.origin.replace(/^http:/i, "https:")}/functions/v1/daytona-preview/${encodedTarget}`;

  if (isRewritableContent(contentType)) {
    let body = await upstream.text();
    if (/text\/html/i.test(contentType)) {
      body = rewriteHtml(body, proxyBase);
    } else if (/css/i.test(contentType)) {
      body = rewriteCss(body, proxyBase);
    } else {
      body = rewriteJs(body, proxyBase);
    }
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("content-type", normalizedContentType(contentType));
    return new Response(body, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

function proxyRequestHeaders(headers: Headers): Headers {
  const next = new Headers();
  for (const key of ["accept", "accept-language", "content-type", "user-agent", "cookie", "if-none-match", "if-modified-since"]) {
    const value = headers.get(key);
    if (value) next.set(key, value);
  }
  next.set("X-Daytona-Skip-Preview-Warning", "true");
  return next;
}

function isRewritableContent(contentType: string): boolean {
  return /text\/html|text\/css|application\/javascript|text\/javascript|application\/json/i.test(contentType);
}

function normalizedContentType(contentType: string): string {
  if (/text\/html/i.test(contentType)) return "text/html; charset=utf-8";
  if (/text\/css/i.test(contentType)) return "text/css; charset=utf-8";
  if (/javascript/i.test(contentType)) return "application/javascript; charset=utf-8";
  if (/json/i.test(contentType)) return "application/json; charset=utf-8";
  return contentType || "text/plain; charset=utf-8";
}

// ============================================================================
// WebSocket proxy (Vite HMR)
// ============================================================================

function proxyWebSocket(req: Request, upstreamBase: URL, proxiedPath: string, requestUrl: URL): Response {
  const targetUrl = new URL(upstreamBase.toString());
  targetUrl.protocol = "wss:";
  targetUrl.pathname = proxiedPath ? `/${proxiedPath}` : "/";
  targetUrl.search = requestUrl.search;

  let clientSocket: WebSocket;
  let response: Response;
  try {
    const upgrade = Deno.upgradeWebSocket(req);
    clientSocket = upgrade.socket;
    response = upgrade.response;
  } catch {
    return new Response("WebSocket upgrade failed", { status: 400, headers: corsHeaders });
  }

  const upstreamSocket = new WebSocket(targetUrl.toString(), ["vite-hmr"]);

  const clientQueue: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];
  const upstreamQueue: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

  clientSocket.onmessage = (ev) => {
    if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(ev.data);
    else upstreamQueue.push(ev.data);
  };
  upstreamSocket.onmessage = (ev) => {
    if (clientSocket.readyState === WebSocket.OPEN) clientSocket.send(ev.data);
    else clientQueue.push(ev.data);
  };

  clientSocket.onopen = () => {
    for (const m of clientQueue.splice(0)) clientSocket.send(m);
  };
  upstreamSocket.onopen = () => {
    for (const m of upstreamQueue.splice(0)) upstreamSocket.send(m);
  };

  const close = () => {
    try { clientSocket.close(); } catch { /* ignore */ }
    try { upstreamSocket.close(); } catch { /* ignore */ }
  };
  clientSocket.onclose = close;
  upstreamSocket.onclose = close;
  clientSocket.onerror = close;
  upstreamSocket.onerror = close;

  return response;
}

// ============================================================================
// Rewriting
// ============================================================================

function rewriteCommon(source: string, base: string): string {
  // 1. Raw Daytona origins
  source = source.replace(/https?:\/\/\d+-[a-z0-9-]{8,}[^"'`\s<>]*/gi, (url) => {
    try {
      const parsed = new URL(url);
      if (isDaytonaPreviewHost(parsed.hostname)) {
        return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
      return url;
    } catch {
      return url;
    }
  });

  // 2. Already-proxied Supabase URLs (any encoded segment) → re-root onto current base
  source = source.replace(
    /https?:\/\/[^"'`\s<>]*\/functions\/v1\/daytona-preview\/[^"'`\s<>]*/gi,
    (url) => {
      try {
        const parsed = new URL(url);
        const match = parsed.pathname.match(/\/functions\/v1\/daytona-preview\/[^/]+(\/.*)?$/);
        const subPath = match?.[1] ?? "/";
        return `${base}${subPath}${parsed.search}${parsed.hash}`;
      } catch {
        return url;
      }
    },
  );

  return source;
}

function rewriteHtml(source: string, base: string): string {
  source = rewriteCommon(source, base);

  // Rewrite root-absolute attribute paths
  source = source.replace(/\b(src|href|action|poster|data-src)=(['"])\/(?!\/)/g, `$1=$2${base}/`);

  // Rewrite srcset entries
  source = source.replace(/\bsrcset=(['"])([^'"]+)\1/gi, (_m, q, val) => {
    const rewritten = val
      .split(",")
      .map((part: string) => {
        const trimmed = part.trim();
        const space = trimmed.indexOf(" ");
        const url = space === -1 ? trimmed : trimmed.slice(0, space);
        const desc = space === -1 ? "" : trimmed.slice(space);
        if (url.startsWith("/") && !url.startsWith("//")) return `${base}${url}${desc}`;
        return part;
      })
      .join(",");
    return `srcset=${q}${rewritten}${q}`;
  });

  // Rewrite inline url(/...) in <style>
  source = source.replace(/url\(\s*(['"]?)\/(?!\/)/g, `url($1${base}/`);

  // Rewrite root-absolute paths inside inline module scripts such as
  // Vite's injected React refresh import: import ... from "/@react-refresh".
  source = rewriteJs(source, base);

  // Inject runtime patch + picker runtime as the very first children of <head>.
  // Inlining the picker runtime guarantees it loads regardless of whether the
  // generated app's index.html has the <script src="/oneclickstudio-picker.js"> tag
  // (older sandboxes / user-deleted index.html / path-rewrite races).
  const patch = runtimePatchScript(base);
  const picker = `<script>${PICKER_RUNTIME_JS}</script>`;
  if (/<head[^>]*>/i.test(source)) {
    source = source.replace(/<head([^>]*)>/i, `<head$1>${patch}${picker}`);
  } else {
    source = patch + picker + source;
  }

  return source;
}

function rewriteCss(source: string, base: string): string {
  source = rewriteCommon(source, base);
  source = source.replace(/url\(\s*(['"]?)\/(?!\/)/g, `url($1${base}/`);
  source = source.replace(/@import\s+(['"])\/(?!\/)/g, `@import $1${base}/`);
  return source;
}

function rewriteJs(source: string, base: string): string {
  source = rewriteCommon(source, base);

  // Bare string literals that look like root-absolute Vite paths.
  // We're intentionally narrow to avoid corrupting unrelated string content.
  source = source.replace(
    /(['"`])\/((?:@vite|@react-refresh|@fs|@id|src|node_modules|assets|vite|favicon|manifest|placeholder|public)[^'"`\s)]*)\1/g,
    (_m, q, path) => `${q}${base}/${path}${q}`,
  );

  return source;
}

// ============================================================================
// Runtime patch script — injected into every served HTML document.
// Rewrites root-absolute URLs at runtime for fetch, XHR, WebSocket, and
// pre-resolves Image/script/link.href setters. This catches code paths the
// server-side regex misses (e.g., Vite-generated dynamic imports / HMR WS).
// ============================================================================
function runtimePatchScript(base: string): string {
  return `<script>(function(){
try{
  var BASE=${JSON.stringify(base)};
  var PROXY_ORIGIN=(function(){try{return new URL(BASE).origin;}catch(e){return location.origin;}})();
  var ORIGIN=location.origin;
  var BASE_PATH=(function(){try{return new URL(BASE).pathname.replace(/\\/$/,"");}catch(e){return "";}})();
  function rewrite(u){
    if(typeof u!=="string") return u;
    if(u.indexOf("/")===0 && u.indexOf("//")!==0){
      if(u.indexOf("/functions/v1/daytona-preview/")===0) return u;
      return BASE+u;
    }
    if(u.indexOf(ORIGIN+"/")===0){
      var rest=u.slice(ORIGIN.length);
      if(rest.indexOf("/functions/v1/daytona-preview/")===0) return u;
      return BASE+rest;
    }
    return u;
  }
  // fetch
  var _fetch=window.fetch;
  window.fetch=function(input,init){
    try{
      if(typeof input==="string") input=rewrite(input);
      else if(input && input.url) input=new Request(rewrite(input.url),input);
    }catch(e){}
    return _fetch.call(this,input,init);
  };
  // XHR
  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    try{ u=rewrite(u); }catch(e){}
    return _open.apply(this,[m,u].concat([].slice.call(arguments,2)));
  };
  // WebSocket — Vite HMR opens ws://host/?token=... ; rewrite to proxy host
  var _WS=window.WebSocket;
  function PatchedWS(url,protocols){
    try{
      if(typeof url==="string"){
        var u=new URL(url, location.href);
        // If host is current origin (after our HTML loads from supabase.co),
        // route the WS to the proxy preview path so the edge function can
        // forward to upstream Vite over wss.
        if((u.host===location.host || location.protocol==="about:") && u.pathname.indexOf("/functions/v1/daytona-preview/")!==0){
          var wsProto = u.protocol==="wss:"?"wss:":"ws:";
          var path = u.pathname==="/"?"":u.pathname;
          url = wsProto+"//"+new URL(PROXY_ORIGIN).host+BASE_PATH+path+u.search;
        }
      }
    }catch(e){}
    return protocols?new _WS(url,protocols):new _WS(url);
  }
  PatchedWS.prototype=_WS.prototype;
  PatchedWS.CONNECTING=_WS.CONNECTING;PatchedWS.OPEN=_WS.OPEN;PatchedWS.CLOSING=_WS.CLOSING;PatchedWS.CLOSED=_WS.CLOSED;
  window.WebSocket=PatchedWS;
}catch(e){ console.error("[preview-proxy patch]",e); }
})();</script>`;
}
