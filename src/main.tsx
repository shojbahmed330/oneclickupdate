import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./lib/registerSW";
import { initSentry } from "./lib/sentry";

// Boot Sentry in the background — never blocks initial render.
void initSentry();

// ─── Chunk-load recovery ───
// When the published HTML references a JS chunk hash that no longer exists
// (e.g. user has the old page open, we shipped a new build → 404 / wrong MIME),
// the browser throws "Loading chunk failed" / "error loading dynamically
// imported module". We catch that ONCE per session and force a hard reload so
// the user gets the fresh HTML + matching chunk hashes instead of a black screen.
// Track which chunk URLs we've already tried to recover, so a single bad
// chunk can't loop, but a *different* stale chunk later still triggers reload.
const RELOADED_CHUNKS_KEY = "__chunk_reload_urls__";
const isChunkLoadError = (msg: string): boolean =>
  /Loading chunk \d+ failed|error loading dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed|disallowed MIME type/i.test(
    msg,
  );

const extractChunkUrl = (msg: string): string => {
  const m = msg.match(/https?:\/\/[^\s"')]+\.(?:js|mjs|jsx|ts|tsx)/i);
  return m ? m[0] : "__generic__";
};

const tryHardReload = (reason: string) => {
  const url = extractChunkUrl(reason);
  let tried: string[] = [];
  try { tried = JSON.parse(sessionStorage.getItem(RELOADED_CHUNKS_KEY) || "[]"); } catch {}
  if (tried.includes(url)) {
    console.error("[chunk-recovery] Already reloaded for this chunk, giving up.", reason);
    return;
  }
  tried.push(url);
  sessionStorage.setItem(RELOADED_CHUNKS_KEY, JSON.stringify(tried));
  console.warn("[chunk-recovery] Stale chunk detected — hard-reloading.", reason);
  const next = new URL(window.location.href);
  next.searchParams.set("_r", Date.now().toString());
  window.location.replace(next.toString());
};

// Distinguish transient network hiccups (offline blip, CDN edge timeout) from
// truly stale chunks. For the URL-bearing case we ping the chunk first; if it
// 200s we just surface the error to React (which will retry the import on
// the next render). Only a real 404 / wrong-MIME triggers the hard reload.
const handleChunkError = async (reason: string) => {
  const url = extractChunkUrl(reason);
  if (url !== "__generic__" && navigator.onLine) {
    try {
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (r.ok) {
        console.warn("[chunk-recovery] Transient fetch failure, chunk is healthy — skipping reload.", reason);
        return;
      }
    } catch { /* fall through to hard reload */ }
  }
  tryHardReload(reason);
};

window.addEventListener("error", (e) => {
  if (isChunkLoadError(e.message || "")) void handleChunkError(e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = String(e.reason?.message ?? e.reason ?? "");
  if (isChunkLoadError(msg)) void handleChunkError(msg);
});

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker AFTER first paint so it never blocks initial render.
// Internally guards against preview / iframe contexts.
registerServiceWorker();
