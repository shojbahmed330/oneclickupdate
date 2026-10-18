import { useEffect, useState } from "react";
import { Download, FileText, Loader2, ImageIcon } from "lucide-react";
import { getAttachmentSignedUrl, fileNameFromPath } from "@/lib/supportAttachments";
import { cn } from "@/lib/utils";

const isImagePath = (p: string) => /\.(png|jpe?g|gif|webp)$/i.test(p);

export const AttachmentBubble = ({
  path,
  mine,
}: {
  path: string;
  mine?: boolean;
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getAttachmentSignedUrl(path)
      .then((u) => alive && setUrl(u))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);

  const name = fileNameFromPath(path);
  const isImg = isImagePath(path);

  if (loading) {
    return (
      <div className="mt-1 inline-flex items-center gap-2 text-[11px] opacity-70">
        <Loader2 size={12} className="animate-spin" /> attachment…
      </div>
    );
  }
  if (!url) {
    return <div className="mt-1 text-[11px] opacity-70">Attachment unavailable</div>;
  }

  if (isImg) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mt-1.5">
        <img
          src={url}
          alt={name}
          className="rounded-lg max-h-56 max-w-full object-cover border border-[hsl(0_0%_100%/0.08)]"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={name}
      className={cn(
        "mt-1.5 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] max-w-full",
        mine
          ? "bg-primary-foreground/10 border-primary-foreground/20 hover:bg-primary-foreground/15"
          : "bg-[hsl(0_0%_100%/0.04)] border-[hsl(0_0%_100%/0.08)] hover:bg-[hsl(0_0%_100%/0.08)]",
      )}
    >
      {/\.pdf$/i.test(path) ? <FileText size={14} /> : <ImageIcon size={14} />}
      <span className="truncate max-w-[180px]">{name}</span>
      <Download size={12} className="opacity-70" />
    </a>
  );
};
