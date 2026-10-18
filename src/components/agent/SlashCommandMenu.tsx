// Slash command palette — quick-prompt templates that appear above the
// composer when the user types a leading "/" keyword. Arrow keys + Enter / Tab
// to insert. Templates are intentionally short and end with a trailing space
// or newline so the user can keep typing context after picking.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Wrench, Sparkles, BookOpen, FlaskConical, Zap, Eye, Bug } from "lucide-react";

export type SlashCommand = {
  key: string;        // matched against the leading /token
  label: string;
  icon: React.ComponentType<any>;
  hint: string;
  /** Replacement text that gets inserted in place of the typed `/...`. */
  template: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { key: "fix", label: "/fix", icon: Wrench, hint: "Diagnose and fix the latest error",
    template: "Fix the latest runtime/build error. Read recent dev logs, identify the root cause, apply a minimal fix, and verify.\n\nContext: " },
  { key: "refactor", label: "/refactor", icon: Sparkles, hint: "Clean up without changing behaviour",
    template: "Refactor the following without changing behaviour. Keep public APIs stable. Split files >150 lines, extract repeated logic, and prefer semantic tokens.\n\nTarget: " },
  { key: "explain", label: "/explain", icon: BookOpen, hint: "Explain code or behaviour",
    template: "Explain how this works in plain language — flow, data, edge cases. Don't change any code.\n\nTarget: " },
  { key: "test", label: "/test", icon: FlaskConical, hint: "Generate vitest spec",
    template: "Generate a vitest spec covering happy-path + edge cases for:\n\nTarget: " },
  { key: "optimize", label: "/optimize", icon: Zap, hint: "Performance / bundle wins",
    template: "Find the top performance issues (render, network, bundle) and apply safe wins. Measure before/after if possible.\n\nScope: " },
  { key: "review", label: "/review", icon: Eye, hint: "Code review pass",
    template: "Do a critical code review pass on the recent changes — flag bugs, edge cases, accessibility, and naming.\n\n" },
  { key: "debug", label: "/debug", icon: Bug, hint: "Investigate a bug",
    template: "Help me debug this. Form a hypothesis, add temporary logs if needed, run the failing path, and report what you find.\n\nSymptom: " },
];

interface Props {
  query: string;          // text after the leading "/"
  onPick: (cmd: SlashCommand) => void;
  onClose: () => void;
}

export const SlashCommandMenu = ({ query, onPick, onClose }: Props) => {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (c) => c.key.startsWith(q) || c.label.toLowerCase().includes(q),
    );
  }, [query]);

  const [idx, setIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setIdx(0); }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (filtered.length === 0) {
        if (e.key === "Escape") onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onPick(filtered[idx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filtered, idx, onPick, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={wrapRef}
      className="rounded-lg border border-border bg-popover shadow-lg overflow-hidden text-sm"
    >
      <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
        Slash commands
      </div>
      <ul className="max-h-60 overflow-y-auto py-1">
        {filtered.map((c, i) => {
          const Icon = c.icon;
          const active = i === idx;
          return (
            <li key={c.key}>
              <button
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => onPick(c)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-1.5 text-left active:scale-[0.99] transition",
                  active ? "bg-primary/10 text-foreground" : "text-foreground/85 hover:bg-muted",
                )}
              >
                <Icon size={14} className={cn(active ? "text-primary" : "text-muted-foreground")} />
                <span className="font-medium tabular-nums">{c.label}</span>
                <span className="text-xs text-muted-foreground truncate">— {c.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
