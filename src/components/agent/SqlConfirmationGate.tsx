import { useMemo, useState } from "react";
import { AlertTriangle, ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PendingSql {
  toolCallId: string;
  sql: string;
  reason: string;
}

interface Props {
  messages: any[];
  projectId: string;
}

/**
 * Surfaces destructive-SQL confirmation requests from the agent.
 * The `supabase-run-sql` edge fn returns `{ requires_confirmation: true }`
 * for DROP / TRUNCATE / DELETE-without-WHERE / UPDATE-without-WHERE.
 * The user must explicitly approve before the SQL actually runs.
 */
export const SqlConfirmationGate = ({ messages, projectId }: Props) => {
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<string | null>(null);

  const pending = useMemo<PendingSql[]>(() => {
    const out: PendingSql[] = [];
    for (const m of messages) {
      const parts = m?.parts ?? [];
      for (const p of parts) {
        if (p?.type !== "tool-supabase_sql") continue;
        if (p.state !== "output-available") continue;
        const out_ = p.output;
        if (!out_?.requires_confirmation) continue;
        if (resolved.has(p.toolCallId)) continue;
        out.push({ toolCallId: p.toolCallId, sql: String(out_.sql ?? ""), reason: String(out_.reason ?? "") });
      }
    }
    return out;
  }, [messages, resolved]);

  if (pending.length === 0) return null;

  const handleConfirm = async (item: PendingSql) => {
    setRunning(item.toolCallId);
    try {
      const { data, error } = await supabase.functions.invoke("supabase-run-sql", {
        body: { project_id: projectId, sql: item.sql, confirm: true },
      });
      if (error) throw error;
      if ((data as any)?.ok === false) throw new Error((data as any).error || "SQL failed");
      toast.success("Destructive SQL executed");
      setResolved((s) => new Set(s).add(item.toolCallId));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to run SQL");
    } finally {
      setRunning(null);
    }
  };

  const handleCancel = (item: PendingSql) => {
    setResolved((s) => new Set(s).add(item.toolCallId));
    toast("SQL cancelled — destructive change skipped");
  };

  return (
    <div className="space-y-2 px-3 pb-2">
      {pending.map((item) => (
        <div
          key={item.toolCallId}
          className="relative overflow-hidden rounded-2xl border border-destructive/40 bg-gradient-to-br from-destructive/[0.08] via-background to-background shadow-sm"
        >
          <div className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-destructive/20 blur-3xl" />
          <div className="relative p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="grid place-items-center h-9 w-9 rounded-xl bg-destructive/15 text-destructive shrink-0 ring-1 ring-destructive/25">
                <ShieldAlert size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-destructive">
                  Permission needed
                </div>
                <div className="mt-0.5 text-sm font-semibold leading-tight">
                  Approve destructive database change
                </div>
                <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span>{item.reason}</span>
                </div>
              </div>
            </div>

            <pre className="text-[11px] font-mono bg-muted/40 border border-border/60 rounded-lg p-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {item.sql}
            </pre>

            <div className="flex gap-2 justify-end pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCancel(item)}
                disabled={running === item.toolCallId}
                className="active:scale-95"
              >
                <X size={13} className="mr-1" /> Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleConfirm(item)}
                disabled={running === item.toolCallId}
                className="active:scale-95 shadow-sm"
              >
                <Check size={13} className="mr-1" />
                {running === item.toolCallId ? "Running…" : "Approve & run"}
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
