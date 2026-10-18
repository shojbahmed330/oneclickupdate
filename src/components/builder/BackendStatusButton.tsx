import { useState } from "react";
import { Database, Loader2, Check, Unplug, ChevronDown, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabaseIntegration, type SupabaseProjectInfo } from "@/hooks/useSupabaseIntegration";
import { toast } from "@/hooks/use-toast";

/**
 * Permanent header chip showing backend (Supabase) link status for the current
 * project. Lets the user connect / pick project / disconnect / switch account
 * at any time — independent of whether the AI agent emitted the
 * `[[supabase-connect]]` token.
 */
export const BackendStatusButton = ({ projectId }: { projectId: string }) => {
  const {
    connection,
    link,
    loading,
    startConnect,
    disconnect,
    listSupabaseProjects,
    linkProject,
    unlinkProject,
  } = useSupabaseIntegration(projectId);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState<SupabaseProjectInfo[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const connected = !!link;

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const { projects } = await listSupabaseProjects();
      setProjects(projects || []);
    } catch (e: any) {
      toast({ title: "Couldn't load projects", description: e?.message, variant: "destructive" });
    } finally {
      setLoadingProjects(false);
    }
  };

  const openPicker = async () => {
    setBusy(true);
    try {
      if (!connection) {
        await startConnect(window.location.pathname);
      }
      setPickerOpen(true);
      await loadProjects();
    } catch (e: any) {
      toast({
        title: "Connection failed",
        description: e?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async (p: SupabaseProjectInfo) => {
    setBusy(true);
    try {
      await linkProject({
        supabase_project_ref: p.id,
        supabase_project_name: p.name,
        supabase_org_id: p.organization_id,
        supabase_region: p.region,
      });
      toast({ title: "Backend connected", description: `Linked to ${p.name}.` });
      setPickerOpen(false);
    } catch (e: any) {
      toast({ title: "Link failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchAccount = async () => {
    setBusy(true);
    try {
      // Drop current OAuth connection, then start fresh so the user can pick
      // a different Supabase account (or sign up a new one in the popup).
      await disconnect();
      await startConnect(window.location.pathname);
      await loadProjects();
      toast({ title: "Account switched", description: "Pick a project to link." });
    } catch (e: any) {
      toast({
        title: "Switch failed",
        description: e?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Unlink the backend from this project? Existing data stays in your backend account.")) return;
    setBusy(true);
    try {
      await unlinkProject();
      toast({ title: "Backend unlinked" });
    } catch (e: any) {
      toast({ title: "Unlink failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </Button>
    );
  }

  return (
    <>
      {!connected ? (
        <Button
          variant="outline"
          size="sm"
          onClick={openPicker}
          disabled={busy}
          className="h-8 gap-1.5 px-2.5 border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 active:scale-95"
          title="Connect a backend (auth, database, storage)"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
          <span className="text-xs font-medium hidden sm:inline">Connect backend</span>
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 active:scale-95"
              title={`Linked: ${link?.supabase_project_name}`}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <Database className="h-3.5 w-3.5" />
              <span className="text-xs font-medium hidden md:inline max-w-[120px] truncate">
                {link?.supabase_project_name}
              </span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs">Backend</DropdownMenuLabel>
            <div className="px-2 pb-2 pt-1 text-xs">
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <Check className="h-3 w-3" /> Connected
              </div>
              <div className="text-muted-foreground mt-0.5 truncate">{link?.supabase_project_name}</div>
              {link?.supabase_region && (
                <div className="text-muted-foreground text-[10px] mt-0.5">{link.supabase_region}</div>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={openPicker}
              disabled={busy}
              className="text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              Switch project
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDisconnect}
              disabled={busy}
              className="text-destructive focus:text-destructive text-xs"
            >
              <Unplug className="h-3.5 w-3.5 mr-2" />
              Unlink backend
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pick a backend project</DialogTitle>
            <DialogDescription>
              Choose a Supabase project to link, or connect a different account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1 max-h-72 overflow-y-auto -mx-1 px-1">
            {loadingProjects ? (
              <div className="grid place-items-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : projects.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">
                No projects found in this account. Create one in your Supabase account, or switch accounts below.
              </div>
            ) : (
              projects.map((p) => {
                const isCurrent = link?.supabase_project_ref === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handlePick(p)}
                    disabled={busy || isCurrent}
                    className="w-full flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-left hover:bg-accent transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
                  >
                    <Database className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {p.region} · {p.id}
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="text-[10px] text-emerald-500 font-medium">Linked</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchAccount}
              disabled={busy}
              className="gap-1.5"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Connect a different account
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
