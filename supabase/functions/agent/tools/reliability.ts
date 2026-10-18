// Layer 6: Reliability & Validation tools.
// - rls_validate          → flag every public.* table missing RLS / policies
// - secret_scan_repo      → grep entire repo for secrets via shared safetyGuards patterns
// - done_gate             → run typecheck + build + smoke as ONE atomic gate (returns hard fail blockers)
// - add_specialized_component → one-shot install of curated non-shadcn components (charts, calendar, rich-text, forms helpers)
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";
import { scanForSecrets } from "../../_shared/safetyGuards.ts";

interface SpecializedComponent {
  deps: string[];
  files: Record<string, string>;
  usage: string;
}

const SPECIALIZED: Record<string, SpecializedComponent> = {
  // Charts (recharts is already in shadcn but we expose a sane wrapper)
  chart: {
    deps: ["recharts"],
    files: {},
    usage: "Use shadcn `chart.tsx` already in components/ui. Imports from 'recharts'.",
  },
  calendar: {
    deps: ["react-day-picker", "date-fns"],
    files: {},
    usage: "shadcn `calendar.tsx` wraps react-day-picker. Run `npx shadcn@latest add calendar` if missing.",
  },
  "rich-text-editor": {
    deps: ["@tiptap/react", "@tiptap/pm", "@tiptap/starter-kit"],
    files: {
      "src/components/editor/RichTextEditor.tsx": `import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

interface Props {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
}

export function RichTextEditor({ value = "", onChange, placeholder }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert min-h-[120px] max-w-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      },
    },
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  });
  if (!editor) return null;
  return <EditorContent editor={editor} placeholder={placeholder} />;
}
`,
    },
    usage: "import { RichTextEditor } from '@/components/editor/RichTextEditor';",
  },
  "data-table": {
    deps: ["@tanstack/react-table"],
    files: {},
    usage: "shadcn `data-table` recipe — see https://ui.shadcn.com/docs/components/data-table. Run `npx shadcn@latest add table` first.",
  },
  "qr-code": {
    deps: ["qrcode.react"],
    files: {
      "src/components/QRCode.tsx": `import { QRCodeSVG } from "qrcode.react";
export function QRCode({ value, size = 192 }: { value: string; size?: number }) {
  return (
    <div className="inline-block rounded-lg bg-background p-3 shadow-sm">
      <QRCodeSVG value={value} size={size} bgColor="transparent" fgColor="currentColor" />
    </div>
  );
}
`,
    },
    usage: "import { QRCode } from '@/components/QRCode';",
  },
  "color-picker": {
    deps: ["react-colorful"],
    files: {
      "src/components/ColorPicker.tsx": `import { HexColorPicker } from "react-colorful";
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return <HexColorPicker color={value} onChange={onChange} className="!w-full !max-w-xs" />;
}
`,
    },
    usage: "import { ColorPicker } from '@/components/ColorPicker';",
  },
  signature: {
    deps: ["react-signature-canvas"],
    files: {},
    usage: "import SignatureCanvas from 'react-signature-canvas'; — wrap with your own card/save controls.",
  },
};

