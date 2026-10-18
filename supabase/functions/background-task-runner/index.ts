// Background Task Runner — picks ONE pending background_tasks row and
// invokes the main `agent` edge function with that prompt on behalf of the
// owning user. Designed to be called by pg_cron every minute.
//
// Why "one at a time": agent runs are heavy (sandbox + LLM). We dispatch one
// per cron tick to throttle naturally; multiple ticks drain the queue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withSentry } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(withSentry("background-task-runner", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // PostgREST does not support order/limit on UPDATE — pick first, then claim by id.
  const { data: candidate, error: pickErr } = await admin
    .from("background_tasks")
    .select("id, user_id, project_id, prompt")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pickErr) {
    return new Response(JSON.stringify({ ok: false, error: pickErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!candidate) {
    return new Response(JSON.stringify({ ok: true, idle: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Atomically claim it: only succeeds if still pending.
  const { data: claimed, error } = await admin
    .from("background_tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select("id, user_id, project_id, prompt")
    .maybeSingle();
  const task = claimed;

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!task) {
    return new Response(JSON.stringify({ ok: true, idle: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fire & forget — agent runs are long. We mark done/error in the background.
  EdgeRuntime.waitUntil((async () => {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE}`,
          "x-background-task": task.id,
          "x-impersonate-user": task.user_id,
        },
        body: JSON.stringify({
          project_id: task.project_id,
          messages: [{ role: "user", content: task.prompt }],
          background: true,
        }),
      });
      const text = await resp.text();
      await admin.from("background_tasks").update({
        status: resp.ok ? "done" : "error",
        finished_at: new Date().toISOString(),
        result: { status: resp.status, preview: text.slice(0, 2000) },
        error_message: resp.ok ? null : text.slice(0, 500),
      }).eq("id", task.id);
    } catch (e) {
      await admin.from("background_tasks").update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: String((e as Error).message ?? e).slice(0, 500),
      }).eq("id", task.id);
    }
  })());

  return new Response(JSON.stringify({ ok: true, dispatched: task.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
