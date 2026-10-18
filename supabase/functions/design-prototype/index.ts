// Design Prototype generator — supports two modes:
//   mode: "plan"   → returns a JSON list of screens for the app
//   mode: "screen" → returns a single self-contained mobile HTML prototype for one screen
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const PLAN_MODEL = "anthropic/claude-3.5-sonnet";
const SCREEN_MODEL = "anthropic/claude-opus-4.7";

const SCREEN_SYSTEM = `You are a senior mobile product designer. Given an app idea and a specific screen, produce a SINGLE self-contained HTML file that renders a beautiful, realistic MOBILE APP screen (390x844 viewport, iPhone-class).

STRICT RULES:
- Output ONLY the HTML, no commentary, no markdown fences.
- Use Tailwind CSS via <script src="https://cdn.tailwindcss.com"></script>.
- Use Google Fonts via <link> for a tasteful typography pair. Pick fonts that match the product mood.
- Lock the viewport to 390px wide. Render a realistic status bar, header, content, AND bottom nav if applicable to THIS screen.
- Use REAL-looking copy, real product/category names, real numbers — never "Lorem ipsum", never "Item 1/2/3".
- Use SVG icons inline. Do NOT use external icon libraries.
- Include subtle depth: soft shadows, rounded-2xl/3xl cards, gradients where appropriate, but stay tasteful.
- Commit to ONE bold aesthetic and reuse it across screens of the same app — same palette, same fonts, same component style.
- Ensure proper contrast. No floating elements that overlap the bottom nav.
- Include placeholder images via https://images.unsplash.com/photo-... or https://picsum.photos/seed/<word>/<w>/<h>.
- Output must be a complete HTML document starting with <!DOCTYPE html>.`;

const PLAN_SYSTEM = `You are a senior mobile product strategist. Given an app idea, return a TIGHT JSON list of the core screens this app needs.

STRICT RULES:
- Return ONLY a valid JSON array, no commentary, no markdown fences.
- Each item must have:
    "key":        kebab-case-id, unique
    "label":      Human Title (2-4 words)
    "purpose":    one specific sentence — what the USER does here (not what the screen "shows")
    "data_needs": short array of nouns this screen reads/writes (table names if obvious), e.g. ["posts","likes","comments"]
    "depends_on": array of "key"s of OTHER screens this one navigates from (empty for the entry screen)
- Pick between 3 and 8 screens. Prefer FEWER, SHARPER screens. Never list a screen that just "displays" something — merge it.
- Always start with the main entry screen the user lands on after auth. That screen has depends_on: [].
- Include auth screens ONLY if the app needs accounts. Combine login+signup into one screen "auth" when possible.
- DO NOT include: splash, onboarding (unless explicit), settings (unless explicit), about, terms — these are noise.
- Every non-entry screen MUST appear in some other screen's depends_on chain — no orphans.

GOOD EXAMPLES:

Idea: "habit tracker with streaks"
[
  { "key":"home", "label":"Today", "purpose":"User taps habits to mark them done for today and sees current streaks.", "data_needs":["habits","habit_logs"], "depends_on":[] },
  { "key":"habit-detail", "label":"Habit Detail", "purpose":"User reviews one habit's history calendar and edits its name/cadence.", "data_needs":["habits","habit_logs"], "depends_on":["home"] },
  { "key":"new-habit", "label":"New Habit", "purpose":"User creates a new habit with a name, cadence and color.", "data_needs":["habits"], "depends_on":["home"] },
  { "key":"stats", "label":"Stats", "purpose":"User sees longest streaks, completion % and weekly chart across all habits.", "data_needs":["habits","habit_logs"], "depends_on":["home"] }
]

Idea: "social photo app like Instagram"
[
  { "key":"feed", "label":"Feed", "purpose":"User scrolls a vertical feed of photo posts from people they follow and double-taps to like.", "data_needs":["posts","follows","likes"], "depends_on":[] },
  { "key":"post-detail", "label":"Post", "purpose":"User reads/writes comments on one post and views all likers.", "data_needs":["posts","comments","likes"], "depends_on":["feed"] },
  { "key":"create-post", "label":"New Post", "purpose":"User picks a photo, writes a caption and publishes.", "data_needs":["posts"], "depends_on":["feed"] },
  { "key":"profile", "label":"Profile", "purpose":"User views any user's grid of posts, bio, follower count and follow/unfollow.", "data_needs":["profiles","posts","follows"], "depends_on":["feed"] },
  { "key":"search", "label":"Search", "purpose":"User searches users by handle and discovers trending posts.", "data_needs":["profiles","posts"], "depends_on":["feed"] },
  { "key":"auth", "label":"Sign in", "purpose":"User signs in or creates an account with email + Google.", "data_needs":["profiles"], "depends_on":[] }
]

Now plan for the user's app.`;

