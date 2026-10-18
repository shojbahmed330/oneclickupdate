// GitHub OAuth callback: exchanges code → access_token, fetches user, encrypts + saves token,
// then returns a small HTML page that postMessage's success back to the opener and closes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encrypt } from "../_shared/sboauth.ts";
import { withSentry } from "../_shared/sentry.ts";

type OAuthState = { uid?: string; rt?: string };

function callbackOrigin(stateRaw: string | null) {
  try {
    const state = JSON.parse(atob(stateRaw ?? "")) as OAuthState;
    if (!state.rt) return null;
    return new URL(state.rt).origin;
  } catch {
    return null;
  }
}

function finish(stateRaw: string | null, success: boolean, message: string) {
  const origin = callbackOrigin(stateRaw);
  if (!origin) {
    return new Response(JSON.stringify({ error: message }), {
      status: success ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL("/github-oauth-callback", origin);
  url.searchParams.set("status", success ? "success" : "error");
  url.searchParams.set("message", message);
  return Response.redirect(url.toString(), 303);
}

Deno.serve(withSentry("github-oauth-callback", async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const ghErr = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (ghErr) return finish(stateRaw, false, ghErr);
    if (!code || !stateRaw) return finish(stateRaw, false, "Missing code/state");

    let userId = "";
    try { userId = JSON.parse(atob(stateRaw)).uid; } catch { return finish(stateRaw, false, "Bad state"); }
    if (!userId) return finish(stateRaw, false, "Bad state");

    // Trim — secrets pasted via dashboard often pick up trailing whitespace/newline,
    // which silently breaks the OAuth token exchange (GitHub returns no access_token).
    const clientId = Deno.env.get("GITHUB_OAUTH_CLIENT_ID")?.trim();
    const clientSecret = Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET")?.trim();
    if (!clientId || !clientSecret) return finish(stateRaw, false, "Server not configured (missing CLIENT_ID/SECRET)");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const redirectUri = `${SUPABASE_URL}/functions/v1/github-oauth-callback`;

    // Use form-urlencoded — most reliable with GitHub's OAuth endpoint.
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "lovable-bd",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    const rawText = await tokenResp.text();
    let tokenJson: any = {};
    try { tokenJson = JSON.parse(rawText); } catch { /* keep raw */ }
    const accessToken = tokenJson?.access_token as string | undefined;
    if (!accessToken) {
      const detail = tokenJson?.error_description
        || tokenJson?.error
        || (rawText ? `GitHub said: ${rawText.slice(0, 200)}` : `HTTP ${tokenResp.status}`);
      return finish(stateRaw, false, detail);
    }
    const scopes = String(tokenJson?.scope || "").split(",").filter(Boolean);

    const userResp = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "lovable-bd" },
    });
    const ghUser = await userResp.json();
    if (!ghUser?.login) return finish(stateRaw, false, "Could not fetch GitHub user");

    const encrypted = await encrypt(accessToken);
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Upsert connection
    const { error } = await admin.from("user_github_connections").upsert({
      user_id: userId,
      github_username: ghUser.login,
      github_user_id: ghUser.id,
      github_email: ghUser.email,
      access_token_encrypted: encrypted,
      scopes,
      revoked: false,
      last_refreshed_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return finish(stateRaw, false, error.message);

    return finish(stateRaw, true, `Connected as @${ghUser.login}`);
  } catch (e) {
    return finish(null, false, String((e as Error).message ?? e));
  }
}));
