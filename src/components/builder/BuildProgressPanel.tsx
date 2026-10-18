import { CheckCircle2, Download, ExternalLink, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { AppBuild, AppBuildStep } from "@/hooks/useAppBuilds";

interface Props {
  build: AppBuild;
  steps: AppBuildStep[];
}

const RUNNING_COPY: Record<AppBuild["status"], string> = {
  queued: "GitHub Actions queue te wait kortese…",
  preparing: "Build environment ready hocche…",
  building: "APK compile cholche…",
  uploading: "APK upload hocche…",
  ready: "APK download er jonno ready.",
  failed: "Build fail hoyeche.",
  cancelled: "Build cancel hoyeche.",
};

export function BuildProgressPanel({ build, steps }: Props) {
  const progress = getProgress(build, steps);
  const isReady = build.status === "ready";
  const displaySteps = isReady
    ? steps.map((s) => (s.status === "done" ? s : { ...s, status: "done" as const }))
    : steps;
  const currentStep = displaySteps.find((s) => s.status === "running") ?? displaySteps.find((s) => s.status === "pending");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">{RUNNING_COPY[build.status]}</span>
          <span className="tabular-nums text-muted-foreground">{progress}%</span>
        </div>
        <Progress value={progress} className="h-2" />
        {build.github_run_url && (
          <a
            href={build.github_run_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            GitHub Actions log <ExternalLink size={12} />
          </a>
        )}
      </div>

      <ul className="space-y-2 text-sm">
        {displaySteps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 rounded-md border border-border/60 p-2">
            <StepIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <p className={cn(
                "leading-tight",
                step.status === "running" && "font-medium",
                step.status === "pending" && "text-muted-foreground",
                step.status === "failed" && "text-destructive",
              )}>{step.label}</p>
              {step.detail && <p className="mt-1 text-xs text-muted-foreground break-words">{step.detail}</p>}
            </div>
          </li>
        ))}
      </ul>

      {isReady && build.download_url && (
        <div className="flex items-stretch gap-3 rounded-lg border border-border/60 p-3">
          <div className="flex-shrink-0 rounded-md bg-white p-1.5">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=1&ecc=M&data=${encodeURIComponent(build.download_url)}`}
              alt="Scan to download APK"
              width={140}
              height={140}
              className="block"
            />
          </div>
          <div className="flex min-w-0 flex-col justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Scan to install</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Phone diye QR scan korle APK direct download hobe.</p>
            </div>
            <Button asChild size="sm" className="mt-2 active:scale-95">
              <a href={build.download_url} target="_blank" rel="noreferrer">
                <Download size={14} className="mr-2" /> Download APK
              </a>
            </Button>
          </div>
        </div>
      )}

      {build.status === "failed" && (
        <div className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-md p-2">
          {build.error_message ?? currentStep?.detail ?? "Build failed. GitHub Actions log check korun."}
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: AppBuildStep["status"] }) {
  if (status === "done") return <CheckCircle2 size={15} className="mt-0.5 text-primary" />;
  if (status === "running") return <Loader2 size={15} className="mt-0.5 animate-spin text-primary" />;
  if (status === "failed") return <XCircle size={15} className="mt-0.5 text-destructive" />;
  return <span className="mt-0.5 size-[15px] rounded-full border border-border" />;
}

function getProgress(build: AppBuild, steps: AppBuildStep[]) {
  if (build.status === "ready") return 100;
  if (build.status === "failed" || build.status === "cancelled") return Math.max(5, donePercent(steps));
  return Math.max(5, donePercent(steps));
}

function donePercent(steps: AppBuildStep[]) {
  if (!steps.length) return 5;
  const done = steps.filter((s) => s.status === "done").length;
  const running = steps.some((s) => s.status === "running") ? 0.5 : 0;
  return Math.min(98, Math.round(((done + running) / steps.length) * 100));
}