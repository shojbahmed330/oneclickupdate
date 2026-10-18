import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { ArrowLeft, MessageSquare, Eye, Code2, BookOpen, HelpCircle } from "lucide-react";
import logoMark from "@/assets/oneclick-mark.webp";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { UserMenu } from "@/components/UserMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { ModelSettingsMenu } from "@/components/builder/ModelSettingsMenu";
import { ShipActions } from "@/components/builder/ShipActions";
import { BackendStatusButton } from "@/components/builder/BackendStatusButton";
import { BuilderHeaderOverflow } from "@/components/builder/BuilderHeaderOverflow";
import { useAgentProject } from "@/hooks/useAgentProject";
import { useAgent } from "@/hooks/useAgent";
import { useChatMessageActions } from "@/hooks/useChatMessageActions";
import { useSandboxKeepalive } from "@/hooks/useSandboxKeepalive";
import { AgentTranscript } from "@/components/agent/AgentTranscript";
import { AgentErrorBoundary } from "@/components/agent/AgentErrorBoundary";
import { AgentComposer } from "@/components/agent/AgentComposer";
import { SqlConfirmationGate } from "@/components/agent/SqlConfirmationGate";
import { DesignModePanel } from "@/components/agent/DesignModePanel";
import { SecretRequestStack } from "@/components/agent/SecretRequestCard";
import { ConnectorProposalStack } from "@/components/agent/ConnectorProposalCard";
import { useDesignMode } from "@/hooks/useDesignMode";
import { shouldOfferDesignPreview } from "@/lib/agent/detectAppIntent";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tour } from "@/components/tour/Tour";
import { BUILDER_TOUR_STEPS, BUILDER_TOUR_KEY } from "@/components/tour/tours";

// Side panels are lazy-loaded so the Builder shell paints with just chat.
// Switching tabs / resizing the right pane downloads the corresponding chunk
// on demand — KnowledgePanel especially is rarely opened in a session.
const AgentPreview = lazy(() =>
  import("@/components/agent/AgentPreview").then((m) => ({ default: m.AgentPreview })),
);
const AgentCodeBrowser = lazy(() =>
  import("@/components/agent/AgentCodeBrowser").then((m) => ({ default: m.AgentCodeBrowser })),
);
const KnowledgePanel = lazy(() =>
  import("@/components/agent/KnowledgePanel").then((m) => ({ default: m.KnowledgePanel })),
);

const PanelFallback = () => (
  <div className="h-full grid place-items-center text-xs text-muted-foreground">
    <div className="flex items-center gap-2">
      <div className="size-1.5 rounded-full bg-primary animate-pulse" />
      Loading panel…
    </div>
  </div>
);

type MobileTab = "chat" | "code" | "preview" | "knowledge";
type DesktopRight = "preview" | "code" | "knowledge";

const BuilderV2 = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { id: projectId, name, initialMessages, loading } = useAgentProject(id);
  const [tab, setTab] = useState<MobileTab>("chat");

  if (loading || !projectId) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="size-2 rounded-full bg-primary animate-pulse" />
          Loading workspace…
        </div>
      </div>
    );
  }

  return (
    <AgentErrorBoundary>
      <ProjectShell
        projectId={projectId}
        name={name}
        initialMessages={initialMessages}
        isMobile={isMobile}
        tab={tab}
        setTab={setTab}
        onBack={() => navigate("/projects")}
      />
    </AgentErrorBoundary>
  );
};

interface ShellProps {
  projectId: string;
  name: string;
  initialMessages: any[];
  isMobile: boolean;
  tab: MobileTab;
  setTab: (t: MobileTab) => void;
  onBack: () => void;
}

