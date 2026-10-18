import { useState } from "react";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppBrandingDialog } from "./AppBrandingDialog";

export function BrandingButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="active:scale-95 gap-1.5">
        <Palette size={14} />
        <span className="hidden sm:inline">Branding</span>
      </Button>
      <AppBrandingDialog projectId={projectId} open={open} onOpenChange={setOpen} />
    </>
  );
}