async function callOpenRouter(model: string, system: string, user: string, maxTokens: number, temperature = 0.7) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://oneclick.studio",
      "X-Title": "OneClick Design Mode",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "") as string;
}

function stripFences(s: string) {
  return s.trim().replace(/^```(?:html|json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const mode: "plan" | "screen" = body?.mode ?? "screen";

    if (mode === "plan") {
      const { prompt } = body;
      if (!prompt || typeof prompt !== "string") {
        return new Response(JSON.stringify({ error: "prompt required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const raw = await callOpenRouter(
        PLAN_MODEL,
        PLAN_SYSTEM,
        `App idea: ${prompt}\n\nReturn the JSON array of core screens.`,
        1200,
        0.5,
      );
      const cleaned = stripFences(raw);
      let screens: any[] = [];
      try {
        screens = JSON.parse(cleaned);
      } catch {
        // Try to find a JSON array inside
        const m = cleaned.match(/\[[\s\S]*\]/);
        if (m) screens = JSON.parse(m[0]);
      }
      if (!Array.isArray(screens) || screens.length === 0) {
        return new Response(JSON.stringify({ error: "Planner returned invalid JSON", preview: cleaned.slice(0, 300) }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Sanitize + cap at 8 — preserve data_needs + depends_on for downstream agent
      const capped = screens.slice(0, 8);
      const validKeys = new Set(capped.map((s: any, i: number) =>
        String(s.key ?? `screen-${i}`).toLowerCase().replace(/[^a-z0-9-]/g, "-")));
      const clean = capped.map((s: any, i: number) => {
        const key = String(s.key ?? `screen-${i}`).toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const depends = Array.isArray(s.depends_on) ? s.depends_on
          .map((d: any) => String(d).toLowerCase().replace(/[^a-z0-9-]/g, "-"))
          .filter((d: string) => validKeys.has(d) && d !== key) : [];
        const data = Array.isArray(s.data_needs) ? s.data_needs
          .map((d: any) => String(d).toLowerCase().trim())
          .filter(Boolean).slice(0, 8) : [];
        return {
          key,
          label: String(s.label ?? `Screen ${i + 1}`),
          purpose: String(s.purpose ?? ""),
          data_needs: data,
          depends_on: depends,
        };
      });
      return new Response(JSON.stringify({ screens: clean }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // screen mode
    const { prompt, screen, styleHint } = body;
    if (!prompt || !screen?.label) {
      return new Response(JSON.stringify({ error: "prompt and screen required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userMsg = [
      `App idea: ${prompt}`,
      `Screen to design: ${screen.label} (${screen.key})`,
      screen.purpose ? `Purpose: ${screen.purpose}` : "",
      styleHint ? `Style consistency hint (match these visual choices used by sibling screens): ${styleHint}` : "",
      `Design ONLY this one screen as a beautiful mobile prototype.`,
    ].filter(Boolean).join("\n");

    const raw = await callOpenRouter(SCREEN_MODEL, SCREEN_SYSTEM, userMsg, 8000, 0.8);
    const html = stripFences(raw);
    if (!html.toLowerCase().includes("<!doctype") && !html.toLowerCase().includes("<html")) {
      return new Response(JSON.stringify({ error: "Model returned non-HTML output", preview: html.slice(0, 200) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ html, model: SCREEN_MODEL }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[design-prototype] exception:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
