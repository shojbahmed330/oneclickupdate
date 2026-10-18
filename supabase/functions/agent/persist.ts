// Persistence + credit deduction for an agent run. Encapsulates the
// per-step accumulator, the assistant-row upsert, and the live tool timeline.
import { createClient } from "npm:@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./shared.ts";
import { compactModelMessagesForStorage, compactUIParts } from "./compact.ts";

interface PersisterArgs {
  supabase: ReturnType<typeof createClient>;
  projectId: string;
  userId: string;
  token: string;
  route: { modelId: string; tier: string; reason: string };
}

interface ToolEvent {
  name: string;
  status: "started" | "ok" | "fail";
  t: number;
  ms?: number;
  summary?: string;
}

function estimateCost(inTok: number, outTok: number, steps: number, model: string): number {
  const m = (model || "").toLowerCase();
  let inRate = 1, outRate = 4;
  if (m.includes("sonnet") || m.includes("opus")) { inRate = 3; outRate = 15; }
  else if (m.includes("haiku") || m.includes("flash")) { inRate = 0.25; outRate = 1.25; }
  else if (m.includes("gpt-5") || m.includes("gemini-2.5-pro") || (m.includes("gemini") && m.includes("pro"))) {
    inRate = 1.25; outRate = 5;
  }
  return Math.max(1, Math.ceil((inTok / 1000) * inRate + (outTok / 1000) * outRate + steps * 0.5));
}

