import { Sparkles, RefreshCw, X, Hammer, Loader2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import type { DesignModeState } from "@/hooks/useDesignMode";
import { cn } from "@/lib/utils";

interface Props {
  state: DesignModeState;
  onBuild: () => void;
  onRegenerateAll: () => void;
  onRegenerateScreen: (key: string) => void;
  onSetActive: (i: number) => void;
  onSkip: () => void;
}

/**
 * Multi-screen prototype gallery. Shows a swipeable phone preview of each
 * generated screen and lets the user regenerate per screen or build the whole
 * approved set.
 */
export const DesignModePanel = ({
  state,
  onBuild,
  onRegenerateAll,
  onRegenerateScreen,
  onSetActive,
  onSkip,
}: Props) => {
  if (state.status === "idle") return null;

  const screens = state.screens;
  const active = screens[state.activeIndex];
  const readyCount = screens.filter((s) => s.status === "ready").length;
  const totalCount = screens.length;
  const allDone = totalCount > 0 && readyCount === totalCount;

  return (
    <div className="border-t border-border bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/80 shadow-[0_-8px_24px_-12px_hsl(var(--background))]">
      <div className="p-3">
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-background/40">
            <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 shadow-sm shadow-primary/30">
              <Sparkles size={14} className="text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary leading-tight">
                Design Preview
                {totalCount > 0 && (
                  <span className="ml-2 text-muted-foreground normal-case tracking-normal font-normal">
                    {readyCount}/{totalCount} screens
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground leading-tight">
                {state.status === "planning" && "Planning your app's screens…"}
                {state.status === "generating" && `Designing screens in parallel…`}
                {state.status === "saving" && "Saving references & starting build…"}
                {state.status === "preview" && (allDone ? "Approve to build all screens, or refine any" : "Some screens still generating…")}
                {state.status === "error" && "Couldn't generate preview"}
              </div>
            </div>
            <button
              type="button"
              onClick={onSkip}
              title="Skip design preview"
              className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition"
            >
              <X size={14} />
            </button>
          </div>

          {state.status === "planning" && (
            <div className="h-[200px] grid place-items-center text-sm text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <Loader2 size={20} className="animate-spin text-primary" />
                <div>Mapping out your app's screens…</div>
                <div className="text-[10px] text-muted-foreground/70">~5s</div>
              </div>
            </div>
          )}

          {state.status === "error" && (
            <div className="p-4 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-destructive text-sm text-center">
                <AlertCircle size={16} />
                <span>{state.error || "Generation failed"}</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onRegenerateAll}
                  className="h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition inline-flex items-center gap-1.5"
                >
                  <RefreshCw size={12} /> Try again
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  className="h-8 px-3 rounded-lg text-xs font-medium border border-border hover:bg-muted active:scale-[0.97] transition"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {(state.status === "generating" || state.status === "preview" || state.status === "saving") && totalCount > 0 && active && (
            <>
              {/* Screen tabs strip */}
              <div className="px-3 pt-3 pb-2 overflow-x-auto scrollbar-none">
                <div className="flex items-center gap-1.5 min-w-max">
                  {screens.map((s, i) => {
                    const isActive = i === state.activeIndex;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => onSetActive(i)}
                        className={cn(
                          "h-7 px-2.5 rounded-full text-[11px] font-medium transition active:scale-95 inline-flex items-center gap-1.5 shrink-0",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {s.status === "generating" && <Loader2 size={10} className="animate-spin" />}
                        {s.status === "error" && <AlertCircle size={10} className="text-destructive" />}
                        {s.status === "ready" && <span className="size-1.5 rounded-full bg-emerald-500" />}
                        {s.status === "pending" && <span className="size-1.5 rounded-full bg-muted-foreground/40" />}
                        <span>{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Phone preview */}
              <div className="bg-muted/20 grid place-items-center py-3 relative">
                {/* Prev/Next arrows */}
                {totalCount > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => onSetActive(state.activeIndex - 1)}
                      disabled={state.activeIndex === 0}
                      className="absolute left-2 top-1/2 -translate-y-1/2 size-8 grid place-items-center rounded-full bg-background/80 border border-border shadow hover:bg-background disabled:opacity-30 active:scale-95 transition"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetActive(state.activeIndex + 1)}
                      disabled={state.activeIndex >= totalCount - 1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 size-8 grid place-items-center rounded-full bg-background/80 border border-border shadow hover:bg-background disabled:opacity-30 active:scale-95 transition"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </>
                )}
                <div className="w-[260px] h-[440px] rounded-[28px] border-[6px] border-foreground/80 overflow-hidden shadow-2xl bg-background">
                  {active.status === "ready" && active.html ? (
                    <iframe
                      key={active.key}
                      srcDoc={active.html}
                      title={`Design: ${active.label}`}
                      sandbox="allow-scripts"
                      className="w-[390px] h-[660px] origin-top-left"
                      style={{ transform: "scale(0.6667)" }}
                    />
                  ) : active.status === "error" ? (
                    <div className="h-full grid place-items-center text-xs text-destructive p-4 text-center">
                      <div>
                        <AlertCircle size={20} className="mx-auto mb-2" />
                        {active.error || "Failed"}
                      </div>
                    </div>
                  ) : (
                    <div className="h-full grid place-items-center text-xs text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 size={18} className="animate-spin text-primary" />
                        <div>{active.status === "generating" ? "Generating…" : "Queued"}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Dots */}
              {totalCount > 1 && (
                <div className="flex items-center justify-center gap-1.5 pb-2">
                  {screens.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onSetActive(i)}
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        i === state.activeIndex ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/40",
                      )}
                    />
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 p-3 border-t border-border/50 bg-background/60">
                <button
                  type="button"
                  onClick={onBuild}
                  disabled={readyCount === 0 || state.status === "saving"}
                  className="flex-1 min-w-[160px] h-10 rounded-xl text-sm font-semibold bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/30 hover:brightness-110 active:scale-[0.98] transition inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {state.status === "saving" ? (
                    <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  ) : (
                    <><Hammer size={14} /> Build {readyCount > 0 ? `${readyCount} screen${readyCount > 1 ? "s" : ""}` : "this design"}</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onRegenerateScreen(active.key)}
                  disabled={active.status === "generating"}
                  title="Regenerate just this screen"
                  className="h-10 px-3 rounded-xl border border-border hover:bg-muted active:scale-[0.97] transition inline-flex items-center gap-1.5 text-xs font-medium disabled:opacity-50"
                >
                  <RefreshCw size={12} className={cn(active.status === "generating" && "animate-spin")} /> This
                </button>
                <button
                  type="button"
                  onClick={onRegenerateAll}
                  title="Regenerate all screens"
                  className="h-10 px-3 rounded-xl border border-border hover:bg-muted active:scale-[0.97] transition inline-flex items-center gap-1.5 text-xs font-medium"
                >
                  <RefreshCw size={12} /> All
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  className="h-10 px-3 rounded-xl border border-border hover:bg-muted active:scale-[0.97] transition text-xs font-medium"
                >
                  Skip
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
