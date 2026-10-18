import { useState } from "react";
import { Smartphone, X, ExternalLink, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** The published / preview URL the phone should load. */
  previewUrl?: string | null;
  /** Optional APK download URL (after a successful build). */
  apkUrl?: string | null;
}

/**
 * Floating "Open on phone" button → popover with QR code(s).
 *
 * Why not Expo Go: this project's generated apps are React + Vite (DOM),
 * not React Native. Expo Go would refuse to run them. Instead we expose
 * the SAME preview URL as a QR — phone scans it, opens in mobile Safari /
 * Chrome, and the user can "Add to Home Screen" for an instant
 * native-feel install. Once the Capacitor APK build finishes, the QR
 * flips to point at the .apk download instead.
 */
export function MobilePreviewQR({ previewUrl, apkUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"web" | "apk">(apkUrl ? "apk" : "web");

  const url = tab === "apk" ? apkUrl : previewUrl;
  const qrSrc = url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=2&ecc=M&data=${encodeURIComponent(url)}`
    : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
          "shadow-lg backdrop-blur-md transition-all active:scale-95",
          open
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background/85 text-foreground border-border hover:bg-background",
        )}
        title="Open this app on your phone"
        aria-label="Open on phone"
      >
        <Smartphone size={13} />
        Phone
      </button>

      {open && (
        <div
          className="fixed sm:absolute bottom-[72px] sm:bottom-12 left-1/2 sm:left-auto sm:right-0 -translate-x-1/2 sm:translate-x-0 z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur-md"
          role="dialog"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Open on phone</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground active:scale-95"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {apkUrl && (
            <div className="mb-3 flex rounded-md border border-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setTab("web")}
                className={cn(
                  "flex-1 rounded px-2 py-1 transition-colors",
                  tab === "web" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Live preview
              </button>
              <button
                type="button"
                onClick={() => setTab("apk")}
                className={cn(
                  "flex-1 rounded px-2 py-1 transition-colors",
                  tab === "apk" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Install APK
              </button>
            </div>
          )}

          {qrSrc ? (
            <>
              <div className="flex justify-center rounded-lg bg-white p-2">
                <img src={qrSrc} alt="QR code" width={224} height={224} className="rounded" />
              </div>
              <p className="mt-3 text-center text-[11px] leading-snug text-muted-foreground">
                {tab === "apk"
                  ? "Scan → Android download starts. Allow 'install from unknown sources' if asked."
                  : "Scan → opens in your phone browser. Tap Share → 'Add to Home Screen' for an app-style icon."}
              </p>
              <div className="mt-3 flex items-center gap-1">
                <input
                  readOnly
                  value={url ?? ""}
                  className="flex-1 truncate rounded-md border border-input bg-muted px-2 py-1 text-[11px] font-mono"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="rounded-md border border-border bg-background p-1.5 hover:bg-muted active:scale-95"
                  aria-label="Copy URL"
                >
                  {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
                </button>
                <a
                  href={url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-border bg-background p-1.5 hover:bg-muted active:scale-95"
                  aria-label="Open in new tab"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            </>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Preview URL not ready yet — wait for the dev server to come up.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
