import { useEffect, useRef, useState } from "react";
import { Eye, MousePointerClick, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useElementPicker } from "@/hooks/useElementPicker";
import { DeviceFrame, DeviceToggle, type DeviceMode } from "./DeviceFrame";
import { CheckpointPanel } from "./CheckpointPanel";
import { MobilePreviewQR } from "./MobilePreviewQR";

interface Props {
  messages: any[];
  fallbackUrl?: string | null;
  projectId?: string;
}

/**
 * Pulls the latest preview URL from tool outputs ONLY.
 * We deliberately DO NOT scan assistant message text — old chats reference
 * dead sandbox URLs that no longer resolve (the sandbox ID changes when
 * Daytona recreates the workspace), which would override the live
 * `fallbackUrl` from the keep-alive ping and show "Server Not Found".
 */
function findPreviewUrl(messages: any[]): string | null {
  const extractUrl = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const match = value.match(/https?:\/\/[^\s)\]"'<>]+/);
    return match?.[0] ?? null;
  };

  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j];
      if (
        (p?.type === "tool-get_preview_url" ||
          p?.type === "tool-start_dev_server" ||
          p?.type === "tool-restart_dev_server" ||
          p?.type === "tool-run_command") &&
        p.state === "output-available"
      ) {
        const out = p.output;
        if (typeof out === "string") return extractUrl(out);
        if (out?.url) return out.url as string;
        if (out?.preview?.url) return out.preview.url as string;
      }
    }
  }
  return null;
}

function isPreviewProxyUrl(value: string): boolean {
  try {
    return new URL(value).pathname.includes("/functions/v1/daytona-preview/");
  } catch {
    return false;
  }
}

/**
 * Wrap a raw Daytona signed-preview URL through our `daytona-preview` edge
 * function so the iframe can load it without hitting Daytona's cross-site
 * "Preview URL Warning" interstitial. The proxy adds the server-only
 * `X-Daytona-Skip-Preview-Warning` header that browsers cannot send.
 *
 * Only used for the iframe — the chat-visible "open in new tab" link still
 * uses the direct Daytona URL, because Supabase's edge gateway force-downgrades
 * function HTML responses to `text/plain` (which would render as raw source
 * in a top-level browser tab).
 */
