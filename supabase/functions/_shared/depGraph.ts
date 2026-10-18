// Lightweight reverse-dependency graph for the sandboxed project.
// Uses ripgrep on `from "..."` / `import "..."` patterns, then resolves
// relative + @/ alias paths to find which files import a given target.
//
// Not a full TS resolver — fast & good enough to surface 95% of breakages
// before the agent edits a shared component / hook / type.

import type { DaytonaSandbox } from "./daytona.ts";

const SRC_GLOB = `--glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '*.jsx'`;

function stripExt(p: string) {
  return p.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
}

/** Resolve an import specifier (relative or @/) to a candidate path stem (no ext). */
function resolveSpec(fromFile: string, spec: string, srcRoot = "src"): string | null {
  if (spec.startsWith("@/")) return stripExt(`${srcRoot}/${spec.slice(2)}`);
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = fromFile.split("/").slice(0, -1).join("/");
    const segs = `${dir}/${spec}`.split("/");
    const out: string[] = [];
    for (const s of segs) {
      if (s === "" || s === ".") continue;
      if (s === "..") out.pop();
      else out.push(s);
    }
    return stripExt(out.join("/"));
  }
  return null;
}

export interface DepImpact {
  changed: string[];
  direct_importers: string[];
  transitive: string[];
  exported_symbols: Record<string, string[]>;
  hint: string;
}

export async function computeDepImpact(
  sandbox: DaytonaSandbox,
  cwd: string,
  changedPaths: string[],
  opts: { maxResults?: number; transitiveDepth?: number } = {},
): Promise<DepImpact> {
  const maxResults = opts.maxResults ?? 30;
  const depth = opts.transitiveDepth ?? 2;
  const cleaned = changedPaths.map((p) => p.replace(/^\.?\//, "")).filter(Boolean);

  // 1. ripgrep every relative/alias import in the project
  const rgCmd =
    `rg --no-heading --line-number ${SRC_GLOB} ` +
    `"from\\s+['\\\"](\\./|\\.\\./|@/)|import\\s+['\\\"](\\./|\\.\\./|@/)" src 2>/dev/null | head -n 4000 || true`;
  let raw = "";
  try {
    const r = await sandbox.exec(rgCmd, cwd, 20);
    raw = String((r as any).stdout ?? (r as any).result ?? "");
  } catch { /* ignore */ }

  // file → list of resolved-stem imports
  const importsByFile = new Map<string, Set<string>>();
  const lineRe = /^([^:]+):(\d+):.*?(?:from|import)\s*['"]((?:\.\.?\/|@\/)[^'"]+)['"]/;
  for (const line of raw.split("\n")) {
    const m = line.match(lineRe);
    if (!m) continue;
    const [, file, , spec] = m;
    const resolved = resolveSpec(file, spec);
    if (!resolved) continue;
    const set = importsByFile.get(file) ?? new Set<string>();
    set.add(resolved);
    importsByFile.set(file, set);
  }

  // 2. build reverse map keyed by stem
  const importersByStem = new Map<string, Set<string>>();
  for (const [file, set] of importsByFile) {
    for (const stem of set) {
      const r = importersByStem.get(stem) ?? new Set<string>();
      r.add(file);
      importersByStem.set(stem, r);
    }
  }

  // 3. collect direct importers for each changed file
  const direct = new Set<string>();
  for (const cp of cleaned) {
    const stem = stripExt(cp);
    for (const [k, v] of importersByStem) {
      if (k === stem || k.endsWith(`/${stem.split("/").pop()}`)) {
        if (k === stem) v.forEach((f) => direct.add(f));
      }
    }
    const exact = importersByStem.get(stem);
    if (exact) exact.forEach((f) => direct.add(f));
  }
  cleaned.forEach((c) => direct.delete(c));

  // 4. transitive (BFS up to depth)
  const transitive = new Set<string>();
  let frontier = new Set(direct);
  for (let d = 1; d < depth; d++) {
    const next = new Set<string>();
    for (const f of frontier) {
      const stem = stripExt(f);
      const up = importersByStem.get(stem);
      if (!up) continue;
      for (const u of up) if (!direct.has(u) && !cleaned.includes(u)) next.add(u);
    }
    next.forEach((n) => transitive.add(n));
    if (next.size === 0) break;
    frontier = next;
  }

  // 5. exported symbols of changed files (best-effort)
  const exportedSymbols: Record<string, string[]> = {};
  for (const cp of cleaned.slice(0, 10)) {
    try {
      const content = await sandbox.readFile(`${cwd}/${cp}`);
      const syms = new Set<string>();
      for (const m of content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g)) {
        syms.add(m[1]);
      }
      for (const m of content.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const name of m[1].split(",")) {
          const n = name.trim().split(/\s+as\s+/)[0].trim();
          if (n) syms.add(n);
        }
      }
      if (syms.size) exportedSymbols[cp] = [...syms].slice(0, 20);
    } catch { /* ignore */ }
  }

  const directArr = [...direct].slice(0, maxResults);
  const transArr = [...transitive].slice(0, maxResults);
  const total = directArr.length + transArr.length;

  return {
    changed: cleaned,
    direct_importers: directArr,
    transitive: transArr,
    exported_symbols: exportedSymbols,
    hint: total === 0
      ? "No importers found — safe to edit in isolation. (Note: dynamic imports are not detected.)"
      : `${directArr.length} direct + ${transArr.length} transitive importer(s). ` +
        `If you rename/remove any exported symbol, update those files in the SAME edit batch — then heal + build_app.`,
  };
}
