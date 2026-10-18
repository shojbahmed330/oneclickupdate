// Knowledge panel — lets the user view, add, edit and delete `project_memory`
// rules for the current project. These are surfaced to the agent at runtime.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Pencil, Save, X, BookOpen, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Memory = {
  id: string;
  content: string;
  category: string;
  weight: number;
  source: string;
  updated_at: string;
};

const CATEGORIES = ["preference", "constraint", "design", "feature", "reference"] as const;

export const KnowledgePanel = ({ projectId }: { projectId: string }) => {
  const qc = useQueryClient();
  const KEY = ["project_memory", projectId] as const;
  const { data: items = [], isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Memory[]> => {
      const { data, error } = await supabase
        .from("project_memory")
        .select("id, content, category, weight, source, updated_at")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Memory[];
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ content: "", category: "preference" });
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState({ content: "", category: "preference" });
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });

  const startEdit = (m: Memory) => { setEditingId(m.id); setDraft({ content: m.content, category: m.category }); };

  const saveEdit = async () => {
    if (!editingId) return;
    const { error } = await supabase
      .from("project_memory")
      .update({ content: draft.content.trim(), category: draft.category })
      .eq("id", editingId);
    if (error) return toast.error(error.message);
    toast.success("Memory updated");
    setEditingId(null);
    invalidate();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("project_memory").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Memory removed");
    qc.setQueryData<Memory[]>(KEY, (p) => (p ?? []).filter((m) => m.id !== id));
  };

  const create = async () => {
    const text = newDraft.content.trim();
    if (!text) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return toast.error("Sign in required");
    const { error } = await supabase.from("project_memory").insert({
      project_id: projectId,
      user_id: user.id,
      content: text,
      category: newDraft.category,
      source: "manual",
      weight: 2,
    });
    if (error) return toast.error(error.message);
    toast.success("Memory added");
    setAdding(false);
    setNewDraft({ content: "", category: "preference" });
    invalidate();
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen size={14} className="text-primary" />
          Knowledge
          <span className="text-xs text-muted-foreground font-normal">({items.length})</span>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-xs font-medium active:scale-95 transition"
        >
          <Plus size={13} /> Add rule
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {adding && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles size={12} className="text-primary" />
              <span className="font-medium">New rule</span>
              <select
                value={newDraft.category}
                onChange={(e) => setNewDraft({ ...newDraft, category: e.target.value })}
                className="ml-auto rounded border border-border bg-background px-2 py-0.5 text-xs"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <textarea
              autoFocus
              value={newDraft.content}
              onChange={(e) => setNewDraft({ ...newDraft, content: e.target.value })}
              placeholder="e.g. Always use semantic color tokens, never hard-coded hex values."
              className="w-full min-h-[72px] rounded-md border border-border bg-background p-2 text-xs resize-y"
            />
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={() => { setAdding(false); setNewDraft({ content: "", category: "preference" }); }}
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground active:scale-95"
              >Cancel</button>
              <button
                onClick={create}
                className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-xs font-medium active:scale-95"
              >
                <Save size={12} /> Save
              </button>
            </div>
          </div>
        )}

        {isLoading && items.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">Loading…</div>
        )}
        {!isLoading && items.length === 0 && !adding && (
          <div className="text-center text-xs text-muted-foreground py-12 px-6">
            No rules yet. Add one to teach the agent how you want this project built.
          </div>
        )}

        {items.map((m) => {
          const isEdit = editingId === m.id;
          return (
            <div
              key={m.id}
              className={cn(
                "rounded-lg border border-border bg-card p-3 space-y-2 transition",
                isEdit && "ring-1 ring-primary/40",
              )}
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
                <span className={cn(
                  "rounded px-1.5 py-0.5 font-semibold",
                  m.category === "constraint" ? "bg-destructive/15 text-destructive" :
                  m.category === "design" ? "bg-fuchsia-500/15 text-fuchsia-500" :
                  m.category === "feature" ? "bg-emerald-500/15 text-emerald-600" :
                  m.category === "reference" ? "bg-sky-500/15 text-sky-600" :
                  "bg-primary/15 text-primary",
                )}>{m.category}</span>
                {m.source !== "manual" && <span className="text-muted-foreground">auto</span>}
                <span className="ml-auto text-muted-foreground font-normal normal-case">
                  {new Date(m.updated_at).toLocaleDateString()}
                </span>
              </div>

              {isEdit ? (
                <>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="rounded border border-border bg-background px-2 py-0.5 text-xs"
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <textarea
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                    className="w-full min-h-[72px] rounded-md border border-border bg-background p-2 text-xs resize-y"
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setEditingId(null)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground active:scale-95"
                    >
                      <X size={12} /> Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-xs font-medium active:scale-95"
                    >
                      <Save size={12} /> Save
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-snug">{m.content}</p>
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => startEdit(m)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      onClick={() => remove(m.id)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95"
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
