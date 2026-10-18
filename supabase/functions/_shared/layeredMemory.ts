// Layered project memory — three scopes with different injection rules:
//   • core    → ALWAYS injected (this user, this project + cross-project)
//   • user    → ALWAYS injected (this user, ANY project — communication
//               style, language, expertise level)
//   • topical → injected ONLY when keywords from the user's last message
//               match the rule. Otherwise the agent must call the
//               `recall` tool to pull them on demand.
//
// Token strategy:
//   - Hard cap: 12 core, 5 user, 5 topical hits per turn
//   - 200-char content cap per rule (already enforced at write-time)
//   - On hit, bump last_used_at (cheap UPDATE) so decay can prune later
//   - Rules archived (archived=true) are skipped silently

const MAX_CORE = 12;
const MAX_USER = 5;
const MAX_TOPICAL = 5;
const STOP = new Set([
  "the","and","for","with","that","this","from","into","what","when","why","how",
  "i","you","we","my","ami","amar","tumi","tomar","koro","kore","ki","kano","ei","oi",
  "page","app","add","fix","change","make","create","update","build","please","thanks",
  "error","issue","problem","help","need","want","not","work","working",
]);

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter((t) => !STOP.has(t));
}

export interface LayeredMemory {
  core: string[];
  user: string[];
  topical: string[];
  hits: number; // total memories matched (for logging)
}

/** Render the three layers into a compact context block. */
export function renderLayeredMemory(m: LayeredMemory): string {
  const parts: string[] = [];
  if (m.core.length) parts.push(`### Core rules (always-on):\n${m.core.map((c) => `- ${c}`).join("\n")}`);
  if (m.user.length) parts.push(`### User preferences (cross-project):\n${m.user.map((c) => `- ${c}`).join("\n")}`);
  if (m.topical.length) parts.push(`### Relevant project memory (matched this turn):\n${m.topical.map((c) => `- ${c}`).join("\n")}`);
  if (parts.length === 0) return "";
  return `## Memory — follow these rules:\n${parts.join("\n\n")}\n\n_(Call \`recall\` to fetch more memories if you need them.)_`;
}

export async function loadLayeredMemory(opts: {
  supabase: any;
  userId: string;
  projectId: string;
  query: string; // last user message — used to score topical relevance
}): Promise<LayeredMemory> {
  const { supabase, userId, projectId, query } = opts;
  const out: LayeredMemory = { core: [], user: [], topical: [], hits: 0 };

  try {
    // 1) Core: this project + cross-project (project_id NULL) with scope='core'
    const corePromise = supabase
      .from("project_memory")
      .select("id, content, weight, project_id")
      .eq("user_id", userId)
      .eq("scope", "core")
      .eq("archived", false)
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .order("weight", { ascending: false })
      .order("last_used_at", { ascending: false })
      .limit(MAX_CORE);

    // 2) User-level: any project, scope='user'
    const userPromise = supabase
      .from("project_memory")
      .select("id, content, weight")
      .eq("user_id", userId)
      .eq("scope", "user")
      .eq("archived", false)
      .order("weight", { ascending: false })
      .order("last_used_at", { ascending: false })
      .limit(MAX_USER);

    // 3) Topical: this project, scope='topical' — fetch a wider pool then keyword-filter.
    const topicalPromise = supabase
      .from("project_memory")
      .select("id, content, weight")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("scope", "topical")
      .eq("archived", false)
      .order("weight", { ascending: false })
      .order("last_used_at", { ascending: false })
      .limit(40);

    const [coreRes, userRes, topicalRes] = await Promise.all([corePromise, userPromise, topicalPromise]);

    const coreRows = coreRes.data ?? [];
    const userRows = userRes.data ?? [];
    const topicalPool = topicalRes.data ?? [];

    out.core = coreRows.map((r: any) => r.content);
    out.user = userRows.map((r: any) => r.content);

    // Keyword-match topical against query.
    const qToks = new Set(tokens(query));
    const matched: { id: string; content: string; score: number }[] = [];
    if (qToks.size > 0) {
      for (const row of topicalPool) {
        const cToks = tokens(String(row.content ?? ""));
        let hits = 0;
        for (const t of cToks) if (qToks.has(t)) hits++;
        if (hits > 0) matched.push({ id: row.id, content: row.content, score: hits + (row.weight ?? 1) * 0.5 });
      }
      matched.sort((a, b) => b.score - a.score);
      out.topical = matched.slice(0, MAX_TOPICAL).map((m) => m.content);
    }

    // Bump last_used_at for everything we surfaced (fire-and-forget, no await).
    const usedIds = [
      ...coreRows.map((r: any) => r.id),
      ...userRows.map((r: any) => r.id),
      ...matched.slice(0, MAX_TOPICAL).map((r) => r.id),
    ];
    if (usedIds.length) {
      void supabase.from("project_memory").update({ last_used_at: new Date().toISOString() }).in("id", usedIds);
    }

    out.hits = out.core.length + out.user.length + out.topical.length;
  } catch (e) {
    console.error("[layered-memory] load failed:", e);
  }
  return out;
}

// ─────────────────── Auto-save triggers ───────────────────
//
// Cheap regex scan over the user's latest message. If it sounds like a
// directive ("never X", "always X", "korbe na", "ei vabe na", "ami chai"),
// save it as a memory immediately — no LLM call, no extra tokens.

interface AutoSaveHit {
  content: string;
  category: "preference" | "constraint" | "design" | "feature";
  scope: "core" | "topical" | "user";
  weight: number;
}