const ProjectShell = ({
  projectId,
  name,
  initialMessages,
  isMobile,
  tab,
  setTab,
  onBack,
}: ShellProps) => {
  const chat = useAgent(projectId, initialMessages) as any;
  const { messages, sendMessage, status, stop, regenerate } = chat;
  const { onDeleteUser, onEditUser, onResendUser } = useChatMessageActions(projectId, chat);
  const keepalivePreviewUrl = useSandboxKeepalive(projectId);
  const design = useDesignMode(projectId);

  // Helper: send raw text to the agent (used both directly and after design approval)
  const sendText = (text: string, images: { mediaType: string; url: string; filename?: string }[] = []) => {
    const parts: any[] = [];
    if (text) parts.push({ type: "text", text });
    for (const img of images) {
      parts.push({ type: "file", mediaType: img.mediaType, url: img.url, filename: img.filename });
    }
    sendMessage({ parts } as any);
  };

  const handleApproveDesign = async () => {
    const slim = await design.approveAndBuildPrompt();
    if (slim) sendText(slim);
  };

  // Auto-fire the starter prompt when arriving from a template pick.
  // Dashboard navigates with location.state.autoPrompt — we send it once
  // (only if the project has no prior messages) then clear the state so
  // refreshing or back-navigating doesn't resend it.
  const location = useLocation();
  const navigate = useNavigate();
  const autoFiredRef = useRef(false);
  useEffect(() => {
    const autoPrompt = (location.state as any)?.autoPrompt;
    if (!autoPrompt || autoFiredRef.current) return;
    if ((initialMessages?.length ?? 0) > 0) return;
    autoFiredRef.current = true;
    sendMessage({ parts: [{ type: "text", text: autoPrompt }] } as any);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location, initialMessages, sendMessage, navigate]);

  const sendGithubCommand = (text: string) => {
    sendMessage({ parts: [{ type: "text", text }] } as any);
    if (isMobile) setTab("chat");
  };

  const chatPanel = (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <AgentTranscript
          messages={messages}
          status={status}
          onRetry={regenerate}
          onDeleteUser={onDeleteUser}
          onEditUser={onEditUser}
          onResendUser={onResendUser}
        />
      </div>
      <SqlConfirmationGate messages={messages} projectId={projectId} />
      <DesignModePanel
        state={design.state}
        onBuild={handleApproveDesign}
        onRegenerateAll={design.regenerateAll}
        onRegenerateScreen={design.regenerateScreen}
        onSetActive={design.setActiveIndex}
        onSkip={design.dismiss}
      />
      <div className="border-t border-border p-3 shrink-0 space-y-2" data-tour="chat-composer">
        <ConnectorProposalStack projectId={projectId} />
        <SecretRequestStack projectId={projectId} />
        <AgentComposer
          status={status}
          onSend={(text, images) => {
            // Auto-detect "new app" intent → divert to Design Mode for first turn.
            // Images present, follow-up turns, or edit-style prompts go straight to the agent.
            const userMsgCount = (messages ?? []).filter((m: any) => m.role === "user").length;
            if (
              images.length === 0 &&
              design.state.status === "idle" &&
              shouldOfferDesignPreview(text, userMsgCount)
            ) {
              design.generate(text);
              return;
            }
            sendText(text, images);
          }}
          onStop={stop}
        />
      </div>
    </div>
  );

  const preview = (
    <Suspense fallback={<PanelFallback />}>
      <AgentPreview messages={messages} fallbackUrl={keepalivePreviewUrl} projectId={projectId} />
    </Suspense>
  );
  const code = (
    <Suspense fallback={<PanelFallback />}>
      <AgentCodeBrowser projectId={projectId} />
    </Suspense>
  );
  const knowledge = (
    <Suspense fallback={<PanelFallback />}>
      <KnowledgePanel projectId={projectId} />
    </Suspense>
  );
  const [desktopRight, setDesktopRight] = useState<DesktopRight>("preview");

  const TabBtn = ({
    label, icon: Icon, active, onClick,
  }: { label: string; icon: any; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium active:scale-90 transition-all duration-200 min-h-[48px]",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute -top-px left-1/2 -translate-x-1/2 h-[3px] w-10 rounded-full bg-gradient-to-r from-primary via-fuchsia-500 to-primary/60 shadow-[0_0_12px_hsl(var(--primary)/0.7)]" />
      )}
      <Icon size={20} className={cn("transition-transform", active && "scale-110 drop-shadow-[0_0_6px_hsl(var(--primary)/0.6)]")} />
      <span className="leading-none">{label}</span>
    </button>
  );

  const DesktopTabBtn = ({
    label, icon: Icon, active, onClick, first, last,
  }: { label: string; icon: any; active: boolean; onClick: () => void; first?: boolean; last?: boolean }) => (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-all duration-200 active:scale-95",
        !first && "border-l border-border/60",
        active
          ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm"
          : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <div className="h-[100dvh] flex flex-col bg-background">
      <header className="h-14 shrink-0 flex items-center gap-2 px-3 border-b border-border/60 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65 sticky top-0 z-30">
        <Button variant="ghost" size="sm" onClick={onBack} className="active:scale-95 -ml-1 size-9 p-0">
          <ArrowLeft size={16} />
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <img
            src={logoMark}
            alt="OneClick Studio"
            width={24}
            height={24}
            className="size-6 shrink-0 rounded-md object-contain shadow-[0_4px_14px_-2px_hsl(var(--primary)/0.55)]"
          />
          <div className="min-w-0">
            <h1 className="font-display text-[15px] sm:text-[16px] font-normal tracking-[-0.025em] truncate leading-tight italic">{name}</h1>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground leading-tight hidden sm:block font-semibold">AI Workspace</p>
          </div>
        </div>
        {!isMobile && (
          <div className="flex items-center rounded-lg border border-border/60 overflow-hidden bg-muted/30 shadow-sm">
            <span data-tour="preview-tab">
              <DesktopTabBtn label="Preview" icon={Eye} active={desktopRight === "preview"} onClick={() => setDesktopRight("preview")} first />
            </span>
            <DesktopTabBtn label="Code" icon={Code2} active={desktopRight === "code"} onClick={() => setDesktopRight("code")} />
            <DesktopTabBtn label="Knowledge" icon={BookOpen} active={desktopRight === "knowledge"} onClick={() => setDesktopRight("knowledge")} last />
          </div>
        )}
        <div className="flex items-center gap-1 ml-1">
          {isMobile ? (
            <>
              <NotificationBell />
              <span data-tour="ship-actions">
                <BuilderHeaderOverflow projectId={projectId} projectName={name} onGithubCommand={sendGithubCommand} />
              </span>
              <UserMenu variant="compact" />
            </>
          ) : (
            <>
              <BackendStatusButton projectId={projectId} />
              <span data-tour="ship-actions">
                <ShipActions projectId={projectId} projectName={name} onGithubCommand={sendGithubCommand} />
              </span>
              <ModelSettingsMenu />
              <ThemeSwitcher />
              <Link
                to="/help"
                target="_blank"
                rel="noopener"
                title="Help center"
                className="size-9 grid place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition"
              >
                <HelpCircle size={16} />
              </Link>
              <NotificationBell />
              <UserMenu variant="compact" />
            </>
          )}
        </div>
      </header>

      <main className="flex-1 min-h-0">
        {isMobile ? (
          <div className="h-full">
            {tab === "chat" ? chatPanel : tab === "code" ? code : tab === "knowledge" ? knowledge : preview}
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={42} minSize={28}>
              {chatPanel}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={58} minSize={30}>
              {desktopRight === "preview" ? preview : desktopRight === "code" ? code : knowledge}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </main>

      {isMobile && (
        <nav className="h-16 shrink-0 grid grid-cols-4 border-t border-border/60 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-4px_hsl(var(--background))]">
          <TabBtn label="Chat" icon={MessageSquare} active={tab === "chat"} onClick={() => setTab("chat")} />
          <TabBtn label="Code" icon={Code2} active={tab === "code"} onClick={() => setTab("code")} />
          <span data-tour="preview-tab" className="contents">
            <TabBtn label="Preview" icon={Eye} active={tab === "preview"} onClick={() => setTab("preview")} />
          </span>
          <TabBtn label="Knowledge" icon={BookOpen} active={tab === "knowledge"} onClick={() => setTab("knowledge")} />
        </nav>
      )}

      <Tour steps={BUILDER_TOUR_STEPS} storageKey={BUILDER_TOUR_KEY} />
    </div>
  );
};

export default BuilderV2;
