// Aggressive turn-level history compression.
//
// `contextCompression.ts` already shrinks individual tool inputs/outputs.
// This file goes one level higher: when there are many old turns, fold the
// oldest N into a single `[older turns summary]` system message so the model
// keeps situational awareness without paying full per-turn token cost.
//
// Strategy:
//   - Always preserve the LAST `keepRecent` messages verbatim.
//   - Older messages → produce a 1-message structured summary:
//       • user requests (deduped, last 6)
//       • files touched (deduped)
//       • tools used (counts, top 8)
//       • files with repeated edits (potential trouble spots)
//       • last assistant text snippet
//       • open errors / blockers (heuristic scan)
//   - Skip compression entirely if recent < threshold (no benefit).
//   - Returns the summary message + the verbatim tail.

import type { UIMessage } from "npm:ai@5.0.26";

const DEFAULT_KEEP = 8;            // was 12 — tighter window forces earlier folding
const MIN_FOLD = 4;                // don't bother folding fewer than 4 messages
const MAX_FILES_LIST = 24;
const MAX_USER_QUOTE = 110;
const MAX_USER_QS = 6;

function textOf(m: any): string {
  if (typeof m?.content === "string") return m.content;
  const parts = m?.parts;
  if (Array.isArray(parts)) {
    return parts.filter((p: any) => p?.type === "text").map((p: any) => p.text || "").join(" ");
  }
  return "";
}

function collectStats(messages: any[]): {
  tools: Record<string, number>;
  files: Set<string>;
  fileEdits: Map<string, number>;     // file → # of write/edit ops
  errorHints: string[];               // last few error-ish lines from tool results
} {
  const tools: Record<string, number> = {};
  const files = new Set<string>();
  const fileEdits = new Map<string, number>();
  const errorHints: string[] = [];

  for (const m of messages) {
    const parts = m?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p?.type !== "string" || !p.type.startsWith("tool-")) continue;
      const name = p.type.slice(5);
      tools[name] = (tools[name] ?? 0) + 1;

      const path = p?.input?.path;
      if (typeof path === "string") {
        files.add(path);
        if (/^(write_file|edit_file|multi_edit)$/.test(name)) {
          fileEdits.set(path, (fileEdits.get(path) ?? 0) + 1);
        }
      }

      // Scan tool outputs for the most recent error-ish lines (cap at 3).
      if (errorHints.length < 3) {
        const out = p?.output;
        const flat = typeof out === "string" ? out : JSON.stringify(out ?? "").slice(0, 1500);
        const m2 = flat.match(/(Cannot find|is not defined|Type ['"]?[\w]+['"]? is not assignable|Module not found|ReferenceError|TypeError|Failed to compile|ERESOLVE)[^\n"'}]{0,140}/i);
        if (m2) errorHints.push(m2[0].slice(0, 160));
      }
    }
  }
  return { tools, files, fileEdits, errorHints };
}

export interface CompressionResult {
  messages: UIMessage[];
  summarized: number;
}

export function compressHistory(messages: UIMessage[], keepRecent = DEFAULT_KEEP): CompressionResult {
  if (messages.length <= keepRecent + MIN_FOLD) return { messages, summarized: 0 };

  const cut = messages.length - keepRecent;
  const old = messages.slice(0, cut) as any[];
  const tail = messages.slice(cut);

  const userQs: string[] = [];
  const seenQs = new Set<string>();
  let lastAssistant = "";
  for (const m of old) {
    if (m.role === "user") {
      const t = textOf(m).trim();
      if (!t) continue;
      const k = t.slice(0, 50).toLowerCase();
      if (seenQs.has(k)) continue;
      seenQs.add(k);
      userQs.push(t.slice(0, MAX_USER_QUOTE));
    } else if (m.role === "assistant") {
      const t = textOf(m).trim();
      if (t) lastAssistant = t.slice(0, 220);
    }
  }
  const { tools, files, fileEdits, errorHints } = collectStats(old);

  const toolLine = Object.entries(tools)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => `${k}×${v}`).join(", ");
  const fileList = [...files].slice(0, MAX_FILES_LIST);

  // Trouble spots = files written/edited 3+ times in the folded window.
  const troubleSpots = [...fileEdits.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f, n]) => `${f}(×${n})`);

  const summary = [
    `[older turns summary — ${old.length} msgs folded]`,
    userQs.length ? `User asked: ${userQs.slice(0, MAX_USER_QS).map((q) => `“${q}”`).join("; ")}` : "",
    toolLine ? `Tools used: ${toolLine}` : "",
    fileList.length ? `Files touched: ${fileList.join(", ")}${files.size > fileList.length ? `, +${files.size - fileList.length} more` : ""}` : "",
    troubleSpots.length ? `⚠ Repeatedly edited (potential trouble spots): ${troubleSpots.join(", ")}` : "",
    errorHints.length ? `Errors seen earlier: ${errorHints.join(" | ")}` : "",
    lastAssistant ? `Last assistant note: ${lastAssistant}` : "",
  ].filter(Boolean).join("\n");

  const summaryMsg: any = {
    id: `summary-${Date.now()}`,
    role: "system",
    parts: [{ type: "text", text: summary }],
  };

  return { messages: [summaryMsg, ...tail] as UIMessage[], summarized: old.length };
}
