import { useMemo } from "react";
import { Loader2, Wrench, Check, X, Coins, FileEdit, Hammer, Eye } from "lucide-react";

interface ToolEvent {
  name: string;
  status: "started" | "ok" | "fail";
  t: number;
  ms?: number;
  summary?: string;
}

interface Props {
  /** The streaming assistant message — its metadata is updated live via realtime upserts. */
  message: any;
  /** True only while AI SDK is actively streaming this message. */
  isStreaming: boolean;
}

const FILE_WRITE_TOOLS = new Set(["edit_file", "write_file", "multi_edit", "scaffold_auth", "scaffold_edge_function"]);

type GateStatus = "pending" | "running" | "ok" | "fail";

function deriveGateStatus(timeline: ToolEvent[], toolName: string): GateStatus {
  let status: GateStatus = "pending";
  for (const ev of timeline) {
    if (ev.name !== toolName) continue;
    if (ev.status === "started") status = "running";
    else if (ev.status === "ok") status = "ok";
    else if (ev.status === "fail") status = "fail";
  }
  return status;
}

/**
 * Live progress + token/credit meter for the in-flight agent turn.
 * Reads from the assistant message's `metadata` which the backend
 * refreshes on every onStepFinish via chat_messages upsert.
 */
export const AgentRunMeter = ({ message, isStreaming }: Props) => {
  const meta = (message?.metadata ?? {}) as Record<string, unknown>;
  const tokensIn = Number(meta.tokens_in ?? 0);
  const tokensOut = Number(meta.tokens_out ?? 0);
  const steps = Number(meta.steps ?? 0);
  const estimated = Number(meta.estimated_credits ?? 0);
  const timeline = (meta.tool_timeline as ToolEvent[] | undefined) ?? [];

  // ─── F. Progress visibility derivations ───
  const filesWritten = useMemo(
    () => timeline.filter((ev) => FILE_WRITE_TOOLS.has(ev.name) && ev.status === "ok").length,
    [timeline],
  );
  // Rough estimate from current step count; the agent typically writes ~1 file
  // every 2 steps once implementation phase starts. Capped at a sensible upper.
  const filesEstimate = useMemo(() => {
    if (filesWritten === 0) return 20;
    return Math.max(filesWritten + 3, Math.min(40, Math.ceil(filesWritten * 1.5)));
  }, [filesWritten]);

  const buildStatus = useMemo(() => deriveGateStatus(timeline, "build_app"), [timeline]);
  const previewStatus = useMemo(() => deriveGateStatus(timeline, "e2e_smoke_test"), [timeline]);

  // Show only while actively streaming and we have at least 1 data point.
  const hasData = tokensIn > 0 || tokensOut > 0 || steps > 0 || timeline.length > 0;
  if (!isStreaming || !hasData) return null;

  // Last 6 distinct tool actions (newest right) for compact pill rail.
  const recent = useMemo(() => {
    const slice = timeline.slice(-12);
    const seen = new Set<string>();
    const out: ToolEvent[] = [];
    for (let i = slice.length - 1; i >= 0 && out.length < 6; i--) {
      const ev = slice[i];
      const key = `${ev.name}-${ev.status}-${ev.t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.unshift(ev);
    }
    return out;
  }, [timeline]);

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="my-2 rounded-2xl border border-border bg-card/60 backdrop-blur-sm px-3 py-2 text-xs flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Step {steps || 1}
        </span>

        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="text-foreground font-medium">{fmt(tokensIn)}</span>
          <span>in</span>
          <span className="text-foreground font-medium">·{fmt(tokensOut)}</span>
          <span>out</span>
        </span>

        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
          title="Live estimate — final cost may differ slightly."
        >
          <Coins className="h-3 w-3" />
          ~{estimated} credits
        </span>

        {recent.length > 0 && (
          <div className="flex items-center gap-1 ml-auto overflow-x-auto max-w-full">
            {recent.map((ev, i) => (
              <ToolPill key={`${ev.name}-${ev.t}-${i}`} ev={ev} />
            ))}
          </div>
        )}
      </div>

      {/* ─── Progress visibility row ─── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
        <StatusBadge
          icon={<FileEdit className="h-3 w-3" />}
          label="Files"
          value={`${filesWritten}/~${filesEstimate}`}
          tone={filesWritten > 0 ? "active" : "pending"}
        />
        <StatusBadge
          icon={<Hammer className="h-3 w-3" />}
          label="Build"
          value={
            buildStatus === "ok" ? "passed"
            : buildStatus === "fail" ? "failed"
            : buildStatus === "running" ? "running…"
            : "pending"
          }
          tone={buildStatus}
        />
        <StatusBadge
          icon={<Eye className="h-3 w-3" />}
          label="Preview"
          value={
            previewStatus === "ok" ? "ready"
            : previewStatus === "fail" ? "broken"
            : previewStatus === "running" ? "checking…"
            : "not yet"
          }
          tone={previewStatus}
        />
      </div>
    </div>
  );
};

const StatusBadge = ({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: GateStatus | "active";
}) => {
  const cls =
    tone === "ok" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
    : tone === "fail" ? "bg-destructive/10 text-destructive border-destructive/20"
    : tone === "running" ? "bg-primary/10 text-primary border-primary/20"
    : tone === "active" ? "bg-primary/10 text-primary border-primary/20"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>
      {icon}
      <span className="font-medium">{label}:</span>
      <span className="opacity-90">{value}</span>
    </span>
  );
};

const ToolPill = ({ ev }: { ev: ToolEvent }) => {
  const icon = ev.status === "ok" ? <Check className="h-3 w-3" />
    : ev.status === "fail" ? <X className="h-3 w-3" />
    : <Wrench className="h-3 w-3 animate-pulse" />;
  const tone = ev.status === "ok" ? "bg-muted text-muted-foreground border-border"
    : ev.status === "fail" ? "bg-destructive/10 text-destructive border-destructive/20"
    : "bg-primary/10 text-primary border-primary/20";
  const ms = ev.ms ? `${ev.ms < 1000 ? `${ev.ms}ms` : `${(ev.ms / 1000).toFixed(1)}s`}` : "";
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border whitespace-nowrap ${tone}`}
      title={ev.summary ? `${ev.name} — ${ev.summary}` : ev.name}
    >
      {icon}
      <span className="font-medium">{ev.name}</span>
      {ms && <span className="opacity-70">{ms}</span>}
    </span>
  );
};
