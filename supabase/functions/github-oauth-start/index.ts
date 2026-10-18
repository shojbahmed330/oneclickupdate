// Start the GitHub OAuth flow. Requires GITHUB_OAUTH_CLIENT_ID secret.
// Caller must be authenticated. Returns { url } that the frontend opens in a popup.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/sboauth.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("github-oauth-start", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Auth required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "Invalid auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trim — secrets stored via dashboard often pick up trailing whitespace/newline,
    // which gets URL-encoded as `+` and breaks the OAuth client_id (GitHub returns 404).
    const clientId = Deno.env.get("GITHUB_OAUTH_CLIENT_ID")?.trim();
    if (!clientId) {
      return new Response(JSON.stringify({ error: "GITHUB_OAUTH_CLIENT_ID not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { return_to } = await req.json().catch(() => ({}));
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const callbackUrl = `${SUPABASE_URL}/functions/v1/github-oauth-callback`;

    // Pack user_id + return_to into state. Sign-lite: base64 (server validates user via lookup).
    const state = btoa(JSON.stringify({ uid: u.user.id, rt: return_to ?? "", n: crypto.randomUUID() }));

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: "repo read:user user:email",
      state,
      allow_signup: "true",
    });

    return new Response(
      JSON.stringify({ url: `https://github.com/login/oauth/authorize?${params}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