export async function createPersister({ supabase, projectId, userId, token, route }: PersisterArgs) {
  const runId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();

  // Mark prior 'running' rows as interrupted (best-effort).
  try {
    await supabase
      .from("chat_messages")
      .update({ status: "interrupted" })
      .eq("project_id", projectId)
      .eq("status", "running");
  } catch { /* non-fatal */ }

  // Persist the user turn immediately so it survives interruption.
  // We don't get the message list here; the caller should pass it via an
  // additional helper. To preserve original behaviour, we expose `persistUser`.
  const accumulatedSteps: any[] = [];
  let cumIn = 0;
  let cumOut = 0;
  let creditCost = 0;
  const toolTimeline: ToolEvent[] = [];
  const toolStartedAt = new Map<string, number>();

  const recordStep = (step: any) => {
    const sUsage = step?.usage ?? {};
    cumIn += Number(sUsage?.inputTokens ?? sUsage?.promptTokens ?? 0) || 0;
    cumOut += Number(sUsage?.outputTokens ?? sUsage?.completionTokens ?? 0) || 0;

    const msgs = (step?.response?.messages ?? []) as any[];
    const toolCalls: any[] = [];
    const toolResults: any[] = [];
    for (const m of msgs) {
      const content = Array.isArray(m?.content) ? m.content : [];
      for (const c of content) {
        if (c?.type === "tool-call") toolCalls.push(c);
        else if (c?.type === "tool-result") toolResults.push(c);
      }
    }

    const now = Date.now();
    for (const tc of toolCalls) {
      const id = tc.toolCallId ?? tc.id ?? `${tc.toolName}-${now}`;
      if (!toolStartedAt.has(id)) {
        toolStartedAt.set(id, now);
        toolTimeline.push({ name: tc.toolName ?? "tool", status: "started", t: now });
      }
    }
    for (const tr of toolResults) {
      const id = tr.toolCallId ?? tr.id;
      const startedAt = id ? toolStartedAt.get(id) : undefined;
      const ms = startedAt ? now - startedAt : undefined;
      const out = tr?.output ?? tr?.result;
      const ok = !(out && typeof out === "object" && "ok" in out && out.ok === false);
      let summary: string | undefined;
      if (out && typeof out === "object") {
        if ("error" in out && out.error) summary = String(out.error).slice(0, 120);
        else if ("hint" in out && out.hint) summary = String(out.hint).slice(0, 120);
        else if (Array.isArray(out.errors) && out.errors.length) summary = `${out.errors.length} error(s)`;
      }
      toolTimeline.push({ name: tr.toolName ?? "tool", status: ok ? "ok" : "fail", t: now, ms, summary });
    }

    let allFailed = false;
    let failureCount = 0;
    if (toolResults.length > 0) {
      allFailed = toolResults.every((t) => {
        const out = t?.output ?? t?.result;
        if (!out) return false;
        if (typeof out === "object" && "ok" in out) return out.ok === false;
        return false;
      });
      if (allFailed) failureCount = toolResults.length;
    }

    accumulatedSteps.length = 0;
    accumulatedSteps.push(...msgs);
    return { allFailed, failureCount };
  };

  const setFinalSteps = (msgs: any[]) => {
    accumulatedSteps.length = 0;
    accumulatedSteps.push(...msgs);
  };

  const hasOutput = () => accumulatedSteps.some((s: any) => {
    const content = Array.isArray(s?.content) ? s.content : [];
    return content.some((c: any) =>
      (c?.type === "text" && String(c.text ?? "").trim().length > 0) ||
      c?.type === "tool-call" ||
      c?.type === "tool-result"
    );
  });

  const setFallbackText = (text: string) => {
    accumulatedSteps.length = 0;
    accumulatedSteps.push({ role: "assistant", content: [{ type: "text", text }] });
  };

  const isExternallyFailed = async () => {
    const { data } = await supabase
      .from("chat_messages")
      .select("status")
      .eq("id", assistantMessageId)
      .maybeSingle();
    return data?.status === "failed";
  };

  const charge = async (usage: any, totalSteps: number) => {
    try {
      const inTok = Number(usage?.inputTokens ?? usage?.promptTokens ?? 0);
      const outTok = Number(usage?.outputTokens ?? usage?.completionTokens ?? 0);
      const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await userClient.rpc("consume_run_credits", {
        _input_tokens: inTok,
        _output_tokens: outTok,
        _tool_iterations: totalSteps,
        _model: route.modelId,
        _reason: `agent run · ${route.tier}`,
      });
      if (error) console.error("[agent] consume_run_credits failed:", error);
      else if (data && typeof data === "object") {
        creditCost = Number((data as any).cost ?? 0);
        console.log(`[agent] charged ${creditCost} credits (in=${inTok} out=${outTok} steps=${totalSteps})`);
      }
    } catch (e) {
      console.error("[agent] credit deduction error:", e);
    }
  };

  const save = async (status: "running" | "complete" | "failed", totalSteps: number) => {
    try {
      if (status !== "failed" && await isExternallyFailed()) return;
      const storageSteps = compactModelMessagesForStorage(accumulatedSteps);
      const textOut = accumulatedSteps
        .flatMap((s: any) => Array.isArray(s.content) ? s.content : [])
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join("");
      const liveEstimated = estimateCost(cumIn, cumOut, totalSteps, route.modelId);
      await supabase.from("chat_messages").upsert({
        id: assistantMessageId,
        project_id: projectId,
        user_id: userId,
        role: "assistant",
        content: textOut,
        parts: storageSteps,
        run_id: runId,
        status,
        metadata: {
          model: route.modelId,
          tier: route.tier,
          reason: route.reason,
          tokens_in: cumIn,
          tokens_out: cumOut,
          steps: totalSteps,
          estimated_credits: liveEstimated,
          tool_timeline: toolTimeline.slice(-25),
          ...(creditCost > 0 ? { credit_cost: creditCost } : {}),
        },
      }, { onConflict: "id" });
    } catch (err) {
      console.error("[agent] persist assistant failed:", err);
    }
  };

  return { runId, recordStep, setFinalSteps, hasOutput, setFallbackText, isExternallyFailed, charge, save };
}

// Persist the user's last message immediately at request start.
// (Original behavior preserved — runs once before streaming begins.)
export async function persistUserTurn(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  runId: string,
  messages: any[],
) {
  try {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const parts = compactUIParts(lastUser.parts ?? []);
    const textContent = typeof lastUser.content === "string"
      ? lastUser.content
      : (Array.isArray(parts)
          ? parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("")
          : "");
    const recentDuplicateWindow = new Date(Date.now() - 20_000).toISOString();
    const { data: duplicate } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .eq("role", "user")
      .eq("content", textContent)
      .gte("created_at", recentDuplicateWindow)
      .maybeSingle();
    if (duplicate?.id) return;

    await supabase.from("chat_messages").insert({
      project_id: projectId,
      user_id: userId,
      role: "user",
      content: textContent,
      parts,
      run_id: runId,
      status: "complete",
    });
  } catch (err) {
    console.error("[agent] persist user failed:", err);
  }
}
