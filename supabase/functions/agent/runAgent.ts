// Run the agent: pick model, stream with tools, persist messages, charge credits.
import { createClient } from "npm:@supabase/supabase-js@2";
import { streamText, convertToModelMessages, type UIMessage } from "npm:ai@5.0.26";
import { createAnthropic } from "npm:@ai-sdk/anthropic@2.0.0";
import { createOpenAI } from "npm:@ai-sdk/openai@2.0.0";
import { corsHeaders } from "../_shared/cors.ts";
import { buildDynamicContext } from "../_shared/contextBuilder.ts";
import { autoSaveFromUserMessage, decayOldMemories } from "../_shared/layeredMemory.ts";
import { buildLayeredSystemPrompt } from "../_shared/systemPromptLayers.ts";
import { classifyScope } from "../_shared/scopeClassifier.ts";
import { pickModel, extractLastUserText, clampToBudget, estimateTokens } from "../_shared/modelRouter.ts";
import {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  ANTHROPIC_API_KEY,
  OPENROUTER_API_KEY,
} from "./shared.ts";
import { getOrCreateSandbox, ensureRunning } from "./sandbox.ts";
import { buildTools } from "./tools/index.ts";
import { createPersister, persistUserTurn } from "./persist.ts";
import { getNonContextAssistantIds, prepareMessagesForAgent, recoverInterruptedMessages } from "./resume.ts";
// Template-first scaffold is disabled — see commented block below. These
// imports are kept (unused) so re-enabling is a one-line uncomment.
// deno-lint-ignore no-unused-vars
import { matchTemplate as _matchTemplate } from "../_shared/templateMatcher.ts";
// deno-lint-ignore no-unused-vars
import { applyEcommerceScaffold as _applyEcommerceScaffold, describeStyleForAgent as _describeStyleForAgent } from "../_shared/scaffolds/ecommerce/apply.ts";
import { compressHistory } from "../_shared/historyCompressor.ts";
import { scanForInjection } from "../_shared/safetyGuards.ts";
import { dedupeConsecutiveUserTurns } from "./compact.ts";

const HARMONY_BLOCKED = /(^|\/)(gpt-oss|openai\/gpt-oss)/i;
const MAX_STEPS = 120;
const MAX_CONSECUTIVE_FAILURES = 6;
const MAX_AUTOFIX_ITERATIONS = 3;
const OUTPUT_TOKEN_BUDGET = 8192;

