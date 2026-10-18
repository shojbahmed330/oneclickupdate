import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { ChatInlineDiff } from "./ChatInlineDiff";
import { Wrench } from "lucide-react";

type AnyToolPart = {
  type: string; // "tool-<name>"
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: any;
  output?: any;
  errorText?: string;
};

const ICONS: Record<string, string> = {
  write_file: "✏️",
  edit_file: "🩹",
  multi_edit: "🪡",
  read_file: "👁",
  delete_file: "🗑",
  move_file: "📦",
  copy_file: "📋",
  make_dir: "📂",
  list_dir: "📁",
  search_code: "🔎",
  glob_files: "🗂",
  run_command: "⚡",
  install_dep: "📥",
  uninstall_dep: "📤",
  npm_script: "📜",
  read_package_json: "📦",
  typecheck: "🧪",
  done_gate: "🔬",
  lint: "🧹",
  format: "💅",
  run_tests: "✅",
  generate_tests: "🧪",
  build_app: "🏗",
  start_dev_server: "🚀",
  restart_dev_server: "♻️",
  stop_dev_server: "🛑",
  read_dev_log: "📃",
  get_preview_url: "🔗",
  list_processes: "🧾",
  kill_process: "💀",
  git_status: "🌿",
  git_diff: "📝",
  web_search: "🌐",
  web_fetch: "📡",
  download_file: "⬇️",
  extract_archive: "🗜",
  generate_image: "🖼",
  supabase_schema: "🗂️",
  supabase_sql: "🗄️",
  recall: "📚",
  remember: "📌",
  get_plan: "📋",
  propose_plan: "📝",
  approve_plan: "✅",
  verify_routes: "🔬",
  read_console_logs: "🧯",
  rls_validate: "🔐",
  secret_scan_repo: "🛡️",
  heal: "🩺",
  github_status: "🐙",
  github_init_repo: "📦",
  github_push: "⬆️",
  think: "💭",
};

function describe(name: string, input: any): string {
  if (!input) return name;
  const p = input.path ?? "";
  switch (name) {
    case "write_file": return `Write ${p}`;
    case "edit_file": return `Edit ${p}`;
    case "multi_edit": return `Multi-edit ${p} (${input.edits?.length ?? 0})`;
    case "read_file": return `Read ${p}`;
    case "delete_file": return `Delete ${p}`;
    case "move_file": return `Move ${input.from ?? ""} → ${input.to ?? ""}`;
    case "copy_file": return `Copy ${input.from ?? ""} → ${input.to ?? ""}`;
    case "make_dir": return `Mkdir ${p}`;
    case "list_dir": return `List ${p || "."}`;
    case "search_code": return `Search "${(input.query ?? "").slice(0, 40)}"`;
    case "glob_files": return `Glob ${input.pattern ?? ""}`;
    case "run_command": return `Run: ${(input.command ?? "").slice(0, 60)}`;
    case "install_dep": return `Install ${(input.packages ?? []).join(", ")}`;
    case "uninstall_dep": return `Uninstall ${(input.packages ?? []).join(", ")}`;
    case "npm_script": return `npm run ${input.name ?? ""}`;
    case "read_package_json": return "Read package.json";
    case "typecheck": return "Type-check";
    case "done_gate": return "Final verification";
    case "lint": return `Lint ${p || "src"}`;
    case "format": return `Format ${input.pattern ?? ""}`;
    case "run_tests": return `Run tests ${input.pattern ?? ""}`.trim();
    case "generate_tests": return `Generate test → ${input.target_path ?? ""}`;
    case "build_app": return "Production build";
    case "start_dev_server": return "Start dev server";
    case "restart_dev_server": return "Restart dev server";
    case "stop_dev_server": return "Stop dev server";
    case "read_dev_log": return "Read dev log";
    case "get_preview_url": return "Get preview URL";
    case "list_processes": return "List processes";
    case "kill_process": return `Kill ${input.pid ?? input.pattern ?? ""}`;
    case "git_status": return "git status";
    case "git_diff": return `git diff ${p}`.trim();
    case "web_search": return `Web search: ${(input.query ?? "").slice(0, 50)}`;
    case "web_fetch": return `Fetch ${input.url ?? ""}`;
    case "download_file": return `Download → ${p}`;
    case "extract_archive": return `Extract ${input.archive ?? ""}`;
    case "generate_image": return `Generate image → ${p}`;
    case "supabase_schema": return "Read Supabase schema";
    case "supabase_sql": return `Run SQL: ${(input.sql ?? "").replace(/\s+/g, " ").slice(0, 60)}`;
    case "recall": return "Recall memories";
    case "remember": return `Remember: ${(input.content ?? "").slice(0, 60)}`;
    case "get_plan": return "Load plan";
    case "propose_plan": return `Propose plan: ${(input.app_name ?? "").slice(0, 40)}`;
    case "approve_plan": return "Approve plan";
    case "verify_routes": return `Verify ${(input.routes ?? []).length} route(s)`;
    case "read_console_logs": return "Read console logs";
    case "rls_validate": return "Validate backend security";
    case "secret_scan_repo": return "Scan for secrets";
    case "heal": return "Heal: scan errors";
    case "github_status": return "GitHub status";
    case "github_init_repo": return `Create repo: ${input.name ?? ""}`;
    case "github_push": return `Push: ${(input.message ?? "").slice(0, 50)}`;
    case "think": return `Think: ${(input.thought ?? "").slice(0, 60)}`;
    default: return name;
  }
}

