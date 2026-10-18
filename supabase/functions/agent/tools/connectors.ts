// Connector framework — the agent's auto-research + propose tools.
// Workflow the agent follows for any external-API need:
//   1. discover_connector("video calling")
//      → backend uses Gemini-flash with web grounding to find 2-3 providers,
//        extracts their required secrets from official docs, persists a
//        connector_proposals row. UI shows a choice card.
//   2. STOP. Wait for the user to pick an option in chat.
//   3. check_connector_choice(proposal_id) → returns selected provider +
//      list of secret_names (still pending until user fills the inline forms).
//   4. For each secret_name, call check_secret_status() until provided.
//   5. Use fetch_provider_docs(name) for code-level examples, then write the
//      edge function consuming the secrets.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { SUPABASE_URL } from "../shared.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export function makeConnectorTools(_sandbox: DaytonaSandbox, ctx: ToolCtx, _cwd: string) {
  return {
    discover_connector: tool({
      description:
        "When the app needs an external API the platform doesn't cover natively " +
        "(video/voice calls, SMS, payments, transactional email, push notifications, " +
        "third-party AI APIs etc.), call this with a plain-English need. It researches " +
        "2-3 best providers via web-grounded LLM, extracts the exact UPPER_SNAKE_CASE " +
        "secrets each one requires, and surfaces a choice card to the user. " +
        "STOP all further tool calls after this — wait for the user to pick. " +
        "Returns { proposal_id, options[] } or { native: true } if Lovable Cloud handles it.",
      inputSchema: z.object({
        need: z.string().min(3).max(500).describe("Plain-language need, e.g. 'video calling for the chat app'"),
        category: z.string().max(60).default("").describe("Optional hint: 'video', 'sms', 'payments', 'email'"),
      }),
      execute: async ({ need, category }) => {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/connector-discover`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.userToken}` },
          body: JSON.stringify({ project_id: ctx.projectId, need, category }),
        });
        const text = await r.text();
        let body: any; try { body = JSON.parse(text); } catch { body = { ok: false, error: text.slice(0, 400) }; }
        if (!body.ok) return body;
        if (body.native) {
          return { ok: true, native: true, reason: body.reason, hint: "Use platform primitives instead of an external API." };
        }
        return {
          ok: true,
          proposal_id: body.proposal_id,
          options_summary: (body.options ?? []).map((o: any, i: number) => ({
            index: i, name: o.name, tagline: o.tagline,
            required_secrets: o.required_secrets.map((s: any) => s.name),
          })),
          hint:
            "Choice card surfaced to the user. STOP all tool calls. " +
            "On next turn, call check_connector_choice(proposal_id) to see what they picked.",
        };
      },
    }),

    check_connector_choice: tool({
      description:
        "Check whether the user has picked one of the proposed connector options. " +
        "Returns { status, chosen_provider?, secret_names? } so you know what to wait for next.",
      inputSchema: z.object({ proposal_id: z.string().uuid() }),
      execute: async ({ proposal_id }) => {
        const { data, error } = await ctx.supabase
          .from("connector_proposals").select("*").eq("id", proposal_id).maybeSingle();
        if (error) return { ok: false, error: error.message };
        if (!data) return { ok: false, error: "not found" };
        const status = (data as any).status as string;
        if (status !== "selected") {
          return { ok: true, status, hint: status === "pending" ? "Still waiting on user." : `Proposal ${status}.` };
        }
        const idx = (data as any).selected_option_index;
        const opts = (data as any).options ?? [];
        const chosen = opts[idx] ?? {};
        return {
          ok: true,
          status,
          chosen_provider: chosen.name,
          docs_url: chosen.docs_url,
          secret_names: (chosen.required_secrets ?? []).map((s: any) => s.name),
          hint:
            "User picked. Now check_secret_status() each name until all 'provided', " +
            "then call fetch_provider_docs() and write the edge function.",
        };
      },
    }),

    fetch_provider_docs: tool({
      description:
        "Pull a concise, code-focused integration brief for a chosen provider — the " +
        "exact JS/TS snippets to call its REST API from a Deno edge function (auth header, " +
        "endpoint, request body, response shape). Uses Gemini with web grounding so the " +
        "result reflects current docs. Use AFTER the user has provided all secrets.",
      inputSchema: z.object({
        provider: z.string().min(2).max(60),
        task: z.string().min(3).max(200).describe("What you want to do, e.g. 'mint LiveKit access token for a room'"),
      }),
      execute: async ({ provider, task }) => {
        if (!LOVABLE_API_KEY) return { ok: false, error: "LOVABLE_API_KEY missing" };
        const sys =
          "You are a senior integration engineer. For the given provider + task, return a " +
          "TIGHT integration brief: (1) which env vars to read, (2) the exact HTTP endpoint " +
          "or SDK call, (3) minimal Deno/TS code (npm: specifier preferred), (4) common gotchas. " +
          "No prose marketing. Cite the official docs URL.";
        const r = await fetch(GATEWAY, {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: `Provider: ${provider}\nTask: ${task}\nRuntime: Deno edge function on Supabase.` },
            ],
          }),
        });
        if (!r.ok) return { ok: false, error: `gateway ${r.status}: ${(await r.text()).slice(0, 300)}` };
        const data = await r.json();
        return { ok: true, brief: data?.choices?.[0]?.message?.content ?? "" };
      },
    }),
  };
}
