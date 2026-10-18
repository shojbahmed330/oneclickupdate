// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeScaffoldEdgeTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    scaffold_edge_function: tool({
      description:
        "Generate a production-ready Supabase Edge Function under supabase/functions/<name>/index.ts in the sandbox repo, " +
        "with CORS handling, JWT validation (when require_auth=true), and Zod input validation. " +
        "Provide handler_code as the body of the POST handler — it has access to `body` (validated), `user` (when require_auth), and `supabase` (service-role client). " +
        "Lovable Cloud auto-deploys on push.",
      inputSchema: z.object({
        name: z.string().regex(/^[a-z][a-z0-9-]*$/, "kebab-case"),
        require_auth: z.boolean().default(true),
        input_schema: z.string().default("z.object({})").describe("Zod schema literal, e.g. z.object({ message: z.string().min(1) })"),
        handler_code: z.string().min(10).describe("Body of the POST handler. Must return a Response."),
      }),
      execute: async ({ name, require_auth, input_schema, handler_code }) => {
        const authBlock = require_auth ? `
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\\s+/i, "");
  if (!token) return new Response(JSON.stringify({ error: "auth required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: u, error: ue } = await supabase.auth.getUser(token);
  if (ue || !u.user) return new Response(JSON.stringify({ error: "invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const user = u.user;` : `  const user = null;`;

        const code = `import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const InputSchema = ${input_schema};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
${authBlock}

    const raw = await req.json().catch(() => ({}));
    const parsed = InputSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;

    // ─── handler ──────────────────────────────────────────────
${handler_code.split("\n").map((l) => "    " + l).join("\n")}
    // ──────────────────────────────────────────────────────────
  } catch (err) {
    console.error("${name} error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message ?? "internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
`;
        const path = `supabase/functions/${name}/index.ts`;
        await sandbox.writeFile(`${cwd}/${path}`, code);
        return { ok: true, path, hint: "Lovable Cloud auto-deploys on next push. Call this function from the frontend with supabase.functions.invoke('" + name + "', { body: {...} })." };
      },
    }),

  };
}