export const AgentToolPart = ({ part }: { part: AnyToolPart }) => {
  const name = part.type.replace(/^tool-/, "");
  const title = `${ICONS[name] ?? "🔧"}  ${describe(name, part.input)}`;
  const out = (part.output ?? null) as
    | { before?: string; after?: string; path?: string; additions?: number; deletions?: number; ok?: boolean; stderr?: string; error?: string }
    | null;
  const hasDiff =
    (name === "write_file" || name === "edit_file" || name === "multi_edit") &&
    !!out && typeof out.before === "string" && typeof out.after === "string" && out.ok !== false;

  // Detect failure: explicit output-error state, or tool output with ok:false / error / non-empty stderr.
  const errorText = part.errorText
    || (out && (out.ok === false || out.error)
        ? (out.error || out.stderr || JSON.stringify(out).slice(0, 600))
        : null);
  const hasError = part.state === "output-error" || !!errorText;

  const defaultOpen = hasDiff || hasError;

  const tryFix = () => {
    const summary = describe(name, part.input);
    const detail =
      `🔧 Try to fix this error from \`${name}\`\n` +
      `**Step:** ${summary}\n\n` +
      "```\n" +
      String(errorText ?? "Unknown error").slice(0, 2000) +
      "\n```\n\n" +
      "Investigate the root cause and apply a fix, then re-run the failed step.";
    window.dispatchEvent(
      new CustomEvent("agent-composer-append", { detail: { text: detail } }),
    );
  };

  return (
    <Tool defaultOpen={defaultOpen}>
      <ToolHeader type={`tool-${name}`} state={part.state} title={title} />
      <ToolContent>
        <ToolInput input={part.input} />
        {hasDiff ? (
          <ChatInlineDiff
            before={out!.before ?? ""}
            after={out!.after ?? ""}
            path={out!.path ?? part.input?.path}
            additions={out!.additions}
            deletions={out!.deletions}
          />
        ) : (
          <ToolOutput output={part.output as never} errorText={part.errorText} />
        )}
        {hasError && (
          <div className="px-3 pb-3 pt-1">
            <button
              type="button"
              onClick={tryFix}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/15 active:scale-95 transition"
            >
              <Wrench className="h-3.5 w-3.5" />
              Try to fix
            </button>
          </div>
        )}
      </ToolContent>
    </Tool>
  );
};
