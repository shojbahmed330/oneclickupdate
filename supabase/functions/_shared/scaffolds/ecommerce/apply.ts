// Orchestrator: pick a style variant, replace tokens in scaffold files,
// write them all to the Daytona sandbox in one pass.
import type { DaytonaSandbox } from "../../daytona.ts";
import { ECOMMERCE_LIB_FILES, type ScaffoldFile } from "./files-lib.ts";
import { ECOMMERCE_PAGE_FILES } from "./files-pages.ts";
import { PALETTES, pickPalette, type Palette } from "./palettes.ts";

export type ApplyResult = {
  template: "ecommerce";
  palette: string;
  appName: string;
  filesWritten: number;
  paths: string[];
};

function pickName(userPrompt: string): { name: string; tagline: string } {
  const text = userPrompt || "";
  // Try to extract a quoted name or "called X" / "named X"
  const quoted = text.match(/["“]([^"”]{2,40})["”]/);
  if (quoted) return { name: quoted[1].trim(), tagline: "Discover. Shop. Love." };
  const m = text.match(/(?:called|named|name(?:d|:)?)\s+([A-Z][\w& ]{1,30})/i);
  if (m) return { name: m[1].trim(), tagline: "Discover. Shop. Love." };
  return { name: "My Shop", tagline: "Discover. Shop. Love." };
}

const FONT_URL_MAP: Record<string, string> = {
  "Inter": "Inter",
  "DM Sans": "DM+Sans",
  "Playfair Display": "Playfair+Display",
  "Space Grotesk": "Space+Grotesk",
  "Outfit": "Outfit",
};

function applyTokens(content: string, p: Palette, appName: string, tagline: string): string {
  return content
    .replaceAll("__APP_NAME__", appName)
    .replaceAll("__TAGLINE__", tagline)
    .replaceAll("__PRIMARY_FG__", p.primaryFg)
    .replaceAll("__PRIMARY__", p.primary)
    .replaceAll("__ACCENT_FG__", p.accentFg)
    .replaceAll("__ACCENT__", p.accent)
    .replaceAll("__BG__", p.bg)
    .replaceAll("__FG__", p.fg)
    .replaceAll("__CARD__", p.card)
    .replaceAll("__MUTED_FG__", p.mutedFg)
    .replaceAll("__MUTED__", p.muted)
    .replaceAll("__BORDER__", p.border)
    .replaceAll("__DBG__", p.darkBg)
    .replaceAll("__DFG__", p.darkFg)
    .replaceAll("__DCARD__", p.darkCard)
    .replaceAll("__DMUTED_FG__", p.darkMutedFg)
    .replaceAll("__DMUTED__", p.darkMuted)
    .replaceAll("__DBORDER__", p.darkBorder)
    .replaceAll("__RADIUS__", p.radius)
    .replaceAll("__FONT_URL__", FONT_URL_MAP[p.font] || "Inter")
    .replaceAll("__FONT__", p.font);
}

export async function applyEcommerceScaffold(args: {
  sandbox: DaytonaSandbox;
  cwd: string;
  projectId: string;
  userPrompt: string;
}): Promise<ApplyResult> {
  const palette = pickPalette(args.projectId);
  const { name, tagline } = pickName(args.userPrompt);
  const files: ScaffoldFile[] = [...ECOMMERCE_LIB_FILES, ...ECOMMERCE_PAGE_FILES];
  const paths: string[] = [];
  for (const f of files) {
    const content = applyTokens(f.content, palette, name, tagline);
    await args.sandbox.writeFile(`${args.cwd}/${f.path}`, content);
    paths.push(f.path);
  }
  return { template: "ecommerce", palette: palette.id, appName: name, filesWritten: files.length, paths };
}

export function describeStyleForAgent(projectId: string): { palette: string; layout: string; font: string } {
  const p = pickPalette(projectId);
  return { palette: p.name, layout: p.layoutVariant, font: p.font };
}

export { PALETTES };
