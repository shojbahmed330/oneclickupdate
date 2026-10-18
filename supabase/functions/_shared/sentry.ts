/**
 * Lightweight Sentry reporter for Deno edge functions.
 * Uses the Sentry HTTP envelope API directly — no SDK, no bundle bloat.
 *
 * Usage in any edge function:
 *   import { reportEdgeError } from "../_shared/sentry.ts"; // or copy this file
 *   try { ... } catch (e) { await reportEdgeError(e, { fn: "my-func", extra: {...} }); }
 */

const DSN = Deno.env.get("SENTRY_DSN_EDGE") ?? Deno.env.get("SENTRY_DSN") ?? "";
const ENV = Deno.env.get("SENTRY_ENV") ?? "production";

interface ParsedDsn {
  protocol: string;
  publicKey: string;
  host: string;
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!projectId || !u.username) return null;
    return { protocol: u.protocol.replace(":", ""), publicKey: u.username, host: u.host, projectId };
  } catch {
    return null;
  }
}

interface ReportContext {
  fn: string;
  userId?: string;
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
}

export async function reportEdgeError(error: unknown, ctx: ReportContext): Promise<void> {
  const parsed = parseDsn(DSN);
  if (!parsed) return; // Sentry not configured — silently skip

  const err = error instanceof Error ? error : new Error(String(error));
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error" as const,
    environment: ENV,
    server_name: ctx.fn,
    tags: { function: ctx.fn, ...(ctx.tags ?? {}) },
    user: ctx.userId ? { id: ctx.userId } : undefined,
    extra: ctx.extra ?? {},
    exception: {
      values: [{
        type: err.name || "Error",
        value: err.message,
        stacktrace: err.stack ? { frames: parseStack(err.stack) } : undefined,
      }],
    },
  };

  const url = `${parsed.protocol}://${parsed.host}/api/${parsed.projectId}/envelope/`;
  const auth = `Sentry sentry_version=7,sentry_client=lovable-edge/1.0,sentry_key=${parsed.publicKey}`;
  const envelope =
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }) + "\n" +
    JSON.stringify({ type: "event" }) + "\n" +
    JSON.stringify(event);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": auth },
      body: envelope,
    });
  } catch {
    // Never let Sentry reporting itself throw
  }
}

function parseStack(stack: string) {
  return stack.split("\n").slice(1, 30).map((line) => {
    const m = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/) || line.match(/at\s+(.+?):(\d+):(\d+)/);
    if (!m) return { function: line.trim() };
    return m.length === 5
      ? { function: m[1], filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) }
      : { filename: m[1], lineno: Number(m[2]), colno: Number(m[3]) };
  }).reverse();
}

/**
 * Wraps a Deno.serve handler so any uncaught throw is reported to Sentry
 * AND a clean 500 JSON response is returned instead of leaking stack traces.
 *
 * Usage:  Deno.serve(withSentry("my-fn", async (req) => { ... }))
 */
export function withSentry(
  fnName: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (err) {
      const userId = (() => {
        try {
          const auth = req.headers.get("Authorization") ?? "";
          const token = auth.replace(/^Bearer\s+/i, "");
          if (!token) return undefined;
          const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
          return typeof payload?.sub === "string" ? payload.sub : undefined;
        } catch { return undefined; }
      })();

      // Fire-and-forget — never block the response on Sentry network call
      reportEdgeError(err, {
        fn: fnName,
        userId,
        extra: { url: req.url, method: req.method },
      }).catch(() => {});

      console.error(`[${fnName}] uncaught:`, err);
      return new Response(
        JSON.stringify({ error: (err as Error)?.message ?? String(err) }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
  };
}