interface AgentBody {
  projectId: string;
  messages: UIMessage[];
  model?: string;
  mode?: string;
  provider?: string;
  liveSignals?: {
    route?: string;
    viewport?: { w: number; h: number };
    consoleErrors?: string[];
    networkFailures?: string[];
    buildErrors?: string[];
  } | null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function normalizeModelMessageFiles(messages: any[]): any[] {
  return messages.map((message) => {
    if (!Array.isArray(message?.content)) return message;

    const content = message.content.map((part: any) => {
      if ((part?.type !== "file" && part?.type !== "image") || typeof part?.data !== "string") {
        return part;
      }
      if (!part.data.startsWith("data:")) return part;

      const commaIdx = part.data.indexOf(",");
      if (commaIdx < 0) return part;

      const header = part.data.slice(5, commaIdx);
      const mediaType = part.mediaType || header.split(";")[0] || "image/png";
      return {
        ...part,
        mediaType,
        data: part.data.slice(commaIdx + 1).replace(/\s+/g, ""),
      };
    });

    return { ...message, content };
  });
}

export async function handleAgentRequest(req: Request): Promise<Response> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "auth required" });

  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
  if (userErr || !userData.user) return json(401, { error: "invalid token" });
  const userId = userData.user.id;

  const body = (await req.json()) as AgentBody;
  const { projectId, messages } = body;
  let modelOverride = body.model || req.headers.get("x-agent-model") || null;
  if (modelOverride && HARMONY_BLOCKED.test(modelOverride)) {
    console.warn(`[agent] blocked harmony-format model override: ${modelOverride}`);
    modelOverride = null;
  }
  if (!projectId || !Array.isArray(messages)) {
    return json(400, { error: "projectId and messages required" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.user_id !== userId) return json(403, { error: "project not owned" });

  const { data: creditRow } = await supabase
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  const balance = creditRow?.balance ?? 0;
  if (balance < 1) {
    return json(402, {
      error: "insufficient_credits",
      message: "You're out of credits. Top up to keep building.",
      balance,
    });
  }

  const sandbox = await getOrCreateSandbox(supabase, projectId, userId);
  const tools = buildTools(sandbox, { supabase, projectId, userId, userToken: token });

  // Layered memory: auto-save trigger phrases from the user's latest message
  // and decay old unused topical rules. Both fire-and-forget — zero token cost.
  const lastUserMsg = [...(messages as any[])].reverse().find((m: any) => m?.role === "user");
  const lastUserPlain = lastUserMsg
    ? (Array.isArray(lastUserMsg.parts)
        ? lastUserMsg.parts.filter((p: any) => p?.type === "text").map((p: any) => p.text).join(" ")
        : (typeof lastUserMsg.content === "string" ? lastUserMsg.content : ""))
    : "";
  if (lastUserPlain) void autoSaveFromUserMessage({ supabase, userId, projectId, text: lastUserPlain });
  void decayOldMemories(supabase, userId);

  // ─── Template-first scaffold — DISABLED ───
  // Previously: matched the user's prompt against templateMatcher and on
  // "ecommerce" + confidence ≥ 0.6 auto-applied the full ecommerce scaffold.
  // That conflicts with the prototype-first flow: the user approves a visual
  // HTML prototype in Design Mode, and then this matcher would overwrite it
  // with the canned ecommerce files (different palette, screens, router).
  // Kept commented for reference in case we want an explicit opt-in later.
  const scaffoldSystemPrompt: string | null = null;
  /*
  try {
    const brandMarker = await sandbox.readFile("/root/app/src/lib/brand.ts").catch(() => "");
    const scaffoldAlreadyApplied = brandMarker.length > 0;
    if (!scaffoldAlreadyApplied) {
      const lastUserText = extractLastUserText(messages as any[]);
      const match = matchTemplate(lastUserText);
      if (match.templateId === "ecommerce" && match.confidence >= 0.6) {
        // … ecommerce scaffold + connect-gate logic (disabled, see note above)
      }
    }
  } catch (e) {
    console.error("[agent] template-first detect failed:", e);
  }
  */


  const anthropicProvider = ANTHROPIC_API_KEY ? createAnthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
  const openrouterProvider = OPENROUTER_API_KEY
    ? createOpenAI({ apiKey: OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" })
    : null;

  const recovery = await recoverInterruptedMessages(supabase, projectId, userId);
  const skipAssistantIds = await getNonContextAssistantIds(supabase, projectId, userId);
  const agentMessages = dedupeConsecutiveUserTurns(
    prepareMessagesForAgent(messages as any[], recovery, skipAssistantIds),
  ) as UIMessage[];
  const dynCtx = await buildDynamicContext({
    sandbox, supabase, projectId, userId, messages: agentMessages,
    isFirstTurn: agentMessages.length <= 1,
    liveSignals: body.liveSignals ?? null,
  });
  // ─── History compressor: fold oldest turns into a 1-msg summary ───
  const compRes = compressHistory(dynCtx.messages as any[]);
  if (compRes.summarized > 0) {
    console.log(`[agent] history-compress: folded ${compRes.summarized} old msg(s) into a summary`);
  }
  // ─── Context window manager: drop oldest msgs if still over budget ───
  const clampRes = clampToBudget(compRes.messages as any[]);
  if (clampRes.dropped > 0) {
    console.log(`[agent] context-clamp: dropped ${clampRes.dropped} oldest msg(s), now ~${estimateTokens(clampRes.messages)} tok`);
  }
  // ─── Prompt-injection guard: scrub assistant/system text from external sources ───
  let injectionFindings = 0;
  const sanitized = (clampRes.messages as any[]).map((m) => {
    if (m?.role !== "user" || !Array.isArray(m.parts)) return m;
    let touched = false;
    const parts = m.parts.map((p: any) => {
      if (p?.type === "text" && typeof p.text === "string" && p.text.length > 600) {
        const r = scanForInjection(p.text);
        if (r.findings.length) {
          touched = true;
          injectionFindings += r.findings.length;
          return { ...p, text: r.clean };
        }
      }
      return p;
    });
    return touched ? { ...m, parts } : m;
  });
  if (injectionFindings > 0) {
    console.warn(`[agent] injection-guard: redacted ${injectionFindings} suspicious instruction-like pattern(s) from user-pasted content`);
  }
  const modelMessages = normalizeModelMessageFiles(convertToModelMessages(sanitized as any));

  // Detect image attachments early — needed by router for vision tier
  const messageHasImageEarly = (m: any) =>
    Array.isArray(m?.parts) && m.parts.some((p: any) =>
      p?.type === "image" || p?.type === "file" || (p?.type === "image_url" && p?.image_url));
  const hasImagesEarly = (agentMessages as any[]).some(messageHasImageEarly);

  const explicitProvider = (req.headers.get("x-provider") || body.provider || "").toLowerCase().trim();
  const looksLikeOpenRouterId = !!modelOverride && modelOverride.includes("/");
  const useProvider: "anthropic" | "openrouter" =
    explicitProvider === "openrouter" ? "openrouter"
    : explicitProvider === "anthropic" ? "anthropic"
    : modelOverride?.startsWith("openrouter/") ? "openrouter"
    : looksLikeOpenRouterId ? "openrouter"
    : anthropicProvider && ANTHROPIC_API_KEY ? "anthropic"
    : openrouterProvider && OPENROUTER_API_KEY ? "openrouter"
    : "anthropic";

  const cleanModelOverride = modelOverride
    ? (useProvider === "openrouter" ? modelOverride.replace(/^openrouter\//, "") : modelOverride)
    : modelOverride;

  if (useProvider === "anthropic" && modelMessages.length > 0) {
    const last: any = modelMessages[modelMessages.length - 1];
    last.providerOptions = {
      ...(last.providerOptions ?? {}),
      anthropic: { cacheControl: { type: "ephemeral" } },
    };
  }

  const route = pickModel({
    lastUserText: extractLastUserText(agentMessages as any[]),
    messageCount: agentMessages.length + (recovery.shouldResume ? 10 : 0),
    override: cleanModelOverride,
    mode: body.mode,
    hasImages: hasImagesEarly,
  });

  const openRouterModelMap: Record<string, string> = {
    "claude-haiku-4-5-20251001": "anthropic/claude-3-5-haiku-20241022",
    "claude-sonnet-4-5-20250929": "anthropic/claude-3-5-sonnet-20241022",
  };
  const effectiveModelId = useProvider === "openrouter"
    ? (cleanModelOverride || openRouterModelMap[route.modelId] || route.modelId)
    : (cleanModelOverride || route.modelId);

  console.log(`[agent] provider=${useProvider} model=${effectiveModelId} tier=${route.tier} reason=${route.reason} fallbacks=[${route.fallbacks.join(",")}]`);

  const providerInstance = useProvider === "openrouter" ? openrouterProvider : anthropicProvider;
  if (!providerInstance) {
    return json(500, {
      error: `Provider ${useProvider} not configured. Add ${useProvider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"} secret.`,
    });
  }

  // OpenRouter's Responses-compatible endpoint is flaky for tool-heavy turns;
  // force Chat Completions for OpenRouter traffic.
  const languageModel = useProvider === "openrouter"
    ? (openrouterProvider as any).chat(effectiveModelId)
    : anthropicProvider!(effectiveModelId);

  const persister = await createPersister({
    supabase, projectId, userId, token, route,
  });
  await persistUserTurn(supabase, projectId, userId, persister.runId, agentMessages as any[]);

  // ─── Build layered system prompt ───
  // Detect intent from the last user message + first-turn signal, then ship
  // CORE always + only the task-relevant layers as separate `system` messages.
  // Anthropic ephemeral cache is applied to CORE only — task layers churn.
  const lastUserTextForLayers = extractLastUserText(agentMessages as any[]);
  const scopeRes = classifyScope(lastUserTextForLayers);
  console.log(`[agent] scope=${scopeRes.scope} conf=${scopeRes.confidence.toFixed(2)} [${scopeRes.reasons.join(",")}]`);
  const hasImages = hasImagesEarly;
  const layered = buildLayeredSystemPrompt({
    lastUserText: lastUserTextForLayers,
    isFirstTurn: agentMessages.length <= 1,
    scaffoldApplied: !!scaffoldSystemPrompt,
    hasImages,
    scope: scopeRes.scope,
  });
  console.log(`[agent] layered prompt: core + ${layered.layers.length} layers [${layered.reasons.join(", ")}]`);

  const systemMsg: any = { role: "system", content: layered.core };
  if (useProvider === "anthropic") {
    systemMsg.providerOptions = { anthropic: { cacheControl: { type: "ephemeral" } } };
  }
  const layerMessages = layered.layers.map((content) => ({ role: "system" as const, content } as any));
  // 1-line scope hint — tiny but steers tool choice for this turn.
  const scopeHintMsg = scopeRes.hint
    ? { role: "system" as const, content: scopeRes.hint } as any
    : null;

  let consecutiveFailures = 0;
  let totalSteps = 0;
  let buildPassed = false;
  let smokePassed = false;
  let codeMutated = false; // Did the model actually write/edit code this turn?
  let lastBuildErrors: any[] = [];
  const rejectedWritePaths = new Set<string>();

  // Inspect tool results from a finished step to update build/smoke gate flags.
  const updateGatesFromStep = (step: any) => {
    const results = (step?.toolResults ?? []) as any[];
    for (const r of results) {
      const name = r?.toolName ?? r?.name;
      const out = r?.output ?? r?.result;
      if (!out || typeof out !== "object") continue;
      if (name === "build_app") {
        buildPassed = !!out.ok;
        lastBuildErrors = Array.isArray(out.errors) ? out.errors : [];
        if (!buildPassed) smokePassed = false; // build broke → smoke invalidated
      } else if (name === "done_gate") {
        buildPassed = !!out.ok;
        smokePassed = !!out.ok;
        lastBuildErrors = Array.isArray(out.blockers) ? out.blockers : [];
      } else if (name === "e2e_smoke_test") {
        smokePassed = !!out.ok;
      } else if (name === "edit_file" || name === "write_file" || name === "multi_edit") {
        if (name === "write_file" && out.ok === false && out.skipped === true && typeof out.path === "string") {
          rejectedWritePaths.add(out.path);
        } else if (out.ok !== false && typeof out.path === "string") {
          rejectedWritePaths.delete(out.path);
        }
        // Any code mutation invalidates prior green gates.
        if (out.ok !== false) {
          buildPassed = false;
          smokePassed = false;
          codeMutated = true;
        }
      }
    }
  };

  let streamErrored = false;
  const result = streamText({
    model: languageModel,
    messages: [
      systemMsg,
      ...layerMessages,
      ...(scopeHintMsg ? [scopeHintMsg] : []),
      ...(recovery.resumeSystemPrompt ? [{ role: "system" as const, content: recovery.resumeSystemPrompt } as any] : []),
      ...(dynCtx.contextSystem ? [{ role: "system" as const, content: dynCtx.contextSystem } as any] : []),
      ...(scaffoldSystemPrompt ? [{ role: "system" as const, content: scaffoldSystemPrompt } as any] : []),
      ...modelMessages,
    ],
    tools,
    maxOutputTokens: OUTPUT_TOKEN_BUDGET,
    prepareStep: async ({ stepNumber, messages }: any) => {
      if (!rejectedWritePaths.size) return undefined;
      return {
        messages: [
          {
            role: "system" as const,
            content:
              `Recovery note before step ${stepNumber}: write_file was rejected for ` +
              `${Array.from(rejectedWritePaths).join(", ")}. Do not retry the same partial content. ` +
              `Read the current file if needed, then use edit_file for small fixes or write_file once with a complete file body.`,
          } as any,
          ...messages,
        ],
      };
    },
    stopWhen: ({ steps }: any) => {
      if (steps.length >= MAX_STEPS) {
        console.warn(`[agent] stop: hit MAX_STEPS=${MAX_STEPS}`);
        return true;
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[agent] stop: ${consecutiveFailures} consecutive tool failures`);
        return true;
      }
      // Note: when the model emits a final assistant text with no tool calls,
      // the AI SDK ends the loop regardless of this return value. The
      // post-stream auto-fix loop below is what actually enforces the
      // build+smoke completion contract.
      return false;
    },
    onStepFinish: async (step: any) => {
      totalSteps++;
      updateGatesFromStep(step);
      const r = persister.recordStep(step);
      consecutiveFailures = r.allFailed ? consecutiveFailures + r.failureCount : 0;
      await persister.save("running", totalSteps);
    },
    onFinish: async ({ response, usage }: any) => {
      persister.setFinalSteps(response.messages as any[]);
      console.log(`[agent] done steps=${totalSteps} usage=`, usage, `buildPassed=${buildPassed} smokePassed=${smokePassed}`);
      await persister.charge(usage, totalSteps);
      if (persister.hasOutput()) {
        await persister.save("complete", totalSteps);
      } else {
        persister.setFallbackText("The previous run was interrupted before I could produce output. I cleaned up the stale run state — please send your instruction again and I’ll continue from the current project files.");
        await persister.save("failed", totalSteps);
      }
    },
    onError: async (err: any) => {
      streamErrored = true;
      console.error("[agent] stream error:", err);
      await persister.save("failed", totalSteps);
    },
  });

  // Manually encode the UI message stream as SSE, bypassing the AI SDK's
  // internal TransformStream. In Deno + ai@5 + npm interop, that transform
  // stream intermittently throws `controller[_transformAlgorithm] is not a
  // function` mid-run, which the client sees as "Error in input stream".
  // We read the raw UIMessageChunk objects and emit `data: {...}\n\n` ourselves.
  const uiStream = (result as any).toUIMessageStream({
    sendReasoning: true,
    sendSources: true,
  }) as ReadableStream<any>;
  const encoder = new TextEncoder();

  let sseReader: ReadableStreamDefaultReader<any> | null = null;
  let sseCancelled = false;

  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = uiStream.getReader();
      sseReader = reader;
      try {
        while (!sseCancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (sseCancelled) break;
          if (value !== undefined) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
            } catch {
              // Controller already closed (client disconnected). Stop reading.
              sseCancelled = true;
              break;
            }
          }
        }

        // ─── Post-stream auto-verify loop (Completion Contract enforcement) ───
        // If the model ended without passing build + smoke gates, run the
        // heal → build_app → e2e_smoke_test cycle ourselves, up to N times.
        // Emit status text-deltas to the client so the user sees progress.
        if (!sseCancelled && !streamErrored && persister.hasOutput() && codeMutated && (!buildPassed || !smokePassed)) {
          const emit = (obj: any) => {
            try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* ignore */ }
          };
          const statusId = `autofix-${Date.now()}`;
          emit({ type: "text-start", id: statusId });
          const log = (line: string) => {
            console.log(`[agent:autofix] ${line}`);
            emit({ type: "text-delta", id: statusId, delta: `\n_${line}_` });
          };

          log(`Completion contract not met (build=${buildPassed}, smoke=${smokePassed}). Running auto-fix loop…`);

          // Detect Daytona "sandbox not running / no IP" errors so we can wake
          // the sandbox once and bail out fast instead of burning 3 iterations
          // (each of which feeds a growing context back into the model).
          const isSandboxDownError = (msg: string): boolean =>
            /resolve container IP|Is the Sandbox started|BAD_REQUEST.*sandbox|Daytona API 4\d\d/i.test(msg);
          let sandboxWakeAttempted = false;
          const tryWakeSandbox = async (): Promise<boolean> => {
            if (sandboxWakeAttempted) return false;
            sandboxWakeAttempted = true;
            try {
              log(`Sandbox appears stopped — attempting wake…`);
              await ensureRunning(sandbox.id);
              log(`Sandbox wake OK, retrying once.`);
              return true;
            } catch (e) {
              log(`Sandbox wake failed: ${String((e as Error)?.message || e)}. Aborting auto-fix.`);
              return false;
            }
          };

          autofix: for (let iter = 1; iter <= MAX_AUTOFIX_ITERATIONS && !sseCancelled; iter++) {
            try {
              log(`Iteration ${iter}/${MAX_AUTOFIX_ITERATIONS}: heal`);
              const healTool: any = (tools as any).heal;
              if (healTool?.execute) {
                await healTool.execute({}, { toolCallId: `autofix-heal-${iter}`, messages: [] } as any);
              }

              log(`Iteration ${iter}: build_app`);
              const buildTool: any = (tools as any).build_app;
              const bRes = buildTool?.execute
                ? await buildTool.execute({}, { toolCallId: `autofix-build-${iter}`, messages: [] } as any)
                : { ok: false };
              buildPassed = !!bRes?.ok;
              if (!buildPassed) {
                const errMsg = String(bRes?.error || bRes?.stderr || "");
                if (isSandboxDownError(errMsg)) {
                  if (await tryWakeSandbox()) continue;
                  break autofix;
                }
                lastBuildErrors = Array.isArray(bRes?.errors) ? bRes.errors : [];
                log(`Build failed (${lastBuildErrors.length} error(s)). Retrying after heal…`);
                continue;
              }

              log(`Iteration ${iter}: e2e_smoke_test`);
              const smokeTool: any = (tools as any).e2e_smoke_test;
              const sRes = smokeTool?.execute
                ? await smokeTool.execute({}, { toolCallId: `autofix-smoke-${iter}`, messages: [] } as any)
                : { ok: false };
              smokePassed = !!sRes?.ok;
              if (smokePassed) {
                log(`✅ Auto-fix succeeded: build + smoke both pass.`);
                break;
              } else {
                const sMsg = String(sRes?.error || sRes?.stderr || "");
                if (isSandboxDownError(sMsg)) {
                  if (await tryWakeSandbox()) continue;
                  break autofix;
                }
                log(`Smoke failed. Retrying…`);
              }
            } catch (e) {
              const msg = String((e as Error)?.message || e);
              if (isSandboxDownError(msg)) {
                if (await tryWakeSandbox()) continue;
                log(`Auto-fix aborted (sandbox unavailable).`);
                break;
              }
              log(`Auto-fix iteration ${iter} threw: ${msg}`);
            }
          }

          if (!buildPassed || !smokePassed) {
            log(`⚠️ Auto-fix exhausted after ${MAX_AUTOFIX_ITERATIONS} iterations (build=${buildPassed}, smoke=${smokePassed}). Manual review needed.`);
          }
          emit({ type: "text-end", id: statusId });
        }

        if (!sseCancelled) {
          try { controller.enqueue(encoder.encode(`data: [DONE]\n\n`)); } catch { /* ignore */ }
        }
      } catch (err) {
        if (!sseCancelled) {
          console.error("[agent] sse encode error:", err);
          const msg = String((err as Error)?.message || err || "stream interrupted");
          const payload = `data: ${JSON.stringify({ type: "error", errorText: msg })}\n\n`;
          try { controller.enqueue(encoder.encode(payload)); } catch { /* ignore */ }
          if (!streamErrored) {
            try { await persister.save("failed", totalSteps); } catch { /* ignore */ }
          }
        }
      } finally {
        try { controller.close(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        sseReader = null;
      }
    },
    async cancel(_reason) {
      // Client disconnected. Mark cancelled and cancel via the locked reader
      // (cancelling uiStream directly throws because it has an active reader).
      sseCancelled = true;
      try { await sseReader?.cancel(_reason); } catch { /* ignore */ }
    },
  });

  return new Response(sseStream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
