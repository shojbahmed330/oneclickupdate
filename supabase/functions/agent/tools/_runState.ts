// Per-turn run state for build/heal — tracks iteration counts and previous
// error fingerprints so we can:
//   • dedupe repeated errors across iterations (no full dumps each retry)
//   • early-exit when the same errors appear twice in a row
//   • surface "top N" with overflow count instead of full TS spew
//
// Lives on the ToolCtx (lazy-attached). Resets per agent turn because a fresh
// ToolCtx is constructed for each /agent invocation.

export type ParsedError = {
  file?: string;
  line?: number;
  col?: number;
  message: string;
  kind: string;
  raw?: string;
};

export type RunState = {
  buildIter: number;
  healIter: number;
  lastBuildFingerprint: string;
  lastHealFingerprint: string;
  // Track files edited this turn so we can prioritize their errors.
  editedFiles: Set<string>;
};

export function getRunState(ctx: any): RunState {
  if (!ctx.__runState) {
    ctx.__runState = {
      buildIter: 0,
      healIter: 0,
      lastBuildFingerprint: "",
      lastHealFingerprint: "",
      editedFiles: new Set<string>(),
    } satisfies RunState;
  }
  return ctx.__runState as RunState;
}

export function fingerprint(errors: ParsedError[]): string {
  return errors
    .map((e) => `${e.kind}|${e.file ?? ""}|${e.line ?? ""}|${e.message.slice(0, 80)}`)
    .sort()
    .join("\n");
}

// Cap the error list and return overflow meta. Prioritises errors in files
// the agent edited THIS turn (most relevant), then the rest. Unrelated
// pre-existing errors get hidden behind a count.
export function topErrors(
  errors: ParsedError[],
  edited: Set<string>,
  topN = 10,
): { shown: ParsedError[]; hiddenCount: number; relatedTotal: number; unrelatedTotal: number } {
  const related: ParsedError[] = [];
  const unrelated: ParsedError[] = [];
  for (const e of errors) {
    if (e.file && edited.has(e.file)) related.push(e);
    else unrelated.push(e);
  }
  const shown = [...related, ...unrelated].slice(0, topN);
  return {
    shown,
    hiddenCount: Math.max(0, errors.length - shown.length),
    relatedTotal: related.length,
    unrelatedTotal: unrelated.length,
  };
}
