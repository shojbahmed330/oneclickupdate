// Hover-revealed action bar for USER messages: Copy, Edit, Resend, Delete.
// Delete removes from local state AND from the database, so the agent never
// re-receives it on subsequent turns (transport sends current useChat state).
import { useState } from "react";
import { Copy, Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  onEdit?: () => void;
  onResend?: () => void;
  onDelete?: () => void;
  className?: string;
};

export const UserMessageActions = ({ text, onEdit, onResend, onDelete, className }: Props) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const handleDelete = () => {
    if (!onDelete) return;
    if (!window.confirm("Delete this message? This cannot be undone.")) return;
    onDelete();
  };

  const btn = "h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.96] transition";

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-0.5 justify-end",
        className,
      )}
    >
      <button type="button" onClick={handleCopy} className={btn} title="Copy" aria-label="Copy message">
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {onEdit && (
        <button type="button" onClick={onEdit} className={btn} title="Edit" aria-label="Edit message">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {onResend && (
        <button type="button" onClick={onResend} className={btn} title="Resend" aria-label="Resend message">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={handleDelete}
          className={cn(btn, "hover:text-destructive")}
          title="Delete"
          aria-label="Delete message"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
