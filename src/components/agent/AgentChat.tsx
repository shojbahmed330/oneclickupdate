import { useCallback } from "react";
import { useAgent } from "@/hooks/useAgent";
import { useCrossDeviceSyncConflict } from "@/hooks/useCrossDeviceSync";
import { useChatMessageActions } from "@/hooks/useChatMessageActions";
import { AgentTranscript } from "./AgentTranscript";
import { AgentComposer, type AttachedImage } from "./AgentComposer";
import { SqlConfirmationGate } from "./SqlConfirmationGate";
import { ResumeBanner } from "./ResumeBanner";
import { CrossDeviceConflictBanner } from "./CrossDeviceConflictBanner";

function lastTurnIncomplete(messages: any[]): boolean {
  if (!messages?.length) return false;
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return false;
  const parts = Array.isArray(last?.parts) ? last.parts : [];
  if (parts.length === 0) return true;
  const lastPart = parts[parts.length - 1];
  if (lastPart?.type?.startsWith?.("tool-")) {
    const s = lastPart.state;
    if (s === "input-streaming" || s === "input-available") return true;
  }
  const hasText = parts.some((p: any) => p?.type === "text" && (p.text ?? "").trim().length > 0);
  return !hasText;
}

export const AgentChat = ({ projectId }: { projectId: string }) => {
  const chat = useAgent(projectId) as any;
  const { messages, sendMessage, status, stop, regenerate, refetch } = chat;

  const isDirty = status === "submitted" || status === "streaming";
  const conflict = useCrossDeviceSyncConflict(
    projectId,
    isDirty,
    useCallback(() => { refetch?.(); }, [refetch]),
  );

  const { onDeleteUser, onEditUser, onResendUser } = useChatMessageActions(projectId, chat);

  const handleSend = (text: string, images: AttachedImage[]) => {
    const parts: any[] = [];
    if (text) parts.push({ type: "text", text });
    for (const img of images) {
      const base64 = (img.url.split(",")[1] ?? "").replace(/\s+/g, "");
      parts.push({ type: "file", mediaType: img.mediaType, data: base64, filename: img.filename } as any);
    }
    sendMessage({ parts } as any);
  };

  const showResume =
    (status === "ready" || status === "error") && lastTurnIncomplete(messages);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-hidden">
        <AgentTranscript
          messages={messages}
          status={status}
          onRetry={regenerate}
          onDeleteUser={onDeleteUser}
          onEditUser={onEditUser}
          onResendUser={onResendUser}
        />
      </div>
      <SqlConfirmationGate messages={messages} projectId={projectId} />
      <CrossDeviceConflictBanner
        visible={conflict.hasRemoteChange}
        kind={conflict.pendingKind}
        onReload={conflict.resolve}
        onDismiss={conflict.dismiss}
      />
      <ResumeBanner visible={showResume} status={status} onContinue={() => regenerate?.()} />
      <div className="border-t border-border p-3 shrink-0">
        <AgentComposer status={status} onSend={handleSend} onStop={stop} />
      </div>
    </div>
  );
};
