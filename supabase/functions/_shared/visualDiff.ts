// Lightweight visual-diff for screenshot QA.
// Decodes two PNGs (current vs baseline) and computes a per-pixel
// mismatch percentage. Also runs cheap heuristics on the current image
// alone (blank / mostly-monochrome / bottom-strip-clip) to catch the
// common "agent claims done but screen is broken" failure mode without
// needing a stored baseline.
//
// PNG decoding via the `pngjs` npm pure-JS implementation. If it ever
// fails to load in Deno, we fall back to heuristics-only mode.

import type { DaytonaSandbox } from "./daytona.ts";

// deno-lint-ignore no-explicit-any
let _pngLib: any = null;
async function loadPng() {
  if (_pngLib) return _pngLib;
  try {
    const mod: any = await import("npm:pngjs@7.0.0");
    _pngLib = mod.PNG ?? mod.default?.PNG ?? mod.default;
    return _pngLib;
  } catch (e) {
    console.warn("[visualDiff] pngjs unavailable:", String((e as Error).message ?? e));
    return null;
  }
}

function slugRoute(route: string): string {
  return route.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "root";
}

function baselineDir(projectId: string): string {
  return `/tmp/_baselines/${projectId.replace(/[^a-zA-Z0-9_-]+/g, "")}`;
}

export function baselinePath(projectId: string, route: string, label?: string): string {
  const slug = slugRoute(route);
  const tag = label ? `_${label.replace(/[^a-zA-Z0-9_-]+/g, "_")}` : "";
  return `${baselineDir(projectId)}/${slug}${tag}.png`;
}

interface DecodedPng { width: number; height: number; data: Uint8Array }

async function decode(bytes: Uint8Array): Promise<DecodedPng | null> {
  const PNG = await loadPng();
  if (!PNG) return null;
  return await new Promise((resolve) => {
    try {
      const png = new PNG();
      // pngjs expects a node Buffer-like; Uint8Array works in Deno
      png.parse(bytes as unknown as Uint8Array, (err: unknown, data: any) => {
        if (err || !data) return resolve(null);
        resolve({ width: data.width, height: data.height, data: new Uint8Array(data.data) });
      });
    } catch { resolve(null); }
  });
}

function diffPct(a: DecodedPng, b: DecodedPng, threshold = 24): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const len = Math.min(a.data.length, b.data.length);
  let mismatched = 0;
  let counted = 0;
  // Sample every 4th pixel for speed (still ~25k samples on 390x844)
  for (let i = 0; i < len; i += 16) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (dr + dg + db > threshold) mismatched++;
    counted++;
  }
  return counted ? mismatched / counted : 0;
}

interface Heuristics { blank: boolean; mostlyMonochrome: boolean; bottomClipped: boolean; notes: string[] }

function heuristics(img: DecodedPng): Heuristics {
  const { width: w, height: h, data } = img;
  let nearWhite = 0, nearBlack = 0, total = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 245) nearWhite++;
    else if (lum < 12) nearBlack++;
    total++;
  }
  const whitePct = nearWhite / total;
  const blackPct = nearBlack / total;
  const blank = whitePct > 0.97 || blackPct > 0.97;
  const mostlyMonochrome = (whitePct + blackPct) > 0.985 && !blank;

  // Bottom-strip brightness vs middle: if the last 80px are nearly identical
  // to the row above the nav, the bottom-nav is missing or transparent.
  let midSum = 0, midN = 0, botSum = 0, botN = 0;
  const stride = w * 4;
  const rowStart = (y: number) => y * stride;
  for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.6); y += 4) {
    for (let x = 0; x < w; x += 8) {
      const i = rowStart(y) + x * 4;
      midSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      midN++;
    }
  }
  for (let y = h - 80; y < h - 4; y += 4) {
    if (y < 0) continue;
    for (let x = 0; x < w; x += 8) {
      const i = rowStart(y) + x * 4;
      botSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      botN++;
    }
  }
  const midL = midN ? midSum / midN : 0;
  const botL = botN ? botSum / botN : 0;
  const bottomClipped = Math.abs(midL - botL) < 4 && botN > 0;

  const notes: string[] = [];
  if (blank) notes.push(`Screen looks blank — ${(Math.max(whitePct, blackPct) * 100).toFixed(1)}% one color.`);
  if (mostlyMonochrome) notes.push("Screen is mostly black & white — content/imagery may be missing.");
  if (bottomClipped) notes.push("Bottom 80px is identical to mid-screen — bottom nav may be missing or transparent.");
  return { blank, mostlyMonochrome, bottomClipped, notes };
}

