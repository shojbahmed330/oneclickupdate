import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight, ChevronDown, File as FileIcon, Folder, RefreshCw, Loader2 } from "lucide-react";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { cn } from "@/lib/utils";

type Item = { name: string; isDir: boolean };
type DirState = { loading: boolean; items: Item[]; open: boolean; error?: string };

const langFromPath = (p: string) => {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      json: "json", css: "css", html: "html", md: "markdown", svg: "xml",
      yml: "yaml", yaml: "yaml", sh: "bash", py: "python",
    } as Record<string, string>
  )[ext] ?? "plaintext";
};

async function callFiles(projectId: string, action: "list" | "read", path = ".") {
  const { data, error } = await supabase.functions.invoke("agent-files", {
    body: { projectId, action, path },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? "request failed");
  return data;
}

export const AgentCodeBrowser = ({ projectId }: { projectId: string }) => {
  const [tree, setTree] = useState<Record<string, DirState>>({});
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState<{ loading: boolean; text: string; error?: string; truncated?: boolean }>({
    loading: false, text: "",
  });
  const [empty, setEmpty] = useState(false);

  const loadDir = useCallback(async (dir: string) => {
    setTree((t) => ({ ...t, [dir]: { ...(t[dir] ?? { items: [], open: true }), loading: true, open: true } }));
    try {
      const data = await callFiles(projectId, "list", dir);
      if (data.empty) setEmpty(true);
      const items = (data.items ?? []) as Item[];
      items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
      setTree((t) => ({ ...t, [dir]: { loading: false, items, open: true } }));
    } catch (e: any) {
      setTree((t) => ({ ...t, [dir]: { loading: false, items: [], open: true, error: e.message } }));
    }
  }, [projectId]);

  useEffect(() => { loadDir("."); }, [loadDir]);

  const toggleDir = (dir: string) => {
    const cur = tree[dir];
    if (!cur || (!cur.open && cur.items.length === 0)) return loadDir(dir);
    setTree((t) => ({ ...t, [dir]: { ...cur, open: !cur.open } }));
  };

  const openFile = async (path: string) => {
    setActive(path);
    setContent({ loading: true, text: "" });
    try {
      const data = await callFiles(projectId, "read", path);
      setContent({ loading: false, text: data.content ?? "", truncated: data.truncated });
    } catch (e: any) {
      setContent({ loading: false, text: "", error: e.message });
    }
  };

  const renderDir = (dir: string, depth = 0) => {
    const state = tree[dir];
    if (!state) return null;
    return (
      <ul className="text-sm">
        {state.loading && state.items.length === 0 && (
          <li className="px-2 py-1 text-muted-foreground flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </li>
        )}
        {state.error && <li className="px-2 py-1 text-destructive text-xs">{state.error}</li>}
        {state.open && state.items.map((it) => {
          const path = dir === "." ? it.name : `${dir}/${it.name}`;
          if (it.isDir) {
            const sub = tree[path];
            const open = sub?.open;
            return (
              <li key={path}>
                <button
                  onClick={() => toggleDir(path)}
                  className="w-full flex items-center gap-1 px-2 py-1 hover:bg-muted/50 active:scale-[0.98] transition rounded"
                  style={{ paddingLeft: 8 + depth * 12 }}
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Folder size={13} className="text-primary/80" />
                  <span className="truncate">{it.name}</span>
                </button>
                {open && renderDir(path, depth + 1)}
              </li>
            );
          }
          return (
            <li key={path}>
              <button
                onClick={() => openFile(path)}
                className={cn(
                  "w-full flex items-center gap-1 px-2 py-1 rounded text-left active:scale-[0.98] transition",
                  active === path ? "bg-primary/10 text-primary" : "hover:bg-muted/50",
                )}
                style={{ paddingLeft: 22 + depth * 12 }}
              >
                <FileIcon size={12} className="text-muted-foreground shrink-0" />
                <span className="truncate">{it.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  if (empty) {
    return (
      <div className="h-full grid place-items-center px-6 text-center">
        <div className="space-y-2 max-w-xs">
          <p className="text-sm font-medium">No code yet</p>
          <p className="text-xs text-muted-foreground">
            Send a prompt in chat — the agent will scaffold the project, then files appear here.
          </p>
        </div>
      </div>
    );
  }

  const Tree = (
    <div className="h-full overflow-auto p-1 border-r border-border bg-card/30">
      <div className="flex items-center justify-between px-2 py-1 sticky top-0 bg-card/90 backdrop-blur z-10">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Files</span>
        <button onClick={() => loadDir(".")} className="p-1 rounded hover:bg-muted active:scale-90 transition" aria-label="Refresh">
          <RefreshCw size={12} />
        </button>
      </div>
      {renderDir(".")}
    </div>
  );

  const Viewer = (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-8 shrink-0 flex items-center px-3 border-b border-border bg-card/50 text-xs font-mono truncate">
        {active ?? "Select a file"}
        {content.truncated && <span className="ml-2 text-amber-500">(truncated)</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {content.loading ? (
          <div className="h-full grid place-items-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>
        ) : content.error ? (
          <div className="p-4 text-sm text-destructive">{content.error}</div>
        ) : !active ? (
          <div className="h-full grid place-items-center text-xs text-muted-foreground px-6 text-center">
            Pick a file from the tree to view its source.
          </div>
        ) : (
          <CodeBlock code={content.text} language={langFromPath(active) as any} className="rounded-none border-0 text-xs" />
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full grid grid-cols-[minmax(160px,38%)_1fr] sm:grid-cols-[260px_1fr]">
      {Tree}
      {Viewer}
    </div>
  );
};
