import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

/**
 * GDPR-compliant data controls. Renders inside Profile → Security.
 *  • Download: invokes the user-data-export edge function and saves the JSON.
 *  • Delete: confirm dialog asks the user to type their email, then calls
 *    user-account-delete and signs out.
 */
export const PrivacyDataControls = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `https://hmsslfnhaswqzolufnrc.supabase.co/functions/v1/user-data-export`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `oneclick-studio-data-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Data exported", { description: "Your full data archive has been downloaded." });
    } catch (err: any) {
      toast.error("Export failed", { description: err.message });
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("user-account-delete", {
        body: { confirm_email: confirmEmail.trim() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Account deleted", { description: "Your data has been removed. Goodbye 👋" });
      await signOut();
      navigate("/", { replace: true });
    } catch (err: any) {
      toast.error("Couldn't delete account", { description: err.message });
      setDeleting(false);
    }
  };

  return (
    <>
      <section className="rounded-2xl border border-border bg-[hsl(var(--bg-muted))] p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Download size={14} className="text-primary" />Your data
        </div>
        <p className="text-[12.5px] text-[hsl(var(--foreground-muted))]">
          Download a single JSON archive containing every project, file, message, build, and order
          tied to your account. Per GDPR, we provide this on demand at no cost.
        </p>
        <Button type="button" variant="secondary" onClick={handleExport} disabled={exporting} loading={exporting}>
          {!exporting && <Download size={14} className="mr-1.5" />}
          Download my data
        </Button>
      </section>

      <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 sm:p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <ShieldAlert size={14} />Delete account
        </div>
        <p className="text-[12.5px] text-[hsl(var(--foreground-muted))]">
          Permanently remove your account and all associated projects, files, chat history, and
          builds. Order &amp; invoice records are kept for tax compliance but anonymized.
          <strong className="block mt-1.5 text-foreground">This cannot be undone.</strong>
        </p>
        <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
          <Trash2 size={14} className="mr-1.5" />Delete my account
        </Button>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!deleting) setConfirmOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will erase all your projects, files, chats, and builds. Type your email
              <strong className="text-foreground"> {user?.email}</strong> below to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="confirm-email" className="text-[12px]">Type your email to confirm</Label>
            <Input
              id="confirm-email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={user?.email ?? ""}
              autoComplete="off"
              disabled={deleting}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting || confirmEmail.trim().toLowerCase() !== (user?.email ?? "").toLowerCase()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (<><Loader2 size={14} className="mr-1.5 animate-spin" />Deleting…</>) : "Permanently delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
