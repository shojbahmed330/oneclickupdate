// Returns the project files snapshot for a given build_id.
// Called by the GitHub Action with the shared webhook secret.
// Response: { files: [{ path, content }], app_name, package_id, version_name, version_code }
//
// Auto-injects a default capacitor.config.ts so APK builds succeed even when
// the agent forgot to scaffold Capacitor config.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-build-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function defaultCapacitorConfig(appName: string, packageId: string): string {
  const safeName = JSON.stringify(appName);
  const safeId = JSON.stringify(packageId);
  return `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: ${safeId},
  appName: ${safeName},
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      // Let the WebView draw under the status bar so the app feels edge-to-edge.
      // Style is set dynamically at runtime from main.tsx based on theme.
      overlaysWebView: false,
      style: 'DEFAULT',
      backgroundColor: '#00000000',
    },
    SplashScreen: {
      launchShowDuration: 500,
      backgroundColor: '#000000',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
};

export default config;
`;
}

const STATUS_BAR_BOOTSTRAP = `
// [auto-injected] Capacitor StatusBar — blend with theme on native APK
if (typeof window !== "undefined") {
  (async () => {
    try {
      const cap = (window as any).Capacitor;
      if (!cap?.isNativePlatform?.()) return;
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      const apply = () => {
        const isDark = document.documentElement.classList.contains("dark");
        StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
        StatusBar.setBackgroundColor?.({ color: isDark ? "#000000" : "#ffffff" }).catch(() => {});
      };
      apply();
      const obs = new MutationObserver(apply);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    } catch {}
  })();
}
`;

function ensureStatusBarBootstrap(files: Array<{ path: string; content: string }>) {
  const main = files.find((f) => f.path === "src/main.tsx" || f.path === "src/main.ts");
  if (!main) return;
  if (main.content.includes("@capacitor/status-bar")) return;
  main.content = main.content + "\n" + STATUS_BAR_BOOTSTRAP;
}


function ensureFile(files: Array<{ path: string; content: string }>, path: string, content: string) {
  if (!files.some((f) => f.path === path)) files.push({ path, content });
}

function projectUsesPackage(files: Array<{ path: string; content: string }>, packageName: string): boolean {
  const importPattern = new RegExp(`(?:from\\s+['\"]${packageName}['\"]|import\\s*\\(['\"]${packageName}['\"]\\)|require\\s*\\(['\"]${packageName}['\"]\\))`);
  return files.some((file) => /\.[cm]?[jt]sx?$/.test(file.path) && importPattern.test(file.content));
}

function ensurePackageDependency(files: Array<{ path: string; content: string }>, packageName: string, version: string) {
  if (!projectUsesPackage(files, packageName)) return;

  const pkgFile = files.find((f) => f.path === "package.json");
  if (!pkgFile) return;

  try {
    const pkg = JSON.parse(pkgFile.content);
    const deps = pkg.dependencies ?? {};
    const devDeps = pkg.devDependencies ?? {};
    if (deps[packageName] || devDeps[packageName]) return;

    pkg.dependencies = { ...deps, [packageName]: version };
    pkgFile.content = `${JSON.stringify(pkg, null, 2)}\n`;
  } catch {
    // Leave malformed package.json untouched so the build shows the real error.
  }
}

function ensurePackageEntry(
  files: Array<{ path: string; content: string }>,
  section: "dependencies" | "devDependencies",
  packageName: string,
  version: string,
) {
  const pkgFile = files.find((f) => f.path === "package.json");
  if (!pkgFile) return;

  try {
    const pkg = JSON.parse(pkgFile.content);
    const deps = pkg.dependencies ?? {};
    const devDeps = pkg.devDependencies ?? {};
    if (deps[packageName] || devDeps[packageName]) return;

    pkg[section] = { ...(pkg[section] ?? {}), [packageName]: version };
    pkgFile.content = `${JSON.stringify(pkg, null, 2)}\n`;
  } catch {
    // Leave malformed package.json untouched so npm install shows the real error.
  }
}

function usesTailwind(files: Array<{ path: string; content: string }>) {
  return files.some((file) =>
    /^tailwind\.config\.[cm]?[jt]s$/.test(file.path) ||
    /@tailwind\s+(base|components|utilities)/.test(file.content),
  );
}

function ensurePostcssConfig(files: Array<{ path: string; content: string }>) {
  if (!usesTailwind(files)) return;
  const hasConfig = files.some((file) => /^postcss\.config\.[cm]?js$/.test(file.path));
  if (!hasConfig) {
    ensureFile(files, "postcss.config.js", "export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n");
  }
  ensurePackageEntry(files, "devDependencies", "tailwindcss", "^3.4.17");
  ensurePackageEntry(files, "devDependencies", "postcss", "^8.4.49");
  ensurePackageEntry(files, "devDependencies", "autoprefixer", "^10.4.20");
}

