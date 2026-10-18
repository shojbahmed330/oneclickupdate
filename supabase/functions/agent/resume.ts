const INTERRUPTED_STATUSES = ["running", "interrupted"];
const NON_CONTEXT_STATUSES = ["running", "interrupted", "failed"];
const NOTICE_RE = /Run interrupted|Previous run stopped|send another message to resume/i;

export interface ResumeRecovery {
  interruptedIds: Set<string>;
  shouldResume: boolean;
  resumeSystemPrompt: string | null;
}

export async function recoverInterruptedMessages(
  supabase: any,
  projectId: string,
  userId: string,
): Promise<ResumeRecovery> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, status, created_at, run_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("role", "assistant")
    .in("status", INTERRUPTED_STATUSES)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.warn("[agent] interrupted-run lookup failed:", error);
    return { interruptedIds: new Set(), shouldResume: false, resumeSystemPrompt: null };
  }

  const rows = Array.isArray(data) ? data : [];
  const ids = rows.map((row: any) => row.id).filter(Boolean);
  if (ids.length > 0) {
    const { error: updateError } = await supabase
      .from("chat_messages")
      .update({ status: "failed" })
      .in("id", ids);
    if (updateError) console.warn("[agent] interrupted-run cleanup failed:", updateError);
  }

  return {
    interruptedIds: new Set(ids),
    shouldResume: ids.length > 0,
    resumeSystemPrompt: ids.length > 0 ? RESUME_SYSTEM_PROMPT : null,
  };
}

export async function getNonContextAssistantIds(
  supabase: any,
  projectId: string,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("role", "assistant")
    .in("status", NON_CONTEXT_STATUSES)
    .limit(50);

  if (error) {
    console.warn("[agent] non-context assistant lookup failed:", error);
    return new Set();
  }

  return new Set((data ?? []).map((row: any) => row.id).filter(Boolean));
}

export function prepareMessagesForAgent(
  messages: any[],
  recovery: ResumeRecovery,
  skipAssistantIds: Set<string> = new Set(),
): any[] {
  return messages
    .filter((message) => !recovery.interruptedIds.has(message?.id))
    .filter((message) => !skipAssistantIds.has(message?.id))
    .map((message) => stripNoticeParts(message))
    .filter(Boolean);
}

function stripNoticeParts(message: any): any | null {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  if (parts.length === 0) return message;

  const cleanParts = parts.filter((part: any) => {
    if (part?.type !== "text" || typeof part.text !== "string") return true;
    return !NOTICE_RE.test(part.text);
  });

  if (message?.role === "assistant" && cleanParts.length === 0) return null;
  return cleanParts.length === parts.length ? message : { ...message, parts: cleanParts };
}

const RESUME_SYSTEM_PROMPT = `## Interrupted run recovery
The previous assistant run for this project was interrupted before it completed. Its partial assistant message has been marked failed and removed from the model context.

Continue from the current sandbox/project files, not from the partial interrupted assistant text. Treat the latest user message as permission to resume the unfinished build unless it clearly asks for something else. First inspect the relevant current files or project state, then continue the work. Do not ask the user to repeat the original request just because the previous stream was interrupted.`;