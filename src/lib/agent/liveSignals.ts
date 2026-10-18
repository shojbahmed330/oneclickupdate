// Lightweight live-signals collector for the preview iframe + this app.
// Captures recent console errors/warnings, failed network requests, and
// the current route/viewport. Snapshot is read once per agent send.
//
// Token-conscious: hard-capped to last N entries, each truncated.

const MAX = 5;
const MAX_LINE = 220;

const consoleErrors: string[] = [];
const networkFailures: string[] = [];

let installed = false;

function push(arr: string[], line: string) {
  if (!line) return;
  arr.push(line.length > MAX_LINE ? line.slice(0, MAX_LINE) + "…" : line);
  if (arr.length > MAX) arr.splice(0, arr.length - MAX);
}

export function installLiveSignals() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origErr = console.error.bind(console);
  console.error = (...args: any[]) => {
    try { push(consoleErrors, args.map((a) => (typeof a === "string" ? a : safe(a))).join(" ")); } catch { /* noop */ }
    origErr(...args);
  };

  window.addEventListener("error", (ev) => {
    push(consoleErrors, `${ev.message} @ ${(ev.filename ?? "").split("/").pop()}:${ev.lineno}`);
  });
  window.addEventListener("unhandledrejection", (ev: any) => {
    const m = ev?.reason?.message ?? String(ev?.reason ?? "unhandled rejection");
    push(consoleErrors, `unhandled: ${m}`);
  });

  // Patch fetch to record failures only (don't double-store success bodies).
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    try {
      const res = await origFetch(...args);
      if (!res.ok) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
        push(networkFailures, `${res.status} ${shortUrl(url)}`);
      }
      return res;
    } catch (e: any) {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      push(networkFailures, `ERR ${shortUrl(url)} — ${e?.message ?? e}`);
      throw e;
    }
  };
}

function safe(o: any): string {
  try { return JSON.stringify(o).slice(0, 200); } catch { return String(o); }
}
function shortUrl(u: string): string {
  try { const x = new URL(u, window.location.href); return x.pathname + (x.search ? "?…" : ""); }
  catch { return u.slice(0, 80); }
}

export function snapshotLiveSignals() {
  if (typeof window === "undefined") return null;
  return {
    route: window.location.pathname + window.location.search + window.location.hash,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    consoleErrors: consoleErrors.slice(),
    networkFailures: networkFailures.slice(),
  };
}
