// Smart file retrieval — predict 1-5 files relevant to the user's last
// message, route, and recent errors WITHOUT a vector store. Uses
// keyword + path-scoring + import-graph expansion + recently-edited boost.
// Adds <100 ms and ~200-2000 extra tokens depending on hits.
//
// Token strategy:
//   - Skip entirely if user already used @mentions (handled elsewhere).
//   - Cache by content hash + dedupe against earlier turns (history grep).
//   - Send only the file HEAD (≤900 bytes). Agent reads full via read_file.

import type { DaytonaSandbox } from "./daytona.ts";

const MAX_PREDICTED = 5;
const HEAD_BYTES = 900;
const STOP = new Set([
  "the","and","for","with","that","this","from","into","what","when","why","how",
  "i","you","we","my","ami","amar","tumi","tomar","koro","kore","ki","kano","ei","oi",
  "page","app","add","fix","change","make","create","update","build","please","thanks",
  "error","issue","problem","help","need","want","not","work","working",
  "use","using","new","old","src","import","export","const","function","return",
]);

// Word tokens (lowercased) + identifier tokens (CamelCase/PascalCase preserved
// for stronger matching against component/hook names like "MobileLayout").
function tokens(s: string): { words: string[]; idents: string[] } {
  const lower = s.toLowerCase();
  const words = (lower.match(/[a-z0-9_]{3,}/g) ?? []).filter((t) => !STOP.has(t));
  // Pull PascalCase + camelCase identifiers verbatim from the original string.
  const idents = (s.match(/\b[A-Z][a-zA-Z0-9]{3,}\b|\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]+\b/g) ?? [])
    .filter((t) => t.length >= 4);
  return { words, idents };
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export interface PredictedFile {
  path: string;
  score: number;
  hash: string;
  head: string;
  truncated: boolean;
  fullBytes: number;
  via?: "score" | "import" | "recent";
}

// Resolve `@/foo/bar` and relative imports to a candidate src path.
function resolveImport(spec: string, fromPath: string): string | null {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  if (spec.startsWith(".")) {
    const dir = fromPath.slice(0, fromPath.lastIndexOf("/"));
    const parts = (dir + "/" + spec).split("/");
    const stack: string[] = [];
    for (const p of parts) {
      if (p === "" || p === ".") continue;
      if (p === "..") stack.pop();
      else stack.push(p);
    }
    return stack.join("/");
  }
  return null; // bare npm imports — skip
}

// Append likely TS/TSX extensions if missing.
function withExtensions(p: string): string[] {
  if (/\.(tsx?|jsx?|css|json)$/.test(p)) return [p];
  return [`${p}.tsx`, `${p}.ts`, `${p}/index.tsx`, `${p}/index.ts`];
}

