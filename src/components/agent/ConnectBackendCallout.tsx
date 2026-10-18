import { useState } from "react";
import { Database, Loader2, Shield, Zap, Lock, ArrowRight, Sparkles } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSupabaseIntegration } from "@/hooks/useSupabaseIntegration";
import { toast } from "@/hooks/use-toast";

/**
 * Rendered inside an assistant message when the agent emits the
 * `[[supabase-connect]]` token. Premium card UI prompting the user to connect
 * a backend before the agent proceeds.
 */
export const ConnectBackendCallout = () => {
  const params = useParams();
  const projectId = (params as any).projectId ?? (params as any).id ?? "";
  const { connection, link, startConnect, listSupabaseProjects, linkProject } =
    useSupabaseIntegration(projectId);
  const [busy, setBusy] = useState(false);

  if (link) return null;

  const handleClick = async () => {
    setBusy(true);
    try {
      if (!connection) {
        await startConnect(window.location.pathname);
      }
      const { projects } = await listSupabaseProjects();
      if (!projects?.length) {
        toast({
          title: "No backend projects found",
          description: "Create one in your Cloud account, then click Connect again.",
        });
        return;
      }
      if (projects.length === 1) {
        const p = projects[0];
        await linkProject({
          supabase_project_ref: p.id,
          supabase_project_name: p.name,
          supabase_org_id: p.organization_id,
          supabase_region: p.region,
        });
        toast({ title: "Backend connected", description: `Linked to ${p.name}. Send your prompt again to scaffold.` });
      } else {
        toast({
          title: "Backend account connected",
          description: "Open the Cloud panel (top-right) to pick which project to link.",
        });
      }
    } catch (e: any) {
      toast({
        title: "Connection failed",
        description: e?.message ?? "Try again from the Cloud panel.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-3 relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-background to-background shadow-sm">
      {/* decorative glow */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid place-items-center h-10 w-10 rounded-xl bg-primary/15 text-primary shrink-0 ring-1 ring-primary/25">
            <Database className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Permission needed
              </span>
            </div>
            <h3 className="mt-1 text-base font-semibold leading-tight">
              Connect a backend to continue
            </h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              I need a backend to set up auth, database, storage and APIs for this app.
            </p>
          </div>
        </div>

        {/* feature chips */}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {[
            { icon: Lock, label: "Auth" },
            { icon: Database, label: "Database" },
            { icon: Zap, label: "APIs" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-background/60 py-1.5 text-[11px] font-medium text-muted-foreground"
            >
              <Icon className="h-3 w-3" />
              {label}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Shield className="h-3 w-3" />
            <span>Secure OAuth · revoke anytime</span>
          </div>
          <Button
            onClick={handleClick}
            disabled={busy}
            size="sm"
            className="active:scale-95 shrink-0 gap-1.5 shadow-sm"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                {connection ? "Pick a project" : "Connect backend"}
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
