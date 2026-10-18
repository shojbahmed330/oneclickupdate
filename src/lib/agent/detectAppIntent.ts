// Heuristic: does this prompt describe a NEW app/page/screen worth prototyping
// in Design Mode before writing React code?
//
// Triggers Design Mode for:
//   - "Build me a ...", "Create a ... app", "Make a shop / dashboard / portfolio"
//   - First message of a project (no prior assistant messages)
// Skips for:
//   - Edit/fix/tweak requests ("change the color", "fix the bug", "rename")
//   - Very short prompts (< 20 chars)
//   - Follow-up turns when project already has built UI

const BUILD_VERBS = [
  "build", "create", "make", "design", "generate", "scaffold", "start", "bootstrap",
  "তৈরি", "বানাও", "বানাও", "বানিয়ে", "বানা", "তৈরী",
];
const APP_NOUNS = [
  "app", "application", "page", "screen", "site", "website", "dashboard", "shop",
  "store", "portfolio", "blog", "landing", "tracker", "manager", "planner",
  "অ্যাপ", "এপ", "পেজ", "সাইট", "ড্যাশবোর্ড", "শপ", "স্টোর",
];
const EDIT_KEYWORDS = [
  "fix", "change", "update", "rename", "remove", "delete", "add a button",
  "tweak", "adjust", "color", "padding", "margin", "typo", "spelling",
  "ঠিক", "পরিবর্তন", "বদল", "সমস্যা", "এরর", "error", "bug", "broken",
];

export function shouldOfferDesignPreview(prompt: string, messageCount: number): boolean {
  const t = (prompt || "").toLowerCase().trim();
  if (t.length < 20) return false;
  // Only on first or very early turns
  if (messageCount > 1) return false;
  // Explicit edit intent → skip
  if (EDIT_KEYWORDS.some((k) => t.includes(k))) return false;
  const hasVerb = BUILD_VERBS.some((k) => t.includes(k));
  const hasNoun = APP_NOUNS.some((k) => t.includes(k));
  return hasVerb && hasNoun;
}
