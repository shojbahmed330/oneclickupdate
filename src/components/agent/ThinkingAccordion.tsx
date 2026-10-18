// Collapsible "Thinking..." block for extended-reasoning model output.
// Shows live while streaming, auto-collapses once final answer begins.
import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  /** When true, force-open while content is still streaming. */
  streaming?: boolean;
  className?: string;
};

export const ThinkingAccordion = ({ text, streaming = false, className }: Props) => {
  const [open, setOpen] = useState(streaming);

  if (!text?.trim()) return null;

  return (
    <div
      className={cn(
        "my-2 rounded-r-lg border-l-2 border-accent/40 bg-accent/5 pl-3 pr-3 py-2",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
        aria-expanded={open}
      >
        <Brain className="h-3.5 w-3.5 shrink-0" />
        <span>{streaming ? "Thinking…" : "Thought process"}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 ml-auto transition-transform", open && "rotate-180")}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr] mt-2" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs italic leading-relaxed text-muted-foreground/90">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
};
