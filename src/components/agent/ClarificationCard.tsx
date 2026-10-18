import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Option {
  label: string;
  description?: string;
}

interface Props {
  question: string;
  options: Option[];
  allowOther?: boolean;
}

/**
 * Multiple-choice clarification card. The agent calls ask_clarification, the
 * tool result renders this. Picking an option auto-submits as the next turn.
 */
export const ClarificationCard = ({ question, options, allowOther = true }: Props) => {
  const storageKey = `clarify:${question.slice(0, 80)}`;
  const [picked, setPicked] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(storageKey);
  });
  useEffect(() => {
    if (picked && typeof window !== "undefined") {
      window.sessionStorage.setItem(storageKey, picked);
    }
  }, [picked, storageKey]);

  const send = (text: string, autoSubmit: boolean) => {
    if (picked) return;
    setPicked(text);
    window.dispatchEvent(
      new CustomEvent("agent-composer-append", { detail: { text, submit: autoSubmit } }),
    );
  };

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background shadow-lg shadow-primary/10">
      <div className="flex items-center gap-2 border-b border-border/50 bg-background/40 px-4 py-2.5 backdrop-blur">
        <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 shadow-sm shadow-primary/30">
          <HelpCircle size={14} className="text-primary-foreground" />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Quick question
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        <p className="text-sm font-medium leading-relaxed">{question}</p>
        <div className="grid gap-2">
          {options.map((opt, i) => (
            <button
              key={i}
              type="button"
              disabled={!!picked}
              onClick={() => send(opt.label, true)}
              className="text-left rounded-xl border border-border/60 bg-card hover:bg-muted/50 active:scale-[0.99] transition px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="text-sm font-medium">{opt.label}</div>
              {opt.description && (
                <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
              )}
            </button>
          ))}
          {allowOther && (
            <Button
              variant="outline"
              size="sm"
              disabled={!!picked}
              onClick={() => send("Other: ", false)}
              className="active:scale-95 disabled:opacity-50"
            >
              Other / type my own
            </Button>
          )}
        </div>
        {picked && (
          <p className="text-xs text-muted-foreground/80">Picked: <span className="font-medium text-foreground">{picked}</span></p>
        )}
      </div>
    </div>
  );
};
