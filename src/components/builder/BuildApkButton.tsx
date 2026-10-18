import { useState } from "react";
import { Hammer, Loader2, FlaskConical, Package, Store, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useActiveBuild, useBuildLive } from "@/hooks/useAppBuilds";
import { BuildProgressPanel } from "./BuildProgressPanel";

type BuildTarget = "apk-debug" | "apk-release" | "aab-release";

const TARGETS: Array<{
  id: BuildTarget;
  icon: typeof FlaskConical;
  title: string;
  desc: string;
  badge: string;
}> = [
  {
    id: "apk-debug",
    icon: FlaskConical,
    title: "Test APK",
    desc: "Quick build for sideloading & testing on your phone. No keystore needed.",
    badge: "Fastest",
  },
  {
    id: "apk-release",
    icon: Package,
    title: "Release APK",
    desc: "Signed APK to share outside Play Store (website, WhatsApp, etc.). Needs keystore.",
    badge: "Shareable",
  },
  {
    id: "aab-release",
    icon: Store,
    title: "Play Store Bundle (AAB)",
    desc: "Signed .aab file to upload to Google Play Console. Cannot be installed directly. Needs keystore.",
    badge: "Play Store",
  },
];

export function BuildApkButton({ projectId }: { projectId: string }) {
  const { activeBuild, refresh: refreshActiveBuild } = useActiveBuild(projectId);
  const [open, setOpen] = useState(false);
  const [trigBuildId, setTrigBuildId] = useState<string | null>(null);
  const [starting, setStarting] = useState<BuildTarget | null>(null);
  const [needsKeystore, setNeedsKeystore] = useState<BuildTarget | null>(null);
  const [savingKs, setSavingKs] = useState(false);
  const [ks, setKs] = useState({
    alias: "app",
    storePassword: "",
    keyPassword: "",
    fullName: "",
    orgName: "",
    country: "US",
  });

  const watchId = trigBuildId ?? activeBuild?.id ?? null;
  const { build, steps } = useBuildLive(watchId);
  const isBuilding = !!build && ["queued", "preparing", "building", "uploading"].includes(build.status);

  const start = async (buildTarget: BuildTarget) => {
    setStarting(buildTarget);
    try {
      const { data, error } = await supabase.functions.invoke("trigger-build", {
        body: { projectId, platform: "android", buildTarget },
      });
      // New backend returns needs_keystore on 200; older deployed function may still return 400.
      let errBody: any = data;
      if (error && (error as any).context?.json) {
        try { errBody = await (error as any).context.json(); } catch { /* ignore */ }
      } else if (error && (error as any).context?.text) {
        try { errBody = JSON.parse(await (error as any).context.text()); } catch { /* ignore */ }
      }
      const errCode = errBody?.error;
      if (errBody?.needs_keystore || errCode === "no_keystore" || error?.message?.includes("no_keystore")) {
        setNeedsKeystore(buildTarget);
        return;
      }
      if (error || errCode) throw new Error(errBody?.message || errBody?.error || error?.message || "Build failed");
      const buildId = data?.build_id ?? data?.buildId;
      if (!buildId) throw new Error("Build started, but no build ID returned");
      setTrigBuildId(buildId);
      refreshActiveBuild();
      const label = TARGETS.find((t) => t.id === buildTarget)?.title ?? "Build";
      toast({ title: `${label} started`, description: "Compiling on GitHub Actions…" });
    } catch (e: any) {
      toast({ title: "Build failed to start", description: e.message, variant: "destructive" });
    } finally {
      setStarting(null);
    }
  };

  const saveKeystore = async () => {
    if (ks.storePassword.length < 6 || ks.keyPassword.length < 6) {
      toast({ title: "Passwords must be at least 6 characters", variant: "destructive" });
      return;
    }
    setSavingKs(true);
    try {
      const { data, error } = await supabase.functions.invoke("keystore-init", { body: ks });
      if (error || (data as any)?.error) throw new Error(error?.message || (data as any)?.error);
      toast({ title: "Keystore saved", description: "Generated on first release build. Back up the .jks afterwards." });
      const target = needsKeystore;
      setNeedsKeystore(null);
      if (target) await start(target);
    } catch (e: any) {
      toast({ title: "Could not save keystore", description: e.message, variant: "destructive" });
    } finally {
      setSavingKs(false);
    }
  };

  return (
    <>
      <Button variant={isBuilding ? "default" : "outline"} size="sm" onClick={() => setOpen(true)} className="active:scale-95 gap-1.5">
        {isBuilding ? <Loader2 size={14} className="animate-spin" /> : <Hammer size={14} />}
        <span className="hidden sm:inline">{isBuilding ? "Building…" : "Build"}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          {needsKeystore ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><KeyRound size={16} /> Set up signing keystore</DialogTitle>
                <DialogDescription>
                  Required once for Release APK & Play Store AAB. Same keystore is reused for all future updates — Play Store rejects updates signed with a different key, so back up the .jks after the first release build.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="ks-alias">Alias</Label>
                    <Input id="ks-alias" value={ks.alias} onChange={(e) => setKs({ ...ks, alias: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="ks-country">Country (2-letter)</Label>
                    <Input id="ks-country" maxLength={2} value={ks.country} onChange={(e) => setKs({ ...ks, country: e.target.value.toUpperCase() })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="ks-sp">Store password</Label>
                    <Input id="ks-sp" type="password" value={ks.storePassword} onChange={(e) => setKs({ ...ks, storePassword: e.target.value, keyPassword: e.target.value })} placeholder="≥6 chars" />
                  </div>
                  <div>
                    <Label htmlFor="ks-kp">Key password</Label>
                    <Input id="ks-kp" type="password" value={ks.keyPassword} onChange={(e) => setKs({ ...ks, keyPassword: e.target.value })} placeholder="≥6 chars" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="ks-name">Full name</Label>
                  <Input id="ks-name" value={ks.fullName} onChange={(e) => setKs({ ...ks, fullName: e.target.value })} placeholder="App Owner" />
                </div>
                <div>
                  <Label htmlFor="ks-org">Organization</Label>
                  <Input id="ks-org" value={ks.orgName} onChange={(e) => setKs({ ...ks, orgName: e.target.value })} placeholder="My Company" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  ⚠️ Save these passwords somewhere safe. If you lose them you cannot publish updates to your app on Play Store ever again.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setNeedsKeystore(null)} disabled={savingKs}>Cancel</Button>
                <Button onClick={saveKeystore} disabled={savingKs}>
                  {savingKs ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                  Save & start build
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Hammer size={16} /> Build for Android</DialogTitle>
                <DialogDescription>Choose what kind of Android artifact to compile.</DialogDescription>
              </DialogHeader>

              {!build && (
                <div className="space-y-2">
                  {TARGETS.map((t) => {
                    const Icon = t.icon;
                    const isLoading = starting === t.id;
                    const disabled = !!starting;
                    return (
                      <button
                        key={t.id}
                        onClick={() => start(t.id)}
                        disabled={disabled}
                        className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed transition-colors p-3 flex items-start gap-3 active:scale-[0.99]"
                      >
                        <div className="shrink-0 mt-0.5 size-9 rounded-md bg-muted flex items-center justify-center">
                          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{t.title}</span>
                            <span className="text-[10px] uppercase tracking-wide rounded-sm bg-secondary text-secondary-foreground px-1.5 py-0.5">{t.badge}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                  <p className="text-[11px] text-muted-foreground pt-1">Typical build time: 4–8 minutes. You can close this dialog — the build keeps running.</p>
                </div>
              )}

              {build && <BuildProgressPanel build={build} steps={steps} />}
              {isBuilding && <p className="text-xs text-muted-foreground">Dialog close korleo build background e cholbe.</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
