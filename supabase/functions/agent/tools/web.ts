// Auto-extracted from agent/index.ts during the modularization refactor.
// Each tool returns a partial tool map; tools/index.ts merges them.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeWebTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    web_search: tool({
      description: "Search the live web (via Lovable AI). Returns a concise answer with citations.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const key = Deno.env.get("LOVABLE_API_KEY");
        if (!key) return { ok: false, error: "LOVABLE_API_KEY missing" };
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "You are a web research assistant. Answer concisely with sources." },
              { role: "user", content: `Search the web and answer: ${query}` },
            ],
          }),
        });
        const data = await r.json();
        return { ok: r.ok, answer: data?.choices?.[0]?.message?.content ?? data };
      },
    }),
    web_fetch: tool({
      description: "Fetch a URL and return its textual content (truncated to 8 KB).",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        try {
          const r = await fetch(url, { headers: { "User-Agent": "LovableAgent/1.0" } });
          const text = await r.text();
          return { ok: r.ok, status: r.status, content: text.slice(0, 8000) };
        } catch (e) {
          return { ok: false, error: String((e as Error).message || e) };
        }
      },
    }),

    // ── Image generation ──────────────────────────────────────
    generate_image: tool({
      description:
        "Generate an image with Lovable AI (gemini-2.5-flash-image-preview) and save it into the project at the given path (e.g. 'src/assets/hero.png'). Use for hero images, illustrations, icons.",
      inputSchema: z.object({
        prompt: z.string(),
        path: z.string(),
      }),
      execute: async ({ prompt, path }) => {
        const key = Deno.env.get("LOVABLE_API_KEY");
        if (!key) return { ok: false, error: "LOVABLE_API_KEY missing" };
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image-preview",
            messages: [{ role: "user", content: prompt }],
            modalities: ["image", "text"],
          }),
        });
        if (!r.ok) return { ok: false, error: `gateway ${r.status}: ${await r.text()}` };
        const data = await r.json();
        const b64: string | undefined =
          data?.choices?.[0]?.message?.images?.[0]?.image_url?.url?.split(",").pop();
        if (!b64) return { ok: false, error: "no image in response" };
        // write base64 to sandbox via shell
        const safePath = `${cwd}/${path}`;
        await sandbox.exec(
          `mkdir -p "$(dirname '${safePath}')" && echo '${b64}' | base64 -d > '${safePath}'`,
          cwd,
          60,
        );
        return { ok: true, path };
      },
    }),
  };
}
