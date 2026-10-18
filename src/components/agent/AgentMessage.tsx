import { useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { AgentToolPart } from "./AgentToolPart";
import { StreamingCursor } from "./StreamingCursor";
import { MessageActions } from "./MessageActions";
import { UserMessageActions } from "./UserMessageActions";
import { ThinkingAccordion } from "./ThinkingAccordion";
import { AgentRunMeter } from "./AgentRunMeter";
import { ConnectBackendCallout } from "./ConnectBackendCallout";
import { PlanApprovalCard } from "./PlanApprovalCard";
import { ClarificationCard } from "./ClarificationCard";
import { DesignDirectionsCard } from "./DesignDirectionsCard";
import { cn } from "@/lib/utils";

/** Single collapsible group containing consecutive tool calls AND the narration
 *  text that the model emits between them. Keeps chat clean while preserving
 *  the "I need to fix X… <tool runs>" rhythm inside the accordion. */
const ToolGroup = ({ items }: { items: any[] }) => {
  const [open, setOpen] = useState(false);
  const toolParts = items.filter(
    (p) => typeof p?.type === "string" && p.type.startsWith("tool-"),
  );
  const errorCount = toolParts.filter(
    (p) => p.state === "output-error" || (p.output && (p.output.ok === false || p.output.error)),
  ).length;
  const runningCount = toolParts.filter(
    (p) => p.state === "input-streaming" || p.state === "input-available",
  ).length;
  const lastDoneName = (() => {
    for (let i = toolParts.length - 1; i >= 0; i--) {
      if (toolParts[i]?.state === "output-available")
        return String(toolParts[i].type ?? "").replace(/^tool-/, "");
    }
    return null;
  })();
  return (
    <div className="my-2 rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition active:scale-[0.99]"
      >
        <Wrench className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium">
          {toolParts.length} {toolParts.length === 1 ? "action" : "actions"}
        </span>
        {lastDoneName && !runningCount && (
          <span className="text-[10px] text-muted-foreground truncate">· {lastDoneName}</span>
        )}
        {runningCount > 0 && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
            {runningCount} running
          </span>
        )}
        {errorCount > 0 && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive">
            {errorCount} error{errorCount === 1 ? "" : "s"}
          </span>
        )}
        <ChevronDown
          className={cn("ml-auto size-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="border-t border-border/40 p-2 space-y-1.5">
          {items.map((p, i) => {
            if (typeof p?.type === "string" && p.type.startsWith("tool-")) {
              return <AgentToolPart key={i} part={p} />;
            }
            if (p?.type === "text" && typeof p.text === "string" && p.text.trim()) {
              return (
                <div
                  key={i}
                  className="px-2 py-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap"
                >
                  {p.text}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
};

/** Find latest propose_plan tool result across this message's parts (for approval card). */
function findPendingApproval(parts: any[]): { input: any } | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p?.type === "tool-propose_plan" && p.state === "output-available") {
      // If approve_plan ran later in same message, no longer pending
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[j]?.type === "tool-approve_plan") return null;
      }
      return { input: p.input ?? p.output ?? {} };
    }
  }
  return null;
}

/** Find latest ask_clarification tool result. */
function findPendingClarification(parts: any[]): { output: any } | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p?.type === "tool-ask_clarification" && p.state === "output-available") {
      return { output: p.output ?? {} };
    }
  }
  return null;
}

/** Find latest propose_design_directions tool result. */
function findPendingDirections(parts: any[]): { output: any } | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p?.type === "tool-propose_design_directions" && p.state === "output-available") {
      return { output: p.output ?? {} };
    }
  }
  return null;
}

const CONNECT_TOKEN = "[[supabase-connect]]";

type AgentMessageProps = {
  message: any;
  /** True when this message is the one currently streaming. */
  isStreaming?: boolean;
  /** Called when user clicks Retry on an assistant message. */
  onRetry?: () => void;
  /** User-message actions (only meaningful when message.role === "user"). */
  onDeleteUser?: () => void;
  onEditUser?: (newText: string) => void;
  onResendUser?: () => void;
};