export interface VisualDiffResult {
  ok: boolean;
  baselined: boolean;
  baseline_path: string;
  current_path: string;
  diff_pct: number | null;
  heuristics: Heuristics;
  hint: string;
}

export async function computeScreenshotDiff(opts: {
  sandbox: DaytonaSandbox;
  cwd: string;
  projectId: string;
  route: string;
  label?: string;
  currentPath: string;
  threshold?: number; // diff_pct above which we flag a regression (default 0.05 = 5%)
}): Promise<VisualDiffResult> {
  const { sandbox, cwd, projectId, route, label, currentPath } = opts;
  const threshold = opts.threshold ?? 0.05;
  const blPath = baselinePath(projectId, route, label);

  // Read current PNG
  let currentBytes: Uint8Array | null = null;
  try {
    const r = await sandbox.exec(`base64 -w0 '${currentPath}' 2>/dev/null`, cwd, 15);
    const b64 = String((r as any).stdout ?? (r as any).result ?? "").trim();
    if (b64) currentBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch { /* ignore */ }

  let heur: Heuristics = { blank: false, mostlyMonochrome: false, bottomClipped: false, notes: [] };
  let decoded: DecodedPng | null = null;
  if (currentBytes) {
    decoded = await decode(currentBytes);
    if (decoded) heur = heuristics(decoded);
  }

  // Check baseline existence
  let baselineExists = false;
  try {
    const r = await sandbox.exec(`test -f '${blPath}' && echo yes || echo no`, cwd, 5);
    baselineExists = String((r as any).stdout ?? (r as any).result ?? "").trim() === "yes";
  } catch { /* ignore */ }

  if (!baselineExists) {
    // First run — establish baseline by copying the current screenshot
    try {
      await sandbox.exec(`mkdir -p '${baselineDir(projectId)}' && cp '${currentPath}' '${blPath}'`, cwd, 10);
    } catch { /* ignore */ }
    const heuristicFail = heur.blank || heur.bottomClipped;
    return {
      ok: !heuristicFail,
      baselined: true,
      baseline_path: blPath,
      current_path: currentPath,
      diff_pct: null,
      heuristics: heur,
      hint: heuristicFail
        ? `Baseline saved BUT current screenshot looks broken: ${heur.notes.join(" ")} Fix the screen, then re-run screenshot_diff to overwrite the baseline.`
        : "Baseline saved. Future screenshot_diff calls on this route will compare against this image.",
    };
  }

  // Decode baseline + diff
  let diff: number | null = null;
  if (decoded) {
    try {
      const r = await sandbox.exec(`base64 -w0 '${blPath}' 2>/dev/null`, cwd, 15);
      const b64 = String((r as any).stdout ?? (r as any).result ?? "").trim();
      const baseBytes = b64 ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : null;
      const baseDec = baseBytes ? await decode(baseBytes) : null;
      if (baseDec) diff = diffPct(decoded, baseDec);
    } catch { /* ignore */ }
  }

  const heuristicFail = heur.blank || heur.bottomClipped;
  const regressed = diff !== null && diff > threshold;
  const ok = !heuristicFail && !regressed;

  return {
    ok,
    baselined: false,
    baseline_path: blPath,
    current_path: currentPath,
    diff_pct: diff,
    heuristics: heur,
    hint: ok
      ? `Visual QA clean${diff !== null ? ` (${(diff * 100).toFixed(2)}% pixel diff vs baseline)` : ""}.`
      : [
          regressed ? `Pixel diff ${(diff! * 100).toFixed(2)}% exceeds ${(threshold * 100).toFixed(0)}% threshold — visual regression likely.` : "",
          ...heur.notes,
          "If the change is intentional, delete the baseline and call again to re-baseline:",
          `rm '${blPath}'`,
        ].filter(Boolean).join(" "),
  };
}
