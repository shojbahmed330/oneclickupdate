// Dynamic context builder — assembles per-turn enrichment for the agent:
//   1. Project tree summary (top files in sandbox)
//   2. @file mentions from last user message → inject file contents
//   3. Sliding window: summarize older messages, keep last 20 verbatim
//   4. Project memory rules from project_memory table
//
// Returns a single string to inject as a system message, plus the
// (possibly trimmed) message list to send to the model.

import type { DaytonaSandbox } from "./daytona.ts";
import type { UIMessage } from "npm:ai@5.0.26";
import { compressOldToolResults } from "./contextCompression.ts";
import { predictRelevantFiles, renderPredictedFiles } from "./smartRetrieval.ts";
import { renderLiveSignals, signalsToQueryHint, type LiveSignals } from "./liveSignals.ts";
import { computeDepImpact } from "./depGraph.ts";
import { loadLayeredMemory, renderLayeredMemory } from "./layeredMemory.ts";

const RECENT_KEEP = 6;          // keep a short local window; older is summarized
const KEEP_VERBATIM_TAIL = 1;   // only the current/latest user msg stays verbatim
const MAX_FILES_TREE = 30;
const MAX_MENTIONS = 3;        // user usually mentions 2-3; 8 was overkill
const MAX_HEAD_BYTES = 1500;   // first slice (imports, types, top-level decls)
const MAX_TAIL_BYTES = 1000;   // last slice (exports, default export, hooks)
const SMALL_FILE_THRESHOLD = MAX_HEAD_BYTES + MAX_TAIL_BYTES + 400; // send whole file under this
const MAX_MEMORY = 20;

function extractText(m: any): string {
  if (typeof m?.content === "string") return m.content;
  const parts = m?.parts ?? [];
  if (Array.isArray(parts)) {
    return parts.filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n");
  }
  return "";
}

