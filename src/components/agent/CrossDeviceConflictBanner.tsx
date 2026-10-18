import { AlertCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  visible: boolean;
  kind: "message" | "file" | "plan" | null;
  onReload: () => void;
  onDismiss: () => void;
}

const KIND_LABEL: Record<string, string> = {
  message: "চ্যাট",
  file: "ফাইল",
  plan: "প্ল্যান",
};

export const CrossDeviceConflictBanner = ({ visible, kind, onReload, onDismiss }: Props) => {
  if (!visible) return null;
  const label = kind ? KIND_LABEL[kind] ?? kind : "প্রজেক্ট";
  return (
    <div
      role="alert"
      className="mx-3 mb-2 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm shrink-0"
    >
      <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0 text-foreground">
        অন্য একটা ডিভাইসে {label} আপডেট হয়েছে — চালিয়ে গেলে আপনার লোকাল পরিবর্তন হারাতে পারে।
      </div>
      <Button
        size="sm"
        variant="default"
        onClick={onReload}
        className="h-8 gap-1.5 active:scale-95 transition-transform"
      >
        <RefreshCw className="size-3.5" /> রিলোড
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={onDismiss}
        className="h-8 w-8 active:scale-95 transition-transform"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
};
