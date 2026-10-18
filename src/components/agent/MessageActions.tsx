// Hover-revealed action bar for assistant messages: Copy, Retry, Thumbs up/down.
// Renders inline beneath the message content. Mobile: always visible (no hover).
import { useState } from "react";
import { Copy, Check, RotateCcw, ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  onRetry?: () => void;
  onFeedback?: (kind: "up" | "down") => void;
  /** Optional per-turn meta (tokens / credits) shown as a tiny chip */
  meta?: { tokens?: number; credits?: number; model?: string };
  className?: string;
};

export const MessageActions = ({ text, onRetry, onFeedback, meta, className }: Props) => {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const handleFeedback = (kind: "up" | "down") => {
    setFeedback(kind);
    onFeedback?.(kind);
  };

  const btn = "h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.96] transition";

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity",
        // Always visible on touch devices
        "[@media(hover:none)]:opacity-100",
        className,
      )}
    >
      <button type="button" onClick={handleCopy} className={btn} title="Copy" aria-label="Copy message">
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {onRetry && (
        <button type="button" onClick={onRetry} className={btn} title="Retry" aria-label="Retry response">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => handleFeedback("up")}
        className={cn(btn, feedback === "up" && "text-primary")}
        title="Good response"
        aria-label="Thumbs up"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => handleFeedback("down")}
        className={cn(btn, feedback === "down" && "text-destructive")}
        title="Bad response"
        aria-label="Thumbs down"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      {meta && (meta.tokens || meta.credits) ? (
        <span
          className="ml-1 inline-flex items-center gap-1 px-1.5 h-5 rounded text-[10px] text-muted-foreground bg-muted/50"
          title={meta.model ? `Model: ${meta.model}` : "Turn usage"}
        >
          {meta.tokens ? `${meta.tokens.toLocaleString()} tok` : null}
          {meta.tokens && meta.credits ? " · " : null}
          {meta.credits ? `~${meta.credits} cr` : null}
        </span>
      ) : null}
    </div>
  );
};
