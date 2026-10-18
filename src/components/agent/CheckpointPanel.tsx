// Checkpoint sidebar — save, restore, and branch the project's file state.
// Branching creates a new sibling project with the snapshot's files so the
// user can explore "what if" without losing the current path.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GitBranch, History, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCheckpoints, type Checkpoint } from "@/hooks/useCheckpoints";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export const CheckpointPanel = ({ projectId }: Props) => {
  const navigate = useNavigate();
  const { items, loading, busyId, create, restore, branch } = useCheckpoints(projectId);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "restore" | "branch"; cp: Checkpoint } | null>(null);
  const [branchName, setBranchName] = useState("");

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
              "bg-background/85 text-foreground border-border hover:bg-background",
              "shadow-lg backdrop-blur-md transition-all active:scale-95",
            )}
            title="Project checkpoints"
          >
            <History size={13} />
            Checkpoints
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
          <div className="p-3 border-b border-border">
            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Save size={12} /> Save current state
            </p>
            <div className="flex gap-2">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. before-router-refactor"
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    create(label);
                    setLabel("");
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8"
                onClick={() => {
                  create(label);
                  setLabel("");
                }}
                disabled={busyId === "__create"}
              >
                {busyId === "__create" ? <Loader2 className="size-3 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="p-4 text-xs text-muted-foreground text-center">Loading…</div>
            )}
            {!loading && items.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground text-center">
                No checkpoints yet. Save one before risky changes.
              </div>
            )}
            {items.map((cp) => (
              <div key={cp.id} className="p-3 border-b border-border last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{cp.label || "(no label)"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {cp.file_count} files · {relTime(cp.created_at)}
                      <span className="ml-1 inline-block px-1 rounded bg-muted text-[9px] uppercase tracking-wide">
                        {cp.source}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] flex-1"
                    onClick={() => setConfirm({ kind: "restore", cp })}
                    disabled={busyId === cp.id}
                  >
                    <RotateCcw size={11} className="mr-1" /> Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] flex-1"
                    onClick={() => {
                      setBranchName(`Branch — ${cp.label || cp.id.slice(0, 6)}`);
                      setConfirm({ kind: "branch", cp });
                    }}
                    disabled={busyId === cp.id}
                  >
                    <GitBranch size={11} className="mr-1" /> Branch
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "restore" ? "Restore this checkpoint?" : "Branch from this checkpoint?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "restore"
                ? "This will overwrite all current files in your project with the snapshot. Anything you've changed since will be lost (you can re-snapshot first to keep it)."
                : "Creates a new project with this snapshot's files. Your current project stays untouched — perfect for trying a different approach."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm?.kind === "branch" && (
            <Input
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="New project name"
              className="mt-2"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirm) return;
                const cp = confirm.cp;
                const kind = confirm.kind;
                setConfirm(null);
                if (kind === "restore") {
                  await restore(cp.id);
                } else {
                  const newId = await branch(cp.id, branchName);
                  if (newId) navigate(`/builder/${newId}`);
                }
              }}
            >
              {confirm?.kind === "restore" ? "Restore" : "Create branch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
