// Per-turn sandbox read cache.
//
// Why: read_file / list_dir are the most-called tools (smartRetrieval, the
// agent re-reading files between edits, dep-graph walks). Each call is a
// round-trip to the Daytona toolbox API (~150-400ms). Caching them per-turn
// (the ToolCtx lifetime) eliminates redundant fetches with zero risk because
// we invalidate on every mutation (write_file / delete_file / run_command).
//
// Hot paths that benefit:
//   • read_file called twice in the same turn → 2nd is instant
//   • list_dir on src/components called by smartRetrieval AND by the agent
//   • types.ts / package.json read repeatedly to confirm shape
//
// Strategy: simple Map keyed by path, no TTL (turn lifetime is short ~minutes).
// Invalidation is path-prefix based for listDir (any write under a dir blows
// the dir's cached listing).

import type { DaytonaSandbox } from "../../_shared/daytona.ts";

type CacheState = {
  files: Map<string, { content: string; at: number }>;
  dirs: Map<string, { entries: Array<{ name: string; isDir: boolean }>; at: number }>;
  hits: { file: number; dir: number };
  misses: { file: number; dir: number };
};

function getCache(ctx: any): CacheState {
  if (!ctx.__sbxCache) {
    ctx.__sbxCache = {
      files: new Map(),
      dirs: new Map(),
      hits: { file: 0, dir: 0 },
      misses: { file: 0, dir: 0 },
    } satisfies CacheState;
  }
  return ctx.__sbxCache as CacheState;
}

export async function cachedReadFile(
  sandbox: DaytonaSandbox,
  ctx: any,
  fullPath: string,
): Promise<string> {
  const c = getCache(ctx);
  const hit = c.files.get(fullPath);
  if (hit) {
    c.hits.file++;
    return hit.content;
  }
  c.misses.file++;
  const content = await sandbox.readFile(fullPath);
  c.files.set(fullPath, { content, at: Date.now() });
  return content;
}

export async function cachedListDir(
  sandbox: DaytonaSandbox,
  ctx: any,
  fullPath: string,
): Promise<Array<{ name: string; isDir: boolean }>> {
  const c = getCache(ctx);
  const key = fullPath.replace(/\/+$/, "");
  const hit = c.dirs.get(key);
  if (hit) {
    c.hits.dir++;
    return hit.entries;
  }
  c.misses.dir++;
  const entries = await sandbox.listDir(key);
  c.dirs.set(key, { entries, at: Date.now() });
  return entries;
}

// Drop one file from the file-cache and ALL parent-dir listings.
export function invalidatePath(ctx: any, fullPath: string): void {
  const c = getCache(ctx);
  c.files.delete(fullPath);
  // Any listDir whose key is a prefix of this path can have changed.
  for (const dir of c.dirs.keys()) {
    if (fullPath === dir || fullPath.startsWith(dir + "/")) c.dirs.delete(dir);
  }
}

// Nuke everything — call after run_command (could touch anything).
export function invalidateAll(ctx: any): void {
  const c = getCache(ctx);
  c.files.clear();
  c.dirs.clear();
}

export function getCacheStats(ctx: any): { fileHitRate: number; dirHitRate: number; size: number } {
  const c = getCache(ctx);
  const fileTotal = c.hits.file + c.misses.file;
  const dirTotal = c.hits.dir + c.misses.dir;
  return {
    fileHitRate: fileTotal ? c.hits.file / fileTotal : 0,
    dirHitRate: dirTotal ? c.hits.dir / dirTotal : 0,
    size: c.files.size + c.dirs.size,
  };
}
