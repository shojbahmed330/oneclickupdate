// Headless-browser probe script that runs INSIDE the Daytona sandbox.
// We write it to /tmp/_probe.mjs and execute with node, talking to the
// running Vite dev server on localhost. Output goes to stdout as JSON.
//
// Lazy-installs `playwright` + chromium on first use (cached after that).

export const PROBE_SCRIPT = `
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const args = JSON.parse(process.argv[2] || "{}");
const { mode, url, viewport = { width: 390, height: 844 }, waitMs = 4000, screenshotPath } = args;

const out = { ok: false, console: [], network: [], errors: [], screenshotPath: null };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    out.console.push({ type: m.type(), text: m.text().slice(0, 800) });
  });
  page.on("pageerror", (e) => {
    out.errors.push({ message: String(e.message || e).slice(0, 800), stack: String(e.stack || "").slice(0, 1200) });
  });
  page.on("requestfailed", (req) => {
    out.network.push({ phase: "failed", url: req.url(), method: req.method(), error: req.failure()?.errorText || "" });
  });
  page.on("response", async (res) => {
    try {
      const req = res.request();
      const status = res.status();
      // keep only API/asset essentials, skip data: and noisy assets
      if (req.url().startsWith("data:")) return;
      out.network.push({
        phase: "response",
        url: req.url().slice(0, 400),
        method: req.method(),
        status,
        type: req.resourceType(),
      });
    } catch { /* ignore */ }
  });

  await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 }).catch((e) => {
    out.errors.push({ message: "goto failed: " + String(e.message || e) });
  });
  await page.waitForTimeout(Math.max(0, Math.min(waitMs, 12_000)));

  if (mode === "screenshot" && screenshotPath) {
    const buf = await page.screenshot({ fullPage: false, type: "png" });
    writeFileSync(screenshotPath, buf);
    out.screenshotPath = screenshotPath;
    out.screenshotBase64 = buf.toString("base64");
  }

  // Cap arrays
  out.console = out.console.slice(-120);
  out.network = out.network.slice(-120);
  out.errors  = out.errors.slice(-30);
  out.ok = true;
} catch (e) {
  out.errors.push({ message: "probe failed: " + String(e?.message || e) });
} finally {
  try { await browser?.close(); } catch { }
  process.stdout.write(JSON.stringify(out));
}
`;

export const PROBE_INSTALL = `
set -e
if [ ! -f /tmp/.playwright-installed ]; then
  npm i --prefix /tmp playwright@1.47.2 >/tmp/_pw_install.log 2>&1
  npx --prefix /tmp playwright install chromium --with-deps >>/tmp/_pw_install.log 2>&1 || npx --prefix /tmp playwright install chromium >>/tmp/_pw_install.log 2>&1
  touch /tmp/.playwright-installed
fi
`;
