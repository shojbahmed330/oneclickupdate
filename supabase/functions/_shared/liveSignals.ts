// Live runtime signals from the user's preview — console errors, network
// failures, current route, viewport. Sent verbatim from the client and
// formatted into a tiny context section so the agent can react without
// asking the user to paste logs.
//
// Token strategy: cap each list to 5 entries, each entry to ~200 chars.

const MAX_ENTRIES = 5;
const MAX_LINE = 220;

export interface LiveSignals {
  route?: string;             // e.g. "/dashboard/123"
  viewport?: { w: number; h: number };
  consoleErrors?: string[];   // recent error/warn lines
  networkFailures?: string[]; // url + status of failed requests
  buildErrors?: string[];     // last build error lines if any
}

const trim = (s: string) => (s.length > MAX_LINE ? s.slice(0, MAX_LINE) + "…" : s);

export function renderLiveSignals(sig?: LiveSignals | null): string {
  if (!sig) return "";
  const out: string[] = [];
  if (sig.route) out.push(`- route: ${sig.route}`);
  if (sig.viewport) out.push(`- viewport: ${sig.viewport.w}×${sig.viewport.h}`);
  if (sig.consoleErrors?.length) {
    out.push(`- console errors (${sig.consoleErrors.length}):`);
    for (const l of sig.consoleErrors.slice(-MAX_ENTRIES)) out.push(`    · ${trim(l)}`);
  }
  if (sig.networkFailures?.length) {
    out.push(`- network failures (${sig.networkFailures.length}):`);
    for (const l of sig.networkFailures.slice(-MAX_ENTRIES)) out.push(`    · ${trim(l)}`);
  }
  if (sig.buildErrors?.length) {
    out.push(`- last build errors (${sig.buildErrors.length}):`);
    for (const l of sig.buildErrors.slice(-MAX_ENTRIES)) out.push(`    · ${trim(l)}`);
  }
  if (out.length === 0) return "";
  return `## Live preview signals (from the user's browser this turn):\n${out.join("\n")}`;
}

/** First user-message-derived error/route text — used to seed smart retrieval. */
export function signalsToQueryHint(sig?: LiveSignals | null): { route?: string; errorText?: string } {
  if (!sig) return {};
  const errs = [...(sig.consoleErrors ?? []), ...(sig.buildErrors ?? []), ...(sig.networkFailures ?? [])];
  return { route: sig.route, errorText: errs.slice(-3).join("\n") };
}
