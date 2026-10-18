// Secret request tool — lets the agent ask the user for an API key
// (LiveKit, Twilio, OpenAI, ...) without ever seeing the value itself.
// A row in agent_secret_requests is created; the chat UI subscribes
// via realtime and renders an inline form. When the user submits,
// the value is pushed to their linked Supabase project as a runtime env var.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeSecretRequestTools(_sandbox: DaytonaSandbox, ctx: ToolCtx, _cwd: string) {
  return {
    request_secret: tool({
      description:
        "Ask the user to provide an API key / secret that the generated app needs (e.g. STRIPE_SECRET_KEY, " +
        "LIVEKIT_API_KEY, TWILIO_AUTH_TOKEN). Creates a pending request — the chat UI shows an inline form. " +
        "When the user submits, the value is pushed to their backend as a runtime env var (Deno.env.get(name) " +
        "inside edge functions). You NEVER see the value. " +
        "Use BEFORE writing the edge function that consumes it. STOP further tool calls after creating the " +
        "request — wait for the user. If they decline, pick an alternative or skip the feature.",
      inputSchema: z.object({
        name: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]*$/, "Must be UPPER_SNAKE_CASE, e.g. STRIPE_SECRET_KEY")
          .max(64),
        label: z.string().max(80).describe("Short human label, e.g. 'Stripe Secret Key'"),
        why_needed: z.string().max(400).describe("Plain-language explanation of what this enables in the app"),
        link_hint: z.string().max(200).default("").describe("Where the user can find it, e.g. 'Stripe dashboard → Developers → API keys'"),
        doc_url: z.string().url().or(z.literal("")).default("").describe("Optional docs URL"),
      }),
      execute: async ({ name, label, why_needed, link_hint, doc_url }) => {
        // Dedup: if there's already a pending request for this same name, reuse it.
        const { data: existing } = await ctx.supabase
          .from("agent_secret_requests")
          .select("id,status")
          .eq("project_id", ctx.projectId)
          .eq("secret_name", name)
          .eq("status", "pending")
          .maybeSingle();
        if (existing) {
          return {
            ok: true,
            request_id: (existing as any).id,
            status: "pending",
            already_pending: true,
            hint: `Request for ${name} is already pending. STOP and wait for the user to provide it.`,
          };
        }

        const { data, error } = await ctx.supabase
          .from("agent_secret_requests")
          .insert({
            project_id: ctx.projectId,
            user_id: ctx.userId,
            secret_name: name,
            label: label || name,
            why_needed: why_needed || "",
            link_hint: link_hint || "",
            doc_url: doc_url || "",
            status: "pending",
          })
          .select("id")
          .single();

        if (error) return { ok: false, error: error.message };

        return {
          ok: true,
          request_id: (data as any).id,
          status: "pending",
          hint:
            `Secret request created for ${name}. The user now sees an inline form in chat. ` +
            `STOP all further tool calls and wait for the user. Once provided, the value is available ` +
            `inside edge functions as Deno.env.get("${name}").`,
        };
      },
    }),

    check_secret_status: tool({
      description:
        "Check whether the user has provided a previously requested secret. Use ONLY if the user explicitly " +
        "tells you they've submitted it, or you're resuming after a pause. Returns status: pending|provided|declined.",
      inputSchema: z.object({
        name: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]*$/, "UPPER_SNAKE_CASE")
          .max(64),
      }),
      execute: async ({ name }) => {
        const { data, error } = await ctx.supabase
          .from("agent_secret_requests")
          .select("id,status,fulfilled_at,error_message")
          .eq("project_id", ctx.projectId)
          .eq("secret_name", name)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return { ok: false, error: error.message };
        if (!data) return { ok: true, status: "none", hint: "No request found for this name." };
        return {
          ok: true,
          status: (data as any).status,
          fulfilled_at: (data as any).fulfilled_at,
          error_message: (data as any).error_message,
        };
      },
    }),
  };
}
