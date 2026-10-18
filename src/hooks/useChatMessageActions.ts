// Shared user-message actions: delete (DB + local), edit (DB + local), resend.
// Used by both AgentChat and BuilderV2 ProjectShell so the buttons work
// identically wherever the transcript is rendered.
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const messageText = (m: any): string =>
  Array.isArray(m?.parts)
    ? m.parts.filter((p: any) => p?.type === "text").map((p: any) => p.text ?? "").join("\n")
    : String(m?.content ?? "");

interface ChatLike {
  setMessages?: (updater: any) => void;
  sendMessage?: (msg: any) => void;
}

export function useChatMessageActions(projectId: string, chat: ChatLike) {
  const findDbId = useCallback(async (msg: any): Promise<string | null> => {
    if (msg?.id && UUID_RE.test(msg.id)) {
      const { data } = await supabase
        .from("chat_messages")
        .select("id")
        .eq("id", msg.id)
        .maybeSingle();
      if (data?.id) return data.id;
    }
    const text = messageText(msg).trim();
    if (!text) return null;
    const { data } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("project_id", projectId)
      .eq("role", "user")
      .eq("content", text)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  }, [projectId]);

  const onDeleteUser = useCallback(async (msg: any) => {
    try {
      const dbId = await findDbId(msg);
      if (dbId) {
        const { error } = await supabase.from("chat_messages").delete().eq("id", dbId);
        if (error) throw error;
      }
      if (chat.setMessages) {
        chat.setMessages((prev: any[]) => prev.filter((m) => m.id !== msg.id));
      } else {
        toast.error("Cannot remove from current view — please refresh");
      }
      toast.success("Message deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete message");
    }
  }, [findDbId, chat]);

  const onEditUser = useCallback(async (msg: any, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    try {
      const dbId = await findDbId(msg);
      if (dbId) {
        const newParts = [
          { type: "text", text: trimmed },
          ...((msg.parts ?? []).filter((p: any) => p?.type !== "text")),
        ];
        const { error } = await supabase
          .from("chat_messages")
          .update({ content: trimmed, parts: newParts })
          .eq("id", dbId);
        if (error) throw error;
      }
      chat.setMessages?.((prev: any[]) =>
        prev.map((m) => {
          if (m.id !== msg.id) return m;
          const otherParts = (m.parts ?? []).filter((p: any) => p?.type !== "text");
          return { ...m, parts: [{ type: "text", text: trimmed }, ...otherParts] };
        }),
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not edit message");
    }
  }, [findDbId, chat]);

  const onResendUser = useCallback((msg: any) => {
    const parts = (msg.parts ?? []).filter(
      (p: any) => p?.type === "text" || p?.type === "file",
    );
    if (parts.length === 0) {
      const text = messageText(msg);
      if (!text.trim()) return;
      chat.sendMessage?.({ parts: [{ type: "text", text }] } as any);
      return;
    }
    chat.sendMessage?.({ parts } as any);
  }, [chat]);

  return { onDeleteUser, onEditUser, onResendUser };
}
