import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { createAgentTransport } from "@/lib/agent/transport";

const MAX_AUTO_RESUMES = 0;
const RESUME_DELAY_MS = 1200;

/**
 * Detect whether the last assistant message looks "incomplete":
 * - has no text/tool parts (empty), or
 * - ends mid-tool-call (last part has state 'input-streaming' / 'input-available' without output),
 * - explicitly marked interrupted in metadata.
 */
function isLastTurnIncomplete(messages: any[]): boolean {
  if (!messages?.length) return false;
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return false;
  const meta = last?.metadata ?? {};
  if (meta.status === "interrupted" || meta.status === "running" || meta.status === "failed") return true;
  const parts = Array.isArray(last?.parts) ? last.parts : [];
  if (parts.length === 0) return true;
  const lastPart = parts[parts.length - 1];
  if (lastPart?.type?.startsWith?.("tool-")) {
    const s = lastPart.state;
    if (s === "input-streaming" || s === "input-available") return true;
  }
  // No text output at all → likely interrupted before final reply.
  const hasText = parts.some((p: any) => p?.type === "text" && (p.text ?? "").trim().length > 0);
  if (!hasText) return true;
  return false;
}

export function useAgent(projectId: string, initialMessages: any[] = []) {
  const transport = useMemo(() => createAgentTransport(projectId), [projectId]);
  const resumeCountRef = useRef(0);
  const lastErrorRef = useRef<number>(0);

  const chat = useChat({
    id: projectId,
    transport: transport as any,
    messages: initialMessages as any,
    onError: (err: any) => {
      lastErrorRef.current = Date.now();
      const msg = String(err?.message ?? err ?? "");
      const isCreditError =
        msg.includes("insufficient_credits") ||
        msg.includes("402") ||
        /out of credits/i.test(msg);
      if (isCreditError) {
        toast.error("Out of credits", {
          description: "Top up to keep building.",
          action: { label: "Top up", onClick: () => { window.location.href = "/shop"; } },
        });
        resumeCountRef.current = MAX_AUTO_RESUMES; // disable auto-resume for credit errors
      } else {
        toast.error(msg || "Agent run failed");
      }
    },
  } as any) as any;

  // Reset resume counter on new user turns (whenever message count grows from user input).
  const prevUserCountRef = useRef(0);
  useEffect(() => {
    const userCount = (chat.messages ?? []).filter((m: any) => m.role === "user").length;
    if (userCount > prevUserCountRef.current) {
      resumeCountRef.current = 0;
    }
    prevUserCountRef.current = userCount;
  }, [chat.messages]);

  // Auto-resume is intentionally disabled: regenerate() resends the whole
  // tool-heavy context and duplicates the same user prompt after failures.
  // Users can still retry manually from the failed assistant message.
  useEffect(() => {
    if (chat.status !== "ready" && chat.status !== "error") return;
    if (resumeCountRef.current >= MAX_AUTO_RESUMES) return;
    if (!isLastTurnIncomplete(chat.messages ?? [])) return;

    const t = window.setTimeout(() => {
      // Re-check inside timeout to avoid racing with new user input.
      if (chat.status === "streaming" || chat.status === "submitted") return;
      if (!isLastTurnIncomplete(chat.messages ?? [])) return;
      resumeCountRef.current += 1;
      toast.info(`Resuming interrupted run (${resumeCountRef.current}/${MAX_AUTO_RESUMES})…`);
      try {
        chat.regenerate?.();
      } catch (e) {
        console.warn("[useAgent] auto-resume failed:", e);
      }
    }, RESUME_DELAY_MS);

    return () => window.clearTimeout(t);
  }, [chat.status, chat.messages]);

  return chat;
}
