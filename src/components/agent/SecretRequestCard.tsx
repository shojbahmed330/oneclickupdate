import { useState } from "react";
import { Key, ExternalLink, Loader2, ShieldCheck, X, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAgentSecretRequests, type AgentSecretRequest } from "@/hooks/useAgentSecretRequests";

/**
 * Inline card surfaced in the agent chat whenever the agent calls
 * `request_secret`. User pastes the value (password-masked) → it gets
 * encrypted in transit and pushed to their linked backend as a runtime
 * env var. The agent never sees the value.
 */
export const SecretRequestCard = ({
  request,
  onDone,
}: {
  request: AgentSecretRequest;
  onDone?: () => void;
}) => {
  const { submit } = useAgentSecretRequests(request.project_id);
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"provide" | "decline" | null>(null);

  if (request.status === "provided") {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="h-4 w-4" />
          <span className="font-medium">{request.label || request.secret_name} saved</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Available in your backend as{" "}
          <code className="rounded bg-muted px-1 py-0.5">{request.secret_name}</code>.
        </p>
      </div>
    );
  }

  if (request.status === "declined" || request.status === "cancelled") {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <X className="h-4 w-4" />
          <span>Skipped {request.secret_name}.</span>
        </div>
      </div>
    );
  }

  const onProvide = async () => {
    if (!value.trim()) {
      toast({ title: "Enter the value first", variant: "destructive" });
      return;
    }
    setBusy("provide");
    try {
      await submit(request.id, "provide", value.trim());
      toast({ title: "Secret saved", description: `${request.secret_name} is now available to your app.` });
      setValue("");
      onDone?.();
    } catch (e) {
      toast({
        title: "Could not save secret",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const onDecline = async () => {
    setBusy("decline");
    try {
      await submit(request.id, "decline");
      onDone?.();
    } catch (e) {
      toast({
        title: "Could not decline",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Key className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">
            Provide{" "}
            <code className="rounded bg-background px-1.5 py-0.5 text-xs">
              {request.secret_name}
            </code>
          </div>
          {request.why_needed && (
            <p className="mt-1 text-xs text-muted-foreground">{request.why_needed}</p>
          )}
          {request.link_hint && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium">Where to find:</span> {request.link_hint}
            </p>
          )}
          {request.doc_url && (
            <a
              href={request.doc_url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open docs <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={`Paste ${request.label || request.secret_name} here`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void onProvide();
        }}
        disabled={busy !== null}
        className="font-mono text-xs"
      />

      {request.error_message && (
        <div className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{request.error_message}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-muted-foreground">
          🔒 Stored in your backend. The AI never sees the value.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={onDecline}
            className="h-7 text-xs"
          >
            {busy === "decline" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Skip"}
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || !value.trim()}
            onClick={onProvide}
            className="h-7 text-xs"
          >
            {busy === "provide" ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Check className="h-3 w-3 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Compact stack of all pending secret requests for the current project.
 * Drop this into the chat composer area / above the input.
 */
export const SecretRequestStack = ({ projectId }: { projectId: string }) => {
  const { pending } = useAgentSecretRequests(projectId);
  if (!pending.length) return null;
  return (
    <div className="space-y-2">
      {pending.map((r) => (
        <SecretRequestCard key={r.id} request={r} />
      ))}
    </div>
  );
};
