import type { UIMessage } from "npm:ai@5.0.26";
import { compactToolInput, compactToolOutput } from "../agent/compact.ts";

function compressToolOutput(output: any): { value: any; compressed: boolean } {
  if (output == null) return { value: output, compressed: false };
  const next = compactToolOutput(output);
  return { value: next, compressed: next !== output };
}

function compressToolInput(input: any): { value: any; compressed: boolean } {
  if (input == null) return { value: input, compressed: false };
  const next = compactToolInput(input);
  return { value: next, compressed: next !== input };
}

/** One-line aggressive summary for old tool outputs (saves 5-10k tokens/turn). */
function summarizeToolOutputOneLine(toolName: string, input: any, output: any): string {
  const t = (toolName || "").replace(/^tool-/, "");
  const path = input?.path || input?.file || input?.target_file || input?.from || "";
  const ok = output?.ok ?? output?.success ?? (output?.error ? false : true);
  const err = output?.error;
  const status = ok ? "✓" : "✗";

  if (err) return `${status} ${t}${path ? ` ${path}` : ""} — error: ${String(err).slice(0, 120)}`;

  if (t === "read_file" || t === "view_file") {
    const chars = typeof output?.content === "string" ? output.content.length : (output?._originalChars ?? "?");
    return `📄 ${t} ${path} — ${chars} chars`;
  }
  if (t === "edit_file" || t === "line_replace") {
    return `✏️ ${t} ${path} — ${output?.replacements ?? output?.edits ?? "ok"}`;
  }
  if (t === "write_file" || t === "create_file") {
    return `📝 ${t} ${path} — written`;
  }
  if (t === "list_dir") {
    const n = Array.isArray(output?.entries) ? output.entries.length : (output?.count ?? "?");
    return `📁 ${t} ${path} — ${n} entries`;
  }
  if (t === "build_app" || t === "e2e_smoke_test") {
    return `${status} ${t} — ${output?.errorCount ?? 0} errors`;
  }
  return `${status} ${t}${path ? ` ${path}` : ""}`;
}

/**
 * Compress old tool results in two tiers:
 *  - verbatimTail (default 2): keep most-recent N messages full
 *  - aggressiveTail (default 6): messages between verbatimTail and aggressiveTail get standard compaction
 *  - older than aggressiveTail: collapse tool outputs to a single summary line
 */
export function compressOldToolResults(
  messages: UIMessage[],
  verbatimTail = 2,
  aggressiveTail = 6,
): { messages: UIMessage[]; compressedCount: number } {
  if (messages.length <= verbatimTail) return { messages, compressedCount: 0 };
  const verbatimCutoff = messages.length - verbatimTail;
  const aggressiveCutoff = messages.length - aggressiveTail;
  let compressedCount = 0;

  const out = messages.map((msg, idx) => {
    if (idx >= verbatimCutoff) return msg;
    const parts = (msg as any).parts;
    if (!Array.isArray(parts)) return msg;
    const aggressive = idx < aggressiveCutoff;
    let touched = false;
    const newParts = parts.map((p: any) => {
      if (!p || typeof p !== "object" || !p.type?.startsWith?.("tool-")) return p;

      if (aggressive && p.output !== undefined) {
        // Old turn → collapse output to one line; drop big input previews
        const summary = summarizeToolOutputOneLine(p.type, p.input, p.output);
        touched = true;
        compressedCount++;
        return {
          ...p,
          input: p.input ? { _summary: true } : p.input,
          output: { _summary: summary },
        };
      }

      let next = p;
      if (p.input !== undefined) {
        const r = compressToolInput(p.input);
        if (r.compressed) { touched = true; compressedCount++; next = { ...next, input: r.value }; }
      }
      if (p.output !== undefined) {
        const r = compressToolOutput(p.output);
        if (r.compressed) { touched = true; compressedCount++; next = { ...next, output: r.value }; }
      }
      return next;
    });
    return touched ? { ...(msg as any), parts: newParts } : msg;
  });
  return { messages: out, compressedCount };
}
