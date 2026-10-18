import { useState } from "react";
import { ExternalLink, Loader2, Plug, X, Check, Sparkles, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useConnectorProposals, type ConnectorProposal } from "@/hooks/useConnectorProposals";

/**
 * Connector choice card — surfaced whenever the agent calls
 * `discover_connector`. Shows 2-3 researched providers; user picks one
 * (or skips). Picking auto-spawns a SecretRequestCard per required key,
 * which already renders in the same composer area.
 */
export const ConnectorProposalCard = ({ proposal }: { proposal: ConnectorProposal }) => {
  const { resolve } = useConnectorProposals(proposal.project_id);
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | "cancel" | null>(null);

  if (proposal.status === "selected") {
    const chosen = proposal.options[proposal.selected_option_index ?? -1];
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" />
          <span className="font-medium">{chosen?.name ?? "Provider"} selected</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Fill in the API keys below to finish the integration.
        </p>
      </div>
    );
  }

  if (proposal.status === "cancelled" || proposal.status === "failed") {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <X className="h-4 w-4" />
          <span>{proposal.status === "failed" ? `Failed: ${proposal.error_message ?? "unknown"}` : "Skipped provider choice."}</span>
        </div>
      </div>
    );
  }

  const onPick = async (idx: number) => {
    setBusy(idx);
    try {
      const data = await resolve(proposal.id, "select", idx);
      toast({
        title: `${(data as any).provider} chosen`,
        description: `${(data as any).secrets_requested} secret${(data as any).secrets_requested === 1 ? "" : "s"} requested.`,
      });
    } catch (e) {
      toast({
        title: "Could not pick provider",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async () => {
    setBusy("cancel");
    try { await resolve(proposal.id, "cancel"); }
    catch (e) {
      toast({ title: "Could not skip", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Choose a provider</div>
          {proposal.need_description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              For: <span className="italic">{proposal.need_description}</span>
            </p>
          )}
        </div>
        <Button
          size="sm" variant="ghost" disabled={busy !== null}
          onClick={onCancel} className="h-6 px-2 text-xs"
        >
          {busy === "cancel" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Skip"}
        </Button>
      </div>

      <div className="space-y-2">
        {proposal.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            disabled={busy !== null}
            onClick={() => onPick(i)}
            className="w-full text-left rounded-md border border-border bg-background hover:border-primary/50 hover:bg-primary/5 active:scale-[0.99] transition p-2.5 disabled:opacity-50 disabled:pointer-events-none"
          >
            <div className="flex items-start gap-2">
              <Plug className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{opt.name}</span>
                  {opt.docs_url && (
                    <a
                      href={opt.docs_url} target="_blank" rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      docs <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
                {opt.tagline && <p className="text-xs text-muted-foreground mt-0.5">{opt.tagline}</p>}
                {opt.pricing_note && (
                  <p className="text-[10px] text-muted-foreground mt-1 italic">{opt.pricing_note}</p>
                )}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {opt.required_secrets.map((s) => (
                    <span
                      key={s.name}
                      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                    >
                      <Key className="h-2.5 w-2.5" />
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
              {busy === i && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

/** Stack of all pending connector proposals for a project. */
export const ConnectorProposalStack = ({ projectId }: { projectId: string }) => {
  const { pending } = useConnectorProposals(projectId);
  if (!pending.length) return null;
  return (
    <div className="space-y-2">
      {pending.map((p) => (
        <ConnectorProposalCard key={p.id} proposal={p} />
      ))}
    </div>
  );
};
