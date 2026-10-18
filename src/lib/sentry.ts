import * as Sentry from "@sentry/react";

let initialized = false;

/**
 * Boot Sentry as soon as we have the DSN. Safe to call multiple times.
 * DSN is fetched from the `sentry-config` edge function so it stays
 * managed via Lovable Cloud secrets instead of being baked into the bundle.
 */
export async function initSentry() {
  if (initialized) return;
  if (typeof window === "undefined") return;

  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sentry-config`;
    const res = await fetch(url, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" },
    });
    if (!res.ok) return;
    const { dsn, environment } = await res.json();
    if (!dsn) return;

    Sentry.init({
      dsn,
      environment: environment || (import.meta.env.PROD ? "production" : "development"),
      release: import.meta.env.VITE_APP_VERSION || "oneclick-studio@dev",
      // Performance monitoring — keep low to stay within free tier
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
      // Session replay — only on errors, not all sessions
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0.5,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
      ],
      // Filter out noise
      ignoreErrors: [
        "ResizeObserver loop",
        "Non-Error promise rejection captured",
        "Network request failed",
        "Load failed",
        "AbortError",
      ],
      beforeSend(event, hint) {
        // Drop dev-only HMR / Vite errors
        const msg = hint.originalException instanceof Error ? hint.originalException.message : "";
        if (msg.includes("HMR") || msg.includes("vite")) return null;
        return event;
      },
    });
    initialized = true;
  } catch {
    // Sentry init failure must never break the app
  }
}

/** Attach the signed-in user to error reports. */
export function setSentryUser(user: { id: string; email?: string } | null) {
  if (!initialized) return;
  Sentry.setUser(user ? { id: user.id, email: user.email } : null);
}

export { Sentry };
