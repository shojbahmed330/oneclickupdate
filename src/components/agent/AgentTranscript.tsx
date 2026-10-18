import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AgentMessage } from "./AgentMessage";
// PlanProgress + V2PlanCard removed — prototype-first flow, no plan card.
import { EmptyTranscript } from "./EmptyTranscript";

interface Props {
  messages: any[];
  status: "submitted" | "streaming" | "ready" | "error";
  onRetry?: () => void;
  onDeleteUser?: (msg: any) => void;
  onEditUser?: (msg: any, newText: string) => void;
  onResendUser?: (msg: any) => void;
}

export const AgentTranscript = ({ messages, status, onRetry, onDeleteUser, onEditUser, onResendUser }: Props) => {
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <Conversation className="min-h-0 h-full">
      <ConversationContent className="min-h-full pb-6">
        {/* PlanProgress removed — prototype-first build, no plan-approval card */}
        {messages.length === 0 && status === "ready" && <EmptyTranscript />}
        {messages.map((m) => (
          <AgentMessage
            key={m.id}
            message={m}
            isStreaming={status === "streaming" && m.id === lastAssistantId}
            onRetry={m.role === "assistant" && m.id === lastAssistantId ? onRetry : undefined}
            onDeleteUser={m.role === "user" ? () => onDeleteUser?.(m) : undefined}
            onEditUser={m.role === "user" && onEditUser ? (text) => onEditUser(m, text) : undefined}
            onResendUser={m.role === "user" ? () => onResendUser?.(m) : undefined}
          />
        ))}
        {status === "submitted" && <Shimmer>Thinking...</Shimmer>}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
};
