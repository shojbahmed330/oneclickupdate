// Connector discovery — given a free-form need ("video calling", "send SMS",
// "credit-card payments"), call Lovable AI Gateway with Gemini 2.5 Flash and
// web grounding to research the top 3 providers, extract the required secrets
// for each, and persist the proposal so the chat UI can render a choice card.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const Body = z.object({
  project_id: z.string().uuid(),
  need: z.string().min(3).max(500),
  category: z.string().max(60).default(""),
  run_id: z.string().uuid().optional(),
});

const RESEARCH_SYSTEM = `You are an integration-research assistant. Given a feature need,
return a JSON array of 2 or 3 best-in-class external API providers that solve it.

OUTPUT FORMAT (strict JSON, no prose, no markdown fence):
{
  "options": [
    {
      "name": "LiveKit",
      "tagline": "Open-source WebRTC for video/voice calls",
      "why": "Best DX for real-time audio/video; generous free tier",
      "pricing_note": "Free up to 50 connection-minutes/month, then usage-based",
      "docs_url": "https://docs.livekit.io/home/server/getting-started/",
      "signup_url": "https://cloud.livekit.io/",
      "required_secrets": [
        { "name": "LIVEKIT_API_KEY", "label": "LiveKit API Key", "why": "Server SDK auth", "link_hint": "LiveKit Cloud → Settings → Keys → API Key" },
        { "name": "LIVEKIT_API_SECRET", "label": "LiveKit API Secret", "why": "Sign access tokens", "link_hint": "Same place as the API Key" },
        { "name": "LIVEKIT_WS_URL", "label": "LiveKit WebSocket URL", "why": "Client connects here", "link_hint": "Project → 'wss://...' URL at top" }
      ]
    }
  ]
}

RULES:
- secret names: UPPER_SNAKE_CASE only.
- 1 to 4 required_secrets per provider.
- Prefer providers with: free tier, simple REST/JS SDK, good docs.
- Include 1 budget-friendly + 1 enterprise-grade option when both exist.
- Never invent secret names — only list what the official docs actually require.
- If the need is something Supabase/Lovable Cloud already covers natively (auth, storage,
  text chat, files, DB), return { "options": [], "native": true, "reason": "..." }.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ ok: false, error: "invalid token" }, 401);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ ok: false, error: parsed.error.flatten() }, 400);
    const { project_id, need, category, run_id } = parsed.data;

    if (!LOVABLE_API_KEY) return json({ ok: false, error: "LOVABLE_API_KEY missing" }, 500);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verify project ownership
    const { data: proj } = await admin.from("projects").select("id").eq("id", project_id).eq("user_id", uid).maybeSingle();
    if (!proj) return json({ ok: false, error: "project not owned" }, 403);

    // Reuse a recent pending proposal for the same need (dedupe within 10 min)
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: existing } = await admin
      .from("connector_proposals")
      .select("id,options,status")
      .eq("project_id", project_id)
      .eq("status", "pending")
      .eq("need_description", need)
      .gte("created_at", since)
      .maybeSingle();
    if (existing) {
      return json({ ok: true, proposal_id: (existing as any).id, options: (existing as any).options, cached: true });
    }

    // Call Lovable AI Gateway — gemini-2.5-flash with implicit web grounding
    const llmResp = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: RESEARCH_SYSTEM },
          { role: "user", content: `Need: ${need}${category ? `\nCategory hint: ${category}` : ""}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!llmResp.ok) {
      const t = await llmResp.text();
      return json({ ok: false, error: `gateway ${llmResp.status}: ${t.slice(0, 300)}` }, 502);
    }
    const llmData = await llmResp.json();
    const raw = llmData?.choices?.[0]?.message?.content ?? "{}";
    let parsedOut: { options?: any[]; native?: boolean; reason?: string } = {};
    try { parsedOut = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsedOut = JSON.parse(m[0]); } catch { /* ignore */ } }
    }

    // Native short-circuit
    if (parsedOut.native) {
      return json({ ok: true, native: true, reason: parsedOut.reason ?? "Supabase/Lovable Cloud covers this natively." });
    }

    const options = Array.isArray(parsedOut.options) ? parsedOut.options.slice(0, 4) : [];
    // Sanitize options
    const cleaned = options.map((o) => ({
      name: String(o.name ?? "Unknown").slice(0, 60),
      tagline: String(o.tagline ?? "").slice(0, 160),
      why: String(o.why ?? "").slice(0, 240),
      pricing_note: String(o.pricing_note ?? "").slice(0, 160),
      docs_url: String(o.docs_url ?? ""),
      signup_url: String(o.signup_url ?? ""),
      required_secrets: Array.isArray(o.required_secrets)
        ? o.required_secrets
            .filter((s: any) => typeof s?.name === "string" && /^[A-Z][A-Z0-9_]*$/.test(s.name))
            .slice(0, 4)
            .map((s: any) => ({
              name: s.name,
              label: String(s.label ?? s.name).slice(0, 80),
              why: String(s.why ?? "").slice(0, 240),
              link_hint: String(s.link_hint ?? "").slice(0, 200),
            }))
        : [],
    })).filter((o) => o.name && o.required_secrets.length > 0);

    if (cleaned.length === 0) {
      return json({ ok: false, error: "Research returned no usable options. Try a more specific need." });
    }

    const { data: inserted, error: insErr } = await admin
      .from("connector_proposals")
      .insert({
        project_id, user_id: uid, run_id: run_id ?? null,
        need_description: need, category,
        options: cleaned, status: "pending",
      })
      .select("id")
      .single();

    if (insErr || !inserted) return json({ ok: false, error: insErr?.message ?? "insert failed" }, 500);

    return json({ ok: true, proposal_id: (inserted as any).id, options: cleaned });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