function ensureTailwindDirectives(files: Array<{ path: string; content: string }>) {
  // If tailwind.config exists but no CSS file imports the directives, the build
  // ships zero utility classes. Find the main CSS entry and prepend missing directives.
  const hasTailwindConfig = files.some((f) => /^tailwind\.config\.[cm]?[jt]s$/.test(f.path));
  if (!hasTailwindConfig) return;
  const someCssHasDirectives = files.some((f) =>
    /\.css$/i.test(f.path) && /@tailwind\s+(base|components|utilities)/.test(f.content),
  );
  if (someCssHasDirectives) return;
  // Pick main CSS entry (priority: src/index.css > src/globals.css > src/main.css > src/app.css)
  const candidates = ["src/index.css", "src/globals.css", "src/main.css", "src/app.css", "src/styles.css"];
  let target = files.find((f) => candidates.includes(f.path));
  if (!target) target = files.find((f) => /^src\/[^/]+\.css$/i.test(f.path));
  if (!target) return;
  target.content = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${target.content}`;
}

function ensureThemeClassToggle(files: Array<{ path: string; content: string }>) {
  // Generated apps often have a ThemeProvider that only sets `data-theme` on
  // <html> and writes to localStorage. Our Tailwind config (and most shadcn
  // tokens) trigger dark mode via the `.dark` class, so without the class the
  // CSS variables never switch. Patch any theme-provider files to also toggle
  // the `dark` class on documentElement.
  for (const file of files) {
    if (!/theme-?provider|use-?theme|ThemeContext/i.test(file.path)) continue;
    if (!/\.tsx?$/.test(file.path)) continue;
    if (file.content.includes("classList") && file.content.includes("dark")) continue;
    // Inject class toggle wherever data-theme is set.
    let patched = file.content.replace(
      /(document\.documentElement\.setAttribute\(\s*["']data-theme["']\s*,\s*([A-Za-z0-9_$.]+)\s*\)\s*;?)/g,
      `$1
    try {
      const _root = document.documentElement;
      const _isDark = String($2) === "dark" || (String($2) === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      _root.classList.toggle("dark", _isDark);
      _root.classList.toggle("light", !_isDark);
    } catch {}`,
    );
    if (patched === file.content) {
      // Fallback: append a small effect that mirrors localStorage theme to class.
      patched += `\n\n// [auto-injected] ensure dark class follows theme\nif (typeof window !== "undefined") {\n  const _sync = () => {\n    try {\n      const t = localStorage.getItem("theme") || localStorage.getItem("vite-ui-theme") || "system";\n      const isDark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);\n      document.documentElement.classList.toggle("dark", isDark);\n      document.documentElement.classList.toggle("light", !isDark);\n    } catch {}\n  };\n  _sync();\n  window.addEventListener("storage", _sync);\n}\n`;
    }
    file.content = patched;
  }
}

