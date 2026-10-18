import { MoreVertical, HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { ModelSettingsMenu } from "@/components/builder/ModelSettingsMenu";
import { ShipActions } from "@/components/builder/ShipActions";
import { BackendStatusButton } from "@/components/builder/BackendStatusButton";

interface Props {
  projectId: string;
  projectName?: string;
  onGithubCommand?: (prompt: string) => void;
}

/**
 * Mobile-only overflow menu for the BuilderV2 header.
 * Packs Backend / Ship (GitHub + APK) / Model / Theme behind a single
 * tap target so the header stays uncluttered at 360–414px widths.
 */
export function BuilderHeaderOverflow({ projectId, projectName, onGithubCommand }: Props) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="More actions"
        className="size-9 grid place-items-center rounded-lg border border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground active:scale-95 transition"
      >
        <MoreVertical size={16} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[280px] p-3 rounded-2xl glass-strong border-border/60 shadow-[0_24px_48px_-16px_hsl(var(--primary)/0.45)]"
      >
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground mb-2 px-1">
              Workspace
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <BackendStatusButton projectId={projectId} />
              <ShipActions projectId={projectId} projectName={projectName} onGithubCommand={onGithubCommand} />
              <ModelSettingsMenu />
            </div>
          </div>

          <div className="h-px bg-border/60" />

          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground mb-2 px-1">
              Theme
            </p>
            <ThemeSwitcher variant="segmented" className="w-full justify-between" />
          </div>

          <div className="h-px bg-border/60" />

          <Link
            to="/help"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2 px-2 py-2 -mx-1 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98] transition"
          >
            <HelpCircle size={15} />
            <span>Help center</span>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
