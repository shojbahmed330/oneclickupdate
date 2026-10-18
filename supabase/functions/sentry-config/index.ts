import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/**
 * Returns the public Sentry DSN for the frontend.
 * Sentry DSNs are designed to be public (rate-limited per project),
 * but we serve it via this function so the value stays managed through
 * Lovable Cloud secrets instead of being baked into the bundle.
 *
 * verify_jwt is intentionally false — frontend hits this on boot, before auth.
 */
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const dsn = Deno.env.get("SENTRY_DSN") ?? "";
  return new Response(
    JSON.stringify({ dsn, environment: Deno.env.get("SENTRY_ENV") ?? "production" }),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300", // 5 min CDN cache
      },
    },
  );
});
