import { DefaultChatTransport } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { installLiveSignals, snapshotLiveSignals } from "./liveSignals";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent`;
const RECENT_KEEP = 6;
const KEEP_VERBATIM_TAIL = 1;
const MAX_PART_CHARS = 320;
const NON_CONTEXT_ASSISTANT_STATUSES = new Set(["running", "interrupted", "failed"]);

// Start collecting console/network signals as soon as transport module loads.
installLiveSignals();

const compactValue = (value: unknown, max = MAX_PART_CHARS): unknown => {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 8).map((v) => compactValue(v, Math.max(80, Math.floor(max / 3))));
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 12)
      .map(([k, v]) => [k, compactValue(v, Math.max(80, Math.floor(max / 3)))]),
  );
};

const compactToolPayload = (payload: unknown): unknown => {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  if (raw.length <= MAX_PART_CHARS) return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return compactValue(payload);
  const source = payload as Record<string, unknown>;
  const keep: Record<string, unknown> = { _truncated: true, _originalChars: raw.length };
  for (const key of ["ok", "status", "success", "error", "errorCount", "exitCode", "path", "count", "iteration", "repeated", "hint", "command", "query", "name"]) {
    if (key in source) keep[key] = compactValue(source[key]);
  }
  if (Array.isArray(source.errors)) keep.errors = compactValue(source.errors.slice(0, 3));
  if (Array.isArray(source.entries)) keep.entries = compactValue(source.entries.slice(0, 20));
  return keep;
};

const compactMessagesForAgent = (messages: any[]) => {
  const contextMessages = messages.filter(
    (message) => !(message?.role === "assistant" && NON_CONTEXT_ASSISTANT_STATUSES.has(message?.metadata?.status)),
  );
  const deduped = contextMessages.filter((message, index, arr) => {
    if (message?.role !== "user" || index === 0) return true;
    const prev = arr[index - 1];
    if (prev?.role !== "user") return true;
    const text = (m: any) => Array.isArray(m?.parts)
      ? m.parts.filter((p: any) => p?.type === "text").map((p: any) => p.text ?? "").join("\n").trim()
      : String(m?.content ?? "").trim();
    return text(message) !== text(prev);
  });
  const recent = deduped.slice(-RECENT_KEEP);
  const cutoff = recent.length - KEEP_VERBATIM_TAIL;
  return recent.map((message, index) => {
    if (index >= cutoff || !Array.isArray(message?.parts)) return message;
    return {
      ...message,
      parts: message.parts.map((part: any) => {
        if (!part?.type?.startsWith?.("tool-")) return part;
        return {
          ...part,
          ...(part.input !== undefined ? { input: compactToolPayload(part.input) } : {}),
          ...(part.output !== undefined ? { output: compactToolPayload(part.output) } : {}),
        };
      }),
    };
  });
};

export function createAgentTransport(projectId: string) {
  return new DefaultChatTransport({
    api: FN_URL,
    prepareSendMessagesRequest: async ({ messages }) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const model =
        typeof window !== "undefined"
          ? (window.localStorage.getItem("lovable_agent_model") || "").trim()
          : "";
      const liveSignals = snapshotLiveSignals();
      return {
        body: {
          projectId,
          messages: compactMessagesForAgent(messages as any[]),
          ...(model ? { model } : {}),
          ...(liveSignals ? { liveSignals } : {}),
        },
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };
    },
  });
}
