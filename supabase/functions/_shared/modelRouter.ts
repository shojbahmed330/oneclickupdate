// Model Router — picks the cheapest Claude model that can handle the turn.
//
// Rules of thumb (matches systemPrompt guidance):
//   - Simple/cosmetic edits, single-file tweaks, copy changes  → Haiku  (fast+cheap)
//   - Anything else (multi-file, new feature, debug, refactor) → Sonnet (default)
//   - User-overridden via `?model=` query or `x-agent-model` header wins.
//
// Heuristics are intentionally conservative: when in doubt → Sonnet.

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-5-20250929";
// OpenRouter fallback IDs (used when Anthropic provider fails or as cross-provider backup)
const OR_HAIKU = "anthropic/claude-3-5-haiku-20241022";
const OR_SONNET = "anthropic/claude-3-5-sonnet-20241022";
const OR_GPT5 = "openai/gpt-5";
const OR_GEMINI_PRO = "google/gemini-2.5-pro";

const COMPLEX_KEYWORDS = [
  "refactor", "architecture", "design", "schema", "migration", "auth",
  "database", "rls", "policy", "scaffold", "admin panel", "build the",
  "implement", "create app", "new feature", "debug", "fix the bug",
  "error", "broken", "doesn't work", "not working", "stripe", "payment",
  "supabase", "edge function", "stream", "realtime",
];

const SIMPLE_KEYWORDS = [
  "rename", "typo", "spelling", "color", "padding", "margin", "spacing",
  "font size", "text size", "change text", "update text", "label",
  "placeholder", "icon", "button color", "title", "heading",
];

// Reasoning-heavy keywords → bias to highest-capability tier
const REASONING_KEYWORDS = [
  "algorithm", "optimize", "complexity", "proof", "explain why",
  "architecture review", "race condition", "deadlock", "concurrency",
];

export interface RouteContext {
  lastUserText: string;
  messageCount: number;
  override?: string | null;
  mode?: string; // "edit" | "ask" | etc.
  hasImages?: boolean;
}

export interface RouteDecision {
  modelId: string;
  reason: string;
  tier: "haiku" | "sonnet" | "vision" | "reasoning" | "override";
  /** Ordered fallback model IDs (cross-provider). First entry = primary alternative. */
  fallbacks: string[];
}

export function pickModel(ctx: RouteContext): RouteDecision {
  const override = (ctx.override || "").trim();
  if (override) {
    return { modelId: override, reason: "user override", tier: "override", fallbacks: [OR_SONNET, OR_GPT5] };
  }

  const text = (ctx.lastUserText || "").toLowerCase().trim();
  const len = text.length;

  // Reasoning-heavy keywords → top tier with reasoning fallbacks
  if (REASONING_KEYWORDS.some((k) => text.includes(k))) {
    return {
      modelId: SONNET,
      reason: "reasoning keyword",
      tier: "reasoning",
      fallbacks: [OR_GPT5, OR_GEMINI_PRO, OR_SONNET],
    };
  }

  if (!text) return { modelId: SONNET, reason: "no user text", tier: "sonnet", fallbacks: [OR_SONNET] };
  if (len > 280) return { modelId: SONNET, reason: "long prompt", tier: "sonnet", fallbacks: [OR_SONNET, OR_GPT5] };
  if (ctx.messageCount > 14) {
    return { modelId: SONNET, reason: "long conversation", tier: "sonnet", fallbacks: [OR_SONNET, OR_GPT5] };
  }

  if (COMPLEX_KEYWORDS.some((k) => text.includes(k))) {
    return { modelId: SONNET, reason: "complex keyword", tier: "sonnet", fallbacks: [OR_SONNET, OR_GPT5] };
  }

  const hitsSimple = SIMPLE_KEYWORDS.some((k) => text.includes(k));
  if (hitsSimple && len < 160) {
    return { modelId: HAIKU, reason: "simple cosmetic edit", tier: "haiku", fallbacks: [OR_HAIKU, OR_SONNET] };
  }
  if (len < 80) return { modelId: HAIKU, reason: "very short prompt", tier: "haiku", fallbacks: [OR_HAIKU, OR_SONNET] };

  return { modelId: SONNET, reason: "default", tier: "sonnet", fallbacks: [OR_SONNET, OR_GPT5] };
}

export function extractLastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const parts = m.parts ?? [];
    if (Array.isArray(parts)) {
      return parts.filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n");
    }
  }
  return "";
}

// ─── Context window manager ─────────────────────────────────
// Rough char→token (~4 chars/token). Anthropic 200k, GPT-5 128k.
// We aim for ≤ 120k tokens of message payload (leaves room for tools+system).
const TOKEN_BUDGET = 120_000;
const CHARS_PER_TOKEN = 4;
const RECENT_KEEP = 10; // never drop the last N turns

export function estimateTokens(messages: any[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m?.content === "string") chars += m.content.length;
    else if (Array.isArray(m?.parts)) {
      for (const p of m.parts) chars += String(p?.text ?? "").length;
    } else if (Array.isArray(m?.content)) {
      for (const p of m.content) chars += String((p as any)?.text ?? "").length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Drop oldest messages until under TOKEN_BUDGET, preserving last RECENT_KEEP turns. */
export function clampToBudget<T = any>(messages: T[]): { messages: T[]; dropped: number } {
  if (messages.length <= RECENT_KEEP) return { messages, dropped: 0 };
  let arr = [...messages];
  let dropped = 0;
  while (estimateTokens(arr) > TOKEN_BUDGET && arr.length > RECENT_KEEP) {
    arr.shift();
    dropped++;
  }
  return { messages: arr, dropped };
}

