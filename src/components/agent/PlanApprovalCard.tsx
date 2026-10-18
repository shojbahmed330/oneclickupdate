import { useEffect, useState } from "react";
import { CheckCircle2, Sparkles, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  appName?: string;
  description?: string;
  features?: string[];
  screensCount?: number;
  modelsCount?: number;
}

/**
 * Renders a polished approval card instead of the bare
 * "Reply 'go' / 'approve' to start" line. Buttons dispatch the
 * `agent-composer-append` event consumed by AgentComposer to
 * auto-submit the user's choice.
 */
export const PlanApprovalCard = ({
  appName,
  description,
  features = [],
  screensCount = 0,
  modelsCount = 0,
}: Props) => {
  const storageKey = `plan-approval:${appName ?? ""}:${(description ?? "").slice(0, 60)}`;
  const [decided, setDecided] = useState<null | "approve" | "change">(() => {
    if (typeof window === "undefined") return null;
    const v = window.sessionStorage.getItem(storageKey);
    return v === "approve" || v === "change" ? v : null;
  });
  useEffect(() => {
    if (decided && typeof window !== "undefined") {
      window.sessionStorage.setItem(storageKey, decided);
    }
  }, [decided, storageKey]);

  const send = (text: string, autoSubmit = true, choice: "approve" | "change") => {
    if (decided) return;
    setDecided(choice);
    window.dispatchEvent(
      new CustomEvent("agent-composer-append", {
        detail: { text, submit: autoSubmit },
      }),
    );
  };

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background shadow-lg shadow-primary/10">
      <div className="flex items-center gap-2 border-b border-border/50 bg-background/40 px-4 py-2.5 backdrop-blur">
        <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 shadow-sm shadow-primary/30">
          <Sparkles size={14} className="text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Approval needed
          </div>
          {appName && (
            <div className="truncate text-sm font-medium leading-tight">
              {appName}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
        {(features.length > 0 || screensCount > 0 || modelsCount > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {features.length > 0 && (
              <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {features.length} features
              </span>
            )}
            {screensCount > 0 && (
              <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {screensCount} screens
              </span>
            )}
            {modelsCount > 0 && (
              <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {modelsCount} tables
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground/80">
          Review the plan above. Approve to start building, or request changes.
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border/40 bg-background/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={!!decided}
          onClick={() => send("Please change: ", false, "change")}
          className="active:scale-95 disabled:opacity-50"
        >
          <Pencil className="mr-1.5 size-3.5" />
          {decided === "change" ? "Changes requested" : "Request changes"}
        </Button>
        <Button
          size="sm"
          disabled={!!decided}
          onClick={() => send("approve", true, "approve")}
          className="bg-gradient-to-r from-primary to-primary/80 active:scale-95 shadow-md shadow-primary/30 disabled:opacity-60"
        >
          <CheckCircle2 className="mr-1.5 size-3.5" />
          {decided === "approve" ? "Approved" : "Approve & start"}
        </Button>
      </div>
    </div>
  );
};
