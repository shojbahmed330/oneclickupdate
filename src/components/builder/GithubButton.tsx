import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, GitBranch, Loader2, Plus, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Props = {
  projectId: string;
  projectName?: string;
  onRunCommand?: (prompt: string) => void;
};

const repoSlug = (name?: string) =>
  (name || "lovable-project")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "lovable-project";

export function GithubButton({ projectId, projectName, onRunCommand }: Props) {
  const [status, setStatus] = useState<{
    connected: boolean;
    linked: boolean;
    username?: string;
    repo?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    const [{ data: conn }, { data: link }] = await Promise.all([
      supabase.from("user_github_connections").select("github_username,revoked").eq("user_id", u.user.id).maybeSingle(),
      supabase.from("project_github_links").select("repo_full_name").eq("project_id", projectId).eq("user_id", u.user.id).maybeSingle(),
    ]);
    setStatus({
      connected: !!conn && !(conn as any).revoked,
      linked: !!link,
      username: (conn as any)?.github_username,
      repo: (link as any)?.repo_full_name,
    });
  };

  useEffect(() => { refresh(); }, [projectId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "ghoauth_success" && event.data?.type !== "ghoauth_error") return;
      if (event.data.type === "ghoauth_error") {
        toast({ title: "GitHub connection failed", description: event.data.message, variant: "destructive" });
      } else {
        toast({ title: "GitHub connected", description: event.data.message });
      }
      refresh();
      setLoading(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [projectId]);

  const connect = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("github-oauth-start", {
        body: { return_to: window.location.href },
      });
      if (error || !data?.url) throw new Error(error?.message || data?.error || "OAuth not configured");
      const popup = window.open(data.url, "gh-oauth", "width=720,height=820");
      if (!popup) throw new Error("Popup blocked — allow popups and retry");
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer);
          refresh();
          setLoading(false);
        }
      }, 800);
    } catch (e: any) {
      toast({ title: "GitHub setup needed", description: e.message, variant: "destructive" });
      setLoading(false);
    }
  };

  const directPush = async (commitMessage: string) => {
    setLoading(true);
    toast({ title: "Pushing to GitHub…", description: "Direct push, no AI tokens used." });
    try {
      const { data, error } = await supabase.functions.invoke("github-direct-push", {
        body: {
          projectId,
          message: commitMessage,
          createIfMissing: true,
          repoName: repoSlug(projectName),
          repoDescription: `Built with OneClickStudio: ${projectName ?? "project"}`,
          private: true,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        const detail = String(data?.error || data?.output_tail || "Push failed");
        throw new Error(detail.includes("Large files detected") ? "Push blocked by large generated files. Cleaned ignore rules are now applied — retry push." : detail.slice(-240));
      }
      toast({
        title: data.commit_sha ? "Pushed ✓" : "Repo synced",
        description: data.repo_full_name + (data.commit_sha ? ` · ${String(data.commit_sha).slice(0, 7)}` : ""),
      });
      refresh();
    } catch (e: any) {
      toast({ title: "GitHub push failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const createAndPush = () => directPush("chore: initial OneClickStudio sync");
  const pushLatest = () => directPush("chore: sync OneClickStudio project");

  if (status?.connected) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={status.linked ? "outline" : "ghost"} size="sm" disabled={loading} className="active:scale-95 gap-1.5" title={status.linked ? `GitHub: ${status.repo}` : `Connected as @${status.username}`}>
            <CheckCircle2 size={14} />
            <span className="hidden sm:inline">{status.linked ? "GitHub ✓" : "Create repo"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">GitHub</DropdownMenuLabel>
          <div className="px-2 pb-2 text-xs text-muted-foreground truncate">
            @{status.username}{status.repo ? ` · ${status.repo}` : " · no repo linked"}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={createAndPush} className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-2" />
            {status.linked ? "Ensure repo + push" : "Create repo + push"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={pushLatest} className="text-xs">
            <UploadCloud className="h-3.5 w-3.5 mr-2" />
            Push latest code
          </DropdownMenuItem>
          {status.repo && (
            <DropdownMenuItem onClick={() => window.open(`https://github.com/${status.repo}`, "_blank")} className="text-xs">
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              Open repository
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={connect}
      disabled={loading}
      className="active:scale-95 gap-1.5"
      title="Connect GitHub to push your code"
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} />}
      <span className="hidden sm:inline">{!status ? "GitHub" : "Connect GitHub"}</span>
    </Button>
  );
}