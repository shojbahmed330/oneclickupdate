// Helpers for enriching parsed errors with file-snippet context + a category
// label + a targeted hint. Goal: model fixes the error WITHOUT a separate
// read_file round-trip.
//
// Token-conservative:
//   • Snippets only for the top N errors (default 4).
//   • Snippet = ±3 lines around error.line (≤ 7 lines total per error).
//   • File reads are cached per-call so the same file isn't re-read.

import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ParsedError } from "./_runState.ts";

const MAX_ENRICHED = 4;
const CONTEXT_RADIUS = 3;
const MAX_LINE_LEN = 200;

export type ErrorCategory =
  | "missing_import"
  | "module_not_found"
  | "type_mismatch"
  | "undefined_identifier"
  | "syntax"
  | "hook_misuse"
  | "jsx"
  | "runtime_reference"
  | "runtime_type"
  | "build"
  | "vite"
  | "unknown";

export interface EnrichedError extends ParsedError {
  category?: ErrorCategory;
  hint?: string;
  snippet?: string;          // ±3 lines around error.line, with line numbers
}

const CATEGORY_RULES: Array<{ test: RegExp; cat: ErrorCategory; hint: string }> = [
  { test: /Cannot find module ['"]([^'"]+)['"]/i, cat: "module_not_found",
    hint: "Module not installed or wrong path. Check: (1) package installed via install_dep, (2) path-alias '@/...' resolves, (3) .ts/.tsx extension correct. Don't add '.ts' to import paths." },
  { test: /has no exported member|does not provide an export named/i, cat: "missing_import",
    hint: "Wrong import name or default vs named. Check the source file's exports — `export default` needs `import X from`, `export { X }` needs `import { X } from`." },
  { test: /Cannot find name ['"]([^'"]+)['"]/i, cat: "undefined_identifier",
    hint: "Identifier never defined or imported. Either add the import (e.g. `import { Heart } from 'lucide-react'`) or define the variable/function above its usage." },
  { test: /is not assignable to type|Type ['"][^'"]+['"] is not assignable/i, cat: "type_mismatch",
    hint: "Real type mismatch — fix the type, do NOT cast with `as any`. If a Supabase row, regenerate types. If a prop, narrow the union." },
  { test: /Property ['"][^'"]+['"] does not exist on type/i, cat: "type_mismatch",
    hint: "Property missing on the type. Check spelling, add to interface, or null-guard with `?.`." },
  { test: /React Hook ['"][^'"]+['"] (?:is called conditionally|cannot be called)/i, cat: "hook_misuse",
    hint: "Hook called inside if/loop/callback/after-return. Move ALL hooks to the top level of the component. Conditionals go AFTER hooks." },
  { test: /JSX element|Adjacent JSX elements must be wrapped/i, cat: "jsx",
    hint: "JSX issue — wrap siblings in `<>...</>` or `<div>`. Self-closing tags need `/>`." },
  { test: /Unexpected token|Expression expected|Declaration or statement expected/i, cat: "syntax",
    hint: "Syntax error — usually missing brace/paren/semicolon, or stray character. Read the line and the one above it." },
  { test: /ReferenceError: ([^\s]+) is not defined/i, cat: "runtime_reference",
    hint: "Runtime ReferenceError — the variable/function used at runtime is undefined. Check imports and that it's defined before use. Often a missing import or wrong scope." },
  { test: /TypeError: Cannot read prop(?:erties|erty) of (undefined|null)/i, cat: "runtime_type",
    hint: "Runtime null-access — null-guard with `?.` or check the data exists before destructuring. Often a Supabase response without `if (error)` check." },
  { test: /Failed to compile|Module not found/i, cat: "build",
    hint: "Build-time module error — check the import path and that the dep is installed." },
];

function categorize(err: ParsedError): { cat: ErrorCategory; hint: string } {
  const msg = err.message || err.raw || "";
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(msg)) return { cat: rule.cat, hint: rule.hint };
  }
  if (err.kind === "vite") return { cat: "vite", hint: "Vite/HMR error — check the dev-server log line and the file at the reported location." };
  if (err.kind === "build") return { cat: "build", hint: "Build error — see the message and fix at the reported file/line." };
  if (err.kind === "runtime") return { cat: "runtime_reference", hint: "Runtime error — call read_console_logs for the full stack." };
  return { cat: "unknown", hint: "Read the file at the reported line and address the message directly." };
}

function formatSnippet(content: string, line: number): string {
  const lines = content.split("\n");
  const start = Math.max(0, line - 1 - CONTEXT_RADIUS);
  const end = Math.min(lines.length, line + CONTEXT_RADIUS);
  const width = String(end).length;
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const num = String(i + 1).padStart(width, " ");
    const marker = i + 1 === line ? ">" : " ";
    let text = lines[i] ?? "";
    if (text.length > MAX_LINE_LEN) text = text.slice(0, MAX_LINE_LEN) + "…";
    out.push(`${marker} ${num} | ${text}`);
  }
  return out.join("\n");
}

export async function enrichErrors(
  sandbox: DaytonaSandbox,
  cwd: string,
  errors: ParsedError[],
): Promise<{ enriched: EnrichedError[]; hasRuntime: boolean }> {
  const cache = new Map<string, string | null>();
  const enriched: EnrichedError[] = [];
  let snippetBudget = MAX_ENRICHED;
  let hasRuntime = false;

  for (const err of errors) {
    const { cat, hint } = categorize(err);
    if (cat === "runtime_reference" || cat === "runtime_type") hasRuntime = true;
    const out: EnrichedError = { ...err, category: cat, hint };

    if (snippetBudget > 0 && err.file && err.line) {
      const path = err.file.startsWith("/") ? err.file : `${cwd}/${err.file}`;
      let content = cache.get(path);
      if (content === undefined) {
        try { content = await sandbox.readFile(path); }
        catch { content = null; }
        cache.set(path, content);
      }
      if (content) {
        out.snippet = formatSnippet(content, err.line);
        snippetBudget--;
      }
    }
    enriched.push(out);
  }
  return { enriched, hasRuntime };
}
