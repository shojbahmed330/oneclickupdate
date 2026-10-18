import { useEffect, useRef, useState } from "react";
import { Loader2, Image as ImageIcon, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Form = {
  app_name: string;
  package_id: string;
  version_name: string;
  version_code: number;
  splash_bg_color: string;
  adaptive_bg_color: string;
  logo_path: string | null;
};

const EMPTY: Form = {
  app_name: "", package_id: "", version_name: "1.0.0", version_code: 1,
  splash_bg_color: "#FFFFFF", adaptive_bg_color: "#FFFFFF", logo_path: null,
};

export function AppBrandingDialog({ projectId, open, onOpenChange }: {
  projectId: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const url = `${(import.meta as any).env.VITE_SUPABASE_URL}/functions/v1/branding-config?projectId=${projectId}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
        const j = await r.json();
        const b = j.branding ?? {};
        const d = j.defaults ?? {};
        setForm({
          app_name: b.app_name ?? d.app_name ?? "",
          package_id: b.package_id ?? d.package_id ?? "",
          version_name: b.version_name ?? d.version_name ?? "1.0.0",
          version_code: b.version_code ?? d.version_code ?? 1,
          splash_bg_color: b.splash_bg_color ?? d.splash_bg_color ?? "#FFFFFF",
          adaptive_bg_color: b.adaptive_bg_color ?? d.adaptive_bg_color ?? "#FFFFFF",
          logo_path: b.logo_path ?? null,
        });
        setLogoUrl(j.logo_url ?? null);
      } catch (e: any) {
        toast({ title: "Could not load branding", description: e.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [open, projectId]);

  const onPickLogo = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please pick a PNG/JPG image", variant: "destructive" }); return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast({ title: "Logo must be under 4 MB", variant: "destructive" }); return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${user.id}/${projectId}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("app-branding").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("app-branding").createSignedUrl(path, 1800);
      setForm((f) => ({ ...f, logo_path: path }));
      setLogoUrl(signed?.signedUrl ?? null);
      toast({ title: "Logo uploaded", description: "Don't forget to Save." });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!projectId) {
      toast({ title: "No project selected", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${(import.meta as any).env.VITE_SUPABASE_URL}/functions/v1/branding-config`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
          apikey: (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ projectId, ...form }),
      });
      const j = await r.json();
      if (!r.ok || j?.error) throw new Error(j?.error || `HTTP ${r.status}`);
      toast({ title: "Branding saved", description: "Next build will use this name, icon & version." });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ImageIcon size={16} /> App Branding</DialogTitle>
          <DialogDescription>Name, icon, package & version used for APK / AAB builds.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin" size={18} /></div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="size-16 rounded-xl border border-border bg-muted flex items-center justify-center overflow-hidden" style={{ backgroundColor: form.adaptive_bg_color }}>
                {logoUrl ? <img src={logoUrl} alt="logo" className="size-full object-contain" /> : <ImageIcon size={20} className="text-muted-foreground" />}
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && onPickLogo(e.target.files[0])} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="active:scale-95 gap-1.5 w-fit">
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {logoUrl ? "Replace logo" : "Upload logo"}
                </Button>
                <p className="text-[11px] text-muted-foreground">Square PNG, ≥512×512. This is the icon shown after install.</p>
                {logoUrl && (
                  <button type="button" onClick={() => { setForm((f) => ({ ...f, logo_path: null })); setLogoUrl(null); }} className="text-[11px] text-destructive flex items-center gap-1 w-fit hover:underline">
                    <Trash2 size={11} /> Remove
                  </button>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="b-name">App name</Label>
              <Input id="b-name" maxLength={40} value={form.app_name} onChange={(e) => setForm({ ...form, app_name: e.target.value })} />
            </div>

            <div>
              <Label htmlFor="b-pkg">Package ID</Label>
              <Input id="b-pkg" value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value.toLowerCase() })} placeholder="com.you.appname" />
              <p className="text-[11px] text-muted-foreground mt-1">Lowercase, dot-separated. Cannot change after first Play Store upload.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="b-vn">Version name</Label>
                <Input id="b-vn" value={form.version_name} onChange={(e) => setForm({ ...form, version_name: e.target.value })} placeholder="1.0.0" />
              </div>
              <div>
                <Label htmlFor="b-vc">Version code</Label>
                <Input id="b-vc" type="number" min={1} value={form.version_code} onChange={(e) => setForm({ ...form, version_code: Number(e.target.value) || 1 })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="b-bg">Icon background</Label>
                <Input id="b-bg" type="color" value={form.adaptive_bg_color} onChange={(e) => setForm({ ...form, adaptive_bg_color: e.target.value.toUpperCase() })} className="h-10 p-1" />
              </div>
              <div>
                <Label htmlFor="b-sp">Splash background</Label>
                <Input id="b-sp" type="color" value={form.splash_bg_color} onChange={(e) => setForm({ ...form, splash_bg_color: e.target.value.toUpperCase() })} className="h-10 p-1" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading} className="active:scale-95">
            {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