export function makeReliabilityTools(sandbox: DaytonaSandbox, ctx: ToolCtx, cwd: string) {
  return {
    rls_validate: tool({
      description:
        "Validate Row-Level Security across every public.* table. Returns { ok, issues:[{table, severity, kind, fix}] }. " +
        "Run AFTER any supabase_create_table / supabase_sql migration AND before publishing. " +
        "kind: 'rls_disabled' | 'no_policies' | 'role_on_profiles' | 'permissive_true_policy'.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data: link } = await ctx.supabase
          .from("project_supabase_links")
          .select("schema_cache")
          .eq("project_id", ctx.projectId)
          .maybeSingle();
        const cache: any = (link as any)?.schema_cache ?? {};
        const tables: any[] = cache.tables ?? [];
        const issues: Array<{ table: string; severity: string; kind: string; fix: string }> = [];
        for (const t of tables) {
          const name = t.name;
          if (t.rls_enabled === false) {
            issues.push({
              table: name, severity: "high", kind: "rls_disabled",
              fix: `ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;`,
            });
          } else if ((t.policy_count ?? 0) === 0) {
            issues.push({
              table: name, severity: "high", kind: "no_policies",
              fix: `Add owner policies — supabase_add_policy with using_expr='auth.uid() = user_id'.`,
            });
          }
          if (/^(profiles|users)$/i.test(name) && Array.isArray(t.columns)) {
            const hasRole = t.columns.some((c: any) => /^role$/i.test(c.name));
            if (hasRole) {
              issues.push({
                table: name, severity: "high", kind: "role_on_profiles",
                fix: "Move role to a separate public.user_roles table + has_role() security-definer function (privilege-escalation risk).",
              });
            }
          }
          if (Array.isArray(t.policies)) {
            for (const p of t.policies) {
              const expr = String(p.using ?? p.qual ?? "").trim().toLowerCase();
              if (expr === "true") {
                issues.push({
                  table: name, severity: "medium", kind: "permissive_true_policy",
                  fix: `Policy "${p.name}" uses USING (true) — replace with auth.uid()-based check unless the table is intentionally public.`,
                });
              }
            }
          }
        }
        return { ok: issues.length === 0, count: issues.length, issues };
      },
    }),

    secret_scan_repo: tool({
      description:
        "Scan ALL committed repo files (not node_modules / .env / supabase/functions / generated client) for hardcoded secrets " +
        "using the shared safetyGuards pattern set (OpenAI, Anthropic, AWS, GitHub PAT, Stripe live, JWTs, webhooks, hardcoded passwords, …). " +
        "Returns { ok, findings:[{path, type, line, preview}] }. Run BEFORE github_push and BEFORE telling the user to publish.",
      inputSchema: z.object({
        max_files: z.number().int().min(10).max(2000).default(800),
      }),
      execute: async ({ max_files }) => {
        const r = await sandbox.exec(
          `find . -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.json' -o -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.html' -o -name '*.css' \\) ` +
          `-not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' -not -path './build/*' -not -path './supabase/functions/*' -not -path './src/integrations/supabase/*' ` +
          `| head -n ${max_files}`,
          cwd, 30,
        );
        const list = String((r as any).stdout ?? (r as any).result ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
        const findings: Array<{ path: string; type: string; line: number; preview: string }> = [];
        for (const rel of list) {
          const content = await sandbox.readFile(`${cwd}/${rel.replace(/^\.\//, "")}`).catch(() => "");
          if (!content) continue;
          const hits = scanForSecrets(rel, content);
          for (const h of hits) findings.push({ path: rel, type: h.type, line: h.line, preview: h.preview });
          if (findings.length >= 50) break;
        }
        return { ok: findings.length === 0, count: findings.length, findings };
      },
    }),

    done_gate: tool({
      description:
        "Atomic completion gate — runs typecheck + build_app + e2e_smoke_test in sequence and returns ONE verdict. " +
        "Use as the LAST tool of every non-trivial turn. If ok:false, fix the reported blockers and re-call. " +
        "Returns { ok, blockers:[{stage, summary}], stages:{typecheck, build, smoke} }.",
      inputSchema: z.object({
        smoke_paths: z.array(z.string()).default(["/"]),
      }),
      execute: async ({ smoke_paths }) => {
        const blockers: Array<{ stage: string; summary: string }> = [];

        // 1. Typecheck (fast — uses tsc --noEmit)
        const tc = await sandbox.exec("npx -y tsc --noEmit --pretty false 2>&1 | head -n 40", cwd, 240);
        const tcOut = String((tc as any).stdout ?? (tc as any).result ?? "").trim();
        const tcErrs = tcOut.split("\n").filter((l) => /error TS\d+:/i.test(l));
        if (tcErrs.length > 0) {
          blockers.push({ stage: "typecheck", summary: `${tcErrs.length} TS error(s):\n${tcErrs.slice(0, 8).join("\n")}` });
        }

        // 2. Build (vite)
        const bd = await sandbox.exec("npm run build 2>&1 | tail -n 40", cwd, 240);
        const bdOut = String((bd as any).stdout ?? (bd as any).result ?? "");
        if (/error|failed|✗|ERR_/i.test(bdOut) && !/0 errors/i.test(bdOut)) {
          blockers.push({ stage: "build", summary: bdOut.slice(-1500) });
        }

        // 3. Smoke (only if build passed — saves time)
        let smokeReport = "(skipped — build failed)";
        if (blockers.length === 0) {
          const ps = await sandbox.exec("pgrep -f vite >/dev/null && echo Y || echo N", cwd, 5);
          if (String((ps as any).stdout ?? "").trim() !== "Y") {
            await sandbox.exec("nohup npm run dev >/tmp/dev.log 2>&1 &", cwd, 5).catch(() => {});
            await new Promise((r) => setTimeout(r, 4000));
          }
          const issues: string[] = [];
          for (const p of smoke_paths) {
            const safe = p.replace(/'/g, "");
            const res = await sandbox.exec(
              `curl -fsS -o /tmp/__sg.html -w '%{http_code}' 'http://localhost:5173${safe}' 2>/dev/null || echo 000`,
              cwd, 30,
            );
            const status = parseInt(String((res as any).stdout ?? "000").trim(), 10) || 0;
            if (status !== 200) issues.push(`${p} → HTTP ${status}`);
          }
          smokeReport = issues.length === 0 ? "all routes 200" : issues.join("; ");
          if (issues.length > 0) blockers.push({ stage: "smoke", summary: smokeReport });
        }

        return {
          ok: blockers.length === 0,
          blockers,
          stages: {
            typecheck: tcErrs.length === 0 ? "clean" : `${tcErrs.length} errors`,
            build: blockers.find((b) => b.stage === "build") ? "failed" : "ok",
            smoke: smokeReport,
          },
          hint: blockers.length === 0
            ? "All gates green — safe to write the final user-facing reply."
            : "Fix blockers and re-call done_gate. Do NOT write the final reply yet.",
        };
      },
    }),

    list_specialized_components: tool({
      description:
        "List curated non-shadcn components available via add_specialized_component (charts, calendar, rich-text editor, data-table, qr-code, color-picker, signature). " +
        "Returns { components:[{name, deps, usage}] }.",
      inputSchema: z.object({}),
      execute: async () => ({
        components: Object.entries(SPECIALIZED).map(([name, spec]) => ({
          name, deps: spec.deps, usage: spec.usage, file_count: Object.keys(spec.files).length,
        })),
      }),
    }),

    add_specialized_component: tool({
      description:
        "One-shot install of a curated specialized component. Installs npm deps, writes wrapper component file(s), returns import snippet. " +
        "Available names: chart, calendar, rich-text-editor, data-table, qr-code, color-picker, signature. " +
        "Use BEFORE hand-rolling chart / calendar / editor code — these wrappers are pre-themed with the design system.",
      inputSchema: z.object({
        name: z.enum(["chart", "calendar", "rich-text-editor", "data-table", "qr-code", "color-picker", "signature"]),
      }),
      execute: async ({ name }) => {
        const spec = SPECIALIZED[name];
        if (!spec) return { ok: false, error: `unknown component: ${name}` };
        const installLog = spec.deps.length > 0
          ? await sandbox.exec(`npm install ${spec.deps.join(" ")} 2>&1 | tail -n 10`, cwd, 240).then((r) => String((r as any).stdout ?? (r as any).result ?? ""))
          : "(no deps)";
        const written: string[] = [];
        for (const [path, content] of Object.entries(spec.files)) {
          await sandbox.exec(`mkdir -p '${cwd}/$(dirname ${path})'`, cwd, 5).catch(() => {});
          await sandbox.writeFile(`${cwd}/${path}`, content);
          written.push(path);
        }
        return {
          ok: true, name, deps: spec.deps, written, usage: spec.usage,
          install_tail: installLog.slice(-400),
        };
      },
    }),
  };
}
