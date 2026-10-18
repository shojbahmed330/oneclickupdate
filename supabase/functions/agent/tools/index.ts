// Composes all tool factories into a single tool map for streamText.
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import { buildBrowserTools } from "../../_shared/browserTools.ts";
import type { ToolCtx } from "../shared.ts";

import { makeCoreTools } from "./core.ts";
import { makeEditTools } from "./edit.ts";
import { makeSearchTools } from "./search.ts";
import { makeWebTools } from "./web.ts";
import { makeMultiEditTools } from "./multi-edit.ts";
import { makeBuildTools } from "./build.ts";
import { makeOpsTools } from "./ops.ts";
import { makeSupabaseDdlTools } from "./supabase-ddl.ts";
import { makeSupabaseAuthTools } from "./supabase-auth.ts";
import { makeMemoryTools } from "./memory.ts";
import { makePlanTools } from "./plan.ts";
import { makeHealTools } from "./heal.ts";
import { makeGithubTools } from "./github.ts";
import { makeScaffoldAuthTools } from "./scaffold-auth.ts";
import { makeScaffoldEdgeTools } from "./scaffold-edge.ts";
import { makeSmokeTools } from "./smoke.ts";
import { makeDecisionTools } from "./decision.ts";
import { makeSpecializedTools } from "./specialized.ts";
import { makeVersioningTools } from "./versioning.ts";
import { makeReliabilityTools } from "./reliability.ts";
import { makeAgenticTools } from "./agentic.ts";
import { makeDesignTools } from "./design.ts";
import { makeSecretRequestTools } from "./secrets.ts";
import { makeConnectorTools } from "./connectors.ts";
// scaffold_realtime_call removed — native WebRTC was never integration-tested
// (no TURN fallback, mobile-Safari quirks unhandled). Use a connector instead.
import { makeAdminScaffoldTools } from "./scaffold-admin.ts";
import { makeScaffoldSearchTools } from "./scaffold-search.ts";
import { makeScaffoldNotificationsTools } from "./scaffold-notifications.ts";
import { makeScaffoldAnalyticsTools } from "./scaffold-analytics.ts";
import { makeTestCoverageTools } from "./test-coverage.ts";
import { applyDeferral } from "./deferral.ts";

/**
 * Build the per-turn tool map. By default the full catalog is wrapped with
 * tool deferral — only eager tools (read/write/edit/heal/build/list_dir/think)
 * + `tool_search` + `tool_invoke` are exposed to the model. Pass
 * `{ defer: false }` to send the full catalog (legacy behavior).
 */
export function buildTools(
  sandbox: DaytonaSandbox,
  ctx: ToolCtx,
  cwd = "/root/app",
  opts: { defer?: boolean } = {},
) {
  const all = {
    ...makeCoreTools(sandbox, ctx, cwd),
    ...makeEditTools(sandbox, ctx, cwd),
    ...makeSearchTools(sandbox, ctx, cwd),
    ...makeWebTools(sandbox, ctx, cwd),
    ...makeMultiEditTools(sandbox, ctx, cwd),
    ...makeBuildTools(sandbox, ctx, cwd),
    ...makeOpsTools(sandbox, ctx, cwd),
    ...makeSupabaseDdlTools(sandbox, ctx, cwd),
    ...makeSupabaseAuthTools(sandbox, ctx, cwd),
    ...makeMemoryTools(sandbox, ctx, cwd),
    ...makePlanTools(sandbox, ctx, cwd),
    ...makeHealTools(sandbox, ctx, cwd),
    ...makeGithubTools(sandbox, ctx, cwd),
    ...makeScaffoldAuthTools(sandbox, ctx, cwd),
    ...makeScaffoldEdgeTools(sandbox, ctx, cwd),
    ...makeSmokeTools(sandbox, ctx, cwd),
    ...makeDecisionTools(sandbox, ctx, cwd),
    ...makeSpecializedTools(sandbox, ctx, cwd),
    ...makeVersioningTools(sandbox, ctx, cwd),
    ...makeReliabilityTools(sandbox, ctx, cwd),
    ...makeAgenticTools(sandbox, ctx, cwd),
    ...makeDesignTools(sandbox, ctx, cwd),
    ...makeSecretRequestTools(sandbox, ctx, cwd),
    ...makeConnectorTools(sandbox, ctx, cwd),
    // ...makeRealtimeCallTools removed (see import comment above)
    ...makeAdminScaffoldTools(sandbox, ctx, cwd),
    ...makeScaffoldSearchTools(sandbox, ctx, cwd),
    ...makeScaffoldNotificationsTools(sandbox, ctx, cwd),
    ...makeScaffoldAnalyticsTools(sandbox, ctx, cwd),
    ...makeTestCoverageTools(sandbox, ctx, cwd),
    ...buildBrowserTools(sandbox, cwd, ctx.projectId),
  };
  if (opts.defer === false) return all;
  return applyDeferral(all);
}
