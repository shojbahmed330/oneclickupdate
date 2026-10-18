// Lightweight auto-validation that runs after every write_file / edit_file /
// multi_edit. Goal: catch obvious problems IN THE SAME tool response so the
// agent doesn't need a separate heal/build round-trip. Token-conservative —
// returns at most ~250 chars when something is wrong, otherwise an empty
// `validation` block (omitted from the tool result).
//
// What it does, fast:
//   1. Format the changed file with prettier (silent — no output unless error).
//   2. Tail dev-server log for new errors mentioning this path.
//   3. Track repeated failures per (path, errorMsg). After 3 hits → loop_break.
//   4. Hint about a sibling test file when present.
//
// What it deliberately does NOT do:
//   - Run full `tsc --noEmit` (slow, +3k tokens). The model can call `heal`.
//   - Run `eslint` automatically (slow). The model can call `lint`.
//   - Run `vitest` automatically. Surfaced as a hint only.

import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import { getRunState } from "./_runState.ts";
import { scanForSecrets, type SecretFinding } from "../../_shared/safetyGuards.ts";

const FMT_TIMEOUT = 12;
const LINT_TIMEOUT = 15;
const LOG_TAIL_LINES = 30;
const MAX_HMR_HITS = 3;
const MAX_LINT_ISSUES = 6;
const LOOP_THRESHOLD = 3;

function isFormattable(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|html)$/i.test(path);
}

function isCodeFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path);
}

async function siblingTestPath(sandbox: DaytonaSandbox, cwd: string, path: string): Promise<string | null> {
  if (!/\.(ts|tsx|js|jsx)$/.test(path) || /\.(test|spec)\./.test(path)) return null;
  const candidate = path.replace(/\.(tsx?|jsx?)$/, ".test.$1");
  try {
    const out = await sandbox.exec(`test -f '${cwd}/${candidate}' && echo Y || echo N`, cwd, 5);
    const flag = String((out as any).stdout ?? (out as any).result ?? "").trim();
    return flag === "Y" ? candidate : null;
  } catch { return null; }
}

async function tailLogForFile(sandbox: DaytonaSandbox, path: string): Promise<string[]> {
  try {
    const r = await sandbox.exec(
      `tail -n ${LOG_TAIL_LINES} /tmp/dev.log 2>/dev/null | grep -F '${path.replace(/'/g, "")}' | tail -n ${MAX_HMR_HITS} || true`,
      "/root", 6,
    );
    const raw = String((r as any).stdout ?? (r as any).result ?? "").trim();
    if (!raw) return [];
    return raw.split("\n").map((l) => l.trim()).filter((l) => /error|fail|cannot|undefined|missing|expected|unexpected/i.test(l));
  } catch { return []; }
}

export interface LintIssue {
  line?: number;
  col?: number;
  rule?: string;
  severity: "error" | "warning";
  message: string;
}

export interface AutoValidation {
  formatted?: boolean;
  hmrErrors?: string[];          // up to MAX_HMR_HITS
  lintErrors?: LintIssue[];      // per-file ESLint errors (top MAX_LINT_ISSUES)
  lintErrorCount?: number;       // total errors before truncation
  lintAdvice?: string;           // surfaced when lintErrors present — "fix this turn"
  testHint?: string;             // 1-line hint about sibling test
  loopBreak?: {                  // emitted when same (path, error) hit ≥ LOOP_THRESHOLD this turn
    attempts: number;
    pattern: string;
    advice: string;
  };
  secretLeak?: {                 // hardcoded API key / private key in committed code
    findings: SecretFinding[];
    advice: string;
  };
}

