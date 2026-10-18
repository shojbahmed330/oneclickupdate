// Scope classifier — zero-LLM heuristic that labels the latest user turn as
// `narrow` | `broad` | `visual` | `ambiguous`. Cheap (regex only) and used by
// the runAgent prompt + the decision layer to gate clarification / plan / design.
//
// narrow   → a single concrete change (1-2 files), proceed directly
// visual   → wants UI tweak / "nicer/better/more elegant" → consider design directions
// broad    → new app / multi-feature build → propose_plan first
// ambiguous→ requirements unclear → ask_clarification
export type Scope = "narrow" | "broad" | "visual" | "ambiguous";

export interface ScopeResult {
  scope: Scope;
  confidence: number;        // 0..1
  reasons: string[];
  hint: string;              // 1-line system hint for the model
}

const VISUAL = /\b(design|color|colour|theme|font|style|palette|layout|hero|landing|prettier|nicer|elegant|beautiful|modern|wow|polish|sparkle|animation|animate|gradient|shadow|spacing)\b/i;
const VISUAL_BN = /(ডিজাইন|রঙ|রং|সুন্দর|থিম|ফন্ট|লেআউট|অ্যানিমেশন|আকর্ষণীয়|ভাল.{0,3}দেখ)/;

const BROAD = /\b(new app|build (a|an|me) |create (a|an|me) |scaffold|start (a|an) (project|app)|make (a|an|me)|full|complete|entire|admin panel|dashboard|with (auth|login|payment)|e-?commerce|marketplace|social network|clone)\b/i;
const BROAD_BN = /(নতুন এপ|এপ বানাও|app banao|বানাও|তৈরি কর|পুরো|সম্পূর্ণ|ফুল|অ্যাডমিন|ড্যাশবোর্ড|সব কিছু)/;

const NARROW = /\b(fix|change|update|rename|replace|set|move|remove|delete|add (a|an|the) (button|field|link|icon|prop|class|line|comment)|tweak|wire up|hook up)\b/i;
const NARROW_BN = /(ঠিক করো|বদল|বদলাও|রিনেম|যোগ কর|মুছ|রিমুভ|সরাও)/;

const AMBIGUOUS = /\b(something|somehow|maybe|perhaps|not sure|idk|i don't know|figure out|whatever|kind of|sort of|some sort)\b/i;
const AMBIGUOUS_BN = /(কিছু একটা|যেকোন|বুঝতেছিনা|বুঝতে পারছিনা|যা ভালো|তোমার ইচ্ছা)/;

const QUESTION = /\?/;

export function classifyScope(text: string): ScopeResult {
  const t = (text || "").trim();
  if (!t) return { scope: "narrow", confidence: 0.3, reasons: ["empty"], hint: "" };

  const wordCount = t.split(/\s+/).length;
  const reasons: string[] = [];
  let scope: Scope = "narrow";
  let confidence = 0.5;

  const isVisual = VISUAL.test(t) || VISUAL_BN.test(t);
  const isBroad = BROAD.test(t) || BROAD_BN.test(t);
  const isNarrow = NARROW.test(t) || NARROW_BN.test(t);
  const isAmbiguous = AMBIGUOUS.test(t) || AMBIGUOUS_BN.test(t) || (QUESTION.test(t) && wordCount < 8);

  if (isAmbiguous && !isNarrow) {
    scope = "ambiguous";
    confidence = 0.7;
    reasons.push("vague-language");
  } else if (isBroad && wordCount > 6) {
    scope = "broad";
    confidence = 0.8;
    reasons.push("new-app/multi-feature");
  } else if (isVisual && !isNarrow) {
    scope = "visual";
    confidence = 0.75;
    reasons.push("visual-refinement");
  } else if (isNarrow) {
    scope = "narrow";
    confidence = 0.85;
    reasons.push("concrete-edit");
  } else if (wordCount <= 4) {
    scope = "ambiguous";
    confidence = 0.55;
    reasons.push("very-short");
  }

  let hint = "";
  switch (scope) {
    case "narrow":
      hint = "Scope: NARROW — implement directly. Skip propose_plan / ask_clarification / design directions unless something is genuinely unclear.";
      break;
    case "visual":
      hint = "Scope: VISUAL — for non-trivial UI refinement consider `propose_design_directions` to show the user 2-3 options BEFORE editing. Skip for exact tweaks ('make this red').";
      break;
    case "broad":
      hint = "Scope: BROAD — call `propose_plan` FIRST and wait for approval before writing files. Don't start coding yet.";
      break;
    case "ambiguous":
      hint = "Scope: AMBIGUOUS — call `ask_clarification` ONCE with 2-4 multiple-choice options before doing anything else. Don't guess.";
      break;
  }

  return { scope, confidence, reasons, hint };
}