function toIframeProxyUrl(rawUrl: string): string {
  if (isPreviewProxyUrl(rawUrl)) return rawUrl;
  try {
    const host = new URL(rawUrl).hostname;
    const isDaytona =
      /(\.daytonaproxy\d*\.net|\.daytona\.work|\.daytona\.app|\.daytonaapp\.io)$/i.test(host) ||
      /^\d+-[0-9a-z-]{8,}\./i.test(host);
    if (!isDaytona) return rawUrl;
    const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
    if (!supabaseUrl) return rawUrl;
    const b64 = btoa(rawUrl).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/daytona-preview/${b64}`;
  } catch {
    return rawUrl;
  }
}

function withPreviewBase(_html: string, _url: string): string {
  // Deprecated: edge function `daytona-preview` already handles all rewrites
  // and injects a runtime patch. Kept as a no-op for backwards compatibility.
  return _html;
}

export const AgentPreview = ({ messages, fallbackUrl, projectId }: Props) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const picker = useElementPicker(iframeRef);
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [reloadKey, setReloadKey] = useState(0);

  // Listen for external reload requests (e.g. after a checkpoint restore).
  useEffect(() => {
    const onReload = () => setReloadKey((k) => k + 1);
    window.addEventListener("agent-preview-reload", onReload);
    return () => window.removeEventListener("agent-preview-reload", onReload);
  }, []);

  // Resolve raw URL once per render but only commit it to state when its
  // VALUE actually changes — prevents iframe reload on every streaming
  // tool-output update.
  const rawCandidate = fallbackUrl ?? findPreviewUrl(messages) ?? null;
  const [rawUrl, setRawUrl] = useState<string | null>(rawCandidate);
  useEffect(() => {
    setRawUrl((prev) => (prev === rawCandidate ? prev : rawCandidate));
  }, [rawCandidate]);

  // Always proxy via daytona-preview to bypass Daytona's "Preview URL Warning"
  // interstitial (the proxy injects the server-only `X-Daytona-Skip-Preview-Warning`
  // header that browsers cannot send cross-site).
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = rawUrl ? toIframeProxyUrl(rawUrl) : null;
    setUrl((prev) => (prev === next ? prev : next));
  }, [rawUrl]);

  // Supabase's edge gateway force-downgrades function HTML responses to
  // `text/plain`, which makes a direct iframe render the proxied page as
  // raw source. Workaround: fetch the HTML once and hand the iframe a blob
  // URL with the correct `text/html` MIME. We do NOT inject a <base> tag or
  // Tailwind CDN — the edge function already rewrites all asset paths and
  // injects a runtime patch.
  //
  // NOTE: blob URLs created here have origin `lovableproject.com` (not
  // daytona). The chat-visible "open in new tab" link goes directly to
  // daytona, so the two views have separate localStorage. This is browser
  // origin-isolation — data added in one view will not appear in the other.
  const needsBlob = url ? isPreviewProxyUrl(url) : false;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [manualRetryKey, setManualRetryKey] = useState(0);

  useEffect(() => {
    if (!url || !needsBlob) {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setLoadError(null);
      setRetryAttempt(0);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoadError(null);

    // Retry with backoff — handles "sandbox waking up" 502/503/504 gracefully.
    const delays = [0, 2000, 4000, 8000, 12000];
    const attempt = async (i: number): Promise<void> => {
      if (cancelled) return;
      if (i > 0) setRetryAttempt(i);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const html = await res.text();
        if (cancelled) return;
        if (!res.ok) {
          if ((res.status === 502 || res.status === 503 || res.status === 504) && i < delays.length - 1) {
            await new Promise((r) => setTimeout(r, delays[i + 1]));
            return attempt(i + 1);
          }
          throw new Error(html || `Preview request failed (${res.status})`);
        }
        createdUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return createdUrl;
        });
        setRetryAttempt(0);
      } catch (err) {
        if (cancelled) return;
        if (i < delays.length - 1) {
          await new Promise((r) => setTimeout(r, delays[i + 1]));
          return attempt(i + 1);
        }
        setLoadError(err instanceof Error ? err.message : "Preview failed to load");
      }
    };
    void attempt(0);
    return () => { cancelled = true; };
  }, [url, needsBlob, manualRetryKey]);

  void withPreviewBase;

  if (!url) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-muted/20 via-background to-primary/5 px-6 relative overflow-hidden">
        <div className="relative max-w-sm text-center space-y-4">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-xl shadow-primary/30 ring-1 ring-primary/20">
            <Eye size={26} className="text-primary-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">Preview will appear here</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Describe an app in chat — the agent boots a sandbox and shares the live URL when the dev server is up.
          </p>
        </div>
      </div>
    );
  }

  const iframeSrc = needsBlob ? blobUrl ?? undefined : url;
  const showLoader = needsBlob && !blobUrl;

  return (
    <div className="relative h-full w-full">
      <DeviceFrame mode={device}>
        {showLoader ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center text-sm text-muted-foreground">
            {loadError ? (
              <>
                <p className="font-medium text-foreground">Preview unavailable</p>
                <p className="text-xs max-w-xs">The sandbox may be waking up or the dev server crashed. Try again, or ask the agent to run the app.</p>
                <button
                  type="button"
                  onClick={() => { setLoadError(null); setManualRetryKey((k) => k + 1); }}
                  className="mt-1 inline-flex items-center rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted active:scale-95 transition-all"
                >
                  Retry
                </button>
              </>
            ) : retryAttempt > 0 ? (
              <>
                <div className="size-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <p>Sandbox waking up… (attempt {retryAttempt + 1})</p>
              </>
            ) : (
              <>
                <div className="size-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <p>Loading preview…</p>
              </>
            )}
          </div>
        ) : (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={iframeSrc}
            title="App preview"
            className="w-full h-full border-0 bg-background"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </DeviceFrame>


      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <DeviceToggle mode={device} onChange={setDevice} />
      </div>
      {/* Floating toolbar — picker + inline edit + checkpoints. */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
        <MobilePreviewQR previewUrl={rawUrl} />
        {projectId && <CheckpointPanel projectId={projectId} />}
        <button
          type="button"
          onClick={picker.toggleEdit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
            "shadow-lg backdrop-blur-md transition-all active:scale-95",
            picker.editActive
              ? "bg-amber-500 text-white border-amber-500"
              : "bg-background/85 text-foreground border-border hover:bg-background",
          )}
          title={picker.editActive ? "Double-click any text to edit it" : "Enable inline edit mode"}
        >
          <Pencil size={13} />
          {picker.editActive ? "Editing…" : "Edit"}
        </button>
        <button
          type="button"
          onClick={picker.toggle}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
            "shadow-lg backdrop-blur-md transition-all active:scale-95",
            picker.active
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background/85 text-foreground border-border hover:bg-background",
          )}
          title={picker.active ? "Click an element in the preview…" : "Pick an element to reference in chat"}
        >
          <MousePointerClick size={13} />
          {picker.active ? "Click an element…" : "Select"}
        </button>
      </div>
    </div>
  );
};