async function lintFile(sandbox: DaytonaSandbox, cwd: string, path: string): Promise<{ issues: LintIssue[]; total: number } | null> {
  if (!isCodeFile(path)) return null;
  try {
    // JSON output, only the changed file. `|| true` so non-zero exit (= lint errors found) doesn't blow up.
    const r = await sandbox.exec(
      `npx --no-install eslint --no-error-on-unmatched-pattern --format json '${cwd}/${path}' 2>/dev/null || true`,
      cwd, LINT_TIMEOUT,
    );
    const raw = String((r as any).stdout ?? (r as any).result ?? "").trim();
    if (!raw || !raw.startsWith("[")) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const messages = (parsed[0]?.messages ?? []) as Array<{ line?: number; column?: number; ruleId?: string | null; severity: number; message: string }>;
    const errors = messages.filter((m) => m.severity === 2);
    if (errors.length === 0) return null;
    const issues: LintIssue[] = errors.slice(0, MAX_LINT_ISSUES).map((m) => ({
      line: m.line,
      col: m.column,
      rule: m.ruleId ?? undefined,
      severity: "error",
      message: m.message.slice(0, 160),
    }));
    return { issues, total: errors.length };
  } catch {
    return null;
  }
}

export async function autoValidateAfterEdit(
  sandbox: DaytonaSandbox,
  cwd: string,
  path: string,
  ctx: any,
): Promise<AutoValidation | null> {
  const out: AutoValidation = {};

  // 1. Silent format (best-effort; ignore failures — code may not parse yet)
  if (isFormattable(path)) {
    try {
      await sandbox.exec(
        `npx -y prettier --write '${cwd}/${path}' 2>/dev/null >/dev/null || true`,
        cwd, FMT_TIMEOUT,
      );
      out.formatted = true;
    } catch { /* ignore */ }
  }

  // 2. HMR / vite log tail filtered by file path
  if (isCodeFile(path)) {
    const hmr = await tailLogForFile(sandbox, path);
    if (hmr.length) out.hmrErrors = hmr.map((l) => l.slice(0, 180));
  }

  // 2b. Per-file ESLint — only the changed file (~2-3s). Surfaces undefined vars,
  // missing imports, hook-order violations, unused identifiers BEFORE the model
  // moves on. Forces same-turn fix instead of needing a separate heal round-trip.
  const lint = await lintFile(sandbox, cwd, path);
  if (lint) {
    out.lintErrors = lint.issues;
    out.lintErrorCount = lint.total;
    out.lintAdvice =
      `🔧 ESLint reported ${lint.total} error(s) in this file. Fix them in THIS turn before moving on — ` +
      `these are the same errors that would otherwise blow up build_app/heal later. ` +
      `Common fixes: add missing import, remove unused var, move hook to top level, define undefined identifier.`;
  }

  // 3. Loop-break tracking (per turn). Key = path + first error signature.
  const state = getRunState(ctx);
  if (!(state as any).editAttempts) (state as any).editAttempts = new Map<string, number>();
  const attempts = (state as any).editAttempts as Map<string, number>;
  const sig = out.hmrErrors?.[0]?.slice(0, 80) ?? "";
  if (sig) {
    const key = `${path}|${sig}`;
    const n = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, n);
    if (n >= LOOP_THRESHOLD) {
      out.loopBreak = {
        attempts: n,
        pattern: sig,
        advice:
          "Same error after 3 attempts on this file. STOP — try a different approach (read the file fresh, " +
          "rewrite the whole component, switch library, or call ask_clarification to confirm intent).",
      };
    }
  }

  // 4. Sibling test hint (no auto-run — saves tokens)
  const sibling = await siblingTestPath(sandbox, cwd, path);
  if (sibling) out.testHint = `Sibling test exists: '${sibling}'. Call run_tests with pattern='${sibling}' to verify.`;

  // 5. Secret leak scan — only on committed code, not env files / edge funcs
  try {
    const content = await sandbox.readFile(`${cwd}/${path}`);
    const findings = scanForSecrets(path, content);
    if (findings.length) {
      out.secretLeak = {
        findings,
        advice:
          "🚨 Hardcoded secret detected in client/source code. Move it to a Lovable Cloud secret " +
          "(use the secrets tool) and read it from an edge function — never commit API keys to the repo.",
      };
    }
  } catch { /* file unreadable — skip */ }

  return Object.keys(out).length ? out : null;
}