export const AgentMessage = ({ message, isStreaming, onRetry, onDeleteUser, onEditUser, onResendUser }: AgentMessageProps) => {
  const isAssistant = message.role === "assistant";
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Concat all text parts for copy / actions.
  const fullText: string = (message.parts ?? [])
    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("\n\n");

  // Reasoning / thinking part(s) — AI SDK exposes these as `reasoning` parts.
  const reasoningText: string = (message.parts ?? [])
    .filter((p: any) => p?.type === "reasoning" && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("\n");

  const startEdit = () => {
    setDraft(fullText);
    setEditing(true);
  };
  const saveEdit = () => {
    const next = draft.trim();
    if (!next || next === fullText.trim()) { setEditing(false); return; }
    onEditUser?.(next);
    setEditing(false);
  };

  return (
    <Message from={message.role}>
      <MessageContent>
        <div className="group">
          {isAssistant && (
            <AgentRunMeter message={message} isStreaming={!!isStreaming} />
          )}
          {reasoningText && (
            <ThinkingAccordion text={reasoningText} streaming={isStreaming} />
          )}
          {isUser && editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(10, Math.max(2, draft.split("\n").length))}
                autoFocus
                className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); }
                  if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
                }}
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="h-7 px-3 rounded-md text-xs text-muted-foreground hover:bg-muted active:scale-[0.98] transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  className="h-7 px-3 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition"
                >
                  Save
                </button>
              </div>
            </div>
          ) : message.parts?.map((part: any, i: number) => {
            const parts = message.parts ?? [];
            const firstToolIdx = parts.findIndex(
              (p: any) => typeof p?.type === "string" && p.type.startsWith("tool-"),
            );
            let lastToolIdx = -1;
            for (let k = parts.length - 1; k >= 0; k--) {
              if (typeof parts[k]?.type === "string" && parts[k].type.startsWith("tool-")) {
                lastToolIdx = k;
                break;
              }
            }
            const inToolBlock = firstToolIdx !== -1 && i >= firstToolIdx && i <= lastToolIdx;

            // Render ONE merged ToolGroup at the position of the first tool part;
            // skip every part inside the block (text + tools).
            if (inToolBlock) {
              if (i !== firstToolIdx) return null;
              const blockItems = parts.slice(firstToolIdx, lastToolIdx + 1);
              return <ToolGroup key="tools" items={blockItems} />;
            }


            if (part.type === "text") {
              const isLastTextPart =
                i === (message.parts?.length ?? 0) - 1 ||
                !message.parts?.slice(i + 1).some((p: any) => p?.type === "text");
              const hasConnectToken = isAssistant && typeof part.text === "string" && part.text.includes(CONNECT_TOKEN);
              const cleanText = hasConnectToken ? part.text.replace(CONNECT_TOKEN, "").trim() : part.text;
              const pending = isAssistant && isLastTextPart && !isStreaming ? findPendingApproval(message.parts ?? []) : null;
              const clarify = isAssistant && isLastTextPart && !isStreaming ? findPendingClarification(message.parts ?? []) : null;
              const directions = isAssistant && isLastTextPart && !isStreaming ? findPendingDirections(message.parts ?? []) : null;
              return isAssistant ? (
                <span key={i} className="inline">
                  {hasConnectToken && <ConnectBackendCallout />}
                  <MessageResponse>{cleanText}</MessageResponse>
                  {isStreaming && isLastTextPart && <StreamingCursor />}
                  {pending && (
                    <PlanApprovalCard
                      appName={pending.input?.app_name}
                      description={pending.input?.description}
                      features={pending.input?.features ?? []}
                      screensCount={(pending.input?.screens ?? []).length}
                      modelsCount={(pending.input?.data_models ?? []).length}
                    />
                  )}
                  {clarify && (
                    <ClarificationCard
                      question={clarify.output?.question ?? ""}
                      options={clarify.output?.options ?? []}
                      allowOther={clarify.output?.allow_other ?? true}
                    />
                  )}
                  {directions && (
                    <DesignDirectionsCard
                      target={directions.output?.target ?? ""}
                      directions={directions.output?.directions ?? []}
                    />
                  )}
                </span>
              ) : (
                <span key={i}>{part.text}</span>
              );
            }
            if (part.type === "file" && typeof part.mediaType === "string" && part.mediaType.startsWith("image/")) {
              return (
                <img
                  key={i}
                  src={part.url}
                  alt={part.filename ?? "attachment"}
                  className="max-h-64 rounded-md border border-border my-2"
                />
              );
            }
            return null;
          })}
          {isUser && !editing && fullText && (
            <UserMessageActions
              text={fullText}
              onEdit={onEditUser ? startEdit : undefined}
              onResend={onResendUser}
              onDelete={onDeleteUser}
            />
          )}
          {isAssistant && !isStreaming && fullText && (
            <div className="flex items-center gap-2 flex-wrap">
              <MessageActions text={fullText} onRetry={onRetry} />
              {(() => {
                const meta = (message?.metadata ?? {}) as Record<string, any>;
                const cost = Number(meta.credit_cost ?? 0);
                const steps = Number(meta.steps ?? 0);
                const tin = Number(meta.tokens_in ?? 0);
                const tout = Number(meta.tokens_out ?? 0);
                const model = typeof meta.model === "string" ? meta.model.split("/").pop() : null;
                const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
                const bits: string[] = [];
                if (steps > 0) bits.push(`${steps} step${steps === 1 ? "" : "s"}`);
                if (tin || tout) bits.push(`${fmt(tin + tout)} tok`);
                if (model) bits.push(model);
                if (bits.length === 0 && cost <= 0) return null;
                return (
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/60"
                    title={`Run summary${model ? ` · ${model}` : ""}`}
                  >
                    {bits.join(" · ")}
                    {cost > 0 && (
                      <span className="text-foreground">· −{cost} credits</span>
                    )}
                  </span>
                );
              })()}
            </div>
          )}
        </div>
      </MessageContent>
    </Message>
  );
};
