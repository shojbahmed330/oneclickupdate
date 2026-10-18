import type { DaytonaSandbox } from "../../_shared/daytona.ts";

export const DEV_PORT = 5173;

export function isDevServerCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  return /^(npm|pnpm|bun|yarn) (run )?dev(?:\s|$)/.test(normalized);
}

async function isReady(sandbox: DaytonaSandbox, cwd: string, port = DEV_PORT) {
  const r = await sandbox.exec(
    `curl -fsS -o /dev/null -w '%{http_code}' http://localhost:${port} 2>/dev/null || echo 000`,
    cwd,
    5,
  );
  return String(r.stdout ?? "").trim() === "200";
}

export async function startDevServer(sandbox: DaytonaSandbox, cwd: string, restart = false) {
  if (restart) await sandbox.exec("pkill -f 'vite' || true", cwd, 10);
  if (!(await isReady(sandbox, cwd))) {
    await sandbox.exec(
      `nohup npm run dev -- --host 0.0.0.0 --port ${DEV_PORT} > /tmp/dev.log 2>&1 < /dev/null &`,
      cwd,
      10,
    );
  }
  let ready = false;
  for (let i = 0; i < 30; i++) {
    ready = await isReady(sandbox, cwd);
    if (ready) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  const preview = ready ? await sandbox.getPreviewLink(DEV_PORT) : null;
  return { ok: ready, port: DEV_PORT, url: preview?.url, preview };
}