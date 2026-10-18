// Thin HTTP entry — auth/CORS only. All agent logic lives in runAgent.ts.
// Replaces the old 2172-line monolith.
import { corsHeaders } from "../_shared/cors.ts";
import { handleAgentRequest } from "./runAgent.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("agent", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    return await handleAgentRequest(req);
  } catch (err) {
    console.error("[agent] fatal:", err);
    return new Response(JSON.stringify({ error: String((err as Error).message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
