// Layer 11 — Advanced agentic primitives.
//   • peer_review            — independent reviewer-agent critique of recent edits
//   • schedule_background_task — queue a long refactor / scaffold to run while user is away
//   • list_background_tasks  — inspect this user's pending / running / done jobs
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const REVIEWER_PROMPT = `You are an INDEPENDENT senior code reviewer for a React + Vite + TypeScript + Tailwind + Supabase mobile app.
You did NOT write this code — your job is to find what the original author missed.

For each file you receive, output ONE line per real issue using this exact format:
  [SEVERITY] file:line — problem → concrete fix

SEVERITY: BLOCKER | MAJOR | MINOR
Look for, in this order:
  1. BLOCKER: runtime crashes, missing imports, undefined refs, broken auth, RLS gaps, hardcoded secrets, leaks of service-role keys
  2. BLOCKER: design-system violations the validator missed (text-white/black, custom hex on bg-*, overflow:hidden on scroll containers, missing pb on scrollers above bottom-nav)
  3. MAJOR: race conditions, missing error/loading states, list-key bugs, unbounded queries, infinite re-renders, missing aria-labels on icon-only buttons
  4. MAJOR: data persistence in localStorage when it should be Supabase
  5. MINOR: dead code, unused imports, magic strings, files >300 lines that should be split
End with one line: SUMMARY: <single sentence verdict>.
If there are NO issues, return only: SUMMARY: clean — no blockers found.
Be terse. No prose, no markdown headings, no code fences.`;

export function makeAgenticTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    peer_review: tool({
      description:
        "Run an INDEPENDENT reviewer-agent (separate model call) over a list of files you just edited. " +
        "Returns critique lines tagged BLOCKER / MAJOR / MINOR. Use BEFORE the final user-facing reply on any non-trivial multi-file change. " +
        "Cheap (~1 fast model call). If the review finds BLOCKERs, fix them and re-run.",
      inputSchema: z.object({
        files: z.array(z.string()).min(1).max(12).describe("Repo paths to review (relative to project root)."),
        focus: z.string().optional().describe("Optional extra concern, e.g. 'check RLS on new tables'"),
      }),
      execute: async ({ files, focus }) => {
        const key = Deno.env.get("LOVABLE_API_KEY");
        if (!key) return { ok: false, error: "LOVABLE_API_KEY missing" };

        const chunks: string[] = [];
        for (const rel of files.slice(0, 12)) {
          const content = await sandbox.readFile(`${cwd}/${rel}`).catch(() => "");
          if (!content) { chunks.push(`### ${rel}\n(empty or unreadable)`); continue; }
          // cap each file at 8 KB to stay under context — review is line-level anyway.
          chunks.push(`### ${rel}\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\``);
        }
        const userMsg = (focus ? `Extra focus: ${focus}\n\n` : "") + chunks.join("\n\n");

        const r = await fetch(LOVABLE_GATEWAY, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: REVIEWER_PROMPT },
              { role: "user", content: userMsg },
            ],
          }),
        });
        if (!r.ok) return { ok: false, error: `gateway ${r.status}: ${(await r.text()).slice(0, 300)}` };
        const data = await r.json();
        const text: string = data?.choices?.[0]?.message?.content ?? "";
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const issues = lines.filter((l) => /^\[(BLOCKER|MAJOR|MINOR)\]/.test(l));
        const summary = lines.find((l) => /^SUMMARY:/i.test(l)) ?? "SUMMARY: (no summary)";
        const blockers = issues.filter((l) => l.startsWith("[BLOCKER]"));
        return {
          ok: blockers.length === 0,
          issues,
          summary,
          blocker_count: blockers.length,
          hint: blockers.length === 0 ? "Reviewer is happy. Safe to finalize." : "Fix every BLOCKER before writing the final reply.",
        };
      },
    }),

    schedule_background_task: tool({
      description:
        "Queue a long-running task (big refactor, scaffold full feature, generate test suite for whole app) to run AUTOMATICALLY while the user is away. " +
        "A cron worker picks it up within ~1 minute and runs the agent against this project with the given prompt. " +
        "Use ONLY when the user explicitly asks for 'do this in the background' / 'while I'm gone' / 'overnight'. " +
        "Returns { ok, task_id }.",
      inputSchema: z.object({
        prompt: z.string().min(20).max(4000).describe("Self-contained instruction the background agent will run, exactly as if the user typed it."),
        delay_seconds: z.number().int().min(0).max(86400).default(0),
      }),
      execute: async ({ prompt, delay_seconds }) => {
        const scheduledAt = new Date(Date.now() + delay_seconds * 1000).toISOString();
        const { data, error } = await ctx.supabase
          .from("background_tasks")
          .insert({
            user_id: ctx.userId,
            project_id: ctx.projectId,
            prompt,
            scheduled_at: scheduledAt,
          })
          .select("id, scheduled_at")
          .single();
        if (error) return { ok: false, error: error.message };
        return {
          ok: true,
          task_id: (data as any).id,
          scheduled_at: (data as any).scheduled_at,
          hint: "Tell the user the task is queued and will start within ~1 minute. They can keep chatting in the meantime.",
        };
      },
    }),

    list_background_tasks: tool({
      description:
        "List this user's recent background tasks for THIS project (status: pending/running/done/error). " +
        "Use when the user asks 'what did you do while I was away' or 'check my background jobs'.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
      execute: async ({ limit }) => {
        const { data, error } = await ctx.supabase
          .from("background_tasks")
          .select("id,status,prompt,scheduled_at,started_at,finished_at,error_message")
          .eq("project_id", ctx.projectId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return { ok: false, error: error.message };
        return { ok: true, tasks: (data ?? []).map((t: any) => ({ ...t, prompt: String(t.prompt).slice(0, 160) })) };
      },
    }),
  };
}
