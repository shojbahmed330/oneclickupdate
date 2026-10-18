import { useEffect, useState } from "react";
import { Palette } from "lucide-react";

interface Direction {
  id: string;
  name: string;
  summary: string;
  accent?: string;
}

interface Props {
  target: string;
  directions: Direction[];
}

/**
 * Renders 2-3 design direction cards. User picks one → auto-submits "Build direction: <name>"
 * so the agent applies the chosen aesthetic in the next turn.
 */
export const DesignDirectionsCard = ({ target, directions }: Props) => {
  const storageKey = `design-dir:${target}`;
  const [picked, setPicked] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(storageKey);
  });
  useEffect(() => {
    if (picked && typeof window !== "undefined") {
      window.sessionStorage.setItem(storageKey, picked);
    }
  }, [picked, storageKey]);

  const pick = (d: Direction) => {
    if (picked) return;
    setPicked(d.id);
    window.dispatchEvent(
      new CustomEvent("agent-composer-append", {
        detail: { text: `Build direction: ${d.name} (${d.id}) for ${target}`, submit: true },
      }),
    );
  };

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background shadow-lg shadow-primary/10">
      <div className="flex items-center gap-2 border-b border-border/50 bg-background/40 px-4 py-2.5 backdrop-blur">
        <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 shadow-sm shadow-primary/30">
          <Palette size={14} className="text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Pick a direction
          </div>
          <div className="truncate text-sm font-medium leading-tight">{target}</div>
        </div>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {directions.map((d) => {
          const isPicked = picked === d.id;
          return (
            <button
              key={d.id}
              type="button"
              disabled={!!picked}
              onClick={() => pick(d)}
              className={`text-left rounded-xl border p-3 transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed ${
                isPicked
                  ? "border-primary bg-primary/10"
                  : "border-border/60 bg-card hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">{d.name}</span>
                {d.accent && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {d.accent}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-snug">{d.summary}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};