// Quick non-cryptographic hash so we can log cache invalidations cheaply.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Compact tree — used ONLY on the very first turn so the agent has a sense
// of what the scaffold contains. Subsequent turns rely on the deferred
// `project_tree` / `list_dir` tools, saving ~1 000 tokens per turn.
// Files are grouped by directory and config/test/.d.ts noise is filtered out.
async function projectTree(sandbox: DaytonaSandbox, cwd: string): Promise<{ tree: string; hash: string; count: number }> {
  try {
    const r = await sandbox.exec(
      `find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -path ./build -prune -o -path ./.next -prune -o -path ./android -prune -o -path ./ios -prune -o -type f \\( -name '*.tsx' -o -name '*.ts' -o -name '*.css' -o -name '*.html' -o -name 'package.json' -o -name 'tailwind.config.*' -o -name 'vite.config.*' -o -name 'capacitor.config.*' \\) ! -name '*.test.*' ! -name '*.spec.*' ! -name '*.d.ts' ! -name 'vite-env*' -printf '%p|%s|%T@\\n' 2>/dev/null | sort | head -n ${MAX_FILES_TREE * 4}`,
      cwd, 10,
    );
    const raw = String((r as any).stdout ?? (r as any).result ?? "").trim();
    if (!raw) return { tree: "", hash: "00000000", count: 0 };
    const lines = raw.split("\n");
    const hash = fnv1a(lines.join("\n"));
    const paths = lines.slice(0, MAX_FILES_TREE).map((l) => l.split("|")[0].replace(/^\.\//, ""));
    // Compact: group files by directory.
    const byDir = new Map<string, string[]>();
    for (const p of paths) {
      const idx = p.lastIndexOf("/");
      const dir = idx === -1 ? "." : p.slice(0, idx);
      const file = idx === -1 ? p : p.slice(idx + 1);
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(file);
    }
    const out: string[] = [];
    for (const [dir, files] of [...byDir.entries()].sort()) {
      out.push(`${dir}/  ${files.join(", ")}`);
    }
    return { tree: out.join("\n"), hash, count: paths.length };
  } catch { return { tree: "", hash: "00000000", count: 0 }; }
}

// Smart head+tail truncation: keep imports/types up top + exports/default down
// bottom; skip the middle. Common case has enough signal here; the agent can
// always pull the full file via read_file when needed.
function smartTruncate(content: string): { body: string; truncated: boolean } {
  const len = content.length;
  if (len <= SMALL_FILE_THRESHOLD) return { body: content, truncated: false };
  const head = content.slice(0, MAX_HEAD_BYTES);
  const tail = content.slice(-MAX_TAIL_BYTES);
  const skipped = len - MAX_HEAD_BYTES - MAX_TAIL_BYTES;
  const body =
    head +
    `\n\n… [middle ${skipped} bytes truncated — call read_file to fetch the full ${len}-byte source] …\n\n` +
    tail;
  return { body, truncated: true };
}

async function fileMentions(
  sandbox: DaytonaSandbox,
  cwd: string,
  text: string,
  history: UIMessage[],
): Promise<{ blobs: string[]; hash: string; deduped: number }> {
  const re = /@([a-zA-Z0-9_./\\-]+\.(?:tsx?|jsx?|css|json|md|html|svg))/g;
  const seen = new Set<string>();
  const blobs: string[] = [];
  const hashParts: string[] = [];
  let deduped = 0;

  // Build a haystack of prior conversation text — used to skip re-injecting
  // the same `@path (sha:HASH)` blob if it already appeared earlier.
  const historyHaystack = history
    .map((m) => extractText(m))
    .filter(Boolean)
    .join("\n");

  for (const m of text.matchAll(re)) {
    const path = m[1].replace(/^\/+/, "");
    if (seen.has(path)) continue;
    seen.add(path);
    if (seen.size > MAX_MENTIONS) break;
    try {
      const content = await sandbox.readFile(`${cwd}/${path}`);
      const fileHash = fnv1a(content);
      hashParts.push(`${path}:${fileHash}`);

      // Dedupe: same file+hash already shown earlier? Emit a 1-line stub.
      const marker = `@${path} (sha:${fileHash}`;
      if (historyHaystack.includes(marker)) {
        deduped++;
        blobs.push(`### @${path} (sha:${fileHash}) — unchanged since earlier in this conversation; call read_file if you need the body again.`);
        continue;
      }

      const { body, truncated } = smartTruncate(content);
      const header = truncated
        ? `### @${path} (sha:${fileHash}, ${content.length} bytes — head+tail)`
        : `### @${path} (sha:${fileHash})`;
      blobs.push(`${header}\n\`\`\`\n${body}\n\`\`\``);
    } catch { /* file not found, skip */ }
  }
  return { blobs, hash: fnv1a(hashParts.join("|")), deduped };
}

async function memoryRules(supabase: any, projectId: string, userId: string): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("project_memory")
      .select("category, content, weight")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("weight", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(MAX_MEMORY);
    return (data ?? []).map((m: any) => `- [${m.category}] ${m.content}`);
  } catch { return []; }
}

function summarizeOlder(older: UIMessage[]): string | null {
  if (older.length === 0) return null;
  const userNotes: string[] = [];
  let lastAssistant = "";
  for (const m of older) {
    const text = extractText(m).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (m.role === "user") userNotes.push(text.slice(0, 120));
    if (m.role === "assistant") lastAssistant = text.slice(0, 180);
  }
  const notes = userNotes.slice(-4).map((q) => `- user: ${q}`).join("\n");
  return [
    `${older.length} older message(s) folded deterministically; full tool payloads omitted.`,
    notes,
    lastAssistant ? `- last assistant note: ${lastAssistant}` : "",
  ].filter(Boolean).join("\n");
}

export interface DynamicContext {
  contextSystem: string | null;
  messages: UIMessage[];
}

/** Pull paths from prior assistant tool calls (write_file/edit_file/multi_edit) — used for dep-impact hint. */
function recentlyEditedPaths(messages: UIMessage[], limit = 5): string[] {
  const out = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && out.size < limit; i--) {
    const parts = (messages[i] as any).parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p?.type !== "string" || !p.type.startsWith("tool-")) continue;
      const name = p.type.replace(/^tool-/, "");
      if (!/^(write_file|edit_file|multi_edit)$/.test(name)) continue;
      const inp = p.input ?? {};
      const path = inp.path ?? inp.file ?? inp.target_file;
      if (typeof path === "string") out.add(path.replace(/^\.?\//, ""));
      if (Array.isArray(inp.edits)) for (const e of inp.edits) if (typeof e?.path === "string") out.add(e.path.replace(/^\.?\//, ""));
    }
  }
  return [...out];
}

export async function buildDynamicContext(opts: {
  sandbox: DaytonaSandbox;
  supabase: any;
  projectId: string;
  userId: string;
  messages: UIMessage[];
  cwd?: string;
  isFirstTurn?: boolean;
  liveSignals?: LiveSignals | null;
}): Promise<DynamicContext> {
  const cwd = opts.cwd ?? "/root/app";
  const sections: string[] = [];

  // Run independent fetches in parallel
  const lastUser = [...opts.messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUser ? extractText(lastUser) : "";

  const older = opts.messages.length > RECENT_KEEP
    ? opts.messages.slice(0, opts.messages.length - RECENT_KEEP)
    : [];
  const recentRaw = older.length ? opts.messages.slice(-RECENT_KEEP) : opts.messages;
  // Compress old tool outputs (everything except the tail) — biggest token win.
  const { messages: recent, compressedCount } = compressOldToolResults(recentRaw, KEEP_VERBATIM_TAIL);

  // History haystack — used for tree-hash dedupe and predicted-file dedupe.
  const historyHaystack = opts.messages
    .slice(0, -1)
    .map((m) => extractText(m as any))
    .filter(Boolean)
    .join("\n");

  // Tree: full body on first turn, then a tiny digest each turn (cached by hash —
  // if the same fingerprint already appeared earlier we just send a 1-line ref).
  const wantFullTree = !!opts.isFirstTurn;
  const editedPaths = recentlyEditedPaths(opts.messages);
  const sigHint = signalsToQueryHint(opts.liveSignals);

  const [treeRes, mentionRes, mem, summary, depRes] = await Promise.all([
    projectTree(opts.sandbox, cwd),
    lastUserText
      ? fileMentions(opts.sandbox, cwd, lastUserText, opts.messages.slice(0, -1))
      : Promise.resolve({ blobs: [], hash: "00000000", deduped: 0 }),
    loadLayeredMemory({ supabase: opts.supabase, userId: opts.userId, projectId: opts.projectId, query: lastUserText }),
    Promise.resolve(summarizeOlder(older)),
    editedPaths.length
      ? computeDepImpact(opts.sandbox, cwd, editedPaths, { maxResults: 8, transitiveDepth: 1 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Smart retrieval — predict 1-3 relevant files from query+route+errors.
  // Skip files already covered by @mentions to avoid duplication.
  const mentionedPaths = new Set<string>();
  for (const blob of mentionRes.blobs) {
    const m = blob.match(/^### @([^\s]+)/m);
    if (m) mentionedPaths.add(m[1]);
  }
  const predicted = lastUserText
    ? await predictRelevantFiles({
        sandbox: opts.sandbox, cwd,
        query: lastUserText, route: sigHint.route, errorText: sigHint.errorText,
        excludePaths: mentionedPaths, historyHaystack,
        recentlyEdited: editedPaths,
      }).catch(() => ({ files: [], hash: "00000000", deduped: 0, importExpanded: 0 }))
    : { files: [], hash: "00000000", deduped: 0, importExpanded: 0 };

  console.log(
    `[ctx] tree=${treeRes.hash}(${treeRes.count}) ` +
    `mentions=${mentionRes.hash}${mentionRes.deduped ? `(deduped:${mentionRes.deduped})` : ""} ` +
    `predicted=${predicted.files.length}${predicted.deduped ? `(deduped:${predicted.deduped})` : ""} ` +
    `mem=core${mem.core.length}/user${mem.user.length}/topical${mem.topical.length} ` +
    `recent=${recent.length} older=${older.length} ` +
    `compressedTools=${compressedCount}${summary ? " summary=on" : ""}` +
    `${depRes ? ` dep=${depRes.direct_importers.length}+${depRes.transitive.length}` : ""}` +
    `${opts.liveSignals ? " signals=on" : ""}`,
  );

  const memRendered = renderLayeredMemory(mem);
  if (memRendered) sections.push(memRendered);

  // Tree section: if hash already appeared in history, send 1-line ref only.
  const treeAlreadyShown = treeRes.hash !== "00000000" && historyHaystack.includes(`fingerprint:${treeRes.hash}`);
  if (treeRes.tree) {
    if (treeAlreadyShown) {
      sections.push(`## Project files (${treeRes.count}, fingerprint:${treeRes.hash}) — unchanged since earlier this conversation. Call \`list_dir\` if you need a refresher.`);
    } else if (wantFullTree) {
      sections.push(
        `## Project files (${treeRes.count}, fingerprint:${treeRes.hash}) — full snapshot.\n` +
        "```\n" + treeRes.tree + "\n```",
      );
    } else {
      sections.push(`## Project files (${treeRes.count}, fingerprint:${treeRes.hash}) — tree omitted to save tokens. Call \`project_tree\` or \`list_dir\` only if needed.`);
    }
  }

  if (mentionRes.blobs.length) {
    sections.push(`## Files referenced by the user with @mention (hash:${mentionRes.hash}):\n${mentionRes.blobs.join("\n\n")}`);
  }

  const predictedRendered = renderPredictedFiles(predicted.files);
  if (predictedRendered) sections.push(predictedRendered);

  if (depRes && (depRes.direct_importers.length || depRes.transitive.length)) {
    const dirs = depRes.direct_importers.slice(0, 6).join(", ");
    const trans = depRes.transitive.slice(0, 4).join(", ");
    sections.push(
      `## Dependency impact (recent edits → ${depRes.changed.slice(0, 3).join(", ")}):\n` +
      `- direct importers: ${dirs || "none"}\n` +
      (trans ? `- transitive (depth 1): ${trans}\n` : "") +
      `- ${depRes.hint}`,
    );
  }

  const signalsRendered = renderLiveSignals(opts.liveSignals);
  if (signalsRendered) sections.push(signalsRendered);

  if (summary) {
    sections.push(`## Earlier conversation summary (older messages compressed):\n${summary}`);
  }

  return {
    contextSystem: sections.length ? sections.join("\n\n") : null,
    messages: recent,
  };
}
