// Inline before/after line diff rendered inside an agent tool result.
// Uses an LCS table on lines to produce a Myers-like sequence of
// equal / add / del operations, then renders red/green rows. Capped to
// MAX_LINES rendered rows; user can expand to see all.

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Op = { kind: "eq" | "add" | "del"; line: string };

const MAX_LINES_COLLAPSED = 80;
const LCS_LINE_BUDGET = 1200; // skip LCS for huge files

function lineDiff(beforeText: string, afterText: string): Op[] {
  const a = beforeText ? beforeText.split("\n") : [];
  const b = afterText ? afterText.split("\n") : [];
  if (a.length === 0) return b.map((line) => ({ kind: "add" as const, line }));
  if (b.length === 0) return a.map((line) => ({ kind: "del" as const, line }));

  // Skip LCS for very long files — fall back to "all del then all add".
  if (a.length > LCS_LINE_BUDGET || b.length > LCS_LINE_BUDGET) {
    return [
      ...a.map((line) => ({ kind: "del" as const, line })),
      ...b.map((line) => ({ kind: "add" as const, line })),
    ];
  }

  // LCS table (rolling rows would be more memory-efficient but this is fine
  // for ≤1200 line files and we only need it once per render).
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ kind: "eq", line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ kind: "del", line: a[i] }); i++; }
    else { ops.push({ kind: "add", line: b[j] }); j++; }
  }
  while (i < n) ops.push({ kind: "del", line: a[i++] });
  while (j < m) ops.push({ kind: "add", line: b[j++] });
  return ops;
}

type Props = {
  before: string;
  after: string;
  path?: string;
  additions?: number;
  deletions?: number;
};

export const ChatInlineDiff = ({ before, after, path, additions, deletions }: Props) => {
  const ops = useMemo(() => lineDiff(before ?? "", after ?? ""), [before, after]);
  const [expanded, setExpanded] = useState(false);

  // For collapsed view: show a window centered on changes — keep up to N lines,
  // prioritising add/del rows (skip equal-only padding outside change clusters).
  const visible = useMemo(() => {
    if (expanded || ops.length <= MAX_LINES_COLLAPSED) return ops;
    // Find indices that are changes; show ±2 context around each cluster.
    const keep = new Array(ops.length).fill(false);
    const CTX = 2;
    for (let k = 0; k < ops.length; k++) {
      if (ops[k].kind !== "eq") {
        for (let z = Math.max(0, k - CTX); z <= Math.min(ops.length - 1, k + CTX); z++) keep[z] = true;
      }
    }
    const out: (Op | { kind: "gap"; line: string })[] = [];
    let inGap = false;
    for (let k = 0; k < ops.length; k++) {
      if (keep[k]) { out.push(ops[k]); inGap = false; }
      else if (!inGap) { out.push({ kind: "gap", line: "…" }); inGap = true; }
    }
    return out.slice(0, MAX_LINES_COLLAPSED + 4);
  }, [ops, expanded]);

  if (!before && !after) return null;
  const adds = additions ?? ops.filter((o) => o.kind === "add").length;
  const dels = deletions ?? ops.filter((o) => o.kind === "del").length;
  const truncated = !expanded && ops.length > MAX_LINES_COLLAPSED;

  return (
    <div className="mt-2 rounded-md border border-border bg-background/40 overflow-hidden font-mono text-[11.5px] leading-[1.55]">
      <div className="flex items-center gap-2 px-2.5 py-1 bg-muted/40 border-b border-border text-[11px]">
        <span className="text-muted-foreground truncate flex-1">
          {path ? `📄 ${path}` : "Diff"}
        </span>
        {adds > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{adds}</span>}
        {dels > 0 && <span className="text-rose-600 dark:text-rose-400 font-medium">−{dels}</span>}
      </div>
      <div className="max-h-[360px] overflow-auto">
        {visible.map((op, idx) => {
          if (op.kind === "gap") {
            return (
              <div key={`gap-${idx}`} className="px-2.5 py-0.5 text-muted-foreground/60 text-center select-none">
                ⋯
              </div>
            );
          }
          return (
            <div
              key={idx}
              className={cn(
                "px-2.5 whitespace-pre-wrap break-words",
                op.kind === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                op.kind === "del" && "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                op.kind === "eq" && "text-muted-foreground/80",
              )}
            >
              <span className="select-none mr-2 opacity-60">
                {op.kind === "add" ? "+" : op.kind === "del" ? "−" : " "}
              </span>
              {op.line || " "}
            </div>
          );
        })}
      </div>
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border-t border-border bg-muted/20"
        >
          <ChevronDown size={12} /> Show full diff ({ops.length} lines)
        </button>
      )}
    </div>
  );
};