function ensureMobileViewport(files: Array<{ path: string; content: string }>) {
  const index = files.find((file) => file.path === "index.html");
  if (!index) return;
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />';
  if (/<meta\s+name=["']viewport["'][^>]*>/i.test(index.content)) {
    index.content = index.content.replace(/<meta\s+name=["']viewport["'][^>]*>/i, viewport);
  } else {
    index.content = index.content.replace(/<head[^>]*>/i, (match) => `${match}\n    ${viewport}`);
  }
}

function ensureNativeFullBleed(files: Array<{ path: string; content: string }>) {
  // The platform's preview shows generated apps inside a 430px phone-mockup
  // frame. Templates often hard-code `max-w-[430px] mx-auto` + a faux phone
  // card (`shadow-xl shadow-black/5`, `bg-muted/30 flex justify-center`) into
  // the mobile layout. Inside an actual APK that wrapper produces a tiny
  // centered card with huge empty space around it — not native at all.
  //
  // Strip those wrappers so the compiled APK renders edge-to-edge. We only
  // touch className string literals in .tsx files; logic and component
  // structure stay intact.
  for (const file of files) {
    if (!/\.tsx?$/.test(file.path)) continue;
    let c = file.content;
    const before = c;

    // 1. Remove the phone-frame width cap. `max-w-[430px]` (and common
    //    siblings like `max-w-[420px]`, `max-w-sm` *only* when it sits next
    //    to mobile shell hints) → make the container full-width.
    c = c.replace(/\bmax-w-\[(?:390|400|412|414|420|430|440|480)px\]\b/g, "w-full");

    // 2. Remove the desktop "phone card" shadow + outer centering wrapper.
    c = c.replace(/\bshadow-xl\s+shadow-black\/(?:5|10|20)\b/g, "");
    c = c.replace(/\bbg-muted\/30\s+flex\s+justify-center\b/g, "");
    c = c.replace(/\bflex\s+justify-center\s+bg-muted\/30\b/g, "");

    // 3. Some templates write `min-h-screen` (100vh) which breaks on iOS
    //    Safari + Android WebView address bar. Force `100dvh` everywhere.
    c = c.replace(/\bmin-h-screen\b/g, "min-h-[100dvh]");
    c = c.replace(/\bh-screen\b/g, "h-[100dvh]");

    if (c !== before) file.content = c;
  }
}

Deno.serve(withSentry("build-files", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SECRET = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  // During a rotation window, accept the previous secret too so in-flight
  // builds keep working. Set GITHUB_WEBHOOK_SECRET_PREVIOUS to the old value
  // for ~24h after rotating, then delete it.
  const SECRET_PREV = Deno.env.get("GITHUB_WEBHOOK_SECRET_PREVIOUS");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SECRET) return json({ error: "Not configured" }, 500);

  const url = new URL(req.url);
  const buildId = url.searchParams.get("build_id");
  const provided = req.headers.get("x-build-secret") ?? url.searchParams.get("secret");
  const accepted = provided === SECRET || (!!SECRET_PREV && provided === SECRET_PREV);
  if (!accepted) return json({ error: "Forbidden" }, 403);
  if (!buildId) return json({ error: "build_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: build, error: bErr } = await admin
    .from("app_builds")
    .select("id, project_id, app_name, package_id, version_name, version_code, logo_path, splash_path, adaptive_bg_color, splash_bg_color")
    .eq("id", buildId)
    .single();
  if (bErr || !build) return json({ error: "Build not found" }, 404);

  // Short-lived signed URLs the GitHub Action can curl to fetch user-uploaded
  // logo / splash images. We don't bake them into files.json (binary) — workflow
  // downloads them separately and uses ImageMagick to generate icon densities.
  let logo_url: string | null = null;
  let splash_url: string | null = null;
  if (build.logo_path) {
    const { data } = await admin.storage.from("app-branding").createSignedUrl(build.logo_path, 60 * 60);
    logo_url = data?.signedUrl ?? null;
  }
  if (build.splash_path) {
    const { data } = await admin.storage.from("app-branding").createSignedUrl(build.splash_path, 60 * 60);
    splash_url = data?.signedUrl ?? null;
  }

  const { data: rows, error: fErr } = await admin
    .from("project_files")
    .select("path, content")
    .eq("project_id", build.project_id);
  if (fErr) return json({ error: "Could not load files" }, 500);

  const files = (rows ?? []).map((r: any) => ({ path: r.path, content: r.content }));

  // Some generated apps use the standard toast helper but older generated
  // package.json snapshots may not include the dependency. Patch the snapshot
  // sent to GitHub so npm install brings it in before Vite builds.
  ensurePackageDependency(files, "sonner", "^1.7.4");

  // APKs must compile the exact Tailwind utilities used by the preview. Older
  // snapshots sometimes missed postcss.config.js, which made Android WebView
  // render unstyled desktop/default HTML even though the live preview looked OK.
  ensurePostcssConfig(files);
  ensureTailwindDirectives(files);
  ensureMobileViewport(files);
  ensureThemeClassToggle(files);
  ensureNativeFullBleed(files);

  // The GitHub workflow always runs `npx cap ...`, so the project snapshot must
  // include Capacitor packages. Without @capacitor/cli, npx fails with:
  // "npm error could not determine executable to run" during Capacitor sync.
  ensurePackageEntry(files, "dependencies", "@capacitor/core", "^6.1.2");
  ensurePackageEntry(files, "devDependencies", "typescript", "^5.8.3");
  ensurePackageEntry(files, "devDependencies", "@capacitor/cli", "^6.1.2");
  ensurePackageEntry(files, "devDependencies", "@capacitor/android", "^6.1.2");
  ensurePackageEntry(files, "dependencies", "@capacitor/status-bar", "^6.0.2");
  ensureStatusBarBootstrap(files);

  // Auto-inject Capacitor config so a fresh project without explicit
  // Capacitor scaffolding still produces a working APK. Do not inject files
  // under android/ before `cap add android`; a partial android folder makes
  // Capacitor skip platform creation and leaves android/gradlew missing.
  ensureFile(files, "capacitor.config.ts", defaultCapacitorConfig(build.app_name, build.package_id));

  return json({
    app_name: build.app_name,
    package_id: build.package_id,
    version_name: build.version_name,
    version_code: build.version_code,
    logo_url,
    splash_url,
    adaptive_bg_color: build.adaptive_bg_color || "#FFFFFF",
    splash_bg_color: build.splash_bg_color || "#FFFFFF",
    files,
  });
}));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
