import { Loader2, Play, RefreshCw } from "lucide-react";

interface Props {
  visible: boolean;
  status: "submitted" | "streaming" | "ready" | "error";
  onContinue: () => void;
}

export const ResumeBanner = ({ visible, status, onContinue }: Props) => {
  if (!visible) return null;
  const isError = status === "error";

  return (
    <div className="mx-3 mb-2 rounded-2xl border border-border bg-gradient-to-br from-primary/[0.06] via-background to-background p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
          {isError ? (
            <RefreshCw className="h-4 w-4 text-primary" />
          ) : (
            <Loader2 className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            {isError ? "Run interrupted" : "Run paused"}
          </div>
          <p className="mt-0.5 text-sm text-foreground">
            {isError
              ? "Last response stopped before finishing (likely token limit or stream error)."
              : "You stopped the run. Pick up exactly where it left off — partial files were not saved."}
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm active:scale-95 transition-transform"
          >
            <Play className="h-3.5 w-3.5" />
            Continue from where it stopped
          </button>
        </div>
      </div>
    </div>
  );
};
