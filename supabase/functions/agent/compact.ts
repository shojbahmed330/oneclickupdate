const MAX_STRING_CHARS = 600;
const MAX_JSON_CHARS = 1_400;
const MAX_ARRAY_ITEMS = 8;

const KEEP_INPUT_KEYS = [
  "path", "file", "target_file", "from", "to", "command", "query", "name",
  "pattern", "packages", "timeout_sec", "routes", "app_name",
];

const KEEP_OUTPUT_KEYS = [
  "ok", "status", "success", "error", "errorCount", "exitCode", "path",
  "count", "iteration", "repeated", "hint", "kind", "additions", "deletions",
  "replacements", "edits", "hiddenCount", "relatedTotal", "unrelatedTotal",
];

export function compactString(value: string, max = MAX_STRING_CHARS): string {
  return value.length > max ? `${value.slice(0, max)}… [truncated ${value.length - max} chars]` : value;
}

export function compactValue(value: unknown, max = MAX_STRING_CHARS): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return compactString(value, max);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => compactValue(item, Math.max(80, Math.floor(max / 3))));
  }
  if (typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>).slice(0, 16);
  return Object.fromEntries(entries.map(([key, item]) => [key, compactValue(item, Math.max(80, Math.floor(max / 3)))]));
}

function jsonLength(value: unknown): number {
  try { return JSON.stringify(value ?? null).length; } catch { return String(value).length; }
}

function compactToolPayload(payload: unknown, keys: string[], previewKeys: string[]): unknown {
  const rawLen = jsonLength(payload);
  if (rawLen <= MAX_JSON_CHARS) return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { value_preview: compactValue(payload), _truncated: true, _originalChars: rawLen };
  }

  const source = payload as Record<string, unknown>;
  const out: Record<string, unknown> = { _truncated: true, _originalChars: rawLen };
  for (const key of keys) if (key in source) out[key] = compactValue(source[key]);
  for (const key of previewKeys) {
    if (typeof source[key] === "string") {
      const preview = compactString(source[key] as string, 420);
      if (key === "before" || key === "after") out[key] = preview;
      else out[`${key}_preview`] = preview;
    }
  }
  if (Array.isArray(source.errors)) out.errors = compactValue(source.errors.slice(0, 4));
  if (Array.isArray(source.entries)) out.entries = compactValue(source.entries.slice(0, 20));
  if (Array.isArray(source.issues)) out.issues = compactValue(source.issues.slice(0, 6));
  if (Array.isArray(source.edits)) out.edits = source.edits.length;
  return out;
}

export function compactToolInput(input: unknown): unknown {
  return compactToolPayload(input, KEEP_INPUT_KEYS, ["content", "old_string", "new_string", "search", "replace", "spec_content"]);
}

export function compactToolOutput(output: unknown): unknown {
  return compactToolPayload(output, KEEP_OUTPUT_KEYS, ["before", "after", "content", "output", "stdout", "stderr", "output_tail", "test_output"]);
}

export function compactUIPart(part: any): any {
  if (!part || typeof part !== "object") return part;
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return {
      ...part,
      ...(part.input !== undefined ? { input: compactToolInput(part.input) } : {}),
      ...(part.output !== undefined ? { output: compactToolOutput(part.output) } : {}),
    };
  }
  if (part.type === "text" && typeof part.text === "string") return part;
  return compactValue(part, 700);
}

export function compactUIParts(parts: unknown): unknown {
  return Array.isArray(parts) ? parts.map(compactUIPart) : parts;
}

function compactContentBlock(block: any): any {
  if (!block || typeof block !== "object") return block;
  if (block.type === "tool-call") {
    return { ...block, input: compactToolInput(block.input ?? block.args), args: undefined };
  }
  if (block.type === "tool-result") {
    return { ...block, output: compactToolOutput(block.output ?? block.result), result: undefined };
  }
  if (block.type === "reasoning" && typeof block.text === "string") {
    return { ...block, text: compactString(block.text, 1_000) };
  }
  return block;
}

export function compactModelMessagesForStorage(messages: any[]): any[] {
  return messages.map((message) => {
    const content = Array.isArray(message?.content)
      ? message.content.map(compactContentBlock)
      : message?.content;
    return { ...message, content };
  });
}

export function dedupeConsecutiveUserTurns(messages: any[]): any[] {
  const out: any[] = [];
  let lastUserKey = "";
  for (const message of messages) {
    if (message?.role !== "user") {
      out.push(message);
      continue;
    }
    const text = Array.isArray(message.parts)
      ? message.parts.filter((p: any) => p?.type === "text").map((p: any) => p.text ?? "").join("\n")
      : String(message.content ?? "");
    const key = text.trim().slice(0, 1_000);
    if (key && key === lastUserKey) continue;
    lastUserKey = key;
    out.push(message);
  }
  return out;
}