const TRIGGERS: { rx: RegExp; category: AutoSaveHit["category"]; scope: AutoSaveHit["scope"]; weight: number; tag?: string }[] = [
  // ─── Strict constraints (English) ───
  { rx: /\bnever\s+([^.!?\n,]{4,160})/gi, category: "constraint", scope: "core", weight: 7 },
  { rx: /\b(?:don'?t|do not)\s+([^.!?\n,]{4,160})/gi, category: "constraint", scope: "core", weight: 6 },
  { rx: /\b(?:stop|avoid)\s+(?:using\s+)?([^.!?\n,]{4,160})/gi, category: "constraint", scope: "core", weight: 6 },

  // ─── Strict preferences (English) ───
  { rx: /\balways\s+([^.!?\n,]{4,160})/gi, category: "preference", scope: "core", weight: 6 },
  { rx: /\b(?:prefer(?:ably)?|preferred)\s+([^.!?\n,]{4,160})/gi, category: "preference", scope: "core", weight: 5 },
  { rx: /\bI (?:want|prefer|like)\s+([^.!?\n,]{4,160})/gi, category: "preference", scope: "topical", weight: 3 },

  // ─── Coding style / naming conventions (cross-session) ───
  { rx: /\buse\s+(camelCase|PascalCase|snake_case|kebab-case|SCREAMING_SNAKE_CASE)[^.!?\n]{0,120}/gi, category: "preference", scope: "core", weight: 7, tag: "naming" },
  { rx: /\b(?:name|rename)\s+([^.!?\n,]{4,120})\s+(?:to|as)\s+([^.!?\n,]{2,80})/gi, category: "preference", scope: "topical", weight: 4, tag: "naming" },
  { rx: /\b(?:always\s+use|use)\s+(arrow functions?|function declarations?|named exports?|default exports?|const\b[^.!?\n]{0,80})/gi, category: "preference", scope: "core", weight: 6, tag: "style" },
  { rx: /\bfile names?\s+(?:should be|must be|in)\s+([^.!?\n,]{4,120})/gi, category: "preference", scope: "core", weight: 6, tag: "naming" },
  { rx: /\bcomponents?\s+(?:should be|must be|in)\s+([^.!?\n,]{4,120})/gi, category: "preference", scope: "core", weight: 5, tag: "style" },

  // ─── Banglish ───
  { rx: /\b(?:korbe|korba|korben|korte)\s+na\b\s*([^.!?\n,]{0,160})/gi, category: "constraint", scope: "core", weight: 7 },
  { rx: /\bei\s*vabe\s*na\b\s*([^.!?\n,]{0,160})/gi, category: "constraint", scope: "core", weight: 6 },
  { rx: /\bkokhono\s+na\b\s*([^.!?\n,]{0,160})/gi, category: "constraint", scope: "core", weight: 7 },
  { rx: /\bami\s+chai\b\s*([^.!?\n,]{4,160})/gi, category: "preference", scope: "topical", weight: 3 },
  { rx: /\b(?:sob\s*somoy|sob\s*shomoy|always)\s+([^.!?\n,]{4,160})/gi, category: "preference", scope: "core", weight: 6 },
  { rx: /\b(?:emon|aibhabe)\s+(?:kore|koro)\b[^.!?\n]{0,160}/gi, category: "preference", scope: "topical", weight: 3 },

  // ─── Corrections / direct overrides ("not X, use Y") ───
  { rx: /\bnot\s+([^,.!?\n]{3,80})[,]\s*(?:use|prefer|do)\s+([^.!?\n,]{3,120})/gi, category: "preference", scope: "core", weight: 7, tag: "correction" },
];

function extractTriggers(text: string): AutoSaveHit[] {
  if (!text) return [];
  const hits: AutoSaveHit[] = [];
  const seen = new Set<string>();
  for (const t of TRIGGERS) {
    for (const m of text.matchAll(t.rx)) {
      // Use the LAST captured group as the rule body.
      const body = (m[m.length - 1] ?? "").trim().replace(/\s+/g, " ");
      if (body.length < 4 || body.length > 200) continue;
      const key = body.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Reconstruct a readable rule.
      const verb = m[0].slice(0, m[0].toLowerCase().indexOf(body.toLowerCase().slice(0, 6)) || 12).trim();
      const content = `${verb} ${body}`.replace(/\s+/g, " ").slice(0, 200);
      hits.push({ content, category: t.category, scope: t.scope, weight: t.weight });
    }
  }
  return hits.slice(0, 4); // hard cap per turn
}

/** Fire-and-forget auto-save. Skips dupes via the unique partial index. */
export async function autoSaveFromUserMessage(opts: {
  supabase: any;
  userId: string;
  projectId: string;
  text: string;
}): Promise<{ saved: number; hits: AutoSaveHit[] }> {
  const hits = extractTriggers(opts.text ?? "");
  if (hits.length === 0) return { saved: 0, hits: [] };
  let saved = 0;
  for (const h of hits) {
    try {
      const { error } = await opts.supabase.from("project_memory").insert({
        project_id: opts.projectId,
        user_id: opts.userId,
        content: h.content,
        category: h.category,
        scope: h.scope,
        weight: h.weight,
        source: "auto_trigger",
      });
      if (!error) saved++;
      // Unique-index conflict (23505) => already saved → silently skip.
    } catch { /* ignore */ }
  }
  if (saved) console.log(`[layered-memory] auto-saved ${saved} rule(s) from user message`);
  return { saved, hits };
}

/** Periodic decay — fire-and-forget. Archives unused low-weight topical rules. */
export async function decayOldMemories(supabase: any, userId: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("project_memory")
      .update({ archived: true })
      .eq("user_id", userId)
      .eq("scope", "topical")
      .eq("archived", false)
      .lte("weight", 1)
      .lt("last_used_at", cutoff);
  } catch { /* ignore */ }
}