async function expandImports(
  sandbox: DaytonaSandbox,
  cwd: string,
  topPaths: string[],
  excluded: Set<string>,
  budget: number,
): Promise<string[]> {
  const out = new Set<string>();
  for (const p of topPaths.slice(0, 2)) {
    if (out.size >= budget) break;
    let content = "";
    try { content = await sandbox.readFile(`${cwd}/${p}`); } catch { continue; }
    const importRe = /^import\s+(?:[^"';]+\s+from\s+)?["']([^"']+)["']/gm;
    for (const m of content.matchAll(importRe)) {
      if (out.size >= budget) break;
      const resolved = resolveImport(m[1], p);
      if (!resolved) continue;
      for (const cand of withExtensions(resolved)) {
        if (excluded.has(cand) || out.has(cand)) continue;
        try {
          const r = await sandbox.exec(`test -f '${cwd}/${cand}' && echo Y || echo N`, cwd, 3);
          if (String((r as any).stdout ?? (r as any).result ?? "").trim() === "Y") {
            out.add(cand);
            break;
          }
        } catch { /* skip */ }
      }
    }
  }
  return [...out];
}

/**
 * Score every src file against (user query tokens + idents + route tokens +
 * error tokens). Top N by score, then expand by import-graph, then boost
 * recently-edited paths. Pure ripgrep + light file IO — no embeddings.
 */
export async function predictRelevantFiles(opts: {
  sandbox: DaytonaSandbox;
  cwd: string;
  query: string;
  route?: string;
  errorText?: string;
  excludePaths?: Set<string>;
  historyHaystack?: string;
  recentlyEdited?: string[];      // files edited in last few turns — boost
}): Promise<{ files: PredictedFile[]; hash: string; deduped: number; importExpanded: number }> {
  const { sandbox, cwd } = opts;
  const qTok = tokens(opts.query ?? "");
  const rTok = tokens(opts.route ?? "");
  const eTok = tokens(opts.errorText ?? "");
  const wordSet = new Set([...qTok.words, ...rTok.words, ...eTok.words]);
  const identSet = new Set([...qTok.idents, ...rTok.idents, ...eTok.idents]);
  const allTerms = new Set<string>([...wordSet, ...[...identSet].map((i) => i.toLowerCase())]);
  if (allTerms.size === 0) return { files: [], hash: "00000000", deduped: 0, importExpanded: 0 };

  const recentSet = new Set((opts.recentlyEdited ?? []).map((p) => p.replace(/^\.?\//, "")));

  // Build pattern. Idents (PascalCase) are case-sensitive matches, words case-insensitive.
  const wordPat = [...wordSet].slice(0, 10).map((t) => t.replace(/[^\w]/g, "")).filter(Boolean).join("|");
  const identPat = [...identSet].slice(0, 6).map((t) => t.replace(/[^\w]/g, "")).filter(Boolean).join("|");

  // Run two ripgreps in parallel: words (case-insensitive) + idents (case-sensitive, +2× weight).
  const cmds: Array<{ pat: string; flags: string; weight: number }> = [];
  if (wordPat) cmds.push({ pat: wordPat, flags: "-ci", weight: 1 });
  if (identPat) cmds.push({ pat: identPat, flags: "-c", weight: 2 });

  const fileCounts = new Map<string, number>();
  await Promise.all(
    cmds.map(async ({ pat, flags, weight }) => {
      try {
        const r = await sandbox.exec(
          `rg ${flags} --glob '*.tsx' --glob '*.ts' --glob '*.jsx' --glob '*.js' --glob '*.css' ` +
          `--glob '!node_modules' --glob '!dist' --glob '!build' --glob '!.next' ` +
          `'${pat}' src 2>/dev/null | head -n 40 || true`,
          cwd, 8,
        );
        const raw = String((r as any).stdout ?? (r as any).result ?? "");
        for (const line of raw.split("\n")) {
          const idx = line.lastIndexOf(":");
          if (idx === -1) continue;
          const path = line.slice(0, idx).trim();
          const count = parseInt(line.slice(idx + 1), 10);
          if (!path || !count || count < 1) continue;
          if (opts.excludePaths?.has(path)) continue;
          fileCounts.set(path, (fileCounts.get(path) ?? 0) + count * weight);
        }
      } catch { /* ignore */ }
    }),
  );

  const scored: { path: string; score: number; via: "score" }[] = [];
  for (const [path, count] of fileCounts) {
    let pathBonus = 0;
    const routeBits = (opts.route ?? "").toLowerCase().split("/").filter(Boolean);
    for (const seg of routeBits) if (path.toLowerCase().includes(seg)) pathBonus += 2;
    if (/\/(pages|components|hooks)\//.test(path)) pathBonus += 1;
    if (recentSet.has(path)) pathBonus += 4;            // recently-edited boost
    scored.push({ path, score: count + pathBonus, via: "score" });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score >= 2).slice(0, MAX_PREDICTED);

  // Import-graph expansion: pull 1-2 files imported by the top picks
  // (often the type/util/sub-component the agent will need to read next).
  const excluded = new Set<string>([
    ...top.map((s) => s.path),
    ...(opts.excludePaths ? [...opts.excludePaths] : []),
  ]);
  const expandedPaths = top.length
    ? await expandImports(sandbox, cwd, top.map((s) => s.path), excluded, 2)
    : [];

  const combined: { path: string; score: number; via: "score" | "import" | "recent" }[] = [
    ...top,
    ...expandedPaths.map((p) => ({ path: p, score: 1, via: "import" as const })),
  ];

  const out: PredictedFile[] = [];
  const hashParts: string[] = [];
  let deduped = 0;
  for (const s of combined) {
    try {
      const content = await sandbox.readFile(`${cwd}/${s.path}`);
      const hash = fnv1a(content);
      hashParts.push(`${s.path}:${hash}`);
      if (opts.historyHaystack && opts.historyHaystack.includes(`${s.path} (auto-sha:${hash}`)) {
        deduped++;
        continue;
      }
      const truncated = content.length > HEAD_BYTES;
      out.push({
        path: s.path, score: s.score, hash,
        head: truncated ? content.slice(0, HEAD_BYTES) : content,
        truncated, fullBytes: content.length, via: s.via,
      });
    } catch { /* file missing */ }
  }
  return { files: out, hash: fnv1a(hashParts.join("|")), deduped, importExpanded: expandedPaths.length };
}

/** Render predicted files into a compact context section. */
export function renderPredictedFiles(files: PredictedFile[]): string {
  if (files.length === 0) return "";
  const blobs = files.map((f) => {
    const tag = f.via === "import" ? " via:import" : f.via === "recent" ? " via:recent" : "";
    const header = f.truncated
      ? `### ~${f.path} (auto-sha:${f.hash}, head ${HEAD_BYTES}/${f.fullBytes}B, score:${f.score}${tag})`
      : `### ~${f.path} (auto-sha:${f.hash}, score:${f.score}${tag})`;
    return `${header}\n\`\`\`\n${f.head}\n\`\`\``;
  });
  return `## Files I auto-loaded that look relevant (call read_file for full body):\n${blobs.join("\n\n")}`;
}
