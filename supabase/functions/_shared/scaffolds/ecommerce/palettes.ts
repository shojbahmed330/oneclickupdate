// Style variant pool — picked deterministically per project so two shops
// generated from the same template don't look identical. Each variant
// defines HSL tokens for index.css + a layout flavor hint.

export type Palette = {
  id: string;
  name: string;
  primary: string;       // HSL: "240 80% 55%"
  primaryFg: string;
  accent: string;
  accentFg: string;
  bg: string;            // light bg
  fg: string;
  card: string;
  muted: string;
  mutedFg: string;
  border: string;
  // dark mode counterparts
  darkBg: string;
  darkFg: string;
  darkCard: string;
  darkMuted: string;
  darkMutedFg: string;
  darkBorder: string;
  radius: string;        // "0.75rem"
  font: string;          // google font name
  layoutVariant: "editorial" | "dense" | "minimal";
};

export const PALETTES: Palette[] = [
  {
    id: "rose-editorial",
    name: "Rose Editorial",
    primary: "346 84% 56%", primaryFg: "0 0% 100%",
    accent: "24 90% 60%",   accentFg: "0 0% 100%",
    bg: "20 30% 98%", fg: "240 10% 10%",
    card: "0 0% 100%", muted: "20 20% 94%", mutedFg: "240 5% 40%", border: "20 15% 88%",
    darkBg: "240 12% 8%", darkFg: "20 20% 95%", darkCard: "240 10% 12%",
    darkMuted: "240 8% 18%", darkMutedFg: "20 10% 65%", darkBorder: "240 8% 20%",
    radius: "1rem", font: "Playfair Display", layoutVariant: "editorial",
  },
  {
    id: "indigo-minimal",
    name: "Indigo Minimal",
    primary: "243 75% 58%", primaryFg: "0 0% 100%",
    accent: "199 89% 48%",  accentFg: "0 0% 100%",
    bg: "0 0% 100%", fg: "240 15% 12%",
    card: "240 20% 99%", muted: "240 10% 95%", mutedFg: "240 5% 45%", border: "240 15% 90%",
    darkBg: "240 18% 6%", darkFg: "0 0% 96%", darkCard: "240 15% 10%",
    darkMuted: "240 12% 16%", darkMutedFg: "240 5% 65%", darkBorder: "240 12% 18%",
    radius: "0.75rem", font: "Inter", layoutVariant: "minimal",
  },
  {
    id: "emerald-dense",
    name: "Emerald Dense",
    primary: "160 84% 35%", primaryFg: "0 0% 100%",
    accent: "45 95% 52%",   accentFg: "240 15% 12%",
    bg: "150 25% 97%", fg: "160 25% 10%",
    card: "0 0% 100%", muted: "150 15% 93%", mutedFg: "160 8% 40%", border: "150 12% 88%",
    darkBg: "160 20% 7%", darkFg: "150 15% 95%", darkCard: "160 18% 11%",
    darkMuted: "160 12% 17%", darkMutedFg: "150 8% 65%", darkBorder: "160 12% 20%",
    radius: "0.5rem", font: "DM Sans", layoutVariant: "dense",
  },
  {
    id: "noir-mono",
    name: "Noir Mono",
    primary: "0 0% 12%", primaryFg: "0 0% 98%",
    accent: "12 90% 55%", accentFg: "0 0% 100%",
    bg: "0 0% 99%", fg: "0 0% 8%",
    card: "0 0% 100%", muted: "0 0% 94%", mutedFg: "0 0% 40%", border: "0 0% 88%",
    darkBg: "0 0% 6%", darkFg: "0 0% 96%", darkCard: "0 0% 10%",
    darkMuted: "0 0% 16%", darkMutedFg: "0 0% 65%", darkBorder: "0 0% 20%",
    radius: "0.25rem", font: "Space Grotesk", layoutVariant: "editorial",
  },
  {
    id: "violet-soft",
    name: "Violet Soft",
    primary: "270 70% 60%", primaryFg: "0 0% 100%",
    accent: "320 80% 65%", accentFg: "0 0% 100%",
    bg: "280 30% 98%", fg: "270 20% 12%",
    card: "0 0% 100%", muted: "280 15% 94%", mutedFg: "270 8% 45%", border: "280 12% 89%",
    darkBg: "270 25% 7%", darkFg: "280 15% 95%", darkCard: "270 22% 11%",
    darkMuted: "270 18% 17%", darkMutedFg: "280 10% 65%", darkBorder: "270 18% 20%",
    radius: "1.25rem", font: "Outfit", layoutVariant: "minimal",
  },
];

export function pickPalette(seed: string): Palette {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}
