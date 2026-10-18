// Lightweight keyword/regex template matcher. Free + instant.
// Returns the best matching template id and a confidence score (0..1).
// Below 0.6 confidence the caller should treat as "no match" and let the
// agent build from scratch.

export type TemplateMatch = {
  templateId: string | null;
  confidence: number;
  matchedTerms: string[];
};

type Rule = {
  id: string;
  // Terms (lowercase). Each hit adds weight. Phrases (2+ words) weigh more.
  terms: Array<string | RegExp>;
};

const RULES: Rule[] = [
  {
    id: "ecommerce",
    terms: [
      "shop", "store", "ecommerce", "e-commerce", "e commerce",
      "online shop", "online store", "shopping app", "shopping website",
      "marketplace", "product", "products", "cart", "checkout", "buy",
      "sell online", "catalog", "catalogue", "boutique",
      /\bdokan\b/, /\bbikri\b/, /\bshop(?:ping)?\b/,
    ],
  },
  {
    id: "todo",
    terms: ["todo", "task", "tasks", "to-do", "to do", "notes app", "productivity tracker", "checklist", "reminder"],
  },
  {
    id: "chat",
    terms: ["chat app", "messaging app", "messenger", "whatsapp", "direct messages", "dm app"],
  },
  {
    id: "social",
    terms: ["social media", "social network", "instagram clone", "twitter clone", "feed app"],
  },
  {
    id: "fitness",
    terms: ["fitness", "workout", "gym tracker", "exercise tracker", "running app", "step counter"],
  },
  {
    id: "food",
    terms: ["food delivery", "restaurant order", "meal delivery", "uber eats", "doordash"],
  },
  {
    id: "blog",
    terms: ["blog app", "blogging platform", "medium clone", "article publishing"],
  },
  {
    id: "booking",
    terms: ["booking app", "appointment", "reservation", "calendar booking", "schedule meeting"],
  },
];

export function matchTemplate(prompt: string): TemplateMatch {
  const text = (prompt || "").toLowerCase();
  if (!text.trim()) return { templateId: null, confidence: 0, matchedTerms: [] };

  let best: { id: string; score: number; matched: string[] } = { id: "", score: 0, matched: [] };

  for (const rule of RULES) {
    let score = 0;
    const matched: string[] = [];
    for (const t of rule.terms) {
      if (t instanceof RegExp) {
        if (t.test(text)) { score += 0.4; matched.push(t.source); }
      } else {
        if (text.includes(t)) {
          // multi-word phrases weigh more
          score += t.includes(" ") ? 0.5 : 0.3;
          matched.push(t);
        }
      }
    }
    if (score > best.score) best = { id: rule.id, score, matched };
  }

  // Clamp confidence to [0, 1]
  const confidence = Math.min(1, best.score);
  if (!best.id || confidence < 0.3) {
    return { templateId: null, confidence, matchedTerms: [] };
  }
  return { templateId: best.id, confidence, matchedTerms: best.matched };
}
