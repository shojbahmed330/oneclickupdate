// Tool deferral: keep only eager (always-needed) tools in the model's
// per-turn tool catalog. Expose everything else through two meta-tools
// `tool_search` (keyword discovery) and `tool_invoke` (run by name).
// This trims ~3k tokens/turn off the system tool schema overhead.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";

// Always loaded — every turn needs these. Be generous: an "unavailable
// tool" error from the AI SDK is much more expensive (failed turn + retry)
// than the ~50 tokens of an extra tool schema. Only truly rare tools stay
// deferred (github push, scaffold-edge, supabase ddl, screenshots, etc.).
const EAGER = new Set<string>([
  // file ops
  "list_dir",
  "read_file",
  "write_file",
  "edit_file",
  "multi_edit",
  "delete_file",
  // shell + deps (used in nearly every turn)
  "run_command",
  "install_dep",
  "uninstall_dep",
  "npm_script",
  "read_package_json",
  // build + heal loop
  "heal",
  "build_app",
  "typecheck",
  "e2e_smoke_test",
  "done_gate",
  "read_console_logs",
  "rls_validate",
  "secret_scan_repo",
  // dev server
  "start_dev_server",
  "restart_dev_server",
  "get_preview_url",
  // misc
  "think",
  "glob_files",
  "search_code",
  "read_dev_log",
  // planning (called every new-app turn — keep eager to avoid 'unavailable tool' errors)
  "get_plan",
  "propose_plan",
  "approve_plan",
  "verify_routes",
  // decision layer — must be eager so model can call them on first impulse
  "ask_clarification",
  "propose_design_directions",
  // github (invoked from builder header buttons via direct prompt — must be eager)
  "github_status",
  "github_init_repo",
  "github_push",
]);

// Convert a zod schema to a tiny JSON-schema-ish description so the model
// knows what to put in tool_invoke.args. Top-level only; good enough for
// our flat tool inputs.
function zodToBrief(schema: any): unknown {
  if (!schema || typeof schema !== "object") return { type: "unknown" };
  const def = schema._def;
  if (!def) return { type: "unknown" };
  const t = def.typeName;
  switch (t) {
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const props: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape ?? {})) {
        const child = v as any;
        props[k] = zodToBrief(child);
        const inner = child?._def?.typeName;
        if (inner !== "ZodOptional" && inner !== "ZodDefault") required.push(k);
      }
      return { type: "object", properties: props, required };
    }
    case "ZodString":   return { type: "string" };
    case "ZodNumber":   return { type: "number" };
    case "ZodBoolean":  return { type: "boolean" };
    case "ZodArray":    return { type: "array", items: zodToBrief(def.type) };
    case "ZodEnum":     return { type: "string", enum: def.values };
    case "ZodOptional": return zodToBrief(def.innerType);
    case "ZodDefault":  return { ...(zodToBrief(def.innerType) as any), default: def.defaultValue?.() };
    case "ZodUnion":    return { anyOf: (def.options ?? []).map(zodToBrief) };
    case "ZodLiteral":  return { const: def.value };
    case "ZodRecord":   return { type: "object" };
    case "ZodAny":      return {};
    default:            return { type: "unknown", _kind: t };
  }
}

function score(query: string, name: string, desc: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const n = name.toLowerCase();
  const d = desc.toLowerCase();
  let s = 0;
  // Exact name match wins.
  if (n === q) s += 100;
  if (n.includes(q)) s += 30;
  // Token overlap.
  for (const tok of q.split(/[\s,_-]+/).filter(Boolean)) {
    if (n.includes(tok)) s += 10;
    if (d.includes(tok)) s += 3;
  }
  return s;
}

/**
 * Wrap a full tool map. Returns:
 *   { ...eagerTools, tool_search, tool_invoke }
 * Deferred tools are hidden from the per-turn schema but still callable
 * via tool_invoke({ name, args }).
 */
export function applyDeferral(allTools: Record<string, any>) {
  const eager: Record<string, any> = {};
  const deferred: Record<string, any> = {};
  for (const [name, t] of Object.entries(allTools)) {
    if (EAGER.has(name)) eager[name] = t;
    else deferred[name] = t;
  }

  const indexed = Object.entries(deferred).map(([name, t]) => ({
    name,
    description: String(t?.description ?? "").slice(0, 240),
  }));

  const tool_search = tool({
    description:
      "Find deferred tools by keyword. Returns up to `limit` matches with " +
      "name, description, and input schema. Use this to discover the right " +
      "tool, then call it with `tool_invoke`. Eager tools (read_file, " +
      "write_file, edit_file, multi_edit, heal, build_app, done_gate, list_dir, think) " +
      "are always available — don't search for them.",
    inputSchema: z.object({
      query: z.string().describe("Keywords like 'github push', 'supabase ddl', 'screenshot', 'install dep'."),
      limit: z.number().int().min(1).max(15).default(6),
    }),
    execute: async ({ query, limit }: { query: string; limit: number }) => {
      const ranked = indexed
        .map((t) => ({ ...t, _s: score(query, t.name, t.description) }))
        .filter((t) => t._s > 0)
        .sort((a, b) => b._s - a._s)
        .slice(0, limit);
      const matches = ranked.map(({ name }) => {
        const def = deferred[name];
        return {
          name,
          description: String(def?.description ?? ""),
          inputSchema: zodToBrief(def?.inputSchema),
        };
      });
      return {
        query,
        count: matches.length,
        matches,
        hint: matches.length === 0 ? "No matches. Try different keywords." : "Call tool_invoke({ name, args }) to run one.",
      };
    },
  });

  const tool_invoke = tool({
    description:
      "Run a deferred tool by name. First discover the tool with tool_search " +
      "to learn its input schema, then call this with the matching args.",
    inputSchema: z.object({
      name: z.string().describe("Exact tool name returned by tool_search."),
      args: z.any().optional().describe("Argument object matching the tool's inputSchema."),
    }),
    execute: async ({ name, args }: { name: string; args?: unknown }, options: any) => {
      const target = deferred[name];
      if (!target) {
        // Maybe the model tried to invoke an eager tool through here.
        if (EAGER.has(name)) {
          return { error: `'${name}' is an eager tool — call it directly, not via tool_invoke.` };
        }
        const suggestions = indexed
          .map((t) => ({ name: t.name, _s: score(name, t.name, t.description) }))
          .filter((t) => t._s > 0)
          .sort((a, b) => b._s - a._s)
          .slice(0, 5)
          .map((t) => t.name);
        return { error: `Unknown tool '${name}'.`, suggestions };
      }
      // Validate args against the tool's zod schema for clearer errors.
      let parsed: unknown = args ?? {};
      if (typeof parsed === "string") {
        try {
          parsed = parsed.trim() ? JSON.parse(parsed) : {};
        } catch {
          return {
            error: `Invalid args for '${name}': args was a string but not valid JSON`,
            expected: zodToBrief(target.inputSchema),
          };
        }
      }
      const schema = target.inputSchema;
      if (schema && typeof schema.safeParse === "function") {
        const r = schema.safeParse(parsed);
        if (!r.success) {
          return {
            error: `Invalid args for '${name}'`,
            issues: r.error.issues,
            expected: zodToBrief(schema),
          };
        }
        parsed = r.data;
      }
      try {
        return await target.execute(parsed, options);
      } catch (e) {
        return { error: `Tool '${name}' threw: ${(e as Error).message ?? String(e)}` };
      }
    },
  });

  return { ...eager, tool_search, tool_invoke };
}
