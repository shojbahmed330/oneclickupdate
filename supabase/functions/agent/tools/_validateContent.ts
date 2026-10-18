// Heuristic validator: detect when an LLM output was truncated mid-file
// (e.g. token cap hit while streaming a long write_file). When validation
// fails, the tool returns ok:false WITHOUT writing the file, so the agent
// retries with a fresh complete write instead of saving half a component.

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|html)$/i;

const TRUNCATION_TAILS = [
  /\/\/\s*\.{3,}\s*(rest|continue|truncated|more)?[^\n]*$/i,
  /\/\*\s*\.{3,}[^*]*\*\/\s*$/,
  /\.{3,}\s*$/,
  /<<<\s*TRUNCATED\s*>>>/i,
];

function balanced(content: string): { ok: boolean; reason?: string } {
  // Strip strings + comments before counting brackets to avoid false negatives.
  const stripped = content
    .replace(/\\./g, "")            // escaped chars
    .replace(/`[\s\S]*?`/g, "``")   // template literals
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const counts: Record<string, number> = { "{": 0, "}": 0, "(": 0, ")": 0, "[": 0, "]": 0 };
  for (const ch of stripped) if (ch in counts) counts[ch]++;
  if (counts["{"] !== counts["}"]) return { ok: false, reason: `unbalanced braces (${counts["{"]} open, ${counts["}"]} close)` };
  if (counts["("] !== counts[")"]) return { ok: false, reason: `unbalanced parens (${counts["("]}/${counts[")"]})` };
  if (counts["["] !== counts["]"]) return { ok: false, reason: `unbalanced brackets (${counts["["]}/${counts["]"]})` };
  return { ok: true };
}

function openTextState(content: string): string | null {
  let mode: null | "single" | "double" | "template" | "line" | "block" = null;
  let escape = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (mode === "line") {
      if (ch === "\n") mode = null;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") { mode = null; i++; }
      continue;
    }
    if (mode) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (mode === "single" && ch === "'") mode = null;
      else if (mode === "double" && ch === '"') mode = null;
      else if (mode === "template" && ch === "`") mode = null;
      continue;
    }

    if (ch === "/" && next === "/") { mode = "line"; i++; continue; }
    if (ch === "/" && next === "*") { mode = "block"; i++; continue; }
    if (ch === "'") mode = "single";
    else if (ch === '"') mode = "double";
    else if (ch === "`") mode = "template";
  }

  return mode && mode !== "line" ? `unterminated ${mode === "block" ? "block comment" : `${mode} string`}` : null;
}

// Per-extension hard line limits — write_file rejects content above these.
// Component/page authoring rule: split into subcomponents/hooks before hitting.
const LINE_LIMITS: Array<{ test: RegExp; max: number; kind: string }> = [
  { test: /\.(tsx|jsx)$/i, max: 300, kind: "component/page" },
  { test: /\.(ts|js|mjs|cjs)$/i, max: 350, kind: "module" },
  { test: /\.(css|scss)$/i, max: 600, kind: "stylesheet" },
  { test: /\.json$/i, max: 1000, kind: "json" },
  { test: /\.html$/i, max: 400, kind: "html" },
];

export function validateWriteContent(path: string, content: string):
  { ok: true } | { ok: false; reason: string } {
  if (!CODE_EXT.test(path)) return { ok: true };
  if (content.length === 0) return { ok: false, reason: "empty content" };

  const trimmed = content.trimEnd();
  for (const re of TRUNCATION_TAILS) {
    if (re.test(trimmed.split("\n").slice(-3).join("\n"))) {
      return { ok: false, reason: "file ends with a truncation marker (…) — looks incomplete" };
    }
  }

  // Hard line-count gate — forces modular files.
  const lineCount = content.split("\n").length;
  for (const { test, max, kind } of LINE_LIMITS) {
    if (test.test(path) && lineCount > max) {
      return {
        ok: false,
        reason:
          `file has ${lineCount} lines — HARD LIMIT for ${kind} files is ${max}. ` +
          `Split before writing: extract subcomponents to components/features/<feature>/, ` +
          `extract logic to hooks/use<Feature>.ts, move types to types/<feature>.ts. ` +
          `Then write each split file separately (each ≤ ${max} lines).`,
      };
    }
  }

  const openText = openTextState(content);
  if (openText) return { ok: false, reason: openText };

  // Reject only obvious continuation tails. Valid JS/TS often ends with a bare
  // identifier (`export default App`) because semicolons are optional; rejecting
  // every alphanumeric tail caused false "file ends with p" failures.
  const lastChar = trimmed.slice(-1);
  if (/[,.:+\-*\/%=!?:&|]$/.test(lastChar)) {
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) {
      return { ok: false, reason: `file ends with "${lastChar}" — likely cut off mid-statement` };
    }
  }

  if (/\.(ts|tsx|js|jsx|mjs|cjs|json)$/i.test(path)) {
    const b = balanced(content);
    if (!b.ok) return { ok: false, reason: b.reason! };
  }

  return { ok: true };
}
