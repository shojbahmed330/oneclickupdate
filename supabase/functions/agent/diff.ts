// Diff helpers used by write_file / edit_file / multi_edit tools.
// We cap the before/after payloads we ship back to the chat UI to avoid
// huge tool outputs. The frontend renders an inline red/green line diff
// from these.

const DIFF_MAX_CHARS = 700; // keep tool results small; model can read_file if it needs full context

export function capDiffText(s: string): string {
  if (s.length <= DIFF_MAX_CHARS) return s;
  return s.slice(0, DIFF_MAX_CHARS) + `\n… [truncated ${s.length - DIFF_MAX_CHARS} chars]`;
}

export function diffStats(before: string, after: string): { additions: number; deletions: number } {
  if (before === after) return { additions: 0, deletions: 0 };
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  // Multiset-aware: duplicate identical lines aren't double-counted.
  const aCount = new Map<string, number>();
  for (const l of a) aCount.set(l, (aCount.get(l) ?? 0) + 1);
  const bCount = new Map<string, number>();
  for (const l of b) bCount.set(l, (bCount.get(l) ?? 0) + 1);
  let additions = 0, deletions = 0;
  for (const [l, c] of bCount) additions += Math.max(0, c - (aCount.get(l) ?? 0));
  for (const [l, c] of aCount) deletions += Math.max(0, c - (bCount.get(l) ?? 0));
  return { additions, deletions };
}